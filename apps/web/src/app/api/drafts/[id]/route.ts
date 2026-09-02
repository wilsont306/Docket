import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { captures, draftEvents, drafts, needsInput as needsInputTable, parseRuns } from "@/db/schema";
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

  // §4.4.1/FR-3.2.5/FR-4.4.2: what the review surface highlights spans/boxes against.
  const [source] = await db
    .select({ captureId: captures.id, sourceText: captures.sourceText, kind: captures.kind })
    .from(drafts)
    .innerJoin(parseRuns, eq(drafts.parseRunId, parseRuns.id))
    .innerJoin(captures, eq(parseRuns.captureId, captures.id))
    .where(eq(drafts.id, id))
    .limit(1);

  return NextResponse.json({ ...draft, events, needsInput, source });
}

/** PATCH /api/drafts/:id (§5.2 `calendar_target`) — batch-level, asked/answered once, not per event. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const ownerId = await getDraftOwnerId(id);
  if (!ownerId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (typeof body?.calendarId !== "string" || !body.calendarId) {
    return NextResponse.json({ error: "Expected { calendarId: string }" }, { status: 400 });
  }

  const db = getDb();
  const [updated] = await db.update(drafts).set({ calendarId: body.calendarId }).where(eq(drafts.id, id)).returning();
  return NextResponse.json(updated);
}
