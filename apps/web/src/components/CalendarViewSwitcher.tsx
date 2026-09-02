"use client";

import type { CalendarViewMode } from "@/lib/calendar-view";

const VIEWS: CalendarViewMode[] = ["day", "week", "month", "year"];

/** Day/Week/Month/Year toggle -- shared by every place a calendar grid is shown, so switching granularity always looks and works the same way. */
export function CalendarViewSwitcher({ value, onChange }: { value: CalendarViewMode; onChange: (mode: CalendarViewMode) => void }) {
  return (
    <div className="flex gap-0.5 rounded-full border border-[var(--rule)] bg-[var(--surf)] p-0.5">
      {VIEWS.map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors ${
            value === mode ? "bg-[var(--sunk)] text-[var(--ink)]" : "text-[var(--ink2)] hover:bg-[var(--sunk)]"
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}
