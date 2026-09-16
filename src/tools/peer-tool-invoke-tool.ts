/**
 * peer_tool_invoke tool — wraps `peer.tool.invoke` for the local agent.
 *
 * Lets the LLM read/search on a connected fleet peer (view_file,
 * list_directory, search) without going through `peer.chat` (which has
 * no tools). The three security gates stay on the remote peer
 * (`peer-tool-bridge.ts`): allowlist, fleetSafe, workspace root.
 *
 * This side (A) does not interpret paths and does not add new remote
 * capabilities. It only:
 *   1. Validates params (peer, tool, flat args, timeout).
 *   2. Restricts the tool name to the known read-only set unless the
 *      peer advertises extra names via `peer.describe`.
 *   3. Forwards `{ tool, args }` through `listener.invokeTool`.
 *
 * Failures (unknown peer, missing invokeTool, remote allowlist /
 * workspace / depth refusals, timeout) always return `success: false`.
 *
 * @module src/tools/peer-tool-invoke-tool
 */

import { getFleetRegistry } from '../fleet/fleet-registry.js';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_PEER_TOOL_INVOKE_TOOLS = [
  'view_file',
  'list_directory',
  'search',
] as const;

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_TIMEOUT_MS = 120_000;
const DESCRIBE_TIMEOUT_MS = 3_000;

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

export interface PeerToolInvokeParams {
  peer: string;
  tool: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
}

export function clampPeerToolInvokeTimeout(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(raw), MAX_TIMEOUT_MS);
}

export function isFlatToolArgs(value: unknown): value is Record<string, unknown> {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((item) => {
    if (item === null || item === undefined) return true;
    const t = typeof item;
    return t === 'string' || t === 'number' || t === 'boolean';
  });
}

function extractAdvertisedPeerTools(describe: unknown): string[] {
  const names = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string') {
      const name = value.trim();
      if (TOOL_NAME_RE.test(name) && !name.startsWith('peer')) {
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

function mapRemoteError(peer: string, err: unknown, timeoutMs: number): ToolResult {
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
      error: `Peer "${peer}" refused: call chain depth exceeded (MAX_DEPTH_EXCEEDED). ${message}`,
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
    return { success: false, error: `Peer "${peer}" refused: ${message}` };
  }
  if (combined.includes('TOOL_NOT_FLEET_SAFE')) {
    return { success: false, error: `Peer "${peer}" refused: ${message}` };
  }
  if (combined.includes('PEER_WORKSPACE_NOT_CONFIGURED')) {
    return { success: false, error: `Peer "${peer}" refused: ${message}` };
  }
  if (combined.includes('PATH_OUTSIDE_PEER_WORKSPACE')) {
    return { success: false, error: `Peer "${peer}" refused: ${message}` };
  }
  if (combined.includes('UNKNOWN_PEER_TOOL')) {
    return { success: false, error: `Peer "${peer}" refused: ${message}` };
  }
  if (combined.includes('PEER_SCOPE_DENIED')) {
    return { success: false, error: `Peer "${peer}" refused: ${message}` };
  }
  return { success: false, error: `Peer "${peer}" failed: ${message}` };
}

export async function executePeerToolInvoke(params: PeerToolInvokeParams): Promise<ToolResult> {
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
  if (!params.tool || typeof params.tool !== 'string') {
    return { success: false, error: 'peer_tool_invoke: "tool" parameter is required (string).' };
  }
  if (!TOOL_NAME_RE.test(params.tool)) {
    return {
      success: false,
      error:
        `peer_tool_invoke: "tool" must be a lowercase identifier (got ${JSON.stringify(params.tool)}). ` +
        `Known read-only tools: ${DEFAULT_PEER_TOOL_INVOKE_TOOLS.join(', ')}.`,
    };
  }
  if (params.args !== undefined && !isFlatToolArgs(params.args)) {
    return {
      success: false,
      error:
        'peer_tool_invoke: "args" must be a flat object of string/number/boolean values. ' +
        'Nested objects/arrays are rejected. Paths are forwarded as given (not resolved on this host).',
    };
  }

  const timeoutMs = clampPeerToolInvokeTimeout(params.timeoutMs);
  const args: Record<string, unknown> = params.args ? { ...params.args } : {};

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

  const invokeTool = entry.listener.invokeTool;
  if (typeof invokeTool !== 'function') {
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
      ? ` peer.describe failed: ${allowed.describeError}`
      : ` Advertised extra tools: ${allowed.advertised.filter((n) => !(DEFAULT_PEER_TOOL_INVOKE_TOOLS as readonly string[]).includes(n)).join(', ') || '(none)'}.`;
    return {
      success: false,
      error:
        `peer_tool_invoke: tool "${params.tool}" is not in the local read-only set ` +
        `(${DEFAULT_PEER_TOOL_INVOKE_TOOLS.join(', ')}) and was not advertised by peer.describe.${extra}`,
    };
  }

  const t0 = Date.now();
  try {
    const payload = await invokeTool(params.tool, args, { timeoutMs });
    const elapsedMs = Date.now() - t0;
    const output =
      typeof payload?.output === 'string' ? payload.output : JSON.stringify(payload ?? {});
    return {
      success: true,
      output: [`[peer: ${params.peer}] [tool: ${params.tool}] [${elapsedMs}ms]`, output].join('\n'),
      data: {
        peer: params.peer,
        tool: payload?.tool ?? params.tool,
        output,
        durationMs: payload?.durationMs ?? elapsedMs,
        truncated: payload?.truncated,
        elapsedMs,
      },
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
