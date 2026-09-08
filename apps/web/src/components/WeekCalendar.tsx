"use client";

import { DateTime } from "luxon";
import { useEffect, useRef, type CSSProperties } from "react";
import type { CalendarEvent } from "@/lib/google-calendar";
import { resolveEventColor } from "@/lib/event-color";
import { useMountReveal } from "@/lib/use-mount-reveal";

const HOUR_HEIGHT = 48;
const START_HOUR = 6;
const END_HOUR = 23;
const GUTTER_WIDTH = 44;
const HEADER_HEIGHT = 44;
// Capped, not left to grow with however many all-day events land on one day:
// this band is sticky (pinned while the hourly grid scrolls beneath it), so
// an unbounded height would let a day with several all-day events cover a
// chunk of the early morning hours as the user scrolls past them. Sized to
// comfortably fit ~4 stacked events (a busy but ordinary day) without
// needing to scroll; overflow-y-auto is the fallback for anything busier.
const ALL_DAY_MAX_HEIGHT = 120;

export interface DraftBlock {
  id: string;
  title: string;
  start: DateTime;
  end: DateTime;
  allDay: boolean;
  lowConfidence: boolean;
  conflict: "none" | "overlap" | "duplicate";
}

/** True for every day an all-day draft covers, not just its first -- a multi-day one claims each column it spans. */
function coversDay(block: DraftBlock, day: DateTime): boolean {
  return day.startOf("day") >= block.start.startOf("day") && day.startOf("day") <= block.end.startOf("day");
}

function timeToOffset(dt: DateTime, startHour: number): number {
  return (dt.hour + dt.minute / 60 - startHour) * HOUR_HEIGHT;
}

function isAllDayRealEvent(e: CalendarEvent): boolean {
  return !e.start?.dateTime && !!e.start?.date;
}

function realEventDay(e: CalendarEvent, timezone: string): DateTime | null {
  const iso = e.start?.dateTime ?? e.start?.date;
  return iso ? DateTime.fromISO(iso, { zone: timezone }) : null;
}

interface PositionedItem {
  key: string;
  start: DateTime;
  end: DateTime;
}

interface LaidOutItem<T extends PositionedItem> {
  item: T;
  column: number;
  totalColumns: number;
}

/**
 * FR-4.6: real and draft events sharing a time slot render side-by-side
 * instead of stacking full-width on top of each other -- previously the one
 * case the app calls out as a "conflict" was also the case where the layout
 * collapsed into an unreadable pile. Standard interval-overlap column
 * assignment, then a sweep to group transitively-overlapping items into
 * clusters so unrelated later events don't get squeezed by an earlier
 * cluster's column count.
 */
function layoutOverlaps<T extends PositionedItem>(items: T[]): LaidOutItem<T>[] {
  const sorted = [...items].sort((a, b) => a.start.toMillis() - b.start.toMillis() || a.end.toMillis() - b.end.toMillis());
  const columnEnds: DateTime[] = [];
  const withColumn = sorted.map((item) => {
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.end);
    } else {
      columnEnds[column] = item.end;
    }
    return { item, column };
  });

  const result: LaidOutItem<T>[] = [];
  let clusterStart = 0;
  let clusterEnd: DateTime | null = null;
  let clusterMaxColumn = 0;

  const flush = (endIndex: number) => {
    for (let i = clusterStart; i < endIndex; i++) {
      result.push({ item: withColumn[i].item, column: withColumn[i].column, totalColumns: clusterMaxColumn + 1 });
    }
  };

  withColumn.forEach(({ item, column }, index) => {
    if (clusterEnd === null || item.start < clusterEnd) {
      clusterEnd = clusterEnd === null || item.end > clusterEnd ? item.end : clusterEnd;
      clusterMaxColumn = Math.max(clusterMaxColumn, column);
    } else {
      flush(index);
      clusterStart = index;
      clusterEnd = item.end;
      clusterMaxColumn = column;
    }
  });
  flush(withColumn.length);

  return result;
}

