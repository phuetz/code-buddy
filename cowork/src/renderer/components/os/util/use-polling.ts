/**
 * usePolling — run a stable callback immediately on mount, then on a fixed
 * interval until unmount. Mission Control's data (council ledgers, CKG,
 * daemon board/status) was loaded ONCE at mount and went stale for as long
 * as the view stayed open; this keeps it live without any manual refresh.
 *
 * The callback MUST be referentially stable (useCallback) — a new function
 * identity restarts the interval, which is also the escape hatch when the
 * inputs genuinely change.
 */
import { useEffect } from 'react';

export function usePolling(run: () => void, intervalMs: number): void {
  useEffect(() => {
    run();
    const timer = setInterval(run, intervalMs);
    return () => clearInterval(timer);
  }, [run, intervalMs]);
}
