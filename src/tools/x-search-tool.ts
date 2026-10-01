import { getModelForRole } from '../config/model-defaults.js';
import type { ToolResult } from '../types/index.js';

export interface XSearchOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  retries?: number;
  timeoutMs?: number;
  userAgent?: string;
  sleepMs?: (ms: number) => Promise<void>;
}

interface XSearchPayload {
  model: string;
  input: Array<{ role: 'user'; content: string }>;
  tools: Array<Record<string, unknown>>;
  store: false;
}

interface XSearchResult {
  success: true;
  provider: 'xai';
  credential_source: string;
  tool: 'x_search';
  model: string;
  query: string;
  answer: string;
  citations: unknown[];
  inline_citations: InlineCitation[];
  degraded: boolean;
  degraded_reason: string | null;
}

interface InlineCitation {
  url: string;
  title: string;
  start_index?: unknown;
  end_index?: unknown;
}

const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_X_SEARCH_MODEL = getModelForRole('xai', 'search');
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_RETRIES = 2;
const MAX_HANDLES = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function executeXSearch(
  input: Record<string, unknown>,
  options: XSearchOptions = {},
): Promise<ToolResult> {
  const query = optionalString(input, 'query');
  if (!query) {
    return failure('query is required for x_search');
  }

  const credential = resolveXaiCredential(options);
  if (!credential.apiKey) {
    return failure('No xAI credentials available. Set XAI_API_KEY or GROK_API_KEY.');
  }

  const allowed = normalizeHandles(input.allowed_x_handles, 'allowed_x_handles');
  const excluded = normalizeHandles(input.excluded_x_handles, 'excluded_x_handles');
  if (allowed.error) return failure(allowed.error);
  if (excluded.error) return failure(excluded.error);
  if (allowed.handles.length > 0 && excluded.handles.length > 0) {
    return failure('allowed_x_handles and excluded_x_handles cannot be used together');
  }

  const fromDate = optionalString(input, 'from_date') ?? '';
  const toDate = optionalString(input, 'to_date') ?? '';
  const dateError = validateDateRange(fromDate, toDate);
  if (dateError) {
    return failure(dateError);
  }

  const toolDef = buildXSearchToolDef({
    allowed: allowed.handles,
    excluded: excluded.handles,
    fromDate,
    toDate,
    enableImageUnderstanding: coerceBoolean(input.enable_image_understanding),
    enableVideoUnderstanding: coerceBoolean(input.enable_video_understanding),
  });
  const model = options.model
    ?? process.env.CODEBUDDY_X_SEARCH_MODEL
    ?? process.env.X_SEARCH_MODEL
    ?? DEFAULT_X_SEARCH_MODEL;
  const payload: XSearchPayload = {
    model,
    input: [{ role: 'user', content: query }],
    tools: [toolDef],
    store: false,
  };

  try {
    const data = await postResponses(payload, credential, options);
    const answer = extractResponseText(data);
    const citations = Array.isArray(asRecord(data).citations) ? asRecord(data).citations as unknown[] : [];
    const inlineCitations = extractInlineCitations(data);
    const activeFilters = [
      ...(allowed.handles.length > 0 ? ['allowed_x_handles'] : []),
      ...(excluded.handles.length > 0 ? ['excluded_x_handles'] : []),
      ...(fromDate ? ['from_date'] : []),
      ...(toDate ? ['to_date'] : []),
    ];
    const degraded = activeFilters.length > 0 && citations.length === 0 && inlineCitations.length === 0;
    const result: XSearchResult = {
      success: true,
      provider: 'xai',
      credential_source: credential.source,
      tool: 'x_search',
      model,
      query,
      answer,
      citations,
      inline_citations: inlineCitations,
      degraded,
      degraded_reason: degraded
        ? `no citations returned despite filters: ${activeFilters.join(', ')}`
        : null,
    };
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = {
      success: false,
      provider: 'xai',
      tool: 'x_search',
      error: message,
      error_type: error instanceof Error ? error.name : 'Error',
    };
    return {
      success: false,
      error: message,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  }
}

async function postResponses(
  payload: XSearchPayload,
  credential: { apiKey: string; baseUrl: string; source: string },
  options: XSearchOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }
  const retries = Math.max(0, options.retries ?? Number(process.env.CODEBUDDY_X_SEARCH_RETRIES ?? DEFAULT_RETRIES));
  const timeoutMs = Math.max(30_000, options.timeoutMs ?? Number(process.env.CODEBUDDY_X_SEARCH_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
  const userAgent = options.userAgent ?? `Code-Buddy/${process.env.npm_package_version ?? 'dev'}`;
  const sleepMs = options.sleepMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const url = new URL('responses', normalizeBaseUrl(credential.baseUrl));

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credential.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': userAgent,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const text = await response.text();
        const parsed = text ? parseJsonOrText(text) : {};
        if (!response.ok) {
          const message = httpErrorMessage(response.status, parsed);
          if (response.status >= 500 && attempt < retries) {
            lastError = new Error(message);
          } else {
            throw markNonRetryable(new Error(message));
          }
        } else {
          return parsed;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (isNonRetryable(err)) {
        throw err;
      }
      if (err.name === 'AbortError') {
        lastError = new Error(`xAI x_search timed out after ${timeoutMs}ms`);
      } else {
        lastError = err;
      }
      if (attempt >= retries) {
        throw lastError;
      }
    }
    await sleepMs(Math.min(5_000, 1_500 * (attempt + 1)));
  }
  throw lastError ?? new Error('x_search request did not return a response');
}

function buildXSearchToolDef(options: {
  allowed: string[];
  excluded: string[];
  fromDate: string;
  toDate: string;
  enableImageUnderstanding: boolean;
  enableVideoUnderstanding: boolean;
}): Record<string, unknown> {
  return stripNil({
    type: 'x_search',
    allowed_x_handles: options.allowed.length > 0 ? options.allowed : undefined,
    excluded_x_handles: options.excluded.length > 0 ? options.excluded : undefined,
    from_date: options.fromDate || undefined,
    to_date: options.toDate || undefined,
    enable_image_understanding: options.enableImageUnderstanding || undefined,
    enable_video_understanding: options.enableVideoUnderstanding || undefined,
  });
}

function resolveXaiCredential(options: XSearchOptions): { apiKey: string; baseUrl: string; source: string } {
  const apiKey = options.apiKey
    ?? process.env.XAI_API_KEY
    ?? process.env.GROK_API_KEY
    ?? '';
  const source = options.apiKey
    ? 'option'
    : process.env.XAI_API_KEY
      ? 'xai'
      : process.env.GROK_API_KEY
        ? 'grok'
        : 'none';
  const baseUrl = (options.baseUrl
    ?? process.env.XAI_BASE_URL
    ?? process.env.HERMES_XAI_BASE_URL
    ?? process.env.GROK_BASE_URL
    ?? DEFAULT_XAI_BASE_URL).trim().replace(/\/+$/, '');
  return { apiKey: apiKey.trim(), baseUrl, source };
}

function normalizeHandles(value: unknown, fieldName: string): { handles: string[]; error?: string } {
  const handles = asStringList(value).map((handle) => handle.replace(/^@+/, '').trim()).filter(Boolean);
  if (handles.length > MAX_HANDLES) {
    return { handles: [], error: `${fieldName} supports at most ${MAX_HANDLES} handles` };
  }
  return { handles };
}

function validateDateRange(fromDate: string, toDate: string): string | undefined {
  const parsedFrom = fromDate ? parseIsoDate(fromDate, 'from_date') : undefined;
  if (typeof parsedFrom === 'string') return parsedFrom;
  const parsedTo = toDate ? parseIsoDate(toDate, 'to_date') : undefined;
  if (typeof parsedTo === 'string') return parsedTo;
  if (parsedFrom && parsedTo && parsedFrom.getTime() > parsedTo.getTime()) {
    return `from_date (${fromDate}) must be on or before to_date (${toDate})`;
  }
  if (parsedFrom) {
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    if (parsedFrom.getTime() > todayUtc.getTime()) {
      return `from_date (${fromDate}) is in the future; X Search only indexes past posts`;
    }
  }
  return undefined;
}

function parseIsoDate(value: string, fieldName: string): Date | string {
  if (!DATE_RE.test(value)) {
    return `${fieldName} must be YYYY-MM-DD (got '${value}')`;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month! - 1
    || date.getUTCDate() !== day
  ) {
    return `${fieldName} must be YYYY-MM-DD (got '${value}')`;
  }
  return date;
}

function extractResponseText(payload: unknown): string {
  const record = asRecord(payload);
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text.trim();
  }
  const parts: string[] = [];
  for (const item of Array.isArray(record.output) ? record.output : []) {
    const itemRecord = asRecord(item);
    if (itemRecord.type !== 'message') continue;
    for (const content of Array.isArray(itemRecord.content) ? itemRecord.content : []) {
      const contentRecord = asRecord(content);
      if ((contentRecord.type === 'output_text' || contentRecord.type === 'text') && typeof contentRecord.text === 'string') {
        const text = contentRecord.text.trim();
        if (text) parts.push(text);
      }
    }
  }
  return parts.join('\n\n');
}

