/**
 * Peer tool bridge — Phase (d).23 / V1.3.
 *
 * Registers `peer.tool.invoke` + `peer.tool.invoke.stream` on the
 * peer-rpc registry. Lets a remote peer Code Buddy invoke a small
 * read-only tool on THIS peer's filesystem. Pattern mirrors
 * `peer-chat-bridge.ts` (wire/unwire idempotency, throw → METHOD_ERROR).
 *
 * Three gates run on every invocation, in this order:
 *   1. Allowlist V1 — `tool ∈ {view_file, list_directory, search}`,
 *      override via env `CODEBUDDY_PEER_TOOL_ALLOWLIST` (csv).
 *   2. Registry `fleetSafe` flag — `getToolRegistry().isFleetSafe(name)`.
 *   3. Workspace root — every path argument must resolve under
 *      `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`. If the env is unset, the
 *      bridge fails closed (PEER_WORKSPACE_NOT_CONFIGURED) so a
 *      misconfigured peer can't accidentally expose `/`.
 *
 * Streaming: `.stream` requires `ctx.emitChunk` (provided by the WS
 * transport). For `view_file` it emits 16 KB chunks while reading; for
 * `search` it emits ripgrep matches line-by-line.
 *
 * Depth cap (`CODEBUDDY_PEER_MAX_DEPTH`) and role-leaf are inherited
 * from `dispatchPeerRequest` — no extra wiring here.
 */

import { spawn } from 'child_process';
import { rgPath } from '@vscode/ripgrep';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import {
  registerPeerMethod,
  unregisterPeerMethod,
  type PeerMethodContext,
} from '../server/websocket/peer-rpc.js';
import { logger } from '../utils/logger.js';
import { getToolRegistry } from '../tools/registry.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { auditLogger } from '../security/audit-logger.js';
import { assertPeerToolInvokeAllowed } from './permissions.js';
import { getGlobalEventBus } from '../events/event-bus.js';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

interface PeerToolInvokeResult {
  tool: string;
  output: string;
  durationMs: number;
  truncated?: boolean;
}

interface ExecArgs {
  args: Record<string, unknown>;
  emitChunk?: (delta: string) => void;
}

type Executor = (input: ExecArgs) => Promise<{ output: string; truncated?: boolean }>;

// ──────────────────────────────────────────────────────────────────
// Allowlist & gates
// ──────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | null {
  const raw = process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
  return raw ? path.resolve(raw) : null;
}

function assertToolAllowed(name: string, scopes?: string[]): void {
  assertPeerToolInvokeAllowed({
    toolName: name,
    scopes,
    fleetSafe: getToolRegistry().isFleetSafe(name),
  });
}

async function assertPathInsideWorkspace(p: string): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error(
      'PEER_WORKSPACE_NOT_CONFIGURED: set CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT before exposing peer.tool.invoke',
    );
  }
  const absolute = path.isAbsolute(p) ? p : path.resolve(root, p);
  const rootResolved = await fs.realpath(root).catch(() => root);
  const resolved = await realpathFollowingExistingAncestors(absolute);
  if (!isPathInsideOrEqual(resolved, rootResolved)) {
    throw new Error(
      `PATH_OUTSIDE_PEER_WORKSPACE: ${p} resolves to ${resolved}, outside ${rootResolved}`,
    );
  }
  return resolved;
}

function normalizePathForContainment(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  const candidateForCheck = normalizePathForContainment(candidate);
  const rootForCheck = normalizePathForContainment(root);
  if (candidateForCheck === rootForCheck) return true;
  const rootPrefix = rootForCheck.endsWith(path.sep) ? rootForCheck : rootForCheck + path.sep;
  return candidateForCheck.startsWith(rootPrefix);
}

/**
 * Walk up the path until we find an ancestor we can `realpath` (i.e.
 * exists), then re-join the missing tail. This closes the
 * symlink-to-nonexistent-target info-leak: even if the requested file
 * doesn't exist, intermediate symlinks in its path get resolved
 * before the workspace check.
 *
 * Plain `fs.realpath()` throws on missing paths and a naive
 * `catch { return absolute; }` fallback would let a request for
 * `<symlink-to-/etc>/nonexistent` pass the `startsWith(root)` check
 * (the un-followed path string still starts with the workspace root).
 */
