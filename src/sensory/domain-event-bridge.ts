/**
 * Domain-event bridge — re-emits the agent's INTERNAL domain events (fleet activity,
 * loop detection, cost, context compaction) as normalized `sensory:perception` percepts,
 * so ONE rule grammar (sensory-rules-engine) covers physical perception AND the agent's
 * inner life. A user writes `match.kind:'loop_detected'` the same way they write
 * `match.kind:'person_entered'` — no second system to learn.
 *
 * Contract mirrors `reactions.ts wireSensoryReactions`: returns an unsubscribe fn that
 * detaches every listener by its bus id.
 *
 * ANTI-LOOP (imperative): this bridge subscribes ONLY to the domain event types below,
 * NEVER to `sensory:perception`. Its re-emitted percepts are tagged `source:'domain-bridge'`
 * and every handler skips an event carrying that source — so even a future maintainer who
 * wires a sensory:perception subscription cannot create a feedback loop. Re-emission goes
 * through the in-process bus (never the WS bridge). Never throws.
 *
 * @module sensory/domain-event-bridge
 */
import { getGlobalEventBus } from '../events/event-bus.js';
import type { BaseEvent } from '../events/types.js';
import { logger } from '../utils/logger.js';

/** The source tag on every percept this bridge emits — also the anti-loop marker. */
export const DOMAIN_BRIDGE_SOURCE = 'domain-bridge';

/** Salience per re-emitted kind (0–255). A limit/loop is loud; a cost tick is quiet. */
const SALIENCE = {
  loop_detected: 200,
  cost_limit_reached: 200,
  cost_warning: 150,
  cost_updated: 10,
  activity: 80,
  context_pre_compact: 60,
  provider_fallback: 180,
} as const;

function clampSalience(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Wire the domain-event bridge. Returns an unsubscribe fn detaching every listener.
 * Opt-in caller (server) gates this behind CODEBUDDY_DOMAIN_EVENTS.
 */
export function wireDomainEventBridge(): () => void {
  const bus = getGlobalEventBus();
  const ids: string[] = [];

  /** Re-emit one domain event as a sensory percept, guarding against self-ingestion. */
  const reemit = (
    incoming: BaseEvent,
    modality: string,
    kind: string,
    salience: number,
    payload: Record<string, unknown>,
  ): void => {
    try {
      // Anti-loop guard: never re-process a percept this bridge itself produced.
      if (incoming?.source === DOMAIN_BRIDGE_SOURCE) return;
      bus.emit('sensory:perception', {
        source: DOMAIN_BRIDGE_SOURCE,
        metadata: { modality, kind, salience: clampSalience(salience), payload },
      });
    } catch (err) {
      logger.debug(
        `[domain-bridge] re-emit failed for ${modality}/${kind}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // ── fleet:activity → fleet/activity ──────────────────────────────────────
  ids.push(
    bus.on('fleet:activity', (evt: BaseEvent) => {
      const e = evt as BaseEvent & {
        activityType?: string;
        title?: string;
        description?: string;
      };
      reemit(evt, 'fleet', 'activity', SALIENCE.activity, {
        activityType: e.activityType,
        title: e.title,
        description: e.description,
        ...(e.metadata ?? {}),
      });
    }),
  );

  // ── agent:loop_detected → agent/loop_detected ────────────────────────────
  ids.push(
    bus.on('agent:loop_detected', (evt: BaseEvent) => {
      const e = evt as BaseEvent & {
        loopType?: string;
        detail?: string;
        count?: number;
        turnIndex?: number;
      };
      reemit(evt, 'agent', 'loop_detected', SALIENCE.loop_detected, {
        loopType: e.loopType,
        detail: e.detail,
        count: e.count,
        turnIndex: e.turnIndex,
      });
    }),
  );

  // ── cost:* → agent/cost_<subtype> ────────────────────────────────────────
  ids.push(
    bus.on('cost:updated', (evt: BaseEvent) => {
      const e = evt as BaseEvent & { currentCost?: number; sessionLimit?: number };
      reemit(evt, 'agent', 'cost_updated', SALIENCE.cost_updated, {
        currentCost: e.currentCost,
        sessionLimit: e.sessionLimit,
      });
    }),
  );
  ids.push(
    bus.on('cost:warning', (evt: BaseEvent) => {
      const e = evt as BaseEvent & {
        currentCost?: number;
        threshold?: number;
        percentUsed?: number;
      };
      reemit(evt, 'agent', 'cost_warning', SALIENCE.cost_warning, {
        currentCost: e.currentCost,
        threshold: e.threshold,
        percentUsed: e.percentUsed,
      });
    }),
  );
  ids.push(
    bus.on('cost:limit_reached', (evt: BaseEvent) => {
      const e = evt as BaseEvent & { currentCost?: number; limit?: number };
      reemit(evt, 'agent', 'cost_limit_reached', SALIENCE.cost_limit_reached, {
        currentCost: e.currentCost,
        limit: e.limit,
      });
    }),
  );

  // ── context:pre_compact → agent/context_pre_compact ──────────────────────
  ids.push(
    bus.on('context:pre_compact', (evt: BaseEvent) => {
      const e = evt as BaseEvent & {
        reason?: string;
        tokensBefore?: number;
        messagesBefore?: number;
      };
      reemit(evt, 'agent', 'context_pre_compact', SALIENCE.context_pre_compact, {
        reason: e.reason,
        tokensBefore: e.tokensBefore,
        messagesBefore: e.messagesBefore,
      });
    }),
  );

  ids.push(
    bus.on('provider:fallback', (evt: BaseEvent) => {
      const e = evt as BaseEvent & {
        fromProvider?: string;
        toProvider?: string;
        reason?: string;
        resetsAt?: number;
        resets_at?: number;
      };
      const resetsAt = e.resetsAt ?? e.resets_at;
      reemit(evt, 'provider', 'provider_fallback', SALIENCE.provider_fallback, {
        fromProvider: e.fromProvider,
        toProvider: e.toProvider,
        reason: e.reason,
        ...(resetsAt !== undefined ? { resetsAt, resets_at: resetsAt } : {}),
      });
    }),
  );

  logger.info(
    `[domain-bridge] wired — fleet:activity, agent:loop_detected, cost:*, context:pre_compact, provider:fallback → sensory:perception`,
  );

  return () => {
    for (const id of ids) {
      try {
        bus.off(id);
      } catch {
        /* best-effort teardown */
      }
    }
  };
}
