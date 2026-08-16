/**
 * Pure cost-report aggregation for persisted Code Buddy sessions.
 *
 * Session persistence has had several shapes over time (camelCase, snake_case,
 * per-message usage, per-turn usage, and session-level totals). This module
 * deliberately accepts loose injected records and normalizes those shapes. It
 * performs no filesystem/database access. Pricing is injected by the caller so
 * the CLI can reuse the canonical model registry without coupling this module
 * to its snapshot loader.
 */

export type CostGroupBy = 'model' | 'provider' | 'day';

export interface CostPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type CostPricingResolver = (model: string, provider: string) => CostPricing | undefined;

export interface CostSessionEntry {
  [key: string]: unknown;
}

export interface CostTokenTotals {
  input: number;
  output: number;
  /** Tokens persisted without an input/output split. Never guessed. */
  unattributed: number;
}

export interface CostBreakdown {
  cost: number;
  tokens: CostTokenTotals;
  turns: number;
  averageCostPerTurn: number;
  /** Portion of `cost` reconstructed from tokens and injected model pricing. */
  estimatedCost: number;
  estimatedTurns: number;
  /** Turns for which neither a stored cost nor a defensible estimate exists. */
  unknownCostTurns: number;
}

export interface CostReport {
  generatedAt: string;
  since: string | null;
  sessions: number;
  turns: number;
  totalCost: number;
  averageCostPerTurn: number;
  tokens: CostTokenTotals;
  estimatedCost: number;
  estimatedTurns: number;
  unknownCostSessions: number;
  unknownCostTurns: number;
  byModel: Record<string, CostBreakdown>;
  byProvider: Record<string, CostBreakdown>;
  byDay: Record<string, CostBreakdown>;
}

export interface CostReportOptions {
  /** Inclusive lower timestamp bound. Accepts a Date, `Nd`, or `YYYY-MM-DD`. */
  since?: Date | string;
  /** Clock injection for deterministic reports and relative `Nd` filters. */
  now?: Date;
  /** Canonical pricing resolver supplied by the I/O/orchestration layer. */
  resolvePricing?: CostPricingResolver;
}

interface RawMeasurement {
  inputTokens: number;
  outputTokens: number;
  unattributedTokens: number;
  hasTokenInformation: boolean;
  tokenSource: 'structured' | 'role';
  storedCost?: number;
  preEstimatedCost?: number;
  model?: string;
  provider?: string;
  timestamp?: Date;
  pricing?: CostPricing;
}

interface DraftTurn {
  measurements: RawMeasurement[];
  model: string;
  provider: string;
  timestamp?: Date;
  turns: number;
}

