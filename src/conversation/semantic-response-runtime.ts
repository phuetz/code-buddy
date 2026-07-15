import type {
  ChatOptions,
  CodeBuddyClient,
  CodeBuddyResponse,
} from '../codebuddy/client.js';
import type {
  ResolvedRuntimeAuxiliaryProvider,
  RuntimeAuxiliaryMainProvider,
} from '../providers/auxiliary-provider.js';
import type {
  ProviderApiMode,
  ProviderAuthMode,
  RuntimeProviderId,
} from '../providers/provider-catalog.js';
import { logger } from '../utils/logger.js';
import { sanitizeModelOutput, stripInvisibleChars } from '../utils/output-sanitizer.js';
import { deriveArgumentObligations } from './argument-obligations.js';
import { prepareConversationTurn } from './conversation-orchestrator.js';
import {
  runSemanticResponseGate,
  shouldRunSemanticResponseGate,
} from './semantic-response-gate.js';
import type {
  SemanticResponseGateOutcome,
  SemanticResponseGateReason,
  SemanticResponseGateResult,
} from './semantic-response-gate.js';
import type {
  ConversationPlan,
  ConversationTurn,
} from './types.js';

type EnvLike = Record<string, string | undefined>;
type GateRunner = typeof runSemanticResponseGate;
type GateDependencies = Parameters<GateRunner>[1];
type GateTelemetryEvent = Parameters<NonNullable<GateDependencies['telemetry']>>[0];
type AuxiliaryProviderModule = typeof import('../providers/auxiliary-provider.js');
type ResolveAuxiliaryProvider = AuxiliaryProviderModule['resolveRuntimeAuxiliaryProvider'];

const CRITIC_MAX_TOKENS = 1_200;
const MIN_REVISION_MAX_TOKENS = 384;
const MAX_REVISION_MAX_TOKENS = 2_400;

const SAFE_ISSUE_CODES = new Set([
  'does_not_answer',
  'non_sequitur',
  'unsupported_claim',
  'ignores_objection',
  'contradicts_thread',
  'fake_revision',
  'ungrounded_fresh_claim',
]);

const SAFE_DIMENSION_KEYS = new Set([
  'answerCoverage',
  'logicalCoherence',
  'supportQuality',
  'objectionHandling',
  'threadProgression',
  'evidenceGrounding',
]);

const SAFE_GATE_REASONS = new Set<SemanticResponseGateReason>([
  'audit_passed',
  'revision_completed',
  'ineligible',
  'no_obligations',
  'critic_uncertain',
  'critic_invalid',
  'critic_failed',
  'fresh_grounding_rejected',
  'revision_failed',
  'revision_empty',
  'revision_rejected',
  'revision_unverified',
  'draft_unverified',
  'timeout',
  'caller_aborted',
]);

export type SemanticResponseProfile = 'conversation' | 'factual_analytical';

/** Minimal provider tuple already available to voice/channel/Cowork callers. */
export interface SemanticResponseMainRoute {
  apiKey: string;
  baseURL: string;
  model: string;
  provider?: RuntimeProviderId;
  label?: string;
  apiMode?: ProviderApiMode;
  authMode?: ProviderAuthMode;
}

export type SemanticResponseMainProvider =
  | RuntimeAuxiliaryMainProvider
  | SemanticResponseMainRoute;

export interface SemanticResponseReviewCandidate {
  request: string;
  history?: readonly ConversationTurn[];
  plan?: ConversationPlan;
  profile?: SemanticResponseProfile;
}

export interface SemanticResponseReviewInput extends SemanticResponseReviewCandidate {
  draft: string;
  /** Bounded, source-derived evidence only; never private engine instructions. */
  evidence?: string;
  mainProvider?: SemanticResponseMainProvider | null;
  signal?: AbortSignal;
}

export interface SemanticResponseRuntimeOptions {
  /** Explicit override. `auto` is enabled outside tests and disabled in tests. */
  enabled?: boolean | 'auto';
  env?: EnvLike;
  hasChatGptOAuth?: boolean;
  defaultTimeoutMs?: number;
}

