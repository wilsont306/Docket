import { z } from "zod";

/**
 * §5.4: a recognized conferencing URL in the source populates this directly
 * (FR-5.4.1, no question asked). "requestGoogleMeetLink" is set when the
 * user answers a `virtual_or_physical` question with "add a Meet link"
 * (FR-5.4.3) — Google generates the real conferencing data on write.
 */
export const ConferencingSchema = z.object({
  provider: z.enum(["google_meet", "zoom", "teams", "webex", "other"]),
  url: z.string().url().nullable(),
  requestGoogleMeetLink: z.boolean().default(false),
});

export type Conferencing = z.infer<typeof ConferencingSchema>;
