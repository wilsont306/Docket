import { assertDateWithinSaneRange, assertEventCountWithinCap, type ParsedEvent } from "@calendar-auto/core";
import { getDb } from "@/db";
import { draftEvents, drafts, needsInput as needsInputTable, parseRuns } from "@/db/schema";
import type { ResolvedEvent } from "./resolve";

/**
 * Shared by both input paths (§6.3 stages 5-7): validate the resolved batch,
 * then persist parse_run -> draft -> draft_events -> needs_input. Kept out
 * of extraction so text (M1) and photo (M3) share one code path for the
 * part that doesn't depend on how the events were produced.
 */
export async function persistDraft(
  captureId: string,
  model: string,
  promptVersion: string,
  resolved: ResolvedEvent[],
  referenceDate: Date,
): Promise<{ draftId: string }> {
  const db = getDb();

  assertEventCountWithinCap(resolved.length);
  for (const { event } of resolved) {
    if (event.startDateTime.value) {
      assertDateWithinSaneRange(new Date(event.startDateTime.value), referenceDate);
    }
  }

  const [parseRun] = await db
    .insert(parseRuns)
    .values({
      captureId,
      model,
      promptVersion,
      railVerdicts: { screened: false, reason: "guardrails not yet deployed (M6)" },
    })
    .returning();

  const [draft] = await db.insert(drafts).values({ parseRunId: parseRun.id, state: "pending" }).returning();

  const insertedEvents = await db
    .insert(draftEvents)
    .values(resolved.map(({ event }): { draftId: string; event: ParsedEvent } => ({ draftId: draft.id, event })))
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

  return { draftId: draft.id };
}