export interface SemanticResponseRuntimeTelemetryEvent {
  stage: 'runtime' | 'gate';
  elapsedMs?: number;
  provider?: string;
  model?: string;
  outcome?: SemanticResponseGateOutcome;
  reason?: SemanticResponseGateReason;
  revisionAttempts?: 0 | 1;
  issueCodes?: string[];
  dimensions?: Record<string, number | null>;
}

interface SemanticResponseChatClient {
  chat: CodeBuddyClient['chat'];
}

export interface SemanticResponseRuntimeDependencies {
  resolveProvider?: ResolveAuxiliaryProvider;
  createClient?: (
    provider: ResolvedRuntimeAuxiliaryProvider
  ) => SemanticResponseChatClient;
  runGate?: GateRunner;
  telemetry?: (event: SemanticResponseRuntimeTelemetryEvent) => void;
  now?: () => number;
}

export interface SemanticResponseRuntimeResult extends SemanticResponseGateResult {
  provider?: string;
  model?: string;
}

/**
 * Fast, deterministic preflight used by streaming surfaces before deciding to
 * buffer model output. It performs no credential lookup and no provider call.
 */
export function shouldReviewSemanticResponse(
  input: SemanticResponseReviewCandidate,
  options: SemanticResponseRuntimeOptions = {}
): boolean {
  if (!isSemanticReviewEnabled(options)) return false;
  const plan = resolvePlan(input);
  const profile = input.profile ?? inferProfile(plan);
  return (
    shouldRunSemanticResponseGate({ plan, profile }) &&
    deriveArgumentObligations(plan, input.request).length > 0
  );
}

/**
 * Review one canonical assistant draft. Provider failures, malformed critic
 * output and timeouts are fail-open: the caller always receives the original
 * draft unless a single accepted revision was produced by the core gate.
 */
