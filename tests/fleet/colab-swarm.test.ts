import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FleetColabStore } from '../../src/fleet/colab-store';
import { createSwarm } from '../../src/fleet/colab-swarm';

describe('createSwarm', () => {
  let dir: string;
  let store: FleetColabStore;
  let seq: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'colab-swarm-'));
    seq = 0;
    store = new FleetColabStore({ dir, agentId: 'me/cb', now: () => 1000, generateId: (p) => `${p}-${++seq}` });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('builds a workers → verifier → synthesizer DAG', () => {
    const graph = createSwarm(store, {
      goal: 'find bugs',
      workers: [{ title: 'scan auth' }, { title: 'scan db' }],
      createdBy: 'me/cb',
    });

    expect(graph.workerIds).toHaveLength(2);
    const verifier = store.getTask(graph.verifierId);
    const synth = store.getTask(graph.synthesizerId);
    expect(verifier?.dependsOn).toEqual(graph.workerIds);
    expect(synth?.dependsOn).toEqual([graph.verifierId]);
    // workers have no deps
    for (const id of graph.workerIds) expect(store.getTask(id)?.dependsOn).toBeUndefined();
  });

  it('runs the graph in order via nextClaimable: workers → verifier → synthesizer', () => {
    const g = createSwarm(store, { goal: 'build', workers: [{ title: 'w1' }, { title: 'w2' }] });

    // Only workers are claimable at first (verifier/synth blocked).
    const firstBatch = new Set<string>();
    let next = store.nextClaimable();
    while (next && g.workerIds.includes(next.id)) {
      firstBatch.add(next.id);
      store.claim(next.id);
      store.completeTask(next.id, { summary: `did ${next.id}` });
      next = store.nextClaimable();
    }
    expect(firstBatch).toEqual(new Set(g.workerIds));

    // Now the verifier is claimable (all workers done), synthesizer still blocked.
    expect(store.nextClaimable()?.id).toBe(g.verifierId);
    expect(() => store.claim(g.synthesizerId)).toThrow(/unmet dependencies/);
    store.claim(g.verifierId);
    store.completeTask(g.verifierId, { summary: 'verified' });

    // Finally the synthesizer.
    expect(store.nextClaimable()?.id).toBe(g.synthesizerId);
  });

  it('rejects a swarm with no workers', () => {
    expect(() => createSwarm(store, { goal: 'x', workers: [] })).toThrow(/at least one worker/);
  });
});
