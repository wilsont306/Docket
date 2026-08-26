"use client";

import { useRef, useState } from "react";
import { ReviewSurface, type CaptureSource } from "./ReviewSurface";
import type { DraftEventRow } from "./DraftCard";
import { preprocessImage } from "@/lib/image-preprocess";

interface CommitResult {
  id: string;
  googleEventIds: string[];
  failures: Array<{ error: string }>;
}

type Phase =
  | { name: "capture" }
  | { name: "loading" }
  | { name: "review"; draftId: string; events: DraftEventRow[]; source: CaptureSource | null }
  | { name: "committed"; result: CommitResult; secondsLeft: number }
  | { name: "error"; message: string };

/**
 * §11 M2/M3 exit criteria: "Full review loop on web" and "Roster photo ->
 * correct batch." Owns the capture -> review -> commit state machine across
 * both input paths; the review step itself is ReviewSurface.
 */
export function CaptureFlow() {
  const [phase, setPhase] = useState<Phase>({ name: "capture" });
  const [sourceText, setSourceText] = useState("");
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  async function loadDraft(draftId: string) {
    const draftRes = await fetch(`/api/drafts/${draftId}`);
    const draft = await draftRes.json();
    if (!draftRes.ok) throw new Error(draft.error ?? "Failed to load draft");
    setPhase({ name: "review", draftId, events: draft.events, source: draft.source ?? null });
  }

  async function handleParseText() {
    if (!sourceText.trim()) return;
    setPhase({ name: "loading" });
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "text", sourceText, timezone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse");
      await loadDraft(data.draftId);
    } catch (error) {
      setPhase({ name: "error", message: error instanceof Error ? error.message : "Something went wrong" });
    }
  }

  async function handlePhotoSelected(file: File | undefined) {
    if (!file) return;
    setPhase({ name: "loading" });
    try {
      const processed = await preprocessImage(file);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const formData = new FormData();
      formData.set("file", processed, "capture.jpg");
      formData.set("timezone", timezone);

      const res = await fetch("/api/captures", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse");
      await loadDraft(data.draftId);
    } catch (error) {
      setPhase({ name: "error", message: error instanceof Error ? error.message : "Something went wrong" });
    }
  }

  function handleCommitted(result: CommitResult) {
    setPhase({ name: "committed", result, secondsLeft: 10 });
    const interval = setInterval(() => {
      setPhase((prev) => {
        if (prev.name !== "committed") {
          clearInterval(interval);
          return prev;
        }
        if (prev.secondsLeft <= 1) {
          clearInterval(interval);
          return { ...prev, secondsLeft: 0 };
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
  }

  async function handleUndo() {
    if (phase.name !== "committed") return;
    await fetch(`/api/commits/${phase.result.id}/revert`, { method: "POST" });
    setPhase({ name: "capture" });
    setSourceText("");
  }

  if (phase.name === "capture" || phase.name === "loading") {
    return (
      <div className="flex w-full max-w-md flex-col gap-2">
        <textarea
          className="w-full rounded border border-zinc-700 bg-transparent p-2 text-sm"
          rows={4}
          placeholder='Paste text, e.g. "lunch with Sam next Thursday at 1"'
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          disabled={phase.name === "loading"}
        />
        <button
          type="button"
          onClick={handleParseText}
          disabled={phase.name === "loading" || !sourceText.trim()}
          className="rounded bg-zinc-800 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {phase.name === "loading" ? "Parsing…" : "Parse text"}
        </button>

        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <div className="h-px flex-1 bg-zinc-800" />
          or
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        <div className="flex gap-2">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handlePhotoSelected(e.target.files?.[0])}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handlePhotoSelected(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={phase.name === "loading"}
            className="flex-1 rounded border border-zinc-700 px-4 py-2 text-sm disabled:opacity-50"
          >
            Take photo
          </button>
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            disabled={phase.name === "loading"}
            className="flex-1 rounded border border-zinc-700 px-4 py-2 text-sm disabled:opacity-50"
          >
            Choose photo
          </button>
        </div>
        {phase.name === "loading" && <p className="text-xs text-zinc-500">Parsing…</p>}
      </div>
    );
  }

  if (phase.name === "error") {
    return (
      <div className="flex w-full max-w-md flex-col gap-2">
        <p className="text-sm text-red-500">{phase.message}</p>
        <button type="button" onClick={() => setPhase({ name: "capture" })} className="text-xs underline">
          Try again
        </button>
      </div>
    );
  }

  if (phase.name === "review") {
    return (
      <ReviewSurface
        draftId={phase.draftId}
        initialEvents={phase.events}
        source={phase.source}
        onCommitted={handleCommitted}
      />
    );
  }

  // committed
  const failed = phase.result.failures.length;
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <p className="text-sm text-zinc-500">
        Created {phase.result.googleEventIds.length} event{phase.result.googleEventIds.length === 1 ? "" : "s"}
        {failed > 0 ? ` (${failed} failed)` : ""} on your calendar.
      </p>
      {phase.secondsLeft > 0 ? (
        <button type="button" onClick={handleUndo} className="text-xs underline">
          Undo ({phase.secondsLeft}s)
        </button>
      ) : (
        <button type="button" onClick={() => setPhase({ name: "capture" })} className="text-xs underline">
          Parse another
        </button>
      )}
    </div>
  );
}
