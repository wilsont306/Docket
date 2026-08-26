"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import type { ParsedEvent } from "@calendar-auto/core";

interface DraftEventRow {
  id: string;
  draftId: string;
  event: ParsedEvent;
}

interface CommitResult {
  id: string;
  googleEventIds: string[];
  failures: Array<{ error: string }>;
}

type Phase =
  | { name: "capture" }
  | { name: "loading" }
  | { name: "review"; draftId: string; events: DraftEventRow[] }
  | { name: "committed"; result: CommitResult; secondsLeft: number }
  | { name: "error"; message: string };

function toLocalInputValue(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { zone: timezone });
  return dt.isValid ? dt.toFormat("yyyy-LL-dd'T'HH:mm") : "";
}

function fromLocalInputValue(local: string, timezone: string): string | null {
  const dt = DateTime.fromFormat(local, "yyyy-LL-dd'T'HH:mm", { zone: timezone });
  return dt.isValid ? dt.toISO({ suppressMilliseconds: true }) : null;
}

/**
 * M1's "minimal confirm" (§11 M1 exit criterion: pasted text becomes a
 * correct event). This is deliberately not the split-pane review surface
 * from §4 -- ghost blocks, conflict detection, and the full clarifying-
 * question UI are M2 scope. What's here is the smallest loop that proves
 * the pipeline end to end: paste text, see the parsed draft, edit the
 * fields that matter, confirm, and get a real undo window.
 */
export function CaptureFlow() {
  const [phase, setPhase] = useState<Phase>({ name: "capture" });
  const [sourceText, setSourceText] = useState("");

  async function handleParse() {
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

      const draftRes = await fetch(`/api/drafts/${data.draftId}`);
      const draft = await draftRes.json();
      if (!draftRes.ok) throw new Error(draft.error ?? "Failed to load draft");

      setPhase({ name: "review", draftId: data.draftId, events: draft.events });
    } catch (error) {
      setPhase({ name: "error", message: error instanceof Error ? error.message : "Something went wrong" });
    }
  }

  async function handleFieldChange(draftId: string, eventId: string, field: string, value: unknown) {
    if (phase.name !== "review") return;
    const res = await fetch(`/api/drafts/${draftId}/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    const updated = await res.json();
    if (!res.ok) return;
    setPhase({
      ...phase,
      events: phase.events.map((e) => (e.id === eventId ? updated : e)),
    });
  }

  async function handleConfirm() {
    if (phase.name !== "review") return;
    const draftId = phase.draftId;
    setPhase({ name: "loading" });
    try {
      const res = await fetch(`/api/drafts/${draftId}/commit`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to commit");

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
    } catch (error) {
      setPhase({ name: "error", message: error instanceof Error ? error.message : "Something went wrong" });
    }
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
          onClick={handleParse}
          disabled={phase.name === "loading" || !sourceText.trim()}
          className="rounded bg-zinc-800 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {phase.name === "loading" ? "Parsing…" : "Parse"}
        </button>
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
      <div className="flex w-full max-w-md flex-col gap-3">
        {phase.events.map((row) => (
          <EventCard
            key={row.id}
            row={row}
            onFieldChange={(field, value) => handleFieldChange(row.draftId, row.id, field, value)}
          />
        ))}
        <button type="button" onClick={handleConfirm} className="rounded bg-zinc-800 px-4 py-2 text-sm text-white">
          Confirm — create {phase.events.length} event{phase.events.length === 1 ? "" : "s"}
        </button>
      </div>
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

function EventCard({ row, onFieldChange }: { row: DraftEventRow; onFieldChange: (field: string, value: unknown) => void }) {
  const { event } = row;
  const timezone = event.timezone;

  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-700 p-3 text-sm">
      <input
        className="bg-transparent font-medium outline-none"
        defaultValue={event.title.value ?? ""}
        placeholder="(untitled)"
        onBlur={(e) => onFieldChange("title", e.target.value || null)}
      />
      <div className="flex gap-2 text-zinc-400">
        <input
          type="datetime-local"
          className="bg-transparent outline-none"
          defaultValue={toLocalInputValue(event.startDateTime.value, timezone)}
          onBlur={(e) => onFieldChange("startDateTime", fromLocalInputValue(e.target.value, timezone))}
        />
        <span>to</span>
        <input
          type="datetime-local"
          className="bg-transparent outline-none"
          defaultValue={toLocalInputValue(event.endDateTime.value, timezone)}
          onBlur={(e) => onFieldChange("endDateTime", fromLocalInputValue(e.target.value, timezone))}
        />
        {event.endDateTime.inferred && <span className="text-xs italic">(inferred)</span>}
      </div>
      <input
        className="bg-transparent text-zinc-400 outline-none"
        placeholder="Location"
        defaultValue={event.location.value ?? ""}
        onBlur={(e) => onFieldChange("location", e.target.value || null)}
      />
    </div>
  );
}