interface NormalizedTurn {
  sessionKey: string;
  model: string;
  provider: string;
  day: string;
  timestamp?: Date;
  cost: number;
  estimatedCost: number;
  costEstimated: boolean;
  costUnknown: boolean;
  inputTokens: number;
  outputTokens: number;
  unattributedTokens: number;
  turns: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_MODEL = 'unknown';
const UNKNOWN_PROVIDER = 'unknown';
const UNKNOWN_DAY = 'unknown';

const INPUT_TOKEN_KEYS = [
  'inputTokens',
  'input_tokens',
  'tokensIn',
  'tokens_in',
  'promptTokens',
  'prompt_tokens',
  'totalTokensIn',
  'total_tokens_in',
] as const;

const OUTPUT_TOKEN_KEYS = [
  'outputTokens',
  'output_tokens',
  'tokensOut',
  'tokens_out',
  'completionTokens',
  'completion_tokens',
  'totalTokensOut',
  'total_tokens_out',
] as const;

const TOTAL_TOKEN_KEYS = ['totalTokens', 'total_tokens', 'tokenCount', 'token_count'] as const;

const STORED_COST_KEYS = [
  'costUsd',
  'costUSD',
  'cost_usd',
  'totalCost',
  'totalCostUsd',
  'total_cost',
  'total_cost_usd',
  'sessionCost',
  'session_cost',
  'totalUsd',
  'total_usd',
  'cost',
  'amountUsd',
  'amount_usd',
  'usd',
] as const;

const ESTIMATED_COST_KEYS = [
  'estimatedCostUsd',
  'estimated_cost_usd',
  'estimatedCost',
  'estimated_cost',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = nonNegativeNumber(value);
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function firstNumber(
  records: readonly (Record<string, unknown> | undefined)[],
  keys: readonly string[]
): number | undefined {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = nonNegativeNumber(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function firstString(
  records: readonly (Record<string, unknown> | undefined)[],
  keys: readonly string[]
): string | undefined {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = nonEmptyString(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function parseTimestamp(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : new Date(value.getTime());
  }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function firstTimestamp(
  records: readonly (Record<string, unknown> | undefined)[]
): Date | undefined {
  for (const record of records) {
    if (!record) continue;
    for (const key of ['timestamp', 'ts', 'date', 'createdAt', 'created_at']) {
      const timestamp = parseTimestamp(record[key]);
      if (timestamp) return timestamp;
    }
  }
  return undefined;
}

function pricingFromRecords(
  records: readonly (Record<string, unknown> | undefined)[]
): CostPricing | undefined {
  for (const record of records) {
    if (!record) continue;
    const candidates = [
      asRecord(record.pricing),
      asRecord(record.modelPricing),
      asRecord(record.model_pricing),
    ];
    for (const pricing of candidates) {
      if (!pricing) continue;
      const inputPerMillion = firstNumber(
        [pricing],
        ['inputPerMillion', 'inputPer1M', 'input_price_per_million', 'price_per_m_input', 'input']
      );
      const outputPerMillion = firstNumber(
        [pricing],
        [
          'outputPerMillion',
          'outputPer1M',
          'output_price_per_million',
          'price_per_m_output',
          'output',
        ]
      );
      if (inputPerMillion !== undefined && outputPerMillion !== undefined) {
        return { inputPerMillion, outputPerMillion };
      }
    }
  }
  return undefined;
}

function roleOf(record: Record<string, unknown>): string | undefined {
  return firstString([record], ['type', 'role'])?.toLowerCase();
}

function isUserRole(role: string | undefined): boolean {
  return role === 'user' || role === 'human';
}

function isAssistantRole(role: string | undefined): boolean {
  return role === 'assistant' || role === 'model' || role === 'reasoning';
}

function measurementFromRecord(
  record: Record<string, unknown>,
  role?: string
): RawMeasurement | undefined {
  const usage = asRecord(record.usage);
  const tokenUsage = asRecord(record.tokenUsage) ?? asRecord(record.token_usage);
  const metrics = asRecord(record.metrics);
  const metadata = asRecord(record.metadata);
  const metadataUsage = asRecord(metadata?.usage);
  const tokensObject = asRecord(record.tokens);
  const costObject = asRecord(record.cost);
  const candidates = [
    usage,
    tokenUsage,
    metrics,
    tokensObject,
    record,
    metadataUsage,
    metadata,
    costObject,
  ];

  let inputTokens = firstNumber(candidates, INPUT_TOKEN_KEYS);
  let outputTokens = firstNumber(candidates, OUTPUT_TOKEN_KEYS);
  const totalTokens = firstNumber(candidates, TOTAL_TOKEN_KEYS);
  const directRoleTokens = nonNegativeNumber(record.tokens) ?? nonNegativeNumber(record.tokenCount);
  const hasDirectionalTokens = inputTokens !== undefined || outputTokens !== undefined;
  let unattributedTokens = 0;
  let tokenSource: RawMeasurement['tokenSource'] = 'structured';

  if (hasDirectionalTokens) {
    inputTokens ??= 0;
    outputTokens ??= 0;
    if (totalTokens !== undefined) {
      unattributedTokens = Math.max(0, totalTokens - inputTokens - outputTokens);
    }
  } else if (directRoleTokens !== undefined && isUserRole(role)) {
    inputTokens = directRoleTokens;
    outputTokens = 0;
    tokenSource = 'role';
  } else if (directRoleTokens !== undefined && isAssistantRole(role)) {
    inputTokens = 0;
    outputTokens = directRoleTokens;
    tokenSource = 'role';
  } else {
    inputTokens = 0;
    outputTokens = 0;
    unattributedTokens = totalTokens ?? directRoleTokens ?? 0;
  }

  let storedCost = firstNumber(candidates, STORED_COST_KEYS);
  let preEstimatedCost = firstNumber(candidates, ESTIMATED_COST_KEYS);
  const costSource = firstString(candidates, ['costSource', 'cost_source'])?.toLowerCase();
  const explicitlyEstimated =
    record.estimated === true ||
    record.costEstimated === true ||
    record.cost_estimated === true ||
    costSource === 'estimated';
  if (storedCost !== undefined && explicitlyEstimated) {
    preEstimatedCost ??= storedCost;
    storedCost = undefined;
  }

  const hasTokenInformation =
    hasDirectionalTokens || directRoleTokens !== undefined || totalTokens !== undefined;
  if (!hasTokenInformation && storedCost === undefined && preEstimatedCost === undefined) {
    return undefined;
  }

  const model = firstString(
    [record, usage, tokenUsage, metrics, metadataUsage, metadata],
    ['model', 'modelId', 'model_id']
  );
  const provider = firstString(
    [record, usage, tokenUsage, metrics, metadataUsage, metadata],
    ['provider', 'providerId', 'provider_id']
  );

  return {
    inputTokens,
    outputTokens,
    unattributedTokens,
    hasTokenInformation,
    tokenSource,
    storedCost,
    preEstimatedCost,
    model,
    provider,
    timestamp: firstTimestamp([record, usage, tokenUsage, metrics, metadataUsage, metadata]),
    pricing: pricingFromRecords(candidates),
  };
}

function normalizeProviderName(provider: string): string {
  const normalized = provider.trim().toLowerCase().replace(/_/g, '-');
  const aliases: Record<string, string> = {
    xai: 'grok',
    google: 'gemini',
    'google-ai': 'gemini',
    'aws-bedrock': 'bedrock',
    aws: 'bedrock',
    'azure-openai': 'azure',
    'github-copilot': 'copilot',
    'lm-studio': 'lmstudio',
    'chatgpt-oauth': 'chatgpt',
    'openai-codex': 'chatgpt',
  };
  return aliases[normalized] ?? normalized;
}

/** Infer a user-facing provider when an old session only persisted the model. */
export function inferCostProvider(model: string): string {
  const lower = model.trim().toLowerCase();
  if (!lower || lower === UNKNOWN_MODEL) return UNKNOWN_PROVIDER;
  if (lower === 'openrouter/free' || lower.endsWith(':free')) return 'openrouter';

  const qualified = lower.match(/^([a-z0-9_-]+)\//)?.[1];
  if (
    qualified &&
    [
      'openrouter',
      'groq',
      'together',
      'fireworks',
      'azure',
      'bedrock',
      'copilot',
      'vllm',
      'lmstudio',
      'ollama',
    ].includes(qualified)
  ) {
    return normalizeProviderName(qualified);
  }

  if (/^(anthropic\.|amazon\.|meta\.|mistral\.).*:v?\d/i.test(lower)) return 'bedrock';
  if (lower.startsWith('grok-')) return 'grok';
  if (/^(gpt-|o[1-9](?:-|$)|codex)/.test(lower)) return 'openai';
  if (lower.startsWith('claude-')) return 'anthropic';
  if (lower.startsWith('gemini-')) return 'gemini';
  if (lower.startsWith('azure-')) return 'azure';
  if (lower.startsWith('groq/')) return 'groq';
  if (lower.startsWith('together/')) return 'together';
  if (lower.startsWith('fireworks/')) return 'fireworks';
  if (lower.startsWith('mistral') || lower.startsWith('mixtral') || lower.startsWith('devstral')) {
    return 'mistral';
  }
  if (
    lower.startsWith('ollama/') ||
    /^(llama|qwen|gemma|phi|codellama|command-r|deepseek)/.test(lower)
  ) {
    return 'ollama';
  }
  if (lower.startsWith('lmstudio/') || lower === 'local-model') return 'lmstudio';
  if (lower.startsWith('vllm/')) return 'vllm';
  return UNKNOWN_PROVIDER;
}

function modelForSession(session: Record<string, unknown>): string {
  const metadata = asRecord(session.metadata);
  return firstString([session, metadata], ['model', 'modelId', 'model_id']) ?? UNKNOWN_MODEL;
}

function providerForSession(session: Record<string, unknown>, model: string): string {
  const metadata = asRecord(session.metadata);
  const provider = firstString([session, metadata], ['provider', 'providerId', 'provider_id']);
  return provider ? normalizeProviderName(provider) : inferCostProvider(model);
}

function sessionTimestamp(session: Record<string, unknown>): Date | undefined {
  const metadata = asRecord(session.metadata);
  for (const record of [session, metadata]) {
    if (!record) continue;
    for (const key of [
      'lastAccessedAt',
      'last_accessed_at',
      'updatedAt',
      'updated_at',
      'createdAt',
      'created_at',
      'timestamp',
      'date',
    ]) {
      const parsed = parseTimestamp(record[key]);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function explicitTurnCount(session: Record<string, unknown>): number | undefined {
  const metadata = asRecord(session.metadata);
  for (const record of [session, metadata]) {
    if (!record) continue;
    for (const key of ['turnCount', 'turn_count', 'totalTurns', 'total_turns']) {
      const value = nonNegativeInteger(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function recordsFromArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function measurementArray(session: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ['turns', 'usageEntries', 'usage_entries', 'costEntries', 'cost_entries']) {
    const entries = recordsFromArray(session[key]);
    if (entries.length > 0) return entries;
  }
  const usageEntries = recordsFromArray(session.usage);
  return usageEntries;
}

function draftFromEntry(
  entry: Record<string, unknown>,
  fallbackModel: string,
  fallbackProvider: string,
  fallbackTimestamp: Date | undefined
): DraftTurn {
  const measurement = measurementFromRecord(entry, roleOf(entry));
  const model = measurement?.model ?? fallbackModel;
  const provider = measurement?.provider
    ? normalizeProviderName(measurement.provider)
    : fallbackProvider === UNKNOWN_PROVIDER
      ? inferCostProvider(model)
      : fallbackProvider;
  return {
    measurements: measurement ? [measurement] : [],
    model,
    provider,
    timestamp: measurement?.timestamp ?? firstTimestamp([entry]) ?? fallbackTimestamp,
    turns: 1,
  };
}

function messageDrafts(
  session: Record<string, unknown>,
  fallbackModel: string,
  fallbackProvider: string,
  fallbackTimestamp: Date | undefined
): DraftTurn[] {
  const messages = recordsFromArray(session.messages);
  const turns: DraftTurn[] = [];
  let current: DraftTurn | undefined;

  const finishCurrent = (): void => {
    if (current) turns.push(current);
    current = undefined;
  };

  for (const message of messages) {
    const role = roleOf(message);
    const measurement = measurementFromRecord(message, role);
    const timestamp = measurement?.timestamp ?? firstTimestamp([message]);

    if (isUserRole(role)) {
      finishCurrent();
      const model = measurement?.model ?? fallbackModel;
      current = {
        measurements: measurement ? [measurement] : [],
        model,
        provider: measurement?.provider
          ? normalizeProviderName(measurement.provider)
          : fallbackProvider === UNKNOWN_PROVIDER
            ? inferCostProvider(model)
            : fallbackProvider,
        timestamp: timestamp ?? fallbackTimestamp,
        turns: 1,
      };
      continue;
    }

    if (current) {
      if (measurement) {
        current.measurements.push(measurement);
        if (measurement.model) current.model = measurement.model;
        if (measurement.provider) current.provider = normalizeProviderName(measurement.provider);
      }
      current.timestamp ??= timestamp ?? fallbackTimestamp;
      continue;
    }

    // Legacy histories can contain standalone assistant usage entries. Count
    // only entries that actually carry usage/cost, not decorative messages.
    if (measurement) {
      turns.push(draftFromEntry(message, fallbackModel, fallbackProvider, fallbackTimestamp));
    }
  }
  finishCurrent();
  return turns;
}

function sumDraftTokens(drafts: readonly DraftTurn[]): CostTokenTotals {
  const totals: CostTokenTotals = { input: 0, output: 0, unattributed: 0 };
  for (const draft of drafts) {
    const measurements = tokenMeasurements(draft.measurements);
    for (const measurement of measurements) {
      totals.input += measurement.inputTokens;
      totals.output += measurement.outputTokens;
      totals.unattributed += measurement.unattributedTokens;
    }
  }
  return totals;
}

function tokenMeasurements(measurements: readonly RawMeasurement[]): RawMeasurement[] {
  const structured = measurements.filter(
    (measurement) => measurement.hasTokenInformation && measurement.tokenSource === 'structured'
  );
  if (structured.length > 0) return structured;
  return measurements.filter((measurement) => measurement.hasTokenInformation);
}

function sessionDrafts(session: Record<string, unknown>): DraftTurn[] {
  const fallbackModel = modelForSession(session);
  const fallbackProvider = providerForSession(session, fallbackModel);
  const fallbackTimestamp = sessionTimestamp(session);
  const entries = measurementArray(session);
  const details =
    entries.length > 0
      ? entries.map((entry) =>
          draftFromEntry(entry, fallbackModel, fallbackProvider, fallbackTimestamp)
        )
      : messageDrafts(session, fallbackModel, fallbackProvider, fallbackTimestamp);

  const rootMeasurement = measurementFromRecord(session);
  const rootHasStoredCost =
    rootMeasurement?.storedCost !== undefined || rootMeasurement?.preEstimatedCost !== undefined;
  const detailsHaveStoredCost = details.some((draft) =>
    draft.measurements.some(
      (measurement) =>
        measurement.storedCost !== undefined || measurement.preEstimatedCost !== undefined
    )
  );
  const detailsHaveMeasurement = details.some((draft) => draft.measurements.length > 0);
  const configuredTurns = explicitTurnCount(session);
  const detailedTurns = details.reduce((sum, draft) => sum + draft.turns, 0);
  const rootHasActivity = Boolean(
    rootMeasurement &&
    ((rootMeasurement.storedCost ?? rootMeasurement.preEstimatedCost ?? 0) > 0 ||
      rootMeasurement.inputTokens +
        rootMeasurement.outputTokens +
        rootMeasurement.unattributedTokens >
        0)
  );
  const inferredTurns =
    configuredTurns ?? (detailedTurns > 0 ? detailedTurns : rootHasActivity ? 1 : 0);

  // A stored session total is authoritative when no finer-grained stored cost
  // exists. This prevents totals and message estimates from being double-counted.
  if (rootMeasurement && rootHasStoredCost && !detailsHaveStoredCost) {
    const detailedTokens = sumDraftTokens(details);
    if (!rootMeasurement.hasTokenInformation && detailsHaveMeasurement) {
      rootMeasurement.inputTokens = detailedTokens.input;
      rootMeasurement.outputTokens = detailedTokens.output;
      rootMeasurement.unattributedTokens = detailedTokens.unattributed;
      rootMeasurement.hasTokenInformation =
        detailedTokens.input + detailedTokens.output + detailedTokens.unattributed > 0;
    }
    return [
      {
        measurements: [rootMeasurement],
        model: rootMeasurement.model ?? fallbackModel,
        provider: rootMeasurement.provider
          ? normalizeProviderName(rootMeasurement.provider)
          : fallbackProvider,
        timestamp: rootMeasurement.timestamp ?? fallbackTimestamp,
        turns: inferredTurns,
      },
    ];
  }

  if (details.length > 0) {
    if (detailsHaveMeasurement || !rootMeasurement) return details;
  }

  if (rootMeasurement) {
    return [
      {
        measurements: [rootMeasurement],
        model: rootMeasurement.model ?? fallbackModel,
        provider: rootMeasurement.provider
          ? normalizeProviderName(rootMeasurement.provider)
          : fallbackProvider,
        timestamp: rootMeasurement.timestamp ?? fallbackTimestamp,
        turns: inferredTurns,
      },
    ];
  }

  if (details.length > 0) return details;

  // Keep a genuinely empty saved session visible in the session count while
  // avoiding an invented turn.
  return [
    {
      measurements: [],
      model: fallbackModel,
      provider: fallbackProvider,
      timestamp: fallbackTimestamp,
      turns: configuredTurns ?? 0,
    },
  ];
}

function validPricing(pricing: CostPricing | undefined): pricing is CostPricing {
  return Boolean(
    pricing &&
    nonNegativeNumber(pricing.inputPerMillion) !== undefined &&
    nonNegativeNumber(pricing.outputPerMillion) !== undefined
  );
}

function normalizeDraft(
  draft: DraftTurn,
  sessionKey: string,
  resolvePricing: CostPricingResolver | undefined
): NormalizedTurn {
  const measurements = tokenMeasurements(draft.measurements);
  let inputTokens = 0;
  let outputTokens = 0;
  let unattributedTokens = 0;
  for (const measurement of measurements) {
    inputTokens += measurement.inputTokens;
    outputTokens += measurement.outputTokens;
    unattributedTokens += measurement.unattributedTokens;
  }

  const storedCosts = draft.measurements
    .map((measurement) => measurement.storedCost)
    .filter((cost): cost is number => cost !== undefined);
  const preEstimatedCosts = draft.measurements
    .map((measurement) => measurement.preEstimatedCost)
    .filter((cost): cost is number => cost !== undefined);
  const hasPersistedCost = storedCosts.length + preEstimatedCosts.length > 0;
  let cost = storedCosts.reduce((sum, value) => sum + value, 0);
  let estimatedCost = preEstimatedCosts.reduce((sum, value) => sum + value, 0);
  let costEstimated = preEstimatedCosts.length > 0;
  let costUnknown = false;

  if (hasPersistedCost) {
    cost += estimatedCost;
  } else {
    const embeddedPricing = draft.measurements.find((measurement) =>
      validPricing(measurement.pricing)
    )?.pricing;
    let pricing = embeddedPricing;
    if (!pricing && resolvePricing) {
      try {
        pricing = resolvePricing(draft.model, draft.provider);
      } catch {
        pricing = undefined;
      }
    }
    const hasDirectionalTokens = measurements.some(
      (measurement) =>
        measurement.hasTokenInformation &&
        (measurement.inputTokens > 0 ||
          measurement.outputTokens > 0 ||
          measurement.unattributedTokens === 0)
    );
    if (validPricing(pricing) && hasDirectionalTokens) {
      estimatedCost =
        (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) /
        1_000_000;
      cost = estimatedCost;
      costEstimated = true;
      costUnknown = unattributedTokens > 0;
    } else {
      costUnknown = true;
    }
  }

  const timestamp = draft.timestamp;
  return {
    sessionKey,
    model: draft.model || UNKNOWN_MODEL,
    provider:
      draft.provider && draft.provider !== UNKNOWN_PROVIDER
        ? normalizeProviderName(draft.provider)
        : inferCostProvider(draft.model),
    day: timestamp ? timestamp.toISOString().slice(0, 10) : UNKNOWN_DAY,
    timestamp,
    cost,
    estimatedCost,
    costEstimated,
    costUnknown,
    inputTokens,
    outputTokens,
    unattributedTokens,
    turns: draft.turns,
  };
}

/**
 * Parse `--since` syntax. `Nd` is a rolling duration; a calendar date starts
 * at midnight UTC so JSON and tests do not depend on the host timezone.
 */
export function parseCostSince(value: string | Date, now: Date = new Date()): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Date `--since` invalide.');
    return new Date(value.getTime());
  }

  const trimmed = value.trim();
  const relative = /^(\d+)d$/i.exec(trimmed);
  if (relative) {
    const days = Number(relative[1]);
    if (!Number.isSafeInteger(days) || days < 1) {
      throw new Error('`--since` doit être une durée positive comme `7d`.');
    }
    return new Date(now.getTime() - days * DAY_MS);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === trimmed) {
      return parsed;
    }
  }
  throw new Error('`--since` doit être une durée comme `7d` ou une date `YYYY-MM-DD`.');
}

function emptyBreakdown(): CostBreakdown {
  return {
    cost: 0,
    tokens: { input: 0, output: 0, unattributed: 0 },
    turns: 0,
    averageCostPerTurn: 0,
    estimatedCost: 0,
    estimatedTurns: 0,
    unknownCostTurns: 0,
  };
}

function addToBreakdown(
  target: Record<string, CostBreakdown>,
  key: string,
  turn: NormalizedTurn
): void {
  const breakdown = target[key] ?? emptyBreakdown();
  breakdown.cost += turn.cost;
  breakdown.tokens.input += turn.inputTokens;
  breakdown.tokens.output += turn.outputTokens;
  breakdown.tokens.unattributed += turn.unattributedTokens;
  breakdown.turns += turn.turns;
  breakdown.estimatedCost += turn.estimatedCost;
  if (turn.costEstimated) breakdown.estimatedTurns += turn.turns;
  if (turn.costUnknown) breakdown.unknownCostTurns += turn.turns;
  target[key] = breakdown;
}

function finalizeBreakdown(
  input: Record<string, CostBreakdown>,
  group: CostGroupBy
): Record<string, CostBreakdown> {
  const entries = Object.entries(input);
  entries.sort(([leftKey, left], [rightKey, right]) => {
    if (group === 'day') return leftKey.localeCompare(rightKey);
    return right.cost - left.cost || leftKey.localeCompare(rightKey);
  });
  for (const [, value] of entries) {
    value.averageCostPerTurn = value.turns > 0 ? value.cost / value.turns : 0;
  }
  return Object.fromEntries(entries);
}

/** Aggregate injected saved-session records into all requested dimensions. */
export function aggregateCostReport(
  entries: readonly CostSessionEntry[],
  options: CostReportOptions = {}
): CostReport {
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Horloge de rapport invalide.');
  const since = options.since ? parseCostSince(options.since, now) : undefined;
  const normalized: NormalizedTurn[] = [];

  entries.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const id = firstString([entry], ['id', 'sessionId', 'session_id']) ?? `session-${index + 1}`;
    const sessionKey = `${id}#${index}`;
    for (const draft of sessionDrafts(entry)) {
      const turn = normalizeDraft(draft, sessionKey, options.resolvePricing);
      if (since && (!turn.timestamp || turn.timestamp.getTime() < since.getTime())) continue;
      normalized.push(turn);
    }
  });

  const byModel: Record<string, CostBreakdown> = {};
  const byProvider: Record<string, CostBreakdown> = {};
  const byDay: Record<string, CostBreakdown> = {};
  const includedSessions = new Set<string>();
  const unknownSessions = new Set<string>();
  const tokens: CostTokenTotals = { input: 0, output: 0, unattributed: 0 };
  let turns = 0;
  let totalCost = 0;
  let estimatedCost = 0;
  let estimatedTurns = 0;
  let unknownCostTurns = 0;

  for (const turn of normalized) {
    includedSessions.add(turn.sessionKey);
    if (turn.costUnknown) unknownSessions.add(turn.sessionKey);
    turns += turn.turns;
    totalCost += turn.cost;
    estimatedCost += turn.estimatedCost;
    if (turn.costEstimated) estimatedTurns += turn.turns;
    if (turn.costUnknown) unknownCostTurns += turn.turns;
    tokens.input += turn.inputTokens;
    tokens.output += turn.outputTokens;
    tokens.unattributed += turn.unattributedTokens;
    addToBreakdown(byModel, turn.model, turn);
    addToBreakdown(byProvider, turn.provider, turn);
    addToBreakdown(byDay, turn.day, turn);
  }

  return {
    generatedAt: now.toISOString(),
    since: since?.toISOString() ?? null,
    sessions: includedSessions.size,
    turns,
    totalCost,
    averageCostPerTurn: turns > 0 ? totalCost / turns : 0,
    tokens,
    estimatedCost,
    estimatedTurns,
    unknownCostSessions: unknownSessions.size,
    unknownCostTurns,
    byModel: finalizeBreakdown(byModel, 'model'),
    byProvider: finalizeBreakdown(byProvider, 'provider'),
    byDay: finalizeBreakdown(byDay, 'day'),
  };
}

/** Backward-friendly descriptive alias for consumers that prefer `build*`. */
export const buildCostReport = aggregateCostReport;
