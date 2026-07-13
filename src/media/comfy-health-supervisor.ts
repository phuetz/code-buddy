/**
 * ComfyUI health supervisor.
 *
 * This module is deliberately separate from media generation. It only observes
 * a loopback ComfyUI server and returns a restart decision; it never starts,
 * stops, interrupts, or restarts a process.
 *
 * Security properties:
 * - the configured origin must be HTTP(S) loopback and contain no credentials,
 *   path, query, or fragment;
 * - redirects are disabled and a mocked/misbehaving transport cannot return a
 *   response from another origin unnoticed;
 * - every request and response body is bounded;
 * - runtime errors are supplied explicitly, bounded, and secret-redacted. No
 *   log file is ever opened by this module;
 * - `restartAllowed` requires an unforgeable in-memory capability issued by a
 *   private ownership authority held by the process launcher.
 */

import { createHash } from 'crypto';
import { isLoopbackHost } from '../security/dev-origins.js';
import { scrubSecrets } from '../security/secret-scrubber.js';

export type ComfyHealthState = 'healthy' | 'degraded' | 'poisoned' | 'unreachable';
export type ComfyProbeEndpoint = 'queue' | 'system_stats' | 'object_info';

export type ComfyProbeErrorCode =
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_response'
  | 'response_too_large'
  | 'response_origin_rejected';

export type ComfyHealthIssueCode =
  | 'probe_failed'
  | 'queue_stale'
  | 'zero_byte_model'
  | 'invalid_model_inventory'
  | 'runtime_error'
  | 'runtime_accelerator_poisoned';

export interface ComfyEndpointProbe {
  endpoint: ComfyProbeEndpoint;
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
  errorCode?: ComfyProbeErrorCode;
  error?: string;
}

export interface ComfyHealthIssue {
  code: ComfyHealthIssueCode;
  severity: 'warning' | 'critical';
  message: string;
  endpoint?: ComfyProbeEndpoint;
}

/**
 * Inventory observations are supplied by the trusted runtime that already
 * knows the configured ComfyUI model root. Paths must be relative: the health
 * report must not become an arbitrary filesystem scanner or leak home paths.
 */
export interface ComfyModelFileSnapshot {
  relativePath: string;
  sizeBytes: number;
  kind?: 'file' | 'directory';
}

export interface ComfyQueueSnapshot {
  /** SHA-256 digest; prompt text and prompt IDs are never exposed. */
  fingerprint: string;
  runningCount: number;
  pendingCount: number;
  observedAtMs: number;
  unchangedSinceMs: number;
}

export interface ComfyQueueHealth {
  runningCount: number;
  pendingCount: number;
  stale: boolean;
  staleForMs: number;
}

export interface ComfyHealthReport {
  state: ComfyHealthState;
  checkedAt: string;
  baseOrigin: string;
  probes: ComfyEndpointProbe[];
  issues: ComfyHealthIssue[];
  queue: ComfyQueueHealth | null;
  queueSnapshot?: ComfyQueueSnapshot;
  nodeCount: number | null;
  zeroByteModels: string[];
  zeroByteModelCount: number;
  runtimeErrorCount: number;
  poisonDetected: boolean;
  restartRecommended: boolean;
  restartAllowed: boolean;
  ownershipVerified: boolean;
}

/** Opaque, non-serializable proof. Only an authority can verify it. */
declare const COMFY_PROCESS_OWNERSHIP_PROOF: unique symbol;
export interface ComfyProcessOwnershipProof {
  readonly [COMFY_PROCESS_OWNERSHIP_PROOF]: true;
}

export interface ComfyProcessOwnershipAuthority {
  issue(processInstanceId: string): ComfyProcessOwnershipProof;
  verify(processInstanceId: string, proof: unknown): boolean;
  revoke(proof: unknown): void;
}

export interface ComfyHealthOwnershipClaim {
  processInstanceId: string;
  proof: unknown;
}

export interface ComfyHealthCheckInput {
  previousQueueSnapshot?: ComfyQueueSnapshot | null;
  /** WebSocket progress/node marker. A changed marker resets stale detection. */
  progressMarker?: string;
  /** Bounded Error/string values supplied by the process runtime, never logs. */
  runtimeErrors?: readonly unknown[];
  /** Trusted inventory observations relative to the ComfyUI model root. */
  modelFiles?: readonly ComfyModelFileSnapshot[];
  ownership?: ComfyHealthOwnershipClaim;
}

export interface ComfyHealthSupervisorOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  staleQueueAfterMs?: number;
  maxResponseBytes?: number;
  now?: () => number;
  ownershipAuthority?: Pick<ComfyProcessOwnershipAuthority, 'verify'>;
}

interface NormalizedOptions {
  baseUrl: URL;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
  staleQueueAfterMs: number;
  maxResponseBytes: number;
  now: () => number;
  ownershipAuthority?: Pick<ComfyProcessOwnershipAuthority, 'verify'>;
}

interface InternalProbeResult {
  probe: ComfyEndpointProbe;
  data?: unknown;
}

interface QueueObservation {
  runningIds: string[];
  pendingIds: string[];
}

interface ModelInventoryResult {
  zeroByteModels: string[];
  zeroByteModelCount: number;
  invalidCount: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_STALE_QUEUE_MS = 10 * 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RUNTIME_ERRORS = 16;
const MAX_RUNTIME_ERROR_INPUT_CHARS = 4_096;
const MAX_DIAGNOSTIC_CHARS = 320;
const MAX_MODEL_OBSERVATIONS = 100_000;
const MAX_ZERO_BYTE_PATHS = 64;

const ENDPOINT_PATHS: Record<ComfyProbeEndpoint, string> = {
  queue: '/queue',
  system_stats: '/system_stats',
  object_info: '/object_info',
};

const MODEL_FILE_EXTENSION = /\.(?:safetensors|gguf|ckpt|pt|pth|bin|onnx|engine)$/i;

const POISON_PATTERNS: RegExp[] = [
  /hipErrorIllegalAddress/i,
  /CUDA error:\s*(?:an\s+)?illegal memory access/i,
  /torch\.AcceleratorError[^\r\n]{0,160}illegal memory access/i,
  /ROCm[^\r\n]{0,160}illegal memory/i,
  /HIP(?:\s+runtime)?\s+error[^\r\n]{0,160}illegal/i,
  /device-side assert/i,
  /HSA_STATUS_ERROR_EXCEPTION/i,
];

class ProbeTimeoutError extends Error {}
class ProbeResponseTooLargeError extends Error {}
class ProbeResponseOriginError extends Error {}
class ProbeInvalidResponseError extends Error {}

export class ComfyHealthConfigurationError extends Error {
  readonly code = 'COMFY_HEALTH_INVALID_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'ComfyHealthConfigurationError';
  }
}

/**
 * Create a capability authority for the component that launches ComfyUI.
 * Keep the authority private to that launcher and give the supervisor only its
 * `verify` method. Proofs contain no serializable data and cannot survive a JSON
 * round trip.
 */
export function createComfyProcessOwnershipAuthority(): ComfyProcessOwnershipAuthority {
  const issued = new WeakMap<object, string>();

  return Object.freeze({
    issue(processInstanceId: string): ComfyProcessOwnershipProof {
      const normalized = normalizeProcessInstanceId(processInstanceId);
      const proof = Object.freeze(Object.create(null) as object);
      issued.set(proof, normalized);
      return proof as ComfyProcessOwnershipProof;
    },
    verify(processInstanceId: string, proof: unknown): boolean {
      if (!isObjectLike(proof)) return false;
      let normalized: string;
      try {
        normalized = normalizeProcessInstanceId(processInstanceId);
      } catch {
        return false;
      }
      return issued.get(proof) === normalized;
    },
    revoke(proof: unknown): void {
      if (isObjectLike(proof)) issued.delete(proof);
    },
  });
}

/**
 * Stateful convenience wrapper. Queue snapshots remain in memory only and can
 * also be supplied explicitly through `diagnoseComfyHealth` for persistence or
 * deterministic tests.
 */
export class ComfyHealthSupervisor {
  private readonly options: ComfyHealthSupervisorOptions;
  private queueSnapshot: ComfyQueueSnapshot | null = null;

  constructor(options: ComfyHealthSupervisorOptions = {}) {
    // Validate before storing so an unsafe URL never reaches a later fetch.
    normalizeOptions(options);
    this.options = { ...options };
  }

