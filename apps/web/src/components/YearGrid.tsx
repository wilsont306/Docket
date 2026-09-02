"use client";

import { DateTime } from "luxon";
import type { CalendarEvent } from "@/lib/google-calendar";
import type { DraftBlock } from "./WeekCalendar";

const MONTH_ABBR_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function hasAnything(day: DateTime, timezone: string, realEvents: CalendarEvent[], draftBlocks: DraftBlock[]): boolean {
  if (draftBlocks.some((d) => d.start.hasSame(day, "day"))) return true;
  return realEvents.some((e) => {
    const iso = e.start?.dateTime ?? e.start?.date;
    return iso && DateTime.fromISO(iso, { zone: timezone }).hasSame(day, "day");
  });
}

/**
 * 12 mini-months, each day reduced to "does anything land here" -- there's no
 * room for titles at this zoom level. Clicking a day jumps to the Day view;
 * clicking a month name jumps to the Month view for that month.
 */
export function YearGrid({
  year,
  timezone,
  realEvents,
  draftBlocks,
  onSelectDay,
  onSelectMonth,
}: {
  /** Any DateTime within the year to display. */
  year: DateTime;
  timezone: string;
  realEvents: CalendarEvent[];
  draftBlocks: DraftBlock[];
  onSelectDay: (day: DateTime) => void;
  onSelectMonth: (month: DateTime) => void;
}) {
  const months = Array.from({ length: 12 }, (_, i) => year.startOf("year").plus({ months: i }));
  const today = DateTime.now().setZone(timezone).startOf("day");

  return (
    <div className="grid h-full grid-cols-2 gap-3 overflow-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
      {months.map((month) => {
        const gridStart = month.startOf("month").startOf("week");
        const days = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));

        return (
          <div key={month.toFormat("yyyy-MM")} className="rounded-xl border border-[var(--rule)] bg-[var(--surf)] p-2">
            <button
              type="button"
              onClick={() => onSelectMonth(month)}
              className="mb-1.5 text-[11.5px] font-semibold text-[var(--ink)] transition-opacity hover:opacity-70"
            >
              {month.toFormat("MMMM")}
            </button>
            <div className="grid grid-cols-7 gap-[2px]">
              {MONTH_ABBR_WEEKDAYS.map((label, i) => (
                <div key={i} className="flex h-4 items-center justify-center text-[8.5px] text-[var(--ink3)]">
                  {label}
                </div>
              ))}
              {days.map((day) => {
                const inMonth = day.hasSame(month, "month");
                const isToday = day.hasSame(today, "day");
                const has = inMonth && hasAnything(day, timezone, realEvents, draftBlocks);
                return (
                  <button
                    type="button"
                    key={day.toISODate()}
                    onClick={() => onSelectDay(day)}
                    disabled={!inMonth}
                    className={`relative flex h-5 w-5 items-center justify-center rounded-full text-[9px] transition-colors ${
                      !inMonth
                        ? "cursor-default text-transparent"
                        : isToday
                          ? "bg-[var(--btn)] font-semibold text-[var(--onBtn)]"
                          : "text-[var(--ink2)] hover:bg-[var(--sunk)]"
                    }`}
                  >
                    {inMonth ? day.day : ""}
                    {has && !isToday && <span className="absolute bottom-[1px] h-1 w-1 rounded-full bg-[var(--acc)]" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
