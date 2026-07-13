/**
 * ChatGPT/Codex OAuth model discovery and routing policy.
 *
 * The subscription backend exposes a per-account model catalog at `/models`.
 * Treat that response as the source of truth instead of baking every rollout
 * slug into the provider. The small static policy below is only the offline
 * safety net used when discovery is temporarily unavailable.
 */

import type { ChatGptAuth } from './codex-oauth.js';
import { logger } from '../utils/logger.js';
import { getInstallationId } from '../utils/installation-id.js';

export const CHATGPT_OAUTH_DEFAULT_MODEL = 'gpt-5.6-sol';
export const CHATGPT_OAUTH_API_ALIAS = 'gpt-5.6';
export const CHATGPT_OAUTH_SAFE_FALLBACK_MODEL = 'gpt-5.5';

export const CHATGPT_CODEX_CLIENT_VERSION =
  process.env.CODEBUDDY_CODEX_CLIENT_VERSION?.trim() || '0.144.1';

const MODELS_URL = 'https://chatgpt.com/backend-api/codex/models';
const ORIGINATOR = 'codex_cli_rs';
const MODEL_CATALOG_TIMEOUT_MS = 10_000;
const MAX_MODEL_CATALOG_BYTES = 2 * 1024 * 1024;
const MODEL_CATALOG_TTL_MS = 5 * 60 * 1000;
const MODEL_CATALOG_RETRY_BACKOFF_MS = 30_000;

export type ChatGptReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';

const REASONING_EFFORTS = new Set<ChatGptReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

export interface ChatGptCodexModel {
  slug: string;
  displayName?: string;
  priority: number;
  contextWindow?: number;
  maxContextWindow?: number;
  defaultReasoningEffort?: ChatGptReasoningEffort;
  supportedReasoningEfforts: ChatGptReasoningEffort[];
  useResponsesLite: boolean;
}

export interface ChatGptCodexModelCatalog {
  models: ChatGptCodexModel[];
  etag?: string;
  fetchedAt: number;
}

interface RawModel {
  slug?: unknown;
  display_name?: unknown;
  priority?: unknown;
  visibility?: unknown;
  supported_in_api?: unknown;
  context_window?: unknown;
  max_context_window?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
  use_responses_lite?: unknown;
}

interface RawModelsResponse {
  models?: unknown;
}

export type ChatGptModelCatalogProvider = (
  auth: ChatGptAuth,
) => Promise<ChatGptCodexModelCatalog | null>;

export function normalizeChatGptOAuthModel(model: string): string {
  const trimmed = model.trim();
  return trimmed.toLowerCase() === CHATGPT_OAUTH_API_ALIAS
    ? CHATGPT_OAUTH_DEFAULT_MODEL
    : trimmed;
}

export function isChatGptSubscriptionModel(model: string): boolean {
  const normalized = normalizeChatGptOAuthModel(model).toLowerCase();
  return (
    /^gpt-5(?:[.-]|$)/.test(normalized) ||
    /^o[1-9](?:[.-]|$)/.test(normalized) ||
    normalized.includes('codex')
  );
}

export function findChatGptModel(
  catalog: ChatGptCodexModelCatalog | null | undefined,
  model: string,
): ChatGptCodexModel | undefined {
  const normalized = normalizeChatGptOAuthModel(model).toLowerCase();
  return catalog?.models.find((candidate) => candidate.slug.toLowerCase() === normalized);
}

/**
 * Preserve a compatible user selection. If it is absent from a discovered
 * catalog, prefer Sol and then the account's first list-visible API model.
 */
export function selectChatGptOAuthModel(
  requestedModel: string | undefined,
  catalog?: ChatGptCodexModelCatalog | null,
): string {
  const requested = requestedModel
    ? normalizeChatGptOAuthModel(requestedModel)
    : CHATGPT_OAUTH_DEFAULT_MODEL;

  if (!catalog || catalog.models.length === 0) {
    return isChatGptSubscriptionModel(requested)
      ? requested
      : CHATGPT_OAUTH_DEFAULT_MODEL;
  }

  const requestedMatch = findChatGptModel(catalog, requested);
  if (requestedMatch) return requestedMatch.slug;

  const preferred = findChatGptModel(catalog, CHATGPT_OAUTH_DEFAULT_MODEL);
  return preferred?.slug ?? catalog.models[0]?.slug ?? CHATGPT_OAUTH_SAFE_FALLBACK_MODEL;
}

/**
 * Return account-supported alternatives in backend priority order. Without a
 * catalog we make one conservative retry on gpt-5.5 and stop.
 */
export function getChatGptOAuthFallbackModels(
  currentModel: string,
  catalog?: ChatGptCodexModelCatalog | null,
): string[] {
  const current = normalizeChatGptOAuthModel(currentModel).toLowerCase();
  if (!catalog || catalog.models.length === 0) {
    return current === CHATGPT_OAUTH_SAFE_FALLBACK_MODEL
      ? []
      : [CHATGPT_OAUTH_SAFE_FALLBACK_MODEL];
  }

  return catalog.models
    .map((model) => model.slug)
    .filter((slug) => slug.toLowerCase() !== current);
}

