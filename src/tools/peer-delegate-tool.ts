/**
 * peer_delegate tool — Phase (d).17.
 *
 * Lets the LLM autonomously delegate a one-shot question or task to a
 * connected fleet peer Code Buddy by wrapping `peer.chat` (Phase d.15).
 * The peer answers independently; we feed the response back into the
 * tool result so the calling LLM can continue reasoning.
 *
 * This closes the orchestration loop: before this tool, the only path
 * was the human running `/fleet send` manually and copy-pasting JSON.
 *
 * Anti-loop (3 layers):
 *   1. Tool guard: refuses if `CODEBUDDY_PEER_ROLE=leaf` (mirror of
 *      `fleet-listener.ts:668-674`).
 *   2. Wire guard: `FleetListener.request()` re-checks the role.
 *   3. Depth: we don't pass traceId/depth, so the dispatcher generates
 *      a fresh top-level chain. `peer.chat` is no-tools/no-history,
 *      so it physically cannot fan out.
 *
 * Per-turn cap: rolling-window `MAX_PER_TURN` (env
 * `CODEBUDDY_PEER_DELEGATE_MAX_PER_TURN`, default 5; resets after 120s
 * of idleness). Prevents runaway LLM-side delegation loops.
 *
 * @module src/tools/peer-delegate-tool
 */

import { getFleetRegistry } from '../fleet/fleet-registry.js';
import {
  buildDispatchSystemPrompt,
  FLEET_DISPATCH_PROFILES,
  isFleetDispatchProfile,
  type FleetDispatchProfile,
  type FleetHermesToolsetDescriptor,
} from '../fleet/dispatch-profile.js';
import {
  resolveActiveCustomAgentDispatchProfile,
  shouldPropagateResolvedDispatchProfile,
  type DispatchProfileSource,
} from '../agent/custom/custom-agent-runtime.js';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import type { PeerChatProviderId } from '../fleet/peer-chat-client-factory.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const IDLE_RESET_MS = 120_000;

const MAX_PER_TURN = ((): number => {
  const raw = process.env.CODEBUDDY_PEER_DELEGATE_MAX_PER_TURN;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5;
})();

let _callCount = 0;
let _lastCallAt = 0;

function checkAndIncrementCallCap(): ToolResult | null {
  const now = Date.now();
  if (now - _lastCallAt > IDLE_RESET_MS) _callCount = 0;
  _lastCallAt = now;
  if (_callCount >= MAX_PER_TURN) {
    return {
      success: false,
      error:
        `peer_delegate call cap reached (${_callCount}/${MAX_PER_TURN} calls in this window). ` +
        `Summarize the results obtained so far or ask the user to continue. ` +
        `Cap resets after ${IDLE_RESET_MS / 1000}s of idleness or via env CODEBUDDY_PEER_DELEGATE_MAX_PER_TURN.`,
    };
  }
  _callCount++;
  return null;
}

export interface PeerDelegateParams {
  peer: string;
  prompt: string;
  systemPrompt?: string;
  provider?: PeerChatProviderId | string;
  model?: string;
  dispatchProfile?: FleetDispatchProfile | string;
  timeoutMs?: number;
}

interface PeerChatRpcResult {
  text?: string;
  modelRequested?: string;
  providerRequested?: string;
  providerResolved?: string;
  finishReason?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  traceId?: string;
  dispatchProfile?: FleetDispatchProfile;
  toolPolicy?: {
    policyProfile?: string;
    defaultAction?: string;
    summary?: string;
  };
  toolDecisions?: Array<{
    tool: string;
    action: string;
    reason?: string;
  }>;
  toolset?: FleetHermesToolsetDescriptor;
  dispatchProfileSource?: DispatchProfileSource;
}

