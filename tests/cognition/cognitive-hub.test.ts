import { describe, expect, it } from 'vitest';
import {
  CognitiveHub,
  CognitiveHubError,
  type CognitivePrincipal,
} from '../../src/cognition/cognitive-hub.js';

const EVENT_A = '00000000-0000-4000-8000-000000000001';
const EVENT_B = '00000000-0000-4000-8000-000000000002';
const EVENT_C = '00000000-0000-4000-8000-000000000003';

function principal(
  id: string,
  scopes: string[] = [
    'cognition:write',
    'cognition:read',
    'cognition:raw',
    'cognition:write-local',
    'cognition:read-local',
  ],
): CognitivePrincipal {
  return { id, source: `test-${id}`, scopes, loopback: true };
}

function utterance(
  clientEventId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    clientEventId,
    draft: {
      kind: 'utterance',
      correlationId: 'turn-1',
      salience: 0.7,
      confidence: 1,
      privacy: 'local-only',
      ttlMs: 60_000,
      payload: { role: 'user', content: 'Bonjour Lisa', surface: 'voice' },
      ...overrides,
    },
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CognitiveHubError);
    expect((error as CognitiveHubError).code).toBe(code);
  }
}

describe('CognitiveHub', () => {
  it('owns canonical fields and makes publication retries idempotent', () => {
    const hub = new CognitiveHub();
    const actor = principal('voice');
    const first = hub.publish(actor, utterance(EVENT_A));
    const replay = hub.publish(actor, utterance(EVENT_A));

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.item.id).toBe(first.item.id);
    expect(hub.workspace.currentRevision()).toBe(1);
    expect(first.item).toMatchObject({
      producerId: 'cognitive:voice',
      depth: 0,
      provenance: { source: 'cognitive-bus:test-voice' },
    });

    expectCode(
      () => hub.publish(actor, utterance(EVENT_A, {
        payload: { role: 'user', content: 'Contenu différent', surface: 'voice' },
      })),
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('rejects reserved fields, executable actions and arbitrary payload fields', () => {
    const hub = new CognitiveHub();
    const actor = principal('voice');
    expectCode(
      () => hub.publish(actor, utterance(EVENT_A, { producerId: 'forged' })),
      'COGNITION_INVALID_REQUEST',
    );
    expectCode(
      () => hub.publish(actor, utterance(EVENT_B, {
        kind: 'action',
        payload: { command: 'rm -rf /' },
      })),
      'COGNITION_INVALID_REQUEST',
    );
    expectCode(
      () => hub.publish(actor, utterance(EVENT_C, {
        payload: { role: 'user', content: 'photo', surface: 'voice', localPath: '/tmp/a.jpg' },
      })),
      'COGNITION_INVALID_REQUEST',
    );
  });

  it('enforces write clearance and filters raw snapshots by route privacy', () => {
    const hub = new CognitiveHub();
    const local = principal('local');
    const cloud = principal('cloud', ['cognition:write', 'cognition:raw']);
    hub.publish(local, utterance(EVENT_A));

    expectCode(() => hub.publish(cloud, utterance(EVENT_B)), 'COGNITION_FORBIDDEN');
    expect(hub.snapshot(cloud).items).toEqual([]);
    expect(hub.snapshot(local).items).toHaveLength(1);
  });

  it('requires an actually secure transport for trusted-LAN clearance', () => {
    const hub = new CognitiveHub();
    hub.workspace.publish({
      kind: 'hypothesis',
      producerId: 'lan-specialist',
      correlationId: 'lan-turn',
      salience: 0.8,
      confidence: 0.8,
      privacy: 'trusted-lan',
      provenance: { source: 'test' },
      ttlMs: 60_000,
      payload: { summary: 'LAN only' },
    });
    const insecure: CognitivePrincipal = {
      id: 'remote',
      source: 'remote-test',
      scopes: ['cognition:raw', 'cognition:read-lan'],
      loopback: false,
      secure: false,
    };
    expect(hub.snapshot(insecure).items).toEqual([]);
    expect(hub.snapshot({ ...insecure, secure: true }).items).toHaveLength(1);
  });

  it('derives depth and preserves the strongest privacy from verified parents', () => {
    const hub = new CognitiveHub();
    const actor = principal('reflector');
    const parent = hub.publish(actor, utterance(EVENT_A)).item;
    const derived = hub.publish(actor, {
      version: 1,
      clientEventId: EVENT_B,
      draft: {
        kind: 'hypothesis',
        correlationId: 'turn-1',
        salience: 0.8,
        confidence: 0.6,
        privacy: 'cloud-ok',
        parentItemIds: [parent.id],
        payload: { summary: 'Patrice souhaite approfondir ce sujet.' },
      },
    }).item;
    expect(derived.depth).toBe(1);
    expect(derived.privacy).toBe('local-only');
    expect(derived.provenance.derivedFrom).toEqual([parent.id]);

    expectCode(
      () => hub.publish(actor, {
        version: 1,
        clientEventId: EVENT_C,
        draft: {
          kind: 'hypothesis',
          correlationId: 'turn-1',
          salience: 0.5,
          confidence: 0.5,
          privacy: 'cloud-ok',
          parentItemIds: ['workspace_missing_1'],
          payload: { summary: 'Parent absent.' },
        },
      }),
      'PARENT_NOT_FOUND',
    );
  });

  it('owns context leases and consumes them only after commit', () => {
    const hub = new CognitiveHub();
    hub.workspace.publish({
      kind: 'hypothesis',
      producerId: 'reflector',
      correlationId: 'old-turn',
      salience: 0.9,
      confidence: 0.8,
      privacy: 'local-only',
      provenance: { source: 'llm-specialist:test' },
      ttlMs: 60_000,
      payload: { summary: 'Une réflexion utile pour la conversation.' },
    });
    const actor = principal('voice');
    const stranger = principal('telegram');
    const first = hub.acquireContext(actor, { version: 1 });
    expect(first.leaseId).not.toBeNull();
    expectCode(
      () => hub.commitContext(stranger, { version: 1, leaseId: first.leaseId }),
      'LEASE_FORBIDDEN',
    );
    hub.releaseContext(actor, { version: 1, leaseId: first.leaseId });

    const retry = hub.acquireContext(actor, { version: 1 });
    expect(retry.itemIds).toHaveLength(1);
    hub.commitContext(actor, { version: 1, leaseId: retry.leaseId });
    expect(hub.acquireContext(actor, { version: 1 }).itemIds).toEqual([]);
  });

  it('enforces correlation ownership and rejects late publications after cancellation', () => {
    const hub = new CognitiveHub();
    const voice = principal('voice');
    const telegram = principal('telegram');
    hub.publish(voice, utterance(EVENT_A));
    expectCode(
      () => hub.cancel(telegram, { version: 1, correlationId: 'turn-1' }),
      'CORRELATION_FORBIDDEN',
    );
    expect(hub.cancel(voice, { version: 1, correlationId: 'turn-1' })).toEqual({ cancelled: true });
    expectCode(() => hub.publish(voice, utterance(EVENT_B)), 'CORRELATION_CANCELLED');
  });

  it('streams only authorized canonical items after the requested revision', async () => {
    const hub = new CognitiveHub();
    const actor = principal('voice');
    const received: number[] = [];
    const unsubscribe = hub.subscribe(
      actor,
      { version: 1, afterRevision: 1, kinds: ['utterance'] },
      (event) => received.push(event.revision),
    );
    hub.publish(actor, utterance(EVENT_A));
    hub.publish(actor, utterance(EVENT_B, { correlationId: 'turn-2' }));
    await Promise.resolve();
    expect(received).toEqual([2]);
    unsubscribe();
  });
});
