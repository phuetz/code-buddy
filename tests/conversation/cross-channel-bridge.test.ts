import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CrossChannelConversationBridge,
  resolveCrossChannelBridgeConfig,
  type CrossChannelBridgeConfig,
} from '../../src/conversation/cross-channel-bridge.js';

function config(overrides: Partial<CrossChannelBridgeConfig> = {}): CrossChannelBridgeConfig {
  return {
    enabled: true,
    companionName: 'Lisa',
    conversationId: 'lisa-test',
    target: { channel: 'telegram', channelId: '42' },
    mirrorVoice: true,
    coworkEnabled: true,
    mirrorCowork: true,
    coworkHistoryTurns: 24,
    persist: false,
    historyPath: '/tmp/codebuddy-cross-channel-test.jsonl',
    maxEvents: 20,
    ...overrides,
  };
}

describe('cross-channel companion conversation', () => {
  it('activates from the configured channel and supports the Telegram alert fallback ID', () => {
    const resolved = resolveCrossChannelBridgeConfig({
      CODEBUDDY_ROBOT_NAME: 'Nova',
      CODEBUDDY_SENSORY_ALERT_CHAT: '1234',
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.companionName).toBe('Nova');
    expect(resolved.conversationId).toBe('nova');
    expect(resolved.target).toEqual({ channel: 'telegram', channelId: '1234' });
    expect(resolved.coworkEnabled).toBe(true);
    expect(resolved.mirrorCowork).toBe(true);
    expect(resolved.coworkHistoryTurns).toBe(24);
  });

  it('mirrors recognized voice and the companion reply to the target channel', async () => {
    const deliver = vi.fn(async () => true);
    const bridge = new CrossChannelConversationBridge(config(), {
      deliver,
      createId: (() => {
        let id = 0;
        return () => `event-${++id}`;
      })(),
    });

    await bridge.recordVoiceTurn({ role: 'user', content: 'On continue notre discussion.' });
    await bridge.recordVoiceTurn({ role: 'assistant', content: 'Oui, sur le même fil.' });

    expect(bridge.history()).toEqual([
      { role: 'user', content: 'On continue notre discussion.' },
      { role: 'assistant', content: 'Oui, sur le même fil.' },
    ]);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[0]?.[1]).toContain('(voix)');
    expect(deliver.mock.calls[1]?.[1]).toContain('Lisa (voix)');
  });

  it('accepts replies from the configured channel without echoing them back', () => {
    const deliver = vi.fn(async () => true);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });
    expect(
      bridge.recordChannelTurn({
        role: 'user',
        content: 'Je reprends depuis Telegram.',
        channel: 'telegram',
        channelId: '42',
        externalId: 'tg-1',
      })
    ).toBe(true);
    expect(
      bridge.recordChannelTurn({
        role: 'assistant',
        content: 'Le contexte vocal est toujours là.',
        channel: 'telegram',
        channelId: '42',
      })
    ).toBe(true);
    expect(deliver).not.toHaveBeenCalled();
    expect(bridge.history()).toHaveLength(2);
  });

  it('records a linked Cowork session, mirrors it, and deduplicates renderer retries', async () => {
    const deliver = vi.fn(async () => true);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });

    expect(
      await bridge.recordCoworkTurn(
        { role: 'user', content: 'Je reprends dans Cowork.' },
        { sessionId: 'session-lisa', messageId: 'message-1' },
      ),
    ).toBe(true);
    expect(
      await bridge.recordCoworkTurn(
        { role: 'user', content: 'Je reprends dans Cowork.' },
        { sessionId: 'session-lisa', messageId: 'message-1' },
      ),
    ).toBe(false);
    expect(
      await bridge.recordCoworkTurn(
        { role: 'assistant', content: 'Oui, sans perdre notre sujet.' },
        { sessionId: 'session-lisa', messageId: 'message-2' },
      ),
    ).toBe(true);

    expect(bridge.snapshot().map((event) => event.origin)).toEqual(['cowork', 'cowork']);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[0]?.[1]).toContain('(Cowork)');
    expect(deliver.mock.calls[1]?.[1]).toContain('Lisa (Cowork)');
  });

  it('keeps Cowork disabled and unmirrored when explicitly configured', async () => {
    const deliver = vi.fn(async () => true);
    const disabled = new CrossChannelConversationBridge(
      config({ coworkEnabled: false }),
      { deliver },
    );
    expect(
      await disabled.recordCoworkTurn(
        { role: 'user', content: 'Session ordinaire.' },
        { sessionId: 'work', messageId: '1' },
      ),
    ).toBe(false);

    const privateBridge = new CrossChannelConversationBridge(
      config({ mirrorCowork: false }),
      { deliver },
    );
    expect(
      await privateBridge.recordCoworkTurn(
        { role: 'user', content: 'Journal privé uniquement.' },
        { sessionId: 'lisa', messageId: '2' },
      ),
    ).toBe(true);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('deduplicates external message IDs and ignores another channel', () => {
    const bridge = new CrossChannelConversationBridge(config());
    const input = {
      role: 'user' as const,
      content: 'Message unique',
      channel: 'telegram' as const,
      channelId: '42',
      externalId: 'same-id',
    };
    expect(bridge.recordChannelTurn(input)).toBe(true);
    expect(bridge.recordChannelTurn(input)).toBe(false);
    expect(
      bridge.recordChannelTurn({ ...input, channelId: 'another-chat', externalId: 'other-id' })
    ).toBe(false);
    expect(bridge.history()).toHaveLength(1);
  });

  it('uses the private journal as a rendezvous between separate voice and channel processes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-'));
    const historyPath = join(directory, 'lisa.jsonl');
    try {
      const voice = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { deliver: async () => true, createId: () => 'voice-event' }
      );
      await voice.recordVoiceTurn({ role: 'user', content: 'Tour écrit par le service vocal.' });
      await voice.flush();

      const channel = new CrossChannelConversationBridge(
        config({ target: undefined, persist: true, historyPath })
      );
      expect(channel.isActive()).toBe(true);
      expect(channel.matchesChannel('telegram', '42')).toBe(true);
      expect(channel.history()).toContainEqual({
        role: 'user',
        content: 'Tour écrit par le service vocal.',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists a complete voice → Cowork → Telegram → Cowork handoff', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-three-surface-'));
    const historyPath = join(directory, 'lisa.jsonl');
    const deliver = vi.fn(async () => true);
    try {
      const voice = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { deliver, createId: () => 'voice-user' },
      );
      await voice.recordVoiceTurn({ role: 'user', content: 'Je commence au micro.' });
      await voice.flush();

      const cowork = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { deliver, createId: () => 'cowork-assistant' },
      );
      expect(cowork.history()).toContainEqual({ role: 'user', content: 'Je commence au micro.' });
      await cowork.recordCoworkTurn(
        { role: 'assistant', content: 'Je développe la réponse dans Cowork.' },
        { sessionId: 'lisa-session', messageId: 'assistant-1' },
      );
      await cowork.flush();

      const telegram = new CrossChannelConversationBridge(
        config({ target: undefined, persist: true, historyPath }),
        { createId: () => 'telegram-user' },
      );
      expect(telegram.matchesChannel('telegram', '42')).toBe(true);
      expect(
        telegram.recordChannelTurn({
          role: 'user',
          content: 'Je poursuis depuis Telegram.',
          channel: 'telegram',
          channelId: '42',
          externalId: 'telegram-message-1',
        }),
      ).toBe(true);
      await telegram.flush();

      const resumedCowork = new CrossChannelConversationBridge(
        config({ target: undefined, persist: true, historyPath }),
      );
      expect(resumedCowork.history()).toEqual([
        { role: 'user', content: 'Je commence au micro.' },
        { role: 'assistant', content: 'Je développe la réponse dans Cowork.' },
        { role: 'user', content: 'Je poursuis depuis Telegram.' },
      ]);
      expect(resumedCowork.isActive()).toBe(true);
      expect(deliver).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps concurrent process appends as complete JSONL events', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-concurrent-'));
    const historyPath = join(directory, 'lisa.jsonl');
    try {
      const voice = new CrossChannelConversationBridge(
        config({ persist: true, historyPath, mirrorVoice: false }),
        { createId: () => 'concurrent-voice' },
      );
      const cowork = new CrossChannelConversationBridge(
        config({ persist: true, historyPath, mirrorCowork: false }),
        { createId: () => 'concurrent-cowork' },
      );

      await Promise.all([
        voice.recordVoiceTurn({ role: 'user', content: 'Tour vocal concurrent.' }),
        cowork.recordCoworkTurn(
          { role: 'assistant', content: 'Tour Cowork concurrent.' },
          { sessionId: 'session', messageId: 'message' },
        ),
      ]);
      await Promise.all([voice.flush(), cowork.flush()]);

      const reader = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
      );
      expect(new Set(reader.snapshot().map((event) => event.id))).toEqual(
        new Set(['concurrent-voice', 'concurrent-cowork']),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
