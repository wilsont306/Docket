"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";

interface CommitHistoryEntry {
  id: string;
  calendarId: string;
  committedAt: string;
  revertedAt: string | null;
  sourceKind: "photo" | "text" | "share" | "voice";
  events: Array<{ title: string; start: string | null }>;
}

const SOURCE_LABEL: Record<CommitHistoryEntry["sourceKind"], string> = {
  photo: "Photo",
  text: "Text",
  share: "Shared screenshot",
  voice: "Dictation",
};

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** §4.8 History: everything actually committed to Google Calendar, newest first, each revertible. */
export function CommitHistoryView({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<CommitHistoryEntry[] | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/commits");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load history");
        setEntries(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load history");
      }
    })();
  }, []);

  async function handleRevert(id: string) {
    setRevertingId(id);
    try {
      const res = await fetch(`/api/commits/${id}/revert`, { method: "POST" });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error ?? "Failed to revert");
      setEntries((prev) => prev?.map((e) => (e.id === id ? { ...e, revertedAt: updated.revertedAt } : e)) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revert");
    } finally {
      setRevertingId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full min-h-0 max-w-[820px] flex-1 flex-col overflow-hidden px-5 py-6 lg:px-10 lg:py-8">
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--rule)] transition-colors hover:bg-[var(--sunk)]"
          aria-label="Back"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <h1 className="text-[20px] font-bold tracking-[-0.02em]">History</h1>
      </div>
      <p className="mt-1.5 pl-11 text-[13px] text-[var(--ink2)]">Everything that&rsquo;s actually been created on your calendar.</p>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-5 min-h-0 flex-1 overflow-auto">
        {entries === null ? (
          <p className="text-[13px] text-[var(--ink3)]">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-[13px] text-[var(--ink3)]">Nothing confirmed yet.</p>
        ) : (
          <div className="flex flex-col gap-2.5 pb-4">
            {entries.map((entry) => {
              const committed = DateTime.fromISO(entry.committedAt);
              return (
                <div key={entry.id} className="rounded-[14px] border border-[var(--rule)] bg-[var(--surf)] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[12px] text-[var(--ink2)]">
                      <span className="font-mono">{committed.isValid ? committed.toFormat("MMM d, yyyy · h:mm a") : "—"}</span>
                      <span className="rounded-full bg-[var(--coolWash)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--coolInk)]">
                        {SOURCE_LABEL[entry.sourceKind]}
                      </span>
                    </div>
                    {entry.revertedAt ? (
                      <span className="text-[11.5px] font-medium text-[var(--ink3)]">Reverted</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleRevert(entry.id)}
                        disabled={revertingId === entry.id}
                        className="rounded-lg border border-[var(--rule)] px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                      >
                        {revertingId === entry.id ? "Reverting…" : "Revert"}
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {entry.events.map((event, i) => {
                      const start = event.start ? DateTime.fromISO(event.start) : null;
                      return (
                        <div key={i} className="flex items-baseline gap-2 text-[13.5px]">
                          <span className={entry.revertedAt ? "text-[var(--ink3)] line-through" : "text-[var(--ink)]"}>{event.title}</span>
                          {start?.isValid && <span className="text-[11.5px] text-[var(--ink3)]">{start.toFormat("EEE MMM d, h:mm a")}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
