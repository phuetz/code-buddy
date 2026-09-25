import { describe, expect, it } from 'vitest';
import {
  dreamExplorationPolicy,
  replayDiscoveryWorld,
  worldsFromVariants,
  type DiscoveryPolicy,
} from '../../../../src/agent/self-improvement/evolution/dream-replay.js';
import { recordedDiscoveryEdge, type VariantRecord } from '../../../../src/agent/self-improvement/evolution/code-variant-store.js';

function variant(id: string, parent: string, weakness: string, score: number, second: number): VariantRecord {
  return {
    id, branch: `evolve/${id}`, sha: id, baselineSha: 'base', score,
    passedAll: true, regressions: [], createdAt: `2026-09-25T00:00:0${second}.000Z`,
    discovery: { worldId: 'base', primaryParentId: parent, weaknessId: weakness, baselineScore: 0.1 },
  };
}

const records = [
  variant('low', 'root', 'research-context-rag', 0.2, 1),
  variant('high', 'root', 'research-self-improvement', 0.9, 2),
  variant('dead', 'low', 'research-context-rag', 0.25, 3),
];

describe('Dream-RSI prefix replay', () => {
  it('does not add replay metadata by default', () => {
    const input = {
      worldId: 'base', primaryParentId: 'root', weaknessId: 'research-context-rag', baselineScore: 0.1,
    };
    expect(recordedDiscoveryEdge(input)).toBeUndefined();
    expect(recordedDiscoveryEdge({ ...input, optIn: 'false' })).toBeUndefined();
    expect(recordedDiscoveryEdge({ ...input, optIn: 'true' })).toEqual(input);
  });

  it('finds the better recorded branch in a synthetic discovery tree', () => {
    const worlds = worldsFromVariants(records);
    expect(worlds).toHaveLength(1);
    const result = dreamExplorationPolicy(worlds);
    expect(result.status).toBe('selected');
    if (result.status !== 'selected') return;
    expect(result.selection.weaknessId).toBe('research-self-improvement');
    expect(result.selection.parentId).toBe('root');
    expect(result.best.rollouts[0]?.revealedIds).toContain('high');
    expect(result.best.rollouts[0]?.bestScore).toBe(0.9);
    expect(result.best.objective).toBeGreaterThan(result.baseline.objective);
    expect(result.best.evidence).toBe('replay');
    expect(result.paired.wins).toBe(1);
    expect(result.paired.decision).toBe('undecided');
  });

  it('rejects a policy requesting an unrecorded continuation', () => {
    const world = worldsFromVariants(records)[0]!;
    const unsupported: DiscoveryPolicy = () => [{ parentId: 'root', weaknessId: 'never-recorded' }];
    const result = replayDiscoveryWorld(world, unsupported);
    expect(result.status).toBe('unsupported');
    if (result.status === 'unsupported') expect(result.reason).toBe('UNRECORDED_BRANCH');
    expect(result.revealedIds).toEqual([]);
  });

  it('reveals a descendant only after its parent and never reads a hidden score', () => {
    const world = worldsFromVariants(records)[0]!;
    const seen: string[][] = [];
    const policy: DiscoveryPolicy = (prefix) => {
      seen.push(prefix.nodes.map((node) => node.id));
      if (prefix.round === 0) return [{ parentId: 'root', weaknessId: 'research-context-rag' }];
      if (prefix.round === 1) return [{ parentId: 'low', weaknessId: 'research-context-rag' }];
      return [];
    };
    const replay = replayDiscoveryWorld(world, policy);
    expect(replay.status).toBe('completed');
    expect(replay.revealedIds).toEqual(['low', 'dead']);
    expect(seen).toEqual([[], ['low'], ['low', 'dead']]);
    expect(replay.bestScore).toBe(0.25);
  });

  it('does not treat inspiration lineage or incomplete score records as replay edges', () => {
    const legacy = { ...records[0]!, discovery: undefined, parents: ['high'] };
    expect(worldsFromVariants([legacy, records[1]!])).toEqual([]);
    const hiddenParent = { ...records[2]!, discovery: { ...records[2]!.discovery!, primaryParentId: 'missing' } };
    expect(worldsFromVariants([records[0]!, records[1]!, hiddenParent])).toEqual([]);
  });

  it('selects a recorded variant parent when a validated continuation improves most', () => {
    const strongerChild = variant('stronger', 'low', 'research-context-rag', 0.95, 3);
    const worlds = worldsFromVariants([records[0]!, records[1]!, strongerChild]);
    const result = dreamExplorationPolicy(worlds);
    expect(result.status).toBe('selected');
    if (result.status !== 'selected') return;
    expect(result.selection).toEqual({ parentId: 'low', weaknessId: 'research-context-rag' });
    expect(result.best.rollouts[0]?.revealedIds).toEqual(['low', 'stronger']);
  });

  it('does not reward a variant that failed the empirical fitness gate', () => {
    const failed = { ...records[1]!, passedAll: false, regressions: ['tests'] };
    const world = worldsFromVariants([records[0]!, failed])[0]!;
    const replay = replayDiscoveryWorld(world, (prefix) => prefix.round === 0
      ? [{ parentId: 'root', weaknessId: 'research-context-rag' }]
      : [{ parentId: 'root', weaknessId: 'research-self-improvement' }]);
    expect(replay.status).toBe('completed');
    expect(replay.revealedIds).toEqual(['low', 'high']);
    expect(replay.bestScore).toBe(0.2);
  });

  it('never selects a policy that regresses a recorded world', () => {
    const first = worldsFromVariants(records.slice(0, 2))[0]!;
    const second = {
      ...first, id: 'second',
      nodes: first.nodes.map((node) => ({
        ...node, score: node.id === 'low' ? 0.8 : 0.1,
      })),
    };
    const result = dreamExplorationPolicy([first, second]);
    expect(result.status).toBe('selected');
    if (result.status !== 'selected') return;
    for (let index = 0; index < 2; index++) {
      expect(result.best.rollouts[index]!.objective).toBeGreaterThanOrEqual(result.baseline.rollouts[index]!.objective);
    }
    expect(result.paired.losses).toBe(0);
  });
});
