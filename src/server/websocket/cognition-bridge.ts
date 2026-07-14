import { SERVER_CONFIG } from '../../config/constants.js';
import {
  CognitiveHub,
  CognitiveHubError,
  type CognitivePrincipal,
  type CognitiveSubscriptionEvent,
} from '../../cognition/cognitive-hub.js';
import {
  cognitiveLeaseRequestSchema,
  cognitiveSubscriptionRequestSchema,
  COGNITIVE_WIRE_VERSION,
} from '../../cognition/cognitive-wire-contract.js';
import { logger } from '../../utils/logger.js';
import {
  registerWebSocketExtension,
  type WebSocketExtensionContext,
  type WebSocketExtensionEnvelope,
} from './handler.js';

const DEFAULT_SUBSCRIPTION_CAPACITY = 64;
const DEFAULT_BACKPRESSURE_POLL_MS = 25;

export interface CognitionBridgeOptions {
  /** Maximum live workspace events retained for one connection. */
  subscriptionCapacity?: number;
  /** Stop streaming full events once the socket reaches this queued byte count. */
  maxBufferedBytes?: number;
  backpressurePollMs?: number;
}

interface OwnedLease {
  principal: CognitivePrincipal;
}

interface PendingGap {
  serverEpoch: string;
  reason: 'backpressure' | 'queue-overflow';
  afterRevision: number;
  throughRevision: number;
}

interface SubscriptionDelivery {
  context: WebSocketExtensionContext;
  unsubscribe: () => void;
  queue: CognitiveSubscriptionEvent[];
  lastDeliveredRevision: number;
  pendingGap?: PendingGap;
  pausedForBackpressure: boolean;
  drainScheduled: boolean;
  closed: boolean;
  retryTimer?: NodeJS.Timeout;
}

interface ConnectionRuntime {
  deregisterClose: () => void;
  leases: Map<string, OwnedLease>;
  subscription?: SubscriptionDelivery;
}

function principalFrom(context: WebSocketExtensionContext): CognitivePrincipal {
  return {
    id: context.principal.id,
    source: context.principal.source,
    scopes: context.principal.scopes,
    loopback: context.principal.loopback,
    secure: context.principal.secure,
  };
}

function responseRequestId(envelope: WebSocketExtensionEnvelope): string | undefined {
  return envelope.requestId ?? envelope.id;
}

function sendResponse(
  context: WebSocketExtensionContext,
  envelope: WebSocketExtensionEnvelope,
  type: string,
  payload: unknown,
): void {
  const requestId = responseRequestId(envelope);
  context.send({
    type,
    ...(requestId ? { requestId } : {}),
    payload,
    timestamp: new Date().toISOString(),
  });
}

