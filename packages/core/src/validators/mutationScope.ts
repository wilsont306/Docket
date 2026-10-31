import { ValidationError } from "./errors";

export type CalendarMutation = {
  operation: "insert" | "update" | "delete";
};

/**
 * §7.3: "Only `insert` is reachable from the parse path. Update and delete
 * of pre-existing events are not exposed at all." This is the enforcement
 * point for the §1.4 non-goal (no editing/deleting pre-existing events) and
 * for Q3's decision that a re-photographed roster always creates new
 * drafts rather than updating an existing committed event.
 */
export function assertInsertOnly(mutation: CalendarMutation): void {
  if (mutation.operation !== "insert") {
    throw new ValidationError(
      `Mutation operation "${mutation.operation}" is not reachable from the parse path`,
      "mutation_scope",
    );
  }
}
