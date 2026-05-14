import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

const tmpDir = path.join(os.tmpdir(), `cowork-a2a-polling-${Date.now()}`);

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getPath: () => tmpDir,
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: () => {},
  logWarn: () => {},
  logError: () => {},
}));

import { A2ABridge } from '../src/main/a2a/a2a-bridge';
import type { ServerEvent } from '../src/renderer/types';

const AGENT_URL = 'https://example.com/a2a';
const AGENT_NAME = 'TestAgent';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function makeFetchMock(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.endsWith(pattern)) return handler();
    }
    return new Response('Not Found', { status: 404 });
  });
  return { fn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const cardBody = {
  name: AGENT_NAME,
  description: 'desc',
  url: AGENT_URL,
  version: '1.0.0',
  skills: [],
};

describe('A2ABridge — task polling (GAP 1)', () => {
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  async function bootstrapBridge(events: ServerEvent[]) {
    const bridge = new A2ABridge((e) => events.push(e));
    // First seed the registry by mocking a discover+add flow
    const { fn } = makeFetchMock({
      '/.well-known/agent.json': () => jsonResponse(cardBody),
    });
    global.fetch = fn as unknown as typeof fetch;
    const added = await bridge.add(AGENT_URL);
    expect(added.success).toBe(true);
    return { bridge, agentId: added.agent!.id };
  }

  it('emits a single update for an immediately-completed task', async () => {
    const events: ServerEvent[] = [];
    const { bridge, agentId } = await bootstrapBridge(events);

    const { fn } = makeFetchMock({
      '/tasks/send': () =>
        jsonResponse({
          id: 'task-1',
          status: { status: 'completed', timestamp: Date.now() },
          messages: [
            { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
            { role: 'agent', parts: [{ type: 'text', text: 'pong' }] },
          ],
        }),
    });
    global.fetch = fn as unknown as typeof fetch;

    const result = await bridge.invoke(agentId, 'hi');
    expect(result.success).toBe(true);
    expect(result.taskId).toBe('task-1');
    expect(result.status).toBe('completed');

    const updates = events.filter((e) => e.type === 'a2a.task.update');
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.status).toBe('completed');
    expect(updates[0].payload.result).toBe('pong');
  });

  it('polls a working task until terminal state', async () => {
    vi.useFakeTimers();
    const events: ServerEvent[] = [];
    const { bridge, agentId } = await bootstrapBridge(events);

    let pollCount = 0;
    const { fn } = makeFetchMock({
      '/tasks/send': () =>
        jsonResponse({ id: 'task-2', status: { status: 'submitted' } }),
      '/tasks/task-2': () => {
        pollCount++;
        if (pollCount === 1) {
          return jsonResponse({
            id: 'task-2',
            status: { status: 'working' },
          });
        }
        return jsonResponse({
          id: 'task-2',
          status: { status: 'completed' },
          messages: [
            { role: 'agent', parts: [{ type: 'text', text: 'done' }] },
          ],
        });
      },
    });
    global.fetch = fn as unknown as typeof fetch;

    const invokePromise = bridge.invoke(agentId, 'hi');
    await invokePromise;

    // Advance through 2 poll intervals
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(2100);
    // Allow the async fetch.then to settle
    await Promise.resolve();
    await Promise.resolve();

    const updates = events.filter((e) => e.type === 'a2a.task.update');
    const statuses = updates.map((u) => u.payload.status);
    expect(statuses[0]).toBe('submitted');
    expect(statuses).toContain('working');
    expect(statuses[statuses.length - 1]).toBe('completed');
  });

  it('cancelTask POSTs and emits canceled status', async () => {
    const events: ServerEvent[] = [];
    const { bridge, agentId } = await bootstrapBridge(events);

    const { fn, calls } = makeFetchMock({
      '/tasks/send': () =>
        jsonResponse({ id: 'task-3', status: { status: 'working' } }),
      '/tasks/task-3': () =>
        jsonResponse({ id: 'task-3', status: { status: 'working' } }),
      '/tasks/task-3/cancel': () => jsonResponse({ ok: true }),
    });
    global.fetch = fn as unknown as typeof fetch;

    await bridge.invoke(agentId, 'long-running');
    const result = await bridge.cancelTask(agentId, 'task-3');
    expect(result.success).toBe(true);

    const cancelCall = calls.find((c) => c.url.endsWith('/tasks/task-3/cancel'));
    expect(cancelCall).toBeTruthy();
    expect(cancelCall!.init?.method).toBe('POST');

    const updates = events.filter((e) => e.type === 'a2a.task.update');
    expect(updates[updates.length - 1].payload.status).toBe('canceled');
  });

  it('falls back to polling when SSE stream returns non-OK', async () => {
    // Streaming agent — SSE attempt will 503, bridge must fall back to /tasks/:id polling.
    const events: ServerEvent[] = [];
    const bridge = new A2ABridge((e) => events.push(e));
    const streamingCard = {
      ...cardBody,
      capabilities: { streaming: true, pushNotifications: false },
    };
    {
      const { fn } = makeFetchMock({
        '/.well-known/agent.json': () => jsonResponse(streamingCard),
      });
      global.fetch = fn as unknown as typeof fetch;
    }
    const added = await bridge.add(AGENT_URL);
    expect(added.success).toBe(true);
    const agentId = added.agent!.id;

    let pollCount = 0;
    const { fn } = makeFetchMock({
      '/tasks/send': () =>
        jsonResponse({ id: 'task-sse', status: { status: 'working' } }),
      '/tasks/task-sse/stream': () =>
        new Response('Service Unavailable', { status: 503 }),
      '/tasks/task-sse': () => {
        pollCount++;
        return jsonResponse({
          id: 'task-sse',
          status: { status: 'completed' },
          messages: [{ role: 'agent', parts: [{ type: 'text', text: 'streamed' }] }],
        });
      },
    });
    global.fetch = fn as unknown as typeof fetch;

    vi.useFakeTimers();
    await bridge.invoke(agentId, 'go');
    // Let the SSE attempt fail and fall back to polling, then advance once.
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();

    const updates = events.filter((e) => e.type === 'a2a.task.update');
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[updates.length - 1].payload.status).toBe('completed');
    expect(pollCount).toBeGreaterThan(0);
  });

  it('listTasks returns submitted tasks sorted by recency', async () => {
    const events: ServerEvent[] = [];
    const { bridge, agentId } = await bootstrapBridge(events);

    const { fn } = makeFetchMock({
      '/tasks/send': () =>
        jsonResponse({
          id: `task-${Date.now()}`,
          status: { status: 'completed' },
        }),
    });
    global.fetch = fn as unknown as typeof fetch;

    await bridge.invoke(agentId, 'first');
    await new Promise((r) => setTimeout(r, 5));
    await bridge.invoke(agentId, 'second');

    const list = await bridge.listTasks();
    expect(list.length).toBe(2);
    expect(list[0].startedAt).toBeGreaterThanOrEqual(list[1].startedAt);
  });

  it('clearTask removes a tracked task from the main-process list', async () => {
    const events: ServerEvent[] = [];
    const { bridge, agentId } = await bootstrapBridge(events);

    const { fn } = makeFetchMock({
      '/tasks/send': () =>
        jsonResponse({ id: 'task-clear', status: { status: 'completed' } }),
    });
    global.fetch = fn as unknown as typeof fetch;

    await bridge.invoke(agentId, 'clear me');
    expect(await bridge.listTasks()).toHaveLength(1);

    const cleared = await bridge.clearTask('task-clear');
    expect(cleared.success).toBe(true);
    expect(await bridge.listTasks()).toHaveLength(0);
  });

  it('remove drops tasks owned by the removed agent', async () => {
    const events: ServerEvent[] = [];
    const { bridge, agentId } = await bootstrapBridge(events);

    const { fn } = makeFetchMock({
      '/tasks/send': () =>
        jsonResponse({ id: 'task-orphan', status: { status: 'working' } }),
      '/tasks/task-orphan': () =>
        jsonResponse({ id: 'task-orphan', status: { status: 'working' } }),
    });
    global.fetch = fn as unknown as typeof fetch;

    await bridge.invoke(agentId, 'long-running');
    expect(await bridge.listTasks()).toHaveLength(1);

    const removed = await bridge.remove(agentId);
    expect(removed.success).toBe(true);
    expect(removed.removedTaskIds).toEqual(['task-orphan']);
    expect(await bridge.listTasks()).toHaveLength(0);
  });
});
