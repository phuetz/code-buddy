/**
 * useSharedNow — a coarse "current time" shared by every component that
 * renders relative times, so labels such as "last seen 3m ago" keep ageing
 * without new data.
 *
 * One interval serves all subscribers; it starts with the first one and is
 * cleared when the last one unmounts, so hidden panels cost nothing. The
 * snapshot only changes on a tick, which keeps `useSyncExternalStore` stable
 * within a render.
 */
import { useSyncExternalStore } from 'react';

/** Label resolution: relative times and silence detection lag by at most this. */
export const SHARED_CLOCK_TICK_MS = 5_000;

export interface SharedClock {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
  /** Components currently subscribed; zero means no timer is running. */
  subscriberCount(): number;
}

export function createSharedClock(tickMs: number): SharedClock {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let now = Date.now();

  const tick = () => {
    now = Date.now();
    for (const listener of Array.from(listeners)) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (timer === null) timer = setInterval(tick, tickMs);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    getSnapshot() {
      // While idle nothing ticks: refresh lazily once a tick's worth of time has
      // passed (either direction, so a clock set back is picked up too).
      if (timer === null && Math.abs(Date.now() - now) >= tickMs) now = Date.now();
      return now;
    },
    subscriberCount: () => listeners.size,
  };
}

export const sharedClock = createSharedClock(SHARED_CLOCK_TICK_MS);

export function useSharedNow(clock: SharedClock = sharedClock): number {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
