import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { PipelineError, runTextCapturePipeline } from "@/lib/pipeline/run";
import { ValidationError, isValidIanaZone } from "@calendar-auto/core";

/** POST /api/captures (§6.5) — text only in M1; photo/share/voice arrive in M3/M5. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    }
    if (error instanceof PipelineError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Capture pipeline failed:", error);
    return NextResponse.json({ error: "Failed to parse this capture. Please try again." }, { status: 500 });
  }
}
