"use client";

import { useEffect, useRef, useState, type TransitionEvent } from "react";
import { logOutAction } from "@/lib/actions";
import { useOpenAnimation } from "@/lib/use-open-animation";

export type Theme = "system" | "light" | "dark";

function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === "system" ? resolveSystemTheme() : theme;
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function ConnectionsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  );
}

function LogOutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

/**
 * A generic calendar glyph, not a recreation of Google's actual product
 * icon -- referencing "Google Calendar" by name is fine (that's just
 * accurately naming the real connection), but reproducing their specific
 * logo artwork is a legal gray area their own brand guidelines discourage
 * unofficial versions of, and this app can't confidently clear that bar.
 */
function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** A settings row's on/off toggle -- kept local rather than pulling in a UI library for one control. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--btn)]" : "bg-[var(--rule)]"}`}
    >
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`}
      />
    </button>
  );
}

/**
 * The avatar in the header opens this instead of doing nothing -- everything
 * that's per-user-preference (theme, auto-confirm) or account-level
 * (history, log out) lives behind it rather than each getting its own header
 * button.
 */
export function SettingsMenu({
  userEmail,
  userImage,
  initialTheme,
  initialAutoConfirm,
  onAutoConfirmChange,
  onOpenHistory,
}: {
  userEmail: string;
  userImage: string | null;
  initialTheme: Theme;
  initialAutoConfirm: boolean;
  onAutoConfirmChange: (enabled: boolean) => void;
  onOpenHistory: () => void;
}) {
  const { open, mounted, visible, openIt: openMenu, closeIt: closeMenu, handleTransitionEnd } = useOpenAnimation();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [autoConfirm, setAutoConfirm] = useState(initialAutoConfirm);
  const [imageFailed, setImageFailed] = useState(false);
  // "Connections" swaps the panel's own content for a sub-page rather than
  // navigating the whole app away -- it's still the same floating rectangle,
  // just showing different content, like a drill-down settings menu.
  const [view, setView] = useState<"main" | "connections">("main");
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, closeMenu]);

  /** Resets the drill-down back to the main list only once the panel has actually finished closing, so it doesn't visibly flip content mid-fade. */
  function handlePanelTransitionEnd(e: TransitionEvent<HTMLDivElement>) {
    handleTransitionEnd(e);
    if (e.target === e.currentTarget && !open) {
      setView("main");
      setConfirmingDisconnect(false);
    }
  }

  /**
   * Google is this app's sign-in, not just one integration among several --
   * there's no "signed in but disconnected" state to leave the user in, so
   * disconnecting revokes the OAuth grant at Google (server-side) and then
   * signs the session out entirely via the same action "Log out" uses.
   */
  async function handleDisconnectGoogle() {
    setDisconnecting(true);
    try {
      await fetch("/api/connections/google/disconnect", { method: "POST" });
    } finally {
      await logOutAction();
    }
  }

  function saveSettings(patch: { theme?: Theme; autoConfirmEnabled?: boolean }) {
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function handleThemeChange(next: Theme) {
    setTheme(next);
    applyTheme(next);
    saveSettings({ theme: next });
  }

  function handleAutoConfirmChange(next: boolean) {
    setAutoConfirm(next);
    onAutoConfirmChange(next);
    saveSettings({ autoConfirmEnabled: next });
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-label="Account and settings"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-[var(--rule)] bg-[var(--surf)] py-1 pl-1 pr-2.5 transition-colors hover:border-[var(--acc)] hover:bg-[var(--sunk)]"
      >
        <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-[var(--coolWash)]">
          {userImage && !imageFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- an external Google-hosted avatar, not worth a next.config.js remote-pattern allowlist entry for one small circular image.
            <img
              src={userImage}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
              onError={() => setImageFailed(true)}
            />
          )}
        </span>
        <span className="hidden max-w-[160px] truncate sm:inline">{userEmail}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-[var(--ink3)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {mounted && (
        <div
          onTransitionEnd={handlePanelTransitionEnd}
          className={`absolute right-0 top-10 z-50 w-[260px] origin-top-right rounded-2xl border border-[var(--rule)] bg-[var(--surf)] p-1.5 shadow-[0_14px_34px_-14px_oklch(0.25_0.03_265_/_0.35)] transition-[opacity,transform] duration-150 ease-[cubic-bezier(.2,.6,.2,1)] ${
            visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          {view === "connections" ? (
            <>
              <div className="mb-1 flex items-center gap-2 border-b border-[var(--rule)] px-1 pb-2.5">
                <button
                  type="button"
                  onClick={() => setView("main")}
                  aria-label="Back"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--sunk)]"
                >
                  <ChevronLeftIcon className="h-3.5 w-3.5" />
                </button>
                <span className="text-[13px] font-semibold">Connections</span>
              </div>

              <div className="mx-1 flex items-center gap-2 rounded-xl bg-[var(--sunk)] px-2 py-1.5">
                <GoogleCalendarIcon className="h-5 w-5 shrink-0 text-[var(--cool)]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium leading-tight">Google Calendar</div>
                  <div className="truncate text-[10.5px] leading-tight text-[var(--ink3)]">Connected as {userEmail}</div>
                </div>
                {!confirmingDisconnect && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDisconnect(true)}
                    className="shrink-0 rounded-md px-1.5 py-1 text-[10.5px] font-medium text-red-700 transition-colors hover:bg-red-50"
                  >
                    Disconnect
                  </button>
                )}
              </div>

              {confirmingDisconnect && (
                <div className="mx-1 mt-1.5 rounded-xl border border-red-200 bg-red-50 p-2.5">
                  <p className="text-[11px] leading-4 text-red-800">
                    This signs you out and revokes Docket&rsquo;s access on Google&rsquo;s side too.
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleDisconnectGoogle()}
                      disabled={disconnecting}
                      className="flex-1 rounded-lg bg-red-700 px-2 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {disconnecting ? "Disconnecting…" : "Confirm disconnect"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDisconnect(false)}
                      disabled={disconnecting}
                      className="rounded-lg border border-[var(--rule)] px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--sunk)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="border-b border-[var(--rule)] px-3 py-2.5 text-[12.5px] text-[var(--ink2)]">{userEmail}</div>

              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onOpenHistory();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--sunk)]"
              >
                <HistoryIcon className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
                History
              </button>

              <button
                type="button"
                onClick={() => setView("connections")}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--sunk)]"
              >
                <ConnectionsIcon className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
                Connections
              </button>

              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="flex items-center gap-2.5 text-[13px]">
                  {theme === "dark" ? (
                    <MoonIcon className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
                  ) : (
                    <SunIcon className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
                  )}
                  Dark mode
                </div>
                <select
                  value={theme}
                  onChange={(e) => handleThemeChange(e.target.value as Theme)}
                  className="rounded-md border border-[var(--rule)] bg-transparent px-1.5 py-1 text-[12px] outline-none"
                >
                  <option value="system">System</option>
                  <option value="light">Off</option>
                  <option value="dark">On</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px]">Auto-confirm</div>
                  <div className="text-[11px] leading-4 text-[var(--ink3)]">Send straight to your calendar, no review screen.</div>
                </div>
                <Switch checked={autoConfirm} onChange={handleAutoConfirmChange} label="Auto-confirm mode" />
              </div>

              <div className="mt-1 border-t border-[var(--rule)] pt-1">
                <button
                  type="button"
                  onClick={() => void logOutAction()}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] text-red-700 transition-colors hover:bg-[var(--sunk)]"
                >
                  <LogOutIcon className="h-4 w-4 shrink-0" />
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
