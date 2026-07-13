const PRELOAD_RECOVERY_KEY = 'codebuddy.vite-preload-recovery-at';

export const PRELOAD_RECOVERY_COOLDOWN_MS = 30_000;

interface PreloadRecoveryTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  location: Pick<Location, 'reload'>;
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  setTimeout(handler: () => void, timeoutMs: number): number;
}

interface InstallPreloadRecoveryOptions {
  target?: PreloadRecoveryTarget;
  cooldownMs?: number;
  now?: () => number;
  onEvent?: (status: 'reloading' | 'cooldown', payload: unknown) => void;
}

interface VitePreloadErrorEvent extends Event {
  payload?: unknown;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Recover from stale Vite content hashes after an on-disk Cowork rebuild.
 * A second failure inside the cooldown is allowed to reach ErrorBoundary,
 * which prevents a broken build from creating an infinite reload loop.
 */
export function installVitePreloadRecovery({
  target = window,
  cooldownMs = PRELOAD_RECOVERY_COOLDOWN_MS,
  now = Date.now,
  onEvent,
}: InstallPreloadRecoveryOptions = {}): () => void {
  const clearAfterCooldown = (timestamp: string) => {
    target.setTimeout(() => {
      if (target.sessionStorage.getItem(PRELOAD_RECOVERY_KEY) === timestamp) {
        target.sessionStorage.removeItem(PRELOAD_RECOVERY_KEY);
      }
    }, cooldownMs);
  };

  const existingTimestamp = target.sessionStorage.getItem(PRELOAD_RECOVERY_KEY);
  if (existingTimestamp) clearAfterCooldown(existingTimestamp);

  const handlePreloadError: EventListener = (rawEvent) => {
    const event = rawEvent as VitePreloadErrorEvent;
    const currentTime = now();
    const previousTime = parseTimestamp(target.sessionStorage.getItem(PRELOAD_RECOVERY_KEY));
    if (previousTime !== null && currentTime - previousTime < cooldownMs) {
      onEvent?.('cooldown', event.payload);
      return;
    }

    event.preventDefault();
    const timestamp = String(currentTime);
    target.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, timestamp);
    clearAfterCooldown(timestamp);
    onEvent?.('reloading', event.payload);
    target.location.reload();
  };

  target.addEventListener('vite:preloadError', handlePreloadError);
  return () => target.removeEventListener('vite:preloadError', handlePreloadError);
}
