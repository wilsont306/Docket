import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { captures, users } from "@/db/schema";
import { EXTRACTION_MODEL_ID, extractEventsFromText } from "./extract";
import { VISION_MODEL_ID, extractEventsFromImage } from "./extractImage";
import { resolveEvent } from "./resolve";
import { persistDraft } from "./persist";

const TEXT_PROMPT_VERSION = "text-v1";
const IMAGE_PROMPT_VERSION = "image-v1";

export class PipelineError extends Error {}

async function resolveUserTimezone(userId: string, clientTimezone: string | undefined) {
  const db = getDb();
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new PipelineError("Unknown user");

  const timezone = clientTimezone ?? user.timezone;
  if (clientTimezone && clientTimezone !== user.timezone) {
    await db.update(users).set({ timezone: clientTimezone }).where(eq(users.id, userId));
  }
  return timezone;
}

/**
 * Pipeline stages 1-7 (§6.3) for the text input path (FR-3.2). Synchronous
 * end to end: text parse's own NFR target (<8s p95, NFR-9.1.2) is short
 * enough not to need the SSE progress-streaming machinery §6.5 calls for on
 * the image path — that's the photo pipeline below, which does stream.
 *
 * Stage 3 (input rails) always fails open here because NeMo Guardrails
 * isn't deployed until M6 (§7.4) — every parse_run is recorded as
 * unscreened rather than silently treated as screened.
 */
export async function runTextCapturePipeline(userId: string, sourceText: string, clientTimezone?: string) {
  const db = getDb();
  const timezone = await resolveUserTimezone(userId, clientTimezone);

  const [capture] = await db
    .insert(captures)
    .values({ userId, kind: "text", sourceText, status: "parsing" })
    .returning();

  try {
    const now = new Date();
    const extracted = await extractEventsFromText(sourceText, { timezone, now });
    const resolved = extracted.map(resolveEvent);
    const result = await persistDraft(capture.id, EXTRACTION_MODEL_ID, TEXT_PROMPT_VERSION, resolved, now);
    await db.update(captures).set({ status: "ready" }).where(eq(captures.id, capture.id));
    return result;
  } catch (error) {
    await db.update(captures).set({ status: "error" }).where(eq(captures.id, capture.id));
    throw error;
  }
}

/** Pipeline stages 1-7 (§6.3) for the photo input path (FR-3.1). */
export async function runPhotoCapturePipeline(
  userId: string,
  imageBlob: Blob,
  mediaType: string,
  clientTimezone?: string,
) {
  const db = getDb();
  const timezone = await resolveUserTimezone(userId, clientTimezone);

  const uploaded = await put(`captures/${userId}/${crypto.randomUUID()}`, imageBlob, {
    access: "private",
    contentType: mediaType,
  });

  const [capture] = await db
    .insert(captures)
    .values({ userId, kind: "photo", blobKey: uploaded.url, status: "parsing" })
    .returning();

  try {
    const now = new Date();
    const imageBuffer = Buffer.from(await imageBlob.arrayBuffer());
    const extracted = await extractEventsFromImage(imageBuffer.toString("base64"), mediaType, { timezone, now });
    const resolved = extracted.map(resolveEvent);
    const result = await persistDraft(capture.id, VISION_MODEL_ID, IMAGE_PROMPT_VERSION, resolved, now);
    await db.update(captures).set({ status: "ready" }).where(eq(captures.id, capture.id));
    return result;
  } catch (error) {
    await db.update(captures).set({ status: "error" }).where(eq(captures.id, capture.id));
    throw error;
  }
}
