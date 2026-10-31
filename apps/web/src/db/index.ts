import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy initialization: `neon()` throws if DATABASE_URL isn't set, and
// Next.js evaluates top-level module code at build time, so a module-level
// `neon(...)` call would crash `next build` before env vars are configured.
// A plain lazy `let` (not a Proxy) also avoids breaking Auth.js's adapter
// introspection later (M0.6).
let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}
