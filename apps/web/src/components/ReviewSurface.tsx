"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { CalendarEvent } from "@/lib/google-calendar";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/confidence";
import { computeConflictState } from "@/lib/conflicts";
import { DraftCard, type DraftEventRow } from "./DraftCard";
import { WeekCalendar, type DraftBlock } from "./WeekCalendar";
import { ImageSourceViewer } from "./ImageSourceViewer";

interface CommitResult {
  id: string;
  googleEventIds: string[];
  failures: Array<{ error: string }>;
}

export interface CaptureSource {
  captureId: string;
  kind: "text" | "photo" | "share" | "voice";
  sourceText: string | null;
}

/**
 * §4: "the center of gravity of the product." Split pane -- draft cards on
 * the left, the real Google Calendar week view with ghost blocks on the
 * right, linked by a shared selection (FR-4.1.4). Drag-to-move/resize ghost
 * blocks and the mobile bottom-sheet layout are deferred past this pass;
 * click-based selection plus the card's own inputs cover the same edits.
 */
export function ReviewSurface({
  draftId,
  initialEvents,
  source,
  onCommitted,
}: {
  draftId: string;
  initialEvents: DraftEventRow[];
  source: CaptureSource | null;
  onCommitted: (result: CommitResult) => void;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(initialEvents[0]?.id ?? null);
  const [realEvents, setRealEvents] = useState<CalendarEvent[]>([]);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const timezone = events[0]?.event.timezone ?? "UTC";
  const liveEvents = events.filter((e) => !e.deleted);

  const weekStart = useMemo(() => {
    const starts = events
      .map((e) => e.event.startDateTime.value)
      .filter((v): v is string => v !== null)
      .map((v) => DateTime.fromISO(v, { zone: timezone }))
      .filter((dt) => dt.isValid);
    const earliest = (starts.length > 0 ? DateTime.min(...starts) : undefined) ?? DateTime.now().setZone(timezone);
    return earliest.startOf("week");
  }, [events, timezone]);

  // §6.3 stage 6 / FR-4.6.1: real calendar events for the visible week, used
  // for both the calendar pane and the overlap/duplicate check below.
  useEffect(() => {
    let cancelled = false;
    const timeMin = weekStart.toUTC().toISO()!;
    const timeMax = weekStart.plus({ weeks: 1 }).toUTC().toISO()!;
    fetch(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setRealEvents(data.events ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  useEffect(() => {
    if (realEvents.length === 0) return;
    for (const row of events) {
      if (row.deleted) continue;
      const computed = computeConflictState(row.event, realEvents);
      if (computed === row.conflictState) continue;
      fetch(`/api/drafts/${draftId}/events/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflictState: computed }),
      })
        .then((res) => res.json())
        .then((updated) => setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e))));
    }
    // Recompute when either side changes; the equality guard above stops this from looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, realEvents, draftId]);

  const fieldsToCheck = liveEvents.reduce((count, row) => {
    const fields = [row.event.title, row.event.startDateTime, row.event.endDateTime, row.event.location, row.event.description];
    return count + fields.filter((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD).length;
  }, 0);

  async function handleFieldChange(eventId: string, field: string, value: unknown) {
    const res = await fetch(`/api/drafts/${draftId}/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    const updated = await res.json();
    if (res.ok) setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
  }

  async function handleDeleteToggle(eventId: string, deleted: boolean) {
    const res = await fetch(`/api/drafts/${draftId}/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleted }),
    });
    const updated = await res.json();
    if (res.ok) setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
  }

  async function handleConfirm() {
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}/commit`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to commit");
      onCommitted(result);
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "Something went wrong");
      setCommitting(false);
    }
  }

  const draftBlocks: DraftBlock[] = liveEvents.flatMap((row) => {
    const start = row.event.startDateTime.value;
    const end = row.event.endDateTime.value;
    if (!start || !end) return [];
    const startDt = DateTime.fromISO(start, { zone: timezone });
    const endDt = DateTime.fromISO(end, { zone: timezone });
    if (!startDt.isValid || !endDt.isValid) return [];
    return [
      {
        id: row.id,
        title: row.event.title.value ?? "(untitled)",
        start: startDt,
        end: endDt,
        allDay: row.event.isAllDay.value ?? false,
        lowConfidence: row.event.title.confidence < LOW_CONFIDENCE_THRESHOLD || row.event.startDateTime.confidence < LOW_CONFIDENCE_THRESHOLD,
        conflict: row.conflictState,
      },
    ];
  });

  return (
    <div className="flex w-full max-w-6xl flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          {fieldsToCheck > 0 ? `${fieldsToCheck} field${fieldsToCheck === 1 ? "" : "s"} to check` : "Everything looks good"}
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={committing || liveEvents.length === 0}
          className="rounded bg-zinc-800 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {committing ? "Creating…" : `Confirm — create ${liveEvents.length} event${liveEvents.length === 1 ? "" : "s"}`}
        </button>
      </div>
      {commitError && <p className="text-sm text-red-500">{commitError}</p>}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex flex-col gap-2 lg:w-80 lg:shrink-0">
          {events.map((row) => (
            <DraftCard
              key={row.id}
              row={row}
              sourceText={source?.kind === "text" ? source.sourceText : null}
              isSelected={row.id === selectedId}
              onSelect={() => setSelectedId(row.id)}
              onFieldChange={(field, value) => handleFieldChange(row.id, field, value)}
              onDeleteToggle={(deleted) => handleDeleteToggle(row.id, deleted)}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto rounded border border-zinc-800">
          <WeekCalendar
            weekStart={weekStart}
            timezone={timezone}
            realEvents={realEvents}
            draftBlocks={draftBlocks}
            selectedId={selectedId}
            onSelectDraft={setSelectedId}
          />
        </div>
      </div>

      {source?.kind === "photo" && (
        <ImageSourceViewer
          captureId={source.captureId}
          boundingBox={(() => {
            const selected = events.find((e) => e.id === selectedId);
            const provenance = selected?.event.title.provenance;
            return provenance?.kind === "image" ? provenance.boundingBox : null;
          })()}
        />
      )}
    </div>
  );
}
