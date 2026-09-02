import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listCalendars } from "@/lib/google-calendar";

/** GET /api/calendars (§6.5) — every calendar (each flagged `writable`): the commit_target picker filters to writable ones, the "My calendars" visibility checklist shows all of them. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const calendars = await listCalendars(session.user.id);
    return NextResponse.json({ calendars });
  } catch (error) {
    console.error("Failed to list calendars:", error);
    return NextResponse.json({ error: "Failed to load your calendars." }, { status: 502 });
  }
}
