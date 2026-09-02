"use client";

import { useEffect, useState } from "react";

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
 * FR-4.4.1/4.4.2: the photo-path equivalent of the text span highlight —
 * the original capture, viewable in full, with the selected event's region
 * outlined. Fully controlled from outside (`open`/`onClose`): renders
 * nothing, and fetches nothing, until the caller's own "View" affordance
 * sets `open`. Renders as a `position: fixed` lightbox, so it never
 * participates in the review screen's own flex layout (a previous inline
 * version sized itself to the photo's natural height and starved the
 * `flex-1` review panels next to it down to 0px).
 */
export function ImageSourceViewer({
  captureId,
  boundingBox,
  open,
  onClose,
}: {
  captureId: string;
  boundingBox: BoundingBox | null;
  open: boolean;
  onClose: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    fetch(`/api/captures/${captureId}/image`)
      .then((res) => res.blob())
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, captureId]);

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
        {imageUrl ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch, not a static asset */}
            <img src={imageUrl} alt="Original capture" className="block max-h-[85dvh] w-auto" />
            {boundingBox && <HighlightBox boundingBox={boundingBox} />}
          </div>
        ) : (
          <p className="px-6 py-10 text-sm text-[var(--ink2)]">Loading photo…</p>
        )}
        {imageUrl && boundingBox && (
          <p className="mt-2 max-w-md px-1 text-xs text-[var(--ink2)]">Highlighted: the row this whole event was read from.</p>
        )}
      </div>
    </div>
  );
}
