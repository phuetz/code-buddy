import { describe, expect, it, vi } from 'vitest';
import type { Message, Session } from '../src/renderer/types';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    isReady: () => true,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

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

describe('CodeBuddyEngineRunner companion continuity', () => {
  it('prepends the shared voice/Telegram turns and records the Cowork answer', async () => {
    const recordAssistant = vi.fn();
    const continuity = {
      prepare: vi.fn(async () => ({
        active: true,
        messages: [
          { role: 'user', content: 'Question commencée à la voix.' },
          { role: 'assistant', content: 'Première partie envoyée sur Telegram.' },
        ],
        systemPrompt: 'Identité et continuité de Lisa.',
        recordAssistant,
      })),
    };
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void,
      ) => {
        onEvent({ type: 'content', content: 'Voici la suite argumentée.' });
        onEvent({ type: 'done' });
        return { content: 'Voici la suite argumentée.' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const saved: Message[] = [];
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: (message) => saved.push(message) },
      continuity,
    );
    const active: Session = {
      id: 'linked-session',
      title: 'Lisa',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      tags: ['companion'],
      createdAt: 0,
      updatedAt: 0,
    };
    const currentUser: Message = {
      id: 'user-current',
      sessionId: active.id,
      role: 'user',
      content: [{ type: 'text', text: 'Continue ton raisonnement ici.' }],
      timestamp: 1,
    };

    await runner.run(active, 'Continue ton raisonnement ici.', [currentUser]);

    expect(continuity.prepare).toHaveBeenCalledWith(
      active,
      [{ role: 'user', content: 'Continue ton raisonnement ici.' }],
      'Continue ton raisonnement ici.',
      'user-current',
    );
    const engineMessages = adapter.runSession.mock.calls[0]?.[1];
    expect(engineMessages).toEqual([
      { role: 'user', content: 'Question commencée à la voix.' },
      { role: 'assistant', content: 'Première partie envoyée sur Telegram.' },
      { role: 'user', content: 'Continue ton raisonnement ici.' },
    ]);
    expect(adapter.runSession.mock.calls[0]?.[3]).toMatchObject({
      systemPromptAppend: 'Identité et continuité de Lisa.',
    });
    const assistant = saved.find((message) => message.role === 'assistant');
    expect(recordAssistant).toHaveBeenCalledWith(
      assistant?.id,
      'Voici la suite argumentée.',
    );
  });
});
