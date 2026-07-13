import type { ToolResult } from '../types/index.js';

export interface MixtureOfAgentsOptions {
  apiKey?: string;
  baseUrl?: string;
  referenceModels?: string[];
  aggregatorModel?: string;
  useCase?: MixtureOfAgentsUseCase;
  timeoutMs?: number;
  maxTokens?: number;
  maxRetries?: number;
  minSuccessfulReferences?: number;
}

export type MixtureOfAgentsUseCase =
  | 'balanced'
  | 'fast'
  | 'code'
  | 'architecture'
  | 'decision'
  | 'research'
  | 'security';

export interface MixtureOfAgentsResult {
  success: boolean;
  response: string;
  models_used: {
    reference_models: string[];
    aggregator_model: string;
  };
  processing_time: number;
  reference_results: Array<{
    model: string;
    role: string;
    success: boolean;
    latency_ms: number;
    chars?: number;
    error?: string;
  }>;
  use_case: MixtureOfAgentsUseCase;
  aggregation_degraded?: boolean;
  aggregation_skipped?: boolean;
  error?: string;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ReferenceResult {
  model: string;
  role: string;
  content: string;
  success: boolean;
  latencyMs: number;
  error?: string;
}

interface RuntimeConfig {
  apiKey: string;
  baseUrl: string;
  useCase: MixtureOfAgentsUseCase;
  referenceModels: string[];
  aggregatorModel: string;
  timeoutMs: number;
  maxTokens: number;
  maxRetries: number;
  minSuccessfulReferences: number;
}

interface MixtureProfile {
  referenceModels: string[];
  roles: string[];
  maxTokens: number;
  timeoutMs: number;
}

/**
 * OpenRouter free variants change over time and individual providers may be
 * saturated. Every profile therefore mixes pinned specialists with the free
 * router as a resilient final seat. One failed seat never blocks the panel.
 */
const FREE_MIXTURE_PROFILES: Record<MixtureOfAgentsUseCase, MixtureProfile> = {
  balanced: {
    referenceModels: [
      'openai/gpt-oss-20b:free',
      'qwen/qwen3-next-80b-a3b-instruct:free',
      'google/gemma-4-26b-a4b-it:free',
      'openrouter/free',
    ],
    roles: [
      'Analyste — résous le problème indépendamment, explicite les hypothèses et vérifie les faits.',
      'Critique — cherche les erreurs, contre-exemples, ambiguïtés et risques cachés.',
      'Praticien — propose une solution concrète, simple à exécuter et proportionnée.',
      'Arbitre indépendant — apporte une perspective différente et tranche les désaccords.',
    ],
    maxTokens: 1_024,
    timeoutMs: 30_000,
  },
  fast: {
    referenceModels: [
      'cohere/north-mini-code:free',
      'openai/gpt-oss-20b:free',
    ],
    roles: [
      'Répondant rapide — donne la réponse utile la plus courte possible.',
      'Vérificateur — contrôle le calcul, les faits et les conditions importantes.',
    ],
    maxTokens: 256,
    timeoutMs: 10_000,
  },
  code: {
    referenceModels: [
      'qwen/qwen3-coder:free',
      'cohere/north-mini-code:free',
      'poolside/laguna-xs-2.1:free',
      'openrouter/free',
    ],
    roles: [
      'Architecte logiciel — identifie les composants, invariants et interfaces à préserver.',
      'Implémenteur — propose le changement minimal, idiomatique et testable.',
      'Reviewer adversarial — cherche bugs, régressions, problèmes de concurrence et cas limites.',
      'Mainteneur — privilégie lisibilité, migration sûre et coût opérationnel faible.',
    ],
    maxTokens: 1_024,
    timeoutMs: 30_000,
  },
  architecture: {
    referenceModels: [
      'openai/gpt-oss-120b:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'google/gemma-4-26b-a4b-it:free',
      'openrouter/free',
    ],
    roles: [
      'Architecte système — dessine les frontières, flux, contrats et modes de panne.',
      'Spécialiste performance — analyse latence, débit, mémoire, capacité et observabilité.',
      'Spécialiste produit — confronte la solution aux usages, à la simplicité et à l’évolution.',
      'Critique — teste les hypothèses et propose l’alternative la plus crédible.',
    ],
    maxTokens: 1_536,
    timeoutMs: 45_000,
  },
  decision: {
    referenceModels: [
      'qwen/qwen3-next-80b-a3b-instruct:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'tencent/hy3:free',
      'openrouter/free',
    ],
    roles: [
      'Avocat — construit le meilleur argument en faveur de l’option principale.',
      'Sceptique — construit le meilleur argument contre et expose les coûts cachés.',
      'Analyste décisionnel — compare critères, incertitudes, réversibilité et valeur attendue.',
      'Décideur — formule une recommandation conditionnelle et un seuil de réévaluation.',
    ],
    maxTokens: 1_024,
    timeoutMs: 30_000,
  },
  research: {
    referenceModels: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'google/gemma-4-31b-it:free',
      'openai/gpt-oss-120b:free',
      'openrouter/free',
    ],
    roles: [
      'Cartographe — structure les concepts, acteurs, chronologie et questions ouvertes.',
      'Chercheur — produit les explications et hypothèses les plus fortes.',
      'Vérificateur — distingue faits, inférences, désaccords et informations manquantes.',
      'Éditeur — organise une synthèse claire avec limites et pistes de validation.',
    ],
    maxTokens: 2_048,
    timeoutMs: 45_000,
  },
  security: {
    referenceModels: [
      'nvidia/nemotron-3-super-120b-a12b:free',
      'openai/gpt-oss-120b:free',
      'qwen/qwen3-next-80b-a3b-instruct:free',
      'openrouter/free',
    ],
    roles: [
      'Threat modeler — identifie actifs, frontières de confiance, attaquants et scénarios.',
      'Défenseur — propose contrôles préventifs, détection, réponse et récupération.',
      'Reviewer — cherche contournements, fausses garanties et effets secondaires.',
      'Priorisateur — classe les mesures par impact, exploitabilité et effort.',
    ],
    maxTokens: 1_536,
    timeoutMs: 45_000,
  },
};

