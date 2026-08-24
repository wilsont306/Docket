import { z } from "zod";
import { ProvenanceSchema } from "./provenance";

/**
 * Wraps every extracted field in the confidence + provenance + inferred
 * metadata the review surface (§4) needs: FR-4.3.1 (per-field confidence),
 * FR-4.4.1 (tap-to-reveal source), FR-4.4.3 (inferred fields are labeled and
 * say what they were inferred from, e.g. an end time derived from a default
 * duration).
 *
 * A field the model does not know is `value: null` with no fabricated guess
 * (§5.1) — absence is expressed by `value` being null, not by a plausible
 * placeholder.
 */
export function fieldSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
    provenance: ProvenanceSchema.nullable(),
    inferred: z.boolean().default(false),
    inferredFrom: z.string().nullable().default(null),
  });
}

export type Field<T> = {
  value: T | null;
  confidence: number;
  provenance: z.infer<typeof ProvenanceSchema> | null;
  inferred: boolean;
  inferredFrom: string | null;
};
