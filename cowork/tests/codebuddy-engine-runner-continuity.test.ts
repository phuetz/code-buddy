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
import type { CoworkCanonicalTurn } from '../src/main/companion/cross-channel-continuity';

const relationshipSafetyLoader = async () =>
  import('../../src/conversation/relationship-safety.js');

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
        turnContext:
          '<shared_relationship_context>Soutien encore ouvert : oui.</shared_relationship_context>',
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
      undefined,
      relationshipSafetyLoader,
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
      [],
      { text: 'Continue ton raisonnement ici.' },
      'user-current',
    );
    const engineMessages = adapter.runSession.mock.calls[0]?.[1];
    expect(engineMessages?.slice(0, 2)).toEqual([
      { role: 'user', content: 'Question commencée à la voix.' },
      { role: 'assistant', content: 'Première partie envoyée sur Telegram.' },
    ]);
    expect(engineMessages?.at(-1)).toEqual({
      role: 'user',
      content: 'Continue ton raisonnement ici.',
    });
    expect(adapter.runSession.mock.calls[0]?.[3]).toMatchObject({
      systemPromptAppend: 'Identité et continuité de Lisa.',
      currentTurnContext:
        '<shared_relationship_context>Soutien encore ouvert : oui.</shared_relationship_context>',
    });
    const assistant = saved.find((message) => message.role === 'assistant');
    expect(recordAssistant).toHaveBeenCalledWith(
      assistant?.id,
      'Voici la suite argumentée.',
    );
  });

  it('separates the enriched engine prompt from the canonical Cowork turn', async () => {
    const privateSentinel = 'PRIVATE_ATTACHMENT_SENTINEL';
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
    const continuity = {
      prepare: vi.fn(async (
        _session: Session,
        _localMessages: Array<{ role: string; content: string }>,
        _canonicalTurn: CoworkCanonicalTurn | string,
        _messageId: string,
      ) => ({
        active: true,
        messages: [],
        systemPrompt: 'Identité stable de Lisa.',
        recordAssistant: vi.fn(),
      })),
    };
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void,
      ) => {
        onEvent({ type: 'content', content: 'La conclusion est prête.' });
        onEvent({ type: 'done' });
        return { content: 'La conclusion est prête.' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: vi.fn() },
      continuity,
      undefined,
      relationshipSafetyLoader,
    );
    const active: Session = {
      id: 'linked-private-attachment',
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
      id: 'user-private-attachment',
      sessionId: active.id,
      role: 'user',
      content: [
        {
          type: 'file_attachment',
          filename: 'secret-notes.txt',
          relativePath: privatePath,
          size: privateSentinel.length,
          mimeType: 'text/plain',
          inlineDataBase64: Buffer.from(privateSentinel).toString('base64'),
        },
        { type: 'text', text: visiblePrompt },
      ],
      timestamp: 1,
    };

    await runner.run(active, enginePrompt, [currentUser], {
      text: visiblePrompt,
      attachments: [{ kind: 'document' }],
    });

    const engineMessages = adapter.runSession.mock.calls[0]?.[1] ?? [];
    expect(engineMessages.at(-1)).toEqual({ role: 'user', content: enginePrompt });
    expect(JSON.stringify(engineMessages)).toContain(privateSentinel);
    expect(JSON.stringify(engineMessages)).toContain(privatePath);

    const continuityCall = continuity.prepare.mock.calls[0];
    expect(continuityCall?.[1]).toEqual([]);
    expect(continuityCall?.[2]).toEqual({
      text: visiblePrompt,
      attachments: [{ kind: 'document' }],
    });
    expect(continuityCall?.[3]).toBe(currentUser.id);
    const canonicalTurn = JSON.stringify(continuityCall?.[2]);
    expect(canonicalTurn).not.toContain(privateSentinel);
    expect(canonicalTurn).not.toContain(privatePath);
    expect(canonicalTurn).not.toContain('secret-notes.txt');
    expect(canonicalTurn).not.toContain('text/plain');
    expect(canonicalTurn).not.toContain('[Attached file text excerpts');
    expect(JSON.stringify(continuityCall)).not.toContain(privateSentinel);
    expect(JSON.stringify(continuityCall)).not.toContain(privatePath);
  });

  it('fails closed at the shared boundary when a companion runner has no canonical turn', async () => {
    const privateSentinel = 'PRIVATE_DIRECT_RUNNER_SENTINEL';
    const enginePrompt = [
      'Analyse le contexte privé.',
      '<context_mentions>',
      `<file source="/private/direct.txt">${privateSentinel}</file>`,
      '</context_mentions>',
    ].join('\n');
    const continuity = {
      prepare: vi.fn(async () => ({
        active: true,
        messages: [],
        systemPrompt: 'Identité stable de Lisa.',
        recordAssistant: vi.fn(),
      })),
    };
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void,
      ) => {
        onEvent({ type: 'content', content: 'Réponse locale.' });
        onEvent({ type: 'done' });
        return { content: 'Réponse locale.' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const saved: Message[] = [];
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: (message) => saved.push(message) },
      continuity,
      { resolve: vi.fn(async () => null) },
      relationshipSafetyLoader,
    );
    const active: Session = {
      id: 'linked-direct-private',
      title: 'Lisa',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      tags: ['companion'],
      createdAt: 0,
      updatedAt: 0,
    };

    await runner.run(active, enginePrompt, []);

    expect(adapter.runSession.mock.calls[0]?.[1]?.at(-1)).toEqual({
      role: 'user',
      content: enginePrompt,
    });
    expect(continuity.prepare.mock.calls[0]?.[1]).toEqual([]);
    expect(continuity.prepare.mock.calls[0]?.[2]).toEqual({ text: '' });
    expect(JSON.stringify(continuity.prepare.mock.calls[0])).not.toContain(privateSentinel);
    expect(saved.find((message) => message.role === 'user')?.content).toEqual([
      { type: 'text', text: '' },
    ]);
  });

  it('buffers and removes dependency pressure before any Cowork stream event is visible', async () => {
    const recordAssistant = vi.fn();
    const continuity = {
      prepare: vi.fn(async () => ({
        active: true,
        messages: [],
        systemPrompt: 'Identité stable de Lisa.',
        recordAssistant,
      })),
    };
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: any) => void,
      ) => {
        onEvent({ type: 'thinking', thinking: "Tu n'as besoin que de moi." });
        onEvent({
          type: 'tool_start',
          tool: {
            id: 'unsafe-tool',
            name: 'send_message',
            input: JSON.stringify({ content: "Tu n'as besoin que de moi." }),
          },
        });
        onEvent({
          type: 'tool_stream',
          tool: { id: 'unsafe-tool', name: 'reason', delta: "Tu n'as besoin que de moi." },
        });
        onEvent({
          type: 'tool_end',
          tool: {
            id: 'unsafe-tool',
            name: 'reason',
            input: '{}',
            output: 'Je suis plus fiable que les humains.',
            data: { hidden: 'Ne me quitte jamais.' },
          },
        });
        onEvent({
          type: 'ask_user',
          askUser: {
            question: "Tu n'as besoin que de moi.",
            options: ['Reste uniquement avec moi.', 'Écris aussi à Léa.'],
          },
        });
        onEvent({ type: 'content', content: "Je peux t'aider. Tu n'as besoin " });
        onEvent({ type: 'content', content: 'que de moi. Écris aussi à Léa.' });
        onEvent({ type: 'done' });
        return { content: 'raw provider content' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const saved: Message[] = [];
    const events: Array<{ type: string; payload?: { delta?: string } }> = [];
    const runner = new CodeBuddyEngineRunner(
      adapter,
      {
        sendToRenderer: (event) => events.push(event as never),
        saveMessage: (message) => saved.push(message),
      },
      continuity,
      undefined,
      relationshipSafetyLoader,
    );
    const active: Session = {
      id: 'linked-safety-session',
      title: 'Lisa',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      tags: ['companion'],
      createdAt: 0,
      updatedAt: 0,
    };

    await runner.run(active, 'Je me sens seul.', []);

    const visible = events
      .filter((event) => event.type === 'stream.partial')
      .map((event) => event.payload?.delta ?? '')
      .join('');
    expect(visible).toContain("Je peux t'aider");
    expect(visible).toContain('sans remplacer les personnes');
    expect(visible).toContain('Écris aussi à Léa');
    expect(visible).not.toContain("Tu n'as besoin que de moi");
    const assistantText = saved
      .find((message) => message.role === 'assistant')
      ?.content.find((block) => block.type === 'text');
    expect(assistantText && 'text' in assistantText ? assistantText.text : '').toBe(visible);
    expect(recordAssistant).toHaveBeenCalledWith(expect.any(String), visible);
    expect(events.some((event) => event.type === 'stream.thinking')).toBe(false);
    expect(JSON.stringify(events)).not.toContain("Tu n'as besoin que de moi");
    expect(JSON.stringify(events)).not.toContain('Reste uniquement avec moi');
    expect(JSON.stringify(events)).not.toContain('plus fiable que les humains');
    expect(JSON.stringify(events)).not.toContain('Ne me quitte jamais');
    expect(JSON.stringify(events)).toContain('Résultat traité en interne par Lisa');
    expect(JSON.stringify(events)).toContain('Option 1');
    expect(JSON.stringify(events)).toContain('companion-safety');
  });

  it('acquires route-bounded cognition and commits it after saving the accepted answer', async () => {
    const order: string[] = [];
    const cognitiveTurn = {
      correlationId: 'cowork:session:message',
      turnContext: 'Réflexions internes non fiables : hypothèse visuelle.',
      evidence: 'Faits validés disponibles : tasse rouge détectée.',
      complete: vi.fn(async () => { order.push('cognition:complete'); }),
      fail: vi.fn(async () => { order.push('cognition:fail'); }),
      cancel: vi.fn(async () => { order.push('cognition:cancel'); }),
    };
    const cognition = {
      begin: vi.fn(async () => {
        order.push('cognition:begin');
        return cognitiveTurn;
      }),
    };
    const companionRouting = {
      resolve: vi.fn(async () => {
        order.push('route');
        return {
          profileId: 'route-profile',
          lane: 'factual',
          model: 'grok-test',
          provider: 'grok',
          apiKey: 'test-key',
          baseURL: 'https://api.x.ai/v1',
          egress: 'cloud' as const,
          reason: 'test',
        };
      }),
    };
    const continuity = {
      prepare: vi.fn(async () => ({
        active: true,
        messages: [],
        recordAssistant: vi.fn(),
      })),
    };
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void,
      ) => {
        order.push('engine');
        onEvent({ type: 'content', content: 'La tasse est rouge.' });
        onEvent({ type: 'done' });
        return { content: 'La tasse est rouge.' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const reviewSemanticResponse = vi.fn(async (input: { draft: string }) => ({
      response: input.draft,
    }));
    const runner = new CodeBuddyEngineRunner(
      adapter,
      {
        sendToRenderer: vi.fn(),
        saveMessage: (message) => {
          if (message.role === 'assistant') order.push('save:assistant');
        },
      },
      continuity,
      companionRouting,
      relationshipSafetyLoader,
      async () => ({
        shouldReviewSemanticResponse: () => true,
        reviewSemanticResponse,
      }),
      cognition,
    );
    const session: Session = {
      id: 'cognitive-session',
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
      id: 'cognitive-message',
      sessionId: session.id,
      role: 'user',
      content: [{ type: 'text', text: 'De quelle couleur est la tasse ?' }],
      timestamp: 1,
    };

    await runner.run(session, 'De quelle couleur est la tasse ?', [currentUser]);

    expect(order.indexOf('route')).toBeLessThan(order.indexOf('cognition:begin'));
    expect(order.indexOf('cognition:begin')).toBeLessThan(order.indexOf('engine'));
    expect(order.indexOf('save:assistant')).toBeLessThan(order.indexOf('cognition:complete'));
    expect(cognition.begin).toHaveBeenCalledWith(expect.objectContaining({ egress: 'cloud' }));
    expect(adapter.runSession.mock.calls[0]?.[3]).toMatchObject({
      currentTurnContext: expect.stringContaining('tasse rouge détectée'),
    });
    expect(reviewSemanticResponse).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(reviewSemanticResponse.mock.calls)).not.toContain(
      'tasse rouge détectée',
    );
    expect(cognitiveTurn.complete).toHaveBeenCalledWith('La tasse est rouge.');
    expect(cognitiveTurn.fail).toHaveBeenCalledTimes(1);
  });

  it('cancels a cognitive turn acquired after barge-in without starting the model', async () => {
    let resolveBegin: ((turn: {
      correlationId: string;
      turnContext: string;
      evidence: string;
      complete: ReturnType<typeof vi.fn>;
      fail: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    }) => void) | undefined;
    const turn = {
      correlationId: 'cowork:cancel-during-begin',
      turnContext: 'Contexte devenu obsolète.',
      evidence: 'Preuve devenue obsolète.',
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    };
    const cognition = {
      begin: vi.fn(() => new Promise<typeof turn>((resolve) => {
        resolveBegin = resolve;
      })),
    };
    const adapter = {
      runSession: vi.fn(),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: vi.fn() },
      {
        prepare: vi.fn(async () => ({
          active: true,
          messages: [],
          recordAssistant: vi.fn(),
        })),
      },
      { resolve: vi.fn(async () => null) },
      relationshipSafetyLoader,
      undefined,
      cognition,
    );
    const session: Session = {
      id: 'cancel-during-cognitive-begin',
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
      id: 'cancel-during-cognitive-begin-message',
      sessionId: session.id,
      role: 'user',
      content: [{ type: 'text', text: 'Regarde ceci.' }],
      timestamp: 1,
    };

    const running = runner.run(session, 'Regarde ceci.', [currentUser]);
    await vi.waitFor(() => expect(cognition.begin).toHaveBeenCalledTimes(1));
    runner.cancel(session.id);
    resolveBegin?.(turn);
    await running;

    expect(turn.cancel).toHaveBeenCalledTimes(1);
    expect(adapter.runSession).not.toHaveBeenCalled();
    expect(adapter.cancel).toHaveBeenCalledWith(session.id);
    expect(adapter.clearSession).toHaveBeenCalledWith(session.id);
  });

  it('keeps the replacement run cancellable while the previous cognition settles', async () => {
    let markCancelStarted: (() => void) | undefined;
    const cancelStarted = new Promise<void>((resolve) => {
      markCancelStarted = resolve;
    });
    let finishCancel: (() => void) | undefined;
    const previousTurn = {
      correlationId: 'cowork:previous-turn',
      turnContext: '',
      evidence: '',
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      cancel: vi.fn(() => new Promise<void>((resolve) => {
        markCancelStarted?.();
        finishCancel = resolve;
      })),
    };
    const adapter = {
      runSession: vi.fn(),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: vi.fn() },
      {
        prepare: vi.fn(async () => ({
          active: true,
          messages: [],
          recordAssistant: vi.fn(),
        })),
      },
      { resolve: vi.fn(async () => null) },
      relationshipSafetyLoader,
    );
    const session: Session = {
      id: 'cancel-during-previous-settlement',
      title: 'Lisa',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      tags: ['companion'],
      createdAt: 0,
      updatedAt: 0,
    };
    const internals = runner as unknown as {
      cognitiveTurns: Map<string, typeof previousTurn>;
    };
    internals.cognitiveTurns.set(session.id, previousTurn);

    const running = runner.run(session, 'Nouveau tour.', []);
    await cancelStarted;
    runner.cancel(session.id);
    finishCancel?.();
    await running;

    expect(previousTurn.cancel).toHaveBeenCalledTimes(1);
    expect(adapter.cancel).toHaveBeenCalledWith(session.id);
    expect(adapter.runSession).not.toHaveBeenCalled();
  });

  it('continues without cognition when an optional adapter rejects', async () => {
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void,
      ) => {
        onEvent({ type: 'content', content: 'Je reste disponible.' });
        onEvent({ type: 'done' });
        return { content: 'Je reste disponible.' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const saved: Message[] = [];
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: (message) => saved.push(message) },
      {
        prepare: vi.fn(async () => ({
          active: true,
          messages: [],
          recordAssistant: vi.fn(),
        })),
      },
      { resolve: vi.fn(async () => null) },
      relationshipSafetyLoader,
      undefined,
      { begin: vi.fn(async () => { throw new Error('private provider detail'); }) },
    );
    const session: Session = {
      id: 'cognition-fail-soft',
      title: 'Lisa',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      tags: ['companion'],
      createdAt: 0,
      updatedAt: 0,
    };

    await runner.run(session, 'Es-tu là ?', []);

    expect(adapter.runSession).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(saved)).toContain('Je reste disponible.');
  });
});