export async function executePeerDelegate(params: PeerDelegateParams): Promise<ToolResult> {
  // Layer 1 anti-loop: leaf peer refuses outbound delegation.
  if (process.env.CODEBUDDY_PEER_ROLE === 'leaf') {
    return {
      success: false,
      error:
        'This Code Buddy is configured as a leaf peer (CODEBUDDY_PEER_ROLE=leaf) ' +
        'and cannot delegate outbound calls to other peers. ' +
        'Answer the user directly with your own knowledge, or ask them to run the task on a non-leaf peer.',
    };
  }

  const capError = checkAndIncrementCallCap();
  if (capError) return capError;

  if (!params.peer || typeof params.peer !== 'string') {
    return { success: false, error: 'peer_delegate: "peer" parameter is required (string).' };
  }
  if (!params.prompt || typeof params.prompt !== 'string') {
    return { success: false, error: 'peer_delegate: "prompt" parameter is required (string).' };
  }
  if (
    params.dispatchProfile !== undefined &&
    !isFleetDispatchProfile(params.dispatchProfile)
  ) {
    return {
      success: false,
      error: `peer_delegate: dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}.`,
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

  const timeoutMs =
    params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : DEFAULT_TIMEOUT_MS;
  const dispatchResolution = resolveActiveCustomAgentDispatchProfile(params.dispatchProfile);
  const dispatchProfile = dispatchResolution.dispatchProfile;
  const shouldPropagateDispatchProfile = shouldPropagateResolvedDispatchProfile(dispatchResolution);
  const systemPrompt =
    params.systemPrompt ?? (
      shouldPropagateDispatchProfile ? buildDispatchSystemPrompt(dispatchProfile) : undefined
    );

  const t0 = Date.now();
  try {
    const raw = (await entry.listener.request(
      'peer.chat',
      {
        prompt: params.prompt,
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(params.provider ? { provider: params.provider } : {}),
        ...(params.model ? { model: params.model } : {}),
        ...(shouldPropagateDispatchProfile ? { dispatchProfile } : {}),
      },
      { timeoutMs },
    )) as PeerChatRpcResult;

    const elapsedMs = Date.now() - t0;
    const text = raw?.text ?? '';
    const lines: string[] = [`[peer: ${params.peer}] [${elapsedMs}ms]`, text];
    if (raw?.usage?.total_tokens != null) {
      const inT = raw.usage.prompt_tokens ?? '?';
      const outT = raw.usage.completion_tokens ?? '?';
      lines.push(`[tokens: ${inT} in / ${outT} out | total: ${raw.usage.total_tokens}]`);
    }
    if (raw?.modelRequested) lines.push(`[model: ${raw.modelRequested}]`);
    if (raw?.providerResolved) lines.push(`[provider: ${raw.providerResolved}]`);
    const returnedDispatchProfile = raw?.dispatchProfile ?? (
      shouldPropagateDispatchProfile ? dispatchProfile : undefined
    );
    if (returnedDispatchProfile) {
      const policy = raw?.toolPolicy?.policyProfile ?? '?';
      const action = raw?.toolPolicy?.defaultAction ?? '?';
      const sourceSuffix = dispatchResolution.source === 'explicit'
        ? ''
        : ` | source: ${dispatchResolution.source}`;
      lines.push(
        `[profile: ${returnedDispatchProfile}${sourceSuffix} | policy: ${policy} / ${action}]`,
      );
    }

    return {
      success: true,
      output: lines.join('\n'),
      data: {
        text,
        peer: params.peer,
        modelRequested: raw?.modelRequested,
        providerRequested: raw?.providerRequested,
        providerResolved: raw?.providerResolved,
        finishReason: raw?.finishReason,
        usage: raw?.usage,
        traceId: raw?.traceId,
        dispatchProfile: returnedDispatchProfile,
        dispatchProfileSource: dispatchResolution.source,
        ...(dispatchResolution.agentId ? { dispatchProfileAgent: dispatchResolution.agentId } : {}),
        toolPolicy: raw?.toolPolicy,
        toolDecisions: raw?.toolDecisions,
        toolset: raw?.toolset,
        elapsedMs,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? '';
    logger.debug('[peer-delegate-tool] peer.chat error', {
      peer: params.peer,
      code,
      message,
    });

    if (code === 'ROLE_LEAF') {
      return {
        success: false,
        error:
          `Peer "${params.peer}" refused: it is configured as a leaf peer and cannot respond to delegated chat.`,
      };
    }
    if (code === 'MAX_DEPTH_EXCEEDED') {
      return {
        success: false,
        error: `Peer "${params.peer}" refused: call chain depth exceeded. The peer may already be delegating.`,
      };
    }
    if (code === 'DISCONNECTED') {
      return {
        success: false,
        error: `Peer "${params.peer}" disconnected during the call. Use list_peers to see surviving peers.`,
      };
    }
    if (code === 'REQUEST_TIMEOUT') {
      return {
        success: false,
        error: `Peer "${params.peer}" did not respond within ${timeoutMs}ms. The peer may be busy or compacting.`,
      };
    }
    if (code === 'NOT_AUTHENTICATED' || code === 'NOT_OPEN') {
      return {
        success: false,
        error: `Peer "${params.peer}" is not currently connected. Use list_peers to check connection status.`,
      };
    }
    if (message.includes('CLIENT_UNAVAILABLE')) {
      return {
        success: false,
        error: `Peer "${params.peer}" has no LLM client wired (peer.chat unavailable). Try a different peer via list_peers.`,
      };
    }
    return { success: false, error: `Peer "${params.peer}" failed: ${message}` };
  }
}

/** Test-only — reset the per-turn call counter. */
export function _resetCallCounterForTests(): void {
  _callCount = 0;
  _lastCallAt = 0;
}
