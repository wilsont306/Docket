import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { googleCredentials, users } from "./db/schema";
import { encrypt } from "./lib/crypto";

/**
 * JWT session strategy with no database adapter: the stock Auth.js Drizzle
 * adapter's `accounts` table stores refresh tokens in plaintext, which
 * conflicts with FR-6.7.2 (encrypted at rest). Instead the `jwt` callback
 * below upserts our own `users`/`google_credentials` rows directly, so our
 * schema stays the single source of truth (§6.4) rather than a generic
 * adapter shape.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          // access_type + prompt=consent force a refresh_token on every
          // consent, not just the very first one (FR-6.7.2/§6.7).
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            // Without this, Google's ID token/userinfo omits `picture`
            // entirely (and `name`) -- not just gates it -- so the avatar
            // shown in the settings menu had nothing to read.
            "profile",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.readonly",
          ].join(" "),
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile?.sub && profile.email) {
        const db = getDb();
        // Placeholder until the client sends its detected IANA zone on
        // first load (tracked for M1); NFR-9.3.1 just requires an explicit
        // zone identifier rather than a naive local time, which "UTC" is.
        const timezone = "UTC";

        // Refreshed on every sign-in (not just the first) so a changed
        // Google avatar/email is picked up without needing any other code
        // path -- read straight from the `users` row wherever it's shown,
        // same as the theme/auto-confirm settings, rather than threading it
        // through the session/JWT (which only updates right after an OAuth
        // redirect, not on every request).
        const [user] = await db
          .insert(users)
          .values({ googleSub: profile.sub, email: profile.email, timezone, avatarUrl: profile.picture ?? null })
          .onConflictDoUpdate({
            target: users.googleSub,
            set: { email: profile.email, avatarUrl: profile.picture ?? null },
          })
          .returning();

        if (account.refresh_token) {
          const encryptedRefreshToken = encrypt(account.refresh_token);
          const [existing] = await db
            .select({ id: googleCredentials.id })
            .from(googleCredentials)
            .where(eq(googleCredentials.userId, user.id))
            .limit(1);
          if (existing) {
            await db
              .update(googleCredentials)
              .set({
                encryptedRefreshToken,
                scopes: account.scope?.split(" ") ?? [],
                grantedAt: new Date(),
              })
              .where(eq(googleCredentials.userId, user.id));
          } else {
            await db.insert(googleCredentials).values({
              userId: user.id,
              encryptedRefreshToken,
              scopes: account.scope?.split(" ") ?? [],
            });
          }
        }

        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});
