import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { buildRecurrence, type Field, type ParsedEvent } from "@calendar-auto/core";

const RECURRENCE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * Pipeline stage 4 (§6.3) for the photo path. Claude Opus 5 is the PRD's
 * choice for vision — the spatial reasoning a roster grid demands (§6.6).
 * Same funded-balance fallback as the text path (extract.ts) applies here.
 */
export const VISION_MODEL_ID = "claude-opus-5";
const visionModel = process.env.ANTHROPIC_API_KEY ? anthropic(VISION_MODEL_ID) : `anthropic/${VISION_MODEL_ID}`;

/**
 * As with the text extractor, this is flatter than the canonical ParsedEvent
 * to stay under Anthropic's 16-nullable-parameter schema cap. Unlike text,
 * there's no deterministic way to compute provenance after the fact for an
 * image, so the model is asked for it directly -- but per-event rather than
 * per-field (FR-3.1.5 calls for per-field bounding boxes; per-event is a
 * deliberate M3-stage-1 simplification to stay within the schema budget
 * alongside the value/confidence pairs every field already needs).
 */
const BoundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

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
  /** Normalized (0-1) region of the image this event's row/cell came from. */
  boundingBox: BoundingBoxSchema,
  /** False for personal/solo activities where "where is this?" wouldn't make sense (sleeping, a workout, a reminder) -- see buildPrompt. Not part of ParsedEvent; only steers whether resolve.ts asks a location_missing question. */
  locationExpected: z.boolean(),
  /** Null when the row/cell doesn't describe a repeating pattern (a class/shift schedule usually does). */
  recurrenceFrequency: z.enum(["daily", "weekly", "monthly", "yearly"]).nullable(),
  /** Only meaningful when recurrenceFrequency is "weekly"; null means "same day as the event's own start date". */
  recurrenceDays: z.array(z.enum(RECURRENCE_DAYS)).nullable(),
  /** ISO date, only if the source stated an explicit end (a semester end date printed elsewhere on the schedule). */
  recurrenceUntil: z.string().nullable(),
  /** Every N units of recurrenceFrequency -- 2 for a biweekly shift pattern, null (meaning 1) otherwise. */
  recurrenceInterval: z.number().int().min(1).nullable(),
});
const ExtractionBatchSchema = z.array(ExtractionEventSchema);
type ExtractionEvent = z.infer<typeof ExtractionEventSchema>;

export async function extractEventsFromImage(
  imageBase64: string,
  mediaType: string,
  opts: { timezone: string; now: Date },
): Promise<ParsedEvent[]> {
  const { object } = await generateObject({
    model: visionModel,
    schema: ExtractionBatchSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(opts) },
          { type: "image", image: imageBase64, mediaType },
        ],
      },
    ],
  });
  return object.map((event) => toParsedEvent(event, opts.timezone));
}

function buildPrompt({ timezone, now }: { timezone: string; now: Date }): string {
  return `You extract calendar events from a photographed schedule: a shift roster, a class schedule, a printed table, or a handwritten list. Grid layouts are common -- the day and time axes may be implied by a row/column's position rather than stated in each cell.

Current date/time: ${now.toISOString()}
User's timezone: ${timezone}

Rules:
- Resolve every date against the current date above, in the user's timezone. Every startDateTime/endDateTime you output must be an ISO 8601 datetime with an explicit UTC offset consistent with "${timezone}" (or a plain ISO date for all-day events).
- "off", "—", "N/A", and blank cells are the ABSENCE of an event — do not emit an event for them.
- If the grid contains rows for multiple people and it is not obvious which row belongs to the user, extract every row rather than guessing whose it is.
- If you cannot determine an end time or duration, leave endDateTime null rather than guessing. Do not invent a location or description that isn't legible in the image.
- If the image explicitly labels the event itself as virtual/online/remote (e.g. "virtual meeting", "online class", "remote standup") but shows no specific address, room, or URL, set location to the literal word describing that (e.g. "Virtual") instead of leaving it null — the source has already said where it is, even without a precise address, so this isn't a location_missing case.
- A deadline ("Homework 1 due 11:59 PM", an assignment or exam due date, "submit by") describes something that must happen by a point in time, not a scheduled block of time. Mark these isAllDay=true for the due date itself rather than inventing a timed block around the due time — but keep the specific due time from being lost by including it in the title (e.g. "Homework 1 (due 11:59 PM)").
- Set each "*Confidence" to your actual confidence (0-1) in that field, lower if the image is blurry or ambiguous at that spot.
- boundingBox is the normalized (0 to 1, relative to image width/height) rectangle around the row/cell/entry this event was read from, with (x, y) as the top-left corner.
- locationExpected is false for a plain note, task, or reminder, and for personal/solo activities where a "where is this?" follow-up question wouldn't make sense -- sleeping, a workout or run, a break. It's true for anything else that plausibly happens somewhere, even if that place isn't legible in the image (a class, shift, appointment, or meeting).
- recurrenceFrequency is set whenever a row/cell clearly repeats -- a class meeting pattern like "MWF" or "TuTh", a recurring weekly shift, a daily standup, an annual review. Leave it null for a genuinely one-time entry (an exam date, a single deadline). recurrenceDays is the specific weekdays (e.g. ["MO","WE","FR"] for "MWF") when recurrenceFrequency is "weekly" and the days are legible; leave it null if only one day is implied or the days aren't stated. recurrenceUntil is the ISO date it stops, only if an explicit end date is legible elsewhere on the schedule (e.g. a printed semester end date) -- never invent one. recurrenceInterval is how many units of recurrenceFrequency apart each occurrence is -- 2 for a biweekly shift pattern ("every other week"), null for a plain weekly/daily one (which means 1, not "no recurrence"). An ordinal-weekday-of-month pattern ("the first Monday of every month", "the last Friday of the month") cannot be represented by this schema at all -- leave recurrenceFrequency null for these rather than emitting a plain "monthly" recurrence, which would silently repeat on the wrong days starting the second month.`;
}

function toParsedEvent(extracted: ExtractionEvent, timezone: string): ParsedEvent {
  const provenance = { kind: "image" as const, boundingBox: extracted.boundingBox };

  function textField(value: string | null, confidence: number): Field<string> {
    return { value, confidence, provenance: value === null ? null : provenance, inferred: false, inferredFrom: null };
  }

  return {
    title: textField(extracted.title, extracted.titleConfidence),
    startDateTime: textField(extracted.startDateTime, extracted.startConfidence),
    endDateTime: textField(extracted.endDateTime, extracted.endConfidence),
    isAllDay: { value: extracted.isAllDay, confidence: 0.85, provenance: null, inferred: false, inferredFrom: null },
    timezone,
    location: textField(extracted.location, extracted.locationConfidence),
    locationApplicable: extracted.locationExpected,
    description: textField(extracted.description, extracted.descriptionConfidence),
    recurrence: extracted.recurrenceFrequency
      ? buildRecurrence(extracted.recurrenceFrequency, extracted.recurrenceDays, extracted.recurrenceUntil, extracted.recurrenceInterval)
      : null,
    conferencing: null,
  };
}
