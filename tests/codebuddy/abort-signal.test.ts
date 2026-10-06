import { describe, it, expect, afterEach, vi } from 'vitest';
import { createAbortError, combineAbortSignals } from '@/codebuddy/abort-signal.js';

/**
 * Unit tests for `src/codebuddy/abort-signal.ts`.
 *
 * `combineAbortSignals` prefers the native `AbortSignal.any` when present and
 * falls back to a manual listener wiring on older runtimes (Node 18). Both
 * paths must be exercised, so the fallback is reached by temporarily masking
 * the static `AbortSignal.any` — always restored, even when an assertion
 * throws.
 */

/** Temporarily hide the native `AbortSignal.any`, run `fn`, then restore it. */
async function withoutAbortSignalAny<T>(fn: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  try {
    Object.defineProperty(AbortSignal, 'any', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    return await fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(AbortSignal, 'any', descriptor);
    } else {
      delete (AbortSignal as { any?: unknown }).any;
    }
  }
}

/** Resolve on the next microtask so abort listeners have run. */
const flush = (): Promise<void> => Promise.resolve();

afterEach(() => {
  // Guard against a leaked mask if a test aborted before its finally ran.
  expect(typeof AbortSignal.any).toBe('function');
});

describe('createAbortError', () => {
  it('carries the requested message and the AbortError name', () => {
    const error = createAbortError('operation annulée');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('operation annulée');
    expect(error.name).toBe('AbortError');
  });

  it('preserves an empty message', () => {
    const error = createAbortError('');
    expect(error.message).toBe('');
    expect(error.name).toBe('AbortError');
  });
});

describe('combineAbortSignals — signal count', () => {
  it('returns undefined when no signal is provided', () => {
    expect(combineAbortSignals()).toBeUndefined();
  });

  it('returns undefined when every input is undefined', () => {
    expect(combineAbortSignals(undefined, undefined)).toBeUndefined();
  });

  it('returns the sole signal unchanged for one active signal', () => {
    const controller = new AbortController();
    expect(combineAbortSignals(controller.signal)).toBe(controller.signal);
  });

  it('combines multiple signals into a new signal', () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined).toBeDefined();
    expect(combined).not.toBe(a.signal);
    expect(combined).not.toBe(b.signal);
    expect(combined?.aborted).toBe(false);
  });

  it('ignores undefined entries when combining', () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineAbortSignals(undefined, a.signal, undefined, b.signal);
    expect(combined?.aborted).toBe(false);
    a.abort('raison-a');
    expect(combined?.aborted).toBe(true);
  });
});

describe('combineAbortSignals — reason propagation (native path)', () => {
  it('propagates the reason of an already-aborted input', () => {
    const reason = createAbortError('déjà avorté');
    const aborted = AbortSignal.abort(reason);
    const active = new AbortController();

    const combined = combineAbortSignals(aborted, active.signal);
    expect(combined?.aborted).toBe(true);
    expect(combined?.reason).toBe(reason);
  });

  it('propagates the reason of an input aborted later', async () => {
    const reason = createAbortError('avorté plus tard');
    const a = new AbortController();
    const b = new AbortController();

    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined?.aborted).toBe(false);

    b.abort(reason);
    await flush();

    expect(combined?.aborted).toBe(true);
    expect(combined?.reason).toBe(reason);
  });
});

describe('combineAbortSignals — manual fallback path', () => {
  it('propagates the reason of an already-aborted input without AbortSignal.any', async () => {
    await withoutAbortSignalAny(() => {
      const reason = createAbortError('fallback déjà avorté');
      const aborted = AbortSignal.abort(reason);
      const active = new AbortController();

      const combined = combineAbortSignals(aborted, active.signal);
      expect(combined).toBeDefined();
      expect(combined?.aborted).toBe(true);
      expect(combined?.reason).toBe(reason);
    });
  });

  it('propagates the reason of an input aborted later without AbortSignal.any', async () => {
    await withoutAbortSignalAny(async () => {
      const reason = createAbortError('fallback plus tard');
      const a = new AbortController();
      const b = new AbortController();

      const combined = combineAbortSignals(a.signal, b.signal);
      expect(combined?.aborted).toBe(false);

      a.abort(reason);
      await flush();

      expect(combined?.aborted).toBe(true);
      expect(combined?.reason).toBe(reason);
    });
  });

  it('restores AbortSignal.any even when the body throws', async () => {
    await expect(
      withoutAbortSignalAny(() => {
        throw new Error('échec simulé');
      }),
    ).rejects.toThrow('échec simulé');

    expect(typeof AbortSignal.any).toBe('function');
  });
});

describe('combineAbortSignals — single abort', () => {
  it('aborts the combined signal only once when several inputs abort (native path)', async () => {
    const a = new AbortController();
    const b = new AbortController();
    const c = new AbortController();

    const combined = combineAbortSignals(a.signal, b.signal, c.signal);
    expect(combined).toBeDefined();

    let abortCount = 0;
    combined?.addEventListener('abort', () => {
      abortCount += 1;
    });

    a.abort('premier');
    b.abort('deuxième');
    c.abort('troisième');
    await flush();

    expect(combined?.aborted).toBe(true);
    expect(abortCount).toBe(1);
  });

  it('aborts the combined signal only once when several inputs abort (fallback path)', async () => {
    await withoutAbortSignalAny(async () => {
      const a = new AbortController();
      const b = new AbortController();
      const c = new AbortController();

      const combined = combineAbortSignals(a.signal, b.signal, c.signal);
      expect(combined).toBeDefined();

      let abortCount = 0;
      combined?.addEventListener('abort', () => {
        abortCount += 1;
      });

      a.abort('premier');
      b.abort('deuxième');
      c.abort('troisième');
      await flush();

      expect(combined?.aborted).toBe(true);
      expect(abortCount).toBe(1);
    });
  });
  it('registers one-shot listeners on every input and keeps the first reason (fallback path)', async () => {
    await withoutAbortSignalAny(async () => {
      const a = new AbortController();
      const b = new AbortController();
      const spyA = vi.spyOn(a.signal, 'addEventListener');
      const spyB = vi.spyOn(b.signal, 'addEventListener');

      const combined = combineAbortSignals(a.signal, b.signal);

      for (const spy of [spyA, spyB]) {
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
      }

      a.abort('premier');
      b.abort('deuxième');
      await flush();

      expect(combined?.reason).toBe('premier');
    });
  });
});