  async probe(input: Omit<ComfyHealthCheckInput, 'previousQueueSnapshot'> = {}): Promise<ComfyHealthReport> {
    const report = await diagnoseComfyHealth(this.options, {
      ...input,
      previousQueueSnapshot: this.queueSnapshot,
    });
    if (report.queueSnapshot) this.queueSnapshot = report.queueSnapshot;
    return report;
  }

  resetQueueSnapshot(): void {
    this.queueSnapshot = null;
  }
}

export async function diagnoseComfyHealth(
  options: ComfyHealthSupervisorOptions = {},
  input: ComfyHealthCheckInput = {},
): Promise<ComfyHealthReport> {
  const normalized = normalizeOptions(options);
  const checkedAtMs = safeNow(normalized.now);

  const endpointResults = await Promise.all(
    (Object.keys(ENDPOINT_PATHS) as ComfyProbeEndpoint[]).map((endpoint) =>
      probeEndpoint(normalized, endpoint),
    ),
  );

  const issues: ComfyHealthIssue[] = [];
  for (const result of endpointResults) {
    if (!result.probe.ok) {
      issues.push({
        code: 'probe_failed',
        severity: 'warning',
        endpoint: result.probe.endpoint,
        message: `${result.probe.endpoint} probe failed: ${result.probe.error ?? 'unknown error'}`,
      });
    }
  }

  const byEndpoint = new Map(endpointResults.map((result) => [result.probe.endpoint, result]));
  const queueResult = byEndpoint.get('queue');
  const objectInfoResult = byEndpoint.get('object_info');

  let queue: ComfyQueueHealth | null = null;
  let queueSnapshot: ComfyQueueSnapshot | undefined;
  if (queueResult?.probe.ok) {
    const observation = parseQueueObservation(queueResult.data);
    if (observation) {
      const evaluated = evaluateQueueSnapshot({
        observation,
        nowMs: checkedAtMs,
        staleAfterMs: normalized.staleQueueAfterMs,
        previous: input.previousQueueSnapshot,
        progressMarker: input.progressMarker,
      });
      queue = evaluated.health;
      queueSnapshot = evaluated.snapshot;
      if (queue.stale) {
        issues.push({
          code: 'queue_stale',
          severity: 'warning',
          endpoint: 'queue',
          message: `ComfyUI queue has not changed for ${queue.staleForMs}ms`,
        });
      }
    }
  }

  const nodeCount = objectInfoResult?.probe.ok && isPlainRecord(objectInfoResult.data)
    ? Object.keys(objectInfoResult.data).length
    : null;

  const inventory = findZeroByteComfyModels(input.modelFiles ?? []);
  if (inventory.invalidCount > 0) {
    issues.push({
      code: 'invalid_model_inventory',
      severity: 'warning',
      message: `${inventory.invalidCount} invalid model inventory entr${inventory.invalidCount === 1 ? 'y was' : 'ies were'} ignored`,
    });
  }
  if (inventory.zeroByteModelCount > 0) {
    issues.push({
      code: 'zero_byte_model',
      severity: 'warning',
      message: `${inventory.zeroByteModelCount} zero-byte model file${inventory.zeroByteModelCount === 1 ? '' : 's'} detected`,
    });
  }

  const runtime = evaluateRuntimeErrors(input.runtimeErrors ?? []);
  issues.push(...runtime.issues);

  const probes = endpointResults.map((result) => result.probe);
  const allUnreachable = probes.every((probe) => !probe.ok);
  const state: ComfyHealthState = runtime.poisonDetected
    ? 'poisoned'
    : allUnreachable
      ? 'unreachable'
      : issues.length > 0
        ? 'degraded'
        : 'healthy';

  const ownershipVerified = verifyOwnership(normalized.ownershipAuthority, input.ownership);
  const restartRecommended = state === 'poisoned' || state === 'unreachable';

  return {
    state,
    checkedAt: new Date(checkedAtMs).toISOString(),
    baseOrigin: normalized.baseUrl.origin,
    probes,
    issues: issues.slice(0, 64).map(sanitizeIssue),
    queue,
    ...(queueSnapshot ? { queueSnapshot } : {}),
    nodeCount,
    zeroByteModels: inventory.zeroByteModels,
    zeroByteModelCount: inventory.zeroByteModelCount,
    runtimeErrorCount: runtime.errorCount,
    poisonDetected: runtime.poisonDetected,
    restartRecommended,
    restartAllowed: restartRecommended && ownershipVerified,
    ownershipVerified,
  };
}

