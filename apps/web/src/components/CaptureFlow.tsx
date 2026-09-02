"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { DateTime } from "luxon";
import { ReviewSurface, type CaptureSource } from "./ReviewSurface";
import type { DraftEventRow } from "./DraftCard";
import { WeekCalendar, type DraftBlock } from "./WeekCalendar";
import { SettingsMenu, type Theme } from "./SettingsMenu";
import { CommitHistoryView } from "./CommitHistoryView";
import { CalendarChecklist } from "./CalendarChecklist";
import { CalendarViewSwitcher } from "./CalendarViewSwitcher";
import { MonthGrid } from "./MonthGrid";
import { YearGrid } from "./YearGrid";
import { viewRange, shiftAnchor, viewLabel, type CalendarViewMode } from "@/lib/calendar-view";
import type { CalendarEvent, CalendarListEntry } from "@/lib/google-calendar";
import { preprocessImage } from "@/lib/image-preprocess";
import { useMountReveal } from "@/lib/use-mount-reveal";

interface CommitResult {
  id: string;
  googleEventIds: string[];
  failures: Array<{ error: string }>;
}

type CaptureTab = "photo" | "text" | "share" | "voice";

type Phase =
  | { name: "capture" }
  | { name: "review"; draftId: string; events: DraftEventRow[]; calendarId: string; source: CaptureSource | null }
  | { name: "committed"; result: CommitResult; secondsLeft: number }
  | { name: "history" };

interface HistoryEntry {
  id: string;
  kind: CaptureTab;
  label: string;
  state: "parsing" | "ready" | "error";
  /** Set once parsing succeeds -- lets a past capture be reopened for review instead of being orphaned once you navigate back to the composer. */
  draftId?: string;
  /** Set on failure -- shown inline on the bubble instead of navigating to a separate error page. */
  errorMessage?: string;
}

/** A parsed event with neither a stated location nor a detected virtual-meeting link (§5.2 `location_missing`). */
interface LocationQuestion {
  id: string;
  draftEventId: string;
  title: string;
}

interface PendingReview {
  draftId: string;
  events: DraftEventRow[];
  calendarId: string;
  source: CaptureSource | null;
}

const DEFAULT_TRANSCRIPT = "follow-up with Dr. Patel on the 14th at 3, same office";

const EXAMPLE_PRESETS = [
  {
    label: "Weekly class schedule",
    text: "MATH 221 — Fall 2026\nLecture: MWF 10:00–10:50, Rockefeller 220 (Aug 31 – Dec 11)\nOffice hours: Wed 2–3:30, Rockefeller 118\nPS1 due Friday Sept 4 at 11:59pm\nMidterm 1 — Oct 2, 6–8, Uris Auditorium\nNo class during reading week.",
  },
  {
    label: "Team practice roster",
    text: "Practice schedule:\nMon: Basketball 4–6pm, Fieldhouse\nWed: Soccer 5–7pm, Turf 2\nFri: Basketball 4–6pm, Fieldhouse\nSat: Scrimmage 10am, Fieldhouse",
  },
  {
    label: "Exam timetable",
    text: "Final exams:\nCHEM 101 — Dec 15, 9am, Hall A\nPHYS 210 — Dec 17, 1pm, Hall B\nHIST 105 — Dec 18, 9am, Hall C",
  },
  {
    label: "Project deadlines",
    text: "Project deadlines:\nProposal due Sept 20\nDraft due Oct 15\nFinal submission Nov 30 at 11:59pm",
  },
] as const;

const STAGES: Record<CaptureTab, Array<[string, string]>> = {
  photo: [
    ["Capture", "image"],
    ["Normalize", "de-skewing"],
    ["Screen", "checking source"],
    ["Extract", "reading events"],
    ["Resolve", "dates and timezone"],
    ["Conflicts", "calendar overlap check"],
  ],
  text: [
    ["Capture", "text/plain"],
    ["Normalize", "no change"],
    ["Screen", "checking source"],
    ["Extract", "reading events"],
    ["Resolve", "dates and recurrence"],
    ["Conflicts", "calendar overlap check"],
  ],
  share: [
    ["Capture", "share sheet"],
    ["Normalize", "screenshot"],
    ["Screen", "checking source"],
    ["Extract", "reading event"],
    ["Resolve", "link kept"],
    ["Conflicts", "calendar overlap check"],
  ],
  voice: [
    ["Capture", "audio transcript"],
    ["Normalize", "speech to text"],
    ["Screen", "checking source"],
    ["Extract", "reading event"],
    ["Resolve", "relative date"],
    ["Conflicts", "calendar overlap check"],
  ],
};

/**
 * §11 M2/M3 exit criteria: "Full review loop on web" and "Roster photo ->
 * correct batch." Owns the capture -> review -> commit state machine across
 * input paths; the review step itself is ReviewSurface.
 */
