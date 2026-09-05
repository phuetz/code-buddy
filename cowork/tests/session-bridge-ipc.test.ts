import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMock = vi.hoisted(() => ({ sendToRenderer: vi.fn() }));
const windowState = vi.hoisted(() => ({ current: null as FakeWindow | null }));

vi.mock('../src/main/ipc-main-bridge', () => ({
  sendToRenderer: bridgeMock.sendToRenderer,
}));
vi.mock('../src/main/window-management', () => ({
  getMainWindow: () => windowState.current,
}));
vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('../src/main/codebuddy/codebuddy-adapter', () => ({
  CodeBuddyAdapter: class {},
}));

import { SessionBridge } from '../src/main/codebuddy/session-bridge';

interface FakeWindow {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
}

function makeWindow(): FakeWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };
}

describe('SessionBridge renderer delivery', () => {
  beforeEach(() => {
    bridgeMock.sendToRenderer.mockReset();
    windowState.current = null;
  });

  it('multiplexes streaming events through server-event instead of a direct IPC channel', async () => {
    const adapter = {
      chat: async function* () {
        yield { type: 'content' as const, content: 'bonjour' };
        yield {
          type: 'tool_calls' as const,
          toolCalls: [{ function: { name: 'view_file', arguments: '{"path":"README.md"}' } }],
        };
        yield { type: 'token_count' as const, tokenCount: 4096 };
        yield { type: 'done' as const };
      },
      abort: vi.fn(),
    };
    const initialWindow = makeWindow();
    windowState.current = initialWindow;
    const bridge = new SessionBridge(adapter as never, initialWindow as never);

    await bridge.runSession('session-r6', []);

    expect(bridgeMock.sendToRenderer).toHaveBeenCalledWith({
      type: 'stream.partial',
      payload: { sessionId: 'session-r6', delta: 'bonjour' },
    });
    expect(bridgeMock.sendToRenderer).toHaveBeenCalledWith({
      type: 'trace.step',
      payload: {
        sessionId: 'session-r6',
        step: expect.objectContaining({
          type: 'tool_call',
          status: 'running',
          title: 'view_file',
          toolName: 'view_file',
          content: '{"path":"README.md"}',
        }),
      },
    });
    expect(bridgeMock.sendToRenderer).toHaveBeenCalledWith({
      type: 'session.contextInfo',
      payload: { sessionId: 'session-r6', contextWindow: 4096 },
    });
    expect(bridgeMock.sendToRenderer).toHaveBeenCalledWith({
      type: 'stream.message',
      payload: {
        sessionId: 'session-r6',
        message: expect.objectContaining({
          sessionId: 'session-r6',
          role: 'assistant',
          content: [{ type: 'text', text: 'bonjour' }],
        }),
      },
    });
    expect(initialWindow.webContents.send).not.toHaveBeenCalled();
  });
});