export async function reviewSemanticResponse(
  input: SemanticResponseReviewInput,
  dependencies: SemanticResponseRuntimeDependencies = {},
  options: SemanticResponseRuntimeOptions = {}
): Promise<SemanticResponseRuntimeResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const plan = resolvePlan(input);
  const profile = input.profile ?? inferProfile(plan);

  if (!shouldReviewSemanticResponse({ ...input, plan, profile }, options)) {
    const result = runtimeResult(input.draft, 'skipped', 'ineligible');
    emitTelemetry(dependencies, {
      stage: 'runtime',
      elapsedMs: elapsed(now, startedAt),
      outcome: result.outcome,
      reason: result.reason,
      revisionAttempts: 0,
    });
    return result;
  }
  if (input.signal?.aborted) {
    const result = runtimeResult(input.draft, 'fail_open', 'caller_aborted');
    emitTelemetry(dependencies, {
      stage: 'runtime',
      elapsedMs: elapsed(now, startedAt),
      outcome: result.outcome,
      reason: result.reason,
      revisionAttempts: 0,
    });
    return result;
  }

  let auxiliaryModule: AuxiliaryProviderModule | undefined;
  if (!dependencies.resolveProvider || !dependencies.createClient) {
    // Keep Cowork's fast preflight light: provider SDKs are loaded only after
    // a developed turn has actually been selected for semantic review.
    try {
      auxiliaryModule = await import('../providers/auxiliary-provider.js');
    } catch {
      const result = runtimeResult(input.draft, 'fail_open', 'critic_failed');
      emitTelemetry(dependencies, {
        stage: 'runtime',
        elapsedMs: elapsed(now, startedAt),
        outcome: result.outcome,
        reason: result.reason,
        revisionAttempts: 0,
      });
      return result;
    }
  }
  if (input.signal?.aborted) {
    const result = runtimeResult(input.draft, 'fail_open', 'caller_aborted');
    emitTelemetry(dependencies, {
      stage: 'runtime',
      elapsedMs: elapsed(now, startedAt),
      outcome: result.outcome,
      reason: result.reason,
      revisionAttempts: 0,
    });
    return result;
  }
  const resolveProvider =
    dependencies.resolveProvider ?? auxiliaryModule!.resolveRuntimeAuxiliaryProvider;
  let provider: ResolvedRuntimeAuxiliaryProvider | null;
  try {
    provider = resolveProvider({
      task: 'semantic_review',
      ...(options.env ? { env: options.env } : {}),
      ...(options.hasChatGptOAuth !== undefined
        ? { hasChatGptOAuth: options.hasChatGptOAuth }
        : {}),
      ...(input.mainProvider
        ? { mainProvider: normalizeMainProvider(input.mainProvider) }
        : {}),
      ...(options.defaultTimeoutMs
        ? { defaultTimeoutMs: options.defaultTimeoutMs }
        : {}),
    });
  } catch {
    provider = null;
  }

  if (!provider) {
    const result = runtimeResult(input.draft, 'fail_open', 'critic_failed');
    emitTelemetry(dependencies, {
      stage: 'runtime',
      elapsedMs: elapsed(now, startedAt),
      outcome: result.outcome,
      reason: result.reason,
      revisionAttempts: 0,
    });
    return result;
  }

  try {
    const createClient =
      dependencies.createClient ?? auxiliaryModule!.createAuxiliaryCodeBuddyClient;
    const client = createClient(provider);
    const runGate = dependencies.runGate ?? runSemanticResponseGate;
    const gateResult = await runGate(
      {
        request: input.request,
        draft: input.draft,
        plan,
        profile,
        ...(input.history ? { history: input.history } : {}),
        ...(input.evidence ? { evidence: input.evidence } : {}),
      },
      {
        critic: ({ systemPrompt, userPrompt, signal }) =>
          invokeSemanticModel(client, provider, systemPrompt, userPrompt, {
            role: 'critic',
            signal,
            revisionMaxTokens: revisionTokenBudget(plan),
          }),
        revise: ({ systemPrompt, userPrompt, signal }) =>
          invokeSemanticModel(client, provider, systemPrompt, userPrompt, {
            role: 'reviser',
            signal,
            revisionMaxTokens: revisionTokenBudget(plan),
          }),
        telemetry: (event) => {
          emitTelemetry(dependencies, {
            stage: 'gate',
            provider: provider.provider,
            model: provider.model,
            ...sanitizeGateTelemetry(event),
          });
        },
      },
      {
        timeoutMs: provider.timeoutMs,
        ...(profile === 'factual_analytical' && input.evidence?.trim()
          ? { stopAfterFreshGroundingFailure: true }
          : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }
    );

    const result: SemanticResponseRuntimeResult = {
      response: gateResult.response,
      outcome: gateResult.outcome,
      reason: gateResult.reason,
      revisionAttempts: gateResult.revisionAttempts,
      ...(gateResult.audit ? { audit: gateResult.audit } : {}),
      ...(gateResult.verificationAudit
        ? { verificationAudit: gateResult.verificationAudit }
        : {}),
      provider: provider.provider,
      model: provider.model,
    };
    emitTelemetry(dependencies, {
      stage: 'runtime',
      elapsedMs: elapsed(now, startedAt),
      provider: provider.provider,
      model: provider.model,
      outcome: result.outcome,
      reason: result.reason,
      revisionAttempts: result.revisionAttempts,
    });
    return result;
  } catch {
    const result: SemanticResponseRuntimeResult = {
      ...runtimeResult(
        input.draft,
        'fail_open',
        input.signal?.aborted ? 'caller_aborted' : 'critic_failed'
      ),
      provider: provider.provider,
      model: provider.model,
    };
    emitTelemetry(dependencies, {
      stage: 'runtime',
      elapsedMs: elapsed(now, startedAt),
      provider: provider.provider,
      model: provider.model,
      outcome: result.outcome,
      reason: result.reason,
      revisionAttempts: 0,
    });
    return result;
  }
}

