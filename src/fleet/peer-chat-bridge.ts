/**
 * Peer chat bridge (Phase (d).15 V0.4.1).
 *
 * Registers `peer.chat` on the peer-rpc registry: a remote peer can
 * call `peer.chat({ prompt, systemPrompt?, model? })` to ask THIS
 * peer's LLM a one-shot question. The handler mirrors the pattern of
 * the local `/btw` slash (src/commands/handlers/btw-handler.ts):
 *   - minimal system prompt
 *   - no tools
 *   - no history mutation
 *   - returns the assistant's text
 *
 * The CodeBuddyClient instance is provided lazily via a closure passed
 * to `wirePeerChatBridge(getClient)`. This decouples the bridge from
 * any singleton — the caller (server boot, test) decides where the
 * client comes from. If `getClient()` returns null, the handler throws
 * CLIENT_UNAVAILABLE so peers know this node can't currently respond.
 *
 * Idempotent (mirrors compaction-bridge): a second wire call is a no-op.
 */

import type { CodeBuddyClient, ChatOptions } from '../codebuddy/client.js';
import { beginFleetWork, isFleetSaturated } from './fleet-load.js';
import { registerPeerMethod, unregisterPeerMethod } from '../server/websocket/peer-method-registry.js';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
  FLEET_DISPATCH_PROFILES,
  buildDispatchSystemPrompt,
  buildHermesToolsetDescriptor,
  getDispatchToolPolicy,
  isFleetDispatchProfile,
  mergeDispatchSystemPrompt,
  normalizeDispatchProfile,
  type FleetDispatchProfile,
  type FleetHermesToolsetDescriptor,
  type FleetDispatchToolDecision,
  type FleetDispatchToolPolicy,
} from './dispatch-profile.js';
import type { PeerChatProviderInfo } from './peer-chat-client-factory.js';

// Re-imported for the streaming variant — kept narrow to avoid a wider import surface.
type ContentChunk = { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; usage?: unknown };

/** Closure that returns the CodeBuddyClient to use for peer.chat, or null if none is wired. */
export type PeerChatClientGetter = () => CodeBuddyClient | null;

let cachedGetter: PeerChatClientGetter | null = null;
let cachedProviderInfo: PeerChatProviderInfo | null = null;
let wired = false;

const DEFAULT_SYSTEM_PROMPT = 'Answer this side question briefly. Do not use tools.';

function assertFleetCapacity(method: string): void {
  if (!isFleetSaturated()) return;
  const error = new Error(`${method}: fleet concurrency limit reached`);
  (error as Error & { code: 'SATURATED' }).code = 'SATURATED';
  throw error;
}

export type { FleetDispatchProfile as PeerDispatchProfile } from './dispatch-profile.js';

function resolvePeerChatProfile(params: Record<string, unknown>): {
  dispatchProfile?: FleetDispatchProfile;
  toolPolicy?: FleetDispatchToolPolicy;
  toolDecisions?: FleetDispatchToolDecision[];
  toolset?: FleetHermesToolsetDescriptor;
} {
  if (params.dispatchProfile === undefined) {
    return {};
  }
  if (!isFleetDispatchProfile(params.dispatchProfile)) {
    throw new Error(
      `peer.chat: dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}`,
    );
  }
  const dispatchProfile = normalizeDispatchProfile(params.dispatchProfile);
  const toolset = buildHermesToolsetDescriptor(
    dispatchProfile,
    [...DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS],
  );
  return {
    dispatchProfile,
    toolPolicy: getDispatchToolPolicy(dispatchProfile),
    toolDecisions: toolset.decisions,
    toolset,
  };
}

function resolvePeerChatSystemPrompt(
  params: Record<string, unknown>,
  dispatchProfile?: FleetDispatchProfile,
): string {
  if (typeof params.systemPrompt === 'string' && params.systemPrompt.length > 0) {
    return dispatchProfile
      ? mergeDispatchSystemPrompt(params.systemPrompt, dispatchProfile)
      : params.systemPrompt;
  }
  if (dispatchProfile) {
    return buildDispatchSystemPrompt(dispatchProfile);
  }
  return DEFAULT_SYSTEM_PROMPT;
}

/**
 * Register the `peer.chat` method on the peer-rpc registry. The
 * `getClient` closure is captured and called on EACH invocation, so
 * the caller can swap clients dynamically (e.g. when reloading config)
 * without re-wiring.
 *
 * Idempotent — a second call is a no-op (does NOT replace the cached
 * getter; un-wire first if you need to swap).
 */
