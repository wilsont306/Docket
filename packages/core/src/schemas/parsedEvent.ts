import { z } from "zod";
import { fieldSchema } from "./field";
import { RecurrenceSchema } from "./recurrence";
import { ConferencingSchema } from "./conferencing";

/**
 * The extractor's output type (pipeline stage 4, §6.3) and the single source
 * of truth every downstream stage — resolve, drafts, both clients, and the
 * DB — agree with (§6.2). Every field is wrapped so the review surface can
 * show confidence, provenance, and inferred-vs-read status per field.
 *
 * All-day events are modeled as dates, never as midnight-to-midnight timed
 * events (NFR-9.3.3) — see `isAllDay` and the timezone helpers in
 * `../timezone`.
 */
export const ParsedEventSchema = z.object({
  title: fieldSchema(z.string()),
  /** ISO 8601 datetime with offset for timed events, or an ISO date for all-day events. */
  startDateTime: fieldSchema(z.string()),
  endDateTime: fieldSchema(z.string()),
  isAllDay: fieldSchema(z.boolean()),
  /** IANA timezone identifier the times were resolved against — the capture-time
   * zone (NFR-9.3.4), never a naive local time (NFR-9.3.1). */
  timezone: z.string(),
  location: fieldSchema(z.string()),
  description: fieldSchema(z.string()),
  recurrence: RecurrenceSchema.nullable(),
  conferencing: ConferencingSchema.nullable(),
});

export type ParsedEvent = z.infer<typeof ParsedEventSchema>;

/** A single parse can produce many events (a roster photo, a syllabus dump). */
export const ParsedEventBatchSchema = z.array(ParsedEventSchema);
