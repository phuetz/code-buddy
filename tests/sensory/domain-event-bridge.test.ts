/**
 * Domain-event bridge (Phase 4) — re-emits internal domain events as sensory percepts,
 * with a hard anti-loop guarantee. Proves: (a) a fleet:activity / agent:loop_detected /
 * cost:* / context:pre_compact yields a matching sensory:perception; (b) NO loop — emitting
 * a sensory:perception never triggers a re-emission; (c) flag off (bridge not wired) = no
 * subscription, no percept (byte-identical).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  wireDomainEventBridge,
  DOMAIN_BRIDGE_SOURCE,
} from '../../src/sensory/domain-event-bridge.js';
import { getGlobalEventBus, resetEventBus } from '../../src/events/event-bus.js';
import type { BaseEvent } from '../../src/events/types.js';

interface Percept {
  source?: string;
  metadata?: { modality?: string; kind?: string; salience?: number; payload?: Record<string, unknown> };
}

function probePercepts(): Percept[] {
  const seen: Percept[] = [];
  getGlobalEventBus().on('sensory:perception', (evt: BaseEvent) => {
    seen.push(evt as Percept);
  });
  return seen;
}

beforeEach(() => resetEventBus());
afterEach(() => resetEventBus());

describe('wireDomainEventBridge — re-emission (a)', () => {
  it('fleet:activity → fleet/activity percept', () => {
    const teardown = wireDomainEventBridge();
    const seen = probePercepts();
    getGlobalEventBus().emit('fleet:activity', {
      activityType: 'fleet.route',
      title: 'Fleet Route Planned',
      description: 'routed to peer A',
      metadata: { peer: 'A' },
    } as never);
    teardown();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.source).toBe(DOMAIN_BRIDGE_SOURCE);
    expect(seen[0]!.metadata).toMatchObject({ modality: 'fleet', kind: 'activity' });
    expect(seen[0]!.metadata!.payload).toMatchObject({ activityType: 'fleet.route', peer: 'A' });
  });

  it('agent:loop_detected → agent/loop_detected percept', () => {
    const teardown = wireDomainEventBridge();
    const seen = probePercepts();
    getGlobalEventBus().emit('agent:loop_detected', {
      loopType: 'tool_repeat',
      detail: 'same tool 5x',
      count: 5,
    } as never);
    teardown();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.metadata).toMatchObject({ modality: 'agent', kind: 'loop_detected' });
    expect(seen[0]!.metadata!.payload).toMatchObject({ loopType: 'tool_repeat', detail: 'same tool 5x', count: 5 });
  });

  it('cost:* → agent/cost_<subtype> percepts', () => {
    const teardown = wireDomainEventBridge();
    const seen = probePercepts();
    const bus = getGlobalEventBus();
    bus.emit('cost:updated', { currentCost: 1.2, sessionLimit: 10 } as never);
    bus.emit('cost:warning', { currentCost: 8, threshold: 7, percentUsed: 80 } as never);
    bus.emit('cost:limit_reached', { currentCost: 10, limit: 10 } as never);
    teardown();
    const kinds = seen.map((p) => p.metadata!.kind);
    expect(kinds).toEqual(['cost_updated', 'cost_warning', 'cost_limit_reached']);
    expect(seen.every((p) => p.metadata!.modality === 'agent')).toBe(true);
  });

  it('context:pre_compact → agent/context_pre_compact percept', () => {
    const teardown = wireDomainEventBridge();
    const seen = probePercepts();
    getGlobalEventBus().emit('context:pre_compact', {
      reason: 'auto',
      tokensBefore: 50000,
      messagesBefore: 42,
    } as never);
    teardown();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.metadata).toMatchObject({ modality: 'agent', kind: 'context_pre_compact' });
    expect(seen[0]!.metadata!.payload).toMatchObject({ reason: 'auto', tokensBefore: 50000, messagesBefore: 42 });
  });
});

describe('anti-loop guarantee (b)', () => {
  it('emitting a sensory:perception never triggers a re-emission', () => {
    const teardown = wireDomainEventBridge();
    const seen = probePercepts();
    // Emit a plain sensory percept — the bridge does NOT subscribe to sensory:perception.
    getGlobalEventBus().emit('sensory:perception', {
      source: 'buddy-sense',
      metadata: { modality: 'vision', kind: 'person_entered', payload: {} },
    });
    teardown();
    // Exactly the one we emitted — no bridge amplification.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.source).toBe('buddy-sense');
  });

  it('a domain event tagged source:domain-bridge is skipped (source marker guard)', () => {
    const teardown = wireDomainEventBridge();
    const seen = probePercepts();
    getGlobalEventBus().emit('fleet:activity', {
      source: DOMAIN_BRIDGE_SOURCE,
      activityType: 'x',
      title: 't',
      description: 'd',
    } as never);
    teardown();
    expect(seen).toHaveLength(0);
  });

  it('re-emitting into the bridge many times stays linear (no runaway amplification)', () => {
    const teardown = wireDomainEventBridge();
    const seen = probePercepts();
    const bus = getGlobalEventBus();
    for (let i = 0; i < 10; i++) {
      bus.emit('agent:loop_detected', { loopType: 't', detail: String(i), count: i } as never);
    }
    teardown();
    // Exactly one percept per domain event — never more.
    expect(seen).toHaveLength(10);
  });
});

describe('flag off = byte-identical (c)', () => {
  it('without wiring the bridge, a domain event produces no sensory percept', () => {
    const seen = probePercepts();
    getGlobalEventBus().emit('fleet:activity', {
      activityType: 'fleet.route',
      title: 't',
      description: 'd',
    } as never);
    expect(seen).toHaveLength(0);
  });

  it('teardown detaches every listener — after teardown, domain events are inert', () => {
    const teardown = wireDomainEventBridge();
    teardown();
    const seen = probePercepts();
    getGlobalEventBus().emit('agent:loop_detected', { loopType: 't', detail: 'd', count: 1 } as never);
    expect(seen).toHaveLength(0);
  });
});
