import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { PipelineError, runPhotoCapturePipeline, runTextCapturePipeline } from "@/lib/pipeline/run";
import { ValidationError, isValidIanaZone } from "@calendar-auto/core";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** POST /api/captures (§6.5) — text (FR-3.2) and photo (FR-3.1); share/voice arrive in M5. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const timezoneRaw = formData.get("timezone");
    const timezone = typeof timezoneRaw === "string" && isValidIanaZone(timezoneRaw) ? timezoneRaw : undefined;

    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Expected a multipart 'file' field with an image" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image is too large (max 10MB)" }, { status: 413 });
    }

    try {
      const result = await runPhotoCapturePipeline(session.user.id, file, file.type, timezone);
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      return handlePipelineError(error);
    }
  }

  const body = await request.json().catch(() => null);
  if (!body || body.kind !== "text" || typeof body.sourceText !== "string" || !body.sourceText.trim()) {
    return NextResponse.json({ error: "Expected { kind: 'text', sourceText: string }" }, { status: 400 });
  }

  // NFR-9.3.4: relative dates and bare times resolve against the
  // capture-time zone. The client sends its detected IANA zone; a missing
  // or invalid value falls back to the user's stored timezone in the pipeline.
  const timezone = typeof body.timezone === "string" && isValidIanaZone(body.timezone) ? body.timezone : undefined;

  try {
    const result = await runTextCapturePipeline(session.user.id, body.sourceText, timezone);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handlePipelineError(error);
  }
}

function handlePipelineError(error: unknown) {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  }
  if (error instanceof PipelineError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error("Capture pipeline failed:", error);
  return NextResponse.json({ error: "Failed to parse this capture. Please try again." }, { status: 500 });
}
