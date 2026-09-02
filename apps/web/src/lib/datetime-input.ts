import { DateTime } from "luxon";

/** Converts an ISO datetime (in some zone) to the value a <input type="datetime-local"> expects, in that same zone. */
export function toLocalInputValue(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { zone: timezone });
  return dt.isValid ? dt.toFormat("yyyy-LL-dd'T'HH:mm") : "";
}

/** Converts a <input type="datetime-local"> value back to an ISO datetime with the given zone's offset. */
export function fromLocalInputValue(local: string, timezone: string): string | null {
  const dt = DateTime.fromFormat(local, "yyyy-LL-dd'T'HH:mm", { zone: timezone });
  return dt.isValid ? dt.toISO({ suppressMilliseconds: true }) : null;
}

/** The `<input type="date">` value (yyyy-LL-dd) for an ISO datetime in the given zone. */
export function toDateInputValue(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { zone: timezone });
  return dt.isValid ? dt.toFormat("yyyy-LL-dd") : "";
}

/** The "HH:mm" (24h) select value for an ISO datetime's time-of-day in the given zone. */
export function toTimeOptionValue(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { zone: timezone });
  return dt.isValid ? dt.toFormat("HH:mm") : "";
}

/** Replaces the date part of an ISO datetime with `dateValue` (yyyy-LL-dd), keeping its time-of-day. */
export function withDate(iso: string | null, dateValue: string, timezone: string): string | null {
  const time = iso ? DateTime.fromISO(iso, { zone: timezone }) : DateTime.now().setZone(timezone).startOf("hour");
  const dt = DateTime.fromFormat(`${dateValue} ${time.isValid ? time.toFormat("HH:mm") : "00:00"}`, "yyyy-LL-dd HH:mm", {
    zone: timezone,
  });
  return dt.isValid ? dt.toISO({ suppressMilliseconds: true }) : null;
}

/** Replaces the time-of-day of an ISO datetime with `timeValue` (HH:mm, 24h), keeping its date. */
export function withTimeOfDay(iso: string | null, timeValue: string, timezone: string): string | null {
  const date = iso ? DateTime.fromISO(iso, { zone: timezone }) : DateTime.now().setZone(timezone);
  const dt = DateTime.fromFormat(`${date.isValid ? date.toFormat("yyyy-LL-dd") : ""} ${timeValue}`, "yyyy-LL-dd HH:mm", {
    zone: timezone,
  });
  return dt.isValid ? dt.toISO({ suppressMilliseconds: true }) : null;
}

/** 96 options covering a full day in 15-minute increments: { value: "HH:mm" (24h), label: "12:00 AM" (12h) }. */
export function fifteenMinuteTimeOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const dt = DateTime.fromObject({ hour: Math.floor(minutes / 60), minute: minutes % 60 });
    options.push({ value: dt.toFormat("HH:mm"), label: dt.toFormat("h:mm a") });
  }
  return options;
}
