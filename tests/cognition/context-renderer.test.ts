import { describe, expect, it } from 'vitest';
import { CognitiveContextProjector } from '../../src/cognition/context-renderer.js';
import { GlobalWorkspace } from '../../src/cognition/global-workspace.js';

function seed(workspace: GlobalWorkspace): void {
  workspace.publish({
    kind: 'hypothesis',
    producerId: 'reflector',
    correlationId: 'old-turn',
    salience: 0.8,
    confidence: 0.7,
    privacy: 'local-only',
    provenance: { source: 'llm-specialist:test' },
    ttlMs: 60_000,
    payload: { summary: 'Patrice souhaite approfondir la question de la mémoire.' },
  });
  workspace.publish({
    kind: 'fact',
    producerId: 'world-model',
    correlationId: 'world:camera',
    salience: 0.9,
    confidence: 0.95,
    privacy: 'local-only',
    provenance: { source: 'deterministic-world-reducer' },
    ttlMs: 60_000,
    payload: { id: 'person-occupancy:camera', visibility: 'visible' },
  });
}

describe('CognitiveContextProjector', () => {
  it('separates tentative thoughts from sourced evidence', () => {
    const workspace = new GlobalWorkspace();
    seed(workspace);
    const lease = new CognitiveContextProjector(workspace).begin({
      consumerId: 'voice',
      privacyClearance: 'local-only',
      query: 'mémoire caméra',
    });
    expect(lease.turnContext).toContain('hypothèses, jamais des faits');
    expect(lease.turnContext).toContain('mémoire');
    expect(lease.evidence).toContain('deterministic-world-reducer');
    expect(lease.evidence).not.toContain('Patrice souhaite');
  });

  it('fails closed for cloud egress and excludes the current correlation', () => {
    const workspace = new GlobalWorkspace();
    seed(workspace);
    const projector = new CognitiveContextProjector(workspace);
    const cloud = projector.begin({ consumerId: 'cloud', privacyClearance: 'cloud-ok' });
    expect(cloud.itemIds).toEqual([]);

    const current = projector.begin({
      consumerId: 'voice',
      privacyClearance: 'local-only',
      excludeCorrelationId: 'old-turn',
    });
    expect(current.turnContext).toBe('');
    expect(current.evidence).toContain('person-occupancy');
  });

  it('commits once, while release makes the context available again', () => {
    const workspace = new GlobalWorkspace();
    seed(workspace);
    const projector = new CognitiveContextProjector(workspace);
    const first = projector.begin({ consumerId: 'voice', privacyClearance: 'local-only' });
    first.release();
    expect(
      projector.begin({ consumerId: 'voice', privacyClearance: 'local-only' }).itemIds,
    ).toHaveLength(2);

    const committed = projector.begin({ consumerId: 'second', privacyClearance: 'local-only' });
    committed.commit();
    expect(
      projector.begin({ consumerId: 'second', privacyClearance: 'local-only' }).itemIds,
    ).toEqual([]);
  });

  it('respects a hard character budget without leaking arbitrary payload fields', () => {
    const workspace = new GlobalWorkspace();
    seed(workspace);
    workspace.publish({
      kind: 'proposal',
      producerId: 'critic',
      correlationId: 'turn',
      salience: 1,
      confidence: 1,
      privacy: 'local-only',
      provenance: { source: 'test' },
      ttlMs: 60_000,
      payload: { secret: 'NE_DOIT_PAS_SORTIR', summary: 'Résumé autorisé.' },
    });
    const lease = new CognitiveContextProjector(workspace).begin({
      consumerId: 'voice',
      privacyClearance: 'local-only',
      maxChars: 220,
    });
    expect(lease.turnContext.length + lease.evidence.length).toBeLessThanOrEqual(220);
    expect(`${lease.turnContext}${lease.evidence}`).not.toContain('NE_DOIT_PAS_SORTIR');
  });
});