/** Desktop passes 7 days (a week); the mobile day-strip view passes a single day. */
export function WeekCalendar({
  days,
  timezone,
  realEvents,
  calendarColors = {},
  draftBlocks,
  selectedId,
  onSelectDraft,
}: {
  days: DateTime[];
  timezone: string;
  realEvents: CalendarEvent[];
  /** Each source calendar's own color (from "My calendars"), keyed by calendarId -- an event with no per-event colorId falls back to this instead of one flat color for everything. */
  calendarColors?: Record<string, string | undefined>;
  draftBlocks: DraftBlock[];
  selectedId: string | null;
  onSelectDraft: (id: string) => void;
}) {
  const revealed = useMountReveal();
  // An all-day draft -- a due date, typically -- is drawn twice: its named
  // chip in the frozen band up top (where it can't be scrolled away or
  // covered), plus a wash claiming that whole day column below
  // (`allDayDraftsFor`), so a deadline reads as "this day is spoken for"
  // rather than as one thin line that's easy to miss. The full-column wash is
  // this pane's own emphasis; on Google Calendar the same event is an
  // ordinary all-day event in the all-day row.
  const hasAllDay = draftBlocks.some((d) => d.allDay) || realEvents.some(isAllDayRealEvent);
  const draftBlockRefs = useRef(new Map<string, HTMLElement>());
  const resolveColor = (e: CalendarEvent): string => resolveEventColor(e, calendarColors);

  // 6am-11pm covers most schedules, but a block outside that window (an
  // early-morning or late-night event) was previously just clamped to the
  // nearest edge with no indication it started/ended off-screen -- expand
  // the visible range instead of silently hiding where things actually are.
  const timedStarts: DateTime[] = [
    ...draftBlocks.filter((d) => !d.allDay).map((d) => d.start),
    ...realEvents.flatMap((e) => (isAllDayRealEvent(e) || !e.start?.dateTime ? [] : [DateTime.fromISO(e.start.dateTime, { zone: timezone })])),
  ];
  const timedEnds: DateTime[] = [
    ...draftBlocks.filter((d) => !d.allDay).map((d) => d.end),
    ...realEvents.flatMap((e) => (isAllDayRealEvent(e) || !e.end?.dateTime ? [] : [DateTime.fromISO(e.end.dateTime, { zone: timezone })])),
  ];
  const startHour = Math.floor(Math.min(START_HOUR, ...timedStarts.map((dt) => dt.hour + dt.minute / 60)));
  const endHour = Math.ceil(Math.max(END_HOUR, ...timedEnds.map((dt) => dt.hour + dt.minute / 60)));
  const gridHeight = (endHour - startHour) * HOUR_HEIGHT;

  // Selecting a draft from the card list (or re-selecting after a re-render)
  // should bring its slot into view -- otherwise picking an event outside
  // the default 6am-2pm-ish viewport just silently does nothing visible.
  useEffect(() => {
    if (!selectedId) return;
    draftBlockRefs.current.get(selectedId)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [selectedId]);

  const gridTemplateColumns = `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    // The day header and all-day bands are genuinely separate, non-scrolling
    // rows (not `position: sticky` inside the scrolling grid) -- sticky
    // content gets promoted to its own compositing layer, and in this nested
    // scroll-container setup that layer could paint outside its ancestor's
    // clip while scrolling (an absolutely-positioned event block bled
    // through above the header). A frozen header that's simply outside the
    // scrollable region entirely has no such layer to leak.
    <div className="flex h-full min-h-0 flex-col text-xs text-[var(--ink)]">
      <div className="grid shrink-0" style={{ gridTemplateColumns }}>
        <div className="border-b border-[var(--rule)] bg-[var(--sunk)]" style={{ height: HEADER_HEIGHT }} />
        {days.map((day) => (
          <div
            key={`header-${day.toISODate()}`}
            className="flex items-baseline justify-center gap-2 border-b border-l border-[var(--rule2)] bg-[var(--sunk)] px-1"
            style={{ height: HEADER_HEIGHT }}
          >
            <span className="text-[10.5px] uppercase tracking-[0.10em] text-[var(--ink3)]">{day.toFormat("EEE")}</span>
            <span className="text-lg font-bold">{day.toFormat("d")}</span>
          </div>
        ))}
      </div>

      {hasAllDay && (
        <div className="grid shrink-0" style={{ gridTemplateColumns }}>
          <div
            className="flex items-center justify-end overflow-hidden border-b border-[var(--rule2)] bg-[var(--sunk)] pr-2 py-1.5"
            style={{ height: ALL_DAY_MAX_HEIGHT }}
          >
            <span className="text-[10px] font-bold text-[var(--ink2)]">all day</span>
          </div>
          {days.map((day) => {
            const dayAllDayReal = realEvents.filter((e) => {
              const d = realEventDay(e, timezone);
              return d && d.hasSame(day, "day") && isAllDayRealEvent(e);
            });
            const dayAllDayDrafts = draftBlocks.filter((d) => d.allDay && coversDay(d, day));
            return (
              <div
                key={`allday-${day.toISODate()}`}
                className="flex flex-col gap-1 overflow-y-auto border-b border-l border-[var(--rule2)] bg-[var(--sunk)] p-1.5"
                style={{ height: ALL_DAY_MAX_HEIGHT }}
              >
                {dayAllDayReal.map((e) => (
                  <div
                    key={e.id}
                    className="truncate rounded-md px-1.5 py-0.5 text-white"
                    style={{ backgroundColor: resolveColor(e) }}
                    title={e.summary}
                  >
                    {e.summary}
                  </div>
                ))}
                {dayAllDayDrafts.map((d) => {
                  const isSelected = d.id === selectedId;
                  const draftIndex = draftBlocks.findIndex((b) => b.id === d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onSelectDraft(d.id)}
                      title={`${d.title} — all day`}
                      className={`shrink-0 truncate rounded-md px-1.5 py-1 text-left text-[10.5px] font-semibold text-[var(--accInk)] transition-all duration-500 ease-[cubic-bezier(.2,.6,.2,1)] hover:brightness-95 ${
                        revealed ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"
                      }`}
                      style={{
                        border: `${isSelected ? "2px dashed" : "1.5px dashed"} var(--acc)`,
                        background: "var(--accWash)",
                        transitionDelay: revealed ? `${draftIndex * 45}ms` : "0ms",
                      }}
                    >
                      {d.title}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns }}>
          <div className="relative" style={{ height: gridHeight }}>
            {Array.from({ length: endHour - startHour }, (_, i) => (
              <div
                key={i}
                className={`absolute right-2 font-mono text-[10px] text-[var(--ink3)] ${i === 0 ? "translate-y-0.5" : "-translate-y-1/2"}`}
                style={{ top: i * HOUR_HEIGHT }}
              >
                {DateTime.fromObject({ hour: (startHour + i + 24) % 24 }).toFormat("h a")}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayTimedReal: PositionedItem[] = realEvents.flatMap((e) => {
              if (isAllDayRealEvent(e) || !e.start?.dateTime) return [];
              const start = DateTime.fromISO(e.start.dateTime, { zone: timezone });
              if (!start.hasSame(day, "day")) return [];
              const end = e.end?.dateTime ? DateTime.fromISO(e.end.dateTime, { zone: timezone }) : start.plus({ hours: 1 });
              return [{ key: `real-${e.id}`, start, end }];
            });
            const dayTimedDrafts: PositionedItem[] = draftBlocks
              .filter((d) => !d.allDay && d.start.hasSame(day, "day"))
              .map((d) => ({ key: `draft-${d.id}`, start: d.start, end: d.end }));

            const laidOut = layoutOverlaps([...dayTimedReal, ...dayTimedDrafts]);
            const realById = new Map(realEvents.map((e) => [`real-${e.id}`, e]));
            const draftById = new Map(draftBlocks.map((d) => [`draft-${d.id}`, d]));
            const allDayDraftsFor = draftBlocks.filter((d) => d.allDay && coversDay(d, day));

            return (
              <div key={`grid-${day.toISODate()}`} className="relative border-l border-[var(--rule2)] bg-[var(--surf)]" style={{ height: gridHeight }}>
                {Array.from({ length: endHour - startHour }, (_, i) => (
                  // i===0's line would exactly double up the all-day row's own
                  // bottom border directly above it.
                  i > 0 && <div key={i} className="absolute left-0 right-0 border-t border-[var(--rule2)]" style={{ top: i * HOUR_HEIGHT }} />
                ))}

                {/* Rendered before the timed blocks so those paint on top of it:
                    the wash claims the day, it doesn't lid over whatever else
                    is scheduled in it. Deliberately unlabeled -- the draft's
                    name lives in the frozen band above, where nothing can
                    scroll it away or cover it; a second copy pinned inside the
                    column would collide with any early-morning event. */}
                {allDayDraftsFor.map((d, index) => {
                  const isSelected = d.id === selectedId;
                  const widthPct = 100 / allDayDraftsFor.length;
                  const draftIndex = draftBlocks.findIndex((b) => b.id === d.id);
                  return (
                    // No scroll-into-view ref: an all-day draft is already
                    // fully on screen in the frozen band, so selecting one
                    // shouldn't yank the hourly grid down to this column's
                    // midpoint.
                    <button
                      key={`allday-${d.id}`}
                      type="button"
                      onClick={() => onSelectDraft(d.id)}
                      title={`${d.title} — all day`}
                      aria-label={`${d.title} — all day`}
                      className="absolute rounded-lg transition-[opacity,transform,filter] duration-500 ease-[cubic-bezier(.2,.6,.2,1)] hover:brightness-95"
                      style={{
                        top: 0,
                        height: gridHeight,
                        left: `${index * widthPct}%`,
                        width: `calc(${widthPct}% - 2px)`,
                        border: `${isSelected ? "2.5px dashed" : "1.5px dashed"} var(--acc)`,
                        background: "color-mix(in oklch, var(--accWash) 62%, transparent)",
                        opacity: revealed ? 1 : 0,
                        transform: revealed ? "translateY(0)" : "translateY(6px)",
                        transitionDelay: revealed ? `${draftIndex * 45}ms` : "0ms",
                      }}
                    />
                  );
                })}

                {laidOut.map(({ item, column, totalColumns }) => {
                  const top = Math.max(0, timeToOffset(item.start, startHour));
                  const height = Math.max(16, timeToOffset(item.end, startHour) - top);
                  const widthPct = 100 / totalColumns;
                  const leftPct = column * widthPct;
                  const style: CSSProperties = { top, height, left: `${leftPct}%`, width: `calc(${widthPct}% - 2px)` };

                  const real = realById.get(item.key);
                  if (real) {
                    return (
                      <div
                        key={item.key}
                        className="absolute overflow-hidden rounded-lg border border-[var(--coolEdge)] bg-[var(--coolWash)] px-1.5 py-1 text-[var(--coolInk)]"
                        style={{ ...style, borderLeftWidth: 3, borderLeftColor: resolveColor(real) }}
                        title={real.summary}
                      >
                        <div className="flex items-center gap-1 overflow-hidden text-[11px] font-medium leading-tight">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: resolveColor(real) }} />
                          <span className="truncate">{real.summary}</span>
                        </div>
                        <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9.5px] opacity-85">
                          {item.start.toFormat("h:mm a")}
                        </div>
                      </div>
                    );
                  }

                  const draft = draftById.get(item.key);
                  if (!draft) return null;
                  const isSelected = draft.id === selectedId;
                  const draftIndex = draftBlocks.findIndex((b) => b.id === draft.id);
                  return (
                    <button
                      key={item.key}
                      ref={(el) => {
                        if (el) draftBlockRefs.current.set(draft.id, el);
                        else draftBlockRefs.current.delete(draft.id);
                      }}
                      type="button"
                      onClick={() => onSelectDraft(draft.id)}
                      className="absolute overflow-hidden rounded-lg px-1.5 py-1 text-left text-[var(--accInk)] transition-[opacity,transform,filter] duration-500 ease-[cubic-bezier(.2,.6,.2,1)] hover:brightness-95"
                      style={{
                        ...style,
                        border: `${isSelected ? "2.5px dashed" : "1.5px dashed"} var(--acc)`,
                        background: "var(--accWash)",
                        opacity: revealed ? 1 : 0,
                        transform: revealed ? "translateY(0)" : "translateY(6px)",
                        transitionDelay: revealed ? `${draftIndex * 45}ms` : "0ms",
                      }}
                    >
                      <div className="overflow-hidden text-[11px] font-semibold leading-tight">{draft.title}</div>
                      <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9.5px] opacity-85">
                        {draft.start.toFormat("h:mm a")} – {draft.end.toFormat("h:mm a")}
                      </div>
                      {draft.conflict !== "none" && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[var(--cool)]" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
