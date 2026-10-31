import { ValidationError } from "./errors";

export type AttendeeCheckable = {
  attendees: string[];
  attendeesOptedIn: boolean;
};

/**
 * §7.3: "No attendee is ever added unless the user explicitly opted in via
 * `attendees_found`." Highest-severity threat this addresses per the PRD —
 * an injected photo causing invitations to be mailed to an attacker.
 */
export function assertNoUnsolicitedAttendees(events: AttendeeCheckable[]): void {
  for (const event of events) {
    if (event.attendees.length > 0 && !event.attendeesOptedIn) {
      throw new ValidationError(
        "Event has attendees but the user has not explicitly opted in to sending invites",
        "invitee_gate",
      );
    }
  }
}
