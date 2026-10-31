import { DateTime } from "luxon";

/**
 * IANA-aware date helpers (NFR-9.3.1: times always carry an explicit IANA
 * zone, never a naive local time). Built on luxon, which preserves
 * wall-clock time across DST boundaries by default when adding calendar
 * units — this is what makes NFR-9.3.2 (DST-crossing events land at the
 * correct wall-clock time) hold without special-casing.
 */

export function isValidIanaZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}

/** Parses an ISO datetime string against an explicit IANA zone. */
export function parseInZone(iso: string, zone: string): DateTime {
  return DateTime.fromISO(iso, { zone });
}

export function nowInZone(zone: string): DateTime {
  return DateTime.now().setZone(zone);
}

/** Adds calendar days while preserving wall-clock time across DST transitions. */
export function addDaysPreservingWallClock(date: DateTime, days: number): DateTime {
  return date.plus({ days });
}

export function toIsoWithZone(date: DateTime): string {
  const iso = date.toISO({ suppressMilliseconds: true });
  if (iso === null) {
    throw new Error("Cannot serialize an invalid DateTime");
  }
  return iso;
}

/**
 * All-day events are modeled as a plain date, never as a midnight-to-midnight
 * timed event (NFR-9.3.3).
 */
export function toAllDayDate(date: DateTime): string {
  const isoDate = date.toISODate();
  if (isoDate === null) {
    throw new Error("Cannot serialize an invalid DateTime to a date");
  }
  return isoDate;
}

/**
 * Resolves a relative date phrase's anchor against the user's current local
 * date and timezone (FR-3.2.3). Callers combine this with their own
 * phrase-parsing logic; this just fixes the reference point the phrase is
 * resolved against — the capture-time zone (NFR-9.3.4), not the review-time
 * zone if they differ.
 */
export function resolutionReference(captureTimeZone: string, capturedAt: Date = new Date()): DateTime {
  return DateTime.fromJSDate(capturedAt, { zone: captureTimeZone });
}
