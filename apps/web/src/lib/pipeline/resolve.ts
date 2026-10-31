import { DateTime } from "luxon";
import type { ParsedEvent } from "@calendar-auto/core";

export interface ResolvedNeedsInput {
  type: "duration_unknown" | "location_missing";
}

export interface ResolvedEvent {
  event: ParsedEvent;
  needsInput: ResolvedNeedsInput[];
}

/**
 * Pipeline stage 5 (§6.3): deterministic resolution the model doesn't do
 * itself. For M1 this covers the one needs_input case that's cheap to
 * detect without also asking the model to self-report it (§5.2
 * `duration_unknown`): a missing end time gets a 1-hour default, marked
 * inferred, with a question attached so the review UI can still flag it
 * (§5.1 -- a confident-looking guess is worse than a flagged gap).
 */
export function resolveEvent(event: ParsedEvent): ResolvedEvent {
  const resolved = structuredClone(event);
  const needsInput: ResolvedNeedsInput[] = [];

  if (resolved.endDateTime.value === null && resolved.startDateTime.value !== null) {
    if (resolved.isAllDay.value) {
      // An all-day event with no stated end is unambiguously just that one
      // day (NFR-9.3.3) -- not a guess worth a needs_input flag.
      resolved.endDateTime = {
        value: resolved.startDateTime.value,
        confidence: resolved.startDateTime.confidence,
        provenance: null,
        inferred: true,
        inferredFrom: "same day as start (no end date given)",
      };
    } else {
      const start = DateTime.fromISO(resolved.startDateTime.value);
      if (start.isValid) {
        resolved.endDateTime = {
          value: start.plus({ hours: 1 }).toISO({ suppressMilliseconds: true }),
          confidence: 0.5,
          provenance: null,
          inferred: true,
          inferredFrom: "default 1-hour duration",
        };
        needsInput.push({ type: "duration_unknown" });
      }
    }
  }

  // §5.4/§5.2: a recognized conferencing URL means the event is virtual --
  // that's enough to infer "location" without asking (FR-5.4.1). Otherwise,
  // only ask when a location actually makes sense for this kind of event
  // (`locationApplicable`, from the extractor -- a personal/solo activity
  // like "sleeping" or "workout" has nowhere sensible to ask about).
  const hasLocation = resolved.location.value !== null && resolved.location.value.trim() !== "";
  if (!hasLocation) {
    if (resolved.conferencing) {
      resolved.location = {
        value: resolved.conferencing.url ?? `${resolved.conferencing.provider} (virtual)`,
        confidence: 0.9,
        provenance: null,
        inferred: true,
        inferredFrom: "virtual meeting link found in source",
      };
    } else if (resolved.locationApplicable) {
      needsInput.push({ type: "location_missing" });
    }
  }

  return { event: resolved, needsInput };
}
