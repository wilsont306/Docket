<p align="center">
  <img src="apps/web/public/docket-logo.png" alt="Docket" width="96" />
</p>

<h1 align="center">Docket</h1>

<p align="center">
  Turn photos, screenshots, pasted text and voice notes into Google Calendar events,<br />
  and check every one against your real calendar before anything is written.
</p>

<p align="center">
  Next.js 16 · TypeScript · Auth.js · Neon Postgres · Drizzle · Vercel AI SDK · Turborepo
</p>

---

## Why

Schedules arrive as pictures and prose, not data: a shift roster taped to a wall, a class table in a PDF, three lines in a group chat. The information is already there. What's left is transcription, which is slow and easy to get wrong.

Docket does the transcription and leaves the decision to you. Every extracted event lands as a **draft** next to your existing calendar, so you can see conflicts, fix anything the model got wrong, and commit only what you approve.

## Features

- **Four ways in.** Photograph a schedule, paste text, drop a screenshot, or dictate.
- **One photo, many events.** A twenty-shift roster becomes twenty drafts, each linked back to the region of the image it came from.
- **Review before write.** Drafts sit on a week, month or year view beside your real Google Calendar events, with conflicts flagged from free/busy data.
- **Follow-up questions.** If a capture is missing something, such as a time, a location, or whether a meeting is virtual, Docket asks instead of guessing.
- **Commit and undo.** Approved drafts are written to the calendar you pick. Every commit is kept in a history and can be reverted.
- **Installable.** Works as a home-screen PWA on mobile.

## How it works

```
capture ──▶ extract ──▶ resolve ──▶ review ──▶ commit
 photo       LLM reads    dates,       drafts on    Google Calendar
 text        it into      timezones,   your week,   write, with
 screenshot  typed        recurrence   conflicts    history and
 dictation   events       & questions  flagged      revert
```

1. **Capture.** Images are downscaled and orientation-corrected in the browser, then stored in Vercel Blob. Dictation is transcribed server-side.
2. **Extract.** Text goes to Claude Sonnet and images to Claude Opus (vision) through the Vercel AI SDK. Both return structured output validated against shared Zod schemas.
3. **Resolve.** `packages/core` normalizes timezones and recurrence rules, scores confidence, and generates follow-up questions for missing fields.
4. **Review.** The UI pulls your calendars and free/busy data so each draft is shown in context.
5. **Commit.** Events are written through the Google Calendar API and logged so they can be reverted.

## Security

- Google refresh tokens are **encrypted at rest** (AES-256-GCM) and never sent to the client.
- Every API route requires a session and checks **object ownership**. A draft, capture or commit that isn't yours returns 403.
- **Safety validators** from `packages/core` run when drafts are saved and again at commit. Docket only inserts events and never edits or deletes yours, sends no invites unless you opt in, rejects implausible dates, and caps events per batch, whatever the model returned.

## Project layout

```
apps/
  web/              Next.js app: UI, API routes, Auth.js, extraction pipeline
  mobile/           Expo iOS client (planned)
packages/
  core/             Zod schemas, timezone and recurrence helpers, safety validators (Vitest)
  api-client/       Typed client shared by web and mobile
  ui-tokens/        Color, type and spacing tokens
docs/PRD.md         Full product requirements
```

## Run locally

Requires Node 22+ and pnpm.

```bash
pnpm install
```

Create `apps/web/.env.local`:

```bash
DATABASE_URL=postgres://...            # Neon connection string
AUTH_SECRET=...                        # openssl rand -base64 32
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=...               # openssl rand -base64 32 (must decode to 32 bytes)
AI_GATEWAY_API_KEY=...                 # or ANTHROPIC_API_KEY for direct model access
BLOB_READ_WRITE_TOKEN=...              # Vercel Blob, for captured images
```

The Google OAuth client needs the `calendar.events` and `calendar.readonly` scopes, with `http://localhost:3000/api/auth/callback/google` as a redirect URI.

```bash
pnpm --filter web db:push    # create the tables
pnpm dev                     # http://localhost:3000
```

Run the checks:

```bash
pnpm typecheck
pnpm test
```

## Status

The web app covers capture, extraction, review, follow-up questions, commit, history and revert. The native iOS client and share extension are next. See [`docs/PRD.md`](docs/PRD.md) for the full plan.
