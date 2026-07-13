/**
 * Code Mode — bounded JavaScript orchestration with a ToolHandler bridge.
 *
 * `code_exec` is intentionally computation-only: generated JavaScript cannot
 * access Node globals directly. Any real effect must go through `tools.*`,
 * whose executor is injected by the active ToolHandler. Consequently nested
 * calls keep the normal permission, policy, trust-folder, write-policy,
 * confirmation, lifecycle-hook, observability, and recovery pipeline.
 *
 * The JavaScript itself runs in a short-lived child process. This matters even
 * with `node:vm`: a promise continuation can otherwise keep the main event loop
 * busy after vm's synchronous timeout. The parent can always terminate the
 * child, and recent Node versions add the permission model as defense in depth.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { BaseTool, type ParameterDefinition } from './base-tool.js';
import type { IToolExecutionContext, IValidationResult } from './registry/types.js';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Public runtime contract
// ============================================================================

export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

/** Per-agent/per-session bridge injected by ToolHandler for one invocation. */
export interface CodeExecRuntime {
  /** Stable isolation key. Include both the owning agent and current session. */
  scopeId: string;
  sessionId?: string;
  agentId?: string;
  cwd?: string;
  availableTools: readonly string[];
  executor: ToolExecutor;
  abortSignal?: AbortSignal;
}

export const CODE_EXEC_RUNTIME_CONTEXT_KEY = 'codeExecRuntime';

/** Attach a runtime without changing any other tool-execution context data. */
export function attachCodeExecRuntime(
  context: IToolExecutionContext,
  runtime: CodeExecRuntime,
): IToolExecutionContext {
  return {
    ...context,
    extra: {
      ...context.extra,
      [CODE_EXEC_RUNTIME_CONTEXT_KEY]: runtime,
    },
  };
}

function runtimeFromContext(context?: IToolExecutionContext): CodeExecRuntime | null {
  const candidate = context?.extra?.[CODE_EXEC_RUNTIME_CONTEXT_KEY];
  if (!candidate || typeof candidate !== 'object') return null;
  const runtime = candidate as Partial<CodeExecRuntime>;
  if (
    typeof runtime.scopeId !== 'string' ||
    typeof runtime.executor !== 'function' ||
    !Array.isArray(runtime.availableTools)
  ) {
    return null;
  }
  return runtime as CodeExecRuntime;
}

// ============================================================================
// Limits and scoped state
// ============================================================================

export const CODE_EXEC_LIMITS = Object.freeze({
  defaultTimeoutMs: 30_000,
  minTimeoutMs: 100,
  maxTimeoutMs: 60_000,
  maxCodeChars: 256 * 1024,
  maxOutputChars: 50_000,
  maxErrorChars: 10_000,
  maxToolResultChars: 100_000,
  maxToolCalls: 64,
  maxAvailableTools: 512,
  maxStoreEntries: 128,
  maxStoreBytes: 256 * 1024,
  maxScopes: 128,
  scopeTtlMs: 2 * 60 * 60 * 1000,
});

interface ScopedState {
  scopeId: string;
  sessionId?: string;
  agentId?: string;
  values: Map<string, unknown>;
  lastAccess: number;
}

const scopedStates = new Map<string, ScopedState>();

/** Backward-compatible direct-use runtime. Production ToolHandler never uses it. */
let legacySessionId = 'default';
let legacyExecutor: ToolExecutor | null = null;
let legacyAvailableTools: string[] = [];

function legacyScopeId(): string {
  return `legacy:${legacySessionId}`;
}

function pruneScopedStates(now = Date.now()): void {
  for (const [key, state] of scopedStates) {
    if (now - state.lastAccess > CODE_EXEC_LIMITS.scopeTtlMs) {
      scopedStates.delete(key);
    }
  }

  while (scopedStates.size >= CODE_EXEC_LIMITS.maxScopes) {
    let oldestKey: string | null = null;
    let oldestAccess = Number.POSITIVE_INFINITY;
    for (const [key, state] of scopedStates) {
      if (state.lastAccess < oldestAccess) {
        oldestKey = key;
        oldestAccess = state.lastAccess;
      }
    }
    if (!oldestKey) break;
    scopedStates.delete(oldestKey);
  }
}

