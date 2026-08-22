/**
 * peer.chat-session.goal tests — Hermes gateway goal-loop parity.
 *
 * Validates:
 *   - goal attach/status/pause/resume/clear lifecycle on a peer session
 *   - mid-run rejection of a new goal while one is active
 *   - server-side judge after continue: verdict + continuationPrompt in the
 *     RPC response (caller-driven continuation)
 *   - budget exhaustion + done transitions
 *   - subgoal actions
 *   - goal persistence in the session store snapshot
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  dispatchPeerRequest,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import {
  _unwireForTests,
  wirePeerSessionBridge,
} from '../../src/fleet/peer-session-bridge.js';
import {
  PeerSessionStore,
  _setPeerSessionStoreForTests,
  resetPeerSessionStore,
} from '../../src/fleet/peer-session-store.js';

const goalJudgeClientMocks = vi.hoisted(() => ({
  resolveGoalJudgeClientFailOpen: vi.fn(async (client: unknown) => client),
}));

vi.mock('../../src/server/websocket/fleet-bridge.js', () => ({
  broadcastChatSessionStart: vi.fn(),
  broadcastChatSessionTurn: vi.fn(),
  broadcastChatSessionEnd: vi.fn(),
  broadcastChatSessionGoal: vi.fn(),
}));

vi.mock('../../src/goals/goal-judge-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/goals/goal-judge-client.js')>()),
  resolveGoalJudgeClientFailOpen: goalJudgeClientMocks.resolveGoalJudgeClientFailOpen,
}));

import { broadcastChatSessionGoal } from '../../src/server/websocket/fleet-bridge.js';

let storeTmpDir: string;

beforeEach(() => {
  storeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-session-goal-test-'));
  _setPeerSessionStoreForTests(new PeerSessionStore({ storeDir: storeTmpDir }));
  vi.mocked(broadcastChatSessionGoal).mockClear();
  goalJudgeClientMocks.resolveGoalJudgeClientFailOpen.mockClear();
  _unwireForTests();
});

afterEach(() => {
  _unwireForTests();
  resetPeerSessionStore();
  fs.rmSync(storeTmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const baseCtx = (overrides: Partial<PeerMethodContext> = {}): PeerMethodContext => ({
  connectionId: 'test-conn',
  scopes: ['peer:invoke'],
  traceId: '',
  depth: 0,
  ...overrides,
});

/**
 * Client mock whose replies are consumed in order. With an active goal each
 * continue consumes TWO replies: the assistant turn, then the judge verdict.
 */
