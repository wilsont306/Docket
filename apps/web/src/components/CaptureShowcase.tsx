import Image from "next/image";

/**
 * The login page's signature moment: a single CSS-only 9s loop (no JS, no
 * client component) that dramatizes the actual product loop -- a pasted
 * line of text gets read field by field, then resolves into a real event on
 * the calendar. Every layer shares one 9s timeline with explicit global
 * percentages so the parts stay in lockstep forever; see the
 * `showcase-*` keyframes in globals.css for the storyboard.
 */
export function CaptureShowcase() {
  return (
    <div className="relative w-full max-w-[380px] rounded-3xl border border-[var(--rule)] bg-[var(--surf)] p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.28)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Image src="/docket-logo.png" alt="" width={16} height={16} className="shrink-0" />
          <span className="text-[13px] font-semibold text-[var(--ink)]">docket</span>
        </div>
        <div className="relative h-[18px] w-[104px]">
          <StatusBadge anim="showcase-layer-source" dotColor="var(--violet)" textColor="var(--violetInk)" label="Reading…" />
          <StatusBadge anim="showcase-layer-confirmed" dotColor="var(--green)" textColor="var(--greenInk)" label="Added" />
        </div>
      </div>

      <div className="relative mt-4 h-[218px]">
        <div className="absolute inset-0 flex flex-col gap-2.5 [animation:showcase-layer-source_9s_ease-in-out_infinite]">
          <div className="rounded-xl border border-[var(--rule)] bg-[var(--sunk)] p-3 text-[12px] italic leading-[17px] text-[var(--ink2)]">
            &ldquo;Team standup every weekday 9am starting Monday&rdquo;
          </div>
          <div className="flex flex-1 flex-col justify-center gap-2.5 rounded-xl border border-[var(--rule)] bg-[var(--surf)] p-3">
            <FieldRow anim="showcase-field-title" label="Title" value="Team standup" />
            <FieldRow anim="showcase-field-time" label="Time" value="9:00 AM" />
            <FieldRow anim="showcase-field-date" label="Repeats" value="Weekdays" />
          </div>
        </div>

        <div className="absolute inset-0 flex flex-col justify-center gap-3 [animation:showcase-layer-confirmed_9s_ease-in-out_infinite]">
          <div className="rounded-xl border border-[var(--rule)] bg-[var(--sunk)] p-3.5">
            <div className="grid grid-cols-5 gap-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
            </div>
            <div className="mt-2.5 grid grid-cols-5 gap-2">
              <EventBar delayMs={0} />
              <EventBar delayMs={70} />
              <EventBar delayMs={140} />
              <EventBar delayMs={210} />
              <EventBar delayMs={280} />
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[var(--greenWash)] bg-[var(--greenWash)] px-3 py-2.5 text-[12px] font-medium text-[var(--greenInk)] [animation:showcase-confirm-pill_9s_ease-in-out_infinite]">
            <CheckIcon />
            9:00 AM, every weekday
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ anim, dotColor, textColor, label }: { anim: string; dotColor: string; textColor: string; label: string }) {
  return (
    <span
      className="absolute inset-0 flex items-center justify-end gap-1.5 text-[11px] font-medium"
      style={{ color: textColor, animation: `${anim} 9s ease-in-out infinite` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
      {label}
    </span>
  );
}

function FieldRow({ anim, label, value }: { anim: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between opacity-0 [animation-duration:9s] [animation-iteration-count:infinite] [animation-timing-function:ease-in-out]" style={{ animationName: anim }}>
      <div>
        <div className="text-[9.5px] font-semibold uppercase tracking-wide text-[var(--ink3)]">{label}</div>
        <div className="text-[13px] font-semibold text-[var(--ink)]">{value}</div>
      </div>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--greenWash)] text-[var(--greenInk)]">
        <CheckIcon small />
      </span>
    </div>
  );
}

function EventBar({ delayMs }: { delayMs: number }) {
  return (
    <div
      className="h-6 rounded-md bg-[var(--violet)] opacity-0 [animation-duration:9s] [animation-iteration-count:infinite] [animation-name:showcase-event-block] [animation-timing-function:ease-in-out]"
      style={{ animationDelay: `${delayMs}ms` }}
    />
  );
}

function CheckIcon({ small }: { small?: boolean }) {
  const size = small ? 11 : 14;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