function getScopedState(runtime: CodeExecRuntime): ScopedState {
  const now = Date.now();
  pruneScopedStates(now);
  let state = scopedStates.get(runtime.scopeId);
  if (!state) {
    state = {
      scopeId: runtime.scopeId,
      sessionId: runtime.sessionId,
      agentId: runtime.agentId,
      values: new Map(),
      lastAccess: now,
    };
    scopedStates.set(runtime.scopeId, state);
  }
  state.lastAccess = now;
  return state;
}

/** Set the direct-use session. Prefer ToolHandler's scoped runtime in production. */
export function setCodeExecSession(sessionId: string): void {
  legacySessionId = sessionId.trim() || 'default';
}

export function clearCodeExecSession(sessionId: string): void {
  for (const [key, state] of scopedStates) {
    if (state.sessionId === sessionId || key === `legacy:${sessionId}`) {
      scopedStates.delete(key);
    }
  }
}

export function clearAllCodeExecSessions(): void {
  scopedStates.clear();
  legacySessionId = 'default';
}

/**
 * Legacy direct-use injection retained for embedders. ToolHandler injects a
 * per-instance executor through IToolExecutionContext and never calls this.
 */
export function setCodeModeToolExecutor(executor: ToolExecutor, tools: string[]): void {
  legacyExecutor = executor;
  legacyAvailableTools = [...tools];
}

export function resetCodeModeState(): void {
  scopedStates.delete(legacyScopeId());
}

// ============================================================================
// Static validation
// ============================================================================

const FORBIDDEN_CODE_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(?:require|module|exports)\b/, reason: 'Node module access is not available' },
  { pattern: /(?<![.$\w])process\b/, reason: 'process access is not available' },
  { pattern: /\b(?:globalThis|global|Buffer|WebAssembly)\b/, reason: 'Node/runtime globals are not available' },
  { pattern: /\b(?:eval|Function)\s*\(/, reason: 'dynamic code generation is disabled' },
  { pattern: /\bimport\s*\(/, reason: 'dynamic imports are disabled' },
  { pattern: /(?:constructor|__proto__)/, reason: 'prototype-chain access is disabled' },
  { pattern: /\b(?:Object|Reflect)\s*\.\s*(?:getPrototypeOf|setPrototypeOf|construct)\b/, reason: 'prototype reflection is disabled' },
  { pattern: /\b(?:fetch|XMLHttpRequest|WebSocket)\b/, reason: 'network access must use a registered tool' },
];

function validateCode(code: string): string | null {
  if (code.length > CODE_EXEC_LIMITS.maxCodeChars) {
    return `code exceeds the ${CODE_EXEC_LIMITS.maxCodeChars}-character limit`;
  }
  // Feature detection is harmless and preserves the historical contract
  // (`text(typeof process)` reports `undefined`) without permitting access.
  const codeToScan = code.replace(/\btypeof\s+process\b/g, 'undefined');
  for (const rule of FORBIDDEN_CODE_PATTERNS) {
    if (rule.pattern.test(codeToScan)) return rule.reason;
  }
  return null;
}

function normalizeTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CODE_EXEC_LIMITS.defaultTimeoutMs;
  }
  return Math.max(
    CODE_EXEC_LIMITS.minTimeoutMs,
    Math.min(CODE_EXEC_LIMITS.maxTimeoutMs, Math.trunc(value)),
  );
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = `\n…[truncated ${value.length - limit} chars]`;
  return value.slice(0, Math.max(0, limit - marker.length)) + marker;
}

function jsonSafe(value: unknown): unknown {
  const seen = new WeakSet<object>();
  try {
    const encoded = JSON.stringify(value, (_key, current: unknown) => {
      if (typeof current === 'bigint') return current.toString();
      if (typeof current === 'function' || typeof current === 'symbol') return undefined;
      if (current && typeof current === 'object') {
        if (seen.has(current)) return '[Circular]';
        seen.add(current);
      }
      return current;
    });
    if (encoded === undefined) return null;
    if (encoded.length > CODE_EXEC_LIMITS.maxToolResultChars) {
      return {
        truncated: true,
        preview: truncate(encoded, CODE_EXEC_LIMITS.maxToolResultChars),
      };
    }
    return JSON.parse(encoded) as unknown;
  } catch {
    return String(value);
  }
}

function serializeToolResult(result: ToolResult): string {
  const payload = result.success
    ? (result.output ?? result.data ?? '')
    : { error: truncate(result.error ?? 'Tool execution failed', CODE_EXEC_LIMITS.maxErrorChars) };
  return JSON.stringify(jsonSafe(payload));
}

