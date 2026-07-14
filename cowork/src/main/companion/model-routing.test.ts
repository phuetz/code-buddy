import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, Session } from '../../renderer/types';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getConfigForSet: vi.fn(),
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../config/config-store', () => ({
  configStore: {
    getAll: mocks.getAll,
    getConfigForSet: mocks.getConfigForSet,
  },
}));

vi.mock('../identity/identity-bridge', () => ({
  getIdentityBridge: () => ({
    ensureLoaded: vi.fn(async () => []),
    getActive: vi.fn(() => null),
  }),
}));

vi.mock('../reasoning/reasoning-bridge', () => ({
  getReasoningBridge: () => ({}),
}));

vi.mock('../reasoning/reasoning-capture', () => ({
  createReasoningCapture: () => ({
    push: vi.fn(),
    complete: vi.fn(),
  }),
}));

vi.mock('../utils/logger', () => ({
  log: mocks.log,
  logWarn: mocks.logWarn,
  logError: mocks.logError,
}));

import {
  CoworkCompanionModelRouting,
  type CoworkCompanionModelRoute,
} from './model-routing';
import { CodeBuddyEngineRunner } from '../engine/codebuddy-engine-runner';

const pilotRoute: CoworkCompanionModelRoute = {
  profileId: 'pilot-2026-07',
  lane: 'deep',
  model: 'grok-4.5',
  provider: 'xai',
  apiKey: 'pilot-key',
  baseURL: 'https://api.x.ai/v1',
  reason: 'blind preference winner',
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-lisa',
    title: 'Lisa',
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    tags: ['companion'],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

type RoutingLoader = ConstructorParameters<typeof CoworkCompanionModelRouting>[0];

function makeRoutingLoader(result: unknown): {
  load: ReturnType<typeof vi.fn>;
  loader: RoutingLoader;
} {
  const load = vi.fn(async () => result);
  return {
    load,
    loader: load as unknown as RoutingLoader,
  };
}

describe('CoworkCompanionModelRouting', () => {
  beforeEach(() => {
    mocks.getAll.mockReturnValue({
      apiKey: 'runtime-key',
      baseUrl: 'https://runtime.example/v1',
      model: 'runtime-model',
      thinkingLevel: 'off',
    });
    mocks.getConfigForSet.mockReturnValue({
      apiKey: 'set-key',
      baseUrl: 'https://set.example/v1',
      model: 'set-model',
      thinkingLevel: 'high',
    });
  });

  it('resolves the evidence-backed route only for an explicitly linked Lisa session', async () => {
    const resolveCompanionModelRoute = vi.fn(async () => pilotRoute);
    const load = vi.fn(async (modulePath: string) => {
      if (modulePath === 'conversation/companion-model-routing.js') {
        return { resolveCompanionModelRoute };
      }
      if (modulePath === 'conversation/cross-channel-bridge.js') {
        return {
          CrossChannelConversationBridge: class {
            isActive = () => true;
            history = () => [
              { role: 'user' as const, content: 'La voix posait la question du libre arbitre.' },
              { role: 'assistant' as const, content: 'Telegram a formulé une première objection.' },
            ];
          },
          resolveCrossChannelBridgeConfig: () => ({ enabled: true, coworkEnabled: true }),
        };
      }
      if (modulePath === 'companion/assistant-config.js') {
        return { readAssistantConfig: () => ({}) };
      }
      return null;
    });
    const routing = new CoworkCompanionModelRouting(load as unknown as RoutingLoader);
    const localHistory = [
      { role: 'user' as const, content: 'Dans Cowork, distinguons volonté et responsabilité.' },
      { role: 'assistant' as const, content: 'La responsabilité suppose une capacité de réponse.' },
    ];

    await expect(
      routing.resolve(
        makeSession({ tags: ['#LiSa'] }),
        'Et la réciprocité ?',
        { model: 'runtime-model' },
        localHistory,
      ),
    ).resolves.toEqual(pilotRoute);

    expect(load).toHaveBeenCalledWith('conversation/companion-model-routing.js');
    expect(resolveCompanionModelRoute).toHaveBeenCalledWith({
      surface: 'cowork',
      text: 'Et la réciprocité ?',
      history: [
        { role: 'user', content: 'La voix posait la question du libre arbitre.' },
        { role: 'assistant', content: 'Telegram a formulé une première objection.' },
        ...localHistory,
      ],
      env: process.env,
    });

    await expect(
      routing.resolve(
        makeSession({ tags: ['coding'] }),
        'Refactorise ce composant.',
        { model: 'runtime-model' },
      ),
    ).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not read a stale shared journal when the Cowork bridge is opted out', async () => {
    const resolveCompanionModelRoute = vi.fn(async () => pilotRoute);
    const history = vi.fn(() => [
      { role: 'user' as const, content: 'Ancien débat qui ne doit pas influencer Cowork.' },
    ]);
    const load = vi.fn(async (modulePath: string) => {
      if (modulePath === 'conversation/companion-model-routing.js') {
        return { resolveCompanionModelRoute };
      }
      if (modulePath === 'conversation/cross-channel-bridge.js') {
        return {
          CrossChannelConversationBridge: class {
            isActive = () => true;
            history = history;
          },
          resolveCrossChannelBridgeConfig: () => ({ enabled: true, coworkEnabled: false }),
        };
      }
      if (modulePath === 'companion/assistant-config.js') {
        return { readAssistantConfig: () => ({}) };
      }
      return null;
    });
    const routing = new CoworkCompanionModelRouting(load as unknown as RoutingLoader);

    await expect(
      routing.resolve(makeSession(), 'Continue.', { model: 'runtime-model' }),
    ).resolves.toEqual(pilotRoute);

    expect(history).not.toHaveBeenCalled();
    expect(resolveCompanionModelRoute).toHaveBeenCalledWith({
      surface: 'cowork',
      text: 'Continue.',
      history: [],
      env: process.env,
    });
  });

  it('keeps a deliberate per-session model pin authoritative', async () => {
    const resolveCompanionModelRoute = vi.fn(async () => pilotRoute);
    const { load, loader } = makeRoutingLoader({ resolveCompanionModelRoute });
    const routing = new CoworkCompanionModelRouting(loader);

    await expect(
      routing.resolve(
        makeSession({ model: 'manual-model' }),
        'Explique-moi ce choix.',
        { model: 'runtime-model' },
      ),
    ).resolves.toBeNull();

    expect(load).not.toHaveBeenCalled();
    expect(resolveCompanionModelRoute).not.toHaveBeenCalled();
  });

  it('fails open to the normal Cowork route when the core pilot is unavailable', async () => {
    const load = vi.fn(async () => {
      throw new Error('core unavailable');
    });
    const routing = new CoworkCompanionModelRouting(load as unknown as RoutingLoader);

    await expect(
      routing.resolve(
        makeSession(),
        'Continue la conversation.',
        { model: 'runtime-model' },
      ),
    ).resolves.toBeNull();

    expect(mocks.logWarn).toHaveBeenCalledWith(
      '[CoworkCompanionRouting] pilot route unavailable:',
      'core unavailable',
    );
  });

  it('passes the resolved pilot credentials and model to the engine runner', async () => {
    const companionRouting = {
      resolve: vi.fn(async () => pilotRoute),
    };
    const recordAssistant = vi.fn();
    const continuity = {
      prepare: vi.fn(async () => ({
        active: false,
        messages: [],
        systemPrompt: undefined,
        recordAssistant,
      })),
    };
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void,
        _options?: Record<string, unknown>,
      ) => {
        onEvent({ type: 'content', content: 'Une réponse approfondie.' });
        onEvent({ type: 'done' });
        return { content: 'Une réponse approfondie.' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const saved: Message[] = [];
    const session = makeSession();
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: (message) => saved.push(message) },
      continuity,
      companionRouting,
      async () => import('../../../../src/conversation/relationship-safety.js'),
    );

    const priorMessages: Message[] = [
      {
        id: 'prior-user',
        sessionId: session.id,
        role: 'user',
        content: [{ type: 'text', text: 'La conscience suffit-elle pour être libre ?' }],
        timestamp: 1,
      },
      {
        id: 'prior-assistant',
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: 'Elle permet la réflexion, sans abolir tous les déterminismes.' }],
        timestamp: 2,
      },
    ];
    await runner.run(session, 'Approfondis cette idée.', priorMessages, {
      text: 'Approfondis cette idée.',
    });

    expect(companionRouting.resolve).toHaveBeenCalledWith(
      session,
      'Approfondis cette idée.',
      expect.objectContaining({
        apiKey: 'runtime-key',
        baseUrl: 'https://runtime.example/v1',
        model: 'runtime-model',
      }),
      [
        { role: 'user', content: 'La conscience suffit-elle pour être libre ?' },
        {
          role: 'assistant',
          content: 'Elle permet la réflexion, sans abolir tous les déterminismes.',
        },
      ],
    );
    expect(adapter.runSession).toHaveBeenCalledTimes(1);
    expect(adapter.runSession.mock.calls[0]?.[3]).toMatchObject({
      apiKey: 'pilot-key',
      baseURL: 'https://api.x.ai/v1',
      model: 'grok-4.5',
    });
    expect(session.intelligence?.lastLatency?.model).toBe('grok-4.5');
    expect(saved.some((message) => message.role === 'assistant')).toBe(true);
    expect(recordAssistant).toHaveBeenCalledWith(
      expect.any(String),
      'Une réponse approfondie.',
    );
  });
});
