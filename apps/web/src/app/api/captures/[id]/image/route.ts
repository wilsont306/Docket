import { eq } from "drizzle-orm";
import { get } from "@vercel/blob";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { captures } from "@/db/schema";

/**
 * GET /api/captures/:id/image (FR-4.4.2) — relays the private Blob so the
 * review surface can show the original photo full-size and, for image
 * drafts, the bounding-box overlay for the selected event.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/captures/[id]/image">) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const db = getDb();
  const [capture] = await db.select().from(captures).where(eq(captures.id, id)).limit(1);
  if (!capture || !capture.blobKey) {
    return new Response("Not found", { status: 404 });
  }
  if (capture.userId !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  const result = await get(capture.blobKey, { access: "private" });
  if (!result || result.statusCode !== 200) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(result.stream, {
    headers: { "Content-Type": result.blob.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
