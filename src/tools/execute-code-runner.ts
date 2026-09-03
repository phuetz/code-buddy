import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  isExecuteCodeToolRpcEnabled,
  type ExecuteCodeRpcInvoker,
} from './execute-code-rpc-invoker.js';

export type ExecuteCodeLanguage = 'javascript' | 'typescript' | 'python' | 'shell';

export interface ExecuteCodeInput {
  code: string;
  language?: ExecuteCodeLanguage;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecuteCodeRunnerOptions {
  rootDir?: string;
  now?: () => Date;
  createId?: () => string;
  /**
   * Opt-in code→tool RPC. When provided AND the master flag is enabled,
   * generated code may call back into the allowlisted read-only tools.
   * The runner owns the transport (file framing, bound, timeout); this
   * invoker owns policy (allowlist/fleetSafe) + execution. Injected from
   * `execute-code-tools.ts` so the runner stays registry-dependency-free.
   */
  rpcInvoke?: ExecuteCodeRpcInvoker;
  /** Override the master flag (tests). Defaults to the env-derived value. */
  rpcEnabled?: boolean;
  /** Max RPC calls per execution (anti-loop). Default 16. */
  rpcMaxCalls?: number;
  /** Per-call RPC execution timeout (ms). Default 15s. */
  rpcCallTimeoutMs?: number;
  /**
   * Environment exposure to the child process.
   *  - `'inherit'` (default): the child sees the full `process.env` — for the
   *    user-facing execute_code tool, which may legitimately need credentials.
   *  - `'isolate'`: the child sees ONLY a minimal allowlist (PATH, locale, a
   *    throwaway HOME pointing at the run dir) plus the runner's own
   *    CODEBUDDY_EXECUTE_CODE_* keys and the caller-supplied `env`. Every
   *    secret (`*_API_KEY`, `*_TOKEN`, OAuth creds…) is dropped, and HOME is
   *    redirected so `~/.codebuddy/*` credential files are unreachable by
   *    path. Used by the self-improvement sandbox so authored/untrusted code
   *    cannot exfiltrate secrets — even during pre-accept scoring.
   */
  envMode?: 'inherit' | 'isolate';
}

/**
 * Build the child env under isolation: a minimal allowlist of the parent's
 * non-secret vars, a HOME redirected into the throwaway run dir, plus the
 * caller-supplied overrides. Nothing else from `process.env` crosses over.
 */
function buildIsolatedEnv(runDir: string, callerEnv: Record<string, string>): Record<string, string> {
  const ALLOW = new Set([
    'PATH', 'Path', // interpreter discovery (Windows uses `Path`)
    'LANG', 'LC_ALL', 'LC_CTYPE', 'LANGUAGE', 'TZ', // locale / time
    'TMPDIR', 'TMP', 'TEMP', // temp dir
    'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec', 'PATHEXT', 'WINDIR', // Windows runtime
    'NODE_PATH',
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && ALLOW.has(k)) out[k] = v;
  }
  // Redirect HOME at the sandbox so credential files under the real home
  // (~/.codebuddy/*.json) cannot be read by path.
  out.HOME = runDir;
  out.USERPROFILE = runDir;
  return { ...out, ...callerEnv };
}

export interface ExecuteCodeResult {
  kind: 'execute_code_result';
  ok: boolean;
  runId: string;
  language: ExecuteCodeLanguage;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  commandPreview: string;
  runDir: string;
  scriptPath: string;
  stdoutPath: string;
  stderrPath: string;
  resultPath: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  files: string[];
  error?: string;
}

interface Invocation {
  command: string;
  args: string[];
  commandPreview: string;
  extension: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_CHARS = 1_000_000;
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const RPC_DIR_NAME = 'rpc';
const RPC_DEFAULT_MAX_CALLS = 16;
const RPC_DEFAULT_CALL_TIMEOUT_MS = 15_000;
const RPC_POLL_INTERVAL_MS = 25;

export async function executeCode(
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions = {},
): Promise<ExecuteCodeResult> {
  const code = parseCode(input.code);
  const language = input.language ?? 'javascript';
  const timeoutMs = clampTimeout(input.timeoutMs);
  const startedAtDate = (options.now ?? (() => new Date()))();
  const startedAt = startedAtDate.toISOString();
  const startTime = Date.now();
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const runId = sanitizeRunId(options.createId?.() ?? `exec-${randomUUID()}`);
  const runDir = path.join(rootDir, '.codebuddy', 'execute-code', runId);
  const stdoutPath = path.join(runDir, 'stdout.log');
  const stderrPath = path.join(runDir, 'stderr.log');
  const resultPath = path.join(runDir, 'result.json');
  const invocation = buildInvocation(language);
  const scriptPath = path.join(runDir, `script${invocation.extension}`);
  const scriptArgs = parseArgs(input.args);
  const env = parseEnv(input.env);

  // ── code→tool RPC channel (opt-in, OFF by default) ──────────────
  // The helper is injected for js/python so the script can call uniformly;
  // the responder is ALWAYS active so every request gets a structured
  // reply (denial when off / tool refused) — never a hang.
  const rpcEnabled = (options.rpcEnabled ?? isExecuteCodeToolRpcEnabled()) && !!options.rpcInvoke;
  const rpcSupported = language === 'javascript' || language === 'typescript' || language === 'python';
  const rpcDir = path.join(runDir, RPC_DIR_NAME);
  const rpcMaxCalls = Math.max(1, options.rpcMaxCalls ?? RPC_DEFAULT_MAX_CALLS);
  const rpcCallTimeoutMs = Math.max(1_000, options.rpcCallTimeoutMs ?? RPC_DEFAULT_CALL_TIMEOUT_MS);

  let scriptCode = code;
  if (rpcSupported) {
    await fs.mkdir(rpcDir, { recursive: true });
    const helper = buildRpcHelper(language);
    // Python: `from __future__ import …` MUST stay at the top of the file
    // (after the docstring/comments only). Prepending the helper used to
    // raise SyntaxError and abort every `buddy science` Python experiment
    // that started with a future import.
    scriptCode =
      language === 'python' ? injectAfterPythonPreamble(code, helper) : `${helper}\n${code}`;
  }
  await fs.writeFile(scriptPath, scriptCode, 'utf8');
  if (language === 'shell' && process.platform !== 'win32') {
    await fs.chmod(scriptPath, 0o700);
  }

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let spawnError: Error | undefined;

  const completed = await new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    const runnerEnv = {
      CODEBUDDY_EXECUTE_CODE_RUN_DIR: runDir,
      CODEBUDDY_WORKSPACE_ROOT: rootDir,
      ...(rpcSupported ? { CODEBUDDY_EXECUTE_CODE_RPC_DIR: rpcDir } : {}),
    };
    const childEnv =
      options.envMode === 'isolate'
        ? buildIsolatedEnv(runDir, { ...env, ...runnerEnv })
        : { ...process.env, ...env, ...runnerEnv };
    const child = spawn(invocation.command, [...invocation.args, scriptPath, ...scriptArgs], {
      cwd: runDir,
      env: childEnv,
      windowsHide: true,
    });

    const rpcPoller = rpcSupported
      ? startRpcResponder({
          rpcDir,
          enabled: rpcEnabled,
          invoke: options.rpcInvoke,
          maxCalls: rpcMaxCalls,
          callTimeoutMs: rpcCallTimeoutMs,
        })
      : undefined;

    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 1_000);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      rpcPoller?.stop();
      resolve({ exitCode, signal });
    });
  });

  const completedAt = (options.now ?? (() => new Date()))().toISOString();
  const durationMs = Math.max(0, Date.now() - startTime);
  await fs.writeFile(stdoutPath, stdout, 'utf8');
  await fs.writeFile(stderrPath, stderr, 'utf8');

  const error = buildError(spawnError, timedOut, completed.exitCode, timeoutMs);
  const filesBeforeResult = await listRunFiles(runDir);
  const result: ExecuteCodeResult = {
    kind: 'execute_code_result',
    ok: !error,
    runId,
    language,
    startedAt,
    completedAt,
    durationMs,
    commandPreview: `${invocation.commandPreview} ${scriptArgs.map(quoteArg).join(' ')}`.trim(),
    runDir,
    scriptPath,
    stdoutPath,
    stderrPath,
    resultPath,
    exitCode: completed.exitCode,
    signal: completed.signal,
    timedOut,
    stdout,
    stderr,
    files: [...new Set([...filesBeforeResult, 'result.json'])].sort(),
    ...(error ? { error } : {}),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function parseCode(code: unknown): string {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('code is required');
  }
  if (code.length > 200_000) {
    throw new Error('code is too large for execute_code; use a checked-in script plus terminal for larger jobs');
  }
  return code;
}

