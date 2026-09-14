"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { DateTime } from "luxon";
import type { CalendarEvent } from "@/lib/google-calendar";

export interface CalendarRange {
  start: DateTime;
  end: DateTime;
}

/**
 * How long a fetched chunk is trusted before it's quietly refetched. The
 * cached copy is still shown instantly meanwhile (stale-while-revalidate) --
 * this only decides when to go looking for changes made elsewhere, e.g. in
 * Google Calendar itself in another tab.
 */
const TTL_MS = 5 * 60_000;

/**
 * Above this many days, a range is fetched as whole years rather than whole
 * months -- otherwise the year view would fan out into twelve month
 * requests, which is exactly the behaviour the chunking exists to prevent.
 */
const YEAR_CHUNK_THRESHOLD_DAYS = 45;

interface CacheEntry {
  events: CalendarEvent[];
  fetchedAt: number;
}

/**
 * The loaded chunks, treated as an external store the components subscribe
 * to rather than as state copied into each of them: the same data is read by
 * the review surface and the composer's mini calendar, and both should see
 * one answer. Module-level, so it also survives the review surface
 * unmounting and remounting as you move between the composer and a draft.
 */
const cache = new Map<string, CacheEntry>();
/** In-flight requests, so a chunk being prefetched and then navigated to fires one request, not two. */
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/** Stable identity for "nothing here", so a subscriber isn't re-rendered by a fresh [] each read. */
const NO_EVENTS: CalendarEvent[] = [];

/**
 * Bumped before subscribers are notified, so `useSyncExternalStore` has a
 * primitive snapshot to compare. Deriving an object in the snapshot instead
 * would allocate on every read and re-render forever.
 */
let cacheVersion = 0;

