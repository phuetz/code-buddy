import { useLayoutEffect, type RefObject } from 'react';

export interface AutogrowOptions {
  /** Minimum textarea height in pixels (default 44 = single comfortable row). */
  minPx?: number;
  /** Maximum textarea height in pixels (default 200 ≈ 8 rows). */
  maxPx?: number;
}

/**
 * Pure helper extracted from the hook so it stays testable in the
 * node vitest env (the hook itself touches the DOM and isn't).
 *
 * Returns the height (in px) the textarea should adopt given its
 * `scrollHeight`, clamped between `minPx` and `maxPx`.
 */
export function computeAutogrowHeight(
  scrollHeight: number,
  opts: { minPx: number; maxPx: number },
): number {
  return Math.min(opts.maxPx, Math.max(opts.minPx, scrollHeight));
}

/**
 * Auto-grow a controlled `<textarea>` between `minPx` (44 px) and
 * `maxPx` (200 px) as its content changes. Mirrors the chat-ui
 * gitnexus-rs `ChatInput` pattern: reset to `auto` to recompute
 * scrollHeight, then clamp + apply.
 *
 * Beyond `maxPx`, the textarea stops growing and an internal vertical
 * scrollbar appears. Below `minPx`, the textarea keeps the comfortable
 * single-row height.
 *
 * Usage:
 * ```tsx
 * const ref = useRef<HTMLTextAreaElement>(null);
 * useTextareaAutogrow(ref, prompt);
 * return <textarea ref={ref} value={prompt} ... />;
 * ```
 */
export function useTextareaAutogrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  opts: AutogrowOptions = {},
): void {
  const minPx = opts.minPx ?? 44;
  const maxPx = opts.maxPx ?? 200;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset to `auto` so scrollHeight reflects the *new* content, not
    // the previously-sized height (which would clamp scrollHeight at
    // the current style.height).
    el.style.height = 'auto';
    const next = computeAutogrowHeight(el.scrollHeight, { minPx, maxPx });
    el.style.height = `${next}px`;
    // Show vertical scrollbar only when capped at max — keeps the
    // chrome out of the way for short inputs.
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden';
  }, [ref, value, minPx, maxPx]);
}
