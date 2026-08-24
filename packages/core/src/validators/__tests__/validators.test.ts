import { describe, expect, it } from "vitest";
import {
  MAX_EVENTS_PER_BATCH,
  ValidationError,
  assertDateWithinSaneRange,
  assertEventCountWithinCap,
  assertInsertOnly,
  assertMatchesConfirmedDraft,
  assertNoUnsolicitedAttendees,
} from "../index";

describe("event-count cap (§7.3)", () => {
  it("allows a batch at or under the cap", () => {
    expect(() => assertEventCountWithinCap(MAX_EVENTS_PER_BATCH)).not.toThrow();
  });

  it("rejects a batch over the cap", () => {
    expect(() => assertEventCountWithinCap(MAX_EVENTS_PER_BATCH + 1)).toThrow(ValidationError);
  });
});

describe("date-range sanity (§7.3)", () => {
  it("allows a date within a year of today", () => {
    const today = new Date("2026-08-24T00:00:00Z");
    const nearDate = new Date("2026-09-01T00:00:00Z");
    expect(() => assertDateWithinSaneRange(nearDate, today)).not.toThrow();
  });

  it("rejects a date far in the future (injection-produced noise)", () => {
    const today = new Date("2026-08-24T00:00:00Z");
    const farDate = new Date("2099-01-01T00:00:00Z");
    expect(() => assertDateWithinSaneRange(farDate, today)).toThrow(ValidationError);
  });
});

describe("invitee gate (§7.3 — highest severity)", () => {
  it("allows an event with no attendees", () => {
    expect(() =>
      assertNoUnsolicitedAttendees([{ attendees: [], attendeesOptedIn: false }]),
    ).not.toThrow();
  });

  it("allows an event with attendees when the user explicitly opted in", () => {
    expect(() =>
      assertNoUnsolicitedAttendees([
        { attendees: ["friend@example.com"], attendeesOptedIn: true },
      ]),
    ).not.toThrow();
  });

  it("rejects an event with attendees the user never opted in to inviting", () => {
    expect(() =>
      assertNoUnsolicitedAttendees([
        { attendees: ["attacker@example.com"], attendeesOptedIn: false },
      ]),
    ).toThrow(ValidationError);
  });
});

describe("mutation scope (§7.3)", () => {
  it("allows insert", () => {
    expect(() => assertInsertOnly({ operation: "insert" })).not.toThrow();
  });

  it("rejects update", () => {
    expect(() => assertInsertOnly({ operation: "update" })).toThrow(ValidationError);
  });

  it("rejects delete", () => {
    expect(() => assertInsertOnly({ operation: "delete" })).toThrow(ValidationError);
  });
});

describe("field conformance (§7.3)", () => {
  it("allows a commit payload that matches the confirmed draft", () => {
    const draft = { title: "Standup", start: "2026-08-25T09:00:00-04:00" };
    expect(() => assertMatchesConfirmedDraft({ ...draft }, draft)).not.toThrow();
  });

  it("rejects a commit payload that was tampered with after confirmation", () => {
    const draft = { title: "Standup", start: "2026-08-25T09:00:00-04:00" };
    const tampered = { title: "Standup", start: "2026-08-25T09:00:00-04:00", attendees: ["x@example.com"] };
    expect(() => assertMatchesConfirmedDraft(tampered, draft)).toThrow(ValidationError);
  });
});
