import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  ServerAgent,
  ServerConversationState,
} from '../../src/server/agent-adapter.js';
import { getRestorableCompressor } from '../../src/context/restorable-compression.js';

const adapterMocks = vi.hoisted(() => ({
  createServerAgent: vi.fn(),
}));

vi.mock('../../src/server/agent-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/server/agent-adapter.js')>(
    '../../src/server/agent-adapter.js',
  );
  return {
    ...actual,
    createServerAgent: adapterMocks.createServerAgent,
  };
});

import {
  __getHttpAgentSessionCacheSizeForTests,
  __resetHttpAgentSessionCacheForTests,
  buildHttpAgentSessionKey,
  buildHttpRequestSessionKey,
  withHttpSessionAgent,
} from '../../src/server/http-agent-sessions.js';

function emptyState(): ServerConversationState {
  return {
    messages: [],
    chatHistory: [],
    sessionCost: 0,
    routingSessionCost: 0,
    workingDirectory: '/neutral-workspace',
    contextManagerState: {
      summaries: [],
      systemMessage: null,
      triggeredWarnings: [],
      lastTokenCount: 0,
      lastEnhancedResult: null,
      sessionId: 'neutral-constructor-session',
      peakMessageCount: 0,
      compressionCount: 0,
      totalTokensSaved: 0,
      lastCompressionTime: null,
      snapshotCount: 0,
      enhancedCompression: null,
    },
  };
}

class FakeStatefulAgent implements ServerAgent {
  state = emptyState();
  recoverySessionId: string | undefined;
  disposed = false;
  failNextSeed = false;
  hiddenState = 'clean';

  processUserMessage = vi.fn(async () => []);
  processUserMessageStream = vi.fn(async function* () {
    yield { type: 'done' as const };
  });
  getChatHistory = () => structuredClone(this.state.chatHistory);
  getCurrentModel = () => 'fake-model';
  setModel = vi.fn();
  executeToolByName = vi.fn(async (name: string, parameters: Record<string, unknown> = {}) => {
    if (name === 'bash' && typeof parameters.command === 'string') {
      if (parameters.command.startsWith('cd ')) {
        this.state.workingDirectory = parameters.command.slice(3).trim();
        return { success: true, output: `Changed directory to: ${this.state.workingDirectory}` };
      }
      if (parameters.command === 'pwd') {
        return { success: true, output: this.state.workingDirectory };
      }
    }
    return { success: true };
  });
  systemPromptReady = Promise.resolve();

  abortCurrentOperation(): void {}

  setRecoverySessionId(sessionId: string | undefined): void {
    this.recoverySessionId = sessionId;
  }

  addToHistory(message: { role: 'user' | 'assistant' | 'system'; content: string }): void {
    if (this.failNextSeed) {
      this.failNextSeed = false;
      throw new Error('seed failed');
    }
    this.state.messages.push(message);
  }

  exportConversationState(): ServerConversationState {
    return structuredClone(this.state);
  }

