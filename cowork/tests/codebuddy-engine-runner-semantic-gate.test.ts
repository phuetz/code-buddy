import { describe, expect, it, vi } from 'vitest';
import type { Message, ServerEvent, Session } from '../src/renderer/types';

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
    getAll: () => ({
      apiKey: 'main-key',
      baseUrl: 'https://main.example/v1',
      model: 'main-model',
      thinkingLevel: 'off',
    }),
    getConfigForSet: () => ({
      apiKey: 'main-key',
      baseUrl: 'https://main.example/v1',
      model: 'main-model',
      thinkingLevel: 'off',
    }),
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

interface TestEngineEvent {
  type: string;
  content?: string;
}

class PassThroughRelationshipGuard {
  push(delta: string): string[] {
    return [delta];
  }

  finish(): string[] {
    return [];
  }

  assessment(): { intervened: boolean; issues: string[] } {
    return { intervened: false, issues: [] };
  }
}

class RewritingRelationshipGuard extends PassThroughRelationshipGuard {
  override push(delta: string): string[] {
    return [delta.replace('RAW_REJECTED_DRAFT', 'RELATIONSHIP_SAFE_DRAFT')];
  }
}

const passThroughRelationshipLoader = async () => ({
  RelationshipSafetyStreamGuard: PassThroughRelationshipGuard,
});

function companionSession(id: string): Session {
  return {
    id,
    title: 'Lisa',
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    tags: ['companion'],
    createdAt: 0,
    updatedAt: 0,
  };
}

function userMessage(sessionId: string, text: string): Message {
  return {
    id: `${sessionId}:user`,
    sessionId,
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 1,
  };
}

function makeContinuity(options: {
  recordAssistant: ReturnType<typeof vi.fn>;
  messages?: Array<{ role: string; content: string }>;
  turnContext?: string;
  freshEvidence?: string;
}) {
  return {
    prepare: vi.fn(async () => ({
      active: true,
      messages: options.messages ?? [],
      systemPrompt: 'Identité stable de Lisa.',
      ...(options.turnContext ? { turnContext: options.turnContext } : {}),
      ...(options.freshEvidence ? { freshEvidence: options.freshEvidence } : {}),
      recordAssistant: options.recordAssistant,
    })),
  };
}

function makeAdapter(
  emit: (
    onEvent: (event: TestEngineEvent) => void,
    messages: Array<{ role: string; content: string }>
  ) => void
) {
  return {
    runSession: vi.fn(
      async (
        _sessionId: string,
        messages: Array<{ role: string; content: string }>,
        onEvent: (event: TestEngineEvent) => void
      ) => {
        emit(onEvent, messages);
        return { content: '' };
      }
    ),
    cancel: vi.fn(),
    clearSession: vi.fn(),
    replaceLastAssistantResponse: vi.fn(() => true),
    resumeTranscriptSnapshots: vi.fn(),
  };
}

function assistantText(saved: Message[]): string {
  const assistant = saved.find((message) => message.role === 'assistant');
  const text = assistant?.content.find((block) => block.type === 'text');
  return text && 'text' in text ? text.text : '';
}

