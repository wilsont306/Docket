"use client";

import { useEffect } from "react";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function HighlightBox({ boundingBox }: { boundingBox: BoundingBox }) {
  return (
    <div
      className="absolute border-2 border-[var(--acc)] bg-[var(--accWash)]/25"
      style={{
        left: `${boundingBox.x * 100}%`,
        top: `${boundingBox.y * 100}%`,
        width: `${boundingBox.width * 100}%`,
        height: `${boundingBox.height * 100}%`,
      }}
    />
  );
}

/**
 * The one full-size image view in the app: click backdrop or press Escape to
 * dismiss. Takes a plain `src` so it works for both an already-uploaded
 * capture (fetched by id -- see ImageSourceViewer) and a local object URL for
 * a photo that hasn't been sent yet.
 *
 * Renders as `position: fixed`, so it never participates in the layout of
 * whichever screen opened it (an earlier inline version sized itself to the
 * photo's natural height and starved the `flex-1` review panels next to it
 * down to 0px).
 */
export function ImageLightbox({
  src,
  alt,
  open,
  onClose,
  boundingBox = null,
  caption,
}: {
  /** Null renders the loading state -- the caller may still be fetching the bytes. */
  src: string | null;
  alt: string;
  open: boolean;
  onClose: () => void;
  /** Fractional (0-1) region to outline on the image, e.g. the row an event was read from. */
  boundingBox?: BoundingBox | null;
  caption?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 [animation:modal-backdrop-in_150ms_ease-out]" onClick={onClose}>
      <div
        className="relative max-h-full max-w-full overflow-auto rounded-xl bg-[var(--surf)] p-2 [animation:modal-card-in_180ms_cubic-bezier(.2,.6,.2,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surf)] text-[var(--ink)] shadow transition-colors hover:bg-[var(--sunk)]"
          aria-label="Close"
        >
          ✕
        </button>
        {src ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URL (local file or authenticated fetch), not a static asset */}
            <img src={src} alt={alt} className="block max-h-[85dvh] w-auto" />
            {boundingBox && <HighlightBox boundingBox={boundingBox} />}
          </div>
        ) : (
          <p className="px-6 py-10 text-sm text-[var(--ink2)]">Loading photo…</p>
        )}
        {src && caption && <p className="mt-2 max-w-md px-1 text-xs text-[var(--ink2)]">{caption}</p>}
      </div>
    </div>
  );
}