/** Pure helper used by trusted inventory collectors and tests. */
export function findZeroByteComfyModels(
  snapshots: readonly ComfyModelFileSnapshot[],
): ModelInventoryResult {
  const zeroByte = new Set<string>();
  let invalidCount = 0;
  const limit = Math.min(snapshots.length, MAX_MODEL_OBSERVATIONS);
  if (snapshots.length > MAX_MODEL_OBSERVATIONS) {
    invalidCount += snapshots.length - MAX_MODEL_OBSERVATIONS;
  }

  for (let index = 0; index < limit; index++) {
    const snapshot = snapshots[index];
    if (!snapshot || snapshot.kind === 'directory') continue;
    const relativePath = normalizeModelRelativePath(snapshot.relativePath);
    if (!relativePath || !Number.isFinite(snapshot.sizeBytes) || snapshot.sizeBytes < 0) {
      invalidCount++;
      continue;
    }
    if (snapshot.sizeBytes === 0 && MODEL_FILE_EXTENSION.test(relativePath)) {
      zeroByte.add(sanitizeDiagnostic(relativePath, 240));
    }
  }

  const all = [...zeroByte].sort();
  return {
    zeroByteModels: all.slice(0, MAX_ZERO_BYTE_PATHS),
    zeroByteModelCount: all.length,
    invalidCount,
  };
}

function normalizeOptions(options: ComfyHealthSupervisorOptions): NormalizedOptions {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ComfyHealthConfigurationError('A fetch implementation is required');
  }

  return {
    baseUrl,
    fetchImpl,
    requestTimeoutMs: validateBoundedInteger(
      options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      'requestTimeoutMs',
      10,
      60_000,
    ),
    staleQueueAfterMs: validateBoundedInteger(
      options.staleQueueAfterMs ?? DEFAULT_STALE_QUEUE_MS,
      'staleQueueAfterMs',
      100,
      24 * 60 * 60_000,
    ),
    maxResponseBytes: validateBoundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      'maxResponseBytes',
      1_024,
      32 * 1024 * 1024,
    ),
    now: options.now ?? Date.now,
    ...(options.ownershipAuthority ? { ownershipAuthority: options.ownershipAuthority } : {}),
  };
}

function normalizeBaseUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ComfyHealthConfigurationError('ComfyUI base URL must be a valid loopback HTTP(S) origin');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ComfyHealthConfigurationError('ComfyUI base URL must use HTTP(S)');
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new ComfyHealthConfigurationError('ComfyUI health probes are restricted to loopback hosts');
  }
  if (parsed.username || parsed.password) {
    throw new ComfyHealthConfigurationError('ComfyUI base URL must not contain credentials');
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new ComfyHealthConfigurationError('ComfyUI base URL must be an origin without path, query, or fragment');
  }
  return new URL(parsed.origin);
}

function validateBoundedInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ComfyHealthConfigurationError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