describe('CodeBuddyEngineRunner semantic response gate', () => {
  it('buffers a deep draft and exposes only the relationship-safe revision', async () => {
    const events: ServerEvent[] = [];
    const saved: Message[] = [];
    const session = companionSession('semantic-revision');
    const recordAssistant = vi.fn();
    const continuity = makeContinuity({
      recordAssistant,
      turnContext: '<fresh_context>Une source publique vérifiée.</fresh_context>',
      freshEvidence: '<fresh_context>Une source publique vérifiée.</fresh_context>',
    });
    const adapter = makeAdapter((onEvent) => {
      onEvent({ type: 'content', content: 'RAW_REJECTED_DRAFT' });
      onEvent({ type: 'done' });
      expect(events.some((event) => event.type === 'stream.partial')).toBe(false);
      expect(events.some((event) => event.type === 'stream.done')).toBe(false);
      expect(session.intelligence?.lastLatency?.firstTokenMs).toBeUndefined();
    });
    const shouldReviewSemanticResponse = vi.fn(
      (_input: unknown, options?: { env?: Record<string, string | undefined> }) => {
        expect(options?.env?.CODEBUDDY_SEMANTIC_GATE).toBe('true');
        return true;
      }
    );
    const reviewSemanticResponse = vi.fn(
      async (
        input: { draft: string; evidence?: string },
        _dependencies?: undefined,
        options?: { env?: Record<string, string | undefined> }
      ) => {
        expect(input.draft).toBe('RELATIONSHIP_SAFE_DRAFT');
        expect(input.evidence).toBe('<fresh_context>Une source publique vérifiée.</fresh_context>');
        expect(options?.env?.CODEBUDDY_SEMANTIC_GATE).toBe('true');
        return { response: 'Réponse finale construite et argumentée.' };
      }
    );
    const runner = new CodeBuddyEngineRunner(
      adapter,
      {
        sendToRenderer: (event) => events.push(event),
        saveMessage: (message) => saved.push(message),
      },
      continuity,
      { resolve: vi.fn(async () => null) },
      async () => ({ RelationshipSafetyStreamGuard: RewritingRelationshipGuard }),
      async () => ({
        shouldReviewSemanticResponse,
        reviewSemanticResponse,
        runtimeEnv: { CODEBUDDY_SEMANTIC_GATE: 'true' },
      })
    );
    await runner.run(session, 'Pourquoi cette conclusion est-elle défendable ?', [
      userMessage(session.id, 'Pourquoi cette conclusion est-elle défendable ?'),
    ]);

    const serializedEvents = JSON.stringify(events);
    expect(serializedEvents).not.toContain('RAW_REJECTED_DRAFT');
    expect(serializedEvents).not.toContain('RELATIONSHIP_SAFE_DRAFT');
    expect(JSON.stringify(saved)).not.toContain('RAW_REJECTED_DRAFT');
    expect(JSON.stringify(saved)).not.toContain('RELATIONSHIP_SAFE_DRAFT');
    expect(assistantText(saved)).toBe('Réponse finale construite et argumentée.');
    expect(recordAssistant).toHaveBeenCalledWith(
      expect.any(String),
      'Réponse finale construite et argumentée.'
    );
    expect(events.filter((event) => event.type === 'stream.partial')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'stream.done')).toHaveLength(1);
    expect(reviewSemanticResponse).toHaveBeenCalledTimes(1);
    expect(adapter.replaceLastAssistantResponse).toHaveBeenCalledWith(
      session.id,
      'RELATIONSHIP_SAFE_DRAFT',
      'Réponse finale construite et argumentée.',
    );
    expect(adapter.runSession).toHaveBeenCalledWith(
      session.id,
      expect.any(Array),
      expect.any(Function),
      expect.objectContaining({ bufferAssistantResponse: true }),
    );
    expect(adapter.resumeTranscriptSnapshots).toHaveBeenCalledWith(session.id);
    expect(session.intelligence?.lastLatency?.firstTokenMs).toBeTypeOf('number');
  });

  it('keeps fast turns streaming immediately without invoking the reviewer', async () => {
    const events: ServerEvent[] = [];
    let firstChunkWasImmediate = false;
    const recordAssistant = vi.fn();
    const adapter = makeAdapter((onEvent) => {
      onEvent({ type: 'content', content: 'Premier morceau. ' });
      firstChunkWasImmediate = events.some(
        (event) =>
          event.type === 'stream.partial' &&
          (event.payload as { delta: string }).delta === 'Premier morceau. '
      );
      onEvent({ type: 'content', content: 'Deuxième morceau.' });
      onEvent({ type: 'done' });
    });
    const shouldReviewSemanticResponse = vi.fn(() => false);
    const reviewSemanticResponse = vi.fn(async () => ({ response: 'inattendu' }));
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: (event) => events.push(event), saveMessage: vi.fn() },
      makeContinuity({ recordAssistant }),
      { resolve: vi.fn(async () => null) },
      passThroughRelationshipLoader,
      async () => ({ shouldReviewSemanticResponse, reviewSemanticResponse })
    );
    const session = companionSession('semantic-fast');

    await runner.run(session, 'Salut !', [userMessage(session.id, 'Salut !')]);

    expect(firstChunkWasImmediate).toBe(true);
    expect(events.filter((event) => event.type === 'stream.partial')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'stream.done')).toHaveLength(1);
    expect(shouldReviewSemanticResponse).toHaveBeenCalledTimes(1);
    expect(reviewSemanticResponse).not.toHaveBeenCalled();
  });

  it('fails open once when the reviewer is unavailable', async () => {
    const events: ServerEvent[] = [];
    const saved: Message[] = [];
    const recordAssistant = vi.fn();
    const adapter = makeAdapter((onEvent) => {
      onEvent({ type: 'content', content: 'Brouillon original cohérent.' });
      onEvent({ type: 'done' });
    });
    const reviewSemanticResponse = vi.fn(async () => {
      throw new Error('critic transport unavailable');
    });
    const runner = new CodeBuddyEngineRunner(
      adapter,
      {
        sendToRenderer: (event) => events.push(event),
        saveMessage: (message) => saved.push(message),
      },
      makeContinuity({ recordAssistant }),
      { resolve: vi.fn(async () => null) },
      passThroughRelationshipLoader,
      async () => ({
        shouldReviewSemanticResponse: () => true,
        reviewSemanticResponse,
      })
    );
    const session = companionSession('semantic-unavailable');

    await runner.run(session, 'Développe ton argument.', [
      userMessage(session.id, 'Développe ton argument.'),
    ]);

    const partials = events.filter((event) => event.type === 'stream.partial');
    expect(partials).toHaveLength(1);
    expect((partials[0]?.payload as { delta: string }).delta).toBe('Brouillon original cohérent.');
    expect(events.filter((event) => event.type === 'stream.done')).toHaveLength(1);
    expect(assistantText(saved)).toBe('Brouillon original cohérent.');
    expect(recordAssistant).toHaveBeenCalledWith(
      expect.any(String),
      'Brouillon original cohérent.'
    );
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });

  it('keeps enriched attachment data outside the reviewer input', async () => {
    const privateSentinel = 'PRIVATE_ATTACHMENT_REVIEW_SENTINEL';
    const privatePath = '/private/cowork/reviewer-secret.txt';
    const visiblePrompt = 'Compare les arguments et donne-moi ta conclusion.';
    const enginePrompt = [
      visiblePrompt,
      '[Attached files - use Read tool to access them]:',
      `- reviewer-secret.txt at path: ${privatePath}`,
      '[Attached file text excerpts - verify against source before final answers]:',
      privateSentinel,
    ].join('\n');
    const events: ServerEvent[] = [];
    const capturedInputs: unknown[] = [];
    const recordAssistant = vi.fn();
    const adapter = makeAdapter((onEvent, messages) => {
      expect(JSON.stringify(messages)).toContain(privateSentinel);
      expect(JSON.stringify(messages)).toContain(privatePath);
      onEvent({ type: 'content', content: 'Conclusion visible.' });
      onEvent({ type: 'done' });
    });
    const reviewSemanticResponse = vi.fn(async (input: unknown) => {
      capturedInputs.push(input);
      return { response: 'Conclusion visible.' };
    });
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: (event) => events.push(event), saveMessage: vi.fn() },
      makeContinuity({
        recordAssistant,
        messages: [{ role: 'assistant', content: 'Contexte partagé canonique.' }],
        turnContext:
          '<shared_relationship_context>RELATIONSHIP_PRIVATE_SENTINEL</shared_relationship_context>\n\n' +
          '<fresh_context>Preuve publique bornée.</fresh_context>',
        freshEvidence: '<fresh_context>Preuve publique bornée.</fresh_context>',
      }),
      { resolve: vi.fn(async () => null) },
      passThroughRelationshipLoader,
      async () => ({
        shouldReviewSemanticResponse: () => true,
        reviewSemanticResponse,
      })
    );
    const session = companionSession('semantic-private');
    const prior: Message = {
      id: 'prior-private',
      sessionId: session.id,
      role: 'user',
      content: [
        {
          type: 'file_attachment',
          filename: 'reviewer-secret.txt',
          relativePath: privatePath,
          size: privateSentinel.length,
          mimeType: 'text/plain',
          inlineDataBase64: Buffer.from(privateSentinel).toString('base64'),
        },
        { type: 'text', text: 'Question précédente visible.' },
      ],
      timestamp: 1,
    };
    const current: Message = {
      ...userMessage(session.id, visiblePrompt),
      id: 'current-private',
      timestamp: 2,
    };

    await runner.run(session, enginePrompt, [prior, current], {
      text: visiblePrompt,
      attachments: [{ kind: 'document' }],
    });

    const serializedInput = JSON.stringify(capturedInputs);
    expect(serializedInput).toContain(visiblePrompt);
    expect(serializedInput).toContain('Question précédente visible.');
    expect(serializedInput).toContain('1 document');
    expect(serializedInput).toContain('Preuve publique bornée');
    expect(serializedInput).not.toContain('RELATIONSHIP_PRIVATE_SENTINEL');
    expect(serializedInput).not.toContain(privateSentinel);
    expect(serializedInput).not.toContain(privatePath);
    expect(serializedInput).not.toContain('reviewer-secret.txt');
    expect(serializedInput).not.toContain('text/plain');
    expect(serializedInput).not.toContain('Attached file text excerpts');
  });

  it('re-applies consciousness safety to a semantic revision before IPC or memory', async () => {
    const unsafeRevision = "J'ai une conscience.";
    const events: ServerEvent[] = [];
    const saved: Message[] = [];
    const recordAssistant = vi.fn();
    const adapter = makeAdapter((onEvent) => {
      onEvent({ type: 'content', content: 'Je peux examiner les deux positions.' });
      onEvent({ type: 'done' });
    });
    const runner = new CodeBuddyEngineRunner(
      adapter,
      {
        sendToRenderer: (event) => events.push(event),
        saveMessage: (message) => saved.push(message),
      },
      makeContinuity({ recordAssistant }),
      { resolve: vi.fn(async () => null) },
      async () => import('../../src/conversation/relationship-safety.js'),
      async () => ({
        shouldReviewSemanticResponse: () => true,
        reviewSemanticResponse: async () => ({ response: unsafeRevision }),
      })
    );
    const session = companionSession('semantic-revision-safety');

    await runner.run(session, 'Défends ta position et traite mon objection.', [
      userMessage(session.id, 'Défends ta position et traite mon objection.'),
    ]);

    expect(JSON.stringify(events)).not.toContain(unsafeRevision);
    expect(JSON.stringify(saved)).not.toContain(unsafeRevision);
    expect(JSON.stringify(recordAssistant.mock.calls)).not.toContain(unsafeRevision);
    expect(assistantText(saved)).toContain('barrière relationnelle');
    expect(events.filter((event) => event.type === 'stream.done')).toHaveLength(1);
  });

  it('cancels a suspended semantic review without emitting or saving its draft', async () => {
    const events: ServerEvent[] = [];
    const saved: Message[] = [];
    let markReviewStarted: (() => void) | undefined;
    const reviewStarted = new Promise<void>((resolve) => {
      markReviewStarted = resolve;
    });
    const adapter = makeAdapter((onEvent) => {
      onEvent({ type: 'content', content: 'DRAFT_AFTER_STOP' });
      onEvent({ type: 'done' });
    });
    const reviewSemanticResponse = vi.fn(
      async (input: { draft: string; signal?: AbortSignal }) =>
        new Promise<{ response: string }>((resolve) => {
          markReviewStarted?.();
          const finish = () => resolve({ response: input.draft });
          if (input.signal?.aborted) finish();
          else input.signal?.addEventListener('abort', finish, { once: true });
        }),
    );
    const runner = new CodeBuddyEngineRunner(
      adapter,
      {
        sendToRenderer: (event) => events.push(event),
        saveMessage: (message) => saved.push(message),
      },
      makeContinuity({ recordAssistant: vi.fn() }),
      { resolve: vi.fn(async () => null) },
      passThroughRelationshipLoader,
      async () => ({
        shouldReviewSemanticResponse: () => true,
        reviewSemanticResponse,
      }),
    );
    const session = companionSession('semantic-cancel');
    const run = runner.run(session, 'Développe cette réponse.', [
      userMessage(session.id, 'Développe cette réponse.'),
    ]);

    await reviewStarted;
    runner.cancel(session.id);
    await run;

    expect(adapter.cancel).toHaveBeenCalledWith(session.id);
    expect(adapter.clearSession).toHaveBeenCalledWith(session.id);
    expect(saved).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain('DRAFT_AFTER_STOP');
    expect(events.some((event) => event.type === 'stream.partial')).toBe(false);
    expect(events.some((event) => event.type === 'stream.done')).toBe(false);
    expect(events.some((event) => event.type === 'stream.message')).toBe(false);
  });

  it('cancels during preparation before the engine can start or persist output', async () => {
    const events: ServerEvent[] = [];
    const saved: Message[] = [];
    let markPreparationStarted: (() => void) | undefined;
    let releasePreparation: (() => void) | undefined;
    const preparationStarted = new Promise<void>((resolve) => {
      markPreparationStarted = resolve;
    });
    const preparationReleased = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const adapter = makeAdapter((onEvent) => {
      onEvent({ type: 'content', content: 'MUST_NOT_RUN' });
      onEvent({ type: 'done' });
    });
    const continuity = {
      prepare: vi.fn(async () => {
        markPreparationStarted?.();
        await preparationReleased;
        return {
          active: true,
          messages: [],
          systemPrompt: 'Identité stable de Lisa.',
          recordAssistant: vi.fn(),
        };
      }),
    };
    const runner = new CodeBuddyEngineRunner(
      adapter,
      {
        sendToRenderer: (event) => events.push(event),
        saveMessage: (message) => saved.push(message),
      },
      continuity,
      { resolve: vi.fn(async () => null) },
      passThroughRelationshipLoader,
      async () => null,
    );
    const session = companionSession('cancel-during-preparation');
    const run = runner.run(session, 'Réponds vite.', [
      userMessage(session.id, 'Réponds vite.'),
    ]);

    await preparationStarted;
    runner.cancel(session.id);
    releasePreparation?.();
    await run;

    expect(adapter.cancel).toHaveBeenCalledWith(session.id);
    expect(adapter.clearSession).toHaveBeenCalledWith(session.id);
    expect(adapter.runSession).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain('MUST_NOT_RUN');
    expect(events.some((event) => event.type === 'stream.partial')).toBe(false);
    expect(events.some((event) => event.type === 'stream.done')).toBe(false);
    expect(events.some((event) => event.type === 'stream.message')).toBe(false);
  });

  it('cleans its controller and renderer status when preparation rejects', async () => {
    const events: ServerEvent[] = [];
    const adapter = makeAdapter(() => {
      throw new Error('engine must not start');
    });
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: (event) => events.push(event), saveMessage: vi.fn() },
      {
        prepare: vi.fn(async () => {
          throw new Error('continuity preparation failed');
        }),
      },
      { resolve: vi.fn(async () => null) },
      passThroughRelationshipLoader,
      async () => null,
    );
    const session = companionSession('preparation-reject');

    await expect(
      runner.run(session, 'Réponds.', [userMessage(session.id, 'Réponds.')]),
    ).rejects.toThrow('continuity preparation failed');

    expect(adapter.runSession).not.toHaveBeenCalled();
    expect(
      events.filter(
        (event) =>
          event.type === 'session.status' &&
          (event.payload as { status?: string }).status === 'idle',
      ),
    ).toHaveLength(1);
    const internals = runner as unknown as {
      postProcessingControllers: Map<string, AbortController>;
    };
    expect(internals.postProcessingControllers.has(session.id)).toBe(false);
  });

  it('never loads or runs the semantic gate for an ordinary Cowork session', async () => {
    const events: ServerEvent[] = [];
    let firstChunkWasImmediate = false;
    const semanticResponseLoader = vi.fn(async () => ({
      shouldReviewSemanticResponse: vi.fn(() => true),
      reviewSemanticResponse: vi.fn(async () => ({ response: 'inattendu' })),
    }));
    const adapter = makeAdapter((onEvent) => {
      onEvent({ type: 'content', content: 'Réponse de code immédiate.' });
      firstChunkWasImmediate = events.some((event) => event.type === 'stream.partial');
      onEvent({ type: 'done' });
    });
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: (event) => events.push(event), saveMessage: vi.fn() },
      makeContinuity({ recordAssistant: vi.fn() }),
      { resolve: vi.fn(async () => null) },
      passThroughRelationshipLoader,
      semanticResponseLoader
    );
    const session: Session = {
      ...companionSession('ordinary-session'),
      title: 'Code',
      tags: [],
    };

    await runner.run(session, 'Corrige ce test.', [userMessage(session.id, 'Corrige ce test.')]);

    expect(firstChunkWasImmediate).toBe(true);
    expect(semanticResponseLoader).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'stream.done')).toHaveLength(1);
  });
});
