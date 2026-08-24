import { describe, expect, it } from "vitest";
import { ParsedEventSchema } from "../parsedEvent";
import { NeedsInputSchema } from "../needsInput";

function emptyField() {
  return { value: null, confidence: 0, provenance: null, inferred: false, inferredFrom: null };
}

describe("ParsedEventSchema", () => {
  it("accepts a fully populated event", () => {
    const result = ParsedEventSchema.safeParse({
      title: { value: "Lunch with Sam", confidence: 0.95, provenance: null, inferred: false, inferredFrom: null },
      startDateTime: { value: "2026-08-27T13:00:00-04:00", confidence: 0.9, provenance: null, inferred: false, inferredFrom: null },
      endDateTime: { value: "2026-08-27T14:00:00-04:00", confidence: 0.4, provenance: null, inferred: true, inferredFrom: "1h default duration" },
      isAllDay: { value: false, confidence: 1, provenance: null, inferred: false, inferredFrom: null },
      timezone: "America/New_York",
      location: emptyField(),
      description: emptyField(),
      recurrence: null,
      conferencing: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a value where a field's shape doesn't hold confidence in range", () => {
    const result = ParsedEventSchema.safeParse({
      title: { value: "x", confidence: 2, provenance: null, inferred: false, inferredFrom: null },
      startDateTime: emptyField(),
      endDateTime: emptyField(),
      isAllDay: { value: true, confidence: 1, provenance: null, inferred: false, inferredFrom: null },
      timezone: "America/New_York",
      location: emptyField(),
      description: emptyField(),
      recurrence: null,
      conferencing: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("NeedsInputSchema", () => {
  it("accepts an ambiguous_meridiem question", () => {
    const result = NeedsInputSchema.safeParse({
      id: "ni_1",
      draftId: "draft_1",
      answeredAt: null,
      type: "ambiguous_meridiem",
      scope: "event",
      draftEventId: "de_1",
      hour: 8,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a batch-level calendar_target question with no draftEventId", () => {
    const result = NeedsInputSchema.safeParse({
      id: "ni_2",
      draftId: "draft_1",
      answeredAt: null,
      type: "calendar_target",
      scope: "batch",
    });
    expect(result.success).toBe(true);
  });
});
