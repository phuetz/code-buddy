/**
 * Tests for A2A task router (POC Niveau 2 — cross-host fleet feature).
 * Validates A2AAgentClient.submitTask() routing to remote spokes via HTTP fetch.
 *
 * Coverage:
 * - Happy path: registered remote → fetch returns artifacts → COMPLETED Task
 * - HTTP 5xx: error body propagated into FAILED Task message
 * - Timeout: AbortError → FAILED Task with timeout marker
 * - Unknown agent: throws synchronously before any fetch
 * - URL trailing slash: normalised, no double-slash in fetch URL
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  A2AAgentClient,
  createAgentCard,
  TaskStatus,
  type AgentCard,
} from '../../src/protocols/a2a/index.js';

function makeCard(name: string): AgentCard {
  return createAgentCard({
    name,
    description: `${name} agent`,
    skills: [{
      id: 'echo',
      name: 'echo',
      description: 'echo',
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    }],
  });
}

function registerRemote(client: A2AAgentClient, name: string, url: string): void {
  client.registerRemoteCard(name, {
    url,
    card: makeCard(name),
    lastHeartbeat: Date.now(),
  });
}

describe('A2AAgentClient.submitTask — remote routing', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('happy path: forwards request and wraps spoke response as COMPLETED Task', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        id: 'spoke-task-1',
        status: 'completed',
        result: 'pong',
        artifacts: [{ name: 'response', parts: [{ type: 'text', text: 'pong' }] }],
      }),
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();
    registerRemote(client, 'spoke', 'http://100.73.222.64:3002');

    const task = await client.submitTask('spoke', 'ping', { traceId: 'abc' });

    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    expect(task.artifacts).toHaveLength(1);
    expect(task.artifacts[0].parts[0]).toMatchObject({ type: 'text', text: 'pong' });
    expect(task.metadata).toMatchObject({ traceId: 'abc', agent: 'spoke' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://100.73.222.64:3002/api/a2a/tasks/send');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.message).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: 'ping' }],
    });
    expect(body.metadata).toEqual({ traceId: 'abc' });
  });

  it('result-only response is preserved as task output', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        id: 'spoke-task-2',
        status: { status: 'completed' },
        result: 'plain pong',
      }),
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();
    registerRemote(client, 'spoke', 'http://100.73.222.64:3002');

    const task = await client.submitTask('spoke', 'ping');

    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    expect(task.artifacts[0].parts[0]).toMatchObject({ type: 'text', text: 'plain pong' });
    expect(task.messages[1]).toMatchObject({
      role: 'agent',
      parts: [{ type: 'text', text: 'plain pong' }],
    });
  });

  it('200 response with failed remote status stays FAILED locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        id: 'spoke-task-failed',
        status: { status: 'failed', message: 'remote model unavailable' },
        result: '',
      }),
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();
    registerRemote(client, 'spoke', 'http://100.73.222.64:3002');

    const task = await client.submitTask('spoke', 'ping');

    expect(task.status.status).toBe(TaskStatus.FAILED);
    expect(task.status.message).toBe('remote model unavailable');
    expect(task.metadata).toMatchObject({
      agent: 'spoke',
      remoteTaskId: 'spoke-task-failed',
    });
  });

  it('5xx response: body propagated into FAILED Task message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
      text: async () => '{"error":"ollama refused: prompt must be string"}',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();
    registerRemote(client, 'spoke', 'http://x:3002');

    const task = await client.submitTask('spoke', 'ping');

    expect(task.status.status).toBe(TaskStatus.FAILED);
    expect(task.status.message).toContain('500');
    expect(task.status.message).toContain('Internal Server Error');
    expect(task.status.message).toContain('ollama refused');
  });

  it('timeout: AbortError mapped to FAILED Task with timeout marker', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();
    registerRemote(client, 'slowpoke', 'http://x:3002');

    const task = await client.submitTask('slowpoke', 'ping');

    expect(task.status.status).toBe(TaskStatus.FAILED);
    expect(task.status.message).toMatch(/timed out/i);
    expect(task.status.message).toContain('slowpoke');
  });

  it('unknown agent: throws before any fetch', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();

    await expect(client.submitTask('ghost', 'ping')).rejects.toThrow(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL trailing slash: normalised, no double-slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ artifacts: [] }),
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();
    registerRemote(client, 'spoke', 'http://x:3002/');

    await client.submitTask('spoke', 'ping');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x:3002/api/a2a/tasks/send');
    expect(url).not.toContain('//api');
  });

  it('multiple trailing slashes are all stripped', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ artifacts: [] }),
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();
    registerRemote(client, 'spoke', 'http://x:3002///');

    await client.submitTask('spoke', 'ping');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://x:3002/api/a2a/tasks/send');
  });
});
