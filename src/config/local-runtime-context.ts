/**
 * Best-effort context discovery for local inference runtimes.
 *
 * Network I/O stays out of `getModelToolConfig()` itself: startup awaits this
 * probe once, then primes the synchronous model-config cache. Every error is a
 * cacheable `null`, so an offline workstation only pays the bounded timeout and
 * keeps the historical fallback.
 */

import { logger } from '../utils/logger.js';
import { cacheRuntimeModelContextWindow } from './model-tools.js';

const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

export type LocalRuntimeKind = 'ollama' | 'lmstudio' | 'vllm';

export interface LocalRuntimeContextInfo {
  runtime: LocalRuntimeKind;
  /** Maximum encoded in model metadata, when the runtime exposes it. */
  advertisedContextWindow?: number;
  /** Lower load-time limit (KV cache / max_model_len), when observable. */
  servedContextWindow?: number;
  /** Safe value cached by Code Buddy: min(advertised, served) when both exist. */
  contextWindow: number;
}

export interface LocalRuntimeContextProbeOptions {
  model: string;
  baseURL?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  runtimeHint?: LocalRuntimeKind;
}

interface JsonResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

const probeCache = new Map<string, Promise<LocalRuntimeContextInfo | null>>();

function positiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sameModel(left: unknown, right: string): boolean {
  if (typeof left !== 'string') return false;
  const normalize = (value: string): string => value.trim().toLowerCase().replace(/:latest$/, '');
  return normalize(left) === normalize(right);
}

function minPositive(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => value !== null && value !== undefined);
  return usable.length > 0 ? Math.min(...usable) : null;
}

function collectNumericFields(
  value: unknown,
  matches: (key: string) => boolean,
  output: number[] = [],
): number[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectNumericFields(entry, matches, output);
    return output;
  }
  const record = asRecord(value);
  if (!record) return output;
  for (const [key, entry] of Object.entries(record)) {
    const parsed = positiveInteger(entry);
    if (parsed !== null && matches(key)) output.push(parsed);
    if (entry !== null && typeof entry === 'object') collectNumericFields(entry, matches, output);
  }
  return output;
}

function normalizeRuntimeURL(baseURL: string | undefined): URL | null {
  const raw = baseURL?.trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
}

function runtimeRoot(url: URL): string {
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(?:api\/)?v\d+$/i, '');
  return `${url.origin}${path}`.replace(/\/+$/, '');
}

function endpoint(root: string, path: string): string {
  return `${root}${path.startsWith('/') ? path : `/${path}`}`;
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b !== undefined && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b !== undefined && b >= 64 && b <= 127);
}

function configuredLocalHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const name of [
    'OLLAMA_HOST',
    'LMSTUDIO_BASE_URL',
    'LM_STUDIO_BASE_URL',
    'CODEBUDDY_LMSTUDIO_BASE_URL',
    'VLLM_BASE_URL',
  ]) {
    const parsed = normalizeRuntimeURL(process.env[name]);
    if (parsed) hosts.add(parsed.host.toLowerCase());
  }
  return hosts;
}

/** Limit probing to loopback/LAN/Tailscale hosts or explicitly configured runtimes. */
export function isLocalRuntimeURL(baseURL: string | undefined): boolean {
  const url = normalizeRuntimeURL(baseURL);
  if (!url || !['http:', 'https:'].includes(url.protocol)) return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return configuredLocalHosts().has(url.host.toLowerCase())
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.lan')
    || !hostname.includes('.')
    || isPrivateIPv4(hostname)
    || hostname === '::1'
    || hostname.startsWith('fc')
    || hostname.startsWith('fd')
    || hostname.startsWith('fe80:');
}

