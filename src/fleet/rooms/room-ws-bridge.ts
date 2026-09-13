/**
 * Fleet rooms — wiring on the existing `/ws` endpoint.
 *
 * Uses `registerWebSocketExtension` (no access to the socket or connection
 * state) like the cognition bus. Transport gate: an authenticated principal
 * holding `fleet:listen` (or `admin`), never an anonymous remote client. Room
 * access itself is decided by the member key proof and the room policy.
 *
 * Client → hub (`{ type, id?, payload }`):
 * - `fleet.rooms.hello` → `fleet.rooms.challenge { challenge, expiresAt }`
 * - `fleet.rooms.auth { event }` → `fleet.rooms.auth { ok, pubkey?, name?, rooms?, message? }`
 * - `fleet.rooms.publish { event }` → `fleet.rooms.ok { id, accepted, message, seq?, storeId }`
 * - `fleet.rooms.subscribe { subId, filters, afterSeq?, storeId? }` →
 *   `fleet.rooms.event*`, then `fleet.rooms.eose` (or `fleet.rooms.closed`)
 * - `fleet.rooms.close { subId }` → `fleet.rooms.unsubscribed { subId, closed }`
 *
 * Replies carry the request `id` as `requestId`; stream frames carry `subId`.
 *
 * @module fleet/rooms/room-ws-bridge
 */

import { SERVER_CONFIG } from '../../config/constants.js';
import {
  registerWebSocketExtension,
  type WebSocketExtensionContext,
  type WebSocketExtensionEnvelope,
} from '../../server/websocket/handler.js';
import { logger } from '../../utils/logger.js';
import type { RoomHub, RoomSession } from './room-hub.js';

export interface FleetRoomsBridgeOptions {
  /** Close a subscription instead of queueing once the socket holds this many bytes. */
  maxBufferedBytes?: number;
}

export const FLEET_ROOMS_MESSAGE_TYPES = [
  'fleet.rooms.hello',
  'fleet.rooms.auth',
  'fleet.rooms.publish',
  'fleet.rooms.subscribe',
  'fleet.rooms.close',
] as const;

function requestIdOf(envelope: WebSocketExtensionEnvelope): string | undefined {
  return envelope.requestId ?? envelope.id;
}

function reply(
  context: WebSocketExtensionContext,
  envelope: WebSocketExtensionEnvelope,
  type: string,
  payload: unknown,
): void {
  const requestId = requestIdOf(envelope);
  context.send({ type, ...(requestId ? { requestId } : {}), payload, timestamp: new Date().toISOString() });
}

function transportAllowed(context: WebSocketExtensionContext): boolean {
  const { principal } = context;
  if (principal.anonymousRemote) return false;
  return principal.scopes.includes('fleet:listen') || principal.scopes.includes('admin');
}

function eventOf(payload: unknown): unknown {
  return payload && typeof payload === 'object' ? (payload as { event?: unknown }).event : undefined;
}

export function wireFleetRoomsBridge(hub: RoomHub, options: FleetRoomsBridgeOptions = {}): () => void {
  const maxBufferedBytes = options.maxBufferedBytes ?? SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT;
  if (!Number.isFinite(maxBufferedBytes) || maxBufferedBytes < 0) {
    throw new RangeError('maxBufferedBytes must be a finite number >= 0');
  }
  const sessions = new Map<string, { session: RoomSession; deregister: () => void }>();
  const unregister: Array<() => void> = [];
  let wired = true;

  const sessionFor = (context: WebSocketExtensionContext): RoomSession => {
    const existing = sessions.get(context.connectionId);
    if (existing && !existing.session.isDisposed) return existing.session;
    const session = hub.open({
      connectionId: context.connectionId,
      principalId: context.principal.id,
      send: (frame) => context.send({ ...frame, timestamp: new Date().toISOString() }),
      isBackpressured: () => context.isBackpressured(maxBufferedBytes),
    });
    const deregister = context.onClose(() => {
      session.dispose();
      sessions.delete(context.connectionId);
    });
    sessions.set(context.connectionId, { session, deregister });
    return session;
  };

  const register = (
    type: (typeof FLEET_ROOMS_MESSAGE_TYPES)[number],
    handle: (session: RoomSession, context: WebSocketExtensionContext, payload: unknown, envelope: WebSocketExtensionEnvelope) => void,
  ): void => {
    unregister.push(registerWebSocketExtension({
      type,
      handle(context, payload, envelope): void {
        if (!wired) return;
        if (!transportAllowed(context)) {
          reply(context, envelope, 'fleet.rooms.error', {
            code: 'FORBIDDEN',
            message: 'restricted: fleet rooms require an authenticated connection with fleet:listen',
          });
          return;
        }
        try {
          handle(sessionFor(context), context, payload, envelope);
        } catch (error) {
          logger.error('[fleet-rooms] bridge failure', {
            type,
            connectionId: context.connectionId,
            error: error instanceof Error ? error.message : String(error),
          });
          reply(context, envelope, 'fleet.rooms.error', { code: 'INTERNAL', message: 'error: fleet rooms internal error' });
        }
      },
    }));
  };

  try {
    register('fleet.rooms.hello', (session, context, _payload, envelope) => {
      reply(context, envelope, 'fleet.rooms.challenge', session.hello());
    });
    register('fleet.rooms.auth', (session, context, payload, envelope) => {
      reply(context, envelope, 'fleet.rooms.auth', session.authenticate(eventOf(payload)));
    });
    register('fleet.rooms.publish', (session, context, payload, envelope) => {
      reply(context, envelope, 'fleet.rooms.ok', session.publish(eventOf(payload)));
    });
    register('fleet.rooms.subscribe', (session, context, payload, envelope) => {
      const result = session.subscribe(payload);
      if (!result.ok) reply(context, envelope, 'fleet.rooms.error', { code: 'INVALID', message: result.message });
    });
    register('fleet.rooms.close', (session, context, payload, envelope) => {
      const subId = payload && typeof payload === 'object' ? (payload as { subId?: unknown }).subId : undefined;
      reply(context, envelope, 'fleet.rooms.unsubscribed', session.unsubscribe(subId));
    });
  } catch (error) {
    for (const undo of unregister.splice(0)) undo();
    throw error;
  }

  return () => {
    if (!wired) return;
    wired = false;
    for (const undo of unregister.splice(0)) undo();
    for (const { session, deregister } of sessions.values()) {
      deregister();
      session.dispose();
    }
    sessions.clear();
  };
}
