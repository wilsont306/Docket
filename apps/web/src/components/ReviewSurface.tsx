"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { expandRecurrenceOccurrences } from "@calendar-auto/core";
import type { CalendarListEntry } from "@/lib/google-calendar";
import { computeConflictState } from "@/lib/conflicts";
import { DraftCard, type DraftEventRow } from "./DraftCard";
import { WeekCalendar, type DraftBlock } from "./WeekCalendar";
import { ImageSourceViewer } from "./ImageSourceViewer";
import { CalendarChecklist } from "./CalendarChecklist";
import { CalendarViewSwitcher } from "./CalendarViewSwitcher";
import { MonthGrid } from "./MonthGrid";
import { YearGrid } from "./YearGrid";
import { viewRange, shiftAnchor, viewLabel, type CalendarViewMode } from "@/lib/calendar-view";
import { useMountReveal } from "@/lib/use-mount-reveal";
import { useCalendarEvents } from "@/lib/use-calendar-events";

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
  initialCalendarId,
  source,
  onCommitted,
  onAddAnother,
}: {
  draftId: string;
  initialEvents: DraftEventRow[];
  initialCalendarId: string;
  source: CaptureSource | null;
  onCommitted: (result: CommitResult) => void;
  /** Back to the composer, but the next thing sent gets appended to *this* draft instead of starting a new one. */
  onAddAnother: () => void;
}) {
  const revealed = useMountReveal();
  const [events, setEvents] = useState(initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(initialEvents[0]?.id ?? null);
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);
  const [calendarId, setCalendarId] = useState(initialCalendarId);
  // "My calendars" visibility checklist (§4.6): which of the user's real
  // calendars contribute to the conflict/overlap display. Defaults to
  // everything checked once the list loads, same as Google Calendar itself.
  const [checkedCalendarIds, setCheckedCalendarIds] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [confirmingAnyway, setConfirmingAnyway] = useState(false);
  // Keyed by eventId. A failed field-save bumps its revision, forcing the
  // card's uncontrolled inputs to remount back to the true (unsaved-edit-
  // reverting) server value instead of silently keeping the user's stale,
  // never-actually-saved keystrokes on screen.
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [errorRevision, setErrorRevision] = useState<Record<string, number>>({});
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [sourceViewerOpen, setSourceViewerOpen] = useState(false);
  // Mobile only: a week doesn't fit a phone screen, so mobile shows one day
  // at a time (day-strip selector) with a calendar/list view toggle, instead
  // of the desktop split pane.
  const [selectedDayOffset, setSelectedDayOffset] = useState(0);
  const [mobileView, setMobileView] = useState<"calendar" | "list">("calendar");

  // §5.2 `calendar_target`: only offer a picker when there's actually a choice.
  useEffect(() => {
    fetch("/api/calendars")
      .then((res) => res.json())
      .then((data) => {
        const list: CalendarListEntry[] = data.calendars ?? [];
        setCalendars(list);
        setCheckedCalendarIds(new Set(list.map((c) => c.id)));
      });
  }, []);

  async function handleCalendarChange(newCalendarId: string) {
    setCalendarId(newCalendarId);
    await fetch(`/api/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId: newCalendarId }),
    });
  }

  function handleToggleCalendar(id: string) {
    setCheckedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleToggleAllCalendars(checked: boolean) {
    setCheckedCalendarIds(checked ? new Set(calendars.map((c) => c.id)) : new Set());
  }

  const selectedCalendarName = calendars.find((c) => c.id === calendarId)?.summary ?? calendarId;
  const writableCalendars = calendars.filter((c) => c.writable);
  const calendarColors = useMemo(() => Object.fromEntries(calendars.map((c) => [c.id, c.backgroundColor])), [calendars]);

  const timezone = events[0]?.event.timezone ?? "UTC";
  const liveEvents = events.filter((e) => !e.deleted);

  // The desktop pane's Day/Week/Month/Year switcher. `anchorOverride` is
  // null until the user navigates (prev/next, or clicking a day/month in
  // the Month/Year grid) -- until then, the default anchor tracks the
  // drafts' own earliest date, same as before this switcher existed.
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [anchorOverride, setAnchorOverride] = useState<DateTime | null>(null);
  const defaultAnchor = useMemo(() => {
    const starts = events
      .map((e) => e.event.startDateTime.value)
      .filter((v): v is string => v !== null)
      .map((v) => DateTime.fromISO(v, { zone: timezone }))
      .filter((dt) => dt.isValid);
    return (starts.length > 0 ? DateTime.min(...starts) : undefined) ?? DateTime.now().setZone(timezone);
  }, [events, timezone]);
  const anchor = anchorOverride ?? defaultAnchor;

  function handlePrev() {
    setAnchorOverride(shiftAnchor(viewMode, anchor, -1));
  }
  function handleNext() {
    setAnchorOverride(shiftAnchor(viewMode, anchor, 1));
  }
  /** Jumps back to today, in whichever view is currently showing. */
  function handleToday() {
    setAnchorOverride(DateTime.now());
  }
  /** From the Month/Year grid: jump straight to that day's Day view. */
  function handleJumpToDay(day: DateTime) {
    setAnchorOverride(day);
    setViewMode("day");
  }
  /** From the Year grid's month header: jump to that Month view. */
  function handleJumpToMonth(month: DateTime) {
    setAnchorOverride(month);
    setViewMode("month");
  }

  /**
   * Selecting a draft that falls outside the range currently on screen moves
   * the calendar to it. Without this, clicking a card for (say) a due date
   * five weeks out just highlighted a block nobody could see -- the pane sat
   * on whatever week the earliest draft happened to anchor it to. A draft
   * already visible leaves the anchor alone, so selecting one event in a week
   * doesn't re-center the view out from under the user; for a recurring
   * draft, any occurrence in view counts as visible.
   */
  function handleSelectDraft(id: string) {
    setSelectedId(id);
    const value = events.find((e) => e.id === id)?.event.startDateTime.value;
    if (!value) return;
    const start = DateTime.fromISO(value, { zone: timezone });
    if (!start.isValid) return;
    // Mobile's day strip is its own selection; keep it pointed at the same day.
    setSelectedDayOffset(start.weekday - 1);
    const visible = viewRange(viewMode, anchor);
    const onScreen = draftBlocks.some((b) => b.id === id && b.start < visible.end && b.end >= visible.start);
    if (!onScreen) setAnchorOverride(start);
  }

  // Mobile's day-strip is always a week regardless of the desktop switcher's
  // current mode -- a phone screen shows one day at a time either way, so
  // "Month"/"Year" have no separate mobile rendering to switch into.
  const weekDays = useMemo(() => {
    const start = anchor.startOf("week");
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  }, [anchor]);
  const selectedDay = weekDays[selectedDayOffset] ?? weekDays[0];

  // Real-events fetch and recurring-draft expansion both need enough range
  // to cover whichever is larger: the desktop switcher's current view, or
  // mobile's own week strip -- a "day" view still needs the full week
  // fetched since mobile's day-strip labels/data depend on it, and month/
  // year already fully contain any week within them.
  const rangeMode = viewMode === "day" ? "week" : viewMode;
  const fetchRange = useMemo(() => viewRange(rangeMode, anchor), [rangeMode, anchor]);

  // §6.3 stage 6 / FR-4.6.1: real calendar events for the visible range, used
  // for both the calendar pane and the overlap/duplicate check below. Merged
  // across every calendar checked in "My calendars" -- an empty checked set
  // before that list has loaded falls back to the server's "primary" default
  // rather than fetching nothing.
  //
  // Cached per range, with the ranges on either side warmed in the
  // background, so stepping through weeks doesn't wait on the network for
  // somewhere you've already been (or are about to go).
  const neighbourRanges = useMemo(
    () => [viewRange(rangeMode, shiftAnchor(rangeMode, anchor, -1)), viewRange(rangeMode, shiftAnchor(rangeMode, anchor, 1))],
    [rangeMode, anchor],
  );
  const { events: realEvents, loading: eventsLoading } = useCalendarEvents(checkedCalendarIds, fetchRange, neighbourRanges);

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
  }, [events, realEvents, draftId]);

  // Only fields actually missing a value count -- description isn't even
  // editable from the review surface, and a value the model was merely
  // unsure about (a short or unusual-looking title/location) is still a
  // value, not a gap the user needs to fill in.
  const fieldsToCheck = liveEvents.reduce((count, row) => {
    const fields = [row.event.title, row.event.startDateTime, row.event.endDateTime, row.event.location];
    return count + fields.filter((f) => f.value === null || f.value === "").length;
  }, 0);

  /**
   * One or several fields in a single request. Several at once is not just an
   * optimization: the server edits one JSON column per event, so two
   * concurrent single-field PATCHes (a date change rewriting both start and
   * end, or the all-day toggle rewriting three fields) would each read the
   * same row and overwrite the other's edit.
   */
  async function handleFieldChange(eventId: string, updates: Array<{ field: string; value: unknown }>) {
    try {
      const res = await fetch(`/api/drafts/${draftId}/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: updates }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error ?? "Failed to save");
      setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
      setSaveErrors((prev) => {
        const rest = { ...prev };
        delete rest[eventId];
        return rest;
      });
    } catch (error) {
      setSaveErrors((prev) => ({ ...prev, [eventId]: error instanceof Error ? error.message : "Failed to save" }));
      setErrorRevision((prev) => ({ ...prev, [eventId]: (prev[eventId] ?? 0) + 1 }));
    }
  }

  async function handleDeleteToggle(eventId: string, deleted: boolean) {
    try {
      const res = await fetch(`/api/drafts/${draftId}/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error ?? "Failed to save");
      setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
    } catch (error) {
      setSaveErrors((prev) => ({ ...prev, [eventId]: error instanceof Error ? error.message : "Failed to save" }));
      setErrorRevision((prev) => ({ ...prev, [eventId]: (prev[eventId] ?? 0) + 1 }));
    }
  }

  async function handleConfirm() {
    // FR-4.3.3/Error Prevention: unresolved low-confidence fields don't block
    // the commit (§5.3.3 -- questions are never blocking), but they do
    // require one explicit extra acknowledgment rather than sailing through
    // silently, since the 10s undo afterward is easy to miss.
    if (fieldsToCheck > 0 && !confirmingAnyway) {
      setConfirmingAnyway(true);
      return;
    }
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

    const duration = endDt.diff(startDt);
    const toBlock = (occStart: DateTime): DraftBlock => ({
      id: row.id,
      title: row.event.title.value ?? "(untitled)",
      start: occStart,
      end: occStart.plus(duration),
      allDay: row.event.isAllDay.value ?? false,
      lowConfidence: row.event.title.value === null || row.event.startDateTime.value === null,
      conflict: row.conflictState,
    });

    if (!row.event.recurrence) return [toBlock(startDt)];

    // Only the currently visible range's occurrences -- day/week/month/year
    // all use the same `fetchRange` the real-events fetch above already
    // computed, so there's no need to expand (or cap) an unbounded future
    // range. A weekly/daily rule only ever produces at most one occurrence
    // per calendar day, so reusing the same draft id for every occurrence
    // is safe -- exactly one instance of it exists in this array at a time,
    // keeping selection/highlight working the same as a non-recurring draft.
    const occurrences = expandRecurrenceOccurrences(row.event.recurrence.rrule, startDt, fetchRange.start, fetchRange.end);
    return occurrences.map(toBlock);
  });

  const showAcknowledgeGate = confirmingAnyway && fieldsToCheck > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`shrink-0 border-b border-[var(--rule)] bg-[var(--surf)] transition-all duration-500 ease-[cubic-bezier(.2,.6,.2,1)] ${
          revealed ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
      >
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4 lg:flex-row lg:items-end lg:justify-between lg:gap-5 lg:px-6 lg:py-5">
        <div>
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em] lg:text-[31px]">
            {liveEvents.length} {liveEvents.length === 1 ? "draft" : "drafts"}, ready to check
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12.5px] text-[var(--ink2)]">
            <span>{source?.kind === "photo" ? "photo capture" : source?.kind === "voice" ? "dictation" : "pasted text"}</span>
            <span className="h-3 w-px bg-[var(--rule)]" />
            <span>{weekDays[0].toFormat("MMM d")} – {weekDays[6].toFormat("MMM d")}</span>
            <span className="hidden h-3 w-px bg-[var(--rule)] sm:block" />
            <span className="hidden sm:inline">Read in {timezone}</span>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-3 lg:flex">
          <div
            className={`flex h-[38px] items-center gap-2 rounded-full px-4 text-[13px] font-medium ${
              fieldsToCheck > 0
                ? "border-[1.5px] border-[var(--acc)] bg-[var(--accWash)] text-[var(--accInk)]"
                : "border border-[var(--rule)] bg-[var(--surf)] text-[var(--ink2)]"
            }`}
          >
            <span className={`h-[7px] w-[7px] ${fieldsToCheck > 0 ? "bg-[var(--acc)]" : "bg-[var(--cool)]"}`} />
            {fieldsToCheck > 0 ? `${fieldsToCheck} field${fieldsToCheck === 1 ? "" : "s"} to check` : "every field checked"}
          </div>
          {writableCalendars.length > 1 && (
            <select
              value={calendarId}
              onChange={(e) => handleCalendarChange(e.target.value)}
              className="h-[38px] rounded-xl border border-[var(--rule)] bg-[var(--surf)] px-3 text-[13px] transition-colors hover:bg-[var(--sunk)]"
            >
              {writableCalendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.summary}
                </option>
              ))}
            </select>
          )}
          {writableCalendars.length <= 1 && (
            <div className="flex h-[38px] items-center gap-2 rounded-xl border border-[var(--rule)] bg-[var(--surf)] px-3 text-[13px]">
              <span className="h-[9px] w-[9px] bg-[var(--cool)]" />
              {selectedCalendarName}
            </div>
          )}
          {showAcknowledgeGate && (
            <button
              type="button"
              onClick={() => setConfirmingAnyway(false)}
              className="h-[38px] rounded-xl border border-[var(--rule)] px-4 text-[13px] text-[var(--ink2)] transition-colors hover:bg-[var(--sunk)]"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={committing || liveEvents.length === 0}
            className="h-[38px] rounded-xl bg-[var(--btn)] px-5 text-[13.5px] font-medium text-[var(--onBtn)] transition hover:brightness-95 active:brightness-90 disabled:pointer-events-none disabled:opacity-50"
          >
            {committing
              ? "Creating…"
              : showAcknowledgeGate
                ? `Create anyway with ${fieldsToCheck} unchecked field${fieldsToCheck === 1 ? "" : "s"}?`
                : `Confirm — create ${liveEvents.length} event${liveEvents.length === 1 ? "" : "s"} on ${selectedCalendarName}`}
          </button>
        </div>
      </div>
      </div>

      {commitError && <p className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700">{commitError}</p>}

      <div className="mx-auto hidden min-h-0 w-full max-w-[1440px] flex-1 lg:flex">
        <aside className="flex w-[378px] shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--sunk)]">
          {fieldsToCheck > 0 && (
            <div className="mx-4 mt-4 rounded-[14px] border-[1.5px] border-[var(--acc)] bg-[var(--accWash)] px-4 py-3">
              <div className="text-[13.5px] font-semibold leading-5 text-[var(--accInk)]">Some fields want a look.</div>
              <div className="mt-1.5 text-xs leading-5 text-[var(--ink2)]">Low-confidence or inferred details stay visible until you confirm them.</div>
            </div>
          )}
          <div className="flex shrink-0 items-baseline justify-between px-4 pb-2 pt-5">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-[var(--ink3)]">
              {liveEvents.length} proposed {liveEvents.length === 1 ? "event" : "events"}
            </div>
            <div className="flex gap-3 text-xs text-[var(--ink2)]">
              <span>Select all</span>
              <span>By day</span>
              <span>Shift ±</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-5">
            {events.map((row, index) => (
              <DraftCard
                key={`${row.id}:${errorRevision[row.id] ?? 0}`}
                row={row}
                index={index}
                saveError={saveErrors[row.id] ?? null}
                isSelected={row.id === selectedId}
                onSelect={() => handleSelectDraft(row.id)}
                onFieldChange={(updates) => handleFieldChange(row.id, updates)}
                onDeleteToggle={(deleted) => handleDeleteToggle(row.id, deleted)}
              />
            ))}
            <button
              type="button"
              onClick={onAddAnother}
              className="flex w-full items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-[var(--rule)] py-2.5 text-[12.5px] font-medium text-[var(--ink2)] transition-colors hover:border-[var(--acc)] hover:text-[var(--accInk)]"
            >
              <PlusIcon />
              Add another
            </button>
          </div>
          {source && (
            <div className="flex shrink-0 items-center gap-3 border-t border-[var(--rule)] bg-[var(--surf)] px-4 py-3">
              <SourceThumbnail />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px]">{source.kind === "photo" ? "photo capture" : source.kind === "voice" ? "dictation" : "pasted text"}</div>
                <div className="mt-1 text-[11.5px] text-[var(--ink3)]">deleted from our servers in 7 days</div>
              </div>
              {source.kind === "photo" ? (
                <button type="button" onClick={() => setPhotoViewerOpen(true)} className="text-[12.5px] font-medium text-[var(--accInk)] transition-opacity hover:opacity-70">
                  View
                </button>
              ) : source.sourceText ? (
                <button type="button" onClick={() => setSourceViewerOpen(true)} className="text-[12.5px] font-medium text-[var(--accInk)] transition-opacity hover:opacity-70">
                  View
                </button>
              ) : (
                <span className="text-[12.5px] text-[var(--ink3)]">View</span>
              )}
            </div>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-[var(--surf)]">
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--rule)] bg-[var(--sunk)] px-3 py-2">
            <div className="flex flex-1 items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleToday}
                className="h-8 rounded-full border border-[var(--rule)] bg-[var(--surf)] px-3 text-[12.5px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--rule2)]"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handlePrev}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--rule)] bg-[var(--surf)] text-[var(--ink)] transition-colors hover:bg-[var(--rule2)]"
                aria-label={`Previous ${viewMode}`}
              >
                <ChevronIcon direction="left" />
              </button>
              <span className="flex min-w-[130px] items-center justify-center gap-1.5 text-center text-[13.5px] font-semibold">
                {viewLabel(viewMode, anchor)}
                {/* Only for a range with nothing cached yet -- a background
                    revalidation of a range already on screen shouldn't blink
                    a spinner at anyone. */}
                {eventsLoading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--acc)]" title="Loading your calendar" />}
              </span>
              <button
                type="button"
                onClick={handleNext}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--rule)] bg-[var(--surf)] text-[var(--ink)] transition-colors hover:bg-[var(--rule2)]"
                aria-label={`Next ${viewMode}`}
              >
                <ChevronIcon direction="right" />
              </button>
            </div>
            <CalendarViewSwitcher value={viewMode} onChange={setViewMode} />
            <CalendarChecklist calendars={calendars} checkedIds={checkedCalendarIds} onToggle={handleToggleCalendar} onToggleAll={handleToggleAllCalendars} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {viewMode === "month" ? (
              <MonthGrid
                month={anchor}
                timezone={timezone}
                realEvents={realEvents}
                draftBlocks={draftBlocks}
                calendarColors={calendarColors}
                onSelectDay={handleJumpToDay}
              />
            ) : viewMode === "year" ? (
              <YearGrid
                year={anchor}
                timezone={timezone}
                realEvents={realEvents}
                draftBlocks={draftBlocks}
                onSelectDay={handleJumpToDay}
                onSelectMonth={handleJumpToMonth}
              />
            ) : (
              <WeekCalendar
                days={viewMode === "day" ? [anchor] : weekDays}
                timezone={timezone}
                realEvents={realEvents}
                calendarColors={calendarColors}
                draftBlocks={draftBlocks}
                selectedId={selectedId}
                onSelectDraft={handleSelectDraft}
              />
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-5 border-t border-[var(--rule)] px-4 py-2.5 text-[11.5px] text-[var(--ink2)]">
            <div className="flex items-center gap-1.5"><span className="h-[11px] w-[17px] rounded bg-[var(--coolWash)] ring-1 ring-[var(--coolEdge)]" />Already on Work</div>
            <div className="flex items-center gap-1.5"><span className="h-[11px] w-[17px] rounded border-[1.5px] border-dashed border-[var(--acc)] bg-[var(--accWash)]" />Proposed — not saved</div>
            <div className="flex items-center gap-1.5"><span className="h-[11px] w-[17px] rounded border-[1.5px] border-[var(--acc)] bg-[var(--surf)]" />Wants a look</div>
            <div className="flex items-center gap-1.5">
              <span
                className="h-[11px] w-[17px] rounded border-[1.5px] border-dashed border-[var(--acc)]"
                style={{ background: "color-mix(in oklch, var(--accWash) 62%, transparent)" }}
              />
              All day — claims the whole day
            </div>
            <div className="flex items-center gap-1.5"><span className="h-1 w-[17px] rounded bg-[var(--cool)]" />Overlaps something real</div>
          </div>
        </div>
      </div>

      {/* Mobile: a week doesn't fit a phone screen -- day strip + calendar/list toggle instead of the desktop split pane. */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="flex shrink-0 border-b border-[var(--rule)] bg-[var(--surf)] px-1 py-2">
          {weekDays.map((day, index) => {
            const dayLiveEvents = liveEvents.filter((row) => {
              const value = row.event.startDateTime.value;
              return value !== null && DateTime.fromISO(value, { zone: timezone }).hasSame(day, "day");
            });
            const isSelected = index === selectedDayOffset;
            return (
              <button
                key={day.toISODate()}
                type="button"
                onClick={() => setSelectedDayOffset(index)}
                className={`mx-0.5 flex-1 rounded-xl py-1.5 text-center transition-colors ${isSelected ? "bg-[var(--sunk)]" : "hover:bg-[var(--sunk)]"}`}
              >
                <div className="text-[9.5px] uppercase tracking-[0.08em] text-[var(--ink3)]">{day.toFormat("EEE")}</div>
                <div className={`mt-0.5 text-[15.5px] ${isSelected ? "font-bold" : "font-medium"}`}>{day.toFormat("d")}</div>
                <div className="mt-0.5 min-h-[12px] text-[9.5px] font-bold text-[var(--accInk)]">
                  {dayLiveEvents.length > 0 ? dayLiveEvents.length : ""}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 bg-[var(--sunk)] px-4 py-2">
          <div className="text-[13px] font-bold">{selectedDay.toFormat("EEEE, MMM d")}</div>
          <div className="flex items-center gap-3">
            {source?.kind === "photo" && (
              <button type="button" onClick={() => setPhotoViewerOpen(true)} className="text-[11.5px] font-medium text-[var(--accInk)] transition-opacity hover:opacity-70">
                View photo
              </button>
            )}
            {source && source.kind !== "photo" && source.sourceText && (
              <button type="button" onClick={() => setSourceViewerOpen(true)} className="text-[11.5px] font-medium text-[var(--accInk)] transition-opacity hover:opacity-70">
                View source
              </button>
            )}
            <div className="flex gap-0.5 rounded-full border border-[var(--rule)] bg-[var(--surf)] p-0.5">
              {(["calendar", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMobileView(v)}
                  className={`rounded-full px-3 py-1 text-[11.5px] font-medium capitalize transition-colors ${
                    mobileView === v ? "bg-[var(--sunk)] text-[var(--ink)]" : "text-[var(--ink2)] hover:bg-[var(--sunk)]"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            {mobileView === "calendar" && (
              <CalendarChecklist calendars={calendars} checkedIds={checkedCalendarIds} onToggle={handleToggleCalendar} onToggleAll={handleToggleAllCalendars} />
            )}
          </div>
        </div>

        {mobileView === "calendar" ? (
          <div className="flex min-h-0 flex-1 flex-col bg-[var(--sunk)] p-3">
            <div className="min-h-0 flex-1">
              <WeekCalendar
                days={[selectedDay]}
                timezone={timezone}
                realEvents={realEvents}
                calendarColors={calendarColors}
                draftBlocks={draftBlocks}
                selectedId={selectedId}
                onSelectDraft={handleSelectDraft}
              />
            </div>
            <div className="mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[var(--ink2)]">
              <div className="flex items-center gap-1.5"><span className="h-[11px] w-[17px] rounded bg-[var(--coolWash)] ring-1 ring-[var(--coolEdge)]" />Already on Work</div>
              <div className="flex items-center gap-1.5"><span className="h-[11px] w-[17px] rounded border-[1.5px] border-dashed border-[var(--acc)] bg-[var(--accWash)]" />Proposed</div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto bg-[var(--sunk)] p-3">
            {events
              .filter((row) => {
                const value = row.event.startDateTime.value;
                return value !== null && DateTime.fromISO(value, { zone: timezone }).hasSame(selectedDay, "day");
              })
              .map((row, index) => (
                <DraftCard
                  key={`${row.id}:${errorRevision[row.id] ?? 0}`}
                  row={row}
                  index={index}
                    saveError={saveErrors[row.id] ?? null}
                  isSelected={row.id === selectedId}
                  onSelect={() => handleSelectDraft(row.id)}
                  onFieldChange={(updates) => handleFieldChange(row.id, updates)}
                  onDeleteToggle={(deleted) => handleDeleteToggle(row.id, deleted)}
                />
              ))}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2.5 border-t border-[var(--rule)] bg-[var(--surf)] px-3 py-3">
          {writableCalendars.length > 1 ? (
            <select
              value={calendarId}
              onChange={(e) => handleCalendarChange(e.target.value)}
              className="h-[50px] shrink-0 rounded-xl border border-[var(--rule)] bg-transparent px-3 text-[13px] transition-colors hover:bg-[var(--sunk)]"
            >
              {writableCalendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.summary}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex h-[50px] shrink-0 items-center gap-2 rounded-xl border border-[var(--rule)] px-3 text-[13px]">
              <span className="h-[9px] w-[9px] rounded-sm bg-[var(--cool)]" />
              {selectedCalendarName}
            </div>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={committing || liveEvents.length === 0}
            className="h-[50px] flex-1 rounded-xl bg-[var(--btn)] text-[15px] font-bold text-[var(--onBtn)] transition hover:brightness-95 active:brightness-90 disabled:pointer-events-none disabled:opacity-50"
          >
            {committing
              ? "Creating…"
              : showAcknowledgeGate
                ? `Create anyway (${fieldsToCheck} unchecked)?`
                : `Confirm — ${liveEvents.length} event${liveEvents.length === 1 ? "" : "s"}`}
          </button>
        </div>
        {showAcknowledgeGate && (
          <button
            type="button"
            onClick={() => setConfirmingAnyway(false)}
            className="shrink-0 border-t border-[var(--rule)] bg-[var(--surf)] py-2 text-center text-[12.5px] text-[var(--ink2)] transition-colors hover:bg-[var(--sunk)]"
          >
            Cancel
          </button>
        )}
      </div>

      {source?.kind === "photo" && (
        <ImageSourceViewer
          captureId={source.captureId}
          open={photoViewerOpen}
          onClose={() => setPhotoViewerOpen(false)}
          boundingBox={(() => {
            const selected = events.find((e) => e.id === selectedId);
            const provenance = selected?.event.title.provenance;
            return provenance?.kind === "image" ? provenance.boundingBox : null;
          })()}
        />
      )}

      {source && source.kind !== "photo" && source.sourceText && (
        <TextSourceModal
          sourceText={source.sourceText}
          open={sourceViewerOpen}
          onClose={() => setSourceViewerOpen(false)}
          span={(() => {
            const selected = events.find((e) => e.id === selectedId);
            const field = selected && [selected.event.title, selected.event.location, selected.event.startDateTime, selected.event.endDateTime].find((f) => f.provenance?.kind === "text");
            return field?.provenance?.kind === "text" ? field.provenance.span : null;
          })()}
        />
      )}
    </div>
  );
}

function TextSourceModal({
  sourceText,
  span,
  open,
  onClose,
}: {
  sourceText: string;
  span: { start: number; end: number } | null;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 [animation:modal-backdrop-in_150ms_ease-out]" onClick={onClose}>
      <div
        className="relative max-h-full w-full max-w-2xl overflow-auto rounded-xl bg-[var(--surf)] p-5 [animation:modal-card-in_180ms_cubic-bezier(.2,.6,.2,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--sunk)] text-[var(--ink)] shadow transition-colors hover:bg-[var(--rule2)]"
          aria-label="Close"
        >
          ✕
        </button>
        <div className="text-[11px] uppercase tracking-[0.11em] text-[var(--ink3)]">Original text</div>
        <p className="mt-3 whitespace-pre-wrap pr-6 text-[13.5px] leading-6 text-[var(--ink)]">
          {span ? (
            <>
              {sourceText.slice(0, span.start)}
              <mark className="bg-[var(--accWash)] px-0.5 text-[var(--accInk)]">{sourceText.slice(span.start, span.end)}</mark>
              {sourceText.slice(span.end)}
            </>
          ) : (
            sourceText
          )}
        </p>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

function SourceThumbnail() {
  return (
    <svg width="48" height="38" viewBox="0 0 48 38" className="shrink-0" aria-hidden="true">
      <defs>
        <pattern id="review-src-stripe" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="var(--stripeA)" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--stripeB)" strokeWidth="2.5" />
        </pattern>
      </defs>
      <rect width="48" height="38" rx="7" fill="url(#review-src-stripe)" />
      <rect x="0.5" y="0.5" width="47" height="37" rx="6.5" fill="none" stroke="var(--rule)" />
    </svg>
  );
}
