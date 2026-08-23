import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

import {
  CrossChannelConversationBridge,
  type CrossChannelBridgeConfig,
  type CrossChannelBridgeDependencies,
} from '../../src/conversation/cross-channel-bridge.js';
import { CoworkCrossChannelContinuity } from '../src/main/companion/cross-channel-continuity';
import { CodeBuddyEngineRunner } from '../src/main/engine/codebuddy-engine-runner';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Cowork private turn cross-channel boundary', () => {
  it('keeps attachment excerpts in the engine prompt but out of journal and Telegram', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cowork-private-continuity-'));
    const historyPath = join(directory, 'lisa.jsonl');
    const privateSentinel = 'PRIVATE_ATTACHMENT_SENTINEL';
    const encodedSentinel = Buffer.from(privateSentinel).toString('base64');
    const privatePath = '/private/cowork/secret-notes.txt';
    const visiblePrompt = 'Analyse ce fichier, puis explique-moi seulement la conclusion.';
    const enginePrompt = [
      visiblePrompt,
      '',
      '[Attached files - use Read tool to access them]:',
      `- secret-notes.txt at path: ${privatePath}`,
      '',
      '[Attached file text excerpts - verify against source before final answers]:',
      privateSentinel,
    ].join('\n');
    const telegramFetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', telegramFetch);
    vi.stubEnv('CODEBUDDY_PREFETCH', 'false');

    let bridge: CrossChannelConversationBridge | undefined;
    const captureBridge = (instance: CrossChannelConversationBridge) => {
      bridge = instance;
    };
    class CapturingBridge extends CrossChannelConversationBridge {
      constructor(
        config: CrossChannelBridgeConfig,
        dependencies?: CrossChannelBridgeDependencies,
      ) {
        super(config, dependencies);
        captureBridge(this);
      }
    }
    const config: CrossChannelBridgeConfig = {
      enabled: true,
      companionName: 'Lisa',
      conversationId: 'private-turn-test',
      target: { channel: 'telegram', channelId: '42' },
      mirrorVoice: true,
      coworkEnabled: true,
      mirrorCowork: true,
      coworkHistoryTurns: 24,
      persist: true,
      historyPath,
      maxEvents: 20,
    };
    const loader = vi.fn(async (modulePath: string) => {
      if (modulePath === 'conversation/cross-channel-bridge.js') {
        return {
          CrossChannelConversationBridge: CapturingBridge,
          resolveCrossChannelBridgeConfig: () => config,
        };
      }
      if (modulePath === 'companion/assistant-config.js') {
        return {
          readAssistantRuntimeEnv: () => ({
            CODEBUDDY_SENSORY_ALERT_TOKEN: 'telegram-private-test-token',
          }),
          readAssistantConfig: () => ({}),
        };
      }
      if (modulePath === 'identity/companion-identity.js') {
        return { LISA_COMPANION_SYSTEM_PROMPT: 'Identité stable de Lisa.' };
      }
      return null;
    });
    const continuity = new CoworkCrossChannelContinuity(loader as never);
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void,
      ) => {
        onEvent({ type: 'content', content: 'La conclusion publique est prête.' });
        onEvent({ type: 'done' });
        return { content: 'La conclusion publique est prête.' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const passthroughSafetyLoader = async () => ({
      RelationshipSafetyStreamGuard: class {
        push(value: string): string[] {
          return [value];
        }

        finish(): string[] {
          return [];
        }

        assessment(): { intervened: boolean; issues: string[] } {
          return { intervened: false, issues: [] };
        }
      },
    });
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: vi.fn() },
      continuity,
      { resolve: vi.fn(async () => null) },
      passthroughSafetyLoader,
    );
    const session: Session = {
      id: 'linked-private-turn',
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
      id: 'user-private-turn',
      sessionId: session.id,
      role: 'user',
      content: [
        {
          type: 'file_attachment',
          filename: 'secret-notes.txt',
          relativePath: privatePath,
          size: privateSentinel.length,
          mimeType: 'text/plain',
          inlineDataBase64: encodedSentinel,
        },
        { type: 'text', text: visiblePrompt },
      ],
      timestamp: 1,
    };

    try {
      await runner.run(session, enginePrompt, [currentUser]);
      expect(bridge).toBeDefined();
      await bridge?.flush();
      await vi.waitFor(() => expect(telegramFetch).toHaveBeenCalledTimes(2));

      const engineMessages = adapter.runSession.mock.calls[0]?.[1] ?? [];
      expect(engineMessages.at(-1)).toEqual({ role: 'user', content: enginePrompt });
      expect(JSON.stringify(engineMessages)).toContain(privateSentinel);
      expect(JSON.stringify(engineMessages)).toContain(privatePath);

      const journal = await readFile(historyPath, 'utf8');
      const telegramBodies = telegramFetch.mock.calls
        .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ''))
        .join('\n');
      for (const exposed of [
        privateSentinel,
        encodedSentinel,
        privatePath,
        'secret-notes.txt',
        'text/plain',
        '[Attached files',
        '[Attached file text excerpts',
      ]) {
        expect(journal).not.toContain(exposed);
        expect(telegramBodies).not.toContain(exposed);
      }
      expect(journal).toContain(visiblePrompt);
      expect(journal).toMatch(/1\s+(?:document|file|fichier)/i);
      expect(journal).toContain('La conclusion publique est prête.');
      expect(telegramBodies).toContain(visiblePrompt);
      expect(telegramBodies).toMatch(/1\s+(?:document|file|fichier)/i);
      expect(telegramBodies).toContain('La conclusion publique est prête.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
