import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEventsInRange } from "@/lib/calendar-cache";

/** GET /api/calendar/events?timeMin=...&timeMax=...&calendarId=...&calendarId=... (§6.5) — real events, merged across every checked calendar, for the review calendar pane. Repeat `calendarId` once per calendar; omitted entirely, defaults to "primary". */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const timeMin = searchParams.get("timeMin");
  const timeMax = searchParams.get("timeMax");
  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: "timeMin and timeMax query params are required" }, { status: 400 });
  }
  const calendarIds = searchParams.getAll("calendarId");

  try {
    const events = await getEventsInRange(session.user.id, timeMin, timeMax, calendarIds.length > 0 ? calendarIds : ["primary"]);
    return NextResponse.json({ events });
  } catch (error) {
    console.error("Failed to list calendar events:", error);
    return NextResponse.json({ error: "Failed to load your calendar." }, { status: 502 });
  }
}
