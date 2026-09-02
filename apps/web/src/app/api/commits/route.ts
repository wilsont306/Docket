import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { captures, commits, draftEvents, drafts, parseRuns } from "@/db/schema";
import type { ParsedEvent } from "@calendar-auto/core";

/** GET /api/commits (§4.8 History) — every event this user has actually committed to Google Calendar, newest first. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select({
      commit: commits,
      sourceKind: captures.kind,
      draftId: drafts.id,
    })
    .from(commits)
    .innerJoin(drafts, eq(commits.draftId, drafts.id))
    .innerJoin(parseRuns, eq(drafts.parseRunId, parseRuns.id))
    .innerJoin(captures, eq(parseRuns.captureId, captures.id))
    .where(eq(captures.userId, session.user.id))
    .orderBy(desc(commits.committedAt));

  const events = await Promise.all(
    rows.map(async ({ draftId }) => {
      const eventRows = await db.select().from(draftEvents).where(eq(draftEvents.draftId, draftId));
      return eventRows
        .filter((row) => !row.deleted)
        .map((row) => {
          const event = row.event as ParsedEvent;
          return { title: event.title.value ?? "(untitled)", start: event.startDateTime.value };
        });
    }),
  );

  const result = rows.map(({ commit, sourceKind }, i) => ({
    id: commit.id,
    calendarId: commit.calendarId,
    committedAt: commit.committedAt,
    revertedAt: commit.revertedAt,
    sourceKind,
    events: events[i],
  }));

  return NextResponse.json(result);
}