async function realpathFollowingExistingAncestors(absolute: string): Promise<string> {
  const tail: string[] = [];
  let cur = absolute;
  for (let i = 0; i < 64; i++) {
    try {
      const real = await fs.realpath(cur);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const symlinkTarget = await resolveDanglingSymlink(cur, tail);
      if (symlinkTarget) return symlinkTarget;
      const parent = path.dirname(cur);
      if (parent === cur) {
        // Reached the filesystem root without finding a real ancestor —
        // can only happen on truly broken paths. Return as-is; the
        // workspace check will reject it the same as any unmounted root.
        return absolute;
      }
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
  return absolute;
}

async function resolveDanglingSymlink(cur: string, tail: string[]): Promise<string | null> {
  try {
    const stat = await fs.lstat(cur);
    if (!stat.isSymbolicLink()) return null;
    const target = await fs.readlink(cur);
    const parent = path.dirname(cur);
    const resolvedTarget = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(parent, target);
    return tail.length === 0
      ? resolvedTarget
      : path.join(resolvedTarget, ...tail.slice().reverse());
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// Standalone executors (read-only V1)
// ──────────────────────────────────────────────────────────────────

const READ_TRUNCATE_BYTES = 256 * 1024; // 256 KB cap per Read
const READ_STREAM_CHUNK = 16 * 1024;          // 16 KB per emitChunk in stream mode
const LIST_DIRECTORY_MAX_ENTRIES = 256;
const SEARCH_TIMEOUT_MS = 30_000;
const SEARCH_MAX_RESULTS = 200;

function stripAnsi(text: string): string {
  if (typeof text !== 'string') return text;
  const esc = String.fromCharCode(27);
  const csi = String.fromCharCode(155);
  const ansiRegex = new RegExp(`[${esc}${csi}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqty=><]`, 'g');
  return text.replace(ansiRegex, '');
}

async function readFilePrefix(filePath: string, limit: number): Promise<string> {
  if (limit <= 0) return '';
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}

async function execViewFile({ args, emitChunk }: ExecArgs): Promise<{ output: string; truncated: boolean }> {
  const filePath = args.file_path ?? args.path;
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('view_file: missing string file_path');
  }
  const resolved = await assertPathInsideWorkspace(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error(`view_file: ${filePath} is not a regular file`);
  }
  const truncated = stat.size > READ_TRUNCATE_BYTES;
  const limit = Math.min(stat.size, READ_TRUNCATE_BYTES);

  if (emitChunk) {
    return await new Promise<{ output: string; truncated: boolean }>((resolve, reject) => {
      const stream = createReadStream(resolved, {
        encoding: 'utf-8',
        highWaterMark: READ_STREAM_CHUNK,
        end: limit > 0 ? limit - 1 : 0,
      });
      let total = '';
      stream.on('data', (chunk: string | Buffer) => {
        const s = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        const clean = stripAnsi(s);
        total += clean;
        emitChunk(clean);
      });
      stream.on('end', () => resolve({ output: total, truncated }));
      stream.on('error', (err) => reject(err));
    });
  }

  const output = await readFilePrefix(resolved, limit);
  return { output: stripAnsi(output), truncated };
}

async function execListDirectory({ args }: ExecArgs): Promise<{ output: string; truncated: boolean }> {
  const dirPath = args.path ?? args.directory ?? '.';
  if (typeof dirPath !== 'string') {
    throw new Error('list_directory: path must be a string');
  }
  const resolved = await assertPathInsideWorkspace(dirPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const lines = entries
    .map((e) => {
      const tag = e.isDirectory() ? 'DIR ' : e.isSymbolicLink() ? 'LINK' : 'FILE';
      return `${tag}  ${e.name}`;
    })
    .sort();
  const truncated = lines.length > LIST_DIRECTORY_MAX_ENTRIES;
  const visible = truncated ? lines.slice(0, LIST_DIRECTORY_MAX_ENTRIES) : lines;
  if (truncated) {
    visible.push(`... truncated after ${LIST_DIRECTORY_MAX_ENTRIES} entries (${lines.length} total)`);
  }
  return { output: stripAnsi(visible.join('\n')), truncated };
}

async function execSearch({ args, emitChunk }: ExecArgs): Promise<{ output: string; truncated: boolean }> {
  const query = args.query ?? args.pattern;
  const dirPath = args.path ?? '.';
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('search: missing string query/pattern');
  }
  if (typeof dirPath !== 'string') {
    throw new Error('search: path must be a string');
  }
  const resolved = await assertPathInsideWorkspace(dirPath);

  return await new Promise<{ output: string; truncated: boolean }>((resolve, reject) => {
    const rgArgs = [
      '--no-heading',
      '--line-number',
      '--color', 'never',
      '--max-count', '50',
      '--', query, resolved,
    ];
    const proc = spawn(rgPath, rgArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let lineCount = 0;
    let stdoutBuffer = '';

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error(`SEARCH_TIMEOUT: ripgrep did not finish within ${SEARCH_TIMEOUT_MS}ms`));
    }, SEARCH_TIMEOUT_MS);
    timer.unref?.();

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString('utf-8');
      const lastNl = stdoutBuffer.lastIndexOf('\n');
      if (lastNl === -1) return;
      const ready = stdoutBuffer.slice(0, lastNl + 1);
      stdoutBuffer = stdoutBuffer.slice(lastNl + 1);
      const lines = ready.split('\n').filter(Boolean);
      for (const line of lines) {
        if (lineCount >= SEARCH_MAX_RESULTS) {
          truncated = true;
          continue;
        }
        const cleanLine = stripAnsi(line + '\n');
        stdout += cleanLine;
        lineCount += 1;
        emitChunk?.(cleanLine);
      }
      if (truncated) {
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      }
    });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString('utf-8'); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (stdoutBuffer.length > 0 && lineCount < SEARCH_MAX_RESULTS) {
        const cleanBuf = stripAnsi(stdoutBuffer);
        stdout += cleanBuf;
        emitChunk?.(cleanBuf);
      }
      // ripgrep exit codes: 0 = matches found, 1 = no matches (still ok),
      // 2 = error. SIGTERM after truncation produces null code on some
      // platforms — treat as ok if we got results.
      if (code === 0 || code === 1 || (truncated && lineCount > 0)) {
        resolve({ output: stdout, truncated });
      } else {
        reject(new Error(`SEARCH_FAILED: ripgrep exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

const EXECUTORS: Record<string, Executor> = {
  view_file: execViewFile,
  list_directory: execListDirectory,
  search: execSearch,
};

// ──────────────────────────────────────────────────────────────────
// Wire / unwire (idempotent, mirrors peer-chat-bridge)
// ──────────────────────────────────────────────────────────────────

let wired = false;

export function wirePeerToolBridge(): void {
  if (wired) {
    logger.debug('[peer-tool-bridge] wire() called while already wired — no-op');
    return;
  }

  registerPeerMethod('peer.tool.invoke', async (params, ctx) => {
    return await runInvocation(params, ctx, false);
  });

  registerPeerMethod('peer.tool.invoke.stream', async (params, ctx) => {
    return await runInvocation(params, ctx, true);
  });

  if (!getWorkspaceRoot()) {
    logger.warn(
      '[peer-tool-bridge] CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT is not set — peer.tool.invoke is registered but will fail closed (PEER_WORKSPACE_NOT_CONFIGURED) on every call. Set it to enable remote read-only tool access.',
    );
  }

  wired = true;
  logger.debug('[peer-tool-bridge] wired (peer.tool.invoke + peer.tool.invoke.stream)');
}

export function unwirePeerToolBridge(): void {
  if (!wired) return;
  unregisterPeerMethod('peer.tool.invoke');
  unregisterPeerMethod('peer.tool.invoke.stream');
  wired = false;
  logger.debug('[peer-tool-bridge] unwired');
}

export function isPeerToolBridgeWired(): boolean {
  return wired;
}

/** Test-only reset hook. Force-unwire even if state is desync'd. */
export function _unwireForTests(): void {
  try {
    unregisterPeerMethod('peer.tool.invoke');
    unregisterPeerMethod('peer.tool.invoke.stream');
  } catch {
    /* peer-rpc may not be initialised in some test setups */
  }
  wired = false;
}

async function runInvocation(
  params: Record<string, unknown>,
  ctx: PeerMethodContext,
  stream: boolean,
): Promise<PeerToolInvokeResult> {
  const start = Date.now();
  const tool = typeof params.tool === 'string' ? params.tool : '';
  const argsRaw =
    typeof params.args === 'object' && params.args !== null && !Array.isArray(params.args)
      ? (params.args as Record<string, unknown>)
      : {};

  if (!tool) {
    logAudit({ ctx, tool: '<missing>', stream, ok: false, error: 'missing tool', start });
    throw new Error('peer.tool.invoke: missing string tool name in params.tool');
  }
  if (stream && !ctx.emitChunk) {
    logAudit({ ctx, tool, stream, ok: false, error: 'no emitChunk', start });
    throw new Error('peer.tool.invoke.stream: this transport does not support streaming');
  }

  try {
    assertToolAllowed(tool, ctx.scopes);

    // Evaluate against Policy Engine
    const policyResult = PolicyEngine.getInstance().evaluate({
      capability: 'peer:invoke',
      risk: 'medium',
      detail: { tool, args: argsRaw, peerId: ctx.connectionId },
    });

    if (policyResult.decision === 'deny') {
      throw new Error(`PEER_INVOKE_DENIED: ${policyResult.reason}`);
    }

    if (policyResult.decision === 'needs_approval') {
      const confirmResult = await ConfirmationService.getInstance().requestConfirmation({
        operation: `peer.tool.invoke:${tool}`,
        filename: argsRaw.file_path as string || argsRaw.path as string || '',
        content: `Peer ${ctx.connectionId} requests execution of tool ${tool} with arguments: ${JSON.stringify(argsRaw)}`,
      });
      if (!confirmResult.confirmed) {
        throw new Error(`PEER_INVOKE_DENIED: Human approval was rejected or timed out`);
      }
    }

    const exec = EXECUTORS[tool];
    if (!exec) {
      throw new Error(`UNKNOWN_PEER_TOOL: no executor registered for "${tool}"`);
    }
    const { output, truncated } = await exec({
      args: argsRaw,
      emitChunk: stream ? ctx.emitChunk : undefined,
    });
    logAudit({ ctx, tool, stream, ok: true, start });
    return {
      tool,
      output: stripAnsi(output),
      durationMs: Date.now() - start,
      truncated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logAudit({ ctx, tool, stream, ok: false, error: message, start });
    throw err;
  }
}

function logAudit(input: {
  ctx: PeerMethodContext;
  tool: string;
  stream: boolean;
  ok: boolean;
  error?: string;
  start: number;
}): void {
  try {
    getGlobalEventBus().emit('fleet:activity', {
      
      
      activityType: 'fleet.tool.invoke',
      title: 'Peer Tool Invoked',
      description: input.error 
        ? `Peer ${input.ctx.connectionId} failed to invoke ${input.tool}: ${input.error}`
        : `Peer ${input.ctx.connectionId} invoked ${input.tool}`,
      metadata: { peerId: input.ctx.connectionId, tool: input.tool, ok: input.ok, error: input.error }
    });
  } catch (_err) {
    // ignore
  }
  auditLogger.log({
    action: 'tool_execution',
    decision: input.ok ? 'allow' : 'block',
    source: 'peer-tool-bridge',
    target: input.tool,
    details: input.error
      ? `peer.tool.invoke ${input.stream ? 'stream' : 'call'} failed: ${input.error}`
      : `peer.tool.invoke ${input.stream ? 'stream' : 'call'} succeeded for ${input.ctx.connectionId}`,
    durationMs: Date.now() - input.start,
  });
  logger.info('[fleet] peer.tool.invoke', {
    event: 'peer.tool.invoke',
    from: input.ctx.connectionId,
    traceId: input.ctx.traceId,
    depth: input.ctx.depth,
    tool: input.tool,
    stream: input.stream,
    ok: input.ok,
    error: input.error,
    durationMs: Date.now() - input.start,
  });
}
