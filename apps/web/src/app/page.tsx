import { MAX_EVENTS_PER_BATCH } from "@calendar-auto/core";
import { auth, signIn, signOut } from "@/auth";
import { listUpcomingEvents } from "@/lib/google-calendar";

// M0 exit criterion: sign in with Google, read own calendar.
export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Calendar Auto</h1>
        <form
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <button type="submit" className="rounded bg-zinc-800 px-4 py-2 text-sm text-white">
            Sign in with Google
          </button>
        </form>
      </main>
    );
  }

  let events: Awaited<ReturnType<typeof listUpcomingEvents>> = [];
  let error: string | null = null;
  try {
    events = await listUpcomingEvents(session.user.id!, 10);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load calendar";
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 p-8">
      <h1 className="text-xl font-semibold">Calendar Auto</h1>
      <p className="text-sm text-zinc-500">
        Signed in as {session.user.email} — workspace batch cap: {MAX_EVENTS_PER_BATCH}
      </p>
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button type="submit" className="text-xs text-zinc-400 underline">
          Sign out
        </button>
      </form>
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-zinc-500">No upcoming events found.</p>
      ) : (
        <ul className="w-full max-w-md space-y-2">
          {events.map((event) => (
            <li key={event.id} className="rounded border border-zinc-700 p-2 text-sm">
              <div className="font-medium">{event.summary ?? "(no title)"}</div>
              <div className="text-zinc-500">{event.start?.dateTime ?? event.start?.date}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
