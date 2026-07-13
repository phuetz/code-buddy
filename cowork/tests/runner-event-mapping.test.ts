/**
 * Phase 5 — verify CodeBuddyEngineRunner translates each
 * EngineStreamEvent type into the expected ServerEvent the renderer
 * expects.
 *
 * No-mock posture: the *logic under test* (the runner's event → ServerEvent
 * mapping switch) runs for real. Only platform boundaries that can't load in a
 * Node vitest are stubbed — `electron` (`app`) and the dynamic `core-loader` /
 * reasoning bridge. We feed the real mapping a real event via a tiny
 * event-source adapter; nothing about the mapping behaviour is faked. The full
 * `goal_status → goal.status` chain through the real preload + `useIPC` reducer
 * is additionally covered with ZERO mocks in `e2e/goal-banner.spec.ts`.
 *
 * This is the regression net for the event contract: any future
 * change to the renderer's expected ServerEvent shape must update
 * either the runner OR these tests.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async () => null),
}));

vi.mock('../src/main/reasoning/reasoning-bridge', () => ({
  getReasoningBridge: () => ({}),
}));

vi.mock('../src/main/reasoning/reasoning-capture', () => ({
  createReasoningCapture: () => ({
    push: vi.fn(),
    complete: vi.fn(),
  }),
}));

import { CodeBuddyEngineRunner } from '../src/main/engine/codebuddy-engine-runner';
import type { ServerEvent, Session, Message } from '../src/renderer/types';

interface MockAdapter {
  runSession: (
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    onEvent: (event: { type: string; [key: string]: unknown }) => void,
    options?: Record<string, unknown>,
  ) => Promise<{ content: string; tokenCount?: number; toolCallCount?: number }>;
  cancel: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
}

function makeRunner(events: Array<{ type: string; [key: string]: unknown }>): {
  runner: CodeBuddyEngineRunner;
  emitted: ServerEvent[];
  saved: Message[];
} {
  const emitted: ServerEvent[] = [];
  const saved: Message[] = [];
  const adapter: MockAdapter = {
    runSession: async (_sid, _msgs, onEvent) => {
      for (const ev of events) onEvent(ev);
      return { content: '' };
    },
    cancel: vi.fn(),
    clearSession: vi.fn(),
  };
  const runner = new CodeBuddyEngineRunner(adapter, {
    sendToRenderer: (e) => emitted.push(e),
    saveMessage: (m) => saved.push(m),
  });
  return { runner, emitted, saved };
}

const session: Session = {
  id: 'sess-1',
  title: 'test',
  status: 'idle',
  cwd: undefined,
  mountedPaths: [],
  allowedTools: [],
  memoryEnabled: false,
  createdAt: 0,
  updatedAt: 0,
};

async function run(
  events: Array<{ type: string; [key: string]: unknown }>,
): Promise<{ emitted: ServerEvent[]; saved: Message[] }> {
  const { runner, emitted, saved } = makeRunner(events);
  await runner.run(session, 'hello', []);
  return { emitted, saved };
}

describe('CodeBuddyEngineRunner event mapping', () => {
  it("maps `content` chunks to stream.partial deltas", async () => {
    const { emitted } = await run([
      { type: 'content', content: 'hi ' },
      { type: 'content', content: 'there' },
      { type: 'done' },
    ]);
    const partials = emitted.filter((e) => e.type === 'stream.partial');
    expect(partials).toHaveLength(2);
    expect((partials[0].payload as { delta: string }).delta).toBe('hi ');
    expect((partials[1].payload as { delta: string }).delta).toBe('there');
  });

  it("maps `thinking` chunks to stream.thinking", async () => {
    const { emitted } = await run([
      { type: 'thinking', thinking: 'reasoning…' },
      { type: 'done' },
    ]);
    const thinking = emitted.find((e) => e.type === 'stream.thinking');
    expect(thinking).toBeDefined();
    expect((thinking!.payload as { delta: string }).delta).toBe('reasoning…');
  });

  it("maps `tool_start` to a trace.step with status 'running'", async () => {
    const { emitted } = await run([
      {
        type: 'tool_start',
        tool: { id: 'tool_1', name: 'bash', input: '{"command":"ls"}' },
      },
      { type: 'done' },
    ]);
    const step = emitted.find((e) => e.type === 'trace.step');
    expect(step).toBeDefined();
    const payload = step!.payload as {
      step: { id: string; status: string; toolName: string };
    };
    expect(payload.step.id).toBe('tool_1');
    expect(payload.step.status).toBe('running');
    expect(payload.step.toolName).toBe('bash');
  });

  it("maps `tool_end` (success) to trace.update with status 'completed'", async () => {
    const { emitted } = await run([
      {
        type: 'tool_start',
        tool: { id: 't', name: 'bash', input: '{}' },
      },
      {
        type: 'tool_end',
        tool: { id: 't', name: 'bash', output: 'OK', isError: false },
      },
      { type: 'done' },
    ]);
    const updates = emitted.filter((e) => e.type === 'trace.update');
    expect(updates).toHaveLength(1);
    const u = updates[0].payload as {
      stepId: string;
      updates: { status: string; toolOutput: string };
    };
    expect(u.stepId).toBe('t');
    expect(u.updates.status).toBe('completed');
    expect(u.updates.toolOutput).toBe('OK');
  });

  it("maps `tool_end` (error) to trace.update with status 'error'", async () => {
    const { emitted } = await run([
      { type: 'tool_start', tool: { id: 't', name: 'bash', input: '{}' } },
      {
        type: 'tool_end',
        tool: { id: 't', name: 'bash', output: 'boom', isError: true },
      },
      { type: 'done' },
    ]);
    const u = emitted.find((e) => e.type === 'trace.update');
    expect(
      (u!.payload as { updates: { status: string } }).updates.status,
    ).toBe('error');
  });

  it("maps `token_count` to session.contextInfo", async () => {
    const { emitted } = await run([
      { type: 'token_count', tokenCount: 1234 },
      { type: 'done' },
    ]);
    const info = emitted.find((e) => e.type === 'session.contextInfo');
    expect(info).toBeDefined();
    expect((info!.payload as { contextWindow: number }).contextWindow).toBe(1234);
  });

  it("emits stream.done + final stream.message + session.status idle on `done`", async () => {
    const { emitted, saved } = await run([
      { type: 'content', content: 'final answer' },
      { type: 'done' },
    ]);
    const done = emitted.find((e) => e.type === 'stream.done');
    expect(done).toBeDefined();
    const finalMsg = emitted.find((e) => e.type === 'stream.message');
    expect(finalMsg).toBeDefined();
    expect(saved).toHaveLength(2); // user + assistant
    expect(saved[1].role).toBe('assistant');
    const lastStatus = [...emitted]
      .reverse()
      .find((e) => e.type === 'session.status');
    expect(lastStatus).toBeDefined();
    expect(
      (lastStatus!.payload as { status: string }).status,
    ).toBe('idle');
  });

  it("propagates `error` chunks as error ServerEvent", async () => {
    const { emitted, saved } = await run([
      { type: 'error', error: 'rate limited' },
      { type: 'done' },
    ]);
    const err = emitted.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect((err!.payload as { message: string }).message).toBe('rate limited');
    expect(saved[1]?.content).toEqual([{ type: 'text', text: '**Error**: rate limited' }]);
  });

  it("emits a session.status running at turn start", async () => {
    const { emitted } = await run([{ type: 'done' }]);
    const first = emitted.find((e) => e.type === 'session.status');
    expect(first).toBeDefined();
    expect((first!.payload as { status: string }).status).toBe('running');
  });

  it("maps `goal_status` to a goal.status ServerEvent carrying the snapshot", async () => {
    const snapshot = {
      goal: 'Increment counter.txt to 3',
      status: 'active' as const,
      turnsUsed: 2,
      maxTurns: 6,
      lastVerdict: 'continue' as const,
      lastReason: 'still below target',
    };
    const { emitted } = await run([
      { type: 'goal_status', goalStatus: snapshot },
      { type: 'done' },
    ]);
    const goalEvent = emitted.find((e) => e.type === 'goal.status');
    expect(goalEvent).toBeDefined();
    const payload = goalEvent!.payload as { sessionId: string; goal: typeof snapshot };
    expect(payload.sessionId).toBe('sess-1');
    expect(payload.goal).toEqual(snapshot);
  });

  it("drops a `goal_status` event with no snapshot (no goal.status emitted)", async () => {
    const { emitted } = await run([
      { type: 'goal_status' },
      { type: 'done' },
    ]);
    expect(emitted.some((e) => e.type === 'goal.status')).toBe(false);
  });

  it("propagates each turn's snapshot so the banner can show turnsUsed climbing", async () => {
    // Mirrors the desktop adapter's emitGoalSnapshot firing each judged turn:
    // 0/6 up-front, then 1/6, 2/6 as the Ralph loop continues.
    const { emitted } = await run([
      { type: 'goal_status', goalStatus: { goal: 'G', status: 'active', turnsUsed: 0, maxTurns: 6 } },
      { type: 'goal_status', goalStatus: { goal: 'G', status: 'active', turnsUsed: 1, maxTurns: 6, lastVerdict: 'continue' } },
      { type: 'goal_status', goalStatus: { goal: 'G', status: 'done', turnsUsed: 2, maxTurns: 6, lastVerdict: 'done' } },
      { type: 'done' },
    ]);
    const turns = emitted
      .filter((e) => e.type === 'goal.status')
      .map((e) => (e.payload as { goal: { turnsUsed: number; status: string } }).goal);
    expect(turns.map((g) => g.turnsUsed)).toEqual([0, 1, 2]);
    expect(turns[turns.length - 1].status).toBe('done');
  });
});
