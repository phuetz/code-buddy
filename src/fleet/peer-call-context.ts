import { AsyncLocalStorage } from 'node:async_hooks';
import type { PeerMethodContext } from '../server/websocket/peer-method-registry.js';

interface PeerCallContext extends PeerMethodContext {
  /** Server-derived role, never taken from the request frame. */
  leaf: boolean;
}

const calls = new AsyncLocalStorage<PeerCallContext>();

export function runWithPeerCallContext<T>(context: PeerCallContext, invoke: () => T): T {
  return calls.run(context, invoke);
}

export function getPeerCallContext(): PeerCallContext | undefined {
  return calls.getStore();
}

/** All transports inherit the current request, including asynchronous fan-out. */
export function outgoingPeerCallOptions<T extends { traceId?: string; depth?: number }>(options: T): T {
  const context = calls.getStore();
  if (!context) return options;
  if (context.leaf) {
    throw Object.assign(new Error('peer.invoke ROLE_LEAF: receiver is a leaf and cannot forward requests'), { code: 'ROLE_LEAF' });
  }
  return { ...options, traceId: context.traceId, depth: context.depth + 1 };
}
