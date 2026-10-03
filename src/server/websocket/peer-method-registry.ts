import { logger } from '../../utils/logger.js';

/**
 * Server-side handler context passed to method implementations.
 * Includes connection id for audit logs and the originating client's
 * scopes for permission-aware methods.
 */
export interface PeerMethodContext {
  /** WS connection id of the caller. */
  connectionId: string;
  /** Stable authenticated identity, when available, for persisted peer resources. */
  principalId?: string;
  /** Scopes held by the caller's authenticated session. */
  scopes: string[];
  /** Call-chain trace id for loop detection. */
  traceId: string;
  /** Current call depth in the chain (0 = fresh request from a human/external). */
  depth: number;
  /** Optional streaming output channel. */
  emitChunk?: (delta: string) => void;
}

/** Method handler signature. Async, returns the JSON-serializable payload. */
export type PeerMethodHandler = (
  params: Record<string, unknown>,
  ctx: PeerMethodContext,
) => Promise<unknown>;

const handlers = new Map<string, PeerMethodHandler>();

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

export function getPeerMethodHandler(method: string): PeerMethodHandler | undefined {
  return handlers.get(method);
}

/** Test-only reset primitive. Peer RPC re-registers built-ins after clearing. */
export function _clearPeerMethodsForTests(): void {
  handlers.clear();
}