  importConversationState(state: ServerConversationState): void {
    this.state = structuredClone(state);
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe('HTTP agent session isolation', () => {
  const agents: FakeStatefulAgent[] = [];
  let previousMax: string | undefined;

  beforeEach(() => {
    previousMax = process.env.CODEBUDDY_HTTP_AGENT_CACHE_MAX;
    adapterMocks.createServerAgent.mockReset();
    adapterMocks.createServerAgent.mockImplementation(async () => {
      const agent = new FakeStatefulAgent();
      agents.push(agent);
      return agent;
    });
  });

  afterEach(async () => {
    await __resetHttpAgentSessionCacheForTests();
    agents.splice(0);
    if (previousMax === undefined) delete process.env.CODEBUDDY_HTTP_AGENT_CACHE_MAX;
    else process.env.CODEBUDDY_HTTP_AGENT_CACHE_MAX = previousMax;
  });

  it('builds opaque tenant-bound keys and validates client IDs', () => {
    const keyA = buildHttpAgentSessionKey('principal-a', 'shared');
    const keyB = buildHttpAgentSessionKey('principal-b', 'shared');

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toContain('principal-a');
    expect(keyA).not.toContain('shared');
    expect(buildHttpAgentSessionKey('principal-a', undefined))
      .toBe(buildHttpAgentSessionKey('principal-a', ''));
    expect(() => buildHttpAgentSessionKey('principal-a', 42))
      .toThrow('sessionId must be a string');
  });

  it('binds anonymous sessions to IP while authenticated principals ignore it', () => {
    const anonymousA = buildHttpRequestSessionKey({ ip: '127.0.0.1' }, 'shared');
    const anonymousB = buildHttpRequestSessionKey({ ip: '127.0.0.2' }, 'shared');
    expect(anonymousA).not.toBe(anonymousB);

    const authenticatedA = buildHttpRequestSessionKey({
      auth: { userId: 'user-1' },
      ip: '127.0.0.1',
    }, 'shared');
    const authenticatedB = buildHttpRequestSessionKey({
      auth: { userId: 'user-1' },
      ip: '203.0.113.9',
    }, 'shared');
    expect(authenticatedA).toBe(authenticatedB);
    expect(buildHttpRequestSessionKey({ auth: { userId: 'same-id' } }, 'shared'))
      .not.toBe(buildHttpRequestSessionKey({ auth: { keyId: 'same-id' } }, 'shared'));
  });

  it('treats missing request session IDs as stateless request scopes', () => {
    const request = { auth: { userId: 'user-1' } };

    const missingA = buildHttpRequestSessionKey(request, undefined);
    const missingB = buildHttpRequestSessionKey(request, undefined);
    expect(missingA).toMatch(/^api:request:[a-f0-9]{64}$/);
    expect(missingA).not.toBe(missingB);
    expect(buildHttpRequestSessionKey(request, null)).toMatch(/^api:request:/);
    expect(buildHttpRequestSessionKey(request, '   ')).toMatch(/^api:request:/);
    const explicit = buildHttpRequestSessionKey(request, 'explicit');
    expect(explicit).toMatch(/^api:agent:[a-f0-9]{64}$/);
    expect(explicit).toBe(buildHttpRequestSessionKey(request, 'explicit'));
  });

  it('swaps history, costs, context state, and recovery scope on one host agent', async () => {
    const keyA = buildHttpAgentSessionKey('alice', 'conversation');
    const keyB = buildHttpAgentSessionKey('bob', 'conversation');

    await withHttpSessionAgent(keyA, async (agent) => {
      const fake = agent as FakeStatefulAgent;
      expect(fake.recoverySessionId).toBe(keyA);
      expect(fake.state.messages).toEqual([{ role: 'user', content: 'seed-a' }]);
      expect(fake.state.contextManagerState.sessionId).toBe(keyA);
      fake.state.messages.push({ role: 'assistant', content: 'private-a' });
      fake.state.sessionCost = 1.25;
      fake.state.routingSessionCost = 1.5;
      fake.state.contextManagerState.triggeredWarnings = [50];
    }, [{ role: 'user', content: 'seed-a' }]);

    await withHttpSessionAgent(keyB, async (agent) => {
      const fake = agent as FakeStatefulAgent;
      expect(fake.recoverySessionId).toBe(keyB);
      expect(fake.state.messages).toEqual([{ role: 'user', content: 'seed-b' }]);
      expect(fake.state.sessionCost).toBe(0);
      expect(fake.state.routingSessionCost).toBe(0);
      expect(fake.state.contextManagerState.triggeredWarnings).toEqual([]);
      expect(fake.state.contextManagerState.sessionId).toBe(keyB);
    }, [{ role: 'user', content: 'seed-b' }]);

    await withHttpSessionAgent(keyA, async (agent) => {
      const fake = agent as FakeStatefulAgent;
      expect(fake.state.messages).toContainEqual({ role: 'assistant', content: 'private-a' });
      expect(fake.state.messages).not.toContainEqual({ role: 'user', content: 'seed-b' });
      expect(fake.state.sessionCost).toBe(1.25);
      expect(fake.state.routingSessionCost).toBe(1.5);
      expect(fake.state.contextManagerState.triggeredWarnings).toEqual([50]);
    });

    expect(adapterMocks.createServerAgent).toHaveBeenCalledTimes(1);
    expect(agents[0]?.recoverySessionId).toBeUndefined();
    expect(agents[0]?.state).toEqual(emptyState());
  });

  it('holds a global mutex for the complete asynchronous operation', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withHttpSessionAgent('session-a', async () => {
      order.push('a:start');
      await firstGate;
      order.push('a:end');
    });
    await vi.waitFor(() => expect(order).toEqual(['a:start']));

    const second = withHttpSessionAgent('session-b', async () => {
      order.push('b:start');
      order.push('b:end');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['a:start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('rolls a failed turn back to the last successful snapshot', async () => {
    const key = buildHttpAgentSessionKey('alice', 'rollback');

    await withHttpSessionAgent(key, async (agent) => {
      (agent as FakeStatefulAgent).state.messages.push({
        role: 'assistant',
        content: 'COMMITTED',
      });
    });

    await expect(withHttpSessionAgent(key, async (agent) => {
      (agent as FakeStatefulAgent).state.messages.push({
        role: 'assistant',
        content: 'PARTIAL',
      });
      throw new Error('turn failed');
    })).rejects.toThrow('turn failed');

    await withHttpSessionAgent(key, async (agent) => {
      expect((agent as FakeStatefulAgent).state.messages).toContainEqual({
        role: 'assistant',
        content: 'COMMITTED',
      });
      expect((agent as FakeStatefulAgent).state.messages).not.toContainEqual({
        role: 'assistant',
        content: 'PARTIAL',
      });
    });
    expect(__getHttpAgentSessionCacheSizeForTests()).toBe(1);
  });

  it('retires the host after a failed turn so hidden state cannot reach the next tenant', async () => {
    const keyA = buildHttpAgentSessionKey('alice', 'failure');
    const keyB = buildHttpAgentSessionKey('bob', 'next');

    await expect(withHttpSessionAgent(keyA, async (agent) => {
      (agent as FakeStatefulAgent).hiddenState = 'DIRTY-HIDDEN';
      throw new Error('abandoned');
    })).rejects.toThrow('abandoned');

    expect(agents[0]?.disposed).toBe(true);
    await withHttpSessionAgent(keyB, async (agent) => {
      expect((agent as FakeStatefulAgent).hiddenState).toBe('clean');
    });
    expect(adapterMocks.createServerAgent).toHaveBeenCalledTimes(2);
  });

  it('keeps cwd and recovery scope session-owned across A/B tool calls', async () => {
    const keyA = buildHttpAgentSessionKey('anonymous:127.0.0.1', 'A');
    const keyB = buildHttpAgentSessionKey('anonymous:127.0.0.1', 'B');

    await withHttpSessionAgent(keyA, async (agent) => {
      await agent.executeToolByName('bash', { command: 'cd /tmp/session-a' });
      expect((await agent.executeToolByName('bash', { command: 'pwd' })).output)
        .toBe('/tmp/session-a');
      expect((agent as FakeStatefulAgent).recoverySessionId).toBe(keyA);
    });
    await withHttpSessionAgent(keyB, async (agent) => {
      expect((await agent.executeToolByName('bash', { command: 'pwd' })).output)
        .toBe('/neutral-workspace');
      expect((agent as FakeStatefulAgent).recoverySessionId).toBe(keyB);
      expect((agent as FakeStatefulAgent).state.workingDirectory).not.toContain('session-a');
    });
    await withHttpSessionAgent(keyA, async (agent) => {
      expect((await agent.executeToolByName('bash', { command: 'pwd' })).output)
        .toBe('/tmp/session-a');
      expect((agent as FakeStatefulAgent).recoverySessionId).toBe(keyA);
    });
  });

  it('never reads or stores request-scoped state while explicit A/B sessions survive', async () => {
    const request = { ip: '127.0.0.1' };
    const keyA = buildHttpRequestSessionKey(request, 'A');
    const keyB = buildHttpRequestSessionKey(request, 'B');

    await withHttpSessionAgent(keyA, async (agent) => {
      (agent as FakeStatefulAgent).state.messages.push({ role: 'assistant', content: 'A-ONLY' });
    });
    await withHttpSessionAgent(buildHttpRequestSessionKey(request, undefined), async (agent) => {
      const fake = agent as FakeStatefulAgent;
      expect(fake.state.messages).toEqual([]);
      fake.state.messages.push({ role: 'assistant', content: 'ANONYMOUS-PARTIAL' });
    });
    await withHttpSessionAgent(keyB, async (agent) => {
      const fake = agent as FakeStatefulAgent;
      expect(fake.state.messages).toEqual([]);
      fake.state.messages.push({ role: 'assistant', content: 'B-ONLY' });
    });
    await withHttpSessionAgent(buildHttpRequestSessionKey(request, null), async (agent) => {
      expect((agent as FakeStatefulAgent).state.messages).toEqual([]);
    });

    await withHttpSessionAgent(keyA, async (agent) => {
      expect((agent as FakeStatefulAgent).state.messages).toEqual([
        { role: 'assistant', content: 'A-ONLY' },
      ]);
    });
    await withHttpSessionAgent(keyB, async (agent) => {
      expect((agent as FakeStatefulAgent).state.messages).toEqual([
        { role: 'assistant', content: 'B-ONLY' },
      ]);
    });
    expect(__getHttpAgentSessionCacheSizeForTests()).toBe(2);
  });

  it('does not create recovery directories for repeated stateless requests', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-http-stateless-'));
    try {
      const compressor = getRestorableCompressor();
      for (let index = 0; index < 5; index += 1) {
        const requestKey = buildHttpRequestSessionKey({ ip: '127.0.0.1' }, undefined);
        compressor.writeToolResult(`call_${index}`, `result-${index}`, workspace, requestKey);
      }
      expect(fs.existsSync(path.join(workspace, '.codebuddy', 'tool-results'))).toBe(false);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('does not cache failed setup and retires the potentially dirty agent', async () => {
    adapterMocks.createServerAgent.mockImplementationOnce(async () => {
      const agent = new FakeStatefulAgent();
      agent.failNextSeed = true;
      agents.push(agent);
      return agent;
    });

    await expect(withHttpSessionAgent(
      'broken-setup',
      async () => undefined,
      [{ role: 'user', content: 'seed' }],
    )).rejects.toThrow('seed failed');

    expect(__getHttpAgentSessionCacheSizeForTests()).toBe(0);
    expect(agents[0]?.disposed).toBe(true);

    await withHttpSessionAgent('healthy', async () => undefined);
    expect(adapterMocks.createServerAgent).toHaveBeenCalledTimes(2);
  });

  it('bounds stored conversation snapshots with LRU eviction', async () => {
    process.env.CODEBUDDY_HTTP_AGENT_CACHE_MAX = '2';
    await withHttpSessionAgent(buildHttpAgentSessionKey('test', 'one'), async () => undefined);
    await withHttpSessionAgent(buildHttpAgentSessionKey('test', 'two'), async () => undefined);
    await withHttpSessionAgent(buildHttpAgentSessionKey('test', 'three'), async () => undefined);
    expect(__getHttpAgentSessionCacheSizeForTests()).toBe(2);
  });
});
