import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { queryFreeBusy } from "@/lib/google-calendar";

/** GET /api/calendar/freebusy?timeMin=...&timeMax=... (§6.5, FR-4.6.1). */
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
    const busy = await queryFreeBusy(session.user.id, timeMin, timeMax);
    return NextResponse.json({ busy });
  } catch (error) {
    console.error("Failed to query freebusy:", error);
    return NextResponse.json({ error: "Failed to check your calendar for conflicts." }, { status: 502 });
  }
}
