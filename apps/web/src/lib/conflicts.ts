import { DateTime } from "luxon";
import type { ParsedEvent } from "@calendar-auto/core";
import type { CalendarEvent } from "./google-calendar";

export type ConflictState = "none" | "overlap" | "duplicate";

/**
 * FR-4.6.1/4.6.3: advisory only (FR-4.6.2) -- overlap just means the times
 * intersect; duplicate means an existing event has the same title and the
 * same start time, which gets a distinct one-tap-skip treatment in the UI.
 */
export function computeConflictState(event: ParsedEvent, realEvents: CalendarEvent[]): ConflictState {
  const start = event.startDateTime.value;
  const end = event.endDateTime.value;
  if (!start || !end) return "none";
  const draftStart = DateTime.fromISO(start);
  const draftEnd = DateTime.fromISO(end);
  if (!draftStart.isValid || !draftEnd.isValid) return "none";

  let state: ConflictState = "none";
  for (const real of realEvents) {
    const realStart = real.start?.dateTime ? DateTime.fromISO(real.start.dateTime) : null;
    const realEnd = real.end?.dateTime ? DateTime.fromISO(real.end.dateTime) : null;
    if (!realStart?.isValid || !realEnd?.isValid) continue;

    const overlaps = draftStart < realEnd && draftEnd > realStart;
    if (!overlaps) continue;

    const sameTitle = (real.summary ?? "").trim().toLowerCase() === (event.title.value ?? "").trim().toLowerCase();
    if (sameTitle && realStart.equals(draftStart)) return "duplicate";
    state = "overlap";
  }
  return state;
}