function makeClient(responses: string[]): { chat: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    chat: vi.fn(async () => ({
      choices: [
        { message: { content: responses[Math.min(i++, responses.length - 1)] }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    })),
  };
}

async function dispatch(method: string, params: Record<string, unknown>) {
  return dispatchPeerRequest(
    { id: `req-${Math.random().toString(36).slice(2, 10)}`, method, params },
    baseCtx()
  );
}

async function startSession(client: { chat: unknown }): Promise<string> {
  await wirePeerSessionBridge(() => client as never);
  const res = await dispatch('peer.chat-session.start', {});
  expect(res.ok).toBe(true);
  return (res.payload as { sessionId: string }).sessionId;
}

describe('peer.chat-session.goal — lifecycle', () => {
  it('sets, reports, pauses, resumes, and clears a goal', async () => {
    const sessionId = await startSession(makeClient(['hi']));

    const set = await dispatch('peer.chat-session.goal', {
      sessionId,
      action: 'set',
      goal: 'summarize the repo',
      maxTurns: 4,
    });
    expect(set.ok).toBe(true);
    expect(set.payload).toMatchObject({ goal: 'summarize the repo', status: 'active', maxTurns: 4, turnsUsed: 0 });
    expect(vi.mocked(broadcastChatSessionGoal)).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, status: 'active' })
    );

    const paused = await dispatch('peer.chat-session.goal', { sessionId, action: 'pause' });
    expect(paused.payload).toMatchObject({ status: 'paused', pausedReason: 'user-paused' });

    const resumed = await dispatch('peer.chat-session.goal', { sessionId, action: 'resume' });
    expect(resumed.payload).toMatchObject({ status: 'active', turnsUsed: 0 });

    const cleared = await dispatch('peer.chat-session.goal', { sessionId, action: 'clear' });
    expect(cleared.payload).toMatchObject({ cleared: true, status: 'none' });
  });

  it('resume clears stale judge failure bookkeeping after an auto-pause', async () => {
    const client = makeClient([
      'progress 1', 'not json',
      'progress 2', 'not json',
      'progress 3', 'not json',
    ]);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g', maxTurns: 5 });
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go 1' });
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go 2' });
    const paused = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go 3' });
    expect(paused.payload).toMatchObject({
      goal: expect.objectContaining({ status: 'paused', turnsUsed: 3 }),
    });

    const resumed = await dispatch('peer.chat-session.goal', { sessionId, action: 'resume' });
    expect(resumed.payload).toMatchObject({ status: 'active', turnsUsed: 0 });
    expect((resumed.payload as Record<string, unknown>).lastVerdict).toBeUndefined();
    expect((resumed.payload as Record<string, unknown>).lastReason).toBeUndefined();
    expect((resumed.payload as Record<string, unknown>).pausedReason).toBeUndefined();

    const persisted = await new PeerSessionStore({ storeDir: storeTmpDir }).load(sessionId);
    expect(persisted?.goal).toMatchObject({
      status: 'active',
      turnsUsed: 0,
      consecutiveParseFailures: 0,
    });
    expect(persisted?.goal?.lastVerdict).toBeUndefined();
    expect(persisted?.goal?.lastReason).toBeUndefined();
  });

  it('rejects setting a new goal while one is active (Hermes mid-run rule)', async () => {
    const sessionId = await startSession(makeClient(['hi']));
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'first goal' });

    const second = await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'second goal' });
    expect(second.ok).toBe(false);
    expect(second.error?.message).toContain('GOAL_ACTIVE');
  });

  it('rejects invalid maxTurns instead of silently falling back or truncating', async () => {
    const sessionId = await startSession(makeClient(['hi']));

    for (const maxTurns of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
      const res = await dispatch('peer.chat-session.goal', {
        sessionId,
        action: 'set',
        goal: 'g',
        maxTurns,
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('maxTurns must be a positive integer');
    }
  });

  it('errors on unknown session or unknown action', async () => {
    const sessionId = await startSession(makeClient(['hi']));
    const missing = await dispatch('peer.chat-session.goal', { sessionId: 'sess_nope', action: 'status' });
    expect(missing.error?.message).toContain('SESSION_NOT_FOUND');

    const bad = await dispatch('peer.chat-session.goal', { sessionId, action: 'explode' });
    expect(bad.error?.message).toContain('unknown action');
  });

  it('manages subgoals', async () => {
    const sessionId = await startSession(makeClient(['hi']));
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g' });

    await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-add', text: 'criterion A' });
    const listed = await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-list' });
    expect((listed.payload as { rendered: string }).rendered).toBe('- 1. criterion A');

    for (const index of [0, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      const invalid = await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-remove', index });
      expect(invalid.error?.message).toContain('subgoal index must be a positive integer');
    }
    const stillListed = await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-list' });
    expect((stillListed.payload as { rendered: string }).rendered).toBe('- 1. criterion A');

    const removed = await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-remove', index: 1 });
    expect((removed.payload as { removed: string }).removed).toBe('criterion A');

    const outOfRange = await dispatch('peer.chat-session.goal', { sessionId, action: 'subgoal-remove', index: 9 });
    expect(outOfRange.error?.message).toContain('out of range');
  });
});

describe('peer.chat-session.goal — judge loop on continue', () => {
  it('judges after a turn and returns a continuation prompt on continue verdict', async () => {
    const client = makeClient([
      'I made some progress.',
      '{"done": false, "reason": "summary incomplete"}',
    ]);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'summarize the repo' });

    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });
    expect(res.ok).toBe(true);
    const payload = res.payload as { text: string; goal?: Record<string, unknown> };
    expect(payload.text).toBe('I made some progress.');
    expect(payload.goal).toMatchObject({
      status: 'active',
      verdict: 'continue',
      reason: 'summary incomplete',
      turnsUsed: 1,
    });
    expect(String(payload.goal?.continuationPrompt)).toContain('[Continuing toward your standing goal]');
    expect(String(payload.goal?.message)).toContain('↻ Continuing toward goal (1/');
    expect(vi.mocked(broadcastChatSessionGoal)).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, verdict: 'continue', turnsUsed: 1 })
    );
    // Two LLM calls: the turn + the judge.
    expect(client.chat).toHaveBeenCalledTimes(2);
    expect(client.chat.mock.calls[1]?.[2]).toMatchObject({
      maxTokens: 4096,
      temperature: 0,
    });
  });

  it('pauses and reports an active goal when the peer produces no judgeable response', async () => {
    const client = makeClient(['']);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'summarize the repo' });

    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });
    expect(res.ok).toBe(true);
    const payload = res.payload as { text: string; goal?: Record<string, unknown> };
    expect(payload.text).toBe('');
    expect(payload.goal).toMatchObject({
      status: 'paused',
      verdict: 'skipped',
      reason: 'empty response (nothing to evaluate)',
      turnsUsed: 0,
      message: '⏸ Goal paused — the peer produced no judgeable response.',
    });
    expect(client.chat).toHaveBeenCalledTimes(1);
    expect(vi.mocked(broadcastChatSessionGoal)).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, status: 'paused', verdict: 'skipped', turnsUsed: 0 })
    );

    const persisted = await new PeerSessionStore({ storeDir: storeTmpDir }).load(sessionId);
    expect(persisted?.goal).toMatchObject({
      status: 'paused',
      turnsUsed: 0,
      pausedReason: 'empty response (nothing to evaluate)',
    });
  });

  it('routes configured judge models through the shared fail-open judge-client resolver', async () => {
    const prev = process.env.CODEBUDDY_GOAL_JUDGE_MODEL;
    process.env.CODEBUDDY_GOAL_JUDGE_MODEL = 'gpt-5.5';
    try {
      const client = makeClient([
        'I made some progress.',
        '{"done": false, "reason": "summary incomplete"}',
      ]);
      const sessionId = await startSession(client);
      await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'summarize the repo' });

      const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });
      expect(res.ok).toBe(true);
      expect(goalJudgeClientMocks.resolveGoalJudgeClientFailOpen).toHaveBeenCalledWith(client, 'gpt-5.5');
    } finally {
      if (prev === undefined) delete process.env.CODEBUDDY_GOAL_JUDGE_MODEL;
      else process.env.CODEBUDDY_GOAL_JUDGE_MODEL = prev;
    }
  });

  it('marks the goal done and omits the continuation prompt', async () => {
    const client = makeClient(['All done.', '{"done": true, "reason": "delivered"}']);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g' });

    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });
    const goal = (res.payload as { goal: Record<string, unknown> }).goal;
    expect(goal).toMatchObject({ status: 'done', verdict: 'done' });
    expect(goal.continuationPrompt).toBeUndefined();
    expect(String(goal.message)).toContain('✓ Goal achieved: delivered');

    // Next turn: goal no longer active → no judge call, no goal report.
    const after = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'thanks' });
    expect((after.payload as { goal?: unknown }).goal).toBeUndefined();
  });

  it('does not pause or resume a completed peer-session goal', async () => {
    const client = makeClient(['All done.', '{"done": true, "reason": "delivered"}']);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g' });
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });

    const paused = await dispatch('peer.chat-session.goal', { sessionId, action: 'pause' });
    expect(paused.payload).toMatchObject({
      status: 'done',
      turnsUsed: 1,
      lastVerdict: 'done',
      lastReason: 'delivered',
    });

    const resumed = await dispatch('peer.chat-session.goal', { sessionId, action: 'resume' });
    expect(resumed.payload).toMatchObject({
      status: 'done',
      turnsUsed: 1,
      lastVerdict: 'done',
      lastReason: 'delivered',
    });

    const persisted = await new PeerSessionStore({ storeDir: storeTmpDir }).load(sessionId);
    expect(persisted?.goal).toMatchObject({
      status: 'done',
      turnsUsed: 1,
      lastVerdict: 'done',
      lastReason: 'delivered',
    });
  });

  it('auto-pauses when the turn budget is exhausted', async () => {
    const client = makeClient(['progress', '{"done": false, "reason": "not yet"}']);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g', maxTurns: 1 });

    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });
    const goal = (res.payload as { goal: Record<string, unknown> }).goal;
    expect(goal).toMatchObject({ status: 'paused', turnsUsed: 1, maxTurns: 1 });
    expect(String(goal.message)).toContain('⏸ Goal paused — 1/1 turns used');
  });

  it('turns without a goal carry no goal report and call the LLM once', async () => {
    const client = makeClient(['plain answer']);
    const sessionId = await startSession(client);
    const res = await dispatch('peer.chat-session.continue', { sessionId, prompt: 'hello' });
    expect((res.payload as { goal?: unknown }).goal).toBeUndefined();
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it('persists goal state to the session store across turns', async () => {
    const client = makeClient(['progress', '{"done": false, "reason": "keep going"}']);
    const sessionId = await startSession(client);
    await dispatch('peer.chat-session.goal', { sessionId, action: 'set', goal: 'g' });
    await dispatch('peer.chat-session.continue', { sessionId, prompt: 'go' });

    const persisted = await new PeerSessionStore({ storeDir: storeTmpDir }).load(sessionId);
    expect(persisted?.goal).toMatchObject({
      goal: 'g',
      status: 'active',
      turnsUsed: 1,
      lastVerdict: 'continue',
      lastReason: 'keep going',
    });
  });
});
