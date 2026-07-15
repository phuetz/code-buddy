import type { CodeBuddyClient, CodeBuddyResponse } from '../../src/codebuddy/client.js';
import {
  reviewSemanticResponse,
  shouldReviewSemanticResponse,
  type SemanticResponseRuntimeTelemetryEvent,
} from '../../src/conversation/semantic-response-runtime.js';
import { describe, expect, it, vi } from 'vitest';

const DELIBERATIVE_REQUEST = "Penses-tu qu'une IA peut aimer ?";
const ORIGINAL_DRAFT = 'Oui, probablement.';

function response(content: string): CodeBuddyResponse {
  return {
    choices: [
      {
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
  };
}

function acceptedCritique(): string {
  return JSON.stringify({
    schemaVersion: 1,
    confidence: 0.98,
    dimensions: {
      answerCoverage: 0.95,
      logicalCoherence: 0.94,
      supportQuality: 0.9,
      objectionHandling: 0.9,
      threadProgression: 0.9,
      evidenceGrounding: null,
    },
    failedObligationIds: [],
    issueCodes: [],
  });
}

function rejectedCritique(): string {
  return JSON.stringify({
    schemaVersion: 1,
    confidence: 0.97,
    dimensions: {
      answerCoverage: 0.2,
      logicalCoherence: 0.3,
      supportQuality: 0.2,
      objectionHandling: 0.8,
      threadProgression: 0.8,
      evidenceGrounding: null,
    },
    failedObligationIds: ['answer_question', 'support_position'],
    issueCodes: ['does_not_answer', 'unsupported_claim'],
  });
}

function chatClient(outputs: string[]) {
  const chat = vi.fn(async () => {
    const output = outputs.shift();
    if (output === undefined) throw new Error('Unexpected semantic model call');
    return response(output);
  });
  return {
    chat,
    client: { chat: chat as unknown as CodeBuddyClient['chat'] },
  };
}

describe('semantic response runtime', () => {
  it('is disabled by default in tests and performs no provider resolution', async () => {
    const resolveProvider = vi.fn();
    const createClient = vi.fn();

    const result = await reviewSemanticResponse(
      { request: DELIBERATIVE_REQUEST, draft: ORIGINAL_DRAFT },
      { resolveProvider, createClient },
      { env: { NODE_ENV: 'test' } }
    );

    expect(result).toEqual({
      response: ORIGINAL_DRAFT,
      outcome: 'skipped',
      reason: 'ineligible',
      revisionAttempts: 0,
    });
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps fast conversational turns outside the gate even when enabled', () => {
    expect(
      shouldReviewSemanticResponse(
        { request: 'Bonjour Lisa' },
        { enabled: true, env: { NODE_ENV: 'test' } }
      )
    ).toBe(false);
    expect(
      shouldReviewSemanticResponse(
        { request: 'Je suis triste et j’aimerais simplement que tu restes un moment.' },
        { enabled: true, env: { NODE_ENV: 'test' } }
      )
    ).toBe(false);
  });

  it('resolves an explicit OpenRouter free critic and passes timeout and abort signal', async () => {
    const { chat, client } = chatClient([acceptedCritique()]);
    let resolvedProvider: { provider: string; model: string; apiKey: string } | undefined;

    const result = await reviewSemanticResponse(
      { request: DELIBERATIVE_REQUEST, draft: ORIGINAL_DRAFT },
      {
        createClient: provider => {
          resolvedProvider = provider;
          return client;
        },
        telemetry: () => {
          throw new Error('telemetry unavailable');
        },
      },
      {
        enabled: true,
        hasChatGptOAuth: false,
        env: {
          NODE_ENV: 'test',
          CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_PROVIDER: 'openrouter',
          CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_API_KEY: 'review-key',
          CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_MODEL: 'openrouter/free',
          CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_TIMEOUT_MS: '4321',
        },
      }
    );

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'accepted',
      reason: 'audit_passed',
      provider: 'openrouter',
      model: 'openrouter/free',
    });
    expect(resolvedProvider).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/free',
      apiKey: 'review-key',
    });
    expect(chat).toHaveBeenCalledTimes(1);
    const options = chat.mock.calls[0]?.[2];
    expect(options).toMatchObject({
      model: 'openrouter/free',
      timeoutMs: 4_321,
      temperature: 0,
      responseFormat: 'json',
      tool_choice: 'none',
      disableProviderFallback: true,
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back to a supplied main route and independently verifies its only revision', async () => {
    const revised =
      "Je ne peux pas affirmer qu'une IA aime au sens vécu : elle peut simuler l'attachement, mais l'expérience subjective reste incertaine.";
    const { chat, client } = chatClient([rejectedCritique(), revised, acceptedCritique()]);
    let resolvedProvider: { provider: string; model: string; apiKey: string } | undefined;

    const result = await reviewSemanticResponse(
      {
        request: DELIBERATIVE_REQUEST,
        draft: ORIGINAL_DRAFT,
        mainProvider: {
          apiKey: 'main-key',
          baseURL: 'https://example.test/v1',
          model: 'main-model',
        },
      },
      {
        createClient: provider => {
          resolvedProvider = provider;
          return client;
        },
      },
      {
        enabled: true,
        hasChatGptOAuth: false,
        env: {
          NODE_ENV: 'test',
          CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_PROVIDER: 'main',
        },
      }
    );

    expect(result).toMatchObject({
      response: revised,
      outcome: 'revised',
      reason: 'revision_completed',
      revisionAttempts: 1,
      provider: 'custom',
      model: 'main-model',
    });
    expect(resolvedProvider).toMatchObject({
      provider: 'custom',
      apiKey: 'main-key',
      baseURL: 'https://example.test/v1',
      model: 'main-model',
    });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls[1]?.[2]).toMatchObject({
      temperature: 0.2,
      responseFormat: 'text',
      tool_choice: 'none',
    });
    expect(chat.mock.calls[2]?.[2]).toMatchObject({
      temperature: 0,
      responseFormat: 'json',
      tool_choice: 'none',
    });
  });

  it('enables the one-audit grounding fallback only for factual responses with evidence', async () => {
    const runGate = vi.fn(async (input: { draft: string }) => ({
      response: input.draft,
      outcome: 'accepted' as const,
      reason: 'audit_passed' as const,
      revisionAttempts: 0 as const,
    }));
    const { client } = chatClient([]);
    const result = await reviewSemanticResponse(
      {
        request: 'Quelles sont les actualités importantes aujourd’hui ?',
        draft: 'Un bulletin daté et sourcé.',
        profile: 'factual_analytical',
        evidence: '{"url":"https://example.test/source"}',
      },
      {
        resolveProvider: () => ({
          task: 'semantic_review',
          provider: 'openrouter',
          label: 'OpenRouter',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'key',
          baseURL: 'https://openrouter.ai/api/v1',
          defaultModel: 'openrouter/free',
          source: 'override',
          model: 'openrouter/free',
          timeoutMs: 12_000,
          providerSetting: 'openrouter',
        }),
        createClient: () => client,
        runGate,
      },
      { enabled: true, env: { NODE_ENV: 'test' } },
    );

    expect(result.outcome).toBe('accepted');
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(runGate.mock.calls[0]?.[2]).toMatchObject({
      timeoutMs: 12_000,
      stopAfterFreshGroundingFailure: true,
    });
  });

  it('sanitizes model-internal tokens from the single revised answer', async () => {
    const { client } = chatClient([
      rejectedCritique(),
      '<think>PRIVATE_REASONING</think>\u200BLa distinction reste incertaine.',
      acceptedCritique(),
    ]);
    const result = await reviewSemanticResponse(
      { request: DELIBERATIVE_REQUEST, draft: ORIGINAL_DRAFT },
      {
        resolveProvider: () => ({
          task: 'semantic_review',
          provider: 'openrouter',
          label: 'OpenRouter',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'key',
          baseURL: 'https://openrouter.ai/api/v1',
          defaultModel: 'openrouter/free',
          source: 'override',
          model: 'openrouter/free',
          timeoutMs: 12_000,
          providerSetting: 'openrouter',
        }),
        createClient: () => client,
      },
      { enabled: true, env: { NODE_ENV: 'test' } }
    );

    expect(result.response).toBe('La distinction reste incertaine.');
    expect(result.response).not.toContain('PRIVATE_REASONING');
    expect(result.response).not.toContain('\u200B');
  });

  it('fails open when no provider is configured', async () => {
    const telemetry: SemanticResponseRuntimeTelemetryEvent[] = [];
    const result = await reviewSemanticResponse(
      { request: DELIBERATIVE_REQUEST, draft: ORIGINAL_DRAFT },
      {
        resolveProvider: () => null,
        telemetry: event => telemetry.push(event),
      },
      { enabled: true, env: { NODE_ENV: 'test' }, hasChatGptOAuth: false }
    );

    expect(result).toEqual({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'critic_failed',
      revisionAttempts: 0,
    });
    expect(telemetry).toEqual([
      expect.objectContaining({
        stage: 'runtime',
        outcome: 'fail_open',
        reason: 'critic_failed',
      }),
    ]);
  });

  it('fails open on model errors without recording request, draft, history, evidence or errors', async () => {
    const privateValues = [
      'PRIVATE_REQUEST_71',
      'PRIVATE_DRAFT_72',
      'PRIVATE_HISTORY_73',
      'PRIVATE_EVIDENCE_74',
      'PRIVATE_PROVIDER_ERROR_75',
    ];
    const telemetry: SemanticResponseRuntimeTelemetryEvent[] = [];
    const chat = vi.fn(async () => {
      throw new Error(privateValues[4]);
    });

    const result = await reviewSemanticResponse(
      {
        request: `${DELIBERATIVE_REQUEST} ${privateValues[0]}`,
        draft: `${ORIGINAL_DRAFT} ${privateValues[1]}`,
        history: [{ role: 'assistant', content: privateValues[2] }],
        evidence: privateValues[3],
      },
      {
        resolveProvider: () => ({
          task: 'semantic_review',
          provider: 'openrouter',
          label: 'OpenRouter',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'secret-key-not-telemetry',
          baseURL: 'https://openrouter.ai/api/v1',
          defaultModel: 'openrouter/free',
          source: 'override',
          model: 'openrouter/free',
          timeoutMs: 12_000,
          providerSetting: 'openrouter',
        }),
        createClient: () => ({ chat: chat as unknown as CodeBuddyClient['chat'] }),
        telemetry: event => telemetry.push(event),
      },
      { enabled: true, env: { NODE_ENV: 'test' }, hasChatGptOAuth: false }
    );

    expect(result).toMatchObject({
      response: `${ORIGINAL_DRAFT} ${privateValues[1]}`,
      outcome: 'fail_open',
      reason: 'critic_failed',
    });
    const serializedTelemetry = JSON.stringify(telemetry);
    for (const privateValue of privateValues) {
      expect(serializedTelemetry).not.toContain(privateValue);
    }
    expect(serializedTelemetry).not.toContain('secret-key-not-telemetry');
  });

  it('does not resolve a provider after caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const resolveProvider = vi.fn();

    const result = await reviewSemanticResponse(
      {
        request: DELIBERATIVE_REQUEST,
        draft: ORIGINAL_DRAFT,
        signal: controller.signal,
      },
      { resolveProvider },
      { enabled: true, env: { NODE_ENV: 'test' } }
    );

    expect(result).toEqual({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'caller_aborted',
      revisionAttempts: 0,
    });
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});
