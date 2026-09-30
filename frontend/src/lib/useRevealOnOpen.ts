import { useEffect, useRef } from 'react';

// For a form that opens somewhere other than where it was opened from (e.g.
// "Edit" in a side panel opens the form at the top of the tab): on mount,
// scroll it into view and put the cursor in its first editable field.
export function useRevealOnOpen<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    element
      .querySelector<HTMLElement>(
        'input:not([readonly]):not([disabled]):not([type="file"]), textarea:not([readonly]), button:not([disabled])',
      )
      ?.focus({ preventScroll: true });
  }, []);

  return ref;
}
