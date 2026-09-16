/**
 * Tests for A2A skill-based routing (POC Niveau 3 — fleet feature).
 *
 * Validates the V0.1 dispatch logic at the A2AAgentClient level:
 * - resolveTarget({agent}) → explicit Niveau 2 routing (back-compat)
 * - resolveTarget({skill}) → auto-resolution via findAgentsWithSkill + selectAgent
 * - resolveTarget({}) and resolveTarget({agent, skill}) → 400 errors
 * - resolveTarget({skill}) with no matching spoke → 404
 *
 * Pattern follows tests/protocols/a2a-task-router.test.ts (mock global.fetch
 * at the A2AAgentClient level — no Express supertest dependency).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  A2AAgentClient,
  createAgentCard,
  selectAgent,
  TaskStatus,
  type AgentCard,
} from '../../src/protocols/a2a/index.js';

function makeCard(name: string, skillIds: string[]): AgentCard {
  return createAgentCard({
    name,
    description: `${name} agent`,
    skills: skillIds.map((id) => ({
      id,
      name: id,
      description: id,
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    })),
  });
}

function registerRemote(client: A2AAgentClient, name: string, url: string, skillIds: string[]): void {
  client.registerRemoteCard(name, {
    url,
    card: makeCard(name, skillIds),
    lastHeartbeat: Date.now(),
  });
}

describe('selectAgent (V0.1 — first strategy)', () => {
  it('returns the first candidate', () => {
    expect(selectAgent(['a', 'b', 'c'])).toBe('a');
  });

  it('returns the only candidate when list has one entry', () => {
    expect(selectAgent(['only'])).toBe('only');
  });

  it('throws on empty list', () => {
    expect(() => selectAgent([])).toThrow(/empty candidate/i);
  });
});

describe('A2AAgentClient.resolveTarget — POC Niveau 3 dispatch', () => {
  it('explicit {agent}: returns the agent key as-is (Niveau 2 back-compat)', () => {
    const client = new A2AAgentClient();
    const result = client.resolveTarget({ agent: 'spoke-x' });
    expect(result).toEqual({ agentKey: 'spoke-x' });
  });

  it('{skill} with one matching spoke: routes to that spoke', () => {
    const client = new A2AAgentClient();
    registerRemote(client, 'spoke-a', 'http://a:3002', ['ollama-qwen2.5-coder-32b']);
    registerRemote(client, 'spoke-b', 'http://b:3002', ['ollama-gemma4-26b']);

    const result = client.resolveTarget({ skill: 'ollama-qwen2.5-coder-32b' });
    expect(result).toEqual({ agentKey: 'spoke-a' });
  });

  it('{skill} with two matching spokes: first strategy picks first', () => {
    const client = new A2AAgentClient();
    registerRemote(client, 'spoke-1', 'http://1:3002', ['ollama-qwen3-4b']);
    registerRemote(client, 'spoke-2', 'http://2:3002', ['ollama-qwen3-4b']);

    const result = client.resolveTarget({ skill: 'ollama-qwen3-4b' });
    expect(result).toEqual({ agentKey: 'spoke-1' });
  });

  it('{skill} with no matching spoke: 404 with clear message', () => {
    const client = new A2AAgentClient();
    registerRemote(client, 'spoke-x', 'http://x:3002', ['some-other-skill']);

    const result = client.resolveTarget({ skill: 'inexistent-skill' });
    expect(result).toEqual({
      error: 'No agents found for skill: inexistent-skill',
      status: 404,
    });
  });

  it('both {agent} and {skill}: 400 mutual exclusion', () => {
    const client = new A2AAgentClient();
    const result = client.resolveTarget({ agent: 'spoke-x', skill: 'some-skill' });
    expect(result).toEqual({
      error: 'Provide either `agent` or `skill`, not both',
      status: 400,
    });
  });

  it('neither {agent} nor {skill}: 400 missing field', () => {
    const client = new A2AAgentClient();
    const result = client.resolveTarget({});
    expect(result).toEqual({
      error: 'Missing required field: `agent` or `skill`',
      status: 400,
    });
  });
});

describe('A2AAgentClient.submitTask via skill (E2E with mocked fetch)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('full flow: resolve skill → submitTask → fetch the spoke URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ result: 'pong', artifacts: [] }),
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new A2AAgentClient();
    registerRemote(client, 'ollama-hub', 'http://203.0.113.14:3002', ['ollama-qwen2.5-coder-32b']);

    const target = client.resolveTarget({ skill: 'ollama-qwen2.5-coder-32b' });
    expect('agentKey' in target).toBe(true);

    if ('agentKey' in target) {
      const task = await client.submitTask(target.agentKey, 'ping');
      expect(task.status.status).toBe(TaskStatus.COMPLETED);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('http://203.0.113.14:3002/api/a2a/tasks/send');
    }
  });
});
