import { describe, expect, it, vi } from 'vitest';
import type { Message, Session, ServerEvent } from '../src/renderer/types';

const reasoningMock = vi.hoisted(() => ({
  factoryCalls: 0,
  getReasoningBridge: vi.fn(),
  bridge: {
    pushEvent: vi.fn(),
  },
}));

vi.mock('../src/main/reasoning/reasoning-bridge', () => {
  reasoningMock.factoryCalls += 1;
  return {
    getReasoningBridge: reasoningMock.getReasoningBridge,
  };
});

import { CodeBuddyEngineRunner } from '../src/main/engine/codebuddy-engine-runner';

describe('CodeBuddyEngineRunner reasoning bridge loading', () => {
  it('loads the reasoning bridge only when a session run starts', async () => {
    expect(reasoningMock.factoryCalls).toBe(0);
    reasoningMock.getReasoningBridge.mockReturnValue(reasoningMock.bridge);

    const adapter = {
      async runSession(
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void
      ) {
        onEvent({ type: 'content', content: 'Done.' });
        return { content: 'Done.', tokenCount: 2, toolCallCount: 0 };
      },
      cancel() {},
      clearSession() {},
    };

    const events: ServerEvent[] = [];
    const savedMessages: Message[] = [];
    const runner = new CodeBuddyEngineRunner(adapter, {
      sendToRenderer: (event) => events.push(event),
      saveMessage: (message) => savedMessages.push(message),
    });

    expect(reasoningMock.factoryCalls).toBe(0);

    const session: Session = {
      id: 'session-lazy-reasoning',
      title: 'Lazy reasoning',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: 'embedded-test',
    };

    await runner.run(session, 'No thinking needed', []);

    expect(reasoningMock.factoryCalls).toBe(1);
    expect(reasoningMock.getReasoningBridge).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'session.status' }),
        expect.objectContaining({ type: 'stream.partial' }),
      ])
    );
    expect(savedMessages).toHaveLength(2);
  });
});
