import { assertDateWithinSaneRange, assertEventCountWithinCap } from "@calendar-auto/core";
import { getDb } from "@/db";
import { captures, draftEvents, drafts, needsInput as needsInputTable, parseRuns, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { EXTRACTION_MODEL_ID, extractEventsFromText } from "./extract";
import { resolveEvent } from "./resolve";

const PROMPT_VERSION = "text-v1";

export class PipelineError extends Error {}

/**
 * Pipeline stages 1-7 (§6.3) for the text input path (FR-3.2). Synchronous
 * end to end: text parse's own NFR target (<8s p95, NFR-9.1.2) is short
 * enough that M1 doesn't need the SSE progress-streaming machinery §6.5
 * calls for on the image path — that's added when M3's slower photo parse
 * makes it worth the complexity.
 *
 * Stage 3 (input rails) always fails open here because NeMo Guardrails
 * isn't deployed until M6 (§7.4) — every parse_run is recorded as
 * unscreened rather than silently treated as screened.
 */
export async function runTextCapturePipeline(userId: string, sourceText: string, clientTimezone?: string) {
  const db = getDb();

  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new PipelineError("Unknown user");

  const timezone = clientTimezone ?? user.timezone;
  if (clientTimezone && clientTimezone !== user.timezone) {
    await db.update(users).set({ timezone: clientTimezone }).where(eq(users.id, userId));
  }

  const [capture] = await db
    .insert(captures)
    .values({ userId, kind: "text", sourceText, status: "parsing" })
    .returning();

  try {
    const now = new Date();
    const extracted = await extractEventsFromText(sourceText, { timezone, now });
    const resolved = extracted.map(resolveEvent);

    assertEventCountWithinCap(resolved.length);
    for (const { event } of resolved) {
      if (event.startDateTime.value) {
        assertDateWithinSaneRange(new Date(event.startDateTime.value), now);
      }
    }

    const [parseRun] = await db
      .insert(parseRuns)
      .values({
        captureId: capture.id,
        model: EXTRACTION_MODEL_ID,
        promptVersion: PROMPT_VERSION,
        railVerdicts: { screened: false, reason: "guardrails not yet deployed (M6)" },
      })
      .returning();

    const [draft] = await db.insert(drafts).values({ parseRunId: parseRun.id, state: "pending" }).returning();

    const insertedEvents = await db
      .insert(draftEvents)
      .values(resolved.map(({ event }) => ({ draftId: draft.id, event })))
      .returning();

    for (const [i, { needsInput }] of resolved.entries()) {
      const draftEventId = insertedEvents[i].id;
      for (const item of needsInput) {
        await db.insert(needsInputTable).values({
          draftId: draft.id,
          draftEventId,
          type: item.type,
          payload: { scope: "event" },
        });
      }
    }

    await db.update(captures).set({ status: "ready" }).where(eq(captures.id, capture.id));

    return { draftId: draft.id };
  } catch (error) {
    await db.update(captures).set({ status: "error" }).where(eq(captures.id, capture.id));
    throw error;
  }
}
