/**
 * Peer RPC registry (Phase (d).13 V0.4.1).
 *
 * Server-side handler for `peer:request` WS messages. Mirror of OpenClaw's
 * `node.invoke` pattern adapted for our mesh topology: any peer Code Buddy
 * can call any method on any other peer that exposes it, getting a typed
 * response back via `peer:response` keyed on the request id.
 *
 * Design choices:
 * - Method registry is module-level (one registry per process). Methods
 *   are registered by feature owners (e.g. `peer.describe` is registered
 *   here as a default; future modules can call `registerPeerMethod()`).
 * - Methods receive (params, ctx) and return a Promise. Throwing OR
 *   rejecting becomes an error response with `code='METHOD_ERROR'`.
 * - Permission gate: caller must hold the `peer:invoke` scope. This is
 *   enforced in handler.ts before routing here — this module just trusts
 *   the message arrived through the right scope.
 * - Default methods exposed at boot: `peer.describe`, `peer.ping`,
 *   `peer.echo` (last one is for connectivity smoke tests).
 * - Caller-side timeout / cancel logic lives in FleetListener.request()
 *   on the OTHER end. Server processes synchronously and responds.
 */

import os from 'os';
import {
  FLEET_DISPATCH_PROFILES,
  isFleetDispatchProfile,
  normalizeDispatchProfile,
} from '../../fleet/dispatch-profile.js';
import { logger } from '../../utils/logger.js';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

/**
 * Server-side handler context passed to method implementations.
 * Includes connection id for audit logs and the originating client's
 * scopes for permission-aware methods.
 *
 * Phase (d).14 — `traceId` + `depth` carry the call-chain context so a
 * handler that fans out to OTHER peers can propagate them. Default for
 * a fresh request is a new traceId + depth=0; a handler that calls
 * another peer's request() should pass `{ traceId: ctx.traceId, depth: ctx.depth + 1 }`.
 */
export interface PeerMethodContext {
  /** WS connection id of the caller. */
  connectionId: string;
  /** Scopes held by the caller's authenticated session. */
  scopes: string[];
  /** Phase (d).14 — call-chain trace id for loop detection. */
  traceId: string;
  /** Phase (d).14 — current call depth in the chain (0 = fresh request from a human/external). */
  depth: number;
  /**
   * Phase (d).19 — streaming output channel. When set, the handler can
   * push partial result deltas as they're produced; the transport layer
   * forwards each call as a `peer:chunk` frame. The final return value
   * of the handler is still sent as a `peer:response` for correlation.
   *
   * Undefined means the caller didn't request streaming OR the
   * transport doesn't support it — handlers should fall back to
   * accumulating and returning the full result. Methods that REQUIRE
   * streaming (like `peer.chat-stream`) should throw when this is
   * undefined.
   */
  emitChunk?: (delta: string) => void;
}

/** Method handler signature. Async, returns the JSON-serializable payload. */
export type PeerMethodHandler = (
  params: Record<string, unknown>,
  ctx: PeerMethodContext,
) => Promise<unknown>;

/** Request frame received over WS (peer:request type). */
export interface PeerRequestFrame {
  /** Caller-generated request id (uuid). */
  id: string;
  /** Dotted method name, e.g. "peer.describe". */
  method: string;
  /** Method params (method-specific shape). */
  params?: Record<string, unknown>;
  /**
   * Phase (d).14 — call-chain trace id. When omitted, the dispatcher
   * generates a fresh one (treats this as a top-level / external call).
   * When present, it's propagated to ctx so handlers fanning out can
   * keep the chain visible.
   */
  traceId?: string;
  /**
   * Phase (d).14 — current depth in the chain. Defaults to 0 when
   * absent (top-level request). Each peer that fans out a sub-request
   * increments. The dispatcher rejects with MAX_DEPTH_EXCEEDED when
   * the value would push past the configured ceiling.
   */
  depth?: number;
}

/** Response frame sent back over WS (peer:response type). */
export interface PeerResponseFrame {
  /** Echoed request id for correlation. */
  id: string;
  /** True on success, false on any error. */
  ok: boolean;
  /** Result payload when ok=true. */
  payload?: unknown;
  /** Error info when ok=false. */
  error?: { code: string; message: string };
}

// ──────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────

const handlers = new Map<string, PeerMethodHandler>();

/**
 * Phase (d).14 — peer role. Influences what the SERVER answers:
 *   main         — accepts all requests (default)
 *   orchestrator — accepts all requests (semantic only — no behaviour
 *                   change today; future hook for routing decisions)
 *   leaf         — accepts requests but tags responses to discourage
 *                   the caller from chaining further. Future role can
 *                   refuse outgoing peer.invoke (gated client-side in
 *                   FleetListener.request).
 */
export type PeerRole = 'main' | 'orchestrator' | 'leaf';

/** Default max call depth before rejecting with MAX_DEPTH_EXCEEDED. */
const DEFAULT_MAX_DEPTH = 3;

