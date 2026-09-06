/**
 * Provider error classifier — HTTP-aware retry/fatal triage.
 *
 * Problem
 * -------
 * `stream-retry.ts::defaultIsRetryable` only recognised *network* errors
 * (ECONNRESET, socket hang up, …). It was blind to HTTP status codes and,
 * critically, could not tell a **transient** 429 ("slow down, congestion")
 * from a **fatal** 429 ("insufficient_quota" / "exceeded your current quota"
 * / "insufficient balance"). Retrying a fatal quota error is futile — it just
 * re-knocks on a door that is already closed and, on plans with quotas, keeps
 * burning attempts against a dead credential. It also never parsed
 * `Retry-After`, so it ignored the server's explicit back-off instruction.
 *
 * This module classifies an arbitrary provider error into:
 *   - `retryable`  → worth another attempt (transient: 408/425/429/5xx, rate
 *                    limit congestion, network blips)
 *   - `fatal`      → retrying is futile (quota/balance exhausted, auth failure,
 *                    invalid request, model not found)
 *   - `retryAfterMs` → the server-instructed back-off delay, parsed from the
 *                    `Retry-After` / `retry-after-ms` header (seconds OR
 *                    HTTP-date), bounded to a sane max
 *   - `reason`     → a short stable label for logs/metrics
 *
 * It reads whatever the error actually carries: an OpenAI-SDK-shaped error
 * (`.status` + `.headers` + `.code`/`.type`), an axios/got-shaped error
 * (`.response.status` / `.statusCode`), OR — the important fallback — a
 * plain re-wrapped `Error` whose only signal is its message string. When the
 * status/headers were stripped upstream (they are, in
 * `provider-openai-compat.ts`), callers should enrich the wrapper via
 * `preserveProviderErrorMetadata()` at the throw-site so this classifier can
 * still see the numeric status and the parsed Retry-After.
 *
 * Pure, dependency-free, deterministic — trivially testable with fabricated
 * errors (no network).
 */

/** Structured verdict for a provider error. */
export interface ProviderErrorClassification {
  /** Worth retrying (transient). Mutually exclusive with `fatal`. */
  retryable: boolean;
  /** Retrying is futile (quota/auth/invalid). Fail fast. */
  fatal: boolean;
  /**
   * Server-instructed back-off delay in ms, parsed from `Retry-After` /
   * `retry-after-ms`. Bounded to `MAX_RETRY_AFTER_MS`. Undefined when absent.
   */
  retryAfterMs?: number;
  /** Short stable label describing the winning signal (logs/metrics). */
  reason: string;
  /** HTTP status when one could be derived (structured or message-parsed). */
  status?: number;
}

/**
 * Cap for an honoured `Retry-After`. A misbehaving or hostile server could
 * send `Retry-After: 86400`; we never sleep a whole day for one turn.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

function lower(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase() : '';
}

/** Best-effort message extraction across Error / {message} / nested body. */
function getMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const e = err as { message?: unknown; error?: { message?: unknown } };
  const parts: string[] = [];
  if (typeof e.message === 'string') parts.push(e.message);
  if (e.error && typeof e.error === 'object' && typeof e.error.message === 'string') {
    parts.push(e.error.message);
  }
  return parts.join(' ');
}

/** Derive an HTTP status from the many shapes providers/HTTP libs use. */
function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const candidates = [e.status, e.statusCode, e.response?.status];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && /^\d{3}$/.test(c.trim())) return Number(c.trim());
  }
  return undefined;
}

/** Read `.code`/`.type` from the top level or the nested body `.error`. */
function extractField(err: unknown, field: 'code' | 'type'): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as Record<string, unknown> & { error?: Record<string, unknown> };
  const top = e[field];
  if (typeof top === 'string') return top.toLowerCase();
  const nested = e.error && typeof e.error === 'object' ? e.error[field] : undefined;
  return typeof nested === 'string' ? nested.toLowerCase() : '';
}

/**
 * Read a header value across a web `Headers` instance OR a plain
 * (case-insensitive) `Record<string,string>`.
 */
function getHeaderValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const lname = name.toLowerCase();
  const maybeGet = (headers as { get?: unknown }).get;
  if (typeof maybeGet === 'function') {
    try {
      const v = (headers as Headers).get(name);
      return v == null ? undefined : v;
    } catch {
      /* fall through to plain-object scan */
    }
  }
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() === lname && v != null) return String(v);
  }
  return undefined;
}

