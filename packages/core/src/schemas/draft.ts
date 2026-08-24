import { z } from "zod";
import { ParsedEventSchema } from "./parsedEvent";
import { NeedsInputSchema } from "./needsInput";

/**
 * `userEditedFields` is what makes FR-4.2.5 enforceable: a re-parse merges
 * into the draft without clobbering anything the human already touched.
 * Entries are dot-paths into `ParsedEvent`, e.g. "title", "startDateTime".
 */
export const DraftEventSchema = z.object({
  id: z.string(),
  draftId: z.string(),
  event: ParsedEventSchema,
  userEditedFields: z.array(z.string()).default([]),
  conflictState: z.enum(["none", "overlap", "duplicate"]).default("none"),
  deleted: z.boolean().default(false),
});

export const DraftSchema = z.object({
  id: z.string(),
  parseRunId: z.string(),
  state: z.enum(["pending", "edited", "committed", "discarded"]),
  events: z.array(DraftEventSchema),
  needsInput: z.array(NeedsInputSchema),
});

export type DraftEvent = z.infer<typeof DraftEventSchema>;
export type Draft = z.infer<typeof DraftSchema>;
