/**
 * peer_tool_invoke tool — wraps `peer.tool.invoke` for the local agent.
 *
 * Lets the LLM read/search on a connected fleet peer (view_file,
 * list_directory, search) without going through `peer.chat` (which has
 * no tools). The three security gates stay on the remote peer
 * (`peer-tool-bridge.ts`): allowlist, fleetSafe, workspace root.
 *
 * Extra tool names from `peer.describe` are trusted only when
 * `CODEBUDDY_PEER_TRUST_DESCRIBE=true`. B still enforces its own
 * allowlist even then.
 *
 * This side (A) does not interpret paths and does not add new remote
 * capabilities. Failures always return `success: false`.
 *
 * @module src/tools/peer-tool-invoke-tool
 */

import { getFleetRegistry } from '../fleet/fleet-registry.js';
import { redactSecrets } from '../fleet/privacy-lint.js';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_PEER_TOOL_INVOKE_TOOLS = [
  'view_file',
  'list_directory',
  'search',
] as const;

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_ARGS_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 256 * 1024;
export const MAX_PEER_ID_LENGTH = 128;
export const MAX_TOOL_NAME_LENGTH = 64;

/** Imperative tool description with a concrete call example for local models. */
export const PEER_TOOL_INVOKE_DESCRIPTION =
  'Read or search a file on a connected fleet peer (read-only, allowlist on that peer). ' +
  'Always pass peer and tool; never call with empty arguments. ' +
  'Example: {"peer":"B","tool":"view_file","args":{"path":"oracle.txt"}}. ' +
  'Allowed tools: view_file, list_directory, search. Do not use local view_file for files that live on another peer.';

export const PEER_TOOL_INVOKE_PARAM_DESCRIPTIONS = {
  peer:
    'Required. Connected peer id from list_peers (the --name of /fleet listen). Example: "B".',
  tool:
    'Required. Read-only tool on that peer. Default set: view_file, list_directory, search. Extra names from peer.describe are accepted only when CODEBUDDY_PEER_TRUST_DESCRIBE=true. Example: "view_file".',
  args:
    'Object of arguments for the remote tool. For view_file use {"path":"oracle.txt"} or {"file_path":"oracle.txt"}. For list_directory use {"path":"."}. For search use {"query":"TODO","path":"src"}. Paths are relative to the peer workspace and are not resolved on this host.',
  timeoutMs:
    `Optional timeout in milliseconds. Default ${DEFAULT_TIMEOUT_MS}. Min ${MIN_TIMEOUT_MS}. Max ${MAX_TIMEOUT_MS}.`,
} as const;
const DESCRIBE_TIMEOUT_MS = 3_000;

export const PEER_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ARG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const DENIED_TOOL_PREFIXES = ['peer_', 'fleet_', 'agent_', 'delegate_'] as const;
const DENIED_ARG_KEYS = new Set(['constructor', 'prototype', '__proto__']);