/** Never treat authentication, quota, or transient failures as model errors. */
export function isChatGptModelCompatibilityError(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;

  let code = '';
  let message = body;
  try {
    const parsed = JSON.parse(body) as {
      code?: unknown;
      detail?: unknown;
      message?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    code = String(parsed.error?.code ?? parsed.code ?? '');
    message = String(parsed.error?.message ?? parsed.detail ?? parsed.message ?? body);
  } catch {
    // Plain-text backend errors are still matched below.
  }

  if (/^model_(?:not_found|not_supported)$/i.test(code)) return true;
  return /model/i.test(message) && /(?:not|isn.t).{0,12}(?:supported|available|found)/i.test(message);
}

export function resolveChatGptReasoningEffort(
  requested: string | undefined,
  model: string,
  catalog?: ChatGptCodexModelCatalog | null,
): ChatGptReasoningEffort | undefined {
  const modelInfo = findChatGptModel(catalog, model);
  const normalizedRequested = requested?.trim().toLowerCase() === 'off'
    ? 'none'
    : requested?.trim().toLowerCase();
  const requestedEffort = normalizedRequested && REASONING_EFFORTS.has(
    normalizedRequested as ChatGptReasoningEffort,
  )
    ? normalizedRequested as ChatGptReasoningEffort
    : modelInfo?.defaultReasoningEffort ??
      (/^gpt-5\.6-(?:sol|terra|luna)$/i.test(normalizeChatGptOAuthModel(model))
        ? 'medium'
        : undefined);

  if (!requestedEffort) return undefined;
  const supported = modelInfo?.supportedReasoningEfforts ?? inferReasoningEfforts(model);
  if (supported.length === 0 || supported.includes(requestedEffort)) return requestedEffort;

  const downgradeOrder: ChatGptReasoningEffort[] = [
    'ultra',
    'max',
    'xhigh',
    'high',
    'medium',
    'low',
    'minimal',
    'none',
  ];
  const requestedIndex = downgradeOrder.indexOf(requestedEffort);
  return downgradeOrder.slice(Math.max(0, requestedIndex)).find((effort) => supported.includes(effort))
    ?? supported[0];
}

function inferReasoningEfforts(model: string): ChatGptReasoningEffort[] {
  const normalized = normalizeChatGptOAuthModel(model).toLowerCase();
  if (normalized === 'gpt-5.6-sol' || normalized === 'gpt-5.6-terra') {
    return ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  }
  if (normalized === 'gpt-5.6-luna') {
    return ['low', 'medium', 'high', 'xhigh', 'max'];
  }
  return ['minimal', 'low', 'medium', 'high', 'xhigh'];
}

export function modelUsesResponsesLite(
  model: string,
  catalog?: ChatGptCodexModelCatalog | null,
): boolean {
  const info = findChatGptModel(catalog, model);
  if (info) return info.useResponsesLite;
  return /^gpt-5\.6-(?:sol|terra|luna)$/i.test(normalizeChatGptOAuthModel(model));
}

export function parseChatGptModelCatalog(
  payload: unknown,
  etag?: string,
  fetchedAt = Date.now(),
): ChatGptCodexModelCatalog | null {
  const rawModels = (payload as RawModelsResponse | null)?.models;
  if (!Array.isArray(rawModels)) return null;

  const models = rawModels
    .map(parseModel)
    .filter((model): model is ChatGptCodexModel => model !== null)
    .sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug));

  if (models.length === 0) return null;
  return { models, etag, fetchedAt };
}

