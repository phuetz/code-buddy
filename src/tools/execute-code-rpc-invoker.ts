/**
 * execute_code → Code Buddy tool RPC invoker (opt-in, OFF by default).
 *
 * Hermes parity (`delegation-parallelism`): generated code run by
 * `execute_code` may call back into a *small, read-only* set of Code
 * Buddy tools via RPC. This module owns the **policy + execution** half
 * of that channel; the runner (`execute-code-runner.ts`) owns the
 * transport (file framing, call-count bound, per-call timeout).
 *
 * Security model — fail closed at every gate, in order:
 *   1. **Master flag** — disabled unless `CODEBUDDY_EXECUTE_CODE_TOOL_RPC`
 *      is truthy (`true`/`1`/`yes`/`on`). Enforced by the runner BEFORE
 *      this invoker is ever constructed, so a child process can never
 *      flip it on. When off, the runner still answers every request with
 *      a structured denial (never a hang).
 *   2. **Allowlist** — `tool ∈ {view_file, list_directory, search}`,
 *      override via env `CODEBUDDY_EXECUTE_CODE_TOOL_RPC_ALLOWLIST` (csv).
 *   3. **fleetSafe** — the tool's registry metadata must declare
 *      `fleetSafe: true` (read-only by definition).
 *   4. **Per-tool opt-in** — `CODEBUDDY_EXECUTE_CODE_RPC_TOOLS` (csv)
 *      adds specific executor-backed tools to the allowlist. These tools
 *      bypass the `fleetSafe` gate since they are explicitly opted in by the
 *      operator. Each tool name is validated against both the registry and
 *      this module's executor table; unknown or unsupported names are logged
 *      and skipped.
 *
 * No write/exec tool is reachable by default; the default executors
 * below physically only read. Tools added via RPC_TOOLS opt-in are the
 * operator's responsibility. This mirrors the audited
 * `peer-tool-bridge.ts` pattern.
 */

import { spawn } from 'child_process';
import { getRipgrepPath } from '../utils/ripgrep-path.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { getToolRegistry } from './registry.js';

const DEFAULT_ALLOWLIST = ['view_file', 'list_directory', 'search'] as const;
const EXECUTOR_TOOL_NAMES = new Set<string>(DEFAULT_ALLOWLIST);

const READ_TRUNCATE_BYTES = 256 * 1024;
const LIST_DIRECTORY_MAX_ENTRIES = 256;
const SEARCH_TIMEOUT_MS = 30_000;
const SEARCH_MAX_RESULTS = 200;

export interface ExecuteCodeRpcInvokeRequest {
  tool: string;
  args: Record<string, unknown>;
}

export interface ExecuteCodeRpcInvokeResult {
  ok: boolean;
  output?: string;
  error?: string;
  truncated?: boolean;
}

export type ExecuteCodeRpcInvoker = (
  request: ExecuteCodeRpcInvokeRequest,
) => Promise<ExecuteCodeRpcInvokeResult>;

/** Truthy-flag parse — the single master gate. Read once, in the parent. */
export function isExecuteCodeToolRpcEnabled(
  raw: string | undefined = process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC,
): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function getExecuteCodeToolRpcAllowlist(
  raw: string | undefined = process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC_ALLOWLIST,
): Set<string> {
  if (!raw) return new Set(DEFAULT_ALLOWLIST);
  const items = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? new Set(items) : new Set(DEFAULT_ALLOWLIST);
}

/**
 * Parse `CODEBUDDY_EXECUTE_CODE_RPC_TOOLS` — a csv of additional tool names
 * to add to the RPC allowlist. Each name is validated against the registry
 * and this module's executor table; unknown or unsupported names are logged
 * as warnings and silently skipped so a typo never opens an unintended tool.
 *
 * Tools listed here bypass the `fleetSafe` gate because the operator
 * explicitly opted them in — requiring `fleetSafe: true` would defeat
 * the purpose of this escape hatch.
 */
export function getExecuteCodeRpcExtraTools(
  raw: string | undefined = process.env.CODEBUDDY_EXECUTE_CODE_RPC_TOOLS,
  isRegistered: (name: string) => boolean = (name) => !!getToolRegistry().getTool(name),
  hasExecutor: (name: string) => boolean = (name) => EXECUTOR_TOOL_NAMES.has(name),
): Set<string> {
  if (!raw) return new Set();
  const items = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const validated = new Set<string>();
  for (const name of items) {
    if (!isRegistered(name)) {
      logger.warn('[execute-code-rpc] CODEBUDDY_EXECUTE_CODE_RPC_TOOLS: unknown tool, skipping', { tool: name });
      continue;
    }
    if (!hasExecutor(name)) {
      logger.warn('[execute-code-rpc] CODEBUDDY_EXECUTE_CODE_RPC_TOOLS: tool has no execute_code RPC executor, skipping', { tool: name });
      continue;
    }
    validated.add(name);
  }
  return validated;
}

interface InvokerOptions {
  /** Root the read-only executors are confined to. Defaults to cwd. */
  workspaceRoot: string;
  allowlist?: Set<string>;
  isFleetSafe?: (name: string) => boolean;
  /**
   * Additional tools to allow through RPC, bypassing the fleetSafe gate.
   * Parsed from `CODEBUDDY_EXECUTE_CODE_RPC_TOOLS` by default.
   */
  extraTools?: Set<string>;
}

/**
 * Build the policy-gated invoker. The master flag is intentionally NOT
 * read here — the runner only constructs an invoker once it has already
 * decided RPC is enabled, keeping the flag boundary in the parent.
 */
