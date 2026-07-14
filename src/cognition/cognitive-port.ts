import { randomUUID } from 'node:crypto';
import type {
  CognitiveContextAck,
  CognitiveHub,
  CognitivePrincipal,
  CognitivePublishAck,
  CognitiveSubscriptionEvent,
} from './cognitive-hub.js';
import {
  cognitiveContextAcquireRequestSchema,
  cognitiveDraftSchema,
  cognitiveSubscriptionRequestSchema,
  COGNITIVE_WIRE_VERSION,
  type CognitiveContextAcquireRequest,
  type CognitiveDraft,
  type CognitiveSubscriptionRequest,
} from './cognitive-wire-contract.js';

export interface CognitivePortContext {
  readonly leaseId: string | null;
  readonly turnContext: string;
  readonly evidence: string;
  readonly itemIds: readonly string[];
  commit(): Promise<void>;
  release(): Promise<void>;
}

/** Narrow authority shared by in-process and network cognition adapters. */
export interface CognitivePort {
  publish(draft: CognitiveDraft, clientEventId?: string): Promise<CognitivePublishAck>;
  cancel(correlationId: string): Promise<boolean>;
  acquireContext(
    options?: Omit<CognitiveContextAcquireRequest, 'version'>
  ): Promise<CognitivePortContext>;
  subscribe(listener: (event: CognitiveSubscriptionEvent) => void): () => void;
}

/**
 * Process-local adapter. It deliberately preserves the same validation and
 * transactional lease semantics as the WebSocket client.
 */
export class InProcessCognitivePort implements CognitivePort {
  private closed = false;

  constructor(
    private readonly hub: CognitiveHub,
    private readonly principal: CognitivePrincipal,
    private readonly subscription: Omit<CognitiveSubscriptionRequest, 'version'> = {}
  ) {}

  async publish(draft: CognitiveDraft, clientEventId = randomUUID()): Promise<CognitivePublishAck> {
    this.assertOpen();
    return this.hub.publish(this.principal, {
      version: COGNITIVE_WIRE_VERSION,
      clientEventId,
      draft: cognitiveDraftSchema.parse(draft),
    });
  }

  async cancel(correlationId: string): Promise<boolean> {
    this.assertOpen();
    return this.hub.cancel(this.principal, {
      version: COGNITIVE_WIRE_VERSION,
      correlationId,
    }).cancelled;
  }

  async acquireContext(
    options: Omit<CognitiveContextAcquireRequest, 'version'> = {}
  ): Promise<CognitivePortContext> {
    this.assertOpen();
    const request = cognitiveContextAcquireRequestSchema.parse({
      version: COGNITIVE_WIRE_VERSION,
      ...options,
    });
    const ack = this.hub.acquireContext(this.principal, request);
    return this.contextHandle(ack);
  }

  subscribe(listener: (event: CognitiveSubscriptionEvent) => void): () => void {
    this.assertOpen();
    const request = cognitiveSubscriptionRequestSchema.parse({
      version: COGNITIVE_WIRE_VERSION,
      ...this.subscription,
    });
    return this.hub.subscribe(this.principal, request, listener);
  }

  close(): void {
    this.closed = true;
  }

  private contextHandle(ack: CognitiveContextAck): CognitivePortContext {
    let settled = ack.leaseId === null;
    const settle = async (operation: 'commit' | 'release'): Promise<void> => {
      if (settled) return;
      settled = true;
      if (!ack.leaseId) return;
      const request = { version: COGNITIVE_WIRE_VERSION, leaseId: ack.leaseId };
      if (operation === 'commit') this.hub.commitContext(this.principal, request);
      else this.hub.releaseContext(this.principal, request);
    };
    return {
      leaseId: ack.leaseId,
      turnContext: ack.turnContext,
      evidence: ack.evidence,
      itemIds: ack.itemIds,
      commit: () => settle('commit'),
      release: () => settle('release'),
    };
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Cognitive port is closed');
  }
}
