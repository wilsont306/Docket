import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { draftEvents, drafts, needsInput as needsInputTable } from "@/db/schema";
import { getDraftOwnerId } from "@/lib/pipeline/ownership";

/** GET /api/drafts/:id (§6.5) — draft + events + needs_input for the review surface. */
export async function GET(_request: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const ownerId = await getDraftOwnerId(id);
  if (!ownerId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const [draft] = await db.select().from(drafts).where(eq(drafts.id, id)).limit(1);
  const events = await db.select().from(draftEvents).where(eq(draftEvents.draftId, id));
  const needsInput = await db.select().from(needsInputTable).where(eq(needsInputTable.draftId, id));

  return NextResponse.json({ ...draft, events, needsInput });
}
