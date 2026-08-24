import { MAX_EVENTS_PER_BATCH } from "@calendar-auto/core";

// Throwaway placeholder proving apps/web resolves @calendar-auto/core through
// the turbo/pnpm workspace link (M0.3). Replaced with the real sign-in +
// calendar-list page at M0.6.
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-xl font-semibold">Calendar Auto</h1>
      <p className="text-sm text-zinc-500">
        Workspace link OK — batch cap from @calendar-auto/core: {MAX_EVENTS_PER_BATCH}
      </p>
    </main>
  );
}
