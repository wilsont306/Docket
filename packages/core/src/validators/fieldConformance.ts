import { ValidationError } from "./errors";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * §7.3: "Committed events must match the user-confirmed draft" — the check
 * against tampering between confirmation (stage 7) and write (stage 9).
 */
export function assertMatchesConfirmedDraft(committingPayload: unknown, confirmedDraft: unknown): void {
  if (!deepEqual(committingPayload, confirmedDraft)) {
    throw new ValidationError(
      "Commit payload does not match the user-confirmed draft",
      "field_conformance",
    );
  }
}
