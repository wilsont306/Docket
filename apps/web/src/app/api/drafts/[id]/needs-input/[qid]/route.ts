import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { needsInput as needsInputTable } from "@/db/schema";
import { getDraftOwnerId } from "@/lib/pipeline/ownership";

/**
 * PATCH /api/drafts/:id/needs-input/:qid — marks a `location_missing` question
 * answered, whether the user supplied a location or skipped it (§5.3.3: skip
 * is a valid answer, not "still pending"). Without this, re-fetching the
 * draft (e.g. "Add another" reloading it to append a new event) would find
 * the same question still unanswered in the DB and ask it again.
 */
export async function PATCH(_request: Request, ctx: RouteContext<"/api/drafts/[id]/needs-input/[qid]">) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId, qid } = await ctx.params;
  const ownerId = await getDraftOwnerId(draftId);
  if (!ownerId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const [updated] = await db
    .update(needsInputTable)
    .set({ answeredAt: new Date() })
    .where(and(eq(needsInputTable.id, qid), eq(needsInputTable.draftId, draftId)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(updated);
}
