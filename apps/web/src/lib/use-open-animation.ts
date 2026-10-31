"use client";

import { useCallback, useEffect, useState, type TransitionEvent } from "react";

/**
 * Backs any toggleable popover, dropdown, or modal that should animate open
 * and closed instead of appearing/vanishing instantly. Owns `open` itself
 * rather than reacting to an externally-owned boolean, so every state
 * change happens directly inside a real event handler -- not inside an
 * effect keyed on a prop, which either misses the exit animation entirely
 * (React removes the element from the DOM the instant `open` flips, before
 * any transition can play) or trips React's set-state-in-effect rule trying
 * to fix that reactively.
 *
 * Pair with CSS: render only while `mounted`, key the transition end-state
 * on `visible`, and wire `handleTransitionEnd` to the animated element
 * itself (its `e.target !== e.currentTarget` guard ignores transitions that
 * bubble up from children).
 */
export function useOpenAnimation() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!mounted || !open) return;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    return () => cancelAnimationFrame(raf1);
  }, [mounted, open]);

  const openIt = useCallback(() => {
    setOpen(true);
    setMounted(true);
  }, []);

  const closeIt = useCallback(() => {
    setOpen(false);
    setVisible(false);
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (prev) {
        setVisible(false);
      } else {
        setMounted(true);
      }
      return !prev;
    });
  }, []);

  const handleTransitionEnd = useCallback((e: TransitionEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    setOpen((currentlyOpen) => {
      if (!currentlyOpen) setMounted(false);
      return currentlyOpen;
    });
  }, []);

  return { open, mounted, visible, openIt, closeIt, toggle, handleTransitionEnd };
}