export function createExecuteCodeRpcInvoker(options: InvokerOptions): ExecuteCodeRpcInvoker {
  const baseAllowlist = options.allowlist ?? getExecuteCodeToolRpcAllowlist();
  const extraTools = options.extraTools ?? getExecuteCodeRpcExtraTools();
  const combinedAllowlist = new Set([...baseAllowlist, ...extraTools]);
  const isFleetSafe = options.isFleetSafe ?? ((name: string) => getToolRegistry().isFleetSafe(name));
  const workspaceRoot = path.resolve(options.workspaceRoot);

  return async (request) => {
    const tool = request.tool;
    try {
      if (!combinedAllowlist.has(tool)) {
        return {
          ok: false,
          error: `TOOL_NOT_ALLOWED_FOR_EXECUTE_CODE_RPC: tool "${tool}" is not in the execute_code RPC allowlist`,
        };
      }
      // Tools explicitly opted in via CODEBUDDY_EXECUTE_CODE_RPC_TOOLS
      // bypass the fleetSafe gate — the operator accepted responsibility.
      if (!extraTools.has(tool) && !isFleetSafe(tool)) {
        return {
          ok: false,
          error: `TOOL_NOT_FLEET_SAFE: tool "${tool}" lacks fleetSafe metadata`,
        };
      }
      const executor = EXECUTORS[tool];
      if (!executor) {
        return { ok: false, error: `UNKNOWN_EXECUTE_CODE_RPC_TOOL: no executor for "${tool}"` };
      }
      const { output, truncated } = await executor(request.args, workspaceRoot);
      logger.debug('[execute-code-rpc] tool executed', { tool, truncated });
      return { ok: true, output, truncated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[execute-code-rpc] tool execution failed', { tool, error: message });
      return { ok: false, error: message };
    }
  };
}

// ──────────────────────────────────────────────────────────────────
// Read-only executors (confined to workspaceRoot — fail closed)
// ──────────────────────────────────────────────────────────────────

type Executor = (
  args: Record<string, unknown>,
  workspaceRoot: string,
) => Promise<{ output: string; truncated: boolean }>;

function assertInsideWorkspace(target: string, workspaceRoot: string): string {
  const absolute = path.isAbsolute(target) ? path.resolve(target) : path.resolve(workspaceRoot, target);
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
  if (absolute !== workspaceRoot && !absolute.startsWith(rootWithSep)) {
    throw new Error(`PATH_OUTSIDE_WORKSPACE: ${target} resolves outside the execute_code workspace`);
  }
  return absolute;
}

const execViewFile: Executor = async (args, workspaceRoot) => {
  const filePath = args.file_path ?? args.path;
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('view_file: missing string file_path');
  }
  const resolved = assertInsideWorkspace(filePath, workspaceRoot);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error(`view_file: ${filePath} is not a regular file`);
  }
  const truncated = stat.size > READ_TRUNCATE_BYTES;
  const limit = Math.min(stat.size, READ_TRUNCATE_BYTES);
  if (limit <= 0) return { output: '', truncated };
  const handle = await fs.open(resolved, 'r');
  try {
    const buffer = Buffer.allocUnsafe(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return { output: buffer.subarray(0, bytesRead).toString('utf-8'), truncated };
  } finally {
    await handle.close();
  }
};

const execListDirectory: Executor = async (args, workspaceRoot) => {
  const dirPath = args.path ?? args.directory ?? '.';
  if (typeof dirPath !== 'string') {
    throw new Error('list_directory: path must be a string');
  }
  const resolved = assertInsideWorkspace(dirPath, workspaceRoot);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const lines = entries
    .map((entry) => {
      const tag = entry.isDirectory() ? 'DIR ' : entry.isSymbolicLink() ? 'LINK' : 'FILE';
      return `${tag}  ${entry.name}`;
    })
    .sort();
  const truncated = lines.length > LIST_DIRECTORY_MAX_ENTRIES;
  const visible = truncated ? lines.slice(0, LIST_DIRECTORY_MAX_ENTRIES) : lines;
  return { output: visible.join('\n'), truncated };
};

const execSearch: Executor = async (args, workspaceRoot) => {
  const query = args.query ?? args.pattern;
  const dirPath = args.path ?? '.';
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('search: missing string query/pattern');
  }
  if (typeof dirPath !== 'string') {
    throw new Error('search: path must be a string');
  }
  const resolved = assertInsideWorkspace(dirPath, workspaceRoot);
  return await new Promise<{ output: string; truncated: boolean }>((resolve, reject) => {
    const rgArgs = ['--no-heading', '--line-number', '--color', 'never', '--max-count', '50', '--', query, resolved];
    const proc = spawn(getRipgrepPath(), rgArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let lineCount = 0;
    let truncated = false;
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error(`SEARCH_TIMEOUT: ripgrep did not finish within ${SEARCH_TIMEOUT_MS}ms`));
    }, SEARCH_TIMEOUT_MS);
    timer.unref?.();
    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        if (lineCount >= SEARCH_MAX_RESULTS) {
          truncated = true;
          continue;
        }
        stdout += line + '\n';
        lineCount += 1;
      }
    });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString('utf-8'); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === 1 || (truncated && lineCount > 0)) {
        resolve({ output: stdout, truncated });
      } else {
        reject(new Error(`SEARCH_FAILED: ripgrep exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
};

const EXECUTORS: Record<string, Executor> = {
  view_file: execViewFile,
  list_directory: execListDirectory,
  search: execSearch,
};
