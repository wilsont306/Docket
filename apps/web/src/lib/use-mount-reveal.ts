"use client";

import { useEffect, useState } from "react";

/** True one frame after mount, for a fade/slide-in transition to animate from. */
export function useMountReveal(): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setRevealed(true));
    });
    return () => cancelAnimationFrame(raf1);
  }, []);
  return revealed;
}
