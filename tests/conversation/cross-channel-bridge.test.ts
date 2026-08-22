import { describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CrossChannelConversationBridge,
  resolveCrossChannelBridgeConfig,
  voiceMirrorContentForEvent,
  type CrossChannelBridgeConfig,
  type CrossChannelConversationEvent,
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
    expect(resolved.maxHistoryBytes).toBeGreaterThanOrEqual(256 * 1_024);
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

  it('serializes voice mirrors and flush waits for the last delivery', async () => {
    const order: string[] = [];
    let releaseUser!: () => void;
    const userGate = new Promise<void>((resolve) => {
      releaseUser = resolve;
    });
    const bridge = new CrossChannelConversationBridge(config(), {
      deliver: async (_target, content) => {
        const speaker = content.includes('question ordonnée') ? 'user' : 'assistant';
        order.push(`start:${speaker}`);
        if (speaker === 'user') await userGate;
        order.push(`end:${speaker}`);
        return true;
      },
      createId: (() => {
        let id = 0;
        return () => `ordered-${++id}`;
      })(),
    });

    const user = bridge.recordVoiceTurn({ role: 'user', content: 'question ordonnée' });
    const assistant = bridge.recordVoiceTurn({ role: 'assistant', content: 'réponse ordonnée' });
    let flushed = false;
    const flush = bridge.flush().then(() => {
      flushed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(order).toEqual(['start:user']);
    expect(flushed).toBe(false);
    releaseUser();
    await Promise.all([user, assistant, flush]);

    expect(order).toEqual([
      'start:user',
      'end:user',
      'start:assistant',
      'end:assistant',
    ]);
    expect(flushed).toBe(true);
  });

  it('keeps voice natural but enriches its Telegram mirror with dated clickable sources', () => {
    const events: CrossChannelConversationEvent[] = [
      {
        id: 'voice-user',
        conversationId: 'lisa-test',
        role: 'user',
        content: 'Quelles sont les actualités ?',
        origin: 'voice',
        timestamp: '2026-07-13T12:00:00.000Z',
      },
      {
        id: 'voice-assistant',
        conversationId: 'lisa-test',
        role: 'assistant',
        content: 'Voici le bulletin parlé.',
        origin: 'voice',
        timestamp: '2026-07-13T12:00:01.000Z',
      },
    ];
    const resolver = vi.fn(() => ({
      speech: 'Voici le bulletin parlé.',
      text: '1. Titre vérifié\nhttps://example.test/news',
      citations: [{ title: 'Titre vérifié', url: 'https://example.test/news' }],
      fetchedAt: Date.parse('2026-07-13T11:59:00.000Z'),
      freshness: 'fresh' as const,
    }));

    const mirrored = voiceMirrorContentForEvent(events[1]!, events, resolver);

    expect(mirrored).toContain('Titre vérifié');
    expect(mirrored).toContain('https://example.test/news');
    expect(mirrored).toContain('2026-07-13T11:59:00.000Z');
    expect(resolver).toHaveBeenCalledWith(
      'Quelles sont les actualités ?',
      expect.arrayContaining([{ role: 'user', content: 'Quelles sont les actualités ?' }]),
    );
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

  it('rejects an enriched Cowork engine prompt before journal or channel delivery', async () => {
    const deliver = vi.fn(async () => true);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });
    const enriched = [
      'Analyse ce document.',
      '[Attached files - use Read tool to access them]:',
      '- secret.txt at path: /private/secret.txt',
      '[Attached file text excerpts - verify against source before final answers]:',
      'PRIVATE_COWORK_ENGINE_SENTINEL',
    ].join('\n');

    expect(
      await bridge.recordCoworkTurn(
        { role: 'user', content: enriched },
        { sessionId: 'session-lisa', messageId: 'private-message' },
      ),
    ).toBe(false);
    expect(bridge.history()).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not reload legacy Cowork events containing private engine context', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-legacy-cowork-private-'));
    const historyPath = join(directory, 'lisa.jsonl');
    const base = {
      conversationId: 'lisa-test',
      role: 'user' as const,
      timestamp: '2026-07-13T10:00:00.000Z',
      channel: 'telegram' as const,
      channelId: '42',
    };
    try {
      await writeFile(historyPath, [
        JSON.stringify({
          ...base,
          id: 'legacy-private-cowork',
          origin: 'cowork',
          content:
            '[Attached file text excerpts - verify against source before final answers]: PRIVATE_LEGACY_SENTINEL',
        }),
        JSON.stringify({
          ...base,
          id: 'legacy-private-mention',
          origin: 'cowork',
          content:
            'Résume la mention.\n\n<context_mentions>\n<file source="/private/mention.txt">PRIVATE_MENTION_SENTINEL</file>\n</context_mentions>',
        }),
        JSON.stringify({
          ...base,
          id: 'safe-voice',
          origin: 'voice',
          content: 'Tour vocal sûr.',
        }),
      ].join('\n') + '\n');

      const bridge = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
      );
      expect(bridge.history()).toEqual([{ role: 'user', content: 'Tour vocal sûr.' }]);
      expect(JSON.stringify(bridge.snapshot())).not.toContain('PRIVATE_LEGACY_SENTINEL');
      expect(JSON.stringify(bridge.snapshot())).not.toContain('PRIVATE_MENTION_SENTINEL');
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('does not reject a legitimate inline discussion of an internal marker', async () => {
    const deliver = vi.fn(async () => true);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });
    const content =
      'Le texte « <project_context> » est un exemple de balise, pas un contexte moteur injecté.';

    expect(
      await bridge.recordCoworkTurn(
        { role: 'user', content },
        { sessionId: 'session-lisa', messageId: 'marker-discussion' },
      ),
    ).toBe(true);
    expect(bridge.history()).toEqual([{ role: 'user', content }]);
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

  it('bounds external-ID deduplication to the retained event window', () => {
    let id = 0;
    const bridge = new CrossChannelConversationBridge(config({ maxEvents: 2 }), {
      createId: () => `bounded-id-${++id}`,
      now: () => new Date(Date.parse('2026-07-13T10:00:00.000Z') + id * 10_000),
    });
    const record = (externalId: string, content: string) => bridge.recordChannelTurn({
      role: 'user',
      content,
      channel: 'telegram',
      channelId: '42',
      externalId,
    });

    expect(record('external-1', 'Premier tour.')).toBe(true);
    expect(record('external-2', 'Deuxième tour.')).toBe(true);
    expect(record('external-3', 'Troisième tour.')).toBe(true);
    expect(bridge.snapshot().map((event) => event.externalId)).toEqual([
      'external-2',
      'external-3',
    ]);

    // Once an identifier has left the bounded privacy window it is no longer
    // retained forever solely for deduplication.
    expect(record('external-1', 'Premier tour rejoué beaucoup plus tard.')).toBe(true);
    expect(bridge.snapshot().map((event) => event.externalId)).toEqual([
      'external-3',
      'external-1',
    ]);
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
      const persistedLines = (await readFile(historyPath, 'utf8'))
        .split(/\r?\n/)
        .filter(Boolean);
      expect(persistedLines).toHaveLength(1);

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
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('activates a process that started before the rendezvous journal appeared', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-late-rendezvous-'));
    const historyPath = join(directory, 'lisa.jsonl');
    try {
      const earlyVoiceProcess = new CrossChannelConversationBridge(
        config({ target: undefined, persist: true, historyPath }),
      );
      expect(earlyVoiceProcess.isActive()).toBe(false);

      const channelProcess = new CrossChannelConversationBridge(
        config({ persist: true, historyPath, mirrorVoice: false }),
        { createId: () => 'late-rendezvous-event' },
      );
      await channelProcess.recordVoiceTurn({
        role: 'user',
        content: 'Le canal est maintenant configuré.',
      });

      expect(earlyVoiceProcess.isActive()).toBe(true);
      expect(earlyVoiceProcess.matchesChannel('telegram', '42')).toBe(true);
      expect(earlyVoiceProcess.history()).toContainEqual({
        role: 'user',
        content: 'Le canal est maintenant configuré.',
      });
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('revalidates an external ID under the lock before concurrent appends', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-idempotent-'));
    const historyPath = join(directory, 'lisa.jsonl');
    try {
      const first = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { createId: () => 'first-process-event' },
      );
      const second = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { createId: () => 'second-process-event' },
      );
      const input = {
        role: 'user' as const,
        content: 'Un seul message malgré deux processus.',
        channel: 'telegram' as const,
        channelId: '42',
        externalId: 'telegram-update-unique',
      };

      // Both optimistic in-memory checks happen before either append reaches disk.
      expect(first.recordChannelTurn(input)).toBe(true);
      expect(second.recordChannelTurn(input)).toBe(true);
      await Promise.all([first.flush(), second.flush()]);

      const lines = (await readFile(historyPath, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        externalId: 'telegram-update-unique',
      });
      expect(first.snapshot()).toHaveLength(1);
      expect(second.snapshot()).toHaveLength(1);
      expect(first.relationshipSnapshot().counters.total).toBe(1);
      expect(second.relationshipSnapshot().counters.total).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('reports the durable winner for concurrent channel appends', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-channel-claim-'));
    const historyPath = join(directory, 'lisa.jsonl');
    try {
      const first = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { createId: () => 'first-channel-event' },
      );
      const second = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { createId: () => 'second-channel-event' },
      );
      const input = {
        role: 'user' as const,
        content: 'Un seul tour Telegram durable.',
        channel: 'telegram' as const,
        channelId: '42',
        externalId: 'telegram-committed-unique',
      };

      const results = await Promise.all([
        first.recordChannelTurnDurably(input),
        second.recordChannelTurnDurably(input),
      ]);

      expect(results.sort()).toEqual([false, true]);
      expect((await readFile(historyPath, 'utf8')).trim().split('\n')).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('keeps distinct external channel IDs even when their text is identical', async () => {
    const bridge = new CrossChannelConversationBridge(config({ persist: false }));
    const input = {
      role: 'user' as const,
      content: 'Oui.',
      channel: 'telegram' as const,
      channelId: '42',
    };

    await expect(
      bridge.recordChannelTurnDurably({ ...input, externalId: 'update-1' }),
    ).resolves.toBe(true);
    await expect(
      bridge.recordChannelTurnDurably({ ...input, externalId: 'update-2' }),
    ).resolves.toBe(true);

    expect(bridge.history()).toEqual([
      { role: 'user', content: 'Oui.' },
      { role: 'user', content: 'Oui.' },
    ]);
  });

  it('rolls back a failed durable claim so the same update can retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-failed-claim-'));
    try {
      const bridgeConfig = config({
        persist: true,
        // appendFile on a directory deterministically fails, even as root.
        historyPath: directory,
      });
      const bridge = new CrossChannelConversationBridge(bridgeConfig);
      const input = {
        role: 'user' as const,
        content: 'Réessaie ce tour.',
        channel: 'telegram' as const,
        channelId: '42',
        externalId: 'retryable-update',
      };

      await expect(bridge.claimChannelTurnDurably(input)).resolves.toBe('failed');
      expect(bridge.snapshot()).toEqual([]);

      bridgeConfig.historyPath = join(directory, 'conversation.jsonl');
      await expect(bridge.claimChannelTurnDurably(input)).resolves.toBe('committed');
      expect(bridge.history()).toEqual([
        { role: 'user', content: 'Réessaie ce tour.' },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('claims a concurrent Cowork turn durably before mirroring it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-delivery-claim-'));
    const historyPath = join(directory, 'lisa.jsonl');
    const deliver = vi.fn(async () => true);
    try {
      const first = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { createId: () => 'first-cowork-event', deliver },
      );
      const second = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { createId: () => 'second-cowork-event', deliver },
      );

      const results = await Promise.all([
        first.recordCoworkTurn(
          { role: 'assistant', content: 'Une seule livraison.' },
          { sessionId: 'session', messageId: 'message' },
        ),
        second.recordCoworkTurn(
          { role: 'assistant', content: 'Une seule livraison.' },
          { sessionId: 'session', messageId: 'message' },
        ),
      ]);

      expect(results.sort()).toEqual([false, true]);
      expect(deliver).toHaveBeenCalledTimes(1);
      expect((await readFile(historyPath, 'utf8')).trim().split('\n')).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('exposes a raw-free relationship snapshot and fixed-label context', () => {
    const bridge = new CrossChannelConversationBridge(config(), {
      now: () => new Date('2026-07-13T10:00:05.000Z'),
      createId: () => 'private-event-id',
    });
    expect(
      bridge.recordChannelTurn({
        role: 'user',
        content: 'BRIDGE_PRIVATE_SENTINEL je suis vraiment épuisé par projet-azur.',
        channel: 'telegram',
        channelId: '42',
      }),
    ).toBe(true);

    const snapshot = bridge.relationshipSnapshot();
    const rendered = bridge.renderRelationshipContext();
    expect(snapshot).toMatchObject({
      counters: { total: 1, user: 1, assistant: 0 },
      lastSurface: 'channel',
      affect: { kind: 'tired', intensity: 'high', supportOpen: true },
    });
    expect(JSON.stringify(snapshot)).not.toContain('BRIDGE_PRIVATE_SENTINEL');
    expect(JSON.stringify(snapshot)).not.toContain('projet-azur');
    expect(rendered).toContain('observations, pas des sentiments subjectifs');
    expect(rendered).not.toContain('BRIDGE_PRIVATE_SENTINEL');
    expect(rendered).not.toContain('projet-azur');
  });

  it('reloads relationship state when journal size changes under the same mtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-size-reload-'));
    const historyPath = join(directory, 'lisa.jsonl');
    const times = [
      new Date('2026-07-13T10:00:00.000Z'),
      new Date('2026-07-13T10:00:01.000Z'),
    ];
    try {
      const writer = new CrossChannelConversationBridge(
        config({ persist: true, historyPath, mirrorVoice: false }),
        {
          createId: (() => {
            let index = 0;
            return () => `writer-${++index}`;
          })(),
          now: () => times.shift() ?? new Date('2026-07-13T10:00:02.000Z'),
        },
      );
      await writer.recordVoiceTurn({ role: 'user', content: 'Premier tour.' });
      await writer.flush();

      const fixedJournalTime = new Date('2026-07-13T09:59:00.000Z');
      await utimes(historyPath, fixedJournalTime, fixedJournalTime);
      const initialStat = await stat(historyPath);
      const reader = new CrossChannelConversationBridge(
        config({ persist: true, historyPath }),
        { now: () => new Date('2026-07-13T10:00:02.000Z') },
      );
      expect(reader.relationshipSnapshot().counters.total).toBe(1);

      await writer.recordVoiceTurn({ role: 'assistant', content: 'Deuxième tour.' });
      await writer.flush();
      await utimes(historyPath, fixedJournalTime, fixedJournalTime);
      const restoredStat = await stat(historyPath);
      expect(restoredStat.mtimeMs).toBe(initialStat.mtimeMs);
      expect(restoredStat.size).toBeGreaterThan(initialStat.size);

      expect(reader.relationshipSnapshot()).toMatchObject({
        counters: { total: 2, user: 1, assistant: 1 },
        lastRole: 'assistant',
      });
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('keeps the private JSONL journal byte-bounded, permissioned, and lock-clean', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-bounded-'));
    const historyPath = join(directory, 'lisa.jsonl');
    try {
      let id = 0;
      const bridge = new CrossChannelConversationBridge(
        config({
          persist: true,
          historyPath,
          mirrorVoice: false,
          maxEvents: 20,
          maxHistoryBytes: 32 * 1_024,
        }),
        {
          createId: () => `bounded-${++id}`,
          now: () => new Date(Date.parse('2026-07-13T10:00:00.000Z') + id * 1_000),
        },
      );
      for (let index = 0; index < 14; index += 1) {
        await bridge.recordVoiceTurn({
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `tour-${index} ${'x'.repeat(7_000)}`,
        });
      }
      await bridge.flush();

      const journalStat = await stat(historyPath);
      expect(journalStat.size).toBeLessThanOrEqual(32 * 1_024);
      if (process.platform !== 'win32') expect(journalStat.mode & 0o777).toBe(0o600);
      const lines = (await readFile(historyPath, 'utf8')).trim().split('\n');
      expect(lines.length).toBeLessThan(14);
      expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({ id: 'bounded-14' });
      expect((JSON.parse(lines.at(-1) ?? '{}') as { content: string }).content.length)
        .toBeLessThan(7_000);
      expect(bridge.history().at(-1)?.content.length).toBeGreaterThan(7_000);
      expect((await readdir(directory)).some((entry) => entry.endsWith('.lock'))).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('does not change permissions on a pre-existing history parent directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-parent-mode-'));
    const historyPath = join(directory, 'lisa.jsonl');
    try {
      if (process.platform !== 'win32') await chmod(directory, 0o755);
      const bridge = new CrossChannelConversationBridge(
        config({ persist: true, historyPath, mirrorVoice: false }),
      );
      await bridge.recordVoiceTurn({ role: 'user', content: 'Le parent reste partagé.' });
      await bridge.flush();

      if (process.platform !== 'win32') {
        expect((await stat(directory)).mode & 0o777).toBe(0o755);
      }
      expect((await stat(historyPath)).isFile()).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('bounds huge persisted metadata and escaped content within maxHistoryBytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codebuddy-bridge-huge-metadata-'));
    const historyPath = join(directory, 'lisa.jsonl');
    const huge = 'metadata-'.repeat(4_000);
    try {
      const hugeConfig = config({
        conversationId: huge,
        target: { channel: 'telegram', channelId: huge, threadId: huge },
        persist: true,
        historyPath,
        mirrorVoice: false,
        maxHistoryBytes: 32 * 1_024,
      });
      const bridge = new CrossChannelConversationBridge(hugeConfig, {
        createId: () => huge,
      });
      await bridge.recordVoiceTurn(
        { role: 'user', content: '"\\'.repeat(40_000) },
        huge,
      );
      await bridge.flush();

      expect((await stat(historyPath)).size).toBeLessThanOrEqual(32 * 1_024);
      const persisted = JSON.parse((await readFile(historyPath, 'utf8')).trim()) as {
        id: string;
        conversationId: string;
        content: string;
        externalId: string;
        channelId: string;
        threadId: string;
      };
      expect(persisted.id.length).toBeLessThanOrEqual(512);
      expect(persisted.conversationId.length).toBeLessThanOrEqual(512);
      expect(persisted.externalId.length).toBeLessThanOrEqual(512);
      expect(persisted.channelId.length).toBeLessThanOrEqual(512);
      expect(persisted.threadId.length).toBeLessThanOrEqual(512);
      expect(persisted.content.length).toBeLessThan(40_000);

      // The deterministic hashed suffix also lets a fresh process recognize
      // the bounded conversation ID without keeping the raw oversized value.
      const reader = new CrossChannelConversationBridge(hugeConfig);
      expect(reader.history()).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