function getMaxDepth(): number {
  const raw = process.env.CODEBUDDY_PEER_MAX_DEPTH;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_MAX_DEPTH;
}

/** Read the peer role from env. Validates against the union; defaults to 'main'. */
export function getPeerRole(): PeerRole {
  const raw = process.env.CODEBUDDY_PEER_ROLE;
  if (raw === 'main' || raw === 'orchestrator' || raw === 'leaf') return raw;
  return 'main';
}

/**
 * Generate a fresh trace id for a top-level request. Format chosen so
 * the chain is human-readable in logs: `trace-{ts36}-{rand36}`.
 */
function newTraceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `trace-${ts}-${rand}`;
}

/**
 * Register a peer method handler. Idempotent for the same (method,
 * handler) pair; replaces silently if a different handler is registered
 * for the same method (last-wins, mirror of express middleware).
 */
export function registerPeerMethod(method: string, handler: PeerMethodHandler): void {
  handlers.set(method, handler);
  logger.debug(`[peer-rpc] registered method: ${method}`);
}

/** Unregister a method (test cleanup, plugin hot-reload). */
export function unregisterPeerMethod(method: string): void {
  handlers.delete(method);
}

/** List currently-registered method names. */
export function listPeerMethods(): string[] {
  return [...handlers.keys()].sort();
}

/** Test-only reset hook. Removes all methods, including built-ins. */
export function _resetPeerRpcForTests(): void {
  handlers.clear();
  // Re-register the built-ins so tests don't have to know about them.
  registerBuiltInMethods();
}

// ──────────────────────────────────────────────────────────────────
// Built-in methods
// ──────────────────────────────────────────────────────────────────

/**
 * Register the default peer methods: describe, ping, echo. Called once
 * at module load below. Plugins can override by re-registering with the
 * same method name.
 */
