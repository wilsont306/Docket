import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { googleCredentials } from "@/db/schema";
import { decrypt } from "@/lib/crypto";

/**
 * POST /api/connections/google/disconnect -- revokes the OAuth grant at
 * Google and deletes the stored refresh token. Doesn't sign the session out
 * itself (a Route Handler isn't the right place for that redirect-throwing
 * call) -- the client follows up with the existing `logOutAction` server
 * action once this succeeds, since Google is this app's sign-in and there's
 * no "logged in but disconnected" state to leave the user in.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const [row] = await db
    .select({ id: googleCredentials.id, encryptedRefreshToken: googleCredentials.encryptedRefreshToken })
    .from(googleCredentials)
    .where(eq(googleCredentials.userId, session.user.id))
    .limit(1);

  if (row) {
    try {
      const refreshToken = decrypt(row.encryptedRefreshToken);
      const revoke = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
      if (!revoke.ok) {
        console.error(`Google token revoke failed: ${revoke.status} ${await revoke.text()}`);
      }
    } catch (error) {
      console.error("Failed to revoke Google token:", error);
    }
    await db.delete(googleCredentials).where(eq(googleCredentials.id, row.id));
  }

  return NextResponse.json({ ok: true });
}