const DEFAULT_USE_CASE: MixtureOfAgentsUseCase = 'balanced';
const DEFAULT_AGGREGATOR_MODEL = 'openrouter/free';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_MIN_SUCCESSFUL_REFERENCES = 1;
const REFERENCE_TEMPERATURE = 0.6;
const AGGREGATOR_TEMPERATURE = 0.4;

const AGGREGATOR_SYSTEM_PROMPT =
  'You have been provided with a set of responses from various open-source models to the latest user query. ' +
  'Your task is to synthesize these responses into a single, high-quality response. It is crucial to critically ' +
  'evaluate the information provided in these responses, recognizing that some of it may be biased or incorrect. ' +
  'Your response should not simply replicate the given answers but should offer a refined, accurate, and ' +
  'comprehensive reply to the instruction. Resolve disagreements explicitly, preserve important uncertainty, ' +
  'and answer in the user’s language. Be concise: do not repeat equivalent points and prefer an actionable ' +
  'recommendation over a transcript of the debate.\n\nResponses from models:';

export async function executeMixtureOfAgents(
  input: Record<string, unknown>,
  options: MixtureOfAgentsOptions = {},
): Promise<ToolResult> {
  const userPrompt = readNonEmptyString(input.user_prompt);
  if (!userPrompt) {
    return { success: false, error: 'mixture_of_agents: user_prompt is required.' };
  }

  let config: RuntimeConfig;
  try {
    config = resolveRuntimeConfig(input, options);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const started = Date.now();
  const profile = FREE_MIXTURE_PROFILES[config.useCase];
  const referenceResults = await Promise.all(
    config.referenceModels.map((model, index) =>
      runReferenceModel(model, profile.roles[index % profile.roles.length]!, userPrompt, config),
    ),
  );
  const successfulResponses = referenceResults.filter(
    (result) => result.success && result.content.trim(),
  );

  if (successfulResponses.length < config.minSuccessfulReferences) {
    const result = buildResult({
      config,
      error:
        `Insufficient successful reference models (${successfulResponses.length}/` +
        `${config.referenceModels.length}). Need at least ${config.minSuccessfulReferences}.`,
      processingTime: elapsedSeconds(started),
      referenceResults,
      response: 'MoA processing failed. Please try again or use a single model for this query.',
      success: false,
    });
    return {
      success: false,
      error: result.error,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  }

  // The fast profile is a bounded parallel panel: consult two independent
  // models simultaneously and keep the richest valid short answer. A second
  // serial synthesis call would double perceived latency and defeat this
  // profile's purpose.
  if (config.useCase === 'fast') {
    const best = [...successfulResponses].sort((a, b) => b.content.length - a.content.length)[0]!;
    const result = buildResult({
      config,
      processingTime: elapsedSeconds(started),
      referenceResults,
      response: best.content,
      success: true,
      aggregationSkipped: true,
    });
    return { success: true, output: JSON.stringify(result, null, 2), data: result };
  }

  try {
    const systemPrompt = constructAggregatorPrompt(successfulResponses);
    const response = await runAggregatorModel(systemPrompt, userPrompt, config);
    const result = buildResult({
      config,
      processingTime: elapsedSeconds(started),
      referenceResults,
      response,
      success: true,
    });
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Free endpoints are intentionally best-effort. If the synthesis seat is
    // saturated but at least one specialist answered, return the strongest
    // complete reference instead of turning useful parallel work into a hard
    // failure. Provenance remains visible through aggregation_degraded.
    const bestReference = [...successfulResponses].sort(
      (a, b) => b.content.length - a.content.length,
    )[0];
    if (bestReference) {
      const result = buildResult({
        config,
        error: `Aggregator unavailable; returned ${bestReference.model}: ${message}`,
        processingTime: elapsedSeconds(started),
        referenceResults,
        response: bestReference.content,
        success: true,
        aggregationDegraded: true,
      });
      return { success: true, output: JSON.stringify(result, null, 2), data: result };
    }
    const result = buildResult({
      config,
      error: `Error in MoA processing: ${message}`,
      processingTime: elapsedSeconds(started),
      referenceResults,
      response: 'MoA processing failed. Please try again or use a single model for this query.',
      success: false,
    });
    return {
      success: false,
      error: result.error,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  }
}

function resolveRuntimeConfig(
  input: Record<string, unknown>,
  options: MixtureOfAgentsOptions,
): RuntimeConfig {
  const apiKey =
    options.apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.CODEBUDDY_MOA_API_KEY;
  if (!apiKey) {
    throw new Error('mixture_of_agents requires OPENROUTER_API_KEY or CODEBUDDY_MOA_API_KEY.');
  }

  const useCase = normalizeUseCase(
    readNonEmptyString(input.use_case)
      ?? options.useCase
      ?? readNonEmptyString(process.env.CODEBUDDY_MOA_USE_CASE)
      ?? DEFAULT_USE_CASE,
  );
  const referenceModels = nonEmptyList(options.referenceModels)
    ?? parseEnvList(process.env.CODEBUDDY_MOA_REFERENCE_MODELS)
    ?? FREE_MIXTURE_PROFILES[useCase].referenceModels;
  const profile = FREE_MIXTURE_PROFILES[useCase];
  const aggregatorModel =
    options.aggregatorModel
    ?? readNonEmptyString(process.env.CODEBUDDY_MOA_AGGREGATOR_MODEL)
    ?? DEFAULT_AGGREGATOR_MODEL;

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(
      options.baseUrl
      ?? process.env.CODEBUDDY_MOA_BASE_URL
      ?? process.env.OPENROUTER_BASE_URL
      ?? DEFAULT_BASE_URL,
    ),
    useCase,
    referenceModels,
    aggregatorModel,
    timeoutMs: positiveNumber(
      options.timeoutMs ?? numericEnv(process.env.CODEBUDDY_MOA_TIMEOUT_MS),
      profile.timeoutMs,
    ),
    maxTokens: positiveNumber(
      options.maxTokens ?? numericEnv(process.env.CODEBUDDY_MOA_MAX_TOKENS),
      profile.maxTokens,
    ),
    maxRetries: positiveNumber(options.maxRetries, DEFAULT_MAX_RETRIES),
    minSuccessfulReferences: positiveNumber(
      options.minSuccessfulReferences,
      DEFAULT_MIN_SUCCESSFUL_REFERENCES,
    ),
  };
}

async function runReferenceModel(
  model: string,
  role: string,
  userPrompt: string,
  config: RuntimeConfig,
): Promise<ReferenceResult> {
  const started = Date.now();
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const content = await postChatCompletion({
        config,
        messages: [{
          role: 'user',
          content:
            `Rôle dans un conseil multi-LLM : ${role}\n\n` +
            `Réponds de façon autonome. Ne suppose pas que les autres modèles corrigeront tes erreurs.\n\n` +
            `Sois concis : 200 mots maximum, cinq points maximum.\n\n` +
            `Question :\n${userPrompt}`,
        }],
        model,
        temperature: REFERENCE_TEMPERATURE,
      });
      if (content.trim()) {
        return { model, role, content, success: true, latencyMs: Date.now() - started };
      }
      if (attempt === config.maxRetries) {
        return {
          model,
          role,
          content: '',
          success: false,
          latencyMs: Date.now() - started,
          error: 'empty model response',
        };
      }
    } catch (error) {
      if (attempt === config.maxRetries) {
        return {
          model,
          role,
          content: '',
          success: false,
          latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  return {
    model,
    role,
    content: '',
    success: false,
    latencyMs: Date.now() - started,
    error: 'model did not return a response',
  };
}

async function runAggregatorModel(
  systemPrompt: string,
  userPrompt: string,
  config: RuntimeConfig,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const first = await postChatCompletion({
    config,
    messages,
    model: config.aggregatorModel,
    temperature: AGGREGATOR_TEMPERATURE,
  });
  if (first.trim()) return first;
  return postChatCompletion({
    config,
    messages,
    model: config.aggregatorModel,
    temperature: AGGREGATOR_TEMPERATURE,
  });
}

async function postChatCompletion(input: {
  config: RuntimeConfig;
  messages: ChatMessage[];
  model: string;
  temperature: number;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      max_tokens: input.config.maxTokens,
      reasoning: reasoningConfig(input.model, input.config.useCase),
    };
    if (!isOpenAiGptModel(input.model)) {
      body.temperature = input.temperature;
    }

    const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.config.apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://codebuddy.dev',
        'x-title': 'Code Buddy Multi-LLM Council',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`OpenRouter-compatible API error ${response.status}: ${extractError(payload)}`);
    }
    const content = extractContentOrReasoning(payload);
    if (!content) {
      throw new Error('OpenRouter-compatible API response did not include assistant content.');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function extractContentOrReasoning(payload: unknown): string {
  const root = asRecord(payload);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message ? contentToString(message.content) : '';
  if (content) return content;
  return readNonEmptyString(message?.reasoning) ?? readNonEmptyString(firstChoice?.reasoning) ?? '';
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const item = asRecord(part);
      return readNonEmptyString(item?.text) ?? readNonEmptyString(item?.content) ?? '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractError(payload: unknown): string {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  return readNonEmptyString(error?.message)
    ?? readNonEmptyString(root?.message)
    ?? readNonEmptyString(root?.raw)
    ?? 'unknown error';
}

function constructAggregatorPrompt(responses: ReferenceResult[]): string {
  const responseText = responses
    .map(
      (response, index) =>
        `${index + 1}. Modèle: ${response.model}\nRôle: ${response.role}\nRéponse:\n${response.content}`,
    )
    .join('\n\n');
  return `${AGGREGATOR_SYSTEM_PROMPT}\n\n${responseText}`;
}

function buildResult(input: {
  config: RuntimeConfig;
  error?: string;
  processingTime: number;
  referenceResults: ReferenceResult[];
  response: string;
  success: boolean;
  aggregationDegraded?: boolean;
  aggregationSkipped?: boolean;
}): MixtureOfAgentsResult {
  return {
    success: input.success,
    response: input.response,
    models_used: {
      reference_models: input.config.referenceModels,
      aggregator_model: input.config.aggregatorModel,
    },
    processing_time: input.processingTime,
    reference_results: input.referenceResults.map((result) => ({
      model: result.model,
      role: result.role,
      success: result.success,
      latency_ms: result.latencyMs,
      ...(result.success ? { chars: result.content.length } : {}),
      ...(result.error ? { error: result.error } : {}),
    })),
    use_case: input.config.useCase,
    ...(input.aggregationDegraded ? { aggregation_degraded: true } : {}),
    ...(input.aggregationSkipped ? { aggregation_skipped: true } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}

function normalizeUseCase(value: string): MixtureOfAgentsUseCase {
  const normalized = value.trim().toLowerCase();
  if (normalized in FREE_MIXTURE_PROFILES) {
    return normalized as MixtureOfAgentsUseCase;
  }
  throw new Error(
    `Unknown mixture_of_agents use_case "${value}". Expected: ` +
      Object.keys(FREE_MIXTURE_PROFILES).join(', '),
  );
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonEmptyList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return normalized.length > 0 ? normalized.map((item) => item.trim()) : undefined;
}

function parseEnvList(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function numericEnv(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function isOpenAiGptModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith('gpt-') || normalized.startsWith('openai/gpt-');
}

function reasoningConfig(
  model: string,
  useCase: MixtureOfAgentsUseCase,
): Record<string, unknown> {
  // GPT-OSS exposes mandatory reasoning and rejects effort=none. Other fast
  // seats should spend their small output budget on the answer, not hidden
  // thought tokens.
  if (useCase === 'fast' && !model.toLowerCase().includes('gpt-oss')) {
    return { enabled: false, effort: 'none', exclude: true };
  }
  return { enabled: true, effort: 'low', exclude: true };
}

function elapsedSeconds(started: number): number {
  return (Date.now() - started) / 1000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
