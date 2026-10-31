import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Docket",
  description: "Turn a photo, a paste, or a sentence into a correct calendar event.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Docket",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

/**
 * Resolves the user's stored theme preference server-side so the very first
 * paint is already correct for "light"/"dark" -- only "system" (or a
 * logged-out visitor) needs the blocking inline script below, since the
 * server has no way to know the client's OS preference.
 */
async function resolveServerTheme(): Promise<"light" | "dark" | "system"> {
  const session = await auth();
  if (!session?.user?.id) return "system";
  const db = getDb();
  const [user] = await db.select({ theme: users.theme }).from(users).where(eq(users.id, session.user.id)).limit(1);
  return user?.theme ?? "system";
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await resolveServerTheme();
  // A safe default before the inline script (if any) corrects it -- never left unset.
  const initialTheme = theme === "system" ? "light" : theme;

  return (
    <html
      lang="en"
      data-theme={initialTheme}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {theme === "system" && (
          <script
            // Blocking and inline on purpose -- runs before first paint so
            // a "system" preference never flashes the wrong theme.
            dangerouslySetInnerHTML={{
              __html:
                "document.documentElement.dataset.theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'",
            }}
          />
        )}
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
