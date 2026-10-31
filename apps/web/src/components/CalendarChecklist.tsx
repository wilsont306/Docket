"use client";

import { useEffect, useRef } from "react";
import type { CalendarListEntry } from "@/lib/google-calendar";
import { useOpenAnimation } from "@/lib/use-open-animation";

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

const FALLBACK_COLOR = "#4285f4";

/**
 * Google Calendar's own "My calendars" sidebar section, as a dropdown rather
 * than a persistent panel -- both places this is used (the composer's mini
 * calendar, the review pane's toolbar) are tight on vertical space, so the
 * list floats over the calendar instead of pushing it down. Checking/
 * unchecking a calendar changes which real calendars get merged into the
 * conflict/overlap display, same as Google Calendar's own visibility toggle.
 */
export function CalendarChecklist({
  calendars,
  checkedIds,
  onToggle,
  onToggleAll,
}: {
  calendars: CalendarListEntry[] | null;
  checkedIds: Set<string>;
  onToggle: (id: string) => void;
  /** true = check every calendar, false = uncheck every calendar. */
  onToggleAll: (checked: boolean) => void;
}) {
  const { open, mounted, visible, toggle, closeIt: close, handleTransitionEnd } = useOpenAnimation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  if (!calendars || calendars.length === 0) return null;

  const checkedCount = calendars.filter((c) => checkedIds.has(c.id)).length;
  const allChecked = checkedCount === calendars.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--rule)] bg-[var(--surf)] px-3 text-[12px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--rule2)]"
      >
        My calendars
        {/*
         * Fixed-width and always rendered (not conditionally) so the
         * button's own width -- and thus where the right-anchored dropdown
         * below lines up -- never shifts: not when going from "some" to
         * "all" checked, and not from one digit's glyph being narrower than
         * another's as individual calendars are toggled (tabular-nums pins
         * every digit to the same advance width; the fixed inline-block
         * width covers the parens themselves).
         */}
        <span
          className={`inline-block w-[26px] text-center tabular-nums text-[var(--ink3)] ${allChecked ? "invisible" : ""}`}
        >
          ({checkedCount})
        </span>
        <ChevronIcon className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {mounted && (
        <div
          onTransitionEnd={handleTransitionEnd}
          className={`absolute right-0 top-9 z-50 w-[230px] origin-top-right rounded-2xl border border-[var(--rule)] bg-[var(--surf)] p-1.5 shadow-[0_14px_34px_-14px_oklch(0.25_0.03_265_/_0.35)] transition-[opacity,transform] duration-150 ease-[cubic-bezier(.2,.6,.2,1)] ${
            visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          <button
            type="button"
            onClick={() => onToggleAll(!allChecked)}
            className="mb-0.5 flex w-full items-center rounded-xl border-b border-[var(--rule)] px-2.5 py-2 text-left text-[12.5px] font-medium text-[var(--accInk)] transition-colors hover:bg-[var(--sunk)]"
          >
            {allChecked ? "Deselect all" : "Select all"}
          </button>
          {calendars.map((cal) => {
            const checked = checkedIds.has(cal.id);
            const color = cal.backgroundColor ?? FALLBACK_COLOR;
            return (
              <label
                key={cal.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[var(--sunk)]"
              >
                <input type="checkbox" checked={checked} onChange={() => onToggle(cal.id)} className="sr-only" />
                <span
                  className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px] border-2"
                  style={checked ? { backgroundColor: color, borderColor: color } : { borderColor: color }}
                >
                  {checked && <CheckIcon className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="truncate text-[var(--ink)]">{cal.summary}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
