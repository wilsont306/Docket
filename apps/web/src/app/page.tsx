import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { CaptureShowcase } from "@/components/CaptureShowcase";

// M0 exit criterion: sign in with Google, read own calendar.
export default async function Home() {
  const session = await auth();
  // Only auto-redirect an already-signed-in visitor in production -- in
  // local dev this page needs to stay reachable on its own (checking the
  // sign-in screen itself, testing the "logged out" state) without having
  // to sign out first every time. Real users always get bounced straight
  // to the dashboard.
  if (session?.user?.id && process.env.NODE_ENV === "production") {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--paper)] px-6 py-14 text-[var(--ink)] sm:px-12 sm:py-20">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <div className="text-center lg:text-left">
          <div className="mx-auto h-4 w-4 rounded-[5px] bg-[var(--violet)] lg:mx-0" />
          <h1 className="mx-auto mt-6 max-w-xl text-[30px] font-bold leading-[1.15] tracking-[-0.03em] sm:text-[44px] sm:leading-[1.1] sm:tracking-[-0.035em] lg:mx-0">
            A schedule is already written.
            <br />
            You shouldn&apos;t have to type it twice.
          </h1>
          <p className="mx-auto mt-5 max-w-md text-[14.5px] leading-6 text-[var(--ink2)] lg:mx-0">
            Photograph a roster, paste a syllabus, share a screenshot, or say it out loud. Docket reads it into a real draft you
            check against your calendar before anything is saved.
          </p>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <button
              type="submit"
              className="mx-auto mt-8 flex h-[46px] items-center gap-3 rounded-xl bg-[var(--btn)] px-7 text-[14.5px] font-medium text-[var(--onBtn)] transition hover:brightness-95 active:brightness-90 lg:mx-0"
            >
              <span className="h-[9px] w-[9px] bg-white" />
              Sign in with Google
            </button>
          </form>
          <p className="mx-auto mt-4 max-w-md text-[12.5px] leading-5 text-[var(--ink3)] lg:mx-0">
            Two permissions: read your calendar so we can show it next to the parse, and add events after you confirm. Nothing
            else.
          </p>
        </div>

        <div className="flex justify-center lg:justify-end">
          <CaptureShowcase />
        </div>
      </div>

      <div className="mx-auto mt-14 flex max-w-5xl flex-col gap-6 border-t border-[var(--rule)] pt-6 text-left text-xs leading-5 text-[var(--ink2)] sm:flex-row sm:gap-9">
        <div className="flex-1">
          <div className="mb-1 font-semibold text-[var(--ink)]">Never silent</div>
          No event is created without an explicit confirm.
        </div>
        <div className="flex-1">
          <div className="mb-1 font-semibold text-[var(--ink)]">Never invented</div>
          Missing information is asked for, not guessed.
        </div>
        <div className="flex-1">
          <div className="mb-1 font-semibold text-[var(--ink)]">Never kept</div>
          Photos are deleted from our servers after 7 days.
        </div>
      </div>
    </main>
  );
}