async function probeEndpoint(
  options: NormalizedOptions,
  endpoint: ComfyProbeEndpoint,
): Promise<InternalProbeResult> {
  const startedAt = safeNow(options.now);
  const url = new URL(ENDPOINT_PATHS[endpoint], options.baseUrl);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ProbeTimeoutError(`Timed out after ${options.requestTimeoutMs}ms`));
    }, options.requestTimeoutMs);
    if (typeof timeout === 'object' && timeout !== null && 'unref' in timeout) timeout.unref();
  });

  const request = (async (): Promise<InternalProbeResult> => {
    const response = await options.fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
    assertResponseOrigin(response, options.baseUrl);
    if (!response.ok) {
      return {
        probe: {
          endpoint,
          ok: false,
          latencyMs: elapsedMs(startedAt, options.now),
          statusCode: response.status,
          errorCode: 'http_error',
          error: `HTTP ${response.status}`,
        },
      };
    }

    const body = await readBoundedResponse(response, options.maxResponseBytes);
    let data: unknown;
    try {
      data = JSON.parse(body) as unknown;
    } catch {
      throw new ProbeInvalidResponseError('Response was not valid JSON');
    }
    validateEndpointPayload(endpoint, data);
    return {
      probe: {
        endpoint,
        ok: true,
        latencyMs: elapsedMs(startedAt, options.now),
        statusCode: response.status,
      },
      data,
    };
  })();

  try {
    return await Promise.race([request, timeoutPromise]);
  } catch (error) {
    return {
      probe: {
        endpoint,
        ok: false,
        latencyMs: elapsedMs(startedAt, options.now),
        errorCode: classifyProbeError(error),
        error: probeErrorMessage(error, options.requestTimeoutMs),
      },
    };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function assertResponseOrigin(response: Response, expectedBase: URL): void {
  if (!response.url) return;
  let actual: URL;
  try {
    actual = new URL(response.url);
  } catch {
    throw new ProbeResponseOriginError('Response origin was invalid');
  }
  if (
    (actual.protocol !== 'http:' && actual.protocol !== 'https:')
    || !isLoopbackHost(actual.hostname)
    || actual.origin !== expectedBase.origin
  ) {
    throw new ProbeResponseOriginError('Response origin did not match the configured loopback origin');
  }
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new ProbeResponseTooLargeError(`Response exceeded ${maxBytes} bytes`);
    }
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel('response too large');
        throw new ProbeResponseTooLargeError(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

function validateEndpointPayload(endpoint: ComfyProbeEndpoint, data: unknown): void {
  if (!isPlainRecord(data)) {
    throw new ProbeInvalidResponseError(`${endpoint} response must be an object`);
  }
  if (endpoint === 'queue') {
    if (!Array.isArray(data.queue_running) || !Array.isArray(data.queue_pending)) {
      throw new ProbeInvalidResponseError('queue response is missing queue arrays');
    }
    if (![...data.queue_running, ...data.queue_pending].every(Array.isArray)) {
      throw new ProbeInvalidResponseError('queue response contains invalid entries');
    }
  } else if (Object.keys(data).length === 0) {
    throw new ProbeInvalidResponseError(`${endpoint} response was empty`);
  }
}

function parseQueueObservation(data: unknown): QueueObservation | null {
  if (!isPlainRecord(data) || !Array.isArray(data.queue_running) || !Array.isArray(data.queue_pending)) {
    return null;
  }
  return {
    runningIds: queueEntryIds(data.queue_running),
    pendingIds: queueEntryIds(data.queue_pending),
  };
}

function queueEntryIds(entries: unknown[]): string[] {
  return entries.map((entry, index) => {
    if (Array.isArray(entry) && typeof entry[1] === 'string' && entry[1].length > 0) {
      return entry[1].slice(0, 512);
    }
    return `anonymous-entry-${index}`;
  });
}

function evaluateQueueSnapshot(options: {
  observation: QueueObservation;
  nowMs: number;
  staleAfterMs: number;
  previous?: ComfyQueueSnapshot | null;
  progressMarker?: string;
}): { snapshot: ComfyQueueSnapshot; health: ComfyQueueHealth } {
  const fingerprint = queueFingerprint(options.observation, options.progressMarker);
  const previous = validQueueSnapshot(options.previous) ? options.previous : null;
  const activeCount = options.observation.runningIds.length + options.observation.pendingIds.length;
  const unchanged = previous !== null
    && previous.fingerprint === fingerprint
    && options.nowMs >= previous.observedAtMs;
  const unchangedSinceMs = activeCount > 0 && unchanged
    ? Math.min(previous.unchangedSinceMs, options.nowMs)
    : options.nowMs;
  const staleForMs = activeCount > 0 ? Math.max(0, options.nowMs - unchangedSinceMs) : 0;
  const snapshot: ComfyQueueSnapshot = {
    fingerprint,
    runningCount: options.observation.runningIds.length,
    pendingCount: options.observation.pendingIds.length,
    observedAtMs: options.nowMs,
    unchangedSinceMs,
  };
  return {
    snapshot,
    health: {
      runningCount: snapshot.runningCount,
      pendingCount: snapshot.pendingCount,
      stale: activeCount > 0 && staleForMs >= options.staleAfterMs,
      staleForMs,
    },
  };
}

function validQueueSnapshot(value: ComfyQueueSnapshot | null | undefined): value is ComfyQueueSnapshot {
  return Boolean(
    value
    && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && Number.isSafeInteger(value.runningCount)
    && value.runningCount >= 0
    && Number.isSafeInteger(value.pendingCount)
    && value.pendingCount >= 0
    && Number.isFinite(value.observedAtMs)
    && Number.isFinite(value.unchangedSinceMs),
  );
}

function queueFingerprint(observation: QueueObservation, progressMarker?: string): string {
  const input = JSON.stringify({
    running: [...observation.runningIds].sort(),
    pending: [...observation.pendingIds].sort(),
    progress: typeof progressMarker === 'string' ? progressMarker.slice(0, 512) : '',
  });
  return createHash('sha256').update(input).digest('hex');
}

function evaluateRuntimeErrors(values: readonly unknown[]): {
  issues: ComfyHealthIssue[];
  poisonDetected: boolean;
  errorCount: number;
} {
  const limited = values.slice(0, MAX_RUNTIME_ERRORS);
  const issues: ComfyHealthIssue[] = [];
  let poisonDetected = false;
  for (const value of limited) {
    const raw = runtimeErrorText(value).slice(0, MAX_RUNTIME_ERROR_INPUT_CHARS);
    if (!raw.trim()) continue;
    const poisoned = POISON_PATTERNS.some((pattern) => pattern.test(raw));
    poisonDetected ||= poisoned;
    issues.push({
      code: poisoned ? 'runtime_accelerator_poisoned' : 'runtime_error',
      severity: poisoned ? 'critical' : 'warning',
      message: poisoned
        ? `Accelerator runtime is poisoned: ${sanitizeDiagnostic(raw)}`
        : `Runtime error: ${sanitizeDiagnostic(raw)}`,
    });
  }
  return { issues, poisonDetected, errorCount: limited.length };
}

function runtimeErrorText(value: unknown): string {
  try {
    if (value instanceof Error) return value.message;
    return typeof value === 'string' ? value : String(value);
  } catch {
    return 'unreadable runtime error';
  }
}

function verifyOwnership(
  authority: Pick<ComfyProcessOwnershipAuthority, 'verify'> | undefined,
  claim: ComfyHealthOwnershipClaim | undefined,
): boolean {
  if (!authority || !claim) return false;
  try {
    return authority.verify(claim.processInstanceId, claim.proof);
  } catch {
    return false;
  }
}

function normalizeProcessInstanceId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new ComfyHealthConfigurationError('ComfyUI process instance ID is invalid');
  }
  return value;
}

function normalizeModelRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0')) {
    return null;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null;
  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null;
  return segments.join('/');
}

function classifyProbeError(error: unknown): ComfyProbeErrorCode {
  if (error instanceof ProbeTimeoutError || isAbortError(error)) return 'timeout';
  if (error instanceof ProbeResponseTooLargeError) return 'response_too_large';
  if (error instanceof ProbeResponseOriginError) return 'response_origin_rejected';
  if (error instanceof ProbeInvalidResponseError || error instanceof SyntaxError) return 'invalid_response';
  return 'network_error';
}

function probeErrorMessage(error: unknown, timeoutMs: number): string {
  if (error instanceof ProbeTimeoutError || isAbortError(error)) return `Timed out after ${timeoutMs}ms`;
  if (error instanceof ProbeResponseTooLargeError) return 'Response exceeded the configured size limit';
  if (error instanceof ProbeResponseOriginError) return 'Response origin was rejected';
  if (error instanceof ProbeInvalidResponseError || error instanceof SyntaxError) {
    return sanitizeDiagnostic(error instanceof Error ? error.message : String(error));
  }
  return sanitizeDiagnostic(error instanceof Error ? error.message : String(error));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sanitizeIssue(issue: ComfyHealthIssue): ComfyHealthIssue {
  return {
    ...issue,
    message: sanitizeDiagnostic(issue.message),
  };
}

function sanitizeDiagnostic(value: string, maxChars = MAX_DIAGNOSTIC_CHARS): string {
  let safe = scrubSecrets(value);
  safe = safe
    .replace(/([?&](?:access_token|api[_-]?key|key|token|secret|password)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1[redacted]@')
    .replace(/\/home\/[^/\s]+/g, '/home/[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (safe.length <= maxChars) return safe;
  return `${safe.slice(0, Math.max(0, maxChars - 1))}…`;
}

function safeNow(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    value = Date.now();
  }
  if (!Number.isFinite(value) || value < 0 || value > 8_640_000_000_000_000) {
    return Date.now();
  }
  return Math.floor(value);
}

function elapsedMs(startedAt: number, now: () => number): number {
  return Math.max(0, safeNow(now) - startedAt);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}
