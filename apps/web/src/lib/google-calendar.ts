import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import type { ParsedEvent } from "@calendar-auto/core";
import { getDb } from "@/db";
import { googleCredentials } from "@/db/schema";
import { decrypt } from "@/lib/crypto";

export interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  colorId?: string;
}

/**
 * Exchanges the stored refresh token for a short-lived access token. This is
 * the read side of the M0 exit criterion ("read own calendar"); the refresh
 * token itself never leaves the server (FR-6.7.2).
 */
export async function getFreshAccessToken(userId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ encryptedRefreshToken: googleCredentials.encryptedRefreshToken })
    .from(googleCredentials)
    .where(eq(googleCredentials.userId, userId))
    .limit(1);

  if (!row) {
    throw new Error("No Google credentials on file for this user");
  }

  const refreshToken = decrypt(row.encryptedRefreshToken);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Google access token: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/** GET /api/calendar/events (§6.5) — read-only, no write path exists here. */
export async function listUpcomingEvents(userId: string, maxResults = 10): Promise<CalendarEvent[]> {
  const accessToken = await getFreshAccessToken(userId);

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("timeMin", new Date().toISOString());

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.error(`Google Calendar events.list failed: ${response.status} ${await response.text()}`);
    throw new Error("Failed to load your calendar. Please try again.");
  }

  const data = (await response.json()) as { items?: CalendarEvent[] };
  return data.items ?? [];
}

/** GET /api/calendar/events (§4.1.1) — the real calendar the review pane renders drafts against. */
export async function listEventsInRange(userId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const accessToken = await getFreshAccessToken(userId);

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    console.error(`Google Calendar events.list (range) failed: ${response.status} ${await response.text()}`);
    throw new Error("Failed to load your calendar. Please try again.");
  }

  const data = (await response.json()) as { items?: CalendarEvent[] };
  return data.items ?? [];
}

export interface Busy {
  start: string;
  end: string;
}

/** GET /api/calendar/freebusy (§4.6, §6.3 stage 6) — advisory conflict detection, never blocking. */
export async function queryFreeBusy(userId: string, timeMin: string, timeMax: string): Promise<Busy[]> {
  const accessToken = await getFreshAccessToken(userId);

  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
  });

  if (!response.ok) {
    console.error(`Google Calendar freebusy failed: ${response.status} ${await response.text()}`);
    throw new Error("Failed to check your calendar for conflicts.");
  }

  const data = (await response.json()) as { calendars?: Record<string, { busy?: Busy[] }> };
  return data.calendars?.primary?.busy ?? [];
}

/**
 * §7.3 field conformance / FR-6.7.5: every event this app creates carries a
 * private extended property tagging it as ours and pointing at the commit
 * that created it, which is what makes revert (§4.8.2) reliable without
 * having to guess which events on the calendar are "ours".
 */
function toGoogleEventBody(event: ParsedEvent, commitId: string): Record<string, unknown> {
  const isAllDay = event.isAllDay.value ?? false;
  const body: Record<string, unknown> = {
    summary: event.title.value ?? "(untitled event)",
    extendedProperties: {
      private: { calendarAuto: "true", calendarAutoCommitId: commitId },
    },
  };

  if (event.description.value) body.description = event.description.value;
  if (event.location.value) body.location = event.location.value;

  if (isAllDay) {
    const startDate = event.startDateTime.value!;
    const endDate = event.endDateTime.value ?? startDate;
    // Google's all-day end date is exclusive; ours is the last inclusive day.
    body.start = { date: startDate };
    body.end = { date: DateTime.fromISO(endDate).plus({ days: 1 }).toISODate() };
  } else {
    body.start = { dateTime: event.startDateTime.value, timeZone: event.timezone };
    body.end = { dateTime: event.endDateTime.value, timeZone: event.timezone };
  }

  if (event.recurrence) {
    const rrule = event.recurrence.rrule.startsWith("RRULE:")
      ? event.recurrence.rrule
      : `RRULE:${event.recurrence.rrule}`;
    body.recurrence = [rrule];
  }

  if (event.conferencing?.requestGoogleMeetLink) {
    body.conferenceData = {
      createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  } else if (event.conferencing?.url) {
    body.description = body.description ? `${body.description}\n\n${event.conferencing.url}` : event.conferencing.url;
  }

  return body;
}

/** POST /api/drafts/:id/commit (§6.5, §6.3 stage 9) — the only mutation in the system. */
export async function insertEvent(userId: string, event: ParsedEvent, commitId: string): Promise<string> {
  const accessToken = await getFreshAccessToken(userId);
  const body = toGoogleEventBody(event, commitId);

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  if (event.conferencing?.requestGoogleMeetLink) {
    url.searchParams.set("conferenceDataVersion", "1");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`Google Calendar events.insert failed: ${response.status} ${await response.text()}`);
    throw new Error("Failed to create the event on Google Calendar.");
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/** POST /api/commits/:id/revert (FR-4.7.4/FR-4.8.2). */
export async function deleteEvent(userId: string, googleEventId: string): Promise<void> {
  const accessToken = await getFreshAccessToken(userId);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );

  // 404/410 means it's already gone -- that's the outcome we wanted anyway.
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    console.error(`Google Calendar events.delete failed: ${response.status} ${await response.text()}`);
    throw new Error("Failed to delete the event from Google Calendar.");
  }
}
