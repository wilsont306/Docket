import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { CaptureFlow } from "@/components/CaptureFlow";

/** The actual app -- signed-out visitors bounce to "/", which is the login page now, not a combined login/app screen. */
export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const db = getDb();
  const [settings] = await db
    .select({ theme: users.theme, autoConfirmEnabled: users.autoConfirmEnabled, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  return (
    <CaptureFlow
      userEmail={session.user.email ?? "wilsont@gmail.com"}
      userImage={settings?.avatarUrl ?? null}
      initialTheme={settings?.theme ?? "system"}
      initialAutoConfirm={settings?.autoConfirmEnabled ?? false}
    />
  );
}