export function wirePeerChatBridge(
  getClient: PeerChatClientGetter,
  providerInfo?: PeerChatProviderInfo | null,
): void {
  if (wired) {
    logger.debug('[peer-chat-bridge] wire() called while already wired — no-op');
    return;
  }
  cachedGetter = getClient;
  cachedProviderInfo = providerInfo ?? null;
  registerPeerMethod('peer.chat', async (params, ctx) => {
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    const profile = resolvePeerChatProfile(params);
    const systemPrompt = resolvePeerChatSystemPrompt(params, profile.dispatchProfile);
    const model = typeof params.model === 'string' && params.model.length > 0
      ? params.model
      : undefined;

    if (!prompt) {
      // dispatchPeerRequest wraps thrown errors as METHOD_ERROR.
      throw new Error('peer.chat: prompt is required (string)');
    }
    assertFleetCapacity('peer.chat');
    const client = cachedGetter?.() ?? null;
    if (!client) {
      throw new Error(
        'CLIENT_UNAVAILABLE: no LLM client wired on this peer (peer.chat cannot answer)',
      );
    }

    const chatOptions: ChatOptions | undefined = model ? { model } : undefined;
    const doneLoad = beginFleetWork('peer.chat');
    let response: Awaited<ReturnType<CodeBuddyClient['chat']>>;
    try {
      response = await client.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        undefined, // no tools
        chatOptions,
      );
    } finally {
      doneLoad();
    }

    return {
      text: response?.choices?.[0]?.message?.content ?? '',
      // The CodeBuddyResponse shape doesn't expose the model name
      // directly (provider-specific). Echo what the caller asked for
      // so they can attribute the response correctly.
      modelRequested: model,
      finishReason: response?.choices?.[0]?.finish_reason,
      usage: response?.usage,
      // Echo traceId so consumers can correlate a peer.chat answer
      // back to its originating call chain (Phase (d).14 trace).
      traceId: ctx.traceId,
      ...(profile.dispatchProfile ? { dispatchProfile: profile.dispatchProfile } : {}),
      ...(profile.toolPolicy ? { toolPolicy: profile.toolPolicy } : {}),
      ...(profile.toolDecisions ? { toolDecisions: profile.toolDecisions } : {}),
      ...(profile.toolset ? { toolset: profile.toolset } : {}),
    };
  });
  // Phase (d).19 — streaming variant. Same params, but the handler
  // pushes deltas via ctx.emitChunk and returns a final aggregate so
  // callers without streaming support still get the full text.
  registerPeerMethod('peer.chat-stream', async (params, ctx) => {
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    const profile = resolvePeerChatProfile(params);
    const systemPrompt = resolvePeerChatSystemPrompt(params, profile.dispatchProfile);
    const model = typeof params.model === 'string' && params.model.length > 0
      ? params.model
      : undefined;

    if (!prompt) {
      throw new Error('peer.chat-stream: prompt is required (string)');
    }
    assertFleetCapacity('peer.chat-stream');
    const client = cachedGetter?.() ?? null;
    if (!client) {
      throw new Error(
        'CLIENT_UNAVAILABLE: no LLM client wired on this peer (peer.chat-stream cannot answer)',
      );
    }

    const chatOptions: ChatOptions | undefined = model ? { model } : undefined;
    const doneLoad = beginFleetWork('peer.chat');
    let aggregate = '';
    let finishReason: string | null | undefined;
    let usage: unknown;
    try {
      const stream = client.chatStream(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        undefined, // no tools
        chatOptions,
      );

      for await (const chunk of stream as AsyncIterable<ContentChunk>) {
        const delta = chunk?.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          aggregate += delta;
          // Best-effort emit — undefined when the transport doesn't support
          // streaming. We still aggregate locally for the final response so
          // the client gets the full text either way.
          ctx.emitChunk?.(delta);
        }
        const fr = chunk?.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;
        if (chunk?.usage) usage = chunk.usage;
      }
    } finally {
      doneLoad();
    }

    return {
      text: aggregate,
      modelRequested: model,
      finishReason: finishReason ?? undefined,
      usage,
      traceId: ctx.traceId,
      ...(profile.dispatchProfile ? { dispatchProfile: profile.dispatchProfile } : {}),
      ...(profile.toolPolicy ? { toolPolicy: profile.toolPolicy } : {}),
      ...(profile.toolDecisions ? { toolDecisions: profile.toolDecisions } : {}),
      ...(profile.toolset ? { toolset: profile.toolset } : {}),
    };
  });

  wired = true;
  logger.debug('[peer-chat-bridge] wired');
}

/** Detach the peer.chat + peer.chat-stream methods. Idempotent. */
export function unwirePeerChatBridge(): void {
  if (!wired) return;
  unregisterPeerMethod('peer.chat');
  unregisterPeerMethod('peer.chat-stream');
  cachedGetter = null;
  cachedProviderInfo = null;
  wired = false;
  logger.debug('[peer-chat-bridge] unwired');
}

