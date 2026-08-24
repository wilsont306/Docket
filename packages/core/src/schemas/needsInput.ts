import { z } from "zod";

/**
 * The 8 clarifying-question types from §5.2. A question is either scoped to
 * one draft event, or to the whole batch (`scope: "batch"`, asked once per
 * §5.3.2 — e.g. `calendar_target`). Never blocking (§5.3.3): skipping a
 * question just creates the event without that field.
 */

const baseFields = {
  id: z.string(),
  draftId: z.string(),
  answeredAt: z.string().datetime().nullable().default(null),
};

export const LocationMissingSchema = z.object({
  ...baseFields,
  type: z.literal("location_missing"),
  scope: z.literal("event"),
  draftEventId: z.string(),
});

export const VirtualOrPhysicalSchema = z.object({
  ...baseFields,
  type: z.literal("virtual_or_physical"),
  scope: z.literal("event"),
  draftEventId: z.string(),
});

export const AmbiguousMeridiemSchema = z.object({
  ...baseFields,
  type: z.literal("ambiguous_meridiem"),
  scope: z.literal("event"),
  draftEventId: z.string(),
  /** The bare hour that needs AM/PM disambiguation, e.g. 8 for "meeting at 8". */
  hour: z.number().int().min(1).max(12),
});

export const AmbiguousYearSchema = z.object({
  ...baseFields,
  type: z.literal("ambiguous_year"),
  scope: z.literal("event"),
  draftEventId: z.string(),
  candidateYears: z.tuple([z.number().int(), z.number().int()]),
});

export const DurationUnknownSchema = z.object({
  ...baseFields,
  type: z.literal("duration_unknown"),
  scope: z.literal("event"),
  draftEventId: z.string(),
});

export const RecurrenceUnclearSchema = z.object({
  ...baseFields,
  type: z.literal("recurrence_unclear"),
  scope: z.literal("event"),
  draftEventId: z.string(),
});

export const AttendeesFoundSchema = z.object({
  ...baseFields,
  type: z.literal("attendees_found"),
  scope: z.literal("event"),
  draftEventId: z.string(),
  emails: z.array(z.string().email()),
});

export const CalendarTargetSchema = z.object({
  ...baseFields,
  type: z.literal("calendar_target"),
  scope: z.literal("batch"),
  draftEventId: z.null().default(null),
});

export const NeedsInputSchema = z.discriminatedUnion("type", [
  LocationMissingSchema,
  VirtualOrPhysicalSchema,
  AmbiguousMeridiemSchema,
  AmbiguousYearSchema,
  DurationUnknownSchema,
  RecurrenceUnclearSchema,
  AttendeesFoundSchema,
  CalendarTargetSchema,
]);

export type NeedsInput = z.infer<typeof NeedsInputSchema>;
export type NeedsInputType = NeedsInput["type"];
