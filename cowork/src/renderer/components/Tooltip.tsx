import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Side = 'top' | 'bottom' | 'left' | 'right';

const GAP = 6;
const TRANSFORM: Record<Side, string> = {
  bottom: 'translate(-50%, 0)',
  top: 'translate(-50%, -100%)',
  right: 'translate(0, -50%)',
  left: 'translate(-100%, -50%)',
};

/**
 * A small, styled tooltip — replaces the slow OS-native `title=` popup with an
 * instant, theme-aware pill. Renders into a portal at <body> so it is never
 * clipped by an overflow-hidden ancestor (e.g. the titlebar). Wrap an element:
 *
 *   <Tooltip label="Documentation" side="bottom"><button …/></Tooltip>
 */
export function Tooltip({
  label,
  side = 'bottom',
  className = '',
  children,
}: {
  label: string;
  side?: Side;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = r.left + r.width / 2;
    let y = r.bottom + GAP;
    if (side === 'top') y = r.top - GAP;
    else if (side === 'left') {
      x = r.left - GAP;
      y = r.top + r.height / 2;
    } else if (side === 'right') {
      x = r.right + GAP;
      y = r.top + r.height / 2;
    }
    timer.current = setTimeout(() => setCoords({ x, y }), 250);
  }, [side]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCoords(null);
  }, []);

  return (
    <span
      ref={ref}
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
    >
      {children}
      {label && coords &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md bg-background px-2 py-1 text-[11px] font-medium leading-none text-white shadow-lg ring-1 ring-white/10 dark:bg-neutral-700"
            style={{ left: coords.x, top: coords.y, transform: TRANSFORM[side] }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

/**
 * A larger, explanatory tooltip for product surfaces. It is intentionally
 * separate from Tooltip so dense tables keep their compact hover hints while
 * onboarding copy can explain intent, consequence and next action.
 */
export function GuidedTooltip({
  title,
  description,
  kicker = 'À savoir',
  side = 'bottom',
  shortcut,
  children,
}: {
  title: string;
  description: string;
  kicker?: string;
  side?: Side;
  shortcut?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    timer.current = setTimeout(() => {
      const margin = 16;
      const width = Math.min(336, window.innerWidth - margin * 2);
      let x = rect.left + rect.width / 2;
      let y = rect.bottom + GAP;
      if (side === 'top') y = rect.top - GAP;
      else if (side === 'left') {
        x = rect.left - GAP;
        y = rect.top + rect.height / 2;
      } else if (side === 'right') {
        x = rect.right + GAP;
        y = rect.top + rect.height / 2;
      }
      if (side === 'top' || side === 'bottom') x = Math.max(margin + width / 2, Math.min(window.innerWidth - margin - width / 2, x));
      else x = Math.max(margin, Math.min(window.innerWidth - margin, x));
      setCoords({ x, y });
    }, 180);
  }, [side]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCoords(null);
  }, []);

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onMouseDown={hide}
      aria-label={`${title}. ${description}`}
    >
      {children}
      {coords && createPortal(
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[9999] w-[min(336px,calc(100vw-32px))] rounded-xl border border-violet-300/30 bg-slate-950/95 p-4 text-left text-white shadow-2xl shadow-violet-950/30 backdrop-blur-md"
          style={{ left: coords.x, top: coords.y, transform: TRANSFORM[side] }}
        >
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">{kicker}</span>
          <span className="block text-sm font-semibold leading-snug">{title}</span>
          <span className="mt-1.5 block text-xs leading-relaxed text-slate-300">{description}</span>
          {shortcut ? <span className="mt-3 inline-flex rounded-md border border-white/15 bg-white/10 px-2 py-1 font-mono text-[10px] text-slate-200">{shortcut}</span> : null}
        </span>,
        document.body,
      )}
    </span>
  );
}
