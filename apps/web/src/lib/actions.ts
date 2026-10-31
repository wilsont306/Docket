"use server";

import { signOut } from "@/auth";

/** Invoked directly from the client settings menu -- Next.js binds an imported server action to a POST under the hood, so no form/route is needed just to sign out. */
export async function logOutAction() {
  await signOut({ redirectTo: "/" });
}
