/**
 * usePolling — immediate run + fixed interval + cleanup on unmount, and the
 * interval restarts when the callback identity changes.
 */
// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePolling } from './use-polling.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePolling', () => {
  it('runs immediately, then every interval, and stops on unmount', () => {
    const run = vi.fn();
    const { unmount } = renderHook(() => usePolling(run, 1000));
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(4);

    unmount();
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('restarts with a new callback identity', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => usePolling(fn, 1000), { initialProps: { fn: first } });
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ fn: second });
    expect(second).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(second).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
