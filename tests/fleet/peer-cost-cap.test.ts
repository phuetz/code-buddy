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


describe('all fleet model entry points', () => {
  it.each(['peer.chat-stream', 'peer.chat-session.continue-stream', 'peer.dispatch'])(
    'refuses %s before model invocation when budget is exhausted', async method => {
      tracker.isWithinBudget.mockResolvedValue({ allowed: false, reason: 'cap reached' });
      const client = { ...makeClient(), chatStream: vi.fn(async function* () { yield { choices: [{ delta: { content: 'unguarded' } }] }; }) };
      wirePeerChatBridge(() => client as never, providerInfo);
      await wirePeerSessionBridge(() => client as never, providerInfo);
      const started = await dispatch('peer.chat-session.start', {});
      const sessionId = (started.payload as { sessionId: string }).sessionId;
      const result = await dispatch(method, { sessionId, prompt: 'blocked', id: 'cost-dispatch' });
      if (method === 'peer.dispatch') {
        const { getDispatchState } = await import('../../src/fleet/peer-chat-bridge.js');
        await vi.waitFor(() => expect(getDispatchState('cost-dispatch')?.status).toBe('failed'));
        expect(getDispatchState('cost-dispatch')?.error).toContain('FLEET_BUDGET_EXCEEDED');
      } else {
        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('FLEET_BUDGET_EXCEEDED');
      }
      expect(client.chat).not.toHaveBeenCalled();
      expect(client.chatStream).not.toHaveBeenCalled();
      expect(tracker.charge).not.toHaveBeenCalled();
    },
  );

  it.each(['peer.chat-session.continue', 'peer.chat-session.continue-stream', 'peer.chat-session.end', 'peer.chat-session.goal'])(
    'refuses %s from another principal', async method => {
      const client = makeClient();
      await wirePeerSessionBridge(() => client as never, providerInfo);
      const started = await dispatchPeerRequest({ id: 'owner', method: 'peer.chat-session.start' }, { ...baseContext, principalId: 'user:creator' });
      const sessionId = (started.payload as { sessionId: string }).sessionId;
      const response = await dispatchPeerRequest({ id: 'other', method, params: { sessionId, prompt: 'stolen', action: 'set', goal: 'stolen' } }, { ...baseContext, principalId: 'user:other' });
      expect(response.ok).toBe(false);
      expect(response.error?.message).toContain('SESSION_FORBIDDEN');
      expect(client.chat).not.toHaveBeenCalled();
      const owner = await dispatchPeerRequest({ id: 'reconnect', method: 'peer.chat-session.continue', params: { sessionId, prompt: 'owned' } }, { ...baseContext, connectionId: 'reconnected', principalId: 'user:creator' });
      expect(owner.ok).toBe(true);
    },
  );
});


it('also gates the post-turn goal judge model invocation', async () => {
  tracker.isWithinBudget.mockResolvedValueOnce({ allowed: true, remainingUsd: 1 })
    .mockResolvedValue({ allowed: false, reason: 'judge cap reached' });
  const client = makeClient();
  await wirePeerSessionBridge(() => client as never, providerInfo);
  const started = await dispatch('peer.chat-session.start', {});
  const sessionId = (started.payload as { sessionId: string }).sessionId;
  await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'finish the task' });
  const result = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'work' });
  expect(result.ok).toBe(true);
  expect(tracker.isWithinBudget).toHaveBeenCalledTimes(2);
  expect(client.chat).toHaveBeenCalledTimes(1);
  expect(tracker.charge).toHaveBeenCalledTimes(1);
});