function clampRetryAfter(ms: number): number {
  return Math.min(Math.max(0, Math.round(ms)), MAX_RETRY_AFTER_MS);
}

/**
 * Parse an HTTP `Retry-After` value into milliseconds.
 *
 * Accepts the two RFC-7231 forms:
 *   - delta-seconds: `"30"` / `30` → 30_000 ms
 *   - HTTP-date:     `"Wed, 21 Oct 2026 07:28:00 GMT"` → (date − now) ms
 *
 * Bounded to `[0, MAX_RETRY_AFTER_MS]`. Returns `undefined` when the value is
 * absent or unparseable. `nowMs` is injectable for deterministic tests.
 */
export function parseRetryAfter(
  value: string | number | undefined | null,
  nowMs: number = Date.now(),
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? clampRetryAfter(value * 1000) : undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // delta-seconds (possibly fractional)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return clampRetryAfter(Number(trimmed) * 1000);
  }
  // HTTP-date
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) {
    return clampRetryAfter(when - nowMs);
  }
  return undefined;
}

/**
 * Pull a back-off delay (ms) out of an error: a pre-parsed numeric field
 * first (set by the throw-site enrichment), then the `retry-after-ms`
 * (milliseconds) and `Retry-After` (seconds/date) headers, then loose body
 * fields (`retry_after` / `retryAfter`).
 */
function extractRetryAfterMs(err: unknown, nowMs: number = Date.now()): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as {
    retryAfterMs?: unknown;
    retryAfter?: unknown;
    retry_after?: unknown;
    headers?: unknown;
    response?: { headers?: unknown };
  };

  // Pre-parsed (enrichment) — already in ms.
  if (typeof e.retryAfterMs === 'number' && Number.isFinite(e.retryAfterMs)) {
    return clampRetryAfter(e.retryAfterMs);
  }

  const headers = e.headers ?? e.response?.headers;
  if (headers) {
    const rawMs = getHeaderValue(headers, 'retry-after-ms');
    if (rawMs !== undefined) {
      const n = Number(rawMs);
      if (Number.isFinite(n)) return clampRetryAfter(n);
    }
    const rawRa = getHeaderValue(headers, 'retry-after');
    const parsed = parseRetryAfter(rawRa, nowMs);
    if (parsed !== undefined) return parsed;
  }

  // Body-level fallbacks (some gateways surface it here). Treated as seconds
  // when numeric, per Retry-After convention.
  const bodyRa = e.retryAfter ?? e.retry_after;
  if (typeof bodyRa === 'number' || typeof bodyRa === 'string') {
    const parsed = parseRetryAfter(bodyRa, nowMs);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

/** Node/undici network-level error — a transient connectivity blip. */
function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; name?: string; message?: string };
  if (typeof e.code === 'string') {
    const code = e.code;
    if (
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'EPIPE' ||
      code === 'UND_ERR_SOCKET'
    ) {
      return true;
    }
  }
  if (typeof e.name === 'string') {
    const name = e.name;
    if (name === 'AbortError' && (e.message ?? '').toLowerCase().includes('network')) return true;
    if (name === 'FetchError' || name === 'NetworkError' || name === 'TimeoutError') return true;
  }
  if (typeof e.message === 'string') {
    const m = e.message.toLowerCase();
    if (m.includes('socket hang up')) return true;
    if (m.includes('terminated') && m.includes('stream')) return true;
    if (m.includes('upstream connect error')) return true;
  }
  return false;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Classify a provider error into a retry/fatal verdict.
 *
 * Precedence: **fatal signals win over transient ones.** A 429 carrying
 * `insufficient_quota` is fatal, not a retryable rate-limit — that's the whole
 * point of the classifier.
 */