function parseArgs(args: unknown): string[] {
  if (args === undefined) return [];
  if (!Array.isArray(args)) {
    throw new Error('args must be an array of strings');
  }
  return args.map((arg, index) => {
    if (typeof arg !== 'string') {
      throw new Error(`args[${index}] must be a string`);
    }
    return arg;
  });
}

function parseEnv(env: unknown): Record<string, string> {
  if (env === undefined) return {};
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    throw new Error('env must be an object of string values');
  }
  const parsed: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!VALID_ENV_KEY.test(key)) {
      throw new Error(`Invalid env key: ${key}`);
    }
    if (typeof value !== 'string') {
      throw new Error(`env.${key} must be a string`);
    }
    parsed[key] = value;
  }
  return parsed;
}

function clampTimeout(timeoutMs: unknown): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    throw new Error('timeout_ms must be a finite number');
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(timeoutMs)));
}

function buildInvocation(language: ExecuteCodeLanguage): Invocation {
  switch (language) {
    case 'javascript':
      return {
        command: process.execPath,
        args: [],
        commandPreview: 'node script.mjs',
        extension: '.mjs',
      };
    case 'typescript':
      return {
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['tsx'],
        commandPreview: 'npx tsx script.ts',
        extension: '.ts',
      };
    case 'python':
      return {
        command: process.platform === 'win32' ? 'python.exe' : 'python3',
        args: [],
        commandPreview: 'python script.py',
        extension: '.py',
      };
    case 'shell':
      if (process.platform === 'win32') {
        return {
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
          commandPreview: 'powershell -File script.ps1',
          extension: '.ps1',
        };
      }
      return {
        command: 'sh',
        args: [],
        commandPreview: 'sh script.sh',
        extension: '.sh',
      };
  }
}