function runtimeHintFromURL(url: URL): LocalRuntimeKind | null {
  const host = url.host.toLowerCase();
  const matchesEnv = (names: string[]): boolean => names.some((name) => {
    const configured = normalizeRuntimeURL(process.env[name]);
    return configured?.host.toLowerCase() === host;
  });
  if (url.port === '11434' || matchesEnv(['OLLAMA_HOST'])) return 'ollama';
  if (url.port === '1234' || matchesEnv([
    'LMSTUDIO_BASE_URL',
    'LM_STUDIO_BASE_URL',
    'CODEBUDDY_LMSTUDIO_BASE_URL',
  ])) return 'lmstudio';
  if (matchesEnv(['VLLM_BASE_URL'])) return 'vllm';
  return null;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal }) as JsonResponse;
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseNumCtx(parameters: unknown): number | null {
  if (typeof parameters !== 'string') return null;
  const match = parameters.match(/^\s*num_ctx\s+(\d+)\s*$/im);
  return match?.[1] ? positiveInteger(Number(match[1])) : null;
}

function ollamaAdvertisedContext(show: unknown): number | null {
  const modelInfo = asRecord(asRecord(show)?.model_info);
  if (!modelInfo) return null;
  // GGUF prefixes this field with `general.architecture` (qwen35, llama,
  // qwen35moe, ...). Searching the suffix handles future families without a
  // hard-coded architecture list.
  return minPositive(Object.entries(modelInfo)
    .filter(([key]) => key.endsWith('.context_length'))
    .map(([, value]) => positiveInteger(value)));
}

function ollamaLoadedContext(ps: unknown, model: string): number | null {
  const models = asRecord(ps)?.models;
  if (!Array.isArray(models)) return null;
  const loaded = models.find((entry) => {
    const record = asRecord(entry);
    return record && (sameModel(record.name, model) || sameModel(record.model, model));
  });
  const record = asRecord(loaded);
  return positiveInteger(record?.context_length) ?? positiveInteger(record?.num_ctx);
}

async function probeOllama(
  root: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<LocalRuntimeContextInfo | null> {
  const show = await fetchJson(fetchImpl, endpoint(root, '/api/show'), timeoutMs, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: model }),
  });
  const advertisedContextWindow = ollamaAdvertisedContext(show);
  if (advertisedContextWindow === null) return null;

  const ps = await fetchJson(fetchImpl, endpoint(root, '/api/ps'), timeoutMs);
  const showRecord = asRecord(show);
  const servedContextWindow = minPositive([
    parseNumCtx(showRecord?.parameters),
    ollamaLoadedContext(ps, model),
  ]);
  return {
    runtime: 'ollama',
    advertisedContextWindow,
    ...(servedContextWindow === null ? {} : { servedContextWindow }),
    contextWindow: Math.min(advertisedContextWindow, servedContextWindow ?? advertisedContextWindow),
  };
}

function responseModels(value: unknown): unknown[] {
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.models)) return record.models;
  return [];
}

function findModelRecord(value: unknown, model: string): Record<string, unknown> | null {
  const candidates = responseModels(value).map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null);
  return candidates.find((entry) => sameModel(entry.id, model)
    || sameModel(entry.key, model)
    || sameModel(entry.model, model)
    || sameModel(entry.model_key, model)
    || sameModel(entry.modelKey, model)
    || (Array.isArray(entry.loaded_instances) && entry.loaded_instances.some((instance) =>
      sameModel(asRecord(instance)?.id, model)))) ?? null;
}

function advertisedContext(record: Record<string, unknown> | null): number | null {
  if (!record) return null;
  return minPositive([
    positiveInteger(record.max_context_length),
    positiveInteger(record.maxContextLength),
    positiveInteger(record.model_max_length),
  ]);
}

function servedContext(record: Record<string, unknown> | null): number | null {
  if (!record) return null;
  return minPositive(collectNumericFields(record, (key) =>
    key === 'context_length' || key === 'loaded_context_length'));
}

function bearerHeaders(apiKey: string | undefined): HeadersInit | undefined {
  const key = apiKey?.trim();
  if (!key || ['ollama', 'lmstudio', 'local'].includes(key.toLowerCase())) return undefined;
  return { authorization: `Bearer ${key}` };
}

