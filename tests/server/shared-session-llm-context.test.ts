import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ServerAgent,
  ServerConversationState,
} from '../../src/server/agent-adapter.js';

const adapterMocks = vi.hoisted(() => ({
  createServerAgent: vi.fn(),
  runAgentCompletion: vi.fn(),
}));

vi.mock('../../src/server/agent-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/server/agent-adapter.js')>(
    '../../src/server/agent-adapter.js',
  );
  return {
    ...actual,
    createServerAgent: adapterMocks.createServerAgent,
    runAgentCompletion: adapterMocks.runAgentCompletion,
  };
});

import { SessionStore } from '../../src/persistence/session-store.js';
import {
  __resetHttpAgentSessionCacheForTests,
} from '../../src/server/http-agent-sessions.js';
import {
  continueResumeSession,
  persistResumeTurnUnlocked,
  resetSessionTurnQueueForTests,
  setResumeSessionStoreFactoryForTests,
  setResumeTurnRunnerForTests,
  SHARED_RESUME_AGENT_PRINCIPAL,
} from '../../src/server/mobile/resume-sessions.js';
import { buildHttpAgentSessionKey } from '../../src/server/http-agent-sessions.js';

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
  processUserMessage = vi.fn(async () => []);
  processUserMessageStream = vi.fn(async function* () {
    yield { type: 'done' as const };
  });
  getChatHistory = () => structuredClone(this.state.chatHistory);
  getCurrentModel = () => 'fake-model';
  setModel = vi.fn();
  executeToolByName = vi.fn(async () => ({ success: true }));
  systemPromptReady = Promise.resolve();
  abortCurrentOperation(): void {}
  setRecoverySessionId(sessionId: string | undefined): void {
    this.recoverySessionId = sessionId;
  }
  addToHistory(message: { role: 'user' | 'assistant' | 'system'; content: string }): void {
    this.state.messages.push(message);
  }
  exportConversationState(): ServerConversationState {
    return structuredClone(this.state);
  }
  importConversationState(state: ServerConversationState): void {
    this.state = structuredClone(state);
  }
  dispose(): void {}
}

describe('shared session LLM context', () => {
  const previousDir = process.env.CODEBUDDY_SESSIONS_DIR;
  let sessionsDir: string;
  let store: SessionStore;
  const seen: Array<{ message: string; contents: string[] }> = [];

  beforeEach(async () => {
    sessionsDir = mkdtempSync(path.join(os.tmpdir(), 'cb-shared-llm-'));
    mkdirSync(sessionsDir, { recursive: true });
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    store = new SessionStore({ useSQLite: false });
    setResumeSessionStoreFactoryForTests(() => new SessionStore({ useSQLite: false }));
    setResumeTurnRunnerForTests(null);
    resetSessionTurnQueueForTests();
    await __resetHttpAgentSessionCacheForTests();
    seen.length = 0;

    adapterMocks.createServerAgent.mockReset();
    adapterMocks.createServerAgent.mockImplementation(async () => new FakeStatefulAgent());
    adapterMocks.runAgentCompletion.mockReset();
    adapterMocks.runAgentCompletion.mockImplementation(async (agent: ServerAgent, message: string) => {
      const snap = agent.exportConversationState?.();
      const contents = (snap?.messages ?? []).map((row) => {
        const content = (row as { content?: unknown }).content;
        return typeof content === 'string' ? content : '';
      });
      seen.push({ message, contents });
      agent.addToHistory?.({ role: 'user', content: message });
      agent.addToHistory?.({ role: 'assistant', content: `ack:${message}` });
      return { content: `ack:${message}`, finishReason: 'stop' };
    });
  });

  afterEach(async () => {
    setResumeTurnRunnerForTests(null);
    setResumeSessionStoreFactoryForTests(null);
    resetSessionTurnQueueForTests();
    await __resetHttpAgentSessionCacheForTests();
    if (previousDir === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previousDir;
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  async function seedOwned(): Promise<string> {
    const session = await store.createSession('LLM partagé', 'test-model');
    session.messages = [
      { type: 'user', content: 'déjà là', timestamp: new Date().toISOString(), authorUserId: 'alice', seq: 1 },
      { type: 'assistant', content: 'ok', timestamp: new Date().toISOString(), authorUserId: 'assistant', seq: 2 },
    ];
    session.metadata = { ownerUserId: 'alice', authorizedUserIds: ['bob'], messageSeq: 2 };
    await store.saveSession(session);
    return session.id;
  }

  it('uses one session-scoped HTTP agent key and keeps both users in context', async () => {
    const sessionId = await seedOwned();
    const first = await continueResumeSession(sessionId, 'alice', 'un');
    const second = await continueResumeSession(sessionId, 'bob', 'deux');
    const third = await continueResumeSession(sessionId, 'alice', 'trois');
    expect('error' in first).toBe(false);
    expect('error' in second).toBe(false);
    expect('error' in third).toBe(false);

    expect(seen).toHaveLength(3);
    expect(seen[2]?.message).toBe('trois');
    expect(seen[2]?.contents).toContain('deux');
    expect(seen[2]?.contents).toContain('ack:deux');
    expect(seen[1]?.contents).toContain('un');
    expect(seen[1]?.contents).toContain('ack:un');

    const expectedKey = buildHttpAgentSessionKey(SHARED_RESUME_AGENT_PRINCIPAL, sessionId);
    const userKey = buildHttpAgentSessionKey('user:alice', sessionId);
    expect(expectedKey).not.toBe(userKey);
  });

  it('re-imports disk history after another participant persisted outside HTTP cache', async () => {
    const sessionId = await seedOwned();
    const first = await continueResumeSession(sessionId, 'alice', 'un');
    expect('error' in first).toBe(false);

    await persistResumeTurnUnlocked(sessionId, 'bob', 'deux-ws', 'ack:deux-ws', 'websocket');

    const third = await continueResumeSession(sessionId, 'alice', 'trois');
    expect('error' in third).toBe(false);
    expect(seen[1]?.message).toBe('trois');
    expect(seen[1]?.contents).toContain('deux-ws');
    expect(seen[1]?.contents).toContain('ack:deux-ws');
  });
});
