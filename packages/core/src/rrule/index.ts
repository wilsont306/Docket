import { RRule } from "rrule";

/**
 * RRULE parse/generate wrapper. §12.5's policy — recurrence is always shown
 * in plain language for review regardless of model confidence — is why
 * `describeRRule` exists as a first-class function rather than something the
 * UI does ad hoc.
 */

export function parseRRule(rruleString: string): RRule {
  return RRule.fromString(rruleString);
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