function emit() {
  cacheVersion += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Months for anything week- or month-sized, years above that -- see chunksFor. */
function chunkUnitFor(range: CalendarRange): "month" | "year" {
  return range.end.diff(range.start, "days").days > YEAR_CHUNK_THRESHOLD_DAYS ? "year" : "month";
}

/**
 * The unit actually fetched and cached.
 *
 * Fetching the visible range verbatim meant every week was its own cache key
 * and so its own request -- stepping through a month cost four round trips
 * to Google, and pressing the arrow faster than the neighbour prefetch could
 * keep up put a loading state on screen every time. Snapping to whole
 * calendar months instead means one fetch covers four or five weeks: after
 * the first, moving within the month is a pure cache read with no network at
 * all, and moving between months reuses the chunks the two views share.
 */
function chunksFor(range: CalendarRange): CalendarRange[] {
  const unit = chunkUnitFor(range);

  const chunks: CalendarRange[] = [];
  let cursor = range.start.startOf(unit);
  // `end` is exclusive everywhere in the calendar code, so a range landing
  // exactly on a boundary must not pull in the chunk beyond it.
  while (cursor < range.end) {
    chunks.push({ start: cursor, end: cursor.plus({ [unit]: 1 }) });
    cursor = cursor.plus({ [unit]: 1 });
  }
  return chunks;
}

/**
 * The chunk either side of the ones a range covers.
 *
 * Warming the *view's* neighbours isn't enough, and was the hole in the
 * first version of this: every week in the middle of a month has neighbours
 * inside that same month, so they resolve to the chunk already loaded and
 * nothing gets warmed at all. The month boundary was then always a cold
 * fetch -- stepping was instant for four weeks and then stalled, which is
 * exactly the delay this was supposed to remove. Warming the adjacent
 * chunks instead means the next month is already in hand long before you
 * reach it.
 */
function neighbourChunksFor(range: CalendarRange): CalendarRange[] {
  const unit = chunkUnitFor(range);
  const chunks = chunksFor(range);
  if (chunks.length === 0) return [];
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  return [
    { start: first.start.minus({ [unit]: 1 }), end: first.start },
    { start: last.end, end: last.end.plus({ [unit]: 1 }) },
  ];
}

/** The request for one chunk, which doubles as its cache key -- same window + same calendars means the same query string. */
function chunkKey(calendarIds: Iterable<string>, chunk: CalendarRange): string {
  const params = new URLSearchParams({
    timeMin: chunk.start.toUTC().toISO()!,
    timeMax: chunk.end.toUTC().toISO()!,
  });
  // Sorted so that checking calendars in a different order still hits the
  // same cache entry.
  for (const id of [...calendarIds].sort()) params.append("calendarId", id);
  return params.toString();
}

function load(query: string): Promise<void> {
  const existing = inFlight.get(query);
  if (existing) return existing;

  const request = fetch(`/api/calendar/events?${query}`)
    .then((res) => res.json())
    .then((data) => (data.events ?? NO_EVENTS) as CalendarEvent[])
    // A failed chunk is cached as empty on purpose: it's what the pane
    // showed before this cache existed, and it settles the chunk so the
    // loading indicator can't hang there forever. The TTL retries it.
    .catch(() => NO_EVENTS)
    .then((events) => {
      cache.set(query, { events, fetchedAt: Date.now() });
      inFlight.delete(query);
      emit();
    });

  inFlight.set(query, request);
  return request;
}

/**
 * Anything that changes the user's real calendar has to drop this, or the
 * pane keeps showing the calendar as it was before the change (§4.6's
 * overlap check would go on comparing drafts against stale events too).
 */
export function invalidateCalendarEvents() {
  cache.clear();
  emit();
}

/** Milliseconds an event occupies, for clipping a chunk down to the visible range. All-day events carry `date` instead of `dateTime`. */
function boundsOf(event: CalendarEvent): { start: number; end: number } | null {
  const startRaw = event.start?.dateTime ?? event.start?.date;
  const endRaw = event.end?.dateTime ?? event.end?.date;
  if (!startRaw) return null;
  const start = new Date(startRaw).getTime();
  const end = endRaw ? new Date(endRaw).getTime() : start;
  return Number.isNaN(start) || Number.isNaN(end) ? null : { start, end };
}

/**
 * Real Google Calendar events for the visible range.
 *
 * Fetching is done in whole-month (or whole-year) chunks and then clipped
 * back to `range`, so callers still only see the events they asked for while
 * navigation inside a chunk costs nothing. Once the visible chunks settle,
 * the caller's `prefetch` ranges *and* the chunks either side of the visible
 * ones are warmed in the background, so crossing a boundary is already in
 * hand by the time you reach it.
 *
 * A range whose chunks have never loaded reports `loading` and no events,
 * rather than holding the previous range's -- last week's meetings drawn
 * onto this week read as real appointments, which is worse than a blank grid
 * for the moment it takes to arrive.
 */
export function useCalendarEvents(
  calendarIds: Iterable<string>,
  range: CalendarRange,
  prefetch: CalendarRange[] = [],
): { events: CalendarEvent[]; loading: boolean } {
  // Every derived value below is a string or a number, so the memo and
  // effect dependencies are things React can compare by value -- the ranges
  // themselves are fresh Luxon objects on every render and would otherwise
  // invalidate everything each time.
  const ids = [...calendarIds].sort();
  const queryKey = chunksFor(range)
    .map((chunk) => chunkKey(ids, chunk))
    .join("\n");
  // Both the caller's neighbouring views and the chunks either side of the
  // visible ones -- see neighbourChunksFor for why the former alone leaves
  // every month boundary cold.
  const prefetchKey = [
    ...new Set(
      [...prefetch, ...neighbourChunksFor(range)].flatMap((r) => chunksFor(r).map((chunk) => chunkKey(ids, chunk))),
    ),
  ]
    .filter((query) => !queryKey.split("\n").includes(query))
    .join("\n");

  const rangeStartMs = range.start.toMillis();
  const rangeEndMs = range.end.toMillis();

  // Re-derived only when the store changes or the chunk set does, so the
  // snapshot identity stays stable between unrelated renders.
  const version = useSyncExternalStore(
    subscribe,
    () => cacheVersion,
    () => 0,
  );

  const { events, loading } = useMemo(() => {
    const entries = queryKey
      .split("\n")
      .filter(Boolean)
      .map((query) => cache.get(query));
    if (entries.length === 0 || entries.some((entry) => entry === undefined)) return { events: NO_EVENTS, loading: true };

    const from = rangeStartMs;
    const to = rangeEndMs;
    const seen = new Set<string>();
    const clipped: CalendarEvent[] = [];

    for (const entry of entries) {
      for (const event of entry!.events) {
        // An event spanning a chunk boundary is in both chunks.
        const identity = `${event.calendarId}:${event.id}`;
        if (seen.has(identity)) continue;
        const bounds = boundsOf(event);
        // Anything undateable is kept rather than dropped -- the consumers
        // already tolerate it, and silently losing an event is the worse bug.
        if (bounds && (bounds.end <= from || bounds.start >= to)) continue;
        seen.add(identity);
        clipped.push(event);
      }
    }
    return { events: clipped, loading: false };
    // `version` is read from the module-level cache rather than from this
    // scope, so the linter can't see that it's what makes a finished fetch
    // recompute this. Removing it would freeze the pane on its first answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, queryKey, rangeStartMs, rangeEndMs]);

  useEffect(() => {
    for (const query of queryKey.split("\n").filter(Boolean)) {
      const cached = cache.get(query);
      if (!cached || Date.now() - cached.fetchedAt >= TTL_MS) void load(query);
    }

    // Neighbours are warmed only once the visible chunks aren't competing
    // with them for the connection.
    const timer = setTimeout(() => {
      for (const query of prefetchKey.split("\n").filter(Boolean)) {
        const cached = cache.get(query);
        if (!cached || Date.now() - cached.fetchedAt >= TTL_MS) void load(query);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [queryKey, prefetchKey]);

  return { events, loading };
}
