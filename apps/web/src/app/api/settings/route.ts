import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";

const THEMES = ["system", "light", "dark"] as const;

/** GET/PATCH /api/settings — the settings-menu preferences (theme, auto-confirm), stored per user so they follow across devices. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const [user] = await db
    .select({ theme: users.theme, autoConfirmEnabled: users.autoConfirmEnabled })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(user);
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const update: Partial<{ theme: (typeof THEMES)[number]; autoConfirmEnabled: boolean }> = {};

  if (body?.theme !== undefined) {
    if (!THEMES.includes(body.theme)) {
      return NextResponse.json({ error: `theme must be one of ${THEMES.join(", ")}` }, { status: 400 });
    }
    update.theme = body.theme;
  }
  if (body?.autoConfirmEnabled !== undefined) {
    if (typeof body.autoConfirmEnabled !== "boolean") {
      return NextResponse.json({ error: "autoConfirmEnabled must be a boolean" }, { status: 400 });
    }
    update.autoConfirmEnabled = body.autoConfirmEnabled;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Expected { theme } and/or { autoConfirmEnabled }" }, { status: 400 });
  }

  const db = getDb();
  const [updated] = await db
    .update(users)
    .set(update)
    .where(eq(users.id, session.user.id))
    .returning({ theme: users.theme, autoConfirmEnabled: users.autoConfirmEnabled });

  return NextResponse.json(updated);
}
