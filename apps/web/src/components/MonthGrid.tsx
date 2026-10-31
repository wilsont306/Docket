"use client";

import { DateTime } from "luxon";
import type { CalendarEvent } from "@/lib/google-calendar";
import { resolveEventColor } from "@/lib/event-color";
import type { DraftBlock } from "./WeekCalendar";

const MAX_VISIBLE_PER_DAY = 3;
// Monday-first, matching Luxon's `startOf("week")` -- which is what builds
// the grid below (and the week view's own columns). The old Sunday-first
// labels sat above Monday-first columns, so every date in the month read one
// column off from the weekday printed over it.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isAllDayRealEvent(e: CalendarEvent): boolean {
  return !e.start?.dateTime && !!e.start?.date;
}

interface DayItem {
  key: string;
  label: string;
  time: string | null;
  /** null marks a draft (dashed styling) rather than a real event (solid, calendar-colored). */
  color: string | null;
}

/**
 * A traditional 6-week month grid. Deliberately lower-fidelity than
 * WeekCalendar's hourly grid -- each cell is too small for real in-place
 * editing, so clicking one jumps to the Day view anchored there instead.
 */
export function MonthGrid({
  month,
  timezone,
  realEvents,
  draftBlocks,
  calendarColors,
  onSelectDay,
}: {
  /** Any DateTime within the month to display. */
  month: DateTime;
  timezone: string;
  realEvents: CalendarEvent[];
  draftBlocks: DraftBlock[];
  calendarColors: Record<string, string | undefined>;
  onSelectDay: (day: DateTime) => void;
}) {
  const gridStart = month.startOf("month").startOf("week");
  const days = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));
  const today = DateTime.now().setZone(timezone).startOf("day");

  return (
    <div className="grid h-full auto-rows-fr grid-cols-7 text-xs">
      {WEEKDAY_LABELS.map((label) => (
        <div
          key={label}
          className="border-b border-[var(--rule)] bg-[var(--sunk)] py-1.5 text-center text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink3)]"
        >
          {label}
        </div>
      ))}
      {days.map((day) => {
        const inMonth = day.hasSame(month, "month");
        const isToday = day.hasSame(today, "day");

        const dayReal: DayItem[] = realEvents
          .filter((e) => {
            const iso = e.start?.dateTime ?? e.start?.date;
            return iso && DateTime.fromISO(iso, { zone: timezone }).hasSame(day, "day");
          })
          .map((e) => ({
            key: `real-${e.id}`,
            label: e.summary ?? "(untitled)",
            time: isAllDayRealEvent(e) || !e.start?.dateTime ? null : DateTime.fromISO(e.start.dateTime, { zone: timezone }).toFormat("h:mm a"),
            color: resolveEventColor(e, calendarColors),
          }));
        const dayDrafts: DayItem[] = draftBlocks
          .filter((d) => d.start.hasSame(day, "day"))
          .map((d) => ({ key: `draft-${d.id}`, label: d.title, time: d.allDay ? null : d.start.toFormat("h:mm a"), color: null }));
        const items = [...dayReal, ...dayDrafts];
        const visible = items.slice(0, MAX_VISIBLE_PER_DAY);
        const overflow = items.length - visible.length;

        return (
          <button
            type="button"
            key={day.toISODate()}
            onClick={() => onSelectDay(day)}
            className="flex min-h-0 flex-col items-stretch gap-0.5 overflow-hidden border-b border-l border-[var(--rule2)] p-1 text-left transition-colors hover:brightness-95"
            style={{ background: inMonth ? "var(--surf)" : "var(--sunk)" }}
          >
            <span
              className={`self-start rounded-full px-1.5 text-[11px] font-semibold ${
                isToday ? "bg-[var(--btn)] text-[var(--onBtn)]" : inMonth ? "text-[var(--ink)]" : "text-[var(--ink3)]"
              }`}
            >
              {day.day}
            </span>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
              {visible.map((item) => (
                <div
                  key={item.key}
                  className={
                    item.color
                      ? "truncate rounded px-1 py-[1px] text-[10px] text-white"
                      : "truncate rounded border border-dashed border-[var(--acc)] bg-[var(--accWash)] px-1 py-[1px] text-[10px] text-[var(--accInk)]"
                  }
                  style={item.color ? { backgroundColor: item.color } : undefined}
                  title={item.label}
                >
                  {item.time && <span className="opacity-85">{item.time} </span>}
                  {item.label}
                </div>
              ))}
              {overflow > 0 && <div className="px-1 text-[10px] font-medium text-[var(--ink3)]">+{overflow} more</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