function sanitizeToolName(name: string): string {
  const replaced = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  if (!replaced) return '_tool';
  return /^[a-zA-Z_$]/.test(replaced) ? replaced : `_${replaced}`;
}

interface ToolBinding {
  exposedName: string;
  toolName: string;
}

function buildToolBindings(toolNames: readonly string[]): ToolBinding[] {
  const bindings: ToolBinding[] = [];
  const seenTools = new Set<string>();
  const seenBindings = new Set<string>(['call']);

  for (const toolName of toolNames) {
    if (bindings.length >= CODE_EXEC_LIMITS.maxAvailableTools) break;
    if (
      typeof toolName !== 'string' ||
      !toolName ||
      toolName === 'code_exec' ||
      toolName === 'exec' ||
      seenTools.has(toolName)
    ) {
      continue;
    }
    seenTools.add(toolName);
    const exposedName = sanitizeToolName(toolName);
    if (seenBindings.has(exposedName)) continue;
    seenBindings.add(exposedName);
    bindings.push({ exposedName, toolName });
  }
  return bindings;
}

// ============================================================================
// Child runner
// ============================================================================

/**
 * Kept inline so compiled and source-mode installs behave identically. User
 * code arrives over IPC, never on argv. The child has a scrubbed environment,
 * a small heap, and (when supported by the running Node) `--permission`.
 */
