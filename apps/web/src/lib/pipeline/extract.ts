import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { ParsedEvent, Field } from "@calendar-auto/core";

/**
 * Pipeline stage 4 (§6.3). Claude Sonnet 5 is the PRD's choice for plain
 * text / short dictation — Opus 5 (vision) is reserved for the photo path
 * in M3.
 *
 * §6.1 specifies the Vercel AI Gateway for provider-agnostic routing and
 * observability. That requires a funded AI Gateway balance even for this
 * small a workload; until that's set up, extraction calls Anthropic
 * directly via ANTHROPIC_API_KEY, same model either way, so switching back
 * to the gateway string later is a one-line change.
 */
export const EXTRACTION_MODEL_ID = "claude-sonnet-5";
const extractionModel = process.env.ANTHROPIC_API_KEY
  ? anthropic(EXTRACTION_MODEL_ID)
  : `anthropic/${EXTRACTION_MODEL_ID}`;

/**
 * A deliberately flatter shape than the canonical ParsedEvent (§6.6) for the
 * model to fill in. Anthropic's structured-output API caps a schema at 16
 * nullable/union-typed parameters -- packages/core's per-field
 * {value, provenance, inferred, inferredFrom} nesting blows well past that
 * once multiplied across every field. So the model is asked for values and
 * confidences only; provenance spans are computed deterministically in
 * `toParsedEvent` below by searching for the returned value in the source
 * text, which is also more reliable than trusting a model's character-offset
 * arithmetic. Recurrence extraction is deferred past M1 (§12.5 already
 * flags recurrence as the highest-risk field, and its review UI is M2 scope).
 */
const ExtractionEventSchema = z.object({
  title: z.string().nullable(),
  titleConfidence: z.number().min(0).max(1),
  startDateTime: z.string().nullable(),
  startConfidence: z.number().min(0).max(1),
  endDateTime: z.string().nullable(),
  endConfidence: z.number().min(0).max(1),
  isAllDay: z.boolean(),
  location: z.string().nullable(),
  locationConfidence: z.number().min(0).max(1),
  description: z.string().nullable(),
  descriptionConfidence: z.number().min(0).max(1),
  /** A recognized Meet/Zoom/Teams/Webex link in the source, if any (FR-5.4.1). */
  conferencingUrl: z.string().nullable(),
});
const ExtractionBatchSchema = z.array(ExtractionEventSchema);
type ExtractionEvent = z.infer<typeof ExtractionEventSchema>;

export async function extractEventsFromText(
  sourceText: string,
  opts: { timezone: string; now: Date },
): Promise<ParsedEvent[]> {
  const { object } = await generateObject({
    model: extractionModel,
    schema: ExtractionBatchSchema,
    prompt: buildPrompt(sourceText, opts),
  });
  return object.map((event) => toParsedEvent(event, sourceText, opts.timezone));
}

function buildPrompt(sourceText: string, { timezone, now }: { timezone: string; now: Date }): string {
  return `You extract calendar events from arbitrary text: prose ("lunch with Sam next Thursday at 1"), structured invitations, or bare lists of times ("Mon 9-5 / Tue 12-8 / Wed off").

Current date/time: ${now.toISOString()}
User's timezone: ${timezone}

Rules:
- Resolve every relative date ("next Thursday", "tomorrow", "the 14th") against the current date above, in the user's timezone. Every startDateTime/endDateTime you output must be an ISO 8601 datetime with an explicit UTC offset consistent with "${timezone}" (or a plain ISO date for all-day events).
- "off", "—", "N/A", and blank entries are the ABSENCE of an event — do not emit an event for them.
- If you cannot determine an end time or duration, leave endDateTime null rather than guessing. Do not invent a location or description that isn't in the source — leave it null instead.
- Set each "*Confidence" to your actual confidence (0-1) in that field.
- Quote title/location/description values exactly as they appear in the source text where possible (verbatim substrings), since that's how their source highlight is found.
- conferencingUrl is only a literal Meet/Zoom/Teams/Webex URL found in the text, never invented.

Source text:
"""
${sourceText}
"""`;
}

function findSpan(sourceText: string, value: string): { start: number; end: number } | null {
  const index = sourceText.indexOf(value);
  return index === -1 ? null : { start: index, end: index + value.length };
}

function toTextField(value: string | null, confidence: number, sourceText: string): Field<string> {
  const span = value === null ? null : findSpan(sourceText, value);
  return {
    value,
    confidence,
    provenance: span ? { kind: "text", span } : null,
    inferred: false,
    inferredFrom: null,
  };
}

function guessConferencingProvider(url: string): "google_meet" | "zoom" | "teams" | "webex" | "other" {
  if (url.includes("meet.google.com")) return "google_meet";
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("teams.microsoft.com")) return "teams";
  if (url.includes("webex.com")) return "webex";
  return "other";
}

function toParsedEvent(extracted: ExtractionEvent, sourceText: string, timezone: string): ParsedEvent {
  return {
    title: toTextField(extracted.title, extracted.titleConfidence, sourceText),
    startDateTime: toTextField(extracted.startDateTime, extracted.startConfidence, sourceText),
    endDateTime: toTextField(extracted.endDateTime, extracted.endConfidence, sourceText),
    isAllDay: { value: extracted.isAllDay, confidence: 0.85, provenance: null, inferred: false, inferredFrom: null },
    timezone,
    location: toTextField(extracted.location, extracted.locationConfidence, sourceText),
    description: toTextField(extracted.description, extracted.descriptionConfidence, sourceText),
    recurrence: null,
    conferencing: extracted.conferencingUrl
      ? { provider: guessConferencingProvider(extracted.conferencingUrl), url: extracted.conferencingUrl, requestGoogleMeetLink: false }
      : null,
  };
}
