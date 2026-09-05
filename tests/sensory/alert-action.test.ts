/**
 * BUG-02: the `alert` action must propagate the REAL Telegram delivery result.
 * Before the fix it returned {ok:true} unconditionally — a silent false success that made
 * rule-runs.jsonl lie and left the operator unwarned. These tests are red→green on that fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeSensoryAction } from '../../src/sensory/sensory-action-executor.js';

const origFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  delete process.env.TELEGRAM_BOT_TOKEN;
});
afterEach(() => {
  globalThis.fetch = origFetch;
  delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  delete process.env.TELEGRAM_BOT_TOKEN;
  vi.restoreAllMocks();
});

describe('alert action delivery propagation', () => {
  it('returns ok:false when Telegram is unconfigured (no token/chat)', async () => {
    const res = await executeSensoryAction(
      { type: 'alert', message: 'runaway!' },
      { kind: 'process_runaway' },
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/telegram|unconfigured|failed/i);
  });

  it('returns ok:true when delivery succeeds', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    globalThis.fetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
    const res = await executeSensoryAction(
      { type: 'alert', message: 'runaway!' },
      { kind: 'process_runaway' },
    );
    expect(res.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false when Telegram rejects the message', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    globalThis.fetch = vi.fn(async () => ({ ok: false }) as unknown as Response);
    const res = await executeSensoryAction(
      { type: 'alert', message: 'runaway!' },
      { kind: 'process_runaway' },
    );
    expect(res.ok).toBe(false);
  });
});
