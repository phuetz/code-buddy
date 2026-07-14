import { describe, expect, it } from 'vitest';
import { GlobalWorkspace } from '../../src/cognition/global-workspace.js';
import type { WorkspaceDraft } from '../../src/cognition/types.js';

function draft(overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft {
  return {
    kind: 'percept',
    producerId: 'vision',
    correlationId: 'turn-1',
    salience: 0.5,
    confidence: 0.8,
    privacy: 'cloud-ok',
    provenance: { source: 'test' },
    payload: { label: 'cup' },
    ...overrides,
  };
}

describe('GlobalWorkspace', () => {
  it('stores immutable clones instead of caller-owned objects', () => {
    const workspace = new GlobalWorkspace();
    const payload = { nested: { label: 'cup' } };
    const item = workspace.publish(draft({ payload }));
    expect(item).not.toBeNull();
    payload.nested.label = 'changed outside';
    expect((workspace.snapshot()[0]!.payload as typeof payload).nested.label).toBe('cup');
    expect(Object.isFrozen(item!.payload)).toBe(true);
  });

  it('expires items and keeps the workspace bounded by salience', () => {
    let now = 1_000;
    const workspace = new GlobalWorkspace({ capacity: 2, defaultTtlMs: 100, now: () => now });
    workspace.publish(draft({ correlationId: 'low', salience: 0.1 }));
    workspace.publish(draft({ correlationId: 'high', salience: 0.9 }));
    workspace.publish(draft({ correlationId: 'middle', salience: 0.5 }));
    expect(workspace.snapshot().map((item) => item.correlationId)).toEqual(['high', 'middle']);
    now = 1_101;
    expect(workspace.snapshot()).toEqual([]);
    expect(workspace.metrics()).toMatchObject({ size: 0, evicted: 1, expired: 2 });
  });

  it('rejects a low-salience arrival rather than evicting more important attention', () => {
    const workspace = new GlobalWorkspace({ capacity: 1 });
    workspace.publish(draft({ salience: 0.9, correlationId: 'important' }));
    expect(workspace.publish(draft({ salience: 0.1, correlationId: 'noise' }))).toBeNull();
    expect(workspace.snapshot()[0]!.correlationId).toBe('important');
  });

  it('makes privacy monotone across derived items', () => {
    const workspace = new GlobalWorkspace();
    const privatePercept = workspace.publish(draft({ privacy: 'local-only' }))!;
    const derived = workspace.publish(
      draft({
        kind: 'hypothesis',
        producerId: 'reasoner',
        privacy: 'cloud-ok',
        provenance: { source: 'reasoner', derivedFrom: [privatePercept.id] },
      }),
    );
    expect(derived?.privacy).toBe('local-only');
  });
});
