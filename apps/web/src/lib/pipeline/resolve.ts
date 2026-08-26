import { DateTime } from "luxon";
import type { ParsedEvent } from "@calendar-auto/core";

export interface ResolvedNeedsInput {
  type: "duration_unknown";
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

  return { event: resolved, needsInput };
}
