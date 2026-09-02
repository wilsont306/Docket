import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The core data model from PRD §6.4. `draft_events.event` stores the full
 * `ParsedEvent` shape from `@calendar-auto/core` — that schema already nests
 * per-field confidence and provenance inside each field (see
 * packages/core/src/schemas/field.ts), so it's kept as one jsonb column
 * rather than split into separate fields/confidence/provenance columns.
 */

export const captureKindEnum = pgEnum("capture_kind", ["photo", "text", "share", "voice"]);
export const captureStatusEnum = pgEnum("capture_status", ["pending", "parsing", "ready", "error"]);
export const draftStateEnum = pgEnum("draft_state", ["pending", "edited", "committed", "discarded"]);
export const conflictStateEnum = pgEnum("conflict_state", ["none", "overlap", "duplicate"]);
export const themeEnum = pgEnum("theme", ["system", "light", "dark"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull(),
  theme: themeEnum("theme").notNull().default("system"),
  /** Settings-menu "auto confirm": skip review entirely and commit straight to Google Calendar after parsing. */
  autoConfirmEnabled: boolean("auto_confirm_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** FR-6.7.2: the encrypted refresh token never leaves the server. */
export const googleCredentials = pgTable("google_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scopes: text("scopes").array().notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
});

/** FR-7.5.1: `purgeAfter` drives the Blob retention cron (Q1: fixed 7-day window). */
export const captures = pgTable("captures", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: captureKindEnum("kind").notNull(),
  blobKey: text("blob_key"),
  sourceText: text("source_text"),
  status: captureStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
});

/**
 * `railVerdicts` starts as `{ screened: false, reason: "guardrails not yet
 * deployed" }` until M6 wires the Python guardrails service in (§7.4:
 * parsing fails open with a flag). `promptVersion` is what lets an accuracy
 * regression be attributed to a specific prompt revision (§6.6).
 */
export const parseRuns = pgTable("parse_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  captureId: uuid("capture_id")
    .notNull()
    .references(() => captures.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  railVerdicts: jsonb("rail_verdicts").notNull().default({}),
  latencyMs: integer("latency_ms"),
  tokenUsage: jsonb("token_usage"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const drafts = pgTable("drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  parseRunId: uuid("parse_run_id")
    .notNull()
    .references(() => parseRuns.id, { onDelete: "cascade" }),
  state: draftStateEnum("state").notNull().default("pending"),
  /** §5.2 `calendar_target`: asked once per batch, remembered on the draft so commit and revert agree on where events live. */
  calendarId: text("calendar_id").notNull().default("primary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * `userEditedFields` is what makes FR-4.2.5 enforceable: a re-parse merges
 * into the draft without clobbering anything the human already touched.
 */
export const draftEvents = pgTable("draft_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  draftId: uuid("draft_id")
    .notNull()
    .references(() => drafts.id, { onDelete: "cascade" }),
  event: jsonb("event").notNull(),
  userEditedFields: text("user_edited_fields").array().notNull().default([]),
  conflictState: conflictStateEnum("conflict_state").notNull().default("none"),
  deleted: boolean("deleted").notNull().default(false),
});

/** The 8 clarifying-question types from §5.2; `payload` carries the type-specific fields. */
export const needsInput = pgTable("needs_input", {
  id: uuid("id").defaultRandom().primaryKey(),
  draftId: uuid("draft_id")
    .notNull()
    .references(() => drafts.id, { onDelete: "cascade" }),
  draftEventId: uuid("draft_event_id").references(() => draftEvents.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
});

/** FR-6.7.5: `googleEventIds` is what a revert (FR-4.8.2) deletes. */
export const commits = pgTable("commits", {
  id: uuid("id").defaultRandom().primaryKey(),
  draftId: uuid("draft_id")
    .notNull()
    .references(() => drafts.id, { onDelete: "cascade" }),
  /** Snapshotted from drafts.calendarId at commit time, so revert always targets the right calendar even if the draft's own field is touched afterward. */
  calendarId: text("calendar_id").notNull().default("primary"),
  googleEventIds: text("google_event_ids").array().notNull().default([]),
  committedAt: timestamp("committed_at", { withTimezone: true }).defaultNow().notNull(),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
});

/** FR-7.2.3: every rail decision, input and execution, is written here with its verdict and reason. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  subject: text("subject"),
  railDecisions: jsonb("rail_decisions"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});
