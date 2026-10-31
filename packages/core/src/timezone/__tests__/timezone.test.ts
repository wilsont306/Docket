import { describe, expect, it } from "vitest";
import { addDaysPreservingWallClock, isValidIanaZone, parseInZone, toAllDayDate, toIsoWithZone } from "../index";

describe("DST boundary (NFR-9.3.2)", () => {
  it("preserves wall-clock time across the US spring-forward transition", () => {
    // 2026-03-08 02:00 America/New_York is when clocks jump to 03:00 (EST -> EDT).
    const beforeTransition = parseInZone("2026-03-07T09:00:00", "America/New_York");
    expect(beforeTransition.offset).toBe(-300); // EST, UTC-5

    const afterTransition = addDaysPreservingWallClock(beforeTransition, 1);

    // Wall-clock hour stays 09:00 even though the UTC offset changed underneath it.
    expect(afterTransition.hour).toBe(9);
    expect(afterTransition.minute).toBe(0);
    expect(afterTransition.offset).toBe(-240); // EDT, UTC-4
  });

  it("preserves wall-clock time across the US fall-back transition", () => {
    // 2026-11-01 02:00 America/New_York is when clocks fall back to 01:00 (EDT -> EST).
    const beforeTransition = parseInZone("2026-10-31T09:00:00", "America/New_York");
    expect(beforeTransition.offset).toBe(-240); // EDT, UTC-4

    const afterTransition = addDaysPreservingWallClock(beforeTransition, 1);

    expect(afterTransition.hour).toBe(9);
    expect(afterTransition.offset).toBe(-300); // EST, UTC-5
  });
});

describe("isValidIanaZone", () => {
  it("accepts a real IANA zone", () => {
    expect(isValidIanaZone("America/New_York")).toBe(true);
  });

  it("rejects a bogus zone", () => {
    expect(isValidIanaZone("Not/A_Zone")).toBe(false);
  });
});

describe("all-day events (NFR-9.3.3)", () => {
  it("serializes to a plain date, never a midnight-to-midnight timed event", () => {
    const date = parseInZone("2026-12-25T00:00:00", "America/New_York");
    expect(toAllDayDate(date)).toBe("2026-12-25");
  });
});

describe("toIsoWithZone (NFR-9.3.1)", () => {
  it("always carries an explicit offset, never a naive local time", () => {
    const date = parseInZone("2026-06-01T14:30:00", "America/Los_Angeles");
    expect(toIsoWithZone(date)).toMatch(/2026-06-01T14:30:00-07:00/);
  });
});
