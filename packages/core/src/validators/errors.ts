export type ValidationErrorCode =
  | "event_count_cap"
  | "date_range_sanity"
  | "invitee_gate"
  | "mutation_scope"
  | "field_conformance";

/**
 * Thrown by every validator in this directory. The TS-side deterministic
 * floor (§7.4): parsing fails open if the Python guardrails service is
 * unavailable, but a commit is never reachable without these checks passing
 * — see the commit route at stage 8/9 of the pipeline (§6.3).
 */
export class ValidationError extends Error {
  readonly code: ValidationErrorCode;

  constructor(message: string, code: ValidationErrorCode) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}