const SANDBOX_RUNNER_SOURCE = String.raw`
'use strict';
const vm = require('node:vm');
const Module = require('node:module');

// Defense in depth if code ever crosses the vm boundary. All actual effects
// still live in the parent ToolHandler.
const blockedModules = new Set([
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'child_process', 'node:child_process', 'worker_threads', 'node:worker_threads',
  'net', 'node:net', 'tls', 'node:tls', 'http', 'node:http', 'https', 'node:https',
  'dgram', 'node:dgram', 'dns', 'node:dns', 'cluster', 'node:cluster',
]);
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (blockedModules.has(request)) throw new Error('Module access denied');
  return originalLoad.call(this, request, parent, isMain);
};
try { process.env = Object.create(null); } catch {}
try { Object.defineProperty(process, 'binding', { value: undefined }); } catch {}
try { Object.defineProperty(process, '_linkedBinding', { value: undefined }); } catch {}
try { Object.defineProperty(process, 'getBuiltinModule', { value: undefined }); } catch {}

const pending = new Map();
let nextCallId = 1;
let toolCalls = 0;

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.send) return reject(new Error('IPC bridge unavailable'));
    process.send(message, (error) => error ? reject(error) : resolve());
  });
}

function bridgeCall(toolName, argsJson) {
  if (toolCalls >= ${CODE_EXEC_LIMITS.maxToolCalls}) {
    return Promise.reject(new Error('code_exec tool-call limit reached'));
  }
  toolCalls += 1;
  const id = nextCallId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ type: 'tool_call', id, toolName, argsJson }).catch((error) => {
      pending.delete(id);
      reject(error);
    });
  });
}
Object.setPrototypeOf(bridgeCall, null);

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'tool_result') {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message.valueJson);
    else waiter.reject(new Error(message.error || 'Tool bridge failed'));
    return;
  }
  if (message.type === 'execute') void execute(message);
});

async function execute(message) {
  const outputLimit = ${CODE_EXEC_LIMITS.maxOutputChars};
  const storeEntries = JSON.stringify(message.storeEntries || []);
  const toolBindings = JSON.stringify(message.toolBindings || []);
  const allTools = JSON.stringify((message.toolBindings || []).map((entry) => entry.toolName));
  const bootstrap =
    'const __cbOutput = []; let __cbOutputLength = 0; let __cbTruncated = false; let __cbYielded = false;' +
    'const __cbStore = new Map(' + storeEntries + ');' +
    'const __cbBindings = ' + toolBindings + ';' +
    'const __cbBridge = globalThis.__codeBuddyBridge; delete globalThis.__codeBuddyBridge;' +
    'function __cbFormat(value) { if (typeof value === "string") return value; try { const json = JSON.stringify(value); return json === undefined ? String(value) : json; } catch { return String(value); } }' +
    'function __cbAppend(values, prefix = "") { if (__cbTruncated) return; const line = prefix + values.map(__cbFormat).join(" "); const separator = __cbOutput.length ? "\\n" : ""; const remaining = ' + outputLimit + ' - __cbOutputLength; if (remaining <= 0) { __cbTruncated = true; return; } const next = separator + line; if (next.length > remaining) { __cbOutput.push(next.slice(0, remaining)); __cbOutputLength += remaining; __cbTruncated = true; return; } __cbOutput.push(next); __cbOutputLength += next.length; }' +
    'function text(content) { __cbAppend([content]); }' +
    'function store(key, value) { if (typeof key !== "string" || key.length === 0 || key.length > 256) throw new Error("store key must be 1..256 characters"); const encoded = JSON.stringify(value); if (encoded === undefined) throw new Error("store values must be JSON-compatible"); const cloned = JSON.parse(encoded); const candidate = new Map(__cbStore); candidate.set(key, cloned); if (candidate.size > ${CODE_EXEC_LIMITS.maxStoreEntries}) throw new Error("store entry limit reached"); const total = JSON.stringify(Array.from(candidate.entries())).length; if (total > ${CODE_EXEC_LIMITS.maxStoreBytes}) throw new Error("store byte limit reached"); __cbStore.set(key, cloned); }' +
    'function load(key) { const value = __cbStore.get(key); return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }' +
    'function yield_control() { __cbYielded = true; }' +
    'const tools = Object.create(null);' +
    'for (const binding of __cbBindings) { tools[binding.exposedName] = async function(args = {}) { const encoded = JSON.stringify(args); if (encoded === undefined || args === null || typeof args !== "object" || Array.isArray(args)) throw new Error("tool arguments must be a JSON object"); return JSON.parse(await __cbBridge(binding.toolName, encoded)); }; }' +
    'tools.call = async function(name, args = {}) { if (typeof name !== "string") throw new Error("tool name must be a string"); const binding = __cbBindings.find((entry) => entry.toolName === name); if (!binding) throw new Error("tool is not available: " + name); const encoded = JSON.stringify(args); if (encoded === undefined || args === null || typeof args !== "object" || Array.isArray(args)) throw new Error("tool arguments must be a JSON object"); return JSON.parse(await __cbBridge(binding.toolName, encoded)); };' +
    'Object.freeze(tools); Object.freeze(__cbBindings);' +
    'const ALL_TOOLS = Object.freeze(' + allTools + ');' +
    'const console = Object.freeze({ log: (...args) => __cbAppend(args), error: (...args) => __cbAppend(args, "[ERROR] "), warn: (...args) => __cbAppend(args, "[WARN] ") });';

  const sandbox = Object.create(null);
  sandbox.__codeBuddyBridge = bridgeCall;
  const context = vm.createContext(sandbox, {
    name: 'codebuddy-code-exec',
    codeGeneration: { strings: false, wasm: false },
  });

  try {
    new vm.Script(bootstrap).runInContext(context, { timeout: Math.min(message.timeoutMs, 5_000) });
    const wrapped = '(async () => { "use strict";\n' + message.code + '\n})()';
    const promise = new vm.Script(wrapped, { filename: 'code_exec.js' })
      .runInContext(context, { timeout: message.timeoutMs });
    await promise;
    const snapshotJson = new vm.Script(
      'JSON.stringify({ output: __cbOutput.join(""), truncated: __cbTruncated, yielded: __cbYielded, storeEntries: Array.from(__cbStore.entries()) })',
    ).runInContext(context, { timeout: 1_000 });
    await send({ type: 'done', snapshotJson });
  } catch (error) {
    let partialOutput = '';
    try {
      partialOutput = new vm.Script('__cbOutput.join("")').runInContext(context, { timeout: 250 });
    } catch {}
    await send({
      type: 'failed',
      error: error && error.message ? String(error.message) : String(error),
      partialOutput,
    }).catch(() => {});
  } finally {
    setImmediate(() => process.exit(0));
  }
}
`;

interface RunnerSnapshot {
  output: string;
  truncated: boolean;
  yielded: boolean;
  storeEntries: Array<[string, unknown]>;
}

type RunnerMessage =
  | { type: 'tool_call'; id: number; toolName: string; argsJson: string }
  | { type: 'done'; snapshotJson: string }
  | { type: 'failed'; error: string; partialOutput?: string };

function childExecArgs(): string[] {
  const flags = process.allowedNodeEnvironmentFlags;
  const args = ['--max-old-space-size=96'];
  if (flags.has('--disable-proto')) args.push('--disable-proto=throw');
  if (flags.has('--no-addons')) args.push('--no-addons');
  if (flags.has('--permission')) args.push('--permission');
  else if (flags.has('--experimental-permission')) args.push('--experimental-permission');
  args.push('-e', SANDBOX_RUNNER_SOURCE);
  return args;
}

