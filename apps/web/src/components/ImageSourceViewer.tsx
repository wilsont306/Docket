"use client";

import { useEffect, useState } from "react";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * FR-4.4.1/4.4.2: the photo-path equivalent of the text span highlight —
 * the original capture, viewable in full, with the selected event's region
 * outlined. Ties into the same selection state as the calendar pane, so
 * selecting a ghost block or a card also moves this highlight.
 */
export function ImageSourceViewer({ captureId, boundingBox }: { captureId: string; boundingBox: BoundingBox | null }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
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
  }, [captureId]);

  if (!imageUrl) {
    return <p className="text-xs text-zinc-500">Loading photo…</p>;
  }

  return (
    <div className="relative inline-block max-w-full overflow-auto rounded border border-zinc-800">
      {/* eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch, not a static asset */}
      <img src={imageUrl} alt="Original capture" className="block max-h-[70vh] w-auto" />
      {boundingBox && (
        <div
          className="absolute border-2 border-amber-400"
          style={{
            left: `${boundingBox.x * 100}%`,
            top: `${boundingBox.y * 100}%`,
            width: `${boundingBox.width * 100}%`,
            height: `${boundingBox.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}