function sendCognitiveError(
  context: WebSocketExtensionContext,
  envelope: WebSocketExtensionEnvelope,
  error: unknown,
): void {
  const requestId = responseRequestId(envelope);
  if (error instanceof CognitiveHubError) {
    context.send({
      type: 'cognition.error',
      ...(requestId ? { requestId } : {}),
      error: { code: error.code, message: error.message },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  logger.error('[cognition-ws] unexpected bridge failure', {
    connectionId: context.connectionId,
    error: error instanceof Error ? error.message : String(error),
  });
  context.send({
    type: 'cognition.error',
    ...(requestId ? { requestId } : {}),
    error: {
      code: 'COGNITION_INTERNAL_ERROR',
      message: 'The cognitive bus could not process this request',
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Wire the process-local CognitiveHub into the existing WebSocket gateway.
 * Returns a complete, idempotent unwire function for tests and server shutdown.
 */
export function wireCognitionBridge(
  hub: CognitiveHub,
  options: CognitionBridgeOptions = {},
): () => void {
  const subscriptionCapacity = Math.max(
    1,
    Math.min(1_024, Math.floor(options.subscriptionCapacity ?? DEFAULT_SUBSCRIPTION_CAPACITY)),
  );
  const maxBufferedBytes = Math.max(
    0,
    Math.floor(options.maxBufferedBytes ?? SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT),
  );
  const backpressurePollMs = Math.max(
    10,
    Math.min(1_000, Math.floor(options.backpressurePollMs ?? DEFAULT_BACKPRESSURE_POLL_MS)),
  );
  const runtimes = new Map<string, ConnectionRuntime>();
  const unregisterHandlers: Array<() => void> = [];
  let wired = true;

  const cleanupSubscription = (runtime: ConnectionRuntime): void => {
    const delivery = runtime.subscription;
    runtime.subscription = undefined;
    if (!delivery || delivery.closed) return;
    delivery.closed = true;
    delivery.unsubscribe();
    delivery.queue.length = 0;
    delivery.pendingGap = undefined;
    if (delivery.retryTimer) clearTimeout(delivery.retryTimer);
  };

  const cleanupRuntime = (connectionId: string): void => {
    const runtime = runtimes.get(connectionId);
    if (!runtime) return;
    runtimes.delete(connectionId);
    runtime.deregisterClose();
    cleanupSubscription(runtime);
    for (const [leaseId, owned] of runtime.leases) {
      try {
        hub.releaseContext(owned.principal, { version: COGNITIVE_WIRE_VERSION, leaseId });
      } catch (error) {
        logger.debug('[cognition-ws] lease cleanup skipped', {
          connectionId,
          leaseId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    runtime.leases.clear();
  };

  const runtimeFor = (context: WebSocketExtensionContext): ConnectionRuntime => {
    const existing = runtimes.get(context.connectionId);
    if (existing) return existing;
    const runtime: ConnectionRuntime = {
      deregisterClose: () => undefined,
      leases: new Map(),
    };
    runtimes.set(context.connectionId, runtime);
    runtime.deregisterClose = context.onClose(() => cleanupRuntime(context.connectionId));
    return runtime;
  };

  const sendGap = (delivery: SubscriptionDelivery, gap: PendingGap): boolean => {
    const sent = delivery.context.send({
      type: 'cognition.gap',
      payload: {
        version: COGNITIVE_WIRE_VERSION,
        serverEpoch: gap.serverEpoch,
        reason: gap.reason,
        afterRevision: gap.afterRevision,
        throughRevision: gap.throughRevision,
      },
      timestamp: new Date().toISOString(),
    });
    if (sent) delivery.lastDeliveredRevision = gap.throughRevision;
    return sent;
  };

  const mergeGap = (
    delivery: SubscriptionDelivery,
    events: readonly CognitiveSubscriptionEvent[],
    reason: PendingGap['reason'],
  ): void => {
    const first = events[0];
    const last = events.at(-1);
    if (!first || !last) return;
    const existing = delivery.pendingGap;
    delivery.pendingGap = {
      serverEpoch: last.serverEpoch,
      reason: existing?.reason === 'backpressure' ? 'backpressure' : reason,
      afterRevision: existing?.afterRevision ?? delivery.lastDeliveredRevision,
      throughRevision: Math.max(existing?.throughRevision ?? 0, last.revision),
    };
  };

  const scheduleBackpressureRetry = (delivery: SubscriptionDelivery): void => {
    if (delivery.closed || delivery.retryTimer) return;
    delivery.retryTimer = setTimeout(() => {
      delivery.retryTimer = undefined;
      if (delivery.closed) return;
      if (delivery.context.isBackpressured(maxBufferedBytes)) {
        scheduleBackpressureRetry(delivery);
        return;
      }
      const gap = delivery.pendingGap;
      delivery.pendingGap = undefined;
      if (gap && !sendGap(delivery, gap)) {
        delivery.closed = true;
        delivery.unsubscribe();
        return;
      }
      delivery.pausedForBackpressure = false;
      scheduleDrain(delivery);
    }, backpressurePollMs);
    delivery.retryTimer.unref?.();
  };

  const drain = (delivery: SubscriptionDelivery): void => {
    delivery.drainScheduled = false;
    if (delivery.closed || delivery.pausedForBackpressure) return;
    if (delivery.context.isBackpressured(maxBufferedBytes)) {
      mergeGap(delivery, delivery.queue, 'backpressure');
      delivery.queue.length = 0;
      delivery.pausedForBackpressure = true;
      scheduleBackpressureRetry(delivery);
      return;
    }
    while (delivery.queue.length > 0) {
      const event = delivery.queue.shift();
      if (!event) break;
      const sent = delivery.context.send({
        type: 'cognition.event',
        payload: event,
        timestamp: new Date().toISOString(),
      });
      if (!sent) {
        delivery.closed = true;
        delivery.unsubscribe();
        delivery.queue.length = 0;
        return;
      }
      delivery.lastDeliveredRevision = event.revision;
      if (delivery.context.isBackpressured(maxBufferedBytes) && delivery.queue.length > 0) {
        mergeGap(delivery, delivery.queue, 'backpressure');
        delivery.queue.length = 0;
        delivery.pausedForBackpressure = true;
        scheduleBackpressureRetry(delivery);
        return;
      }
    }
  };

  function scheduleDrain(delivery: SubscriptionDelivery): void {
    if (delivery.closed || delivery.drainScheduled) return;
    delivery.drainScheduled = true;
    queueMicrotask(() => drain(delivery));
  }

  const enqueueEvent = (
    runtime: ConnectionRuntime,
    delivery: SubscriptionDelivery,
    event: CognitiveSubscriptionEvent,
  ): void => {
    if (runtime.subscription !== delivery || delivery.closed) return;
    if (delivery.pausedForBackpressure) {
      mergeGap(delivery, [event], 'backpressure');
      return;
    }
    if (delivery.queue.length >= subscriptionCapacity) {
      mergeGap(delivery, [...delivery.queue, event], 'queue-overflow');
      delivery.queue.length = 0;
      if (delivery.context.isBackpressured(maxBufferedBytes)) {
        delivery.pausedForBackpressure = true;
        if (delivery.pendingGap) delivery.pendingGap.reason = 'backpressure';
        scheduleBackpressureRetry(delivery);
        return;
      }
      const gap = delivery.pendingGap;
      delivery.pendingGap = undefined;
      if (gap && !sendGap(delivery, gap)) cleanupSubscription(runtime);
      return;
    }
    delivery.queue.push(event);
    scheduleDrain(delivery);
  };

  const register = (
    type: string,
    handle: (
      context: WebSocketExtensionContext,
      payload: unknown,
      envelope: WebSocketExtensionEnvelope,
    ) => void,
    bypassLane = false,
  ): void => {
    unregisterHandlers.push(registerWebSocketExtension({
      type,
      ...(bypassLane ? { bypassLane: true } : {}),
      handle(context, payload, envelope): void {
        if (!wired) return;
        try {
          handle(context, payload, envelope);
        } catch (error) {
          sendCognitiveError(context, envelope, error);
        }
      },
    }));
  };

  try {
    register('cognition.publish', (context, payload, envelope) => {
      runtimeFor(context);
      const ack = hub.publish(principalFrom(context), payload);
      sendResponse(context, envelope, 'cognition.published', ack);
    });

    register('cognition.subscribe', (context, payload, envelope) => {
      const runtime = runtimeFor(context);
      cleanupSubscription(runtime);
      const principal = principalFrom(context);
      let delivery: SubscriptionDelivery;
      const unsubscribe = hub.subscribe(principal, payload, (event) => {
        enqueueEvent(runtime, delivery, event);
      });
      const request = cognitiveSubscriptionRequestSchema.parse(payload);
      delivery = {
        context,
        unsubscribe,
        queue: [],
        lastDeliveredRevision: request.afterRevision ?? 0,
        pausedForBackpressure: false,
        drainScheduled: false,
        closed: false,
      };
      runtime.subscription = delivery;
      sendResponse(context, envelope, 'cognition.subscribed', {
        version: COGNITIVE_WIRE_VERSION,
        serverEpoch: hub.serverEpoch,
        afterRevision: request.afterRevision ?? 0,
      });
    });

    register('cognition.cancel', (context, payload, envelope) => {
      runtimeFor(context);
      const ack = hub.cancel(principalFrom(context), payload);
      sendResponse(context, envelope, 'cognition.cancelled', {
        version: COGNITIVE_WIRE_VERSION,
        serverEpoch: hub.serverEpoch,
        ...ack,
      });
    }, true);

    register('cognition.context.acquire', (context, payload, envelope) => {
      const runtime = runtimeFor(context);
      const principal = principalFrom(context);
      const ack = hub.acquireContext(principal, payload);
      if (ack.leaseId) runtime.leases.set(ack.leaseId, { principal });
      sendResponse(context, envelope, 'cognition.context.acquired', ack);
    });

    register('cognition.context.commit', (context, payload, envelope) => {
      const runtime = runtimeFor(context);
      const principal = principalFrom(context);
      hub.commitContext(principal, payload);
      const request = cognitiveLeaseRequestSchema.parse(payload);
      runtime.leases.delete(request.leaseId);
      sendResponse(context, envelope, 'cognition.context.committed', {
        version: COGNITIVE_WIRE_VERSION,
        serverEpoch: hub.serverEpoch,
        leaseId: request.leaseId,
      });
    });

    register('cognition.context.release', (context, payload, envelope) => {
      const runtime = runtimeFor(context);
      const principal = principalFrom(context);
      hub.releaseContext(principal, payload);
      const request = cognitiveLeaseRequestSchema.parse(payload);
      runtime.leases.delete(request.leaseId);
      sendResponse(context, envelope, 'cognition.context.released', {
        version: COGNITIVE_WIRE_VERSION,
        serverEpoch: hub.serverEpoch,
        leaseId: request.leaseId,
      });
    });
  } catch (error) {
    for (const unregister of unregisterHandlers.splice(0)) unregister();
    throw error;
  }

  return () => {
    if (!wired) return;
    wired = false;
    for (const unregister of unregisterHandlers.splice(0)) unregister();
    for (const connectionId of [...runtimes.keys()]) cleanupRuntime(connectionId);
  };
}
