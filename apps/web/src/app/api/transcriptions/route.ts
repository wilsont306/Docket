import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { TranscriptionError, transcribeAudio } from "@/lib/pipeline/transcribe";

/** Opus at the bitrate MediaRecorder picks runs ~30KB a minute, so this is minutes of headroom, not a real ceiling for a dictated sentence. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/transcriptions — multipart `file` (recorded audio) → { text }.
 *
 * Deliberately not part of POST /api/captures: that route's contract is
 * "a capture goes in, a draft comes out", and dictation doesn't create a
 * draft. It returns a transcript to the composer, which the user edits and
 * then sends through the normal text path -- so the draft is created by the
 * same code as a typed capture, and there's no second pipeline to keep in
 * step. It's a sibling of /api/captures rather than a child of it so a
 * static segment can't shadow the `captures/[id]` routes.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File) || !file.type.startsWith("audio/")) {
    return NextResponse.json({ error: "Expected a multipart 'file' field with audio" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "That recording is too long. Try again in a shorter take." }, { status: 413 });
  }
  // An empty blob is what a recorder that never captured anything produces
  // -- a muted mic, or a tap so short no frame was written.
  if (file.size === 0) {
    return NextResponse.json({ error: "That recording came through empty. Check your microphone and try again." }, { status: 400 });
  }

  try {
    const text = await transcribeAudio(new Uint8Array(await file.arrayBuffer()), request.signal);
    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof TranscriptionError) {
      // "No speech detected" is the one case the user can act on directly,
      // so it's passed through; anything else is a provider fault and gets
      // a message about the service rather than about their recording.
      const noSpeech = error.message === "No speech detected";
      return NextResponse.json(
        { error: noSpeech ? "We didn't catch any speech in that. Try again a bit closer to the mic." : "Couldn't transcribe that just now. You can type it instead." },
        { status: noSpeech ? 422 : 502 },
      );
    }
    console.error("Transcription route failed:", error);
    return NextResponse.json({ error: "Couldn't transcribe that just now. You can type it instead." }, { status: 500 });
  }
}
