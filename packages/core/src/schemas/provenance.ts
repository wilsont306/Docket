import { z } from "zod";

/**
 * Where a parsed field's value came from in the source capture.
 * Image captures carry a bounding box in source-image coordinates (FR-3.1.5);
 * text captures carry a character span into the source text (FR-3.2.5).
 */
export const ImageProvenanceSchema = z.object({
  kind: z.literal("image"),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});

export const TextProvenanceSchema = z.object({
  kind: z.literal("text"),
  span: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
});

export const ProvenanceSchema = z.discriminatedUnion("kind", [
  ImageProvenanceSchema,
  TextProvenanceSchema,
]);

export type Provenance = z.infer<typeof ProvenanceSchema>;
