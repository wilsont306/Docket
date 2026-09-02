import { eq } from "drizzle-orm";
import { assertDateWithinSaneRange, assertEventCountWithinCap, type ParsedEvent } from "@calendar-auto/core";
import { getDb } from "@/db";
import { draftEvents, drafts, needsInput as needsInputTable, parseRuns } from "@/db/schema";
import type { ResolvedEvent } from "./resolve";

export class PersistError extends Error {}

/**
 * Shared by both input paths (§6.3 stages 5-7): validate the resolved batch,
 * then persist parse_run -> draft -> draft_events -> needs_input. Kept out
 * of extraction so text (M1) and photo (M3) share one code path for the
 * part that doesn't depend on how the events were produced.
 *
 * `existingDraftId` is set for "Add another" (§4, appending more events to
 * a draft still open for review) -- this capture still gets its own
 * parse_run for audit purposes (§7.2.3), but its resolved events land on
 * the caller's existing draft instead of a new one, so review shows
 * everything the user has described so far in one place rather than
 * scattering it across separate unconfirmed drafts they'd have to hunt
 * down individually.
 */
export async function persistDraft(
  captureId: string,
  model: string,
  promptVersion: string,
  resolved: ResolvedEvent[],
  referenceDate: Date,
  existingDraftId?: string,
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

  let draftId: string;
  if (existingDraftId) {
    const [existing] = await db.select().from(drafts).where(eq(drafts.id, existingDraftId)).limit(1);
    if (!existing) throw new PersistError("Draft not found");
    if (existing.state === "committed") throw new PersistError("Can't add to a draft that's already been confirmed");
    draftId = existing.id;
  } else {
    const [draft] = await db.insert(drafts).values({ parseRunId: parseRun.id, state: "pending" }).returning();
    draftId = draft.id;
  }

  const insertedEvents = await db
    .insert(draftEvents)
    .values(resolved.map(({ event }): { draftId: string; event: ParsedEvent } => ({ draftId, event })))
    .returning();

  for (const [i, { needsInput }] of resolved.entries()) {
    const draftEventId = insertedEvents[i].id;
    for (const item of needsInput) {
      await db.insert(needsInputTable).values({
        draftId,
        draftEventId,
        type: item.type,
        payload: { scope: "event" },
      });
    }
  }

  return { draftId };
}
