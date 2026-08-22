import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tracker = vi.hoisted(() => ({
  isWithinBudget: vi.fn(),
  charge: vi.fn(),
}));

vi.mock('../../src/fleet/cost-tracker.js', () => ({
  DEFAULT_BUDGET: { maxDailyUsd: 5, maxSagaUsd: 1 },
  getCostTracker: () => tracker,
}));

import {
  dispatchPeerRequest,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import {
  _unwireForTests as unwireChatForTests,
  wirePeerChatBridge,
} from '../../src/fleet/peer-chat-bridge.js';
import {
  _unwireForTests as unwireSessionForTests,
  wirePeerSessionBridge,
} from '../../src/fleet/peer-session-bridge.js';
import {
  PeerSessionStore,
  _setPeerSessionStoreForTests,
  resetPeerSessionStore,
} from '../../src/fleet/peer-session-store.js';

const ENV_KEYS = [
  'CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL',
  'CODEBUDDY_FLEET_MAX_DAILY_USD',
  'CODEBUDDY_FLEET_MAX_SAGA_USD',
] as const;

const providerInfo = {
  provider: 'openai' as const,
  model: 'gpt-4o',
  isLocal: false,
};

const baseContext: PeerMethodContext = {
  connectionId: 'remote-peer-1',
  scopes: ['peer:invoke'],
  traceId: '',
  depth: 0,
};

let storeDir: string;
let requestIndex = 0;

function makeClient(usage = {
  prompt_tokens: 120,
  completion_tokens: 30,
  total_tokens: 150,
}) {
  return {
    getCurrentModel: vi.fn(() => 'gpt-4o'),
    chat: vi.fn(async () => ({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage,
    })),
  };
}

async function dispatch(method: string, params: Record<string, unknown>) {
  requestIndex += 1;
  return dispatchPeerRequest(
    {
      id: `cost-cap-${requestIndex}`,
      method,
      params,
      traceId: `trace-cost-cap-${requestIndex}`,
    },
    baseContext,
  );
}

beforeEach(() => {
  unwireChatForTests();
  unwireSessionForTests();
  for (const key of ENV_KEYS) delete process.env[key];
  tracker.isWithinBudget.mockReset().mockResolvedValue({
    allowed: true,
    remainingUsd: 0.9,
  });
  tracker.charge.mockReset().mockResolvedValue(undefined);
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-cost-cap-'));
  _setPeerSessionStoreForTests(new PeerSessionStore({ storeDir }));
});

afterEach(() => {
  unwireChatForTests();
  unwireSessionForTests();
  resetPeerSessionStore();
  for (const key of ENV_KEYS) delete process.env[key];
  fs.rmSync(storeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('peer.chat inbound cost cap', () => {
  it('applies the configured maxTokens by default and caps excessive requests', async () => {
    process.env.CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL = '512';
    const client = makeClient();
    wirePeerChatBridge(() => client as never, providerInfo);

    const defaulted = await dispatch('peer.chat', { prompt: 'first', model: 'gpt-4o' });
    const capped = await dispatch('peer.chat', {
      prompt: 'second',
      model: 'gpt-4o',
      maxTokens: 50_000,
    });

    expect(defaulted.ok).toBe(true);
    expect(capped.ok).toBe(true);
    expect(client.chat.mock.calls[0]?.[2]).toMatchObject({ model: 'gpt-4o', maxTokens: 512 });
    expect(client.chat.mock.calls[1]?.[2]).toMatchObject({ model: 'gpt-4o', maxTokens: 512 });
  });

  it('refuses an exceeded budget before invoking the LLM', async () => {
    tracker.isWithinBudget.mockResolvedValue({
      allowed: false,
      reason: 'Daily cap reached',
    });
    const client = makeClient();
    wirePeerChatBridge(() => client as never, providerInfo);

    const response = await dispatch('peer.chat', { prompt: 'expensive', model: 'gpt-4o' });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('FLEET_BUDGET_EXCEEDED');
    expect(response.error?.message).toContain('Daily cap reached');
    expect(client.chat).not.toHaveBeenCalled();
    expect(tracker.charge).not.toHaveBeenCalled();
  });

  it('charges actual returned usage after an allowed call', async () => {
    const client = makeClient({
      prompt_tokens: 200,
      completion_tokens: 40,
      total_tokens: 240,
    });
    wirePeerChatBridge(() => client as never, providerInfo);

    const response = await dispatch('peer.chat', { prompt: 'allowed', model: 'gpt-4o' });

    expect(response.ok).toBe(true);
    expect(client.chat).toHaveBeenCalledTimes(1);
    expect(tracker.charge).toHaveBeenCalledTimes(1);
    expect(tracker.charge).toHaveBeenCalledWith(expect.objectContaining({
      peerId: 'remote-peer-1',
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: 200,
      tokensOut: 40,
      usd: 0.0009,
    }));
  });

  it('uses conservative token and dollar defaults when no env is configured', async () => {
    const client = makeClient();
    wirePeerChatBridge(() => client as never, providerInfo);

    const response = await dispatch('peer.chat', { prompt: 'defaults', model: 'gpt-4o' });

    expect(response.ok).toBe(true);
    expect(client.chat.mock.calls[0]?.[2]).toMatchObject({ maxTokens: 4096 });
    expect(tracker.isWithinBudget).toHaveBeenCalledWith(
      expect.any(Number),
      { maxDailyUsd: 5, maxSagaUsd: 1 },
      expect.stringMatching(/^trace-cost-cap-/),
    );
  });

  it('fails closed when the budget tracker cannot decide', async () => {
    tracker.isWithinBudget.mockRejectedValue(new Error('ledger unreadable'));
    const client = makeClient();
    wirePeerChatBridge(() => client as never, providerInfo);

    const response = await dispatch('peer.chat', { prompt: 'check failure', model: 'gpt-4o' });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('FLEET_BUDGET_CHECK_FAILED');
    expect(client.chat).not.toHaveBeenCalled();
  });
});

describe('peer.chat-session.continue inbound cost cap', () => {
  it('checks budget, caps maxTokens, calls the LLM, then charges real usage', async () => {
    process.env.CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL = '256';
    process.env.CODEBUDDY_FLEET_MAX_DAILY_USD = '2.5';
    process.env.CODEBUDDY_FLEET_MAX_SAGA_USD = '0.5';
    const client = makeClient({
      prompt_tokens: 80,
      completion_tokens: 20,
      total_tokens: 100,
    });
    await wirePeerSessionBridge(() => client as never, providerInfo);
    const started = await dispatch('peer.chat-session.start', { model: 'gpt-4o' });
    const sessionId = (started.payload as { sessionId: string }).sessionId;

    const response = await dispatch('peer.chat-session.continue', {
      sessionId,
      prompt: 'session turn',
      maxTokens: 10_000,
    });

    expect(response.ok).toBe(true);
    expect(tracker.isWithinBudget).toHaveBeenCalledWith(
      expect.any(Number),
      { maxDailyUsd: 2.5, maxSagaUsd: 0.5 },
      expect.stringMatching(/^trace-cost-cap-/),
    );
    expect(client.chat.mock.calls[0]?.[2]).toMatchObject({ model: 'gpt-4o', maxTokens: 256 });
    expect(tracker.charge).toHaveBeenCalledWith(expect.objectContaining({
      peerId: 'remote-peer-1',
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: 80,
      tokensOut: 20,
      usd: 0.0004,
      runId: sessionId,
    }));
  });

  it('does not mutate session history when the session budget is refused', async () => {
    const client = makeClient();
    await wirePeerSessionBridge(() => client as never, providerInfo);
    const started = await dispatch('peer.chat-session.start', { model: 'gpt-4o' });
    const sessionId = (started.payload as { sessionId: string }).sessionId;
    tracker.isWithinBudget.mockResolvedValue({
      allowed: false,
      reason: 'Per-saga cap reached',
    });

    const response = await dispatch('peer.chat-session.continue', {
      sessionId,
      prompt: 'blocked turn',
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('FLEET_BUDGET_EXCEEDED');
    expect(client.chat).not.toHaveBeenCalled();
    expect(tracker.charge).not.toHaveBeenCalled();
  });
});
