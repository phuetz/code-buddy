/**
 * Safe client for Patrice's Rust `lm-resizer`.
 *
 * The preferred transport is the local HTTP sidecar. When it is unavailable,
 * Code Buddy falls back to `lm-resizer tool-output --request-json`, sending the
 * complete request through stdin. User queries, commands and tool output are
 * therefore never exposed in the process argument list.
 *
 * Every public operation is best-effort and never throws. Callers always retain
 * the unmodified observation as their fallback.
 *
 * @module context/lm-resizer-compressor
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { delimiter, join } from 'path';
import { logger } from '../utils/logger.js';

const DEFAULT_HTTP_URL = 'http://127.0.0.1:8787';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_HTTP_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_CIRCUIT_FAILURES = 2;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 30_000;
const SIDECAR_CAPABILITY_TTL_MS = 60_000;
const MAX_TOKEN_FILE_BYTES = 4_096;

type Transport = 'http' | 'tool-output-cli' | 'compress-cli';

interface CircuitState {
  failures: number;
  openUntil: number;
}

const circuitStates: Record<Transport, CircuitState> = {
  http: { failures: 0, openUntil: 0 },
  'tool-output-cli': { failures: 0, openUntil: 0 },
  'compress-cli': { failures: 0, openUntil: 0 },
};

const sidecarCapabilityCache = new Map<string, number>();

interface CachedTokenFile {
  path: string;
  mtimeMs: number;
  token?: string;
}

let cachedTokenFile: CachedTokenFile | null = null;

export interface LmResizerResult {
  /** Text returned by lm-resizer. */
  compressed: string;
  originalBytes: number;
  compressedBytes: number;
  bytesSaved: number;
  /** CCR hash that addresses the complete original payload, when available. */
  hash?: string;
}

export interface LmResizerToolOutputRequest {
  content: string;
  toolName?: string;
  command?: string;
  workspaceRoot?: string;
  query?: string;
  exitCode?: number;
  tokenBudget?: number;
  /** Preserve failed command output exactly. Defaults to true for failures. */
  rawOnFailure?: boolean;
  minSavingsBytes?: number;
  minSavingsRatio?: number;
}

export interface LmResizerToolOutputResult extends LmResizerResult {
  toolName: string;
  command: string;
  workspaceRoot?: string;
  exitCode: number;
  filter: string;
  filteredBytes: number;
  savingsRatio: number;
  candidateBytes: number;
  candidateDeltaBytes: number;
  compressionSteps: string[];
  cacheKeys: string[];
  accepted: boolean;
  rejectionReason?: string;
  transport: 'http' | 'cli';
}

export interface LmResizerClientOptions {
  timeoutMs?: number;
  httpTimeoutMs?: number;
  bin?: string;
  /** Base sidecar URL. Pass null to disable HTTP for this call. */
  httpUrl?: string | null;
  /** Optional sidecar token. It is sent only in an HTTP header. */
  serverToken?: string;
  storePath?: string;
  cwd?: string;
  signal?: AbortSignal;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
  now?: () => number;
}

interface WireToolOutputRequest {
  content: string;
  tool_name: string;
  command: string;
  workspace_root?: string;
  query: string;
  exit_code: number;
  token_budget?: number;
  raw_on_failure: boolean;
  min_savings_bytes: number;
  min_savings_ratio: number;
}

interface WireToolOutputReport {
  tool_name?: unknown;
  command?: unknown;
  workspace_root?: unknown;
  exit_code?: unknown;
  filter?: unknown;
  original_bytes?: unknown;
  filtered_bytes?: unknown;
  compressed_bytes?: unknown;
  bytes_saved?: unknown;
  savings_ratio?: unknown;
  candidate_bytes?: unknown;
  candidate_delta_bytes?: unknown;
  compression_steps?: unknown;
  cache_keys?: unknown;
  recovery_hash?: unknown;
  accepted?: unknown;
  rejection_reason?: unknown;
  output?: unknown;
}

interface WireCompressReport {
  output?: unknown;
  original_bytes?: unknown;
  compressed_bytes?: unknown;
  bytes_saved?: unknown;
  cache_keys?: unknown;
}

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Resolve lm-resizer: explicit env -> stable install -> PATH -> mutable DEV build. */
export function resolveLmResizerBin(): string {
  const env = process.env.CODEBUDDY_LM_RESIZER_BIN;
  if (env && existsSync(env)) return env;
  const stable = join(homedir(), '.local', 'bin', 'lm-resizer');
  if (existsSync(stable)) return stable;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, 'lm-resizer');
    if (existsSync(candidate)) return candidate;
  }
  const local = join(homedir(), 'DEV', 'lm-resizer', 'target', 'release', 'lm-resizer');
  if (existsSync(local)) return local;
  return 'lm-resizer';
}