it.each(['peer.chat-stream', 'peer.chat-session.continue-stream', 'peer.dispatch'])(
  'caps tokens and records actual usage for %s', async method => {
    process.env.CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL = '128';
    const client = { ...makeClient(), chatStream: vi.fn(async function* () {
      yield { choices: [{ delta: { content: 'streamed' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8 } };
    }) };
    wirePeerChatBridge(() => client as never, providerInfo);
    await wirePeerSessionBridge(() => client as never, providerInfo);
    const started = await dispatch('peer.chat-session.start', {});
    const sessionId = (started.payload as { sessionId: string }).sessionId;
    const result = await dispatch(method, { sessionId, prompt: 'allowed', id: 'allowed-dispatch', maxTokens: 9999 });
    expect(result.ok).toBe(true);
    if (method === 'peer.dispatch') {
      const { getDispatchState } = await import('../../src/fleet/peer-chat-bridge.js');
      await vi.waitFor(() => expect(getDispatchState('allowed-dispatch')?.status).toBe('completed'));
      expect(client.chat.mock.calls[0]?.[2]).toMatchObject({ maxTokens: 128 });
    } else {
      expect(client.chatStream.mock.calls[0]?.[2]).toMatchObject({ maxTokens: 128 });
      expect(tracker.charge).toHaveBeenCalledWith(expect.objectContaining({ tokensIn: 12, tokensOut: 8, usd: 0.00011 }));
      expect(result.payload).toMatchObject({ text: 'streamed' });
    }
    expect(tracker.charge).toHaveBeenCalledTimes(1);
  },
);

it('charges conservatively when a model stream is interrupted after partial output', async () => {
  const client = { ...makeClient(), chatStream: vi.fn(async function* () {
    yield { choices: [{ delta: { content: 'partial' } }] };
    throw new Error('disconnected');
  }) };
  wirePeerChatBridge(() => client as never, providerInfo);
  const response = await dispatch('peer.chat-stream', { prompt: 'cut' });
  expect(response.ok).toBe(false);
  expect(tracker.charge).toHaveBeenCalledWith(expect.objectContaining({ tokensOut: 4096 }));
});

it('persists creator identity and denies legacy unowned records except to admin', async () => {
  const client = makeClient();
  await wirePeerSessionBridge(() => client as never, providerInfo);
  const ownerContext = { ...baseContext, principalId: 'user:creator' };
  const started = await dispatchPeerRequest({ id: 'persist-owner', method: 'peer.chat-session.start' }, ownerContext);
  const sessionId = (started.payload as { sessionId: string }).sessionId;
  expect(JSON.parse(fs.readFileSync(path.join(storeDir, `${sessionId}.json`), 'utf8')).ownerId).toBe('user:creator');
  unwireSessionForTests();
  const now = Date.now();
  await new PeerSessionStore({ storeDir }).save({ sessionId: 'legacy', systemPrompt: 'test', messages: [], createdAt: now, lastUsedAt: now });
  await wirePeerSessionBridge(() => client as never, providerInfo);
  const continuation = { id: 'hydrated', method: 'peer.chat-session.continue', params: { sessionId, prompt: 'owned' } };
  expect((await dispatchPeerRequest(continuation, { ...ownerContext, connectionId: 'new-socket' })).ok).toBe(true);
  const legacy = { ...continuation, params: { sessionId: 'legacy', prompt: 'recover' } };
  expect((await dispatchPeerRequest(legacy, ownerContext)).error?.message).toContain('SESSION_FORBIDDEN');
  expect((await dispatchPeerRequest(legacy, { ...ownerContext, scopes: ['admin', 'peer:invoke'] })).ok).toBe(true);
});

it('ends after pending turns and refuses new turns during shutdown', async () => {
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const invoked = new Promise<void>(resolve => { entered = resolve; });
  const client = { ...makeClient(), chat: vi.fn(async () => {
    entered(); await pending;
    return { choices: [{ message: { content: 'complete' } }] };
  }) };
  await wirePeerSessionBridge(() => client as never, providerInfo);
  const started = await dispatch('peer.chat-session.start', {});
  const sessionId = (started.payload as { sessionId: string }).sessionId;
  const turn = dispatch('peer.chat-session.continue', { sessionId, prompt: 'pending' });
  await invoked;
  const end = dispatch('peer.chat-session.end', { sessionId });
  const refused = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'too late' });
  expect(refused.error?.message).toContain('SESSION_CLOSING');
  release();
  expect((await turn).ok).toBe(true);
  expect((await end).payload).toMatchObject({ closed: true });
  expect(fs.existsSync(path.join(storeDir, `${sessionId}.json`))).toBe(false);
  expect(client.chat).toHaveBeenCalledTimes(1);
});
