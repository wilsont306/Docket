import { z } from "zod";

/**
 * §12.5: recurrence is the largest error surface — an inferred RRULE that's
 * wrong produces many wrong events, not one. Policy: recurrence is always
 * treated as low-confidence and always shown in plain language for review,
 * regardless of the model's own confidence score.
 */
export const RecurrenceSchema = z.object({
  /** RFC 5545 RRULE string. */
  rrule: z.string(),
  /** e.g. "every Tuesday and Thursday until Dec 12" (US-2.2). */
  plainLanguage: z.string(),
  confidence: z.number().min(0).max(1),
});

export type Recurrence = z.infer<typeof RecurrenceSchema>;
