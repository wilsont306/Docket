import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { commits, draftEvents, drafts } from "@/db/schema";
import { insertEvent } from "@/lib/google-calendar";
import { getDraftOwnerId } from "@/lib/pipeline/ownership";
import {
  assertDateWithinSaneRange,
  assertEventCountWithinCap,
  assertInsertOnly,
  assertNoUnsolicitedAttendees,
  ValidationError,
  type ParsedEvent,
} from "@calendar-auto/core";

/**
 * POST /api/drafts/:id/commit (§6.3 stages 8-9, §4.7). Execution rails run
 * here, independently of the model that produced the draft (§7.3) --
 * ParsedEvent has no attendees field yet, so assertNoUnsolicitedAttendees is
 * currently always-passing, but it stays wired so the day attendee
 * extraction is added, this gate is already in the write path rather than
 * bolted on after the fact.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/drafts/[id]/commit">) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await ctx.params;
  const ownerId = await getDraftOwnerId(draftId);
  if (!ownerId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();

  // Idempotent claim (FR-6.7.4): only the request that flips pending/edited
  // -> committed proceeds to write. A retry of an already-committed draft
  // returns the existing commit instead of inserting a second time.
  const [claimed] = await db
    .update(drafts)
    .set({ state: "committed" })
    .where(and(eq(drafts.id, draftId), inArray(drafts.state, ["pending", "edited"])))
    .returning();

  if (!claimed) {
    const [existing] = await db.select().from(commits).where(eq(commits.draftId, draftId)).limit(1);
    if (existing) return NextResponse.json(existing);
    return NextResponse.json({ error: "Draft cannot be committed from its current state" }, { status: 409 });
  }

  const rows = await db.select().from(draftEvents).where(eq(draftEvents.draftId, draftId));
  const liveRows = rows.filter((row) => !row.deleted);

  try {
    assertEventCountWithinCap(liveRows.length);
    assertInsertOnly({ operation: "insert" });
    assertNoUnsolicitedAttendees([{ attendees: [], attendeesOptedIn: false }]);

    const now = new Date();
    for (const row of liveRows) {
      const event = row.event as ParsedEvent;
      if (event.startDateTime.value) {
        assertDateWithinSaneRange(new Date(event.startDateTime.value), now);
      }
    }
  } catch (error) {
    await db.update(drafts).set({ state: "edited" }).where(eq(drafts.id, draftId));
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    }
    throw error;
  }

  const [commitRow] = await db.insert(commits).values({ draftId, googleEventIds: [] }).returning();
  const googleEventIds: string[] = [];
  const failures: Array<{ draftEventId: string; error: string }> = [];

  // Batched, but each insert is reported independently (FR-4.7.3): a
  // failure partway through doesn't lose track of what already landed.
  for (const row of liveRows) {
    try {
      const googleEventId = await insertEvent(session.user.id, row.event as ParsedEvent, commitRow.id);
      googleEventIds.push(googleEventId);
      await db.update(commits).set({ googleEventIds }).where(eq(commits.id, commitRow.id));
    } catch (error) {
      failures.push({ draftEventId: row.id, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  if (googleEventIds.length === 0 && failures.length > 0) {
    // Nothing was actually written -- safe to let the user retry the whole draft.
    await db.update(drafts).set({ state: "edited" }).where(eq(drafts.id, draftId));
    return NextResponse.json({ error: "Failed to create any events.", failures }, { status: 502 });
  }

  return NextResponse.json({ ...commitRow, googleEventIds, failures }, { status: 201 });
}
