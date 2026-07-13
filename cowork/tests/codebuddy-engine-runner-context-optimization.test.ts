import { describe, expect, it, vi } from 'vitest';
import type { Message, Session, ToolResultContent } from '../src/renderer/types';

vi.mock('electron', () => {
  const app = {
    isPackaged: false,
    isReady: () => true,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  };
  return { app, ipcMain: { on: vi.fn() }, shell: { openPath: vi.fn() } };
});

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    getAll: () => ({ apiKey: '', baseUrl: '', model: 'local', thinkingLevel: 'off' }),
    getConfigForSet: () => ({ apiKey: '', baseUrl: '', model: 'local', thinkingLevel: 'off' }),
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

describe('CodeBuddyEngineRunner context optimization bridge', () => {
  it('persists contextOptimization on the Cowork tool_result block', async () => {
    const saved: Message[] = [];
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: Record<string, unknown>) => void,
      ) => {
        onEvent({
          type: 'tool_start',
          tool: { id: 'call_bridge', name: 'bash', input: '{"command":"npm test"}' },
        });
        onEvent({
          type: 'tool_end',
          tool: {
            id: 'call_bridge',
            name: 'bash',
            output: 'optimized signal',
            isError: false,
            contextOptimization: {
              optimizer: 'lm-resizer',
              reason: 'optimized',
              rawRef: 'call_bridge',
              originalBytes: 5_000,
              finalBytes: 900,
              bytesSaved: 4_100,
              transport: 'cli',
            },
          },
        });
        onEvent({ type: 'done' });
        return { content: '', toolCallCount: 1 };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const runner = new CodeBuddyEngineRunner(adapter, {
      sendToRenderer: vi.fn(),
      saveMessage: (message) => saved.push(message),
    });
    const session: Session = {
      id: 'session-context-optimization',
      title: 'Context optimization',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      createdAt: 0,
      updatedAt: 0,
    };

    await runner.run(session, 'run tests', []);

    const assistant = saved.find((message) => message.role === 'assistant');
    const toolResult = assistant?.content.find(
      (block) => block.type === 'tool_result',
    ) as ToolResultContent | undefined;
    expect(toolResult?.contextOptimization).toEqual({
      optimizer: 'lm-resizer',
      reason: 'optimized',
      rawRef: 'call_bridge',
      originalBytes: 5_000,
      finalBytes: 900,
      bytesSaved: 4_100,
      transport: 'cli',
    });
    expect(toolResult?.content).toBe('optimized signal');
  });
});
