import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/renderer/types';
import {
  isCompanionThreadTags,
  setCompanionThreadLinked,
} from '../src/shared/companion-thread';
import {
  CoworkCrossChannelContinuity,
  createCoworkConversationDeliver,
} from '../src/main/companion/cross-channel-continuity';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    isReady: () => true,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

function session(tags?: string[]): Session {
  return {
    id: 'cowork-lisa-session',
    title: 'Discussion avec Lisa',
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    tags,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('Cowork companion thread tag', () => {
  it('adds and removes only the durable companion aliases', () => {
    expect(isCompanionThreadTags(['research', '#LiSa'])).toBe(true);
    expect(setCompanionThreadLinked(['research'], true)).toEqual(['research', 'companion']);
    expect(setCompanionThreadLinked(['research', 'lisa', 'keep'], false)).toEqual([
      'research',
      'keep',
    ]);
    expect(setCompanionThreadLinked(['Research', 'research'], true)).toEqual([
      'Research',
      'companion',
    ]);
  });
});

describe('Cowork cross-channel continuity adapter', () => {
  it('delivers a mirrored turn to the configured Telegram topic without exposing credentials', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    const deliver = createCoworkConversationDeliver(
      { CODEBUDDY_SENSORY_ALERT_TOKEN: 'private-token' },
      fetchImpl,
    );

    expect(
      await deliver(
        { channel: 'telegram', channelId: '42', threadId: '7' },
        '💻 Lisa (Cowork)\nVoici la suite.',
      ),
    ).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(url).toBe('https://api.telegram.org/botprivate-token/sendMessage');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      chat_id: '42',
      text: '💻 Lisa (Cowork)\nVoici la suite.',
      message_thread_id: 7,
    });
  });

  it('imports external turns, excludes this session/local duplicates, and records both sides', async () => {
    const recordCoworkTurn = vi.fn(async () => true);
    const snapshot = vi.fn(() => [
      {
        id: 'voice-1',
        role: 'user' as const,
        content: 'Sujet commencé à la voix.',
        origin: 'voice' as const,
        timestamp: '2026-07-13T10:00:00.000Z',
      },
      {
        id: 'channel-1',
        role: 'assistant' as const,
        content: 'Une position argumentée.',
        origin: 'channel' as const,
        timestamp: '2026-07-13T10:01:00.000Z',
      },
      {
        id: 'other-cowork',
        role: 'user' as const,
        content: 'Ajouté depuis une autre session reliée.',
        origin: 'cowork' as const,
        externalId: 'another-session:message-7',
        timestamp: '2026-07-13T10:02:00.000Z',
      },
      {
        id: 'same-session',
        role: 'assistant' as const,
        content: 'Déjà dans la base Cowork locale.',
        origin: 'cowork' as const,
        externalId: 'cowork-lisa-session:old-message',
        timestamp: '2026-07-13T10:03:00.000Z',
      },
      {
        id: 'duplicate-local',
        role: 'assistant' as const,
        content: 'Réponse locale existante.',
        origin: 'channel' as const,
        timestamp: '2026-07-13T10:04:00.000Z',
      },
    ]);
    class FakeBridge {
      isActive = () => true;
      snapshot = snapshot;
      recordCoworkTurn = recordCoworkTurn;
    }
    const loader = vi.fn(async (path: string) => {
      if (path === 'conversation/cross-channel-bridge.js') {
        return {
          CrossChannelConversationBridge: FakeBridge,
          resolveCrossChannelBridgeConfig: () => ({
            enabled: true,
            companionName: 'Lisa',
            conversationId: 'lisa',
            coworkEnabled: true,
            coworkHistoryTurns: 24,
            historyPath: '/tmp/lisa.jsonl',
            target: { channel: 'telegram', channelId: '42' },
          }),
        };
      }
      if (path === 'companion/assistant-config.js') {
        return { readAssistantConfig: () => ({ CODEBUDDY_CONVERSATION_COWORK: 'true' }) };
      }
      if (path === 'identity/companion-identity.js') {
        return { LISA_COMPANION_SYSTEM_PROMPT: 'Identité stable de Lisa.' };
      }
      return null;
    });
    const continuity = new CoworkCrossChannelContinuity(loader as never);

    const prepared = await continuity.prepare(
      session(['companion']),
      [{ role: 'assistant', content: 'Réponse locale existante.' }],
      'Je poursuis dans Cowork.',
      'user-message',
    );

    expect(prepared.active).toBe(true);
    expect(prepared.messages).toEqual([
      { role: 'user', content: 'Sujet commencé à la voix.' },
      { role: 'assistant', content: 'Une position argumentée.' },
      { role: 'user', content: 'Ajouté depuis une autre session reliée.' },
    ]);
    expect(prepared.systemPrompt).toContain('Identité stable de Lisa.');
    expect(prepared.systemPrompt).toContain('voix, de Telegram');
    expect(recordCoworkTurn).toHaveBeenCalledWith(
      { role: 'user', content: 'Je poursuis dans Cowork.' },
      { sessionId: 'cowork-lisa-session', messageId: 'user-message' },
    );

    prepared.recordAssistant('assistant-message', 'Je reprends exactement notre sujet.');
    expect(recordCoworkTurn).toHaveBeenLastCalledWith(
      { role: 'assistant', content: 'Je reprends exactement notre sujet.' },
      { sessionId: 'cowork-lisa-session', messageId: 'assistant-message' },
    );
  });

  it('injects the shared fresh context even when no Telegram bridge is configured', async () => {
    const refresh = vi.fn(async () => undefined);
    const loader = vi.fn(async (modulePath: string) => {
      if (modulePath === 'conversation/prefetched-turn-context.js') {
        return {
          resolvePrefetchedTurnContextForConversation: () => ({
            freshness: 'fresh' as const,
            promptGuidance:
              '<fresh_context>Actualité datée, sourcée: https://example.test/news</fresh_context>',
          }),
          isPrefetchedTurnRequest: () => true,
        };
      }
      if (modulePath === 'companion/prefetch-engine.js') {
        return { runPrefetchCycle: refresh };
      }
      return null;
    });
    const continuity = new CoworkCrossChannelContinuity(loader as never);

    const prepared = await continuity.prepare(
      session(['companion']),
      [],
      'Quelles sont les actualités ?',
      'fresh-message',
    );

    expect(prepared.active).toBe(false);
    expect(prepared.messages).toEqual([]);
    expect(prepared.systemPrompt).toContain('<fresh_context>');
    expect(prepared.systemPrompt).toContain('https://example.test/news');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('never opens the private journal for an ordinary Cowork session', async () => {
    const loader = vi.fn(async () => null);
    const continuity = new CoworkCrossChannelContinuity(loader as never);

    const prepared = await continuity.prepare(
      session(['research']),
      [],
      'Analyse ce module.',
      'message-1',
    );

    expect(prepared.active).toBe(false);
    expect(prepared.messages).toEqual([]);
    expect(loader).not.toHaveBeenCalled();
  });
});
