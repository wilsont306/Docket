import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { googleCredentials } from "@/db/schema";
import { decrypt } from "@/lib/crypto";

export interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
}

/**
 * Exchanges the stored refresh token for a short-lived access token. This is
 * the read side of the M0 exit criterion ("read own calendar"); the refresh
 * token itself never leaves the server (FR-6.7.2).
 */
async function getFreshAccessToken(userId: string): Promise<string> {
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