function appendBounded(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= MAX_CAPTURE_CHARS) {
    return combined;
  }
  return combined.slice(combined.length - MAX_CAPTURE_CHARS);
}

function buildError(
  spawnError: Error | undefined,
  timedOut: boolean,
  exitCode: number | null,
  timeoutMs: number,
): string | undefined {
  if (spawnError) return spawnError.message;
  if (timedOut) return `execute_code timed out after ${timeoutMs}ms`;
  if (exitCode !== 0) return `execute_code exited with code ${exitCode ?? 'unknown'}`;
  return undefined;
}

function sanitizeRunId(runId: string): string {
  const sanitized = runId.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || `exec-${randomUUID()}`;
}

async function listRunFiles(runDir: string): Promise<string[]> {
  const entries = await fs.readdir(runDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function quoteArg(arg: string): string {
  if (!arg) return '""';
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

// ──────────────────────────────────────────────────────────────────
// code→tool RPC transport (runner side)
// ──────────────────────────────────────────────────────────────────

interface RpcResponderOptions {
  rpcDir: string;
  enabled: boolean;
  invoke: ExecuteCodeRpcInvoker | undefined;
  maxCalls: number;
  callTimeoutMs: number;
}

interface RpcResponder {
  stop(): void;
}

/**
 * File-framed request/response loop. The script writes
 * `<id>.req.json` atomically (temp + rename) into `rpcDir`; we read it,
 * run the policy-gated invoker, and write `<id>.res.json` atomically.
 * The script blocks until the response file appears. Fail-closed: when
 * disabled or over the call bound, we still answer with `{ok:false}` so
 * the child never hangs.
 */
function startRpcResponder(options: RpcResponderOptions): RpcResponder {
  const seen = new Set<string>();
  let callCount = 0;
  let stopped = false;
  let scanning = false;

  const writeResponse = async (id: string, payload: ExecuteCodeRpcResponse): Promise<void> => {
    const finalPath = path.join(options.rpcDir, `${id}.res.json`);
    const tmpPath = path.join(options.rpcDir, `${id}.res.json.tmp`);
    await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await fs.rename(tmpPath, finalPath);
  };

  const handleRequest = async (id: string, reqPath: string): Promise<void> => {
    let request: { tool?: unknown; args?: unknown };
    try {
      request = JSON.parse(await fs.readFile(reqPath, 'utf8')) as typeof request;
    } catch {
      await writeResponse(id, { ok: false, error: 'RPC_BAD_REQUEST: could not parse request JSON' });
      return;
    }

    if (!options.enabled || !options.invoke) {
      await writeResponse(id, {
        ok: false,
        error:
          'EXECUTE_CODE_TOOL_RPC_DISABLED: code→tool RPC is off. Set CODEBUDDY_EXECUTE_CODE_TOOL_RPC=true to enable (opt-in).',
      });
      return;
    }

    callCount += 1;
    if (callCount > options.maxCalls) {
      await writeResponse(id, {
        ok: false,
        error: `RPC_CALL_LIMIT_EXCEEDED: exceeded ${options.maxCalls} tool calls for this execution`,
      });
      return;
    }

    const tool = typeof request.tool === 'string' ? request.tool : '';
    const args =
      typeof request.args === 'object' && request.args !== null && !Array.isArray(request.args)
        ? (request.args as Record<string, unknown>)
        : {};
    if (!tool) {
      await writeResponse(id, { ok: false, error: 'RPC_BAD_REQUEST: missing string "tool"' });
      return;
    }

    try {
      const result = await withTimeout(
        options.invoke({ tool, args }),
        options.callTimeoutMs,
        `RPC_TOOL_TIMEOUT: tool "${tool}" exceeded ${options.callTimeoutMs}ms`,
      );
      await writeResponse(id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeResponse(id, { ok: false, error: message });
    }
  };

  const scan = async (): Promise<void> => {
    if (scanning || stopped) return;
    scanning = true;
    try {
      const entries = await fs.readdir(options.rpcDir).catch(() => [] as string[]);
      for (const entry of entries) {
        if (!entry.endsWith('.req.json')) continue;
        const id = entry.slice(0, -'.req.json'.length);
        if (seen.has(id)) continue;
        seen.add(id);
        await handleRequest(id, path.join(options.rpcDir, entry));
      }
    } catch (error) {
      logger.debug('[execute-code-rpc] responder scan error', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      scanning = false;
    }
  };

  const interval = setInterval(() => {
    void scan();
  }, RPC_POLL_INTERVAL_MS);
  interval.unref?.();

  return {
    stop(): void {
      stopped = true;
      clearInterval(interval);
    },
  };
}

interface ExecuteCodeRpcResponse {
  ok: boolean;
  output?: string;
  error?: string;
  truncated?: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Minimal blocking RPC helper injected at the top of generated scripts.
 * - JS/TS: exposes `globalThis.codebuddyToolCall(tool, args)` →
 *   `{ ok, output?, error? }`. Synchronous (blocks the script) so the
 *   generated code reads naturally without await plumbing.
 * - Python: exposes `codebuddy_tool_call(tool, args={})` with the same
 *   shape.
 * Both write `<uuid>.req.json` atomically and poll for the response.
 */
const PYTHON_FUTURE_IMPORT = /^from\s+__future__\s+import\s+/;
const PYTHON_TRIPLE_QUOTE = /^(\s*)("""|''')/;

/**
 * Insert `helper` after the legal Python module preamble so a user script
 * that starts with a docstring and/or `from __future__ import …` stays valid.
 * Never throws; empty code ⇒ helper alone.
 */
export function injectAfterPythonPreamble(userCode: string, helper: string): string {
  const code = typeof userCode === 'string' ? userCode : '';
  const block = helper.endsWith('\n') ? helper : `${helper}\n`;
  if (!code) return block;
  const insertion = findPythonPreambleEnd(code);
  const before = code.slice(0, insertion);
  const after = code.slice(insertion);
  const nl = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  return `${before}${nl}${block}${after}`;
}

/** Character offset immediately after shebang / comments / docstring / future imports. */
export function findPythonPreambleEnd(code: string): number {
  const raw = code.startsWith('\ufeff') ? code.slice(1) : code;
  const bom = code.startsWith('\ufeff') ? 1 : 0;
  const lines = raw.split('\n');
  let i = 0;

  const lineStart = (idx: number): number => {
    let off = bom;
    for (let k = 0; k < idx; k++) off += (lines[k]?.length ?? 0) + 1;
    return off;
  };

  if (lines[0]?.startsWith('#!')) i++;

  const skipCommentsAndBlanks = (): void => {
    while (i < lines.length) {
      const t = (lines[i] ?? '').trim();
      if (t === '' || t.startsWith('#')) {
        i++;
        continue;
      }
      break;
    }
  };

  skipCommentsAndBlanks();

  const first = lines[i] ?? '';
  const doc = first.match(PYTHON_TRIPLE_QUOTE);
  if (doc) {
    const quote = doc[2] ?? '"""';
    const afterOpen = first.slice((doc[1]?.length ?? 0) + quote.length);
    if (afterOpen.includes(quote)) {
      i++;
    } else {
      i++;
      while (i < lines.length && !(lines[i] ?? '').includes(quote)) i++;
      if (i < lines.length) i++;
    }
    skipCommentsAndBlanks();
  }

  while (i < lines.length && PYTHON_FUTURE_IMPORT.test((lines[i] ?? '').trim())) {
    const startLine = lines[i] ?? '';
    const openParens = (startLine.match(/\(/g) ?? []).length - (startLine.match(/\)/g) ?? []).length;
    i++;
    if (openParens > 0) {
      let depth = openParens;
      while (i < lines.length && depth > 0) {
        const l = lines[i] ?? '';
        depth += (l.match(/\(/g) ?? []).length - (l.match(/\)/g) ?? []).length;
        i++;
      }
    }
  }

  if (i >= lines.length) return code.length;
  return lineStart(i);
}

function buildRpcHelper(language: ExecuteCodeLanguage): string {
  if (language === 'python') {
    return [
      'import os as _cb_os, json as _cb_json, time as _cb_time, uuid as _cb_uuid',
      'def codebuddy_tool_call(tool, args=None):',
      '    _d = _cb_os.environ.get("CODEBUDDY_EXECUTE_CODE_RPC_DIR")',
      '    if not _d:',
      '        return {"ok": False, "error": "EXECUTE_CODE_TOOL_RPC_UNAVAILABLE"}',
      '    _id = _cb_uuid.uuid4().hex',
      '    _req = _cb_os.path.join(_d, _id + ".req.json")',
      '    _res = _cb_os.path.join(_d, _id + ".res.json")',
      '    _tmp = _req + ".tmp"',
      '    with open(_tmp, "w") as _f:',
      '        _cb_json.dump({"tool": tool, "args": args or {}}, _f)',
      '    _cb_os.replace(_tmp, _req)',
      '    _deadline = _cb_time.time() + 60',
      '    while _cb_time.time() < _deadline:',
      '        if _cb_os.path.exists(_res):',
      '            with open(_res) as _f:',
      '                return _cb_json.load(_f)',
      '        _cb_time.sleep(0.01)',
      '    return {"ok": False, "error": "RPC_RESPONSE_TIMEOUT"}',
      '',
    ].join('\n');
  }
  // javascript / typescript
  return [
    "import { writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "import { randomUUID } from 'node:crypto';",
    'globalThis.codebuddyToolCall = function codebuddyToolCall(tool, args) {',
    '  const dir = process.env.CODEBUDDY_EXECUTE_CODE_RPC_DIR;',
    "  if (!dir) return { ok: false, error: 'EXECUTE_CODE_TOOL_RPC_UNAVAILABLE' };",
    '  const id = randomUUID();',
    "  const reqPath = join(dir, id + '.req.json');",
    "  const resPath = join(dir, id + '.res.json');",
    "  const tmpPath = reqPath + '.tmp';",
    '  writeFileSync(tmpPath, JSON.stringify({ tool, args: args || {} }));',
    '  renameSync(tmpPath, reqPath);',
    '  const deadline = Date.now() + 60000;',
    '  while (Date.now() < deadline) {',
    '    if (existsSync(resPath)) {',
    "      return JSON.parse(readFileSync(resPath, 'utf8'));",
    '    }',
    '    const wait = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);',
    '    void wait;',
    '  }',
    "  return { ok: false, error: 'RPC_RESPONSE_TIMEOUT' };",
    '};',
    '',
  ].join('\n');
}
