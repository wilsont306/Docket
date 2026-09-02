import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { buildRecurrence, type ParsedEvent, type Field } from "@calendar-auto/core";

const RECURRENCE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

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
 * arithmetic. Recurrence is extracted as a small structured description
 * (frequency/days/until) rather than a raw RRULE string -- §12.5 calls
 * recurrence the highest-risk field, so the actual RRULE syntax is always
 * built deterministically (packages/core's `buildRecurrence`), never
 * trusted verbatim from the model.
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
  /** False for personal/solo activities where "where is this?" wouldn't make sense (sleeping, a workout, a reminder) -- see buildPrompt. Not part of ParsedEvent; only steers whether resolve.ts asks a location_missing question. */
  locationExpected: z.boolean(),
  /** Null when the source doesn't describe a repeating pattern. */
  recurrenceFrequency: z.enum(["daily", "weekly", "monthly", "yearly"]).nullable(),
  /** Only meaningful when recurrenceFrequency is "weekly"; null means "same day as the event's own start date". */
  recurrenceDays: z.array(z.enum(RECURRENCE_DAYS)).nullable(),
  /** ISO date, only if the source stated an explicit end ("until Dec 12", "through the semester"). */
  recurrenceUntil: z.string().nullable(),
  /** Every N units of recurrenceFrequency -- 2 for "every other day"/"biweekly", null (meaning 1) for a plain "every day"/"weekly". */
  recurrenceInterval: z.number().int().min(1).nullable(),
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
- If the source explicitly describes the event itself as virtual/online/remote (e.g. "virtual meeting", "online class", "remote standup") but gives no specific address, room, or URL, set location to the literal word describing that (e.g. "Virtual") instead of leaving it null — the source has already told you where it is, even without a precise address, so this isn't a location_missing case.
- A deadline ("Homework 1 due 11:59 PM", "submit by Friday", an exam or assignment due date) describes something that must happen by a point in time, not a scheduled block of time. Mark these isAllDay=true for the due date itself rather than inventing a timed block around the due time — but keep the specific due time from being lost by including it in the title (e.g. "Homework 1 (due 11:59 PM)").
- Set each "*Confidence" to your actual confidence (0-1) in that field.
- Quote title/location/description values exactly as they appear in the source text where possible (verbatim substrings), since that's how their source highlight is found.
- conferencingUrl is only a literal Meet/Zoom/Teams/Webex URL found in the text, never invented.
- locationExpected is false for a plain note, task, or reminder, and for personal/solo activities where a "where is this?" follow-up question wouldn't make sense -- sleeping, a workout or run, screen time, a break. It's true for anything else that plausibly happens somewhere, even if that place wasn't stated in the text (a meeting, class, appointment, meal with someone, or call with a named person).
- recurrenceFrequency is only set when the text clearly describes a repeating event ("every Tuesday", "weekly meeting", "MWF lecture", "daily standup", "annual review", "monthly 1:1") -- leave it null for a one-time event, and null rather than guessing if it's ambiguous whether something repeats at all. A yearly-recurring event ("annual", "anniversary", "every year") is recurrenceFrequency "yearly", not a one-time all-day event. recurrenceDays is the set of weekdays it repeats on (e.g. ["MO","WE","FR"] for "MWF") when recurrenceFrequency is "weekly" and specific days were stated; leave it null if only one day is implied (the event's own start date) or the days weren't specified. recurrenceUntil is the ISO date it stops repeating, only if an explicit end was stated ("until Dec 12", "through the end of the semester" -- infer the actual date only if the semester end date is otherwise given in the text, never invent one). recurrenceInterval is how many units of recurrenceFrequency apart each occurrence is -- 2 for "every other day"/"every other week"/"biweekly"/"every 2 weeks", 3 for "every third month", and so on; leave it null for a plain "every day"/"every Tuesday" (which means 1, not "no recurrence"). Never force an interval-based pattern into recurrenceFrequency "daily"/"weekly" without setting recurrenceInterval -- "every other day" is daily with interval 2, not plain daily. An ordinal-weekday-of-month pattern ("the first Monday of every month", "the last Friday of the month", "the second Tuesday") cannot be represented by this schema at all (there's no way to express "which occurrence of that weekday") -- leave recurrenceFrequency null for these rather than emitting a plain "monthly" recurrence, which would silently repeat on the wrong days starting the second month.

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
    locationApplicable: extracted.locationExpected,
    description: toTextField(extracted.description, extracted.descriptionConfidence, sourceText),
    recurrence: extracted.recurrenceFrequency
      ? buildRecurrence(extracted.recurrenceFrequency, extracted.recurrenceDays, extracted.recurrenceUntil, extracted.recurrenceInterval)
      : null,
    conferencing: extracted.conferencingUrl
      ? { provider: guessConferencingProvider(extracted.conferencingUrl), url: extracted.conferencingUrl, requestGoogleMeetLink: false }
      : null,
  };
}