function parseModel(raw: unknown): ChatGptCodexModel | null {
  const model = raw as RawModel;
  if (
    typeof model?.slug !== 'string' ||
    model.slug.trim().length === 0 ||
    model.visibility !== 'list' ||
    model.supported_in_api !== true
  ) {
    return null;
  }

  const efforts = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels.flatMap((entry): ChatGptReasoningEffort[] => {
        const effort = typeof entry === 'string'
          ? entry
          : (entry as { effort?: unknown } | null)?.effort;
        return typeof effort === 'string' && REASONING_EFFORTS.has(effort as ChatGptReasoningEffort)
          ? [effort as ChatGptReasoningEffort]
          : [];
      })
    : [];

  const defaultEffort = typeof model.default_reasoning_level === 'string' &&
    REASONING_EFFORTS.has(model.default_reasoning_level as ChatGptReasoningEffort)
    ? model.default_reasoning_level as ChatGptReasoningEffort
    : undefined;

  return {
    slug: model.slug,
    displayName: typeof model.display_name === 'string' ? model.display_name : undefined,
    priority: typeof model.priority === 'number' && Number.isFinite(model.priority)
      ? model.priority
      : Number.MAX_SAFE_INTEGER,
    contextWindow: positiveInteger(model.context_window),
    maxContextWindow: positiveInteger(model.max_context_window),
    defaultReasoningEffort: defaultEffort,
    supportedReasoningEfforts: efforts,
    useResponsesLite: model.use_responses_lite === true,
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export interface ChatGptModelCatalogClientOptions {
  fetchImpl?: typeof fetch;
  clientVersion?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  retryBackoffMs?: number;
}

/** Account-aware, ETag-revalidating client for the Codex `/models` route. */
export class ChatGptModelCatalogClient {
  private readonly fetchImpl: typeof fetch;
  private readonly clientVersion: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly retryBackoffMs: number;
  private cached: ChatGptCodexModelCatalog | null = null;
  private cachedAccountId: string | undefined;
  private inFlightByAccount = new Map<string, Promise<ChatGptCodexModelCatalog | null>>();
  private lastAttemptAtByAccount = new Map<string, number>();

  constructor(opts: ChatGptModelCatalogClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.clientVersion = opts.clientVersion?.trim() || CHATGPT_CODEX_CLIENT_VERSION;
    this.timeoutMs = opts.timeoutMs ?? MODEL_CATALOG_TIMEOUT_MS;
    this.cacheTtlMs = opts.cacheTtlMs ?? MODEL_CATALOG_TTL_MS;
    this.retryBackoffMs = opts.retryBackoffMs ?? MODEL_CATALOG_RETRY_BACKOFF_MS;
  }

  async discover(auth: ChatGptAuth): Promise<ChatGptCodexModelCatalog | null> {
    // Without an account id, avoid sharing an in-flight result across two
    // anonymous auth bundles. The bearer token is deliberately never used as
    // a cache key or retained in memory beyond the request closure.
    if (!auth.account_id) return this.fetchCatalog(auth);

    const existing = this.inFlightByAccount.get(auth.account_id);
    if (existing) return existing;
    const now = Date.now();
    const hasAccountCache = auth.account_id === this.cachedAccountId && this.cached !== null;
    if (hasAccountCache && now - this.cached!.fetchedAt < this.cacheTtlMs) {
      return this.cached;
    }
    const lastAttemptAt = this.lastAttemptAtByAccount.get(auth.account_id) ?? 0;
    if (now - lastAttemptAt < this.retryBackoffMs) {
      return hasAccountCache ? this.cached : null;
    }

    this.lastAttemptAtByAccount.set(auth.account_id, now);
    const pending = this.fetchCatalog(auth).finally(() => {
      this.inFlightByAccount.delete(auth.account_id!);
    });
    this.inFlightByAccount.set(auth.account_id, pending);
    return pending;
  }

  private async fetchCatalog(auth: ChatGptAuth): Promise<ChatGptCodexModelCatalog | null> {
    const canReuseCache = Boolean(auth.account_id && auth.account_id === this.cachedAccountId);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'application/json',
      originator: ORIGINATOR,
      'x-codex-installation-id': getInstallationId(),
      'User-Agent': `codebuddy/${process.env.npm_package_version ?? 'dev'}`,
    };
    if (auth.account_id) headers['ChatGPT-Account-ID'] = auth.account_id;
    if (auth.is_fedramp) headers['X-OpenAI-Fedramp'] = 'true';
    if (canReuseCache && this.cached?.etag) headers['If-None-Match'] = this.cached.etag;

    const url = new URL(MODELS_URL);
    url.searchParams.set('client_version', this.clientVersion);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 304 && canReuseCache && this.cached) {
        this.cached = { ...this.cached, fetchedAt: Date.now() };
        if (auth.account_id) this.lastAttemptAtByAccount.delete(auth.account_id);
        return this.cached;
      }
      if (!response.ok) {
        logger.debug('[chatgpt-models] Model discovery unavailable', { status: response.status });
        return canReuseCache ? this.cached : null;
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_MODEL_CATALOG_BYTES) {
        logger.warn('[chatgpt-models] Ignoring oversized model catalog response');
        return canReuseCache ? this.cached : null;
      }
      const parsed = parseChatGptModelCatalog(
        JSON.parse(text),
        response.headers.get('etag') ?? undefined,
      );
      if (!parsed) {
        logger.warn('[chatgpt-models] Ignoring malformed or empty model catalog response');
        return canReuseCache ? this.cached : null;
      }
      this.cached = parsed;
      this.cachedAccountId = auth.account_id;
      if (auth.account_id) this.lastAttemptAtByAccount.delete(auth.account_id);
      return parsed;
    } catch (error) {
      logger.debug('[chatgpt-models] Model discovery failed; using safe local policy', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return canReuseCache ? this.cached : null;
    }
  }
}

let defaultCatalogClient: ChatGptModelCatalogClient | null = null;

export function discoverChatGptModels(
  auth: ChatGptAuth,
): Promise<ChatGptCodexModelCatalog | null> {
  defaultCatalogClient ??= new ChatGptModelCatalogClient();
  return defaultCatalogClient.discover(auth);
}
