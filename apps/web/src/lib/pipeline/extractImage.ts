import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Field, ParsedEvent } from "@calendar-auto/core";

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
- A deadline ("Homework 1 due 11:59 PM", an assignment or exam due date, "submit by") describes something that must happen by a point in time, not a scheduled block of time. Mark these isAllDay=true for the due date itself rather than inventing a timed block around the due time — but keep the specific due time from being lost by including it in the title (e.g. "Homework 1 (due 11:59 PM)").
- Set each "*Confidence" to your actual confidence (0-1) in that field, lower if the image is blurry or ambiguous at that spot.
- boundingBox is the normalized (0 to 1, relative to image width/height) rectangle around the row/cell/entry this event was read from, with (x, y) as the top-left corner.`;
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
    description: textField(extracted.description, extracted.descriptionConfidence),
    recurrence: null,
    conferencing: null,
  };
}
