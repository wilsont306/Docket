import { ValidationError } from "./errors";

/**
 * §7.3 execution rails: "event count cap" (runaway/adversarial generation)
 * and "date-range sanity" (injection producing far-future noise). These
 * constants are the ones M6's Python rails service must read from — not
 * reimplement independently — so the two layers can't silently drift
 * (see the build plan's M6.1).
 */
export const MAX_EVENTS_PER_BATCH = 100;
export const MAX_DAYS_FROM_TODAY = 365;

export function assertEventCountWithinCap(eventCount: number): void {
  if (eventCount > MAX_EVENTS_PER_BATCH) {
    throw new ValidationError(
      `Batch of ${eventCount} events exceeds the cap of ${MAX_EVENTS_PER_BATCH}`,
      "event_count_cap",
    );
  }
}

export function assertDateWithinSaneRange(eventDate: Date, referenceDate: Date = new Date()): void {
  const diffDays = Math.abs(eventDate.getTime() - referenceDate.getTime()) / 86_400_000;
  if (diffDays > MAX_DAYS_FROM_TODAY) {
    throw new ValidationError(
      `Event date is more than ${MAX_DAYS_FROM_TODAY} days from today`,
      "date_range_sanity",
    );
  }
}