async function probeLMStudio(
  root: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  apiKey: string | undefined,
): Promise<LocalRuntimeContextInfo | null> {
  const init = { headers: bearerHeaders(apiKey) };
  const [v1, v0] = await Promise.all([
    fetchJson(fetchImpl, endpoint(root, '/api/v1/models'), timeoutMs, init),
    fetchJson(fetchImpl, endpoint(root, '/api/v0/models'), timeoutMs, init),
  ]);
  const record = findModelRecord(v1, model) ?? findModelRecord(v0, model);
  const advertisedContextWindow = advertisedContext(record);
  const servedContextWindow = servedContext(record);
  const contextWindow = minPositive([advertisedContextWindow, servedContextWindow]);
  if (contextWindow === null) return null;
  return {
    runtime: 'lmstudio',
    ...(advertisedContextWindow === null ? {} : { advertisedContextWindow }),
    ...(servedContextWindow === null ? {} : { servedContextWindow }),
    contextWindow,
  };
}

async function probeVllm(
  root: string,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  apiKey: string | undefined,
): Promise<LocalRuntimeContextInfo | null> {
  const init = { headers: bearerHeaders(apiKey) };
  const [models, serverInfo] = await Promise.all([
    fetchJson(fetchImpl, endpoint(root, '/v1/models'), timeoutMs, init),
    fetchJson(fetchImpl, endpoint(root, '/server_info?config_format=json'), timeoutMs),
  ]);
  const record = findModelRecord(models, model);
  if (!record) return null;
  const modelRecordLimit = minPositive([
    advertisedContext(record),
    servedContext(record),
    ...collectNumericFields(record, (key) => key === 'max_model_len'),
  ]);
  const serverLimit = minPositive(collectNumericFields(serverInfo, (key) => key === 'max_model_len'));
  const contextWindow = minPositive([modelRecordLimit, serverLimit]);
  if (contextWindow === null) return null;
  return {
    runtime: 'vllm',
    servedContextWindow: contextWindow,
    contextWindow,
  };
}

/** Probe metadata without mutating the synchronous model-config cache. */
export async function probeLocalRuntimeContext(
  options: LocalRuntimeContextProbeOptions,
): Promise<LocalRuntimeContextInfo | null> {
  const url = normalizeRuntimeURL(options.baseURL);
  if (!url || !options.model.trim() || !isLocalRuntimeURL(options.baseURL)) return null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const root = runtimeRoot(url);
  const hint = options.runtimeHint ?? runtimeHintFromURL(url);

  if (hint === 'ollama') return probeOllama(root, options.model, fetchImpl, timeoutMs);
  if (hint === 'lmstudio') {
    return probeLMStudio(root, options.model, fetchImpl, timeoutMs, options.apiKey);
  }
  if (hint === 'vllm') return probeVllm(root, options.model, fetchImpl, timeoutMs, options.apiKey);

  // Unknown local OpenAI-compatible endpoint: probes run concurrently so a
  // powered-off or unfamiliar runtime costs at most one bounded timeout.
  const results = await Promise.all([
    probeOllama(root, options.model, fetchImpl, timeoutMs),
    probeLMStudio(root, options.model, fetchImpl, timeoutMs, options.apiKey),
    probeVllm(root, options.model, fetchImpl, timeoutMs, options.apiKey),
  ]);
  return results.find((result) => result !== null) ?? null;
}

/** Probe once per runtime/model and prime `getModelToolConfig()` on success. */
export async function primeLocalRuntimeModelConfig(
  options: LocalRuntimeContextProbeOptions,
): Promise<LocalRuntimeContextInfo | null> {
  const url = normalizeRuntimeURL(options.baseURL);
  if (!url || !isLocalRuntimeURL(options.baseURL) || !options.model.trim()) return null;
  const cacheKey = `${url.origin}${url.pathname}|${options.model.trim().toLowerCase()}`;
  let pending = probeCache.get(cacheKey);
  if (!pending) {
    pending = probeLocalRuntimeContext(options);
    probeCache.set(cacheKey, pending);
  }
  const info = await pending;
  if (info) {
    cacheRuntimeModelContextWindow(options.model, info.contextWindow);
    logger.debug('Local runtime context detected', {
      model: options.model,
      runtime: info.runtime,
      advertised: info.advertisedContextWindow,
      served: info.servedContextWindow,
      effective: info.contextWindow,
    });
  }
  return info;
}

/** Test seam: a new startup may probe the same runtime/model again. */
export function resetLocalRuntimeContextProbeCache(): void {
  probeCache.clear();
}