export function resolveLmResizerHttpUrl(): string {
  return process.env.CODEBUDDY_LM_RESIZER_URL?.trim()
    || process.env.LM_RESIZER_URL?.trim()
    || DEFAULT_HTTP_URL;
}

/**
 * Resolve the sidecar token without requiring Cowork or transient services to
 * inherit it. Insecure group/world-readable files are ignored on Unix.
 */
export function resolveLmResizerServerToken(
  options: Pick<LmResizerClientOptions, 'serverToken'> = {},
): string | undefined {
  const direct = options.serverToken
    ?? process.env.CODEBUDDY_LM_RESIZER_SERVER_TOKEN
    ?? process.env.CODEBUDDY_LM_RESIZER_TOKEN
    ?? process.env.LM_RESIZER_SERVER_TOKEN;
  if (direct?.trim()) return direct.trim();

  const tokenPath = process.env.CODEBUDDY_LM_RESIZER_TOKEN_FILE?.trim()
    || join(homedir(), '.codebuddy', 'lm-resizer', 'server-token');
  try {
    const stat = statSync(tokenPath);
    if (!stat.isFile() || stat.size > MAX_TOKEN_FILE_BYTES) return undefined;
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      logger.warn(`[lm-resizer] refusing non-private token file ${tokenPath}; expected mode 0600`);
      return undefined;
    }
    if (
      process.platform !== 'win32'
      && typeof process.getuid === 'function'
      && stat.uid !== process.getuid()
    ) {
      logger.warn(`[lm-resizer] refusing token file not owned by the current user: ${tokenPath}`);
      return undefined;
    }
    if (cachedTokenFile?.path === tokenPath && cachedTokenFile.mtimeMs === stat.mtimeMs) {
      return cachedTokenFile.token;
    }
    const token = readFileSync(tokenPath, 'utf8').trim() || undefined;
    cachedTokenFile = { path: tokenPath, mtimeMs: stat.mtimeMs, token };
    return token;
  } catch {
    return undefined;
  }
}

function resolveStorePath(options: LmResizerClientOptions): string {
  return options.storePath
    || process.env.CODEBUDDY_LM_RESIZER_STORE
    || join(homedir(), '.codebuddy', 'lm-resizer.db');
}

/** True when the integration is opt-in enabled. */
export function isLmResizerEnabled(): boolean {
  return process.env.CODEBUDDY_LM_RESIZER === 'true';
}

/**
 * Build the minimal environment inherited by the lm-resizer subprocess.
 * API keys, auth tokens and arbitrary application variables never cross the
 * process boundary.
 */
export function buildLmResizerSubprocessEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const safeNames = new Set([
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'COLORTERM',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
    'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
    'RUST_BACKTRACE', 'RUST_LOG',
  ]);
  const secretName = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH|COOKIE|SESSION|JWT)/i;
  const env: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || secretName.test(name) || !safeNames.has(name)) continue;
    env[name] = value;
  }

  return {
    ...env,
    HISTFILE: '/dev/null',
    HISTSIZE: '0',
    CI: 'true',
    NO_COLOR: '1',
    TERM: 'dumb',
    NO_TTY: '1',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: env.LC_ALL || 'C.UTF-8',
    LANG: env.LANG || 'C.UTF-8',
  };
}

function normalizeRequest(request: LmResizerToolOutputRequest): WireToolOutputRequest {
  const exitCode = Number.isInteger(request.exitCode) ? request.exitCode as number : 0;
  const normalized: WireToolOutputRequest = {
    content: request.content,
    tool_name: request.toolName ?? '',
    command: request.command ?? '',
    query: request.query ?? '',
    exit_code: exitCode,
    raw_on_failure: request.rawOnFailure ?? exitCode !== 0,
    min_savings_bytes: Math.max(1, Math.floor(request.minSavingsBytes ?? 1)),
    min_savings_ratio: Math.min(1, Math.max(0, request.minSavingsRatio ?? 0)),
  };
  if (request.workspaceRoot) normalized.workspace_root = request.workspaceRoot;
  if (request.tokenBudget !== undefined && request.tokenBudget > 0) {
    normalized.token_budget = Math.floor(request.tokenBudget);
  }
  return normalized;
}

