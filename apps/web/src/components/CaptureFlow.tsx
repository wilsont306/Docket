"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ImageLightbox } from "./ImageLightbox";
import { viewRange, shiftAnchor, viewLabel, type CalendarViewMode } from "@/lib/calendar-view";
import type { CalendarEvent, CalendarListEntry } from "@/lib/google-calendar";
import { preprocessImage } from "@/lib/image-preprocess";
import { useMountReveal } from "@/lib/use-mount-reveal";
import { useCalendarEvents, invalidateCalendarEvents } from "@/lib/use-calendar-events";
import { MAX_RECORDING_SECONDS, useDictation, type DictationControls } from "@/lib/use-dictation";
import { TEXT_LIMITS, clampText, countWords, isNearLimit } from "@/lib/text-limits";

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
  /** "stopped" is the user pressing Stop -- it may still land a draftId later, which makes the bubble reopenable without ever taking over the screen. */
  state: "parsing" | "ready" | "error" | "stopped";
  /** Set once parsing succeeds -- lets a past capture be reopened for review instead of being orphaned once you navigate back to the composer. */
  draftId?: string;
  /** Set on failure -- shown inline on the bubble instead of navigating to a separate error page. */
  errorMessage?: string;
  /**
   * Photo captures only: an object URL for the image that was sent, so the
   * chat keeps showing the picture (clickable, full size) instead of
   * collapsing it to its filename the moment it leaves the composer.
   * Session-lived and revoked on unmount -- reopening the app doesn't
   * reconstruct these, the stored capture behind the draft does.
   */
  previewUrl?: string;
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

  /**
   * Dictation appends rather than replaces: a second take after an edit
   * should extend what's in the box, which is also what makes "say it,
   * read it, say the rest" work without losing the first half.
   */
  const dictation = useDictation(
    useCallback((text: string) => {
      setComposerText((previous) => clampText(previous.trim() ? `${previous.trim()} ${text}` : text, TEXT_LIMITS.capture));
      setComposerKind("voice");
    }, []),
  );
  const [composerKind, setComposerKind] = useState<"text" | "voice">("text");
  const [attachedPhoto, setAttachedPhoto] = useState<File | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<LocationQuestion[]>([]);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const stageTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  // The capture currently parsing, and every capture the user has stopped --
  // a parse that lands after its Stop must not navigate, auto-confirm, or
  // report an error (see handleStop).
  const activeHistoryIdRef = useRef<string | null>(null);
  const stoppedHistoryIdsRef = useRef<Set<string>>(new Set());
  // Object URLs handed to the chat log outlive the composer chip that made
  // them, so they're released here rather than by whichever bubble happens
  // to be showing one.
  const historyPreviewUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    const urls = historyPreviewUrlsRef.current;
    return () => urls.forEach(URL.revokeObjectURL);
  }, []);

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

  // Cached per range with the neighbouring ranges warmed in the background,
  // so prev/next doesn't wait on Google for a range already loaded.
  const neighbourRanges = useMemo(
    () => [viewRange(viewMode, shiftAnchor(viewMode, anchor, -1)), viewRange(viewMode, shiftAnchor(viewMode, anchor, 1))],
    [viewMode, anchor],
  );
  const { events: realEvents, loading: eventsLoading } = useCalendarEvents(checkedCalendarIds, fetchRange, neighbourRanges);

  function clearStageTimers() {
    stageTimersRef.current.forEach(clearTimeout);
    stageTimersRef.current = [];
  }

  function pushHistory(kind: CaptureTab, label: string, previewUrl?: string): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setHistory((prev) => [...prev, { id, kind, label, state: "parsing", previewUrl }]);
    return id;
  }

  function settleHistory(id: string, state: "ready" | "error" | "stopped", draftId?: string, errorMessage?: string) {
    setHistory((prev) => prev.map((entry) => (entry.id === id ? { ...entry, state, draftId, errorMessage } : entry)));
  }

  /**
   * Stop waiting on the capture that's parsing. Deliberately *not* an
   * AbortController: the model call is already running on the server and
   * aborting the request wouldn't cancel it -- it would only throw away the
   * draftId in the reply, orphaning a draft with nothing in the UI able to
   * reach it again. So the request is left to land, and stopping instead
   * means the composer stops blocking and this capture no longer steers the
   * app: no status line, no navigating to review, and no auto-confirm firing
   * for something the user just said to stop. If the parse does finish, its
   * bubble quietly becomes reopenable rather than vanishing.
   */
  function handleStop() {
    clearStageTimers();
    setStatus(null);
    const id = activeHistoryIdRef.current;
    activeHistoryIdRef.current = null;
    if (!id) return;
    stoppedHistoryIdsRef.current.add(id);
    setHistory((prev) => prev.map((entry) => (entry.id === id ? { ...entry, state: "stopped" } : entry)));
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
      if (stoppedHistoryIdsRef.current.has(historyId)) {
        // Stopped while this was in flight: keep the draft reachable from its
        // bubble, but don't take over the screen on the user's behalf.
        settleHistory(historyId, "stopped", data.draftId);
        return;
      }
      settleHistory(historyId, "ready", data.draftId);
      await loadDraft(data.draftId, { autoConfirm: autoConfirmEnabled });
    } catch (error) {
      if (stoppedHistoryIdsRef.current.has(historyId)) return;
      clearStageTimers();
      setStatus(null);
      settleHistory(historyId, "error", undefined, error instanceof Error ? error.message : "Something went wrong");
    } finally {
      if (activeHistoryIdRef.current === historyId) activeHistoryIdRef.current = null;
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
      if (stoppedHistoryIdsRef.current.has(historyId)) {
        settleHistory(historyId, "stopped", data.draftId);
        return;
      }
      settleHistory(historyId, "ready", data.draftId);
      await loadDraft(data.draftId, { autoConfirm: autoConfirmEnabled });
    } catch (error) {
      if (stoppedHistoryIdsRef.current.has(historyId)) return;
      clearStageTimers();
      setStatus(null);
      settleHistory(historyId, "error", undefined, error instanceof Error ? error.message : "Something went wrong");
    } finally {
      if (activeHistoryIdRef.current === historyId) activeHistoryIdRef.current = null;
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
      // The chip's own preview URL dies with the chip on send, so the chat
      // log gets its own handle on the same bytes.
      const previewUrl = URL.createObjectURL(attachedPhoto);
      historyPreviewUrlsRef.current.push(previewUrl);
      const historyId = pushHistory("photo", attachedPhoto.name, previewUrl);
      activeHistoryIdRef.current = historyId;
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
    activeHistoryIdRef.current = historyId;
    setComposerText("");
    setComposerKind("text");
    void parseText(kind, text, historyId, draftId);
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
    // The calendar just changed underneath every cached range, and the
    // composer's mini calendar is the next thing on screen.
    invalidateCalendarEvents();
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
    invalidateCalendarEvents();
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
      eventsLoading={eventsLoading}
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
      dictation={dictation}
      onAttachClick={() => libraryInputRef.current?.click()}
      onCameraClick={() => cameraInputRef.current?.click()}
      onPhotoPasted={(file) => setAttachedPhoto(file)}
      onRemovePhoto={() => setAttachedPhoto(null)}
      onSend={handleSend}
      onStop={handleStop}
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
  eventsLoading,
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
  dictation,
  onAttachClick,
  onCameraClick,
  onPhotoPasted,
  onRemovePhoto,
  onSend,
  onStop,
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
  /** True only for a range with nothing cached yet -- a background refresh stays silent. */
  eventsLoading: boolean;
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
  /** Live recorder state for the composer's mic button -- see useDictation. */
  dictation: DictationControls;
  onAttachClick: () => void;
  onCameraClick: () => void;
  onPhotoPasted: (file: File) => void;
  onRemovePhoto: () => void;
  onSend: () => void;
  /** Stops waiting on the capture that's parsing -- see handleStop. */
  onStop: () => void;
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
                    dictation.toggle();
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
              maxLength={TEXT_LIMITS.capture.chars}
              onChange={(e) => onComposerTextChange(clampText(e.target.value, TEXT_LIMITS.capture))}
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
                {/* Recording and transcribing are the same button in
                    different states rather than separate controls: the thing
                    you press to start is the thing you reach for to stop. */}
                <button
                  type="button"
                  onClick={dictation.toggle}
                  disabled={busy || dictation.status === "transcribing" || dictation.status === "requesting" || !dictation.supported}
                  className={`flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg transition-colors disabled:pointer-events-none ${
                    dictation.status === "recording"
                      ? "w-auto bg-[var(--accWash)] px-2.5 text-[var(--accInk)]"
                      : "w-8 text-[var(--ink2)] hover:bg-[var(--sunk)]"
                  } ${dictation.status === "transcribing" ? "opacity-60" : ""}`}
                  aria-label={dictation.status === "recording" ? "Stop recording" : "Dictate"}
                  title={
                    !dictation.supported
                      ? "This browser can't record audio"
                      : dictation.status === "recording"
                        ? "Stop recording"
                        : dictation.status === "transcribing"
                          ? "Transcribing…"
                          : "Dictate"
                  }
                >
                  {dictation.status === "recording" ? (
                    <>
                      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--acc)]" />
                      <span className="font-mono text-[12px] tabular-nums">{formatTake(dictation.seconds)}</span>
                    </>
                  ) : dictation.status === "transcribing" ? (
                    <SpinnerIcon />
                  ) : (
                    <MicIcon />
                  )}
                </button>
                {dictation.status === "recording" && (
                  <button
                    type="button"
                    onClick={dictation.cancel}
                    className="flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-[12px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--sunk)]"
                    title="Discard this recording"
                  >
                    Discard
                  </button>
                )}
                {/* Takes Send's place rather than sitting beside it: while
                    something is parsing there's nothing to send anyway, and
                    the one button under your cursor is the one you'd reach
                    for to make it stop. */}
                {status ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="ml-1 flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--rule)] bg-[var(--surf)] px-3.5 text-[13px] font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--sunk)]"
                    aria-label="Stop parsing"
                    title="Stop"
                  >
                    <StopIcon />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSend}
                    disabled={!canSend}
                    className="ml-1 flex h-8 shrink-0 items-center justify-center rounded-lg bg-[var(--btn)] px-4 text-[13px] font-semibold text-[var(--onBtn)] transition hover:brightness-95 active:brightness-90 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--ink2)]">
            {dictation.error ? (
              <>
                <span className="text-[var(--accInk)]">{dictation.error}</span>
                <button type="button" onClick={dictation.dismissError} className="underline underline-offset-2 transition-opacity hover:opacity-70">
                  Dismiss
                </button>
              </>
            ) : dictation.status === "recording" ? (
              <span>Listening — press the timer to stop{dictation.seconds >= MAX_RECORDING_SECONDS - 15 ? `, ${MAX_RECORDING_SECONDS - dictation.seconds}s left` : ""}</span>
            ) : dictation.status === "requesting" ? (
              <span>Waiting for microphone access…</span>
            ) : dictation.status === "transcribing" ? (
              <span>Transcribing what you said…</span>
            ) : (
              <span>Enter to send · Shift+Enter for a new line</span>
            )}
            {/* Only once it's close -- a word count over an empty box is
                noise, and this one exists to warn, not to keep score. */}
            {isNearLimit(composerText, TEXT_LIMITS.capture) && (
              <span className={`ml-auto tabular-nums ${countWords(composerText) >= TEXT_LIMITS.capture.words ? "font-medium text-[var(--accInk)]" : "text-[var(--ink3)]"}`}>
                {countWords(composerText)} / {TEXT_LIMITS.capture.words} words
              </span>
            )}
          </div>
        </div>
      </div>

      <aside className="hidden min-h-0 w-1/2 flex-col border-l border-[var(--rule)] bg-[var(--sunk)] px-5 py-6 lg:flex">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.11em] text-[var(--ink3)]">Your calendar</div>
          {/* Today sits with the view switcher rather than with the arrows:
              it's a jump to a fixed point, the same kind of move as changing
              granularity, while the arrows are relative steps. */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToday}
              className="rounded-md border border-[var(--rule)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--surf)]"
            >
              Today
            </button>
            <CalendarViewSwitcher value={viewMode} onChange={onViewModeChange} />
          </div>
        </div>
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
          <CalendarChecklist calendars={calendars} checkedIds={checkedCalendarIds} onToggle={onToggleCalendar} onToggleAll={onToggleAllCalendars} />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPrevView}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink2)] transition-colors hover:bg-[var(--surf)]"
              aria-label={`Previous ${viewMode}`}
            >
              <ChevronIcon direction="left" />
            </button>
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--ink2)]">
              {viewLabel(viewMode, anchor)}
              {eventsLoading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--acc)]" title="Loading your calendar" />}
            </div>
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

