import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { draftEvents, drafts } from "@/db/schema";
import { getDraftOwnerId } from "@/lib/pipeline/ownership";

const EDITABLE_FIELDS = ["title", "startDateTime", "endDateTime", "isAllDay", "location", "description"] as const;
/** Not a Field<T> like the others -- {rrule, plainLanguage, confidence} or null, set directly rather than wrapped. */
const STRUCTURED_FIELDS = ["recurrence"] as const;
const CONFLICT_STATES = ["none", "overlap", "duplicate"] as const;

/**
 * PATCH /api/drafts/:id/events/:eid (§6.5) — edits a single field in place.
 * FR-4.2.5: editing a field marks it user-authoritative, so a later re-parse
 * (POST /api/captures/:id/parse, added when M2 builds the re-parse flow)
 * merges around it instead of clobbering the edit.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/drafts/[id]/events/[eid]">) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId, eid } = await ctx.params;
  const ownerId = await getDraftOwnerId(draftId);
  if (!ownerId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);

  const db = getDb();
  const [row] = await db
    .select()
    .from(draftEvents)
    .where(eq(draftEvents.id, eid))
    .limit(1);
  if (!row || row.draftId !== draftId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // FR-4.2.3: delete/restore is a separate concern from field edits -- it
  // doesn't touch `event` or mark anything user-authoritative.
  if (typeof body?.deleted === "boolean") {
    const [updated] = await db
      .update(draftEvents)
      .set({ deleted: body.deleted })
      .where(eq(draftEvents.id, eid))
      .returning();
    return NextResponse.json(updated);
  }

  // FR-4.6.1: conflict state from the review surface's own overlap/duplicate
  // check against the real calendar -- advisory only (FR-4.6.2), just stored
  // for display.
  if (CONFLICT_STATES.includes(body?.conflictState)) {
    const [updated] = await db
      .update(draftEvents)
      .set({ conflictState: body.conflictState })
      .where(eq(draftEvents.id, eid))
      .returning();
    return NextResponse.json(updated);
  }

  // One edit or several. A batch matters because this handler is a
  // read-modify-write of a single JSON column: an edit that necessarily
  // touches more than one field (switching an event to all-day rewrites
  // isAllDay plus both datetimes) would otherwise fire concurrent PATCHes
  // that each read the same `event` and clobber each other on the way back.
  const updates: Array<{ field: string; value: unknown }> = Array.isArray(body?.fields)
    ? body.fields
    : [{ field: body?.field, value: body?.value }];

  const known = (field: unknown): field is (typeof EDITABLE_FIELDS)[number] | (typeof STRUCTURED_FIELDS)[number] =>
    EDITABLE_FIELDS.includes(field as never) || STRUCTURED_FIELDS.includes(field as never);

  if (updates.length === 0 || !updates.every((update) => known(update?.field))) {
    return NextResponse.json(
      {
        error: `Expected { deleted: boolean }, { conflictState: one of ${CONFLICT_STATES.join(", ")} }, or { field: one of ${[...EDITABLE_FIELDS, ...STRUCTURED_FIELDS].join(", ")}, value } (or { fields: [{ field, value }] })`,
      },
      { status: 400 },
    );
  }

  const event = row.event as Record<string, unknown>;
  const userEditedFields = [...row.userEditedFields];

  for (const { field, value } of updates) {
    if (STRUCTURED_FIELDS.includes(field as never)) {
      // {rrule, plainLanguage, confidence} or null -- built client-side, set as-is rather than wrapped in the {value, confidence, provenance, ...} shape every other field uses.
      event[field] = value ?? null;
    } else {
      const currentFieldValue = event[field] as Record<string, unknown>;
      event[field] = {
        ...currentFieldValue,
        value,
        confidence: 1,
        provenance: null,
        inferred: false,
        inferredFrom: null,
      };
    }
    if (!userEditedFields.includes(field)) userEditedFields.push(field);
  }

  const [updated] = await db
    .update(draftEvents)
    .set({ event, userEditedFields })
    .where(eq(draftEvents.id, eid))
    .returning();

  await db.update(drafts).set({ state: "edited" }).where(eq(drafts.id, draftId));

  return NextResponse.json(updated);
}
