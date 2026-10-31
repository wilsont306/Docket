import type { CalendarEvent } from "./google-calendar";

// Google Calendar's fixed 11-color event palette (FR-4.1.5: existing events
// stay recognizable at a glance rather than being reskinned by this app).
const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};
export const DEFAULT_EVENT_COLOR = "#4285f4";

/** An event's own colorId wins when set; otherwise falls back to its source calendar's color ("My calendars"), then a flat default. Shared by every calendar-grid view (week/day, month, year) so they agree on how an event is colored. */
export function resolveEventColor(e: CalendarEvent, calendarColors: Record<string, string | undefined>): string {
  return (e.colorId ? GOOGLE_EVENT_COLORS[e.colorId] : undefined) ?? calendarColors[e.calendarId] ?? DEFAULT_EVENT_COLOR;
}