function extractInlineCitations(payload: unknown): InlineCitation[] {
  const citations: InlineCitation[] = [];
  const record = asRecord(payload);
  for (const item of Array.isArray(record.output) ? record.output : []) {
    const itemRecord = asRecord(item);
    if (itemRecord.type !== 'message') continue;
    for (const content of Array.isArray(itemRecord.content) ? itemRecord.content : []) {
      const contentRecord = asRecord(content);
      for (const annotation of Array.isArray(contentRecord.annotations) ? contentRecord.annotations : []) {
        const annotationRecord = asRecord(annotation);
        if (annotationRecord.type !== 'url_citation') continue;
        citations.push({
          url: typeof annotationRecord.url === 'string' ? annotationRecord.url : '',
          title: typeof annotationRecord.title === 'string' ? annotationRecord.title : '',
          start_index: annotationRecord.start_index,
          end_index: annotationRecord.end_index,
        });
      }
    }
  }
  return citations;
}

function httpErrorMessage(status: number, parsed: unknown): string {
  const record = asRecord(parsed);
  const code = typeof record.code === 'string' ? record.code.trim() : '';
  const error = typeof record.error === 'string' ? record.error.trim() : '';
  const errorRecord = asRecord(record.error);
  const message = error || (typeof errorRecord.message === 'string' ? errorRecord.message : '');
  if (code && message && !message.includes(code)) {
    return `${code}: ${message}`;
  }
  if (message) {
    return message;
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    return parsed.slice(0, 500);
  }
  return `xAI x_search request failed with status ${status}`;
}

function markNonRetryable(error: Error): Error {
  return Object.assign(error, { nonRetryable: true });
}

function isNonRetryable(error: Error): boolean {
  return (error as Error & { nonRetryable?: boolean }).nonRetryable === true;
}

function failure(message: string): ToolResult {
  const data = {
    success: false,
    provider: 'xai',
    tool: 'x_search',
    error: message,
    error_type: 'Error',
  };
  return {
    success: false,
    error: message,
    output: JSON.stringify(data, null, 2),
    data,
  };
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseJsonOrText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stripNil<T extends Record<string, unknown>>(payload: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