function registerBuiltInMethods(): void {
  // peer.describe — return basic identity + list of registered methods.
  // Mirror of OpenClaw node.describe but with method-list discovery
  // baked in (we don't have a Capabilities enum yet — just expose what
  // we can answer). Phase (d).14 adds `role` + `maxDepth`.
  registerPeerMethod('peer.describe', async () => {
    // Phase (d).16a — surface the wired peer.chat provider (or null)
    // so remote Claudes can discover what kind of LLM is behind this
    // peer's peer.chat, if any. Lazy import to avoid pulling
    // peer-chat-bridge at peer-rpc load time.
    let peerChatProvider: { provider: string; model: string; isLocal: boolean } | null = null;
    try {
      const { getPeerChatProviderInfo } = await import('../../fleet/peer-chat-bridge.js');
      peerChatProvider = getPeerChatProviderInfo();
    } catch {
      /* bridge not loaded — peer.chat not wired */
    }
    // Fleet P2 — surface the peer's capability snapshot (configured
    // providers, local Ollama models, machine spec) so remote routers
    // can score "best peer × model" without an extra round-trip. Lazy
    // import to keep peer-rpc load-time dependency-free.
    let capabilities:
      | import('../../fleet/types.js').PeerCapability
      | null = null;
    try {
      const { getLocalCapabilities } = await import('../../fleet/capability-registry.js');
      capabilities = await getLocalCapabilities();
    } catch (_err) {
      // Capability detection is best-effort — never fail describe.
      capabilities = null;
    }
    return {
      hostname: process.env.CODEBUDDY_FLEET_HOSTNAME || os.hostname(),
      pid: process.pid,
      methods: listPeerMethods(),
      apiVersion: 'd.21', // bumped: peer.chat-session.* trio landed
      role: getPeerRole(),
      maxDepth: getMaxDepth(),
      peerChatProvider,
      capabilities,
    };
  });

  // peer.ping — minimal connectivity check. Echoes a server-side
  // timestamp so the caller can measure round-trip latency.
  registerPeerMethod('peer.ping', async () => ({
    pong: true,
    serverTime: Date.now(),
  }));

  // Fleet P3 — peer.dispatch : kick off a sub-task on this peer.
  // Accepts `{ id, prompt, model?, traceId?, parentRunId? }`, lets the
  // local agent runtime pick up the work, and returns a `runId` that
  // the caller can poll or subscribe-to-events on.
  //
  // The actual execution is handed off to peer-chat-bridge (which
  // already wraps the local agent for `peer.chat` one-shots) — this
  // method is a thin async wrapper so the caller doesn't block waiting
  // for the LLM response.
  registerPeerMethod('peer.dispatch', async (params, ctx) => {
    const { id, prompt, model, traceId, parentRunId, dispatchProfile } = (params ?? {}) as {
      id?: string;
      prompt?: string;
      model?: string;
      traceId?: string;
      parentRunId?: string;
      dispatchProfile?: unknown;
    };
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('peer.dispatch: missing string prompt');
    }
    if (dispatchProfile !== undefined && !isFleetDispatchProfile(dispatchProfile)) {
      throw new Error(
        `peer.dispatch: dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}`,
      );
    }
    const dispatchId =
      typeof id === 'string' && id.length > 0
        ? id
        : `disp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const resolvedDispatchProfile = normalizeDispatchProfile(dispatchProfile);
    const resolvedTraceId = typeof traceId === 'string' && traceId.length > 0
      ? traceId
      : ctx.traceId;

    // Lazy-import to avoid pulling the bridge at module load.
    const { dispatchPeerTask, getDispatchState } = await import('../../fleet/peer-chat-bridge.js');
    // Returns immediately — the bridge owns the async lifecycle.
    void dispatchPeerTask({
      runId: dispatchId,
      prompt,
      model,
      dispatchProfile: resolvedDispatchProfile,
      traceId: resolvedTraceId,
      parentRunId,
    });
    const state = getDispatchState(dispatchId);
    return {
      runId: dispatchId,
      acceptedAt: Date.now(),
      traceId: resolvedTraceId,
      dispatchProfile: resolvedDispatchProfile,
      toolPolicy: state?.toolPolicy,
      toolDecisions: state?.toolDecisions,
      toolset: state?.toolset,
    };
  });

  // Fleet P3 — poll the result of an earlier peer.dispatch call.
  // The remote peer streams via the existing fleet WS event channel,
  // but a poll-based fallback keeps things simple when the dispatcher
  // hasn't subscribed to those events yet.
  registerPeerMethod('peer.dispatchStatus', async (params) => {
    const runId = (params ?? {}).runId;
    if (typeof runId !== 'string' || runId.length === 0) {
      throw new Error('peer.dispatchStatus: missing string runId');
    }
    const { getDispatchState } = await import('../../fleet/peer-chat-bridge.js');
    const state = getDispatchState(runId);
    if (!state) {
      return { found: false };
    }
    return {
      found: true,
      runId: state.runId,
      status: state.status,
      dispatchProfile: state.dispatchProfile,
      toolPolicy: state.toolPolicy,
      toolDecisions: state.toolDecisions,
      toolset: state.toolset,
      result: state.result,
      error: state.error,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
    };
  });

  // peer.echo — debugging aid. Returns the params verbatim. Useful for
  // smoke-testing the request/response loop without depending on any
  // other method's semantics.
  registerPeerMethod('peer.echo', async (params) => ({ echoed: params }));
}

registerBuiltInMethods();

// ──────────────────────────────────────────────────────────────────
// Dispatch
// ──────────────────────────────────────────────────────────────────

/**
 * Route a `peer:request` frame to its handler and return the response
 * frame. Never throws — all error paths produce a structured error
 * response. The caller (handler.ts) just sends what we return.
 *
 * Phase (d).14 — the `ctx.traceId/depth` passed by handler.ts is
 * ignored here; this dispatcher derives them from the FRAME (so the
 * chain is end-to-end propagated). The ctx that lands in the user
 * handler carries the resolved values.
 */
export async function dispatchPeerRequest(
  frame: PeerRequestFrame,
  ctx: PeerMethodContext,
): Promise<PeerResponseFrame> {
  // Validate request shape
  if (!frame.id || typeof frame.id !== 'string') {
    return {
      id: frame.id ?? 'unknown',
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'request id missing or not a string' },
    };
  }
  if (!frame.method || typeof frame.method !== 'string') {
    return {
      id: frame.id,
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'method missing or not a string' },
    };
  }

  // Phase (d).14 — resolve trace + depth from the frame, defaulting to
  // a fresh top-level chain. Reject if depth is past the cap.
  const traceId = frame.traceId && typeof frame.traceId === 'string' ? frame.traceId : newTraceId();
  const depth = typeof frame.depth === 'number' && Number.isFinite(frame.depth) && frame.depth >= 0
    ? Math.floor(frame.depth)
    : 0;
  const maxDepth = getMaxDepth();
  if (depth > maxDepth) {
    return {
      id: frame.id,
      ok: false,
      error: {
        code: 'MAX_DEPTH_EXCEEDED',
        message: `peer.invoke chain depth ${depth} > max ${maxDepth} (traceId=${traceId})`,
      },
    };
  }

  const handler = handlers.get(frame.method);
  if (!handler) {
    return {
      id: frame.id,
      ok: false,
      error: { code: 'UNKNOWN_METHOD', message: `no handler registered for "${frame.method}"` },
    };
  }

  // Build the per-call ctx with the resolved trace + depth. Forward
  // emitChunk if the transport provided one (Phase d.19 — streaming).
  const callCtx: PeerMethodContext = {
    ...ctx,
    traceId,
    depth,
  };
  if (ctx.emitChunk) callCtx.emitChunk = ctx.emitChunk;
  try {
    const payload = await handler(frame.params ?? {}, callCtx);
    return { id: frame.id, ok: true, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`[peer-rpc] method "${frame.method}" threw`, { error: message, traceId, depth });
    return {
      id: frame.id,
      ok: false,
      error: { code: 'METHOD_ERROR', message },
    };
  }
}
