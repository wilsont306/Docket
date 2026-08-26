"use client";

import { DateTime } from "luxon";
import type { CalendarEvent } from "@/lib/google-calendar";

// Google Calendar's fixed 11-color event palette (FR-4.1.5: existing events
// stay recognizable at a glance rather than being reskinned by this app).
const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};
const DEFAULT_EVENT_COLOR = "#4285f4";

const HOUR_HEIGHT = 48;
const START_HOUR = 6;
const END_HOUR = 23;

export interface DraftBlock {
  id: string;
  title: string;
  start: DateTime;
  end: DateTime;
  allDay: boolean;
  lowConfidence: boolean;
  conflict: "none" | "overlap" | "duplicate";
}

function timeToOffset(dt: DateTime): number {
  return (dt.hour + dt.minute / 60 - START_HOUR) * HOUR_HEIGHT;
}

function isAllDayRealEvent(e: CalendarEvent): boolean {
  return !e.start?.dateTime && !!e.start?.date;
}

function realEventDay(e: CalendarEvent, timezone: string): DateTime | null {
  const iso = e.start?.dateTime ?? e.start?.date;
  return iso ? DateTime.fromISO(iso, { zone: timezone }) : null;
}

export function WeekCalendar({
  weekStart,
  timezone,
  realEvents,
  draftBlocks,
  selectedId,
  onSelectDraft,
}: {
  weekStart: DateTime;
  timezone: string;
  realEvents: CalendarEvent[];
  draftBlocks: DraftBlock[];
  selectedId: string | null;
  onSelectDraft: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }));
  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const hasAllDay = draftBlocks.some((d) => d.allDay) || realEvents.some(isAllDayRealEvent);

  return (
    <div className="flex w-full min-w-[700px] overflow-x-auto text-xs">
      {days.map((day) => {
        const dayRealEvents = realEvents.filter((e) => {
          const d = realEventDay(e, timezone);
          return d && d.hasSame(day, "day");
        });
        const dayAllDayReal = dayRealEvents.filter(isAllDayRealEvent);
        const dayTimedReal = dayRealEvents.filter((e) => !isAllDayRealEvent(e));

        const dayDrafts = draftBlocks.filter((d) => d.start.hasSame(day, "day"));
        const dayAllDayDrafts = dayDrafts.filter((d) => d.allDay);
        const dayTimedDrafts = dayDrafts.filter((d) => !d.allDay);

        return (
          <div key={day.toISODate()} className="relative flex-1 border-l border-zinc-800 first:border-l-0">
            <div className="sticky top-0 z-10 border-b border-zinc-800 bg-black p-1 text-center text-zinc-400">
              {day.toFormat("EEE d")}
            </div>

            {hasAllDay && (
              <div className="flex flex-col gap-0.5 border-b border-zinc-800 p-0.5">
                {dayAllDayReal.map((e) => (
                  <div
                    key={e.id}
                    className="truncate rounded px-1 py-0.5 text-white"
                    style={{ backgroundColor: e.colorId ? (GOOGLE_EVENT_COLORS[e.colorId] ?? DEFAULT_EVENT_COLOR) : DEFAULT_EVENT_COLOR }}
                    title={e.summary}
                  >
                    {e.summary}
                  </div>
                ))}
                {dayAllDayDrafts.map((d) => {
                  const isSelected = d.id === selectedId;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onSelectDraft(d.id)}
                      className="truncate rounded border-2 border-dashed px-1 py-0.5 text-left text-white"
                      style={{
                        borderColor: d.conflict !== "none" ? "#f59e0b" : isSelected ? "#ffffff" : "#93c5fd",
                        backgroundColor: "rgba(147, 197, 253, 0.25)",
                        boxShadow: isSelected ? "0 0 0 2px #ffffff" : undefined,
                      }}
                    >
                      {d.title}
                      {d.lowConfidence && <span className="ml-1" aria-label="needs review">⚠</span>}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="relative" style={{ height: gridHeight }}>
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div key={i} className="absolute left-0 right-0 border-t border-zinc-900" style={{ top: i * HOUR_HEIGHT }} />
              ))}

              {dayTimedReal.map((e) => {
                const start = e.start?.dateTime ? DateTime.fromISO(e.start.dateTime, { zone: timezone }) : day;
                const end = e.end?.dateTime ? DateTime.fromISO(e.end.dateTime, { zone: timezone }) : start.plus({ hours: 1 });
                const top = Math.max(0, timeToOffset(start));
                const height = Math.max(16, timeToOffset(end) - top);
                return (
                  <div
                    key={e.id}
                    className="absolute left-0.5 right-0.5 overflow-hidden rounded px-1 py-0.5 text-white"
                    style={{ top, height, backgroundColor: e.colorId ? (GOOGLE_EVENT_COLORS[e.colorId] ?? DEFAULT_EVENT_COLOR) : DEFAULT_EVENT_COLOR }}
                    title={e.summary}
                  >
                    {e.summary}
                  </div>
                );
              })}

              {dayTimedDrafts.map((d) => {
                const top = Math.max(0, timeToOffset(d.start));
                const height = Math.max(16, timeToOffset(d.end) - top);
                const isSelected = d.id === selectedId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onSelectDraft(d.id)}
                    className="absolute left-0.5 right-0.5 overflow-hidden rounded border-2 border-dashed px-1 py-0.5 text-left text-white"
                    style={{
                      top,
                      height,
                      borderColor: d.conflict !== "none" ? "#f59e0b" : isSelected ? "#ffffff" : "#93c5fd",
                      backgroundColor: "rgba(147, 197, 253, 0.25)",
                      boxShadow: isSelected ? "0 0 0 2px #ffffff" : undefined,
                    }}
                  >
                    {d.title}
                    {d.lowConfidence && <span className="ml-1" aria-label="needs review">⚠</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
