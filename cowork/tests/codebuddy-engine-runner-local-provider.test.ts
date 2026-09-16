import { describe, expect, it, vi } from 'vitest';
import type { Message, Session } from '../src/renderer/types';

const localConfig = {
  provider: 'ollama' as const,
  customProtocol: 'openai' as const,
  apiKey: '',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen-local',
  activeProfileKey: 'ollama' as const,
  profiles: {
    ollama: {
      apiKey: '',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen-local',
    },
  },
  activeConfigSetId: 'default',
  configSets: [],
  claudeCodePath: '',
  defaultWorkdir: '',
  globalSkillsPath: '',
  enableDevLogs: false,
  theme: 'light' as const,
  memoryStrategy: 'auto' as const,
  contextOptimizationMode: 'auto' as const,
  sandboxEnabled: false,
  enableThinking: false,
  thinkingLevel: 'off' as const,
  isConfigured: true,
  onboardingCompleted: true,
};

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    getAll: () => localConfig,
    getConfigForSet: () => localConfig,
  },
}));

vi.mock('../src/main/identity/identity-bridge', () => ({
  getIdentityBridge: () => ({
    ensureLoaded: vi.fn(async () => []),
    getActive: vi.fn(() => null),
  }),
}));

vi.mock('../src/main/reasoning/reasoning-bridge', () => ({
  getReasoningBridge: () => ({}),
}));

vi.mock('../src/main/reasoning/reasoning-capture', () => ({
  createReasoningCapture: () => ({ push: vi.fn(), complete: vi.fn() }),
}));

import { CodeBuddyEngineRunner } from '../src/main/engine/codebuddy-engine-runner';

describe('CodeBuddyEngineRunner local provider projection', () => {
  it('passes the Ollama placeholder key to the embedded engine', async () => {
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string }) => void,
      ) => {
        onEvent({ type: 'done' });
        return { content: '' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: vi.fn() },
      {
        prepare: vi.fn(async () => ({
          active: false,
          messages: [],
          systemPrompt: undefined,
          turnContext: undefined,
        })),
      },
      { resolve: vi.fn(async () => null) },
      async () => null,
      async () => null,
    );
    const session: Session = {
      id: 'ollama-session',
      title: 'Ollama',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      model: 'qwen-local',
      createdAt: 0,
      updatedAt: 0,
    };
    const userMessage: Message = {
      id: 'user-1',
      sessionId: session.id,
      role: 'user',
      content: [{ type: 'text', text: 'Bonjour' }],
      timestamp: 1,
    };

    await runner.run(session, 'Bonjour', [userMessage]);

    expect(adapter.runSession.mock.calls[0]?.[3]).toMatchObject({
      apiKey: 'sk-ollama-local-proxy',
      baseURL: 'http://127.0.0.1:11434/v1',
      model: 'qwen-local',
    });
  });
});