function terminateChild(child: ChildProcess): void {
  try {
    if (child.connected) child.disconnect();
  } catch { /* already disconnected */ }
  try {
    if (!child.killed) child.kill('SIGKILL');
  } catch { /* already exited */ }
}

interface ChildRunResult {
  success: boolean;
  output: string;
  yielded?: boolean;
  storeEntries?: Array<[string, unknown]>;
  timedOut?: boolean;
}

async function runInChild(
  code: string,
  timeoutMs: number,
  runtime: CodeExecRuntime,
  state: ScopedState,
): Promise<ChildRunResult> {
  const toolBindings = buildToolBindings(runtime.availableTools);
  const allowedTools = new Set(toolBindings.map((binding) => binding.toolName));

  return await new Promise<ChildRunResult>((resolve) => {
    let settled = false;
    let stderr = '';
    let toolQueue = Promise.resolve();
    const child = spawn(process.execPath, childExecArgs(), {
      cwd: runtime.cwd || process.cwd(),
      env: {
        HOME: '/nonexistent',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        NODE_NO_WARNINGS: '1',
        PATH: process.env.PATH ?? '',
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
      windowsHide: true,
    });

    const finish = (result: ChildRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runtime.abortSignal?.removeEventListener('abort', onAbort);
      terminateChild(child);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        success: false,
        timedOut: true,
        output: `Script timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    const onAbort = (): void => {
      finish({ success: false, output: 'Script cancelled' });
    };
    if (runtime.abortSignal?.aborted) {
      onAbort();
      return;
    }
    runtime.abortSignal?.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length < 4_096) stderr += String(chunk).slice(0, 4_096 - stderr.length);
    });

    child.on('error', (error) => {
      finish({ success: false, output: `Sandbox process failed: ${error.message}` });
    });

    child.on('exit', (codeValue, signal) => {
      if (settled) return;
      const detail = stderr.trim() || `exit=${codeValue ?? 'null'} signal=${signal ?? 'none'}`;
      finish({ success: false, output: `Sandbox process exited before completion: ${detail}` });
    });

    child.on('message', (raw: unknown) => {
      const message = raw as RunnerMessage;
      if (!message || typeof message !== 'object' || settled) return;

      if (message.type === 'tool_call') {
        toolQueue = toolQueue.then(async () => {
          if (settled || !child.connected) return;
          if (
            !allowedTools.has(message.toolName) ||
            message.toolName === 'code_exec' ||
            message.toolName === 'exec'
          ) {
            child.send({
              type: 'tool_result',
              id: message.id,
              ok: false,
              error: `Tool is not available from code_exec: ${message.toolName}`,
            });
            return;
          }

          let args: Record<string, unknown>;
          try {
            const parsed = JSON.parse(message.argsJson) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('arguments must be an object');
            }
            args = parsed as Record<string, unknown>;
          } catch (error) {
            child.send({
              type: 'tool_result',
              id: message.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
            return;
          }

          try {
            const result = await runtime.executor(message.toolName, args);
            if (!settled && child.connected) {
              child.send({
                type: 'tool_result',
                id: message.id,
                ok: true,
                valueJson: serializeToolResult(result),
              });
            }
          } catch (error) {
            if (!settled && child.connected) {
              child.send({
                type: 'tool_result',
                id: message.id,
                ok: false,
                error: truncate(
                  error instanceof Error ? error.message : String(error),
                  CODE_EXEC_LIMITS.maxErrorChars,
                ),
              });
            }
          }
        }).catch((error) => {
          logger.debug('code_exec tool bridge queue failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }

      if (message.type === 'done') {
        try {
          const snapshot = JSON.parse(message.snapshotJson) as RunnerSnapshot;
          if (!Array.isArray(snapshot.storeEntries)) throw new Error('invalid store snapshot');
          finish({
            success: true,
            output: truncate(String(snapshot.output ?? ''), CODE_EXEC_LIMITS.maxOutputChars),
            yielded: snapshot.yielded === true,
            storeEntries: snapshot.storeEntries,
          });
        } catch (error) {
          finish({
            success: false,
            output: `Invalid sandbox response: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        return;
      }

      if (message.type === 'failed') {
        const partial = message.partialOutput ? `\n\n${message.partialOutput}` : '';
        finish({
          success: false,
          output: truncate(
            `Script failed: ${message.error}${partial}`,
            CODE_EXEC_LIMITS.maxErrorChars,
          ),
        });
      }
    });

    child.send({
      type: 'execute',
      code,
      timeoutMs,
      toolBindings,
      storeEntries: Array.from(state.values.entries()),
    }, (error) => {
      if (error) finish({ success: false, output: `Sandbox IPC failed: ${error.message}` });
    });
  });
}