export function CaptureFlow({
  userEmail,
  userImage,
  initialTheme,
  initialAutoConfirm,
}: {
  userEmail: string;
  userImage: string | null;
  initialTheme: Theme;
  initialAutoConfirm: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "capture" });
  const [autoConfirmEnabled, setAutoConfirmEnabled] = useState(initialAutoConfirm);
  const [composerText, setComposerText] = useState("");
  const [composerKind, setComposerKind] = useState<"text" | "voice">("text");
  const [attachedPhoto, setAttachedPhoto] = useState<File | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<LocationQuestion[]>([]);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const stageTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [anchor, setAnchor] = useState<DateTime>(() => DateTime.now());
  const weekDays = useMemo(() => {
    const start = anchor.startOf("week");
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  }, [anchor]);
  const fetchRange = useMemo(() => viewRange(viewMode, anchor), [viewMode, anchor]);

  function handlePrevView() {
    setAnchor((a) => shiftAnchor(viewMode, a, -1));
  }
  function handleNextView() {
    setAnchor((a) => shiftAnchor(viewMode, a, 1));
  }
  /** Jumps back to today, in whichever view is currently showing (today's day, its week, its month, or its year). */
  function handleToday() {
    setAnchor(DateTime.now());
  }
  function handleJumpToDay(day: DateTime) {
    setAnchor(day);
    setViewMode("day");
  }
  function handleJumpToMonth(month: DateTime) {
    setAnchor(month);
    setViewMode("month");
  }

  const [realEvents, setRealEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);
  // "My calendars" visibility checklist (§4.6): which of the user's real
  // calendars contribute to this mini calendar. Defaults to everything
  // checked once the list loads, same as Google Calendar itself.
  const [checkedCalendarIds, setCheckedCalendarIds] = useState<Set<string>>(new Set());
  // "Add another" (from the review screen): the next thing sent gets
  // appended to this draft instead of starting a new one, so the draft
  // list on review shows everything described so far in one place.
  const [appendToDraftId, setAppendToDraftId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/calendars")
      .then((res) => res.json())
      .then((data) => {
        const list: CalendarListEntry[] = data.calendars ?? [];
        setCalendars(list);
        setCheckedCalendarIds(new Set(list.map((c) => c.id)));
      })
      .catch(() => setCalendars([]));
  }, []);

  function handleToggleCalendar(id: string) {
    setCheckedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleToggleAllCalendars(checked: boolean) {
    setCheckedCalendarIds(checked ? new Set(calendars.map((c) => c.id)) : new Set());
  }

  const calendarColors = useMemo(() => Object.fromEntries(calendars.map((c) => [c.id, c.backgroundColor])), [calendars]);

  useEffect(() => {
    const timeMin = fetchRange.start.toUTC().toISO()!;
    const timeMax = fetchRange.end.toUTC().toISO()!;
    const params = new URLSearchParams({ timeMin, timeMax });
    for (const id of checkedCalendarIds) params.append("calendarId", id);
    fetch(`/api/calendar/events?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setRealEvents(data.events ?? []))
      .catch(() => setRealEvents([]));
  }, [fetchRange, checkedCalendarIds]);

  function clearStageTimers() {
    stageTimersRef.current.forEach(clearTimeout);
    stageTimersRef.current = [];
  }

  function pushHistory(kind: CaptureTab, label: string): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setHistory((prev) => [...prev, { id, kind, label, state: "parsing" }]);
    return id;
  }

  function settleHistory(id: string, state: "ready" | "error", draftId?: string, errorMessage?: string) {
    setHistory((prev) => prev.map((entry) => (entry.id === id ? { ...entry, state, draftId, errorMessage } : entry)));
  }

  /** Cycles `status` through this capture kind's stage labels, shown as a line above the composer instead of a full-screen loading page. */
  function beginStatus(activeTab: CaptureTab) {
    clearStageTimers();
    const stages = STAGES[activeTab];
    setStatus(`${stages[0][0]} — ${stages[0][1]}`);
    stages.forEach(([label, meta], index) => {
      if (index === 0) return;
      stageTimersRef.current.push(setTimeout(() => setStatus(`${label} — ${meta}`), 180 + index * 420));
    });
  }

  /**
   * `autoConfirm` only applies on the fresh-parse path (below), never when
   * reopening a draft from a history bubble -- if auto-confirm is on, a
   * freshly-parsed draft normally never survives long enough to *be*
   * reopenable, so a still-open one reaching here has already fallen
   * through auto-confirm once (e.g. a commit failure) and deserves a normal
   * manual look rather than a silent retry loop.
   */
  async function loadDraft(draftId: string, options?: { autoConfirm?: boolean }) {
    const draftRes = await fetch(`/api/drafts/${draftId}`);
    const draft = await draftRes.json();
    if (!draftRes.ok) throw new Error(draft.error ?? "Failed to load draft");
    clearStageTimers();
    setStatus(null);

    const events: DraftEventRow[] = draft.events;
    const rawNeedsInput: Array<{ id: string; type: string; draftEventId: string | null; answeredAt: string | null }> = draft.needsInput ?? [];
    const locationQuestions: LocationQuestion[] = rawNeedsInput
      .filter((n) => n.type === "location_missing" && !n.answeredAt && n.draftEventId)
      .map((n) => ({
        id: n.id,
        draftEventId: n.draftEventId as string,
        title: events.find((e) => e.id === n.draftEventId)?.event.title.value ?? "this event",
      }));

    if (options?.autoConfirm) {
      try {
        const res = await fetch(`/api/drafts/${draftId}/commit`, { method: "POST" });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? "Failed to commit");
        handleCommitted(result);
        return;
      } catch {
        // Fall through to a normal review instead of losing the draft silently.
      }
    }

    const review: PendingReview = { draftId, events, calendarId: draft.calendarId, source: draft.source ?? null };
    if (locationQuestions.length > 0) {
      setPendingReview(review);
      setPendingQuestions(locationQuestions);
    } else {
      setPhase({ name: "review", ...review });
    }
  }

  async function parseText(activeTab: CaptureTab, text: string, historyId: string, draftId?: string) {
    beginStatus(activeTab);
    try {
      const res = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "text", sourceText: text, timezone, draftId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse");
      settleHistory(historyId, "ready", data.draftId);
      await loadDraft(data.draftId, { autoConfirm: autoConfirmEnabled });
    } catch (error) {
      clearStageTimers();
      setStatus(null);
      settleHistory(historyId, "error", undefined, error instanceof Error ? error.message : "Something went wrong");
    }
  }

  async function parsePhoto(file: File, historyId: string, draftId?: string) {
    beginStatus("photo");
    try {
      const processed = await preprocessImage(file);
      const formData = new FormData();
      formData.set("file", processed, "capture.jpg");
      formData.set("timezone", timezone);
      if (draftId) formData.set("draftId", draftId);

      const res = await fetch("/api/captures", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse");
      settleHistory(historyId, "ready", data.draftId);
      await loadDraft(data.draftId, { autoConfirm: autoConfirmEnabled });
    } catch (error) {
      clearStageTimers();
      setStatus(null);
      settleHistory(historyId, "error", undefined, error instanceof Error ? error.message : "Something went wrong");
    }
  }

  function handlePhotoSelected(file: File | undefined) {
    if (!file) return;
    setAttachedPhoto(file);
  }

  function handleSend() {
    if (status || pendingQuestions.length > 0) return;
    const draftId = appendToDraftId ?? undefined;
    setAppendToDraftId(null);
    if (attachedPhoto) {
      const historyId = pushHistory("photo", attachedPhoto.name);
      const file = attachedPhoto;
      setAttachedPhoto(null);
      setComposerText("");
      setComposerKind("text");
      void parsePhoto(file, historyId, draftId);
      return;
    }
    const text = composerText.trim();
    if (!text) return;
    const kind = composerKind;
    const historyId = pushHistory(kind, text.length > 64 ? `${text.slice(0, 64)}…` : text);
    setComposerText("");
    setComposerKind("text");
    void parseText(kind, text, historyId, draftId);
  }

  function handleMicClick() {
    setComposerText(DEFAULT_TRANSCRIPT);
    setComposerKind("voice");
  }

  function handleUseExample(text: string) {
    setComposerText(text);
    setComposerKind("text");
  }

  /**
   * §5.3.3: never blocking -- `value: null` (skip) just leaves the field
   * empty, same as if nothing had been asked. Computed synchronously (not
   * via an effect watching pendingQuestions) so the hand-off to the review
   * screen happens in the same tick as the last answer, not a render later.
   */
  function handleAnswerLocation(question: LocationQuestion, value: string | null) {
    if (!pendingReview) return;

    const updatedEvents = value
      ? pendingReview.events.map((row) =>
          row.id === question.draftEventId
            ? { ...row, event: { ...row.event, location: { value, confidence: 1, provenance: null, inferred: false, inferredFrom: null } } }
            : row,
        )
      : pendingReview.events;

    if (value) {
      void fetch(`/api/drafts/${pendingReview.draftId}/events/${question.draftEventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "location", value }),
      });
    }
    void fetch(`/api/drafts/${pendingReview.draftId}/needs-input/${question.id}`, { method: "PATCH" });

    const remaining = pendingQuestions.filter((q) => q.id !== question.id);
    if (remaining.length === 0) {
      setPhase({ name: "review", draftId: pendingReview.draftId, events: updatedEvents, calendarId: pendingReview.calendarId, source: pendingReview.source });
      setPendingReview(null);
      setPendingQuestions([]);
    } else {
      setPendingReview({ ...pendingReview, events: updatedEvents });
      setPendingQuestions(remaining);
    }
  }

  function handleCommitted(result: CommitResult) {
    setPhase({ name: "committed", result, secondsLeft: 10 });
    const interval = setInterval(() => {
      setPhase((prev) => {
        if (prev.name !== "committed") {
          clearInterval(interval);
          return prev;
        }
        if (prev.secondsLeft <= 1) {
          clearInterval(interval);
          return { ...prev, secondsLeft: 0 };
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
  }

  async function handleUndo() {
    if (phase.name !== "committed") return;
    await fetch(`/api/commits/${phase.result.id}/revert`, { method: "POST" });
    setPhase({ name: "capture" });
  }

  const appShellProps = {
    userEmail,
    userImage,
    theme: initialTheme,
    autoConfirmEnabled,
    onAutoConfirmChange: setAutoConfirmEnabled,
    onOpenHistory: () => setPhase({ name: "history" as const }),
    // The header logo doubles as "back to the composer" from any screen --
    // leaving "review" this way is the same as the old dedicated "Back"
    // button (clear a pending append-target so a later unrelated send
    // doesn't get merged into this draft by mistake).
    onGoHome: () => {
      if (phase.name === "review") setAppendToDraftId(null);
      setPhase({ name: "capture" });
    },
  };

  if (phase.name === "review") {
    return (
      <AppShell {...appShellProps}>
        <ReviewSurface
          draftId={phase.draftId}
          initialEvents={phase.events}
          initialCalendarId={phase.calendarId}
          source={phase.source}
          onCommitted={handleCommitted}
          onAddAnother={() => {
            setAppendToDraftId(phase.draftId);
            setPhase({ name: "capture" });
          }}
        />
      </AppShell>
    );
  }

  if (phase.name === "history") {
    return (
      <AppShell {...appShellProps}>
        <CommitHistoryView onBack={() => setPhase({ name: "capture" })} />
      </AppShell>
    );
  }

  const captureScreen = (
    <CaptureScreen
      composerText={composerText}
      composerKind={composerKind}
      attachedPhoto={attachedPhoto}
      history={history}
      status={status}
      appendingToDraft={appendToDraftId !== null}
      onCancelAppend={() => setAppendToDraftId(null)}
      pendingQuestions={pendingQuestions}
      weekDays={weekDays}
      timezone={timezone}
      realEvents={realEvents}
      calendars={calendars}
      calendarColors={calendarColors}
      checkedCalendarIds={checkedCalendarIds}
      onToggleCalendar={handleToggleCalendar}
      onToggleAllCalendars={handleToggleAllCalendars}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      anchor={anchor}
      onPrevView={handlePrevView}
      onNextView={handleNextView}
      onToday={handleToday}
      onJumpToDay={handleJumpToDay}
      onJumpToMonth={handleJumpToMonth}
      onComposerTextChange={(value) => {
        setComposerText(value);
        setComposerKind("text");
      }}
      onMicClick={handleMicClick}
      onAttachClick={() => libraryInputRef.current?.click()}
      onCameraClick={() => cameraInputRef.current?.click()}
      onPhotoPasted={(file) => setAttachedPhoto(file)}
      onRemovePhoto={() => setAttachedPhoto(null)}
      onSend={handleSend}
      onUseExample={handleUseExample}
      onAnswerLocation={handleAnswerLocation}
      onReopenDraft={loadDraft}
    />
  );

  if (phase.name === "committed") {
    const failed = phase.result.failures.length;
    return (
      <AppShell {...appShellProps}>
        {captureScreen}
        <UndoToast
          label={`Created ${phase.result.googleEventIds.length} event${phase.result.googleEventIds.length === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""} on Work`}
          secondsLeft={phase.secondsLeft}
          onUndo={handleUndo}
        />
        <PhotoInputs cameraInputRef={cameraInputRef} libraryInputRef={libraryInputRef} onPhotoSelected={handlePhotoSelected} />
      </AppShell>
    );
  }

  return (
    <AppShell {...appShellProps}>
      {captureScreen}
      <PhotoInputs cameraInputRef={cameraInputRef} libraryInputRef={libraryInputRef} onPhotoSelected={handlePhotoSelected} />
    </AppShell>
  );
}

function AppShell({
  userEmail,
  userImage,
  theme,
  autoConfirmEnabled,
  onAutoConfirmChange,
  onOpenHistory,
  onGoHome,
  children,
}: {
  userEmail: string;
  userImage: string | null;
  theme: Theme;
  autoConfirmEnabled: boolean;
  onAutoConfirmChange: (enabled: boolean) => void;
  onOpenHistory: () => void;
  /** The logo/wordmark doubles as a home button -- back to the composer from wherever you are. */
  onGoHome: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-[var(--paper)] text-[var(--ink)]">
      <div className="flex h-[68px] shrink-0 items-center border-b border-[var(--rule)] bg-[var(--surf)] px-4 lg:px-6">
        {/* Matches the app content's own max-w-[1440px] below -- without this, the bar spans the true viewport edge to edge while everything under it is inset, so on a wide window the header's middle reads as dead space instead of a normal margin. */}
        <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between">
          <button
            type="button"
            onClick={onGoHome}
            className="flex items-center gap-2.5 transition-[opacity,transform] duration-150 ease-[cubic-bezier(.2,.6,.2,1)] hover:opacity-80 active:scale-[0.96]"
          >
            <Image src="/docket-logo.png" alt="" width={30} height={30} className="shrink-0" priority />
            <div className="text-[20px] font-bold tracking-[-0.01em] text-[var(--ink)]">docket</div>
          </button>
          <div className="flex items-center gap-3 text-[12.5px] text-[var(--ink2)] lg:gap-4">
            <SettingsMenu
              userEmail={userEmail}
              userImage={userImage}
              initialTheme={theme}
              initialAutoConfirm={autoConfirmEnabled}
              onAutoConfirmChange={onAutoConfirmChange}
              onOpenHistory={onOpenHistory}
            />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * §11 M2.1 recast as a single composer instead of a capture-type picker
 * (photo/text/share/voice each got their own always-visible panel before):
 * type, paste, attach a photo, or dictate from the same box, Cursor-chat
 * style, with past captures listed above it like a message log. The real
 * calendar sits alongside for context while composing -- it's read-only
 * here; ghost-block review still happens on the existing review screen
 * after sending, unchanged.
 */
function CaptureScreen({
  composerText,
  composerKind,
  attachedPhoto,
  history,
  status,
  appendingToDraft,
  onCancelAppend,
  pendingQuestions,
  weekDays,
  timezone,
  realEvents,
  calendars,
  calendarColors,
  checkedCalendarIds,
  onToggleCalendar,
  onToggleAllCalendars,
  viewMode,
  onViewModeChange,
  anchor,
  onPrevView,
  onNextView,
  onToday,
  onJumpToDay,
  onJumpToMonth,
  onComposerTextChange,
  onMicClick,
  onAttachClick,
  onCameraClick,
  onPhotoPasted,
  onRemovePhoto,
  onSend,
  onUseExample,
  onAnswerLocation,
  onReopenDraft,
}: {
  composerText: string;
  composerKind: "text" | "voice";
  attachedPhoto: File | null;
  history: HistoryEntry[];
  status: string | null;
  /** Set while "Add another" is pending -- the next capture merges into that draft instead of starting a new one. */
  appendingToDraft: boolean;
  onCancelAppend: () => void;
  pendingQuestions: LocationQuestion[];
  weekDays: DateTime[];
  timezone: string;
  realEvents: CalendarEvent[];
  calendars: CalendarListEntry[];
  calendarColors: Record<string, string | undefined>;
  checkedCalendarIds: Set<string>;
  onToggleCalendar: (id: string) => void;
  onToggleAllCalendars: (checked: boolean) => void;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  anchor: DateTime;
  onPrevView: () => void;
  onNextView: () => void;
  onToday: () => void;
  onJumpToDay: (day: DateTime) => void;
  onJumpToMonth: (month: DateTime) => void;
  onComposerTextChange: (value: string) => void;
  onMicClick: () => void;
  onAttachClick: () => void;
  onCameraClick: () => void;
  onPhotoPasted: (file: File) => void;
  onRemovePhoto: () => void;
  onSend: () => void;
  onUseExample: (text: string) => void;
  onAnswerLocation: (question: LocationQuestion, value: string | null) => void;
  /** Reopens a previously-parsed, still-unconfirmed draft for review -- otherwise leaving via "Add another"/"Back" orphans it with no way back. */
  onReopenDraft: (draftId: string) => void;
}) {
  const busy = !!status || pendingQuestions.length > 0;
  const canSend = !busy && (!!attachedPhoto || composerText.trim().length > 0);
  const emptyDraftBlocks: DraftBlock[] = [];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // This whole screen unmounts while review/history is showing and remounts
  // fresh when the logo sends you back -- fading/sliding it in on that
  // remount is what makes "back to the dashboard" actually read as an
  // arrival instead of an instant, jarring swap.
  const revealed = useMountReveal();

  return (
    <div
      className={`mx-auto flex w-full min-h-0 max-w-[1440px] flex-1 flex-col overflow-hidden transition-[opacity,transform] duration-300 ease-[cubic-bezier(.2,.6,.2,1)] lg:flex-row ${
        revealed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-5 py-6 lg:px-10 lg:py-8">
        <div className="shrink-0">
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.03em] lg:text-[33px]">What needs scheduling?</h1>
          <p className="mt-2 text-[13.5px] text-[var(--ink2)]">
            Type it, paste it, attach a photo, or dictate it — review before anything&rsquo;s created.
          </p>
        </div>

        <div className="mt-6 min-h-0 flex-1 overflow-auto">
          {history.length === 0 ? (
            <div className="flex h-full flex-col justify-center gap-5 pb-2">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <CaptureHint
                  icon={<FileTextIcon />}
                  iconBg="var(--violetWash)"
                  iconColor="var(--violetInk)"
                  title="Paste a syllabus or roster"
                  body="Full text, exactly as copied — dates and recurrence resolve from it."
                  onClick={async () => {
                    // A real one-click paste, not just a prompt to do it yourself --
                    // falls back to focusing the box if the browser denies clipboard
                    // read (Safari/Firefox gate it more tightly than Chrome) or the
                    // clipboard is empty/non-text.
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text.trim()) onComposerTextChange(text);
                    } catch {
                      // ignored -- fall through to focusing the box below
                    }
                    textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    textareaRef.current?.focus();
                  }}
                />
                <CaptureHint
                  icon={<ImageIcon />}
                  iconBg="var(--coolWash)"
                  iconColor="var(--coolInk)"
                  title="Attach a photo"
                  body="A whiteboard, printed timetable, or roster. Multiple people's rows are fine."
                  onClick={onAttachClick}
                />
                <CaptureHint
                  icon={<MicIcon />}
                  iconBg="var(--greenWash)"
                  iconColor="var(--greenInk)"
                  title="Dictate"
                  body="Tap the mic, say it, edit the transcript before sending if it mis-heard something."
                  onClick={() => {
                    onMicClick();
                    textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                />
              </div>

              <div className="flex items-center gap-3 text-[11.5px] text-[var(--ink3)]">
                <div className="h-px flex-1 bg-[var(--rule)]" />
                or
                <div className="h-px flex-1 bg-[var(--rule)]" />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto text-[10.5px]">
                <span className="shrink-0 text-[var(--ink2)]">Try an example</span>
                {EXAMPLE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onUseExample(preset.text)}
                    className="shrink-0 rounded-full border border-[var(--rule)] bg-[var(--surf)] px-2 py-1 font-medium text-[var(--ink2)] transition-colors hover:border-[var(--acc)] hover:text-[var(--accInk)]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 pb-2">
              {history.map((entry) => (
                <HistoryBubble key={entry.id} entry={entry} onReopen={onReopenDraft} />
              ))}
            </div>
          )}
        </div>

        {/* A popup anchored above the composer, not a message in the scrolling log -- one question at a time, like Composio/Claude Code's own interactive prompts. */}
        {pendingQuestions[0] && (
          <div className="shrink-0 pb-3">
            <LocationQuestionBubble key={pendingQuestions[0].id} question={pendingQuestions[0]} onAnswer={(value) => onAnswerLocation(pendingQuestions[0], value)} />
          </div>
        )}

        <div className="mt-4 shrink-0">
          {appendingToDraft && !status && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--acc)] bg-[var(--accWash)] px-3 py-1.5 text-[12px] font-medium text-[var(--accInk)]">
              <span>Adding to your current draft</span>
              <button type="button" onClick={onCancelAppend} className="text-[var(--accInk)] underline-offset-2 hover:underline">
                Cancel
              </button>
            </div>
          )}
          {status && (
            <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-[var(--ink2)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--acc)]" />
              {status}
            </div>
          )}
          {attachedPhoto && <PhotoAttachmentChip file={attachedPhoto} onRemove={onRemovePhoto} />}
          {composerKind === "voice" && (
            <div className="mb-2 flex items-center gap-2 text-[11.5px] font-medium text-[var(--accInk)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--acc)]" />
              Transcript from dictation — editable before sending
            </div>
          )}
          <div className={`rounded-2xl border-2 border-[var(--ink3)] bg-[var(--surf)] p-3 focus-within:border-[var(--violet)] ${busy ? "opacity-60" : ""}`}>
            <textarea
              ref={textareaRef}
              value={composerText}
              onChange={(e) => onComposerTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canSend) {
                  e.preventDefault();
                  onSend();
                }
              }}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const item of items) {
                  if (item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    if (file) {
                      e.preventDefault();
                      onPhotoPasted(file);
                    }
                    break;
                  }
                }
              }}
              placeholder={attachedPhoto ? "Add a note (optional)…" : busy ? "One sec…" : "How can I help you schedule?"}
              rows={2}
              disabled={busy}
              className="focus-ring-none min-h-12 max-h-40 w-full resize-none overflow-y-auto bg-transparent text-[14.5px] leading-6 text-[var(--ink)] outline-none disabled:cursor-not-allowed"
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onAttachClick}
                  disabled={busy}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink2)] transition-colors hover:bg-[var(--sunk)] disabled:pointer-events-none"
                  aria-label="Attach a photo"
                  title="Attach a photo"
                >
                  <PlusIcon />
                </button>
                <button
                  type="button"
                  onClick={onCameraClick}
                  disabled={busy}
                  className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink2)] transition-colors hover:bg-[var(--sunk)] disabled:pointer-events-none lg:flex"
                  aria-label="Take a photo"
                  title="Take a photo"
                >
                  <CameraIcon />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onMicClick}
                  disabled={busy}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink2)] transition-colors hover:bg-[var(--sunk)] disabled:pointer-events-none"
                  aria-label="Dictate"
                  title="Dictate"
                >
                  <MicIcon />
                </button>
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend}
                  className="ml-1 flex h-8 shrink-0 items-center justify-center rounded-lg bg-[var(--btn)] px-4 text-[13px] font-semibold text-[var(--onBtn)] transition hover:brightness-95 active:brightness-90 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11.5px] text-[var(--ink2)]">Enter to send · Shift+Enter for a new line</div>
        </div>
      </div>

      <aside className="hidden min-h-0 w-1/2 flex-col border-l border-[var(--rule)] bg-[var(--sunk)] px-5 py-6 lg:flex">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.11em] text-[var(--ink3)]">Your calendar</div>
          <CalendarViewSwitcher value={viewMode} onChange={onViewModeChange} />
        </div>
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
          <CalendarChecklist calendars={calendars} checkedIds={checkedCalendarIds} onToggle={onToggleCalendar} onToggleAll={onToggleAllCalendars} />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToday}
              className="rounded-md border border-[var(--rule)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--surf)]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={onPrevView}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink2)] transition-colors hover:bg-[var(--surf)]"
              aria-label={`Previous ${viewMode}`}
            >
              <ChevronIcon direction="left" />
            </button>
            <div className="text-[12px] text-[var(--ink2)]">{viewLabel(viewMode, anchor)}</div>
            <button
              type="button"
              onClick={onNextView}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink2)] transition-colors hover:bg-[var(--surf)]"
              aria-label={`Next ${viewMode}`}
            >
              <ChevronIcon direction="right" />
            </button>
          </div>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surf)] p-2">
          {viewMode === "month" ? (
            <MonthGrid
              month={anchor}
              timezone={timezone}
              realEvents={realEvents}
              draftBlocks={emptyDraftBlocks}
              calendarColors={calendarColors}
              onSelectDay={onJumpToDay}
            />
          ) : viewMode === "year" ? (
            <YearGrid
              year={anchor}
              timezone={timezone}
              realEvents={realEvents}
              draftBlocks={emptyDraftBlocks}
              onSelectDay={onJumpToDay}
              onSelectMonth={onJumpToMonth}
            />
          ) : (
            <WeekCalendar
              days={viewMode === "day" ? [anchor] : weekDays}
              timezone={timezone}
              realEvents={realEvents}
              calendarColors={calendarColors}
              draftBlocks={emptyDraftBlocks}
              selectedId={null}
              onSelectDraft={() => {}}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

/** A "ready" entry is reopenable (it always has a draftId once settled) -- otherwise "Add another"/"Back" would orphan it with no way back to it. */
function HistoryBubble({ entry, onReopen }: { entry: HistoryEntry; onReopen: (draftId: string) => void }) {
  const kindLabel = { photo: "Photo", text: "Text", share: "Shared screenshot", voice: "Dictation" }[entry.kind];
  const reopenable = entry.state === "ready" && !!entry.draftId;

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink3)]">{kindLabel}</div>
          <div className="mt-0.5 truncate text-[13px] text-[var(--ink)]">{entry.label}</div>
        </div>
        <div
          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
            entry.state === "error"
              ? "bg-red-50 text-red-700"
              : entry.state === "ready"
                ? "bg-[var(--coolWash)] text-[var(--coolInk)]"
                : "bg-[var(--accWash)] text-[var(--accInk)]"
          }`}
        >
          {entry.state === "parsing" ? "parsing…" : entry.state === "ready" ? "parsed" : "failed"}
        </div>
      </div>
      {entry.state === "error" && entry.errorMessage && (
        <div className="mt-1.5 text-[12px] leading-5 text-red-700">{entry.errorMessage}</div>
      )}
    </>
  );

  if (reopenable) {
    return (
      <button
        type="button"
        onClick={() => onReopen(entry.draftId!)}
        className="flex flex-col self-end rounded-2xl border border-[var(--rule)] bg-[var(--surf)] px-4 py-2.5 text-left transition-colors hover:border-[var(--acc)] hover:bg-[var(--accWash)] lg:max-w-[80%]"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex flex-col self-end rounded-2xl border border-[var(--rule)] bg-[var(--surf)] px-4 py-2.5 lg:max-w-[80%]">
      {content}
    </div>
  );
}

/**
 * §5.2 `location_missing`, asked inline like a chat reply instead of only
 * surfacing as a flagged field on the review screen (§5.3.3: never blocking
 * -- Skip proceeds with the field left empty). Styled after Claude Code's
 * own interactive-picker prompt: a numbered option list with a keyboard
 * hint on the focused row, "Something else" as the free-text escape hatch,
 * and Skip beside it -- rather than a bare text box or a row of pill chips.
 */
function LocationQuestionBubble({ question, onAnswer }: { question: LocationQuestion; onAnswer: (value: string | null) => void }) {
  const [value, setValue] = useState("");
  const revealed = useMountReveal();

  return (
    <div
      className={`w-full overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--surf)] shadow-lg transition-all duration-300 ease-[cubic-bezier(.2,.6,.2,1)] ${
        revealed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <div className="border-b border-[var(--rule)] px-4 py-3">
        <div className="text-[13px] font-medium text-[var(--ink)]">
          Where is <span className="font-semibold">&ldquo;{question.title}&rdquo;</span>?
        </div>
      </div>
      <div className="flex items-center gap-2 p-3">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              e.preventDefault();
              onAnswer(value.trim());
            }
          }}
          placeholder="Room, address, or a video call link…"
          className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--rule)] bg-[var(--sunk)] px-2.5 text-[13px] outline-none"
          autoFocus
        />
        <button
          type="button"
          onClick={() => value.trim() && onAnswer(value.trim())}
          disabled={!value.trim()}
          className="h-8 shrink-0 rounded-lg bg-[var(--btn)] px-3 text-[12.5px] font-semibold text-[var(--onBtn)] transition hover:brightness-95 active:brightness-90 disabled:pointer-events-none disabled:opacity-40"
        >
          Reply
        </button>
      </div>
      <div className="border-t border-[var(--rule)]" />
      <button
        type="button"
        onClick={() => onAnswer("Virtual")}
        className="flex w-full items-center px-4 py-2.5 text-left transition-colors hover:bg-[var(--sunk)]"
      >
        <span className="text-[13.5px] text-[var(--ink)]">Virtual</span>
      </button>
      <div className="border-t border-[var(--rule)]" />
      <div className="flex items-center justify-end px-4 py-2.5">
        <button
          type="button"
          onClick={() => onAnswer(null)}
          className="h-7 shrink-0 rounded-lg border border-[var(--rule)] px-2.5 text-[12px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--sunk)]"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function PhotoAttachmentChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return (
    <div className="mb-2 flex w-fit items-center gap-2.5 rounded-xl border border-[var(--rule)] bg-[var(--surf)] py-1.5 pl-1.5 pr-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a static asset */}
      <img src={previewUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium">{file.name}</div>
        <div className="text-[11px] text-[var(--ink2)]">{Math.max(1, Math.round(file.size / 1024))} KB</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-[13px] text-[var(--ink3)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--ink)]"
        aria-label="Remove photo"
      >
        ✕
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 19v3" />
    </svg>
  );
}

function FileTextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M14 2v5h5M8 13h8M8 17h8M8 9h3" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M22 16l-5.5-5.5a2 2 0 0 0-2.8 0L4 20" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

function PhotoInputs({
  cameraInputRef,
  libraryInputRef,
  onPhotoSelected,
}: {
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  libraryInputRef: React.RefObject<HTMLInputElement | null>;
  onPhotoSelected: (file: File | undefined) => void;
}) {
  return (
    <>
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhotoSelected(e.target.files?.[0])} />
      <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhotoSelected(e.target.files?.[0])} />
    </>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--ink3)]">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function CaptureHint({
  icon,
  iconBg,
  iconColor,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring-violet flex w-full flex-col items-start rounded-2xl border border-[var(--rule)] bg-[var(--surf)] p-2.5 text-left transition-colors hover:border-[var(--violet)] hover:bg-[var(--sunk)]"
    >
      <div className="flex w-full items-start justify-between">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg [&_svg]:h-3.5 [&_svg]:w-3.5" style={{ backgroundColor: iconBg, color: iconColor }}>
          {icon}
        </div>
        <ChevronRightIcon />
      </div>
      <div className="mt-1.5 text-[13px] font-semibold">{title}</div>
      <p className="mt-0.5 text-[11.5px] leading-[19px] text-[var(--ink2)]">{body}</p>
    </button>
  );
}

function UndoToast({ label, secondsLeft, onUndo }: { label: string; secondsLeft: number; onUndo: () => void }) {
  return (
    <div className="absolute bottom-4 left-1/2 flex h-[54px] w-[calc(100%-32px)] -translate-x-1/2 items-center overflow-hidden rounded-2xl bg-[oklch(0.22_0.014_265)] text-[oklch(0.97_0.004_265)] shadow-[0_14px_34px_-14px_oklch(0.25_0.03_265_/_0.45)] lg:bottom-7 lg:w-auto lg:min-w-[430px]">
      <div className="min-w-0 truncate px-5 text-[13.5px]">{label}</div>
      <div className="flex-1" />
      {secondsLeft > 0 ? (
        <button
          type="button"
          onClick={onUndo}
          className="flex h-[52px] items-center border-l border-[oklch(0.34_0.012_260)] px-5 text-[13.5px] font-medium text-[oklch(0.84_0.10_42)] transition-colors hover:bg-[oklch(0.28_0.016_265)]"
        >
          Undo
        </button>
      ) : null}
      <div className="absolute bottom-0 left-0 h-0.5 bg-[var(--acc)] transition-[width] duration-1000" style={{ width: `${(10 - secondsLeft) * 10}%` }} />
    </div>
  );
}
