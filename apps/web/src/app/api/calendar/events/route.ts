import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listEventsInRange } from "@/lib/google-calendar";

/** GET /api/calendar/events?timeMin=...&timeMax=... (§6.5) — real events for the review calendar pane. */
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

  try {
    const events = await listEventsInRange(session.user.id, timeMin, timeMax);
    return NextResponse.json({ events });
  } catch (error) {
    console.error("Failed to list calendar events:", error);
    return NextResponse.json({ error: "Failed to load your calendar." }, { status: 502 });
  }
}
