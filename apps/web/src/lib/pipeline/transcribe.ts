import { transcribe } from "ai";
import { gateway } from "@ai-sdk/gateway";

/**
 * Speech-to-text for the composer's dictate button (FR-3.3).
 *
 * Extraction runs Claude (see `extract.ts`), but Claude has no
 * speech-to-text, so this is the one stage that can't reuse that provider.
 * It goes through the AI Gateway instead of a direct provider SDK, which
 * keeps it to zero new dependencies -- `@ai-sdk/gateway` is already here for
 * the extraction fallback -- and authenticates off VERCEL_OIDC_TOKEN
 * locally and the deployment's own identity on Vercel, so there's no third
 * API key to hold.
 *
 * gpt-4o-mini-transcribe rather than whisper-1: dictated captures are short
 * and dense with exactly the tokens whisper is weakest on -- proper names
 * and spoken dates ("the 14th at 3", "Dr. Patel") -- and it's the cheaper of
 * the two per minute.
 */
export const TRANSCRIPTION_MODEL_ID = "openai/gpt-4o-mini-transcribe";

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

/**
 * Returns what the user said, trimmed, or throws TranscriptionError.
 *
 * The transcript is deliberately handed straight back to the composer
 * instead of being piped on into extraction: §4.2's dictation flow is
 * "say it, then read it before it's sent", because a mis-heard time is much
 * easier to spot as text than as a wrong event on the review screen.
 */
export async function transcribeAudio(audio: Uint8Array, signal?: AbortSignal): Promise<string> {
  let result;
  try {
    result = await transcribe({
      model: gateway.transcription(TRANSCRIPTION_MODEL_ID),
      audio,
      abortSignal: signal,
    });
  } catch (error) {
    // The provider's own message ("unsupported file format", a gateway
    // balance problem) is more useful to a caller than a generic failure,
    // but it isn't safe to show a user verbatim, so it's logged here and
    // the route decides what to say.
    console.error("Transcription failed:", error);
    throw new TranscriptionError(error instanceof Error ? error.message : "Transcription failed");
  }

  const text = result.text.trim();
  if (!text) {
    throw new TranscriptionError("No speech detected");
  }
  return text;
}
