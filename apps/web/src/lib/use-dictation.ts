"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hard stop on a take. Long enough for anyone describing an appointment out
 * loud, short enough that a mic left running by accident (a tab backgrounded
 * mid-recording, say) can't quietly upload minutes of room audio.
 */
export const MAX_RECORDING_SECONDS = 120;

/** Below this, the user almost certainly tapped the button twice rather than said anything. */
const MIN_RECORDING_MS = 400;

export type DictationStatus = "idle" | "requesting" | "recording" | "transcribing";

/**
 * MediaRecorder's container support splits cleanly by engine: Chrome and
 * Firefox give WebM/Opus, Safari only MP4/AAC. Both are formats the
 * transcription model accepts, so the fix is to ask for what this browser
 * actually has rather than to force one and get an empty blob on the other.
 */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/** getUserMedia rejects with DOMExceptions whose names are the only stable part -- messages vary by browser and aren't user-facing prose. */
function permissionMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked. Allow it for this site in your browser settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found. Plug one in or type it instead.";
    case "NotReadableError":
      return "Your microphone is in use by another app. Close that app and try again.";
    default:
      return "Couldn't start recording. You can type it instead.";
  }
}

/**
 * Records a dictated capture and returns its transcript (FR-3.3).
 *
 * The recorder, its stream and the upload are all owned here rather than by
 * the composer, because every one of them has to be torn down on unmount --
 * a MediaStream track left live keeps the browser's recording indicator on
 * after the user has navigated away, which reads as the app still listening.
 *
 * `onTranscript` is called with the finished text instead of it being
 * returned as state: the composer appends it to whatever's already typed,
 * and that's an action, not a value to render.
 */
export function useDictation(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Set when the user cancels, so the recorder's stop handler knows to bin
  // the audio instead of uploading it.
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);

  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const releaseStream = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      abortRef.current?.abort();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseStream();
    };
  }, [releaseStream]);

  // Elapsed time is derived from a timestamp rather than counted up, so a
  // throttled background tab can't make the displayed take shorter than the
  // audio actually is.
  useEffect(() => {
    if (status !== "recording") return;
    const tick = () => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [status]);

  const upload = useCallback(
    async (blob: Blob) => {
      setStatus("transcribing");
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const body = new FormData();
        // A filename is required for the multipart part to carry a type the
        // server can check; the extension just mirrors the container.
        const extension = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
        body.append("file", blob, `dictation.${extension}`);

        const res = await fetch("/api/transcriptions", { method: "POST", body, signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Couldn't transcribe that just now.");
        if (!mountedRef.current) return;
        onTranscript(data.text as string);
        setStatus("idle");
      } catch (uploadError) {
        if (!mountedRef.current || controller.signal.aborted) return;
        setError(uploadError instanceof Error ? uploadError.message : "Couldn't transcribe that just now.");
        setStatus("idle");
      } finally {
        abortRef.current = null;
      }
    },
    [onTranscript],
  );

  const start = useCallback(async () => {
    if (!supported) {
      setError("This browser can't record audio. You can type it instead.");
      return;
    }
    setError(null);
    setStatus("requesting");
    cancelledRef.current = false;

    let stream: MediaStream;
    try {
      // Browser-side cleanup costs nothing here and measurably helps the
      // model on phone mics in a room with anyone else talking.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (permissionError) {
      if (!mountedRef.current) return;
      setError(permissionMessage(permissionError));
      setStatus("idle");
      return;
    }

    // Permission dialogs are modal and slow; the user may well have left by
    // the time one is answered.
    if (!mountedRef.current || cancelledRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      const tooShort = Date.now() - startedAtRef.current < MIN_RECORDING_MS;
      releaseStream();

      if (cancelledRef.current || !mountedRef.current) return;
      if (tooShort || chunks.length === 0) {
        setError("That was too short to hear. Hold the mic while you talk.");
        setStatus("idle");
        return;
      }
      void upload(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
    };

    recorder.onerror = () => {
      releaseStream();
      if (!mountedRef.current) return;
      setError("Recording stopped unexpectedly. You can type it instead.");
      setStatus("idle");
    };

    startedAtRef.current = Date.now();
    setSeconds(0);
    // A timeslice means chunks land as the take runs, so a browser that
    // tears the stream down (a phone locking) still leaves usable audio.
    recorder.start(1000);
    setStatus("recording");
  }, [releaseStream, supported, upload]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    releaseStream();
    setStatus("idle");
    setSeconds(0);
  }, [releaseStream]);

  // The cap is enforced from the same clock the UI counts on, so it fires at
  // the second the user watched tick over rather than a timer's own drift.
  useEffect(() => {
    if (status !== "recording" || seconds < MAX_RECORDING_SECONDS) return;
    stop();
  }, [seconds, status, stop]);

  const toggle = useCallback(() => {
    if (status === "recording") stop();
    else if (status === "idle") void start();
  }, [start, status, stop]);

  return {
    status,
    error,
    seconds,
    supported,
    toggle,
    cancel,
    dismissError: useCallback(() => setError(null), []),
  };
}

/** Everything the composer needs to render and drive the mic button. */
export type DictationControls = ReturnType<typeof useDictation>;
