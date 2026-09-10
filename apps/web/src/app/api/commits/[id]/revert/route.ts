import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { commits, drafts, parseRuns, captures } from "@/db/schema";
import { deleteEvent } from "@/lib/google-calendar";
import { invalidateUserCalendarCache } from "@/lib/calendar-cache";

/**
 * POST /api/commits/:id/revert (FR-4.7.4's 10s undo window; also the
 * mechanism FR-4.8.2's 30-day history revert will call). M1 keeps this
 * unconditional -- FR-4.8.3's "skip events modified since creation" check
 * belongs to the History feature (§4.8), which is M2 scope.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/commits/[id]/revert">) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: commitId } = await ctx.params;
  const db = getDb();

  const [row] = await db
    .select({ commit: commits, userId: captures.userId })
    .from(commits)
    .innerJoin(drafts, eq(commits.draftId, drafts.id))
    .innerJoin(parseRuns, eq(drafts.parseRunId, parseRuns.id))
    .innerJoin(captures, eq(parseRuns.captureId, captures.id))
    .where(eq(commits.id, commitId))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (row.commit.revertedAt) return NextResponse.json(row.commit);

  const failures: Array<{ googleEventId: string; error: string }> = [];
  for (const googleEventId of row.commit.googleEventIds) {
    try {
      await deleteEvent(session.user.id, googleEventId, row.commit.calendarId);
    } catch (error) {
      failures.push({ googleEventId, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  invalidateUserCalendarCache(session.user.id);

  const [updated] = await db
    .update(commits)
    .set({ revertedAt: new Date() })
    .where(eq(commits.id, commitId))
    .returning();

  return NextResponse.json({ ...updated, failures });
}