function resolvePlan(input: SemanticResponseReviewCandidate): ConversationPlan {
  if (input.plan) return input.plan;
  return prepareConversationTurn(
    input.request,
    input.history ? [...input.history] : []
  ).plan;
}

function inferProfile(plan: ConversationPlan): SemanticResponseProfile {
  return plan.act === 'fresh_information' || plan.analysis.needsFreshContext
    ? 'factual_analytical'
    : 'conversation';
}

function isSemanticReviewEnabled(options: SemanticResponseRuntimeOptions): boolean {
  if (options.enabled === true) return true;
  if (options.enabled === false) return false;

  const env = options.env ?? process.env;
  const configured = env.CODEBUDDY_SEMANTIC_GATE?.trim().toLowerCase();
  if (configured && ['1', 'true', 'yes', 'on', 'enabled'].includes(configured)) {
    return true;
  }
  if (configured && ['0', 'false', 'no', 'off', 'disabled'].includes(configured)) {
    return false;
  }

  const nodeEnv = env.NODE_ENV ?? process.env.NODE_ENV;
  return nodeEnv !== 'test';
}

function normalizeMainProvider(
  provider: SemanticResponseMainProvider
): RuntimeAuxiliaryMainProvider {
  if (isResolvedMainProvider(provider)) return provider;
  const providerId = provider.provider ?? inferProviderId(provider);
  return {
    provider: providerId,
    label: provider.label ?? 'Main conversation provider',
    apiMode: provider.apiMode ?? inferApiMode(provider),
    authMode: provider.authMode ?? inferAuthMode(provider),
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    defaultModel: provider.model,
    model: provider.model,
    source: 'override',
  };
}

function isResolvedMainProvider(
  provider: SemanticResponseMainProvider
): provider is RuntimeAuxiliaryMainProvider {
  return (
    'defaultModel' in provider &&
    'source' in provider &&
    'apiMode' in provider &&
    'authMode' in provider &&
    'label' in provider
  );
}