export function classifyProviderError(
  err: unknown,
  nowMs: number = Date.now(),
): ProviderErrorClassification {
  if (err === null || err === undefined) {
    return { retryable: false, fatal: false, reason: 'empty-error' };
  }

  const status = extractStatus(err);
  const code = extractField(err, 'code');
  const type = extractField(err, 'type');
  const message = lower(getMessage(err));
  const retryAfterMs = extractRetryAfterMs(err, nowMs);

  const base = { status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };

  // ---- 1. FATAL: quota / balance exhausted -------------------------------
  const hasQuota = message.includes('quota');
  const quotaFatal =
    code === 'insufficient_quota' ||
    type === 'insufficient_quota' ||
    code === 'insufficient_balance' ||
    type === 'insufficient_balance' ||
    code === 'insufficient_funds' ||
    type === 'insufficient_funds' ||
    code === 'usage_limit_reached' ||
    type === 'usage_limit_reached' ||
    message.includes('insufficient_quota') ||
    message.includes('insufficient balance') ||
    message.includes('insufficient funds') ||
    message.includes('exceeded your current quota') ||
    message.includes('exceeded your quota') ||
    message.includes('usage_limit_reached') ||
    message.includes('billing details') ||
    (hasQuota &&
      (message.includes('exceed') || message.includes('insufficient') || message.includes('billing')));
  if (quotaFatal) {
    return { retryable: false, fatal: true, reason: 'quota_exhausted', ...base };
  }

  // ---- 2. FATAL: authentication / authorization --------------------------
  const authFatal =
    status === 401 ||
    status === 403 ||
    code === 'invalid_api_key' ||
    type === 'invalid_api_key' ||
    message.includes('invalid api key') ||
    message.includes('invalid_api_key') ||
    message.includes('incorrect api key') ||
    message.includes('unauthorized') ||
    message.includes('authentication') ||
    message.includes('permission denied') ||
    message.includes('forbidden') ||
    /\b401\b/.test(message) ||
    /\b403\b/.test(message);
  if (authFatal) {
    return { retryable: false, fatal: true, reason: 'auth_failed', ...base };
  }

  // ---- 3. FATAL: invalid request / model not found -----------------------
  const modelFatal =
    code === 'model_not_found' ||
    type === 'model_not_found' ||
    message.includes('model_not_found') ||
    message.includes('model not found') ||
    message.includes('does not exist') ||
    message.includes('unsupported model') ||
    message.includes('invalid model');
  if (modelFatal) {
    return { retryable: false, fatal: true, reason: 'model_not_found', ...base };
  }
  const badRequestFatal =
    status === 400 ||
    status === 404 ||
    status === 422 ||
    message.includes('bad request') ||
    message.includes('invalid request');
  if (badRequestFatal) {
    return { retryable: false, fatal: true, reason: 'invalid_request', ...base };
  }

  // ---- 4. RETRYABLE: transient (only if not fatal above) -----------------
  if (status !== undefined && RETRYABLE_STATUS.has(status)) {
    const reason = status === 429 ? 'rate_limited' : `http_${status}`;
    return { retryable: true, fatal: false, reason, ...base };
  }

  if (
    code === 'rate_limit_exceeded' ||
    type === 'rate_limit_exceeded' ||
    code === 'overloaded_error' ||
    type === 'overloaded_error'
  ) {
    return { retryable: true, fatal: false, reason: 'rate_limited', ...base };
  }

  if (isNetworkError(err)) {
    return { retryable: true, fatal: false, reason: 'network', ...base };
  }

  const msgRetryable =
    /\b(408|425|429|500|502|503|504)\b/.test(message) ||
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('too many requests') ||
    message.includes('overloaded') ||
    message.includes('service unavailable') ||
    message.includes('temporarily unavailable') ||
    message.includes('server error') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout') ||
    message.includes('timeout') ||
    message.includes('timed out');
  if (msgRetryable) {
    return { retryable: true, fatal: false, reason: 'transient', ...base };
  }

  // ---- 5. Unknown → neither retry nor declare fatal ----------------------
  return { retryable: false, fatal: false, reason: 'unclassified', ...base };
}

/**
 * Copy the retry-relevant metadata (status, code, type, parsed Retry-After)
 * from a raw provider/SDK error onto a re-wrapped `Error`, so a downstream
 * classifier still sees the signal after the message-only re-wrap.
 *
 * Call this at any throw-site that replaces the original error with a fresh
 * `new Error(...)`. Never overwrites a value the target already carries.
 * Never throws.
 */
export function preserveProviderErrorMetadata(target: Error, source: unknown): Error {
  try {
    if (!source || typeof source !== 'object') return target;
    const t = target as Error & {
      status?: number;
      code?: string;
      type?: string;
      retryAfterMs?: number;
    };
    const status = extractStatus(source);
    if (status !== undefined && t.status === undefined) t.status = status;

    const code = extractField(source, 'code');
    if (code && t.code === undefined) t.code = code;

    const type = extractField(source, 'type');
    if (type && t.type === undefined) t.type = type;

    const retryAfterMs = extractRetryAfterMs(source);
    if (retryAfterMs !== undefined && t.retryAfterMs === undefined) t.retryAfterMs = retryAfterMs;
  } catch {
    /* enrichment is best-effort — never let it mask the real error */
  }
  return target;
}