/**
 * A "ready" entry is reopenable (it always has a draftId once settled) --
 * otherwise "Add another"/"Back" would orphan it with no way back to it. A
 * stopped one becomes reopenable too, but only if its parse happened to land
 * after the Stop; until then there's nothing to reopen.
 */
function HistoryBubble({ entry, onReopen }: { entry: HistoryEntry; onReopen: (draftId: string) => void }) {
  const kindLabel = { photo: "Photo", text: "Text", share: "Shared screenshot", voice: "Dictation" }[entry.kind];
  const reopenable = (entry.state === "ready" || entry.state === "stopped") && !!entry.draftId;
  const [viewerOpen, setViewerOpen] = useState(false);

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
                : entry.state === "stopped"
                  ? "bg-[var(--sunk)] text-[var(--ink2)]"
                  : "bg-[var(--accWash)] text-[var(--accInk)]"
          }`}
        >
          {entry.state === "parsing" ? "parsing…" : entry.state === "ready" ? "parsed" : entry.state === "stopped" ? "stopped" : "failed"}
        </div>
      </div>
      {entry.state === "error" && entry.errorMessage && (
        <div className="mt-1.5 text-[12px] leading-5 text-red-700">{entry.errorMessage}</div>
      )}
      {/* The request was already with the model when Stop was pressed, so it
          can still come back with something -- say so rather than leaving a
          reopenable bubble looking identical to a dead one. */}
      {entry.state === "stopped" && (
        <div className="mt-1.5 text-[12px] leading-5 text-[var(--ink2)]">
          {entry.draftId ? "Finished anyway — tap to review it." : "Stopped waiting. Send it again if you still want it."}
        </div>
      )}
    </>
  );

  // The thumbnail is its own click target beside the bubble's body rather
  // than inside it -- a reopenable bubble is already a button, and a button
  // can't nest another one.
  const thumbnail = entry.previewUrl && (
    <>
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        className="group relative block h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-[var(--rule)]"
        aria-label={`View ${entry.label} full size`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a static asset */}
        <img src={entry.previewUrl} alt="" className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <ExpandIcon />
        </span>
      </button>
      <ImageLightbox src={entry.previewUrl} alt={entry.label} open={viewerOpen} onClose={() => setViewerOpen(false)} />
    </>
  );

  const body = reopenable ? (
    <button
      type="button"
      onClick={() => onReopen(entry.draftId!)}
      className="-m-1 flex min-w-0 flex-1 flex-col rounded-xl p-1 text-left transition-colors hover:bg-[var(--accWash)]"
    >
      {content}
    </button>
  ) : (
    <div className="flex min-w-0 flex-1 flex-col">{content}</div>
  );

  return (
    <div
      className={`flex items-start gap-2.5 self-end rounded-2xl border bg-[var(--surf)] px-4 py-2.5 lg:max-w-[80%] ${
        reopenable ? "border-[var(--rule)] transition-colors hover:border-[var(--acc)]" : "border-[var(--rule)]"
      }`}
    >
      {thumbnail}
      {body}
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
          maxLength={TEXT_LIMITS.location.chars}
          onChange={(e) => setValue(clampText(e.target.value, TEXT_LIMITS.location))}
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
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return (
    <div className="mb-2 flex w-fit items-center gap-1 rounded-xl border border-[var(--rule)] bg-[var(--surf)] py-1.5 pl-1.5 pr-2">
      {/* Everything but the remove button opens the photo: a 36px thumbnail
          isn't enough to check you attached the right picture. */}
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        className="group flex min-w-0 items-center gap-2.5 rounded-lg pr-2 text-left transition-colors hover:bg-[var(--sunk)]"
        aria-label={`View ${file.name} full size`}
      >
        <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a static asset */}
          <img src={previewUrl} alt="" className="h-9 w-9 object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <ExpandIcon />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium">{file.name}</span>
          <span className="block text-[11px] text-[var(--ink2)]">{Math.max(1, Math.round(file.size / 1024))} KB</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px] text-[var(--ink3)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--ink)]"
        aria-label="Remove photo"
      >
        ✕
      </button>
      <ImageLightbox src={previewUrl} alt={file.name} open={viewerOpen} onClose={() => setViewerOpen(false)} />
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

/** m:ss for a take that can't reach an hour -- see MAX_RECORDING_SECONDS. */
function formatTake(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function SpinnerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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

function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  );
}

/** Sits over a thumbnail on hover -- the "this opens bigger" affordance. */
function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
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
