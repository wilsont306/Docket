import { DateTime } from "luxon";

export type CalendarViewMode = "day" | "week" | "month" | "year";

/**
 * The fetch/expansion window for a given view -- shared by the real-events
 * fetch and the recurring-draft expansion, so both always agree on how much
 * of the calendar is actually visible. Month's window covers the full
 * leading/trailing weeks shown in the grid, not just the calendar month
 * itself, since those days are visible (dimmed) too.
 */
export function viewRange(mode: CalendarViewMode, anchor: DateTime): { start: DateTime; end: DateTime } {
  switch (mode) {
    case "day":
      return { start: anchor.startOf("day"), end: anchor.plus({ days: 1 }).startOf("day") };
    case "week": {
      const start = anchor.startOf("week");
      return { start, end: start.plus({ weeks: 1 }) };
    }
    case "month": {
      const start = anchor.startOf("month").startOf("week");
      const end = anchor.endOf("month").endOf("week").plus({ milliseconds: 1 });
      return { start, end };
    }
    case "year": {
      const start = anchor.startOf("year");
      return { start, end: start.plus({ years: 1 }) };
    }
  }
}

/** Prev/next always moves by one unit of whichever view is currently showing -- a day arrow moves a day, a year arrow moves a year. */
export function shiftAnchor(mode: CalendarViewMode, anchor: DateTime, direction: 1 | -1): DateTime {
  switch (mode) {
    case "day":
      return anchor.plus({ days: direction });
    case "week":
      return anchor.plus({ weeks: direction });
    case "month":
      return anchor.plus({ months: direction });
    case "year":
      return anchor.plus({ years: direction });
  }
}

export function viewLabel(mode: CalendarViewMode, anchor: DateTime): string {
  switch (mode) {
    case "day":
      return anchor.toFormat("EEEE, MMM d");
    case "week": {
      const start = anchor.startOf("week");
      return `${start.toFormat("MMM d")} – ${start.plus({ days: 6 }).toFormat("MMM d")}`;
    }
    case "month":
      return anchor.toFormat("MMMM yyyy");
    case "year":
      return anchor.toFormat("yyyy");
  }
}
