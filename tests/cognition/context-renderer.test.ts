import { describe, expect, it } from 'vitest';
import { CognitiveContextProjector, renderSpatialEstimate } from '../../src/cognition/context-renderer.js';
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

  it('renders only a qualitative normalized image position from world facts', () => {
    const workspace = new GlobalWorkspace();
    workspace.publish({
      kind: 'fact',
      producerId: 'world-model',
      correlationId: 'world:track',
      salience: 1,
      confidence: 0.9,
      privacy: 'local-only',
      provenance: { source: 'deterministic-world-reducer' },
      ttlMs: 60_000,
      payload: {
        id: 'person-track:brio:opaque-secret-id',
        type: 'person-track',
        visibility: 'visible',
        trackerId: 'opaque-secret-id',
        attributes: { count: 1, private: 'NE_DOIT_PAS_SORTIR' },
        observation2d: {
          space: 'image-normalized-v1',
          x: 0.05,
          y: 0.1,
          width: 0.2,
          height: 0.3,
          z: 0.7,
          depthMeters: 2,
        },
      },
    });

    const lease = new CognitiveContextProjector(workspace).begin({
      consumerId: 'local-voice',
      privacyClearance: 'local-only',
    });

    expect(lease.evidence).toContain('présence visuelle anonyme');
    expect(lease.evidence).toContain('position image=gauche-haut');
    expect(lease.evidence).not.toContain('opaque-secret-id');
    expect(lease.evidence).not.toContain('NE_DOIT_PAS_SORTIR');
    expect(lease.evidence).not.toContain('depth');
    expect(lease.evidence).not.toContain('z=');
  });

  it('says where the person is relative to the robot, as a rounded estimate', () => {
    const workspace = new GlobalWorkspace();
    workspace.publish({
      kind: 'fact',
      producerId: 'world-model',
      correlationId: 'world:track',
      salience: 1,
      confidence: 0.9,
      privacy: 'local-only',
      provenance: { source: 'deterministic-world-reducer' },
      ttlMs: 60_000,
      payload: {
        id: 'person-track:brio:x',
        type: 'person-track',
        visibility: 'visible',
        attributes: { count: 1 },
        observation2d: {
          space: 'image-normalized-v1',
          x: 0.7,
          y: 0.3,
          width: 0.1,
          height: 0.2,
          spatial: { basis: 'estimate-ipd-v1', azimuthDeg: 21, elevationDeg: 5, distanceM: 1.38, facing: true },
        },
      },
    });
    const lease = new CognitiveContextProjector(workspace).begin({
      consumerId: 'local-voice',
      privacyClearance: 'local-only',
    });
    expect(lease.evidence).toContain('estimation caméra: à droite du robot, à environ 1,5 m, regarde le robot');
  });

  it('words the spatial estimate without overclaiming', () => {
    const base = { basis: 'estimate-ipd-v1', elevationDeg: 0 };
    expect(renderSpatialEstimate({ ...base, azimuthDeg: -30, distanceM: 0.9, facing: false }))
      .toBe('estimation caméra: à gauche du robot, à environ 1 m, ne regarde pas le robot');
    expect(renderSpatialEstimate({ ...base, azimuthDeg: 3, distanceM: 0.2 }))
      .toBe('estimation caméra: face au robot, à environ 0,5 m');
    expect(renderSpatialEstimate({ ...base, azimuthDeg: 3, distanceM: 4.4 }))
      .toBe('estimation caméra: face au robot, à environ 4 m');
    expect(renderSpatialEstimate({ ...base, basis: 'metric', azimuthDeg: 3, distanceM: 1 })).toBeNull();
    expect(renderSpatialEstimate({ ...base, azimuthDeg: Number.NaN, distanceM: 1 })).toBeNull();
  });
});
