import { describe, expect, it, vi } from 'vitest';
import { installVitePreloadRecovery } from './vite-preload-recovery';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function createHarness() {
  const events = new EventTarget();
  const reload = vi.fn();
  const storage = createStorage();
  const target = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    location: { reload },
    sessionStorage: storage,
    setTimeout: vi.fn(() => 1),
  };
  return { events, reload, storage, target };
}

function preloadError(): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  Object.defineProperty(event, 'payload', { value: new Error('stale chunk') });
  return event;
}

describe('installVitePreloadRecovery', () => {
  it('reloads once and consumes the first stale-chunk error', () => {
    const harness = createHarness();
    const onEvent = vi.fn();
    installVitePreloadRecovery({ target: harness.target, now: () => 1_000, onEvent });

    const event = preloadError();
    harness.events.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(harness.reload).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith('reloading', expect.any(Error));
  });

  it('does not create an infinite reload loop inside the cooldown', () => {
    const harness = createHarness();
    const onEvent = vi.fn();
    let now = 1_000;
    installVitePreloadRecovery({ target: harness.target, now: () => now, onEvent });
    harness.events.dispatchEvent(preloadError());

    now = 1_500;
    const repeated = preloadError();
    harness.events.dispatchEvent(repeated);

    expect(repeated.defaultPrevented).toBe(false);
    expect(harness.reload).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenLastCalledWith('cooldown', expect.any(Error));
  });
});
