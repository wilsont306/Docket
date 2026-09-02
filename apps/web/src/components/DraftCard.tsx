"use client";

import type { ReactNode } from "react";
import { DateTime } from "luxon";
import { buildRecurrence, type Field, type ParsedEvent, type Recurrence, type RecurrenceDay } from "@calendar-auto/core";
import { fifteenMinuteTimeOptions, toDateInputValue, toTimeOptionValue, withDate, withTimeOfDay } from "@/lib/datetime-input";
import { useMountReveal } from "@/lib/use-mount-reveal";

const WEEKDAYS: RecurrenceDay[] = ["MO", "TU", "WE", "TH", "FR"];

type RecurrencePreset = "none" | "daily" | "weekly" | "weekdays" | "custom";

/**
 * §12.5: recurrence is always shown for review regardless of confidence, so
 * every existing value -- extracted or user-picked -- has to map back onto
 * one of these presets (or "custom") for the dropdown to reflect it
 * correctly. Comparing built RRULE strings rather than re-parsing avoids
 * needing a second code path that decodes RRULE syntax. "weekly" omits an
 * explicit BYDAY on both sides of the comparison -- RFC 5545 already
 * defaults a day-less WEEKLY rule to DTSTART's own weekday, so adding an
 * explicit day here would just be a second, easy-to-drift way of saying
 * the same thing.
 *
 * Deliberately not a preset here: anything with its own specific weekday
 * set (e.g. "every Tuesday and Thursday", "MWF" as 3 of the 5 weekdays), an
 * interval on top of a frequency ("every other day", "every other Friday",
 * "quarterly"), or a bare monthly/yearly pattern. These all still extract,
 * save, and expand on the calendar correctly via `buildRecurrence` -- they
 * just show up as "custom" (read-only) here rather than as a preset you
 * could reconstruct by hand, since the space of intervals x weekday subsets
 * is open-ended and doesn't fit a short dropdown.
 */
function detectRecurrencePreset(recurrence: Recurrence | null): RecurrencePreset {
  if (!recurrence) return "none";
  if (recurrence.rrule === buildRecurrence("daily", null, null).rrule) return "daily";
  if (recurrence.rrule === buildRecurrence("weekly", null, null).rrule) return "weekly";
  if (recurrence.rrule === buildRecurrence("weekly", WEEKDAYS, null).rrule) return "weekdays";
  return "custom";
}

export interface DraftEventRow {
  id: string;
  draftId: string;
  event: ParsedEvent;
  deleted: boolean;
  conflictState: "none" | "overlap" | "duplicate";
}

const TIME_OPTIONS = fifteenMinuteTimeOptions();

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function TitleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2H4a2 2 0 0 0-2 2v6.5a1 1 0 0 0 .29.71l9.5 9.5a1 1 0 0 0 1.42 0l7.5-7.5a1 1 0 0 0 0-1.42l-9.5-9.5A1 1 0 0 0 12 2z" />
      <circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LocationIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function RepeatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function NotesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M15 3v4h4M8 13h8M8 17h5" />
    </svg>
  );
}

/**
 * §4.4: wraps a single field with a "needs look" flag and tap-to-reveal
 * provenance (FR-4.4.1). Flags only a field with no value at all -- a value
 * the model wasn't fully confident about is still trusted as-is rather than
 * flagged, since a short/unusual-but-present value (a nickname, an
 * abbreviation) isn't actually missing anything the user needs to supply.
 */