function inferProviderId(provider: SemanticResponseMainRoute): RuntimeProviderId {
  const value = `${provider.baseURL} ${provider.apiKey}`.toLowerCase();
  if (value.includes('chatgpt.com/backend-api/codex') || value.includes('oauth-chatgpt')) {
    return 'chatgpt';
  }
  if (value.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (value.includes('openrouter.ai')) return 'openrouter';
  if (value.includes('api.x.ai')) return 'grok';
  if (value.includes('api.openai.com')) return 'openai';
  return 'custom';
}

function inferApiMode(provider: SemanticResponseMainRoute): ProviderApiMode {
  const value = `${provider.baseURL} ${provider.apiKey}`.toLowerCase();
  if (value.includes('chatgpt.com/backend-api/codex') || value.includes('oauth-chatgpt')) {
    return 'chatgpt-responses';
  }
  if (value.includes('generativelanguage.googleapis.com')) return 'gemini-native';
  return 'openai-compatible';
}

function inferAuthMode(provider: SemanticResponseMainRoute): ProviderAuthMode {
  const value = `${provider.baseURL} ${provider.apiKey}`.toLowerCase();
  if (value.includes('chatgpt.com/backend-api/codex') || value.includes('oauth-chatgpt')) {
    return 'oauth';
  }
  if (
    value.includes('localhost') ||
    value.includes('127.0.0.1') ||
    value.includes('ollama')
  ) {
    return 'local';
  }
  return 'api-key';
}

async function invokeSemanticModel(
  client: SemanticResponseChatClient,
  provider: ResolvedRuntimeAuxiliaryProvider,
  systemPrompt: string,
  userPrompt: string,
  options: {
    role: 'critic' | 'reviser';
    signal?: AbortSignal;
    revisionMaxTokens: number;
  }
): Promise<string> {
  const response = await client.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    [],
    createSemanticChatOptions(provider, {
      temperature: options.role === 'critic' ? 0 : 0.2,
      maxTokens:
        options.role === 'critic'
          ? CRITIC_MAX_TOKENS
          : options.revisionMaxTokens,
      responseFormat: options.role === 'critic' ? 'json' : 'text',
      tool_choice: 'none',
      disableProviderFallback: true,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  );
  const text = extractResponseText(response);
  return options.role === 'reviser'
    ? stripInvisibleChars(sanitizeModelOutput(text)).trim()
    : text;
}

function createSemanticChatOptions(
  provider: ResolvedRuntimeAuxiliaryProvider,
  overrides: ChatOptions,
): ChatOptions {
  return {
    ...overrides,
    model: overrides.model ?? provider.model,
    timeoutMs: overrides.timeoutMs ?? provider.timeoutMs,
  };
}

function extractResponseText(response: CodeBuddyResponse): string {
  const content = response.choices[0]?.message.content?.trim();
  if (!content) throw new Error('SEMANTIC_REVIEW_EMPTY_RESPONSE');
  return content;
}

function revisionTokenBudget(plan: ConversationPlan): number {
  return Math.max(
    MIN_REVISION_MAX_TOKENS,
    Math.min(MAX_REVISION_MAX_TOKENS, Math.round(plan.targetTokens * 1.75))
  );
}

function sanitizeGateTelemetry(
  event: GateTelemetryEvent
): Omit<SemanticResponseRuntimeTelemetryEvent, 'stage'> {
  if (!event || typeof event !== 'object') return {};
  const record = event as unknown as Record<string, unknown>;
  const sanitized: Omit<SemanticResponseRuntimeTelemetryEvent, 'stage'> = {};

  if (typeof record.outcome === 'string' && isRuntimeOutcome(record.outcome)) {
    sanitized.outcome = record.outcome;
  }
  if (typeof record.reason === 'string' && isGateReason(record.reason)) {
    sanitized.reason = record.reason;
  }
  if (record.revisionAttempts === 0 || record.revisionAttempts === 1) {
    sanitized.revisionAttempts = record.revisionAttempts;
  }
  const elapsedMs = numberInRange(record.durationMs, 0, 300_000);
  if (elapsedMs !== undefined) sanitized.elapsedMs = elapsedMs;

  if (Array.isArray(record.issueCodes)) {
    const codes = record.issueCodes.filter(
      (value): value is string => typeof value === 'string' && SAFE_ISSUE_CODES.has(value)
    );
    if (codes.length > 0) sanitized.issueCodes = [...new Set(codes)].slice(0, 7);
  }

  if (record.dimensions && typeof record.dimensions === 'object') {
    const dimensions: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(record.dimensions)) {
      if (!SAFE_DIMENSION_KEYS.has(key)) continue;
      if (value === null) dimensions[key] = null;
      else {
        const score = numberInRange(value, 0, 1);
        if (score !== undefined) dimensions[key] = score;
      }
    }
    if (Object.keys(dimensions).length > 0) sanitized.dimensions = dimensions;
  }

  return sanitized;
}

function numberInRange(
  value: unknown,
  minimum: number,
  maximum: number
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function isRuntimeOutcome(
  value: string
): value is SemanticResponseRuntimeResult['outcome'] {
  return ['accepted', 'revised', 'skipped', 'fail_open'].includes(value);
}

function isGateReason(value: string): value is SemanticResponseGateReason {
  return SAFE_GATE_REASONS.has(value as SemanticResponseGateReason);
}

function runtimeResult(
  response: string,
  outcome: SemanticResponseGateOutcome,
  reason: SemanticResponseGateReason
): SemanticResponseRuntimeResult {
  return { response, outcome, reason, revisionAttempts: 0 };
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, now() - startedAt);
}

function emitTelemetry(
  dependencies: SemanticResponseRuntimeDependencies,
  event: SemanticResponseRuntimeTelemetryEvent
): void {
  try {
    dependencies.telemetry?.(event);
  } catch {
    // Observability must never alter delivery of the reviewed response.
  }
  try {
    logger.debug('Semantic response review', { ...event });
  } catch {
    // Logging is best-effort for the same reason.
  }
}
