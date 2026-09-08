"use client";

import { useEffect, useState } from "react";
import { ImageLightbox, type BoundingBox } from "./ImageLightbox";

export type { BoundingBox };

/**
 * FR-4.4.1/4.4.2: the photo-path equivalent of the text span highlight —
 * the original capture, viewable in full, with the selected event's region
 * outlined. Fully controlled from outside (`open`/`onClose`): renders
 * nothing, and fetches nothing, until the caller's own "View" affordance
 * sets `open`. This wrapper owns only the authenticated fetch by capture id;
 * ImageLightbox draws it, same as it does for a not-yet-sent local photo in
 * the composer.
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

  return (
    <ImageLightbox
      src={imageUrl}
      alt="Original capture"
      open={open}
      onClose={onClose}
      boundingBox={boundingBox}
      caption={boundingBox ? "Highlighted: the row this whole event was read from." : undefined}
    />
  );
}