function FieldFlag({
  field,
  fill = false,
  children,
}: {
  field: Field<unknown>;
  /** True for text fields meant to stretch (title, location). Datetime fields size to content instead -- native date inputs don't shrink well, so forcing flex-1 on them causes overlap. */
  fill?: boolean;
  children: ReactNode;
}) {
  const isMissing = field.value === null || field.value === "";

  return (
    <div className={`${fill ? "min-w-0 flex-1" : ""} ${isMissing ? "border-l-2 border-[var(--acc)] pl-1.5 font-semibold" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {children}
        {isMissing && (
          <span className="border-[1.5px] border-[var(--acc)] bg-[var(--surf)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accInk)]" aria-label="missing, needs review" title="Missing">
            needs look
          </span>
        )}
        {field.inferred && <span className="text-xs italic text-[var(--ink3)]">(inferred{field.inferredFrom ? `: ${field.inferredFrom}` : ""})</span>}
      </div>
    </div>
  );
}

export function DraftCard({
  row,
  index = 0,
  saveError,
  isSelected,
  onSelect,
  onFieldChange,
  onDeleteToggle,
}: {
  row: DraftEventRow;
  /** Position in the visible list, for the staggered entrance animation. */
  index?: number;
  saveError: string | null;
  isSelected: boolean;
  onSelect: () => void;
  onFieldChange: (field: string, value: unknown) => void;
  onDeleteToggle: (deleted: boolean) => void;
}) {
  const revealed = useMountReveal();
  const { event } = row;
  const timezone = event.timezone;
  const start = event.startDateTime.value ? DateTime.fromISO(event.startDateTime.value, { zone: timezone }) : null;
  const dayLabel = start?.isValid ? start.toFormat("EEE d").toUpperCase() : "DRAFT";
  const timeNeedsAttention =
    event.startDateTime.value === null || event.endDateTime.value === null || event.startDateTime.inferred || event.endDateTime.inferred;
  const inferredTimeField = event.endDateTime.inferred ? event.endDateTime : event.startDateTime.inferred ? event.startDateTime : null;
  const recurrencePreset = detectRecurrencePreset(event.recurrence);

  function handleRecurrenceChange(preset: RecurrencePreset) {
    if (preset === "none") onFieldChange("recurrence", null);
    else if (preset === "daily") onFieldChange("recurrence", buildRecurrence("daily", null, null));
    else if (preset === "weekly") onFieldChange("recurrence", buildRecurrence("weekly", null, null));
    else if (preset === "weekdays") onFieldChange("recurrence", buildRecurrence("weekly", WEEKDAYS, null));
  }

  if (row.deleted) {
    return (
      <div className="flex items-center justify-between rounded-[14px] border border-[var(--rule)] bg-[var(--surf)] p-3 text-sm text-[var(--ink3)]">
        <span className="line-through">{event.title.value ?? "(untitled)"}</span>
        <button type="button" onClick={() => onDeleteToggle(false)} className="text-xs text-[var(--accInk)] transition-opacity hover:opacity-70">
          Restore
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      style={{ transitionDelay: revealed ? `${index * 45}ms` : "0ms" }}
      className={`mb-2 cursor-pointer rounded-[14px] border bg-[var(--surf)] px-3.5 py-3 text-sm transition-all duration-500 ease-[cubic-bezier(.2,.6,.2,1)] hover:bg-[var(--sunk)] ${
        revealed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      } ${isSelected ? "border-[var(--acc)]" : row.conflictState !== "none" ? "border-[var(--coolEdge)]" : "border-[var(--rule)]"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="w-[46px] shrink-0 font-mono text-[10.5px] tracking-[0.04em] text-[var(--ink3)]">{dayLabel}</div>
          <TitleIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
          <FieldFlag field={event.title} fill>
            <input
              className="min-w-0 flex-1 border-b border-dotted border-[var(--rule)] bg-transparent text-[15.5px] font-medium tracking-[-0.005em] outline-none"
              defaultValue={event.title.value ?? ""}
              placeholder="(untitled)"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => onFieldChange("title", e.target.value || null)}
            />
          </FieldFlag>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteToggle(true);
            }}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--ink3)] transition-colors hover:bg-[var(--rule2)] hover:text-red-700"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-2 ml-14 flex flex-wrap items-center gap-2 text-[var(--ink)]">
        <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
        <FieldFlag field={event.startDateTime}>
          <input
            type="date"
            className="border-b border-dotted border-[var(--rule)] bg-transparent font-mono text-[13px] outline-none [&::-webkit-calendar-picker-indicator]:opacity-0"
            defaultValue={toDateInputValue(event.startDateTime.value, timezone)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              onFieldChange("startDateTime", withDate(event.startDateTime.value, e.target.value, timezone));
              onFieldChange("endDateTime", withDate(event.endDateTime.value, e.target.value, timezone));
            }}
          />
        </FieldFlag>
      </div>

      <div
        className={`mt-1.5 ml-14 flex items-center gap-2 text-[var(--ink)] ${timeNeedsAttention ? "border-l-2 border-[var(--acc)] pl-1.5" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ClockIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
        <select
          className={`shrink-0 bg-transparent font-mono text-[13px] outline-none ${
            event.startDateTime.inferred
              ? "border-b-2 border-solid border-[var(--acc)] font-semibold"
              : "border-b border-dotted border-[var(--rule)]"
          }`}
          defaultValue={toTimeOptionValue(event.startDateTime.value, timezone)}
          onChange={(e) => onFieldChange("startDateTime", withTimeOfDay(event.startDateTime.value, e.target.value, timezone))}
        >
          {TIME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[var(--surf)] text-[var(--ink)]">
              {opt.label}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-[var(--ink3)]">–</span>
        <select
          className={`shrink-0 bg-transparent font-mono text-[13px] outline-none ${
            event.endDateTime.inferred
              ? "border-b-2 border-solid border-[var(--acc)] font-semibold"
              : "border-b border-dotted border-[var(--rule)]"
          }`}
          defaultValue={toTimeOptionValue(event.endDateTime.value, timezone)}
          onChange={(e) => onFieldChange("endDateTime", withTimeOfDay(event.endDateTime.value, e.target.value, timezone))}
        >
          {TIME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[var(--surf)] text-[var(--ink)]">
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {inferredTimeField && (
        <div className="ml-14 mt-1 pl-1.5 text-xs italic text-[var(--ink3)]">
          (inferred{inferredTimeField.inferredFrom ? `: ${inferredTimeField.inferredFrom}` : ""})
        </div>
      )}

      <div className="mt-2 ml-14 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ink2)]">
        <LocationIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
        {event.locationApplicable ? (
          <FieldFlag field={event.location} fill>
            <input
              className="w-full border-b border-dotted border-[var(--rule)] bg-transparent outline-none"
              placeholder="no location"
              defaultValue={event.location.value ?? ""}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => onFieldChange("location", e.target.value || null)}
            />
          </FieldFlag>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              className="w-full min-w-0 flex-1 cursor-not-allowed border-b border-dotted border-[var(--rule)] bg-transparent text-[var(--ink3)] outline-none"
              placeholder="no location needed"
              disabled
            />
            <span title="No location needed for this" aria-label="No location needed for this">
              <CheckIcon className="h-4 w-4 shrink-0 text-[var(--cool)]" />
            </span>
          </div>
        )}
        {row.conflictState !== "none" && (
          <span className="flex items-center gap-1.5 font-medium text-[var(--coolInk)]">
            <span className="h-[7px] w-[7px] bg-[var(--cool)]" />
            {row.conflictState === "duplicate" ? "duplicate" : "overlaps"}
          </span>
        )}
      </div>

      <div className="mt-2 ml-14 flex flex-wrap items-center gap-2 text-[var(--ink)]" onClick={(e) => e.stopPropagation()}>
        <RepeatIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
        <select
          key={recurrencePreset}
          defaultValue={recurrencePreset}
          onChange={(e) => handleRecurrenceChange(e.target.value as RecurrencePreset)}
          className="border-b border-dotted border-[var(--rule)] bg-transparent text-[13px] outline-none"
        >
          <option value="none">Doesn&rsquo;t repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="weekdays">Weekdays (Mon–Fri)</option>
          {recurrencePreset === "custom" && (
            <option value="custom" disabled>
              {event.recurrence?.plainLanguage ?? "Custom"}
            </option>
          )}
        </select>
      </div>
      {event.recurrence && (
        <div className="ml-14 mt-1 text-xs italic text-[var(--ink3)]">Repeats {event.recurrence.plainLanguage}</div>
      )}

      <div className="mt-2 ml-14 flex items-start gap-2 text-[var(--ink)]" onClick={(e) => e.stopPropagation()}>
        <NotesIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
        <textarea
          rows={1}
          className="min-w-0 flex-1 resize-y border-b border-dotted border-[var(--rule)] bg-transparent text-[12.5px] leading-5 text-[var(--ink2)] outline-none"
          placeholder="Notes, meeting link, etc."
          defaultValue={event.description.value ?? ""}
          onBlur={(e) => onFieldChange("description", e.target.value || null)}
        />
      </div>

      {saveError && (
        <p className="mt-3 ml-14 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Could not save your edit — {saveError}. This field was reset to the last saved value.
        </p>
      )}
    </div>
  );
}
