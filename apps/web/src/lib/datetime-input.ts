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
