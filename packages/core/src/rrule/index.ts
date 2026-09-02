import { DateTime } from "luxon";
import { RRule, type Weekday } from "rrule";
import type { Recurrence } from "../schemas/recurrence";

/**
 * RRULE parse/generate wrapper. §12.5's policy — recurrence is always shown
 * in plain language for review regardless of model confidence — is why
 * `describeRRule` exists as a first-class function rather than something the
 * UI does ad hoc.
 */

export function parseRRule(rruleString: string): RRule {
  return RRule.fromString(rruleString);
}

export type RecurrenceDay = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

const WEEKDAY: Record<RecurrenceDay, Weekday> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};

const FREQ: Record<RecurrenceFrequency, number> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};

/**
 * §12.5: recurrence is the largest error surface an inferred RRULE could
 * produce, so the RRULE syntax itself is always built here from a small,
 * closed set of structured inputs -- never trusted as a raw string the
 * model wrote itself (extraction only ever supplies frequency/days/until/
 * interval; this is the one place that turns that into an actual RRULE).
 * `interval` covers "every other X"/"every N Xs" (2 = every other, per
 * RFC 5545) -- omitted or 1 means every single occurrence, the RRULE
 * default, so it's left out of the string entirely rather than writing
 * a redundant `INTERVAL=1`.
 */
export function buildRecurrence(
  frequency: RecurrenceFrequency,
  days: RecurrenceDay[] | null,
  until: string | null,
  interval: number | null = null,
): Recurrence {
  const options: ConstructorParameters<typeof RRule>[0] = { freq: FREQ[frequency] };
  if (frequency === "weekly" && days && days.length > 0) {
    options.byweekday = days.map((d) => WEEKDAY[d]);
  }
  if (interval && interval > 1) {
    options.interval = interval;
  }
  if (until) {
    const untilDate = new Date(until);
    if (!Number.isNaN(untilDate.getTime())) options.until = untilDate;
  }
  const rule = new RRule(options);
  return { rrule: rule.toString(), plainLanguage: rule.toText(), confidence: 0.6 };
}

/** e.g. "every Tuesday and Thursday until Dec 12" (US-2.2). */
export function describeRRule(rruleString: string): string {
  return parseRRule(rruleString).toText();
}

export function isValidRRule(rruleString: string): boolean {
  try {
    parseRRule(rruleString);
    return true;
  } catch {
    return false;
  }
}

/**
 * A stored RRULE never carries its own DTSTART -- the event's own
 * startDateTime/timezone fields are that anchor (the same split Google
 * Calendar itself uses). Occurrences are computed against the event's
 * LOCAL wall-clock components reinterpreted as UTC ("floating time"),
 * never its real UTC instant: per RFC 5545, a recurring event keeps the
 * same local time and weekday every occurrence, with only the UTC offset
 * shifting across a DST boundary -- computing in real UTC would drift the
 * apparent local time/weekday for occurrences on the other side of one.
 */
export function expandRecurrenceOccurrences(
  rrule: string,
  dtstart: DateTime,
  rangeStart: DateTime,
  rangeEnd: DateTime,
): DateTime[] {
  const zone = dtstart.zone;
  const toFloating = (dt: DateTime): Date => new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
  const fromFloating = (date: Date): DateTime =>
    DateTime.fromObject(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
      },
      { zone },
    );

  const parsed = RRule.fromString(rrule);
  const anchored = new RRule({ ...parsed.origOptions, dtstart: toFloating(dtstart) });
  return anchored.between(toFloating(rangeStart), toFloating(rangeEnd), true).map(fromFloating);
}