export interface PeerToolInvokeParams {
  peer: string;
  tool: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface PeerToolInvokeData {
  peer: string;
  tool: string;
  output: string;
  durationMs: number;
  truncated?: boolean;
  elapsedMs: number;
}

export type PeerToolInvokeResult = ToolResult & { data?: PeerToolInvokeData };

export function clampPeerToolInvokeTimeout(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  const n = Math.floor(raw);
  if (n < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  return Math.min(n, MAX_TIMEOUT_MS);
}

function isDeniedToolName(name: string): boolean {
  return DENIED_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function trustDescribeExtras(): boolean {
  return process.env.CODEBUDDY_PEER_TRUST_DESCRIBE === 'true';
}

export function isFlatToolArgs(value: unknown): value is Record<string, unknown> {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (DENIED_ARG_KEYS.has(key) || !ARG_KEY_RE.test(key)) return false;
    const item = record[key];
    if (item === null || item === undefined) continue;
    const t = typeof item;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') return false;
  }
  return true;
}

function argsByteLength(args: Record<string, unknown>): number {
  try {
    return Buffer.byteLength(JSON.stringify(args), 'utf8');
  } catch {
    return MAX_ARGS_BYTES + 1;
  }
}

const POSIX_ABS_PATH = /(^|[^A-Za-z0-9._~-])((?:\/[A-Za-z0-9._-]+)+)/g;
const WIN_ABS_PATH = /[A-Za-z]:\\[^\s"'`,;)\]]+/g;
const FILE_URL_PATH = /file:\/\/\/?[^\s"'`,;)\]]+/g;
const HOME_TILDE_PATH = /(^|[^A-Za-z0-9._-])(~\/[^\s"'`,;)\]]*)/g;

/**
 * Strip absolute paths and secrets from a peer error before it reaches the
 * model. Known refusal codes are mapped to path-free sentences; this covers
 * the unrecognized fallback (and peer.describe failures).
 */
export function redactPeerToolInvokeError(text: string): string {
  let out = text;
  out = out.replace(WIN_ABS_PATH, '[redacted-path]');
  out = out.replace(FILE_URL_PATH, '[redacted-path]');
  out = out.replace(POSIX_ABS_PATH, (_full, prefix: string) => `${prefix}[redacted-path]`);
  out = out.replace(HOME_TILDE_PATH, (_full, prefix: string) => `${prefix}[redacted-path]`);
  out = redactSecrets(out);
  return out.replace(/\s+/g, ' ').trim();
}

function truncateOutput(text: string): { output: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) {
    return { output: text, truncated: false };
  }
  let end = text.length;
  let slice = text;
  while (end > 0 && Buffer.byteLength(slice, 'utf8') > MAX_OUTPUT_BYTES) {
    end = Math.max(0, end - Math.ceil((Buffer.byteLength(slice, 'utf8') - MAX_OUTPUT_BYTES) / 2) - 1);
    slice = text.slice(0, end);
  }
  return { output: `${slice}\n…[truncated by peer_tool_invoke at ${MAX_OUTPUT_BYTES} bytes]`, truncated: true };
}

function extractAdvertisedPeerTools(describe: unknown): string[] {
  const names = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string') {
      const name = value.trim();
      if (TOOL_NAME_RE.test(name) && !isDeniedToolName(name)) {
        names.add(name);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) add(item);
    }
  };
  if (!describe || typeof describe !== 'object') return [];
  const payload = describe as Record<string, unknown>;
  add(payload.peerTools);
  add(payload.tools);
  add(payload.peerToolAllowlist);
  if (payload.capabilities && typeof payload.capabilities === 'object') {
    const caps = payload.capabilities as Record<string, unknown>;
    add(caps.peerTools);
    add(caps.tools);
  }
  return [...names];
}

async function isToolAllowedOnPeer(
  toolName: string,
  request: (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>,
): Promise<{ allowed: boolean; advertised: string[]; describeError?: string }> {
  if ((DEFAULT_PEER_TOOL_INVOKE_TOOLS as readonly string[]).includes(toolName)) {
    return { allowed: true, advertised: [...DEFAULT_PEER_TOOL_INVOKE_TOOLS] };
  }
  if (isDeniedToolName(toolName)) {
    return { allowed: false, advertised: [...DEFAULT_PEER_TOOL_INVOKE_TOOLS] };
  }
  if (!trustDescribeExtras()) {
    return { allowed: false, advertised: [...DEFAULT_PEER_TOOL_INVOKE_TOOLS] };
  }
  try {
    const described = await request('peer.describe', {}, { timeoutMs: DESCRIBE_TIMEOUT_MS });
    const advertised = extractAdvertisedPeerTools(described);
    return { allowed: advertised.includes(toolName), advertised };
  } catch (err) {
    return {
      allowed: false,
      advertised: [...DEFAULT_PEER_TOOL_INVOKE_TOOLS],
      describeError: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapRemoteError(peer: string, err: unknown, timeoutMs: number): PeerToolInvokeResult {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code ?? '';
  const combined = `${code} ${message}`;

  if (code === 'ROLE_LEAF' || combined.includes('ROLE_LEAF')) {
    return {
      success: false,
      error:
        `Peer "${peer}" refused: it is configured as a leaf peer and cannot accept outbound peer.tool.invoke from this caller.`,
    };
  }
  if (code === 'MAX_DEPTH_EXCEEDED' || combined.includes('MAX_DEPTH_EXCEEDED')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: call chain depth exceeded (MAX_DEPTH_EXCEEDED).`,
    };
  }
  if (code === 'REQUEST_TIMEOUT' || combined.includes('REQUEST_TIMEOUT')) {
    return {
      success: false,
      error: `Peer "${peer}" did not respond to peer.tool.invoke within ${timeoutMs}ms.`,
    };
  }
  if (code === 'DISCONNECTED' || combined.includes('DISCONNECTED')) {
    return {
      success: false,
      error: `Peer "${peer}" disconnected during peer.tool.invoke.`,
    };
  }
  if (code === 'NOT_AUTHENTICATED' || code === 'NOT_OPEN') {
    return {
      success: false,
      error: `Peer "${peer}" is not currently connected. Use list_peers to check connection status.`,
    };
  }
  if (combined.includes('TOOL_NOT_ALLOWED_FOR_PEER_INVOKE')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: tool is not in the peer-invoke allowlist.`,
    };
  }
  if (combined.includes('TOOL_NOT_FLEET_SAFE')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: tool is not fleetSafe.`,
    };
  }
  if (combined.includes('PEER_WORKSPACE_NOT_CONFIGURED')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: peer workspace is not configured for remote tool invoke.`,
    };
  }
  if (combined.includes('PATH_OUTSIDE_PEER_WORKSPACE')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: path is outside the peer workspace.`,
    };
  }
  if (combined.includes('UNKNOWN_PEER_TOOL')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: unknown peer tool.`,
    };
  }
  if (combined.includes('PEER_SCOPE_DENIED')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: peer scope does not permit this tool.`,
    };
  }
  if (combined.includes('METHOD_NOT_FOUND')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: peer.tool.invoke is not available (METHOD_NOT_FOUND).`,
    };
  }
  if (combined.includes('INVALID_PARAMS')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: invalid peer.tool.invoke params.`,
    };
  }
  if (combined.includes('RATE_LIMITED')) {
    return {
      success: false,
      error: `Peer "${peer}" refused: rate limited.`,
    };
  }
  const safe = redactPeerToolInvokeError(message);
  return {
    success: false,
    error: `Peer "${peer}" failed: ${safe || 'unrecognized error'}.`,
  };
}

async function withLocalTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `peer.invoke REQUEST_TIMEOUT: peer.tool.invoke did not respond within ${timeoutMs}ms`,
      );
      (err as Error & { code?: string }).code = 'REQUEST_TIMEOUT';
      reject(err);
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function executePeerToolInvoke(params: PeerToolInvokeParams): Promise<PeerToolInvokeResult> {
  if (process.env.CODEBUDDY_PEER_ROLE === 'leaf') {
    return {
      success: false,
      error:
        'This Code Buddy is configured as a leaf peer (CODEBUDDY_PEER_ROLE=leaf) ' +
        'and cannot invoke tools on other peers. Ask a non-leaf peer to run peer_tool_invoke.',
    };
  }

  if (!params.peer || typeof params.peer !== 'string') {
    return { success: false, error: 'peer_tool_invoke: "peer" parameter is required (string).' };
  }
  if (params.peer.length > MAX_PEER_ID_LENGTH || !PEER_ID_RE.test(params.peer)) {
    return {
      success: false,
      error:
        'peer_tool_invoke: "peer" must be 1–128 characters matching [A-Za-z0-9._-].',
    };
  }
  if (!params.tool || typeof params.tool !== 'string') {
    return { success: false, error: 'peer_tool_invoke: "tool" parameter is required (string).' };
  }
  if (params.tool.length > MAX_TOOL_NAME_LENGTH || !TOOL_NAME_RE.test(params.tool)) {
    return {
      success: false,
      error:
        `peer_tool_invoke: "tool" must be a lowercase identifier up to ${MAX_TOOL_NAME_LENGTH} characters ` +
        `(got ${JSON.stringify(params.tool.slice(0, 80))}). ` +
        `Known read-only tools: ${DEFAULT_PEER_TOOL_INVOKE_TOOLS.join(', ')}.`,
    };
  }
  if (params.args !== undefined && !isFlatToolArgs(params.args)) {
    return {
      success: false,
      error:
        'peer_tool_invoke: "args" must be a flat object of string/number/boolean values ' +
        'with safe keys (no nested objects/arrays, no __proto__/constructor). ' +
        'Paths are forwarded as given (not resolved on this host).',
    };
  }

  const timeoutMs = clampPeerToolInvokeTimeout(params.timeoutMs);
  const args: Record<string, unknown> = params.args ? { ...params.args } : {};
  if (argsByteLength(args) > MAX_ARGS_BYTES) {
    return {
      success: false,
      error: `peer_tool_invoke: "args" is too large (max ${MAX_ARGS_BYTES} bytes).`,
    };
  }

  const reg = getFleetRegistry();
  if (reg.size() === 0) {
    return {
      success: false,
      error:
        'No fleet peers connected. Ask the user to run /fleet listen <ws-url> --name <id> first ' +
        'to add a peer Code Buddy to the fleet.',
    };
  }

  const entry = reg.get(params.peer);
  if (!entry) {
    const ids = reg.ids().join(', ') || '(none)';
    return {
      success: false,
      error:
        `Peer "${params.peer}" not found. Connected peers: ${ids}. ` +
        `Use list_peers to see details.`,
    };
  }

  if (typeof entry.listener.invokeTool !== 'function') {
    return {
      success: false,
      error:
        `Peer "${params.peer}" listener has no invokeTool (peer.tool.invoke unavailable). ` +
        `Use list_peers and try a peer whose listener supports remote read-only tools.`,
    };
  }

  const allowed = await isToolAllowedOnPeer(params.tool, (method, requestParams, options) =>
    entry.listener.request(method, requestParams, options),
  );
  if (!allowed.allowed) {
    const extra = allowed.describeError
      ? ` peer.describe failed: ${redactPeerToolInvokeError(allowed.describeError) || 'unrecognized error'}.`
      : trustDescribeExtras()
        ? ` Advertised extra tools: ${allowed.advertised.filter((n) => !(DEFAULT_PEER_TOOL_INVOKE_TOOLS as readonly string[]).includes(n)).join(', ') || '(none)'}.`
        : ' Extra names from peer.describe require CODEBUDDY_PEER_TRUST_DESCRIBE=true.';
    return {
      success: false,
      error:
        `peer_tool_invoke: tool "${params.tool}" is not in the local read-only set ` +
        `(${DEFAULT_PEER_TOOL_INVOKE_TOOLS.join(', ')}) and was not advertised by peer.describe.${extra}`,
    };
  }

  const t0 = Date.now();
  try {
    // keep listener this — call invokeTool on the listener object, never unbound.
    const payload = await withLocalTimeout(
      entry.listener.invokeTool(params.tool, args, { timeoutMs }),
      timeoutMs,
    );
    const elapsedMs = Date.now() - t0;
    const rawOutput =
      typeof payload?.output === 'string' ? payload.output : JSON.stringify(payload ?? {});
    const { output, truncated } = truncateOutput(rawOutput);
    const data: PeerToolInvokeData = {
      peer: params.peer,
      tool: payload?.tool ?? params.tool,
      output,
      durationMs: payload?.durationMs ?? elapsedMs,
      truncated: truncated || payload?.truncated === true,
      elapsedMs,
    };
    return {
      success: true,
      output: [`[peer: ${params.peer}] [tool: ${params.tool}] [${elapsedMs}ms]`, output].join('\n'),
      data,
    };
  } catch (err) {
    logger.debug('[peer-tool-invoke-tool] peer.tool.invoke error', {
      peer: params.peer,
      tool: params.tool,
      message: err instanceof Error ? err.message : String(err),
    });
    return mapRemoteError(params.peer, err, timeoutMs);
  }
}