function parseToolOutputReport(
  raw: string,
  original: WireToolOutputRequest,
  transport: 'http' | 'cli',
): LmResizerToolOutputResult | null {
  let report: WireToolOutputReport;
  try {
    report = JSON.parse(raw) as WireToolOutputReport;
  } catch (error) {
    logger.debug(`[lm-resizer] invalid tool-output JSON: ${msg(error)}`);
    return null;
  }
  if (typeof report.output !== 'string') return null;

  const originalBytes = finiteNumber(report.original_bytes, Buffer.byteLength(original.content));
  const compressedBytes = finiteNumber(report.compressed_bytes, Buffer.byteLength(report.output));
  const cacheKeys = stringArray(report.cache_keys);
  const recoveryHash = typeof report.recovery_hash === 'string'
    ? report.recovery_hash
    : cacheKeys[0];

  return {
    compressed: report.output,
    originalBytes,
    compressedBytes,
    bytesSaved: finiteNumber(report.bytes_saved, Math.max(0, originalBytes - compressedBytes)),
    ...(recoveryHash ? { hash: recoveryHash } : {}),
    toolName: typeof report.tool_name === 'string' ? report.tool_name : original.tool_name,
    command: typeof report.command === 'string' ? report.command : original.command,
    ...(typeof report.workspace_root === 'string' ? { workspaceRoot: report.workspace_root } : {}),
    exitCode: finiteNumber(report.exit_code, original.exit_code),
    filter: typeof report.filter === 'string' ? report.filter : 'unknown',
    filteredBytes: finiteNumber(report.filtered_bytes, originalBytes),
    savingsRatio: finiteNumber(
      report.savings_ratio,
      originalBytes === 0 ? 0 : Math.max(0, originalBytes - compressedBytes) / originalBytes,
    ),
    candidateBytes: finiteNumber(report.candidate_bytes, compressedBytes),
    candidateDeltaBytes: finiteNumber(report.candidate_delta_bytes, compressedBytes - originalBytes),
    compressionSteps: stringArray(report.compression_steps),
    cacheKeys,
    accepted: typeof report.accepted === 'boolean' ? report.accepted : compressedBytes < originalBytes,
    ...(typeof report.rejection_reason === 'string'
      ? { rejectionReason: report.rejection_reason }
      : {}),
    transport,
  };
}

function parseCompressReport(raw: string, originalText: string): LmResizerResult | null {
  let report: WireCompressReport;
  try {
    report = JSON.parse(raw) as WireCompressReport;
  } catch (error) {
    logger.debug(`[lm-resizer] invalid compress JSON: ${msg(error)}`);
    return null;
  }
  if (typeof report.output !== 'string' || report.output.length === 0) return null;
  const originalBytes = finiteNumber(report.original_bytes, Buffer.byteLength(originalText));
  const compressedBytes = finiteNumber(report.compressed_bytes, Buffer.byteLength(report.output));
  const cacheKeys = stringArray(report.cache_keys);
  return {
    compressed: report.output,
    originalBytes,
    compressedBytes,
    bytesSaved: finiteNumber(report.bytes_saved, Math.max(0, originalBytes - compressedBytes)),
    ...(cacheKeys[0] ? { hash: cacheKeys[0] } : {}),
  };
}

function circuitAllows(transport: Transport, options: LmResizerClientOptions): boolean {
  const now = (options.now ?? Date.now)();
  const state = circuitStates[transport];
  if (state.openUntil === 0) return true;
  if (now < state.openUntil) return false;
  state.failures = 0;
  state.openUntil = 0;
  return true;
}

function recordCircuitSuccess(transport: Transport): void {
  circuitStates[transport].failures = 0;
  circuitStates[transport].openUntil = 0;
}

function recordCircuitFailure(transport: Transport, options: LmResizerClientOptions): void {
  const state = circuitStates[transport];
  state.failures += 1;
  const threshold = Math.max(1, options.circuitFailureThreshold ?? DEFAULT_CIRCUIT_FAILURES);
  if (state.failures >= threshold) {
    state.openUntil = (options.now ?? Date.now)()
      + Math.max(1, options.circuitCooldownMs ?? DEFAULT_CIRCUIT_COOLDOWN_MS);
  }
}

/** Reset transport circuit breakers. Intended for tests and runtime reconfiguration. */
export function resetLmResizerCircuitBreakers(): void {
  for (const state of Object.values(circuitStates)) {
    state.failures = 0;
    state.openUntil = 0;
  }
  sidecarCapabilityCache.clear();
  cachedTokenFile = null;
}

