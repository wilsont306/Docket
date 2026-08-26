import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { captures, drafts, parseRuns } from "@/db/schema";

/** Joins drafts -> parse_runs -> captures to find who a draft belongs to. */
export async function getDraftOwnerId(draftId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ userId: captures.userId })
    .from(drafts)
    .innerJoin(parseRuns, eq(drafts.parseRunId, parseRuns.id))
    .innerJoin(captures, eq(parseRuns.captureId, captures.id))
    .where(eq(drafts.id, draftId))
    .limit(1);
  return row?.userId ?? null;
}