// ============================================================================
// Formal registry adapter
// ============================================================================

export class CodeExecTool extends BaseTool {
  readonly name = 'code_exec';
  readonly description =
    'Execute bounded JavaScript orchestration. Call registered tools with await tools.<name>({...}) or await tools.call(name, {...}); use text(), store()/load(), ALL_TOOLS, and yield_control(). Effects still pass through normal confirmations and policies.';

  protected category = 'utility' as const;
  protected keywords = ['code', 'javascript', 'orchestration', 'tools', 'exec', 'responses-lite'];
  protected priority = 9;

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      code: {
        type: 'string',
        description: 'JavaScript orchestration code. Use await tools.<name>({...}) for effects.',
        required: true,
      },
      timeout_ms: {
        type: 'number',
        description: `Execution timeout in milliseconds (${CODE_EXEC_LIMITS.minTimeoutMs}..${CODE_EXEC_LIMITS.maxTimeoutMs}, default ${CODE_EXEC_LIMITS.defaultTimeoutMs}).`,
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const base = super.validate(input);
    if (!base.valid) return base;
    const args = input as Record<string, unknown>;
    const code = args.code;
    if (typeof code !== 'string' || code.trim().length === 0) {
      return { valid: false, errors: ['code must be a non-empty string'] };
    }
    const validationError = validateCode(code);
    if (validationError) return { valid: false, errors: [validationError] };
    if (
      args.timeout_ms !== undefined &&
      (typeof args.timeout_ms !== 'number' ||
        !Number.isFinite(args.timeout_ms) ||
        args.timeout_ms < CODE_EXEC_LIMITS.minTimeoutMs ||
        args.timeout_ms > CODE_EXEC_LIMITS.maxTimeoutMs)
    ) {
      return {
        valid: false,
        errors: [`timeout_ms must be between ${CODE_EXEC_LIMITS.minTimeoutMs} and ${CODE_EXEC_LIMITS.maxTimeoutMs}`],
      };
    }
    return { valid: true };
  }

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    const validation = this.validate(input);
    if (!validation.valid) return this.error(validation.errors?.join('; ') ?? 'Invalid input');

    const code = input.code as string;
    const timeoutMs = normalizeTimeout(input.timeout_ms);
    const injectedRuntime = runtimeFromContext(context);
    const runtime: CodeExecRuntime = injectedRuntime ?? {
      scopeId: legacyScopeId(),
      sessionId: legacySessionId,
      cwd: context?.cwd ?? process.cwd(),
      availableTools: legacyAvailableTools,
      executor: legacyExecutor ?? (async (toolName) => ({
        success: false,
        error: `No ToolHandler executor is attached for ${toolName}`,
      })),
    };

    const state = getScopedState(runtime);
    const startedAt = Date.now();
    const childResult = await runInChild(code, timeoutMs, runtime, state);
    const elapsed = Date.now() - startedAt;

    if (!childResult.success) {
      logger.debug('code_exec failed', {
        scopeId: runtime.scopeId,
        timedOut: childResult.timedOut === true,
        elapsed,
      });
      return this.error(truncate(childResult.output, CODE_EXEC_LIMITS.maxErrorChars));
    }

    // Commit state transactionally only after a successful script.
    if (childResult.storeEntries) {
      state.values = new Map(childResult.storeEntries);
      state.lastAccess = Date.now();
    }

    const status = childResult.yielded
      ? `Script yielded control after ${elapsed}ms`
      : `Script completed in ${elapsed}ms`;
    const output = childResult.output ? `${status}\n\n${childResult.output}` : status;
    return this.success(truncate(output, CODE_EXEC_LIMITS.maxOutputChars));
  }
}

/** Factory used by all FormalToolRegistry assembly paths. */
export function createCodeExecTools(): CodeExecTool[] {
  return [new CodeExecTool()];
}

/** Stable helper for ToolHandler-generated nested call IDs (max 64 chars). */
export function createCodeExecToolCallId(): string {
  return `code_${randomUUID()}`;
}
