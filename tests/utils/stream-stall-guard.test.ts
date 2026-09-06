/**
 * stream-stall-guard — real tests: a healthy stream passes through, a stalled
 * stream fails fast with LlmStallError (and closes the source), the guard can
 * be disabled, and the env resolver parses budgets.
 */
import { describe, expect, it } from 'vitest';
import {
  LlmStallError,
  resolveFirstTokenStallTimeoutMs,
  resolveStallTimeoutMs,
  withStallGuard,
} from '../../src/utils/stream-stall-guard.js';

async function* healthy(): AsyncGenerator<string> {
  yield 'a';
  yield 'b';
}

function stalled(): AsyncIterable<string> & { closed: boolean } {
  const obj = {
    closed: false,
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<string>>(() => {
            /* never resolves — the backend went silent */
          }),
        return: async () => {
          obj.closed = true;
          return { done: true as const, value: undefined };
        },
      };
    },
  };
  return obj;
}

describe('withStallGuard', () => {
  it('passes a healthy stream through untouched', async () => {
    const chunks: string[] = [];
    for await (const c of withStallGuard(healthy(), 5000)) chunks.push(c);
    expect(chunks).toEqual(['a', 'b']);
  });

  it('fails fast on a silent stream and closes the source', async () => {
    const source = stalled();
    const started = Date.now();
    await expect(async () => {
      for await (const c of withStallGuard(source, 120)) void c;
    }).rejects.toThrow(LlmStallError);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(source.closed).toBe(true);
  });

  it('is disabled when the budget is <= 0', async () => {
    const chunks: string[] = [];
    for await (const c of withStallGuard(healthy(), 0)) chunks.push(c);
    expect(chunks).toEqual(['a', 'b']);
  });
});

describe('resolveStallTimeoutMs', () => {
  it('defaults to 120s, honours the env var, tolerates garbage', () => {
    expect(resolveStallTimeoutMs({})).toBe(120_000);
    expect(resolveStallTimeoutMs({ CODEBUDDY_LLM_STALL_TIMEOUT_MS: '30000' })).toBe(30_000);
    expect(resolveStallTimeoutMs({ CODEBUDDY_LLM_STALL_TIMEOUT_MS: '0' })).toBe(0);
    expect(resolveStallTimeoutMs({ CODEBUDDY_LLM_STALL_TIMEOUT_MS: 'nope' })).toBe(120_000);
  });
});

describe('resolveFirstTokenStallTimeoutMs', () => {
  const local = { CODEBUDDY_PROVIDER: 'ollama' };

  it('is max(120s, tokens × 200ms) capped at 20 min on a local runtime', () => {
    expect(resolveFirstTokenStallTimeoutMs(0, local)).toBe(120_000);
    expect(resolveFirstTokenStallTimeoutMs(100, local)).toBe(120_000);
    expect(resolveFirstTokenStallTimeoutMs(5604, local)).toBe(1_120_800);
    expect(resolveFirstTokenStallTimeoutMs(1_000_000, local)).toBe(20 * 60 * 1000);
  });

  it('keeps the plain 120s window for cloud providers and unset env (no regression)', () => {
    expect(resolveFirstTokenStallTimeoutMs(5604, {})).toBe(120_000);
    expect(resolveFirstTokenStallTimeoutMs(5604, { CODEBUDDY_PROVIDER: 'gemini' })).toBe(120_000);
    expect(resolveFirstTokenStallTimeoutMs(1_000_000, { CODEBUDDY_PROVIDER: 'chatgpt-oauth' })).toBe(120_000);
    expect(resolveFirstTokenStallTimeoutMs(5604, { CODEBUDDY_PROVIDER: 'xai', OLLAMA_HOST: 'http://127.0.0.1:11434' })).toBe(120_000);
  });

  it('honours CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN and CODEBUDDY_STALL_MAX_MS', () => {
    expect(resolveFirstTokenStallTimeoutMs(100, {
      ...local, CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN: '50',
    })).toBe(120_000);
    expect(resolveFirstTokenStallTimeoutMs(4000, {
      ...local, CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN: '50',
    })).toBe(200_000);
    expect(resolveFirstTokenStallTimeoutMs(5604, {
      ...local, CODEBUDDY_STALL_MAX_MS: '300000',
    })).toBe(300_000);
  });
});

describe('withStallGuard first-token window', () => {
  it('uses the longer first-token budget then the 120s gap', async () => {
    async function* delayedFirst(): AsyncGenerator<string> {
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield 'a';
      yield 'b';
    }
    const chunks: string[] = [];
    for await (const c of withStallGuard(delayedFirst(), 30, { firstTokenTimeoutMs: 500 })) {
      chunks.push(c);
    }
    expect(chunks).toEqual(['a', 'b']);
  });

  it('still fails when the first token exceeds the adaptive budget', async () => {
    const source = stalled();
    await expect(async () => {
      for await (const c of withStallGuard(source, 5_000, { firstTokenTimeoutMs: 80 })) void c;
    }).rejects.toThrow(LlmStallError);
    expect(source.closed).toBe(true);
  });
});