function endpointForSidecar(baseUrl: string, route: 'health' | 'tool-output'): string | null {
  try {
    const url = new URL(baseUrl);
    const basePath = url.pathname
      .replace(/\/(?:health|tool-output)\/?$/, '')
      .replace(/\/$/, '');
    url.pathname = `${basePath}/${route}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function abortScope(
  timeoutMs: number,
  upstream?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(upstream?.reason);
  if (upstream?.aborted) controller.abort(upstream.reason);
  else upstream?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('lm-resizer timed out')), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', onAbort);
    },
  };
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) {
    const text = await response.text();
    return Buffer.byteLength(text) <= maxBytes ? text : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel('lm-resizer response exceeded limit');
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function discoverSidecar(
  baseUrl: string,
  fetchImpl: typeof fetch,
  token: string | undefined,
  options: LmResizerClientOptions,
): Promise<boolean> {
  const now = (options.now ?? Date.now)();
  const cachedUntil = sidecarCapabilityCache.get(baseUrl) ?? 0;
  if (cachedUntil > now) return true;
  const endpoint = endpointForSidecar(baseUrl, 'health');
  if (!endpoint) return false;

  const scope = abortScope(options.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS, options.signal);
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (token) headers['x-lm-resizer-token'] = token;
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers,
      signal: scope.signal,
    });
    if (!response.ok) return false;
    const raw = await readBoundedResponse(response, 64 * 1024);
    if (raw === null) return false;
    const health = JSON.parse(raw) as { ok?: unknown; capabilities?: unknown };
    const capabilities = stringArray(health.capabilities);
    if (health.ok !== true || !capabilities.includes('tool-output-v1')) return false;
    sidecarCapabilityCache.set(baseUrl, now + SIDECAR_CAPABILITY_TTL_MS);
    return true;
  } catch (error) {
    logger.debug(`[lm-resizer] sidecar discovery failed: ${msg(error)}`);
    return false;
  } finally {
    scope.cleanup();
  }
}

async function requestHttp(
  request: WireToolOutputRequest,
  options: LmResizerClientOptions,
): Promise<LmResizerToolOutputResult | null> {
  const baseUrl = options.httpUrl === undefined ? resolveLmResizerHttpUrl() : options.httpUrl;
  if (baseUrl === null || !circuitAllows('http', options)) return null;
  // Tests must opt into IO by injecting/configuring a transport explicitly.
  if (process.env.NODE_ENV === 'test' && options.fetchImpl === undefined && options.httpUrl === undefined) {
    return null;
  }
  const endpoint = endpointForSidecar(baseUrl, 'tool-output');
  if (!endpoint) {
    recordCircuitFailure('http', options);
    return null;
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;

  const token = resolveLmResizerServerToken(options);
  if (!await discoverSidecar(baseUrl, fetchImpl, token, options)) {
    recordCircuitFailure('http', options);
    return null;
  }

  const scope = abortScope(options.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS, options.signal);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['x-lm-resizer-token'] = token;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: scope.signal,
    });
    if (!response.ok) {
      recordCircuitFailure('http', options);
      return null;
    }
    const raw = await readBoundedResponse(
      response,
      options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES,
    );
    const parsed = raw === null ? null : parseToolOutputReport(raw, request, 'http');
    if (parsed) recordCircuitSuccess('http');
    else recordCircuitFailure('http', options);
    return parsed;
  } catch (error) {
    logger.debug(`[lm-resizer] HTTP sidecar unavailable: ${msg(error)}`);
    recordCircuitFailure('http', options);
    return null;
  } finally {
    scope.cleanup();
  }
}

interface CliRunResult {
  stdout: string;
  code: number;
}

async function runCli(
  args: string[],
  stdin: string,
  transport: Exclude<Transport, 'http'>,
  options: LmResizerClientOptions,
  workspaceRoot?: string,
): Promise<CliRunResult | null> {
  if (!circuitAllows(transport, options) || options.signal?.aborted) return null;
  if (process.env.NODE_ENV === 'test' && options.spawnImpl === undefined && options.bin === undefined) {
    return null;
  }
  const spawnImpl = options.spawnImpl ?? spawn;
  const maxStdout = Math.max(1, options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES);
  const maxStderr = Math.max(1, options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES);
  const cwd = options.cwd ?? workspaceRoot ?? process.cwd();

  return new Promise<CliRunResult | null>((resolve) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let forceKillTimer: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;

    const child = (() => {
      try {
        return spawnImpl(options.bin ?? resolveLmResizerBin(), args, {
          cwd,
          env: { ...buildLmResizerSubprocessEnv(), PWD: cwd },
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        logger.debug(`[lm-resizer] CLI spawn failed: ${msg(error)}`);
        return null;
      }
    })();

    const cleanup = (): void => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (result: CliRunResult | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const terminate = (): void => {
      try {
        child?.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          try {
            child?.kill('SIGKILL');
          } catch {
            // Best effort only.
          }
        }, 250);
        forceKillTimer.unref?.();
      } catch {
        // Best effort only.
      }
    };
    const fail = (reason: string): void => {
      logger.debug(`[lm-resizer] CLI ${transport} failed: ${reason}`);
      terminate();
      recordCircuitFailure(transport, options);
      finish(null);
    };
    const onAbort = (): void => fail('aborted');

    if (!child) {
      recordCircuitFailure(transport, options);
      finish(null);
      return;
    }

    timeout = setTimeout(() => fail('timed out'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timeout.unref?.();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.byteLength;
      if (stdoutBytes > maxStdout) {
        fail(`stdout exceeded ${maxStdout} bytes`);
        return;
      }
      stdoutChunks.push(buffer);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (settled || stderrBytes >= maxStderr) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxStderr - stderrBytes;
      stderrChunks.push(buffer.subarray(0, remaining));
      stderrBytes += Math.min(buffer.byteLength, remaining);
    });
    child.on('error', (error) => fail(msg(error)));
    child.on('close', (code) => {
      if (settled) return;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (code !== 0) {
        const stderrSize = Buffer.concat(stderrChunks).byteLength;
        fail(`exit ${code ?? 'unknown'}${stderrSize > 0 ? ` (stderr ${stderrSize} bytes)` : ''}`);
        return;
      }
      recordCircuitSuccess(transport);
      finish({ stdout: Buffer.concat(stdoutChunks).toString('utf8'), code: code ?? 0 });
    });
    child.stdin?.on('error', (error) => fail(`stdin: ${msg(error)}`));
    try {
      child.stdin?.end(stdin);
    } catch (error) {
      fail(`stdin: ${msg(error)}`);
    }
  });
}

/**
 * Reduce an already-executed tool observation. The HTTP sidecar is attempted
 * first, then the stdin-only CLI protocol. Never throws.
 */
export async function optimizeToolOutputWithLmResizer(
  request: LmResizerToolOutputRequest,
  options: LmResizerClientOptions = {},
): Promise<LmResizerToolOutputResult | null> {
  if (typeof request.content !== 'string') return null;
  const normalized = normalizeRequest(request);
  const viaHttp = await requestHttp(normalized, options);
  if (viaHttp) return viaHttp;

  const cli = await runCli(
    ['tool-output', '--request-json', '--json', '--store', resolveStorePath(options)],
    JSON.stringify(normalized),
    'tool-output-cli',
    options,
    normalized.workspace_root,
  );
  if (!cli || !cli.stdout.trim()) return null;
  const parsed = parseToolOutputReport(cli.stdout, normalized, 'cli');
  if (!parsed) recordCircuitFailure('tool-output-cli', options);
  return parsed;
}

async function legacyCompress(
  text: string,
  options: LmResizerClientOptions,
): Promise<LmResizerResult | null> {
  const cli = await runCli(
    ['compress', '--json', '--store', resolveStorePath(options)],
    text,
    'compress-cli',
    options,
  );
  if (!cli || !cli.stdout.trim()) return null;
  const parsed = parseCompressReport(cli.stdout, text);
  if (!parsed) recordCircuitFailure('compress-cli', options);
  return parsed;
}

/**
 * Backwards-compatible compressor API.
 *
 * It uses the tool-output protocol first so `query` travels through HTTP JSON
 * or stdin. A stale lm-resizer binary may not know that subcommand yet; in that
 * case the legacy `compress` fallback is used without placing `query` in argv.
 */
export async function compressWithLmResizer(
  text: string,
  query = '',
  options: LmResizerClientOptions = {},
): Promise<LmResizerResult | null> {
  try {
    const modern = await optimizeToolOutputWithLmResizer({
      content: text,
      toolName: 'generic',
      query,
      minSavingsBytes: 1,
    }, options);
    if (modern) {
      return {
        compressed: modern.compressed,
        originalBytes: modern.originalBytes,
        compressedBytes: modern.compressedBytes,
        bytesSaved: modern.bytesSaved,
        ...(modern.hash ? { hash: modern.hash } : {}),
      };
    }
    return await legacyCompress(text, options);
  } catch (error) {
    logger.debug(`[lm-resizer] unexpected client failure: ${msg(error)}`);
    return null;
  }
}
