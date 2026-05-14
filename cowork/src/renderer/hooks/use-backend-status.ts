import { useEffect, useRef, useState, useCallback } from 'react';

export type BackendStatusKind = 'unknown' | 'checking' | 'online' | 'offline' | 'disabled';

export interface BackendStatus {
  /** Coarse-grained status driving the badge color. */
  status: BackendStatusKind;
  /** Last time a /health probe responded 2xx. ms epoch. null until first success. */
  lastSuccessAt: number | null;
  /** Free-text describing the latest failure (HTTP status, network error). */
  lastError: string | null;
  /** Backend's reported version when known. */
  version?: string;
  /** Endpoint being polled (informational, for tooltip display). */
  endpoint: string | null;
}

export interface UseBackendStatusOptions {
  /** Polling interval in ms when last probe succeeded. Default 10_000. */
  intervalMs?: number;
  /** Per-request fetch timeout. Default 5_000. */
  timeoutMs?: number;
}

interface CodeBuddyConfigSlice {
  enabled?: boolean;
  endpoint?: string;
  apiKey?: string;
}

/**
 * `useBackendStatus()` — auto-poll the configured Code Buddy backend's
 * `/api/health` endpoint and expose a coarse status the UI can render.
 * Mirrors the chat-ui gitnexus-rs `use-backend-status` hook with the
 * same chained-setTimeout pattern (no overlapping probes, no drift)
 * and exponential-ish backoff on consecutive failures (10s → 30s → 60s,
 * capped at 60s) to avoid spamming logs when the backend is down.
 *
 * The backend endpoint + apiKey are read once at mount from
 * `electronAPI.config.get()`. If the CodeBuddy integration is
 * disabled in config, the hook returns `status='disabled'` and never
 * starts the poll loop.
 *
 * Usage:
 * ```tsx
 * const status = useBackendStatus();
 * return <HealthBadge status={status} />;
 * ```
 */
export function useBackendStatus(
  opts: UseBackendStatusOptions = {},
): BackendStatus {
  const intervalMs = opts.intervalMs ?? 10_000;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  const [state, setState] = useState<BackendStatus>({
    status: 'unknown',
    lastSuccessAt: null,
    lastError: null,
    endpoint: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);

  const probe = useCallback(
    async (endpoint: string, apiKey: string | undefined): Promise<void> => {
      setState((prev) => ({ ...prev, status: 'checking' }));
      try {
        const res = await fetch(`${endpoint}/api/health`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        if (!res.ok) {
          consecutiveFailuresRef.current += 1;
          setState((prev) => ({
            ...prev,
            status: 'offline',
            lastError: `HTTP ${res.status}: ${res.statusText}`,
            endpoint,
          }));
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { version?: string };
        consecutiveFailuresRef.current = 0;
        setState({
          status: 'online',
          lastSuccessAt: Date.now(),
          lastError: null,
          version: data?.version,
          endpoint,
        });
      } catch (err) {
        consecutiveFailuresRef.current += 1;
        setState((prev) => ({
          ...prev,
          status: 'offline',
          lastError: err instanceof Error ? err.message : 'Connection failed',
          endpoint,
        }));
      }
    },
    [timeoutMs],
  );

  useEffect(() => {
    cancelledRef.current = false;

    let endpoint: string | null = null;
    let apiKey: string | undefined;

    const loadAndStart = async () => {
      const api = (window as unknown as { electronAPI?: { config?: { get?: () => Promise<unknown> } } }).electronAPI;
      try {
        const appConfig = (await api?.config?.get?.()) ?? {};
        const cb = (appConfig as { codebuddy?: CodeBuddyConfigSlice }).codebuddy;
        if (!cb || cb.enabled === false) {
          setState({
            status: 'disabled',
            lastSuccessAt: null,
            lastError: null,
            endpoint: null,
          });
          return;
        }
        endpoint = cb.endpoint || 'http://localhost:3000';
        apiKey = cb.apiKey || undefined;
      } catch {
        // Browser mode (no electronAPI) — assume disabled.
        setState({
          status: 'disabled',
          lastSuccessAt: null,
          lastError: null,
          endpoint: null,
        });
        return;
      }

      const tick = async (): Promise<void> => {
        if (cancelledRef.current || !endpoint) return;
        await probe(endpoint, apiKey);
        if (cancelledRef.current) return;
        // Backoff after consecutive failures, capped at 60 s.
        const fails = consecutiveFailuresRef.current;
        const delay =
          fails === 0
            ? intervalMs
            : Math.min(60_000, intervalMs * Math.min(6, 2 ** Math.min(fails - 1, 3)));
        timerRef.current = setTimeout(tick, delay);
      };

      // Fire the first probe immediately (no initial delay).
      tick().catch(() => { /* swallowed — probe handles its own errors */ });
    };

    loadAndStart().catch(() => { /* config read failed — already handled */ });

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [intervalMs, probe]);

  return state;
}

/**
 * Pure helper extracted for unit tests in the node vitest env.
 * Computes the next poll delay given the consecutive-failure count and
 * the base interval. Backoff doubles per failure up to 60 s ceiling.
 */
export function computeNextPollDelay(
  consecutiveFailures: number,
  baseIntervalMs: number,
): number {
  if (consecutiveFailures <= 0) return baseIntervalMs;
  const exp = Math.min(consecutiveFailures - 1, 3); // 0,1,2,3 → ×1,2,4,8
  return Math.min(60_000, baseIntervalMs * Math.min(6, 2 ** exp));
}