/**
 * Phase (d).16a — read the wired provider info (or null if peer.chat
 * isn't wired with a real client). Surfaced via peer.describe so remote
 * Claudes can discover what kind of LLM lives behind this peer.chat.
 */
export function getPeerChatProviderInfo(): PeerChatProviderInfo | null {
  return cachedProviderInfo;
}

/** Whether the bridge is currently registered on the peer-rpc registry. */
export function isPeerChatBridgeWired(): boolean {
  return wired;
}

/** Test-only reset hook. Force-unwire even if state is desync'd. */
export function _unwireForTests(): void {
  try {
    unregisterPeerMethod('peer.chat');
    unregisterPeerMethod('peer.chat-stream');
  } catch {
    /* peer-rpc may not be initialised in some test setups */
  }
  cachedGetter = null;
  cachedProviderInfo = null;
  wired = false;
  dispatchedTasks.clear();
}

// ─────────── Fleet P3 — peer.dispatch (fire-and-forget) ───────────

/**
 * In-flight dispatch state. Keyed by `runId`. Lets the caller (peer
 * RPC handler) return immediately while the LLM call runs in the
 * background; remote peers can later poll status via `peer.dispatchStatus`.
 *
 * Stays in memory for the lifetime of the process — durable
 * persistence is the saga store (Fleet P4).
 */
interface DispatchState {
  runId: string;
  prompt: string;
  model?: string;
  dispatchProfile: FleetDispatchProfile;
  toolPolicy: FleetDispatchToolPolicy;
  toolDecisions: FleetDispatchToolDecision[];
  toolset: FleetHermesToolsetDescriptor;
  traceId?: string;
  parentRunId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

const dispatchedTasks: Map<string, DispatchState> = new Map();

/**
 * Fire-and-forget LLM call for `peer.dispatch`. Returns immediately
 * after queuing; the actual chat happens asynchronously and updates
 * the in-memory state. Remote peers can poll via `peer.dispatchStatus`
 * (also registered here).
 */
export function dispatchPeerTask(input: {
  runId: string;
  prompt: string;
  model?: string;
  dispatchProfile?: FleetDispatchProfile;
  traceId?: string;
  parentRunId?: string;
}): void {
  const dispatchProfile = input.dispatchProfile ?? 'balanced';
  const toolset = buildHermesToolsetDescriptor(
    dispatchProfile,
    [...DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS],
  );
  const state: DispatchState = {
    runId: input.runId,
    prompt: input.prompt,
    model: input.model,
    dispatchProfile,
    toolPolicy: getDispatchToolPolicy(dispatchProfile),
    toolDecisions: toolset.decisions,
    toolset,
    traceId: input.traceId,
    parentRunId: input.parentRunId,
    status: 'pending',
    startedAt: Date.now(),
  };
  dispatchedTasks.set(input.runId, state);

  // Run in background — never await.
  void runDispatchedTask(state).catch((err) => {
    state.status = 'failed';
    state.error = err instanceof Error ? err.message : String(err);
    state.completedAt = Date.now();
    logger.warn('[peer-chat-bridge] dispatch failed', {
      runId: state.runId,
      error: state.error,
    });
  });
}

async function runDispatchedTask(state: DispatchState): Promise<void> {
  state.status = 'running';
  const client = cachedGetter?.() ?? null;
  if (!client) {
    state.status = 'failed';
    state.error = 'CLIENT_UNAVAILABLE: no LLM client wired on this peer';
    state.completedAt = Date.now();
    return;
  }
  const chatOptions: ChatOptions | undefined = state.model
    ? { model: state.model }
    : undefined;
  const doneLoad = beginFleetWork('peer.dispatch');
  let response: Awaited<ReturnType<CodeBuddyClient['chat']>>;
  try {
    response = await client.chat(
      [
        { role: 'system', content: buildDispatchSystemPrompt(state.dispatchProfile) },
        { role: 'user', content: state.prompt },
      ],
      [],
      chatOptions,
    );
  } finally {
    doneLoad();
  }
  state.result = response?.choices?.[0]?.message?.content ?? '';
  state.status = 'completed';
  state.completedAt = Date.now();
}

/**
 * Snapshot of a dispatched task's state. Read-only — used by
 * `peer.dispatchStatus`.
 */
export function getDispatchState(runId: string): DispatchState | null {
  return dispatchedTasks.get(runId) ?? null;
}

/**
 * Remove a finished dispatch from memory. Caller (saga store) is
 * expected to have persisted what it needs first.
 */
export function clearDispatch(runId: string): boolean {
  return dispatchedTasks.delete(runId);
}

/** Test helper — list all known dispatches. */
export function _listDispatchesForTests(): DispatchState[] {
  return Array.from(dispatchedTasks.values());
}
