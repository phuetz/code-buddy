import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SEED_BENCHMARK_SCENARIOS } from '../../../src/agent/self-improvement/capability-benchmark.js';
import type { LessonMutatorPort } from '../../../src/agent/self-improvement/empirical-gate.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import { SelfImprovementEngine, resolveAutonomy } from '../../../src/agent/self-improvement/engine.js';
import { StaticProposer, SEED_LESSON_DRAFTS } from '../../../src/agent/self-improvement/proposer.js';

function fakePort(): LessonMutatorPort & { items: Array<{ id: string; content: string; context?: string }> } {
  const items: Array<{ id: string; content: string; context?: string }> = [];
  let n = 0;
  return {
    items,
    search: (query) => {
      const q = query.toLowerCase();
      return items.filter(
        (i) => i.content.toLowerCase().includes(q) || (i.context?.toLowerCase().includes(q) ?? false),
      );
    },
    add: (_c, content, context) => {
      const item = { id: `L${++n}`, content, context };
      items.push(item);
      return { id: item.id };
    },
    remove: (id) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx >= 0) items.splice(idx, 1);
      return idx >= 0;
    },
  };
}

let dir: string;
let stamp = 0;
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improve-engine-'));
  stamp = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('resolveAutonomy', () => {
  it('is propose-only unless CODEBUDDY_SELF_IMPROVE=true', () => {
    expect(resolveAutonomy({})).toBe('propose-only');
    expect(resolveAutonomy({ CODEBUDDY_SELF_IMPROVE: 'false' })).toBe('propose-only');
    expect(resolveAutonomy({ CODEBUDDY_SELF_IMPROVE: 'true' })).toBe('auto-apply');
  });
});

describe('SelfImprovementEngine', () => {
  it('auto-apply loop covers every seed scenario and archives each win', () => {
    const port = fakePort();
    const archive = new EvolutionaryArchive({ workDir: dir, now });
    const engine = new SelfImprovementEngine({
      scenarios: SEED_BENCHMARK_SCENARIOS,
      port,
      proposer: new StaticProposer(SEED_LESSON_DRAFTS),
      archive,
      autonomy: 'auto-apply',
      now,
    });

    expect(engine.status().score.ratio).toBe(0);
    const cycles = engine.runLoop();

    // One applied cycle per scenario, then a final "all covered" cycle.
    const applied = cycles.filter((c) => c.applied);
    expect(applied).toHaveLength(SEED_BENCHMARK_SCENARIOS.length);
    expect(applied.every((c) => c.gate?.delta === 1)).toBe(true);

    const status = engine.status();
    expect(status.score.ratio).toBe(1);
    expect(status.score.covered).toBe(SEED_BENCHMARK_SCENARIOS.length);
    expect(status.archive.count).toBe(SEED_BENCHMARK_SCENARIOS.length);
    expect(status.archive.totalDelta).toBe(SEED_BENCHMARK_SCENARIOS.length);

    // Archive persisted to disk with rollback refs.
    expect(fs.existsSync(archive.path)).toBe(true);
    expect(archive.list().every((e) => Boolean(e.appliedRef))).toBe(true);
  });

  it('propose-only validates but persists nothing (no archive, no lessons)', () => {
    const port = fakePort();
    const archive = new EvolutionaryArchive({ workDir: dir, now });
    const engine = new SelfImprovementEngine({
      scenarios: SEED_BENCHMARK_SCENARIOS,
      port,
      proposer: new StaticProposer(SEED_LESSON_DRAFTS),
      archive,
      autonomy: 'propose-only',
      now,
    });

    const result = engine.runCycle();
    expect(result.gate?.accepted).toBe(true); // would help
    expect(result.gate?.rolledBack).toBe(true); // but reverted
    expect(result.applied).toBe(false);
    expect(port.items).toHaveLength(0);
    expect(archive.list()).toHaveLength(0);
    expect(engine.status().score.ratio).toBe(0);
  });

  it('reports "nothing to improve" when all scenarios are already covered', () => {
    const port = fakePort();
    for (const draft of SEED_LESSON_DRAFTS.values()) port.add(draft.category, draft.content, draft.context);
    const engine = new SelfImprovementEngine({
      scenarios: SEED_BENCHMARK_SCENARIOS,
      port,
      proposer: new StaticProposer(SEED_LESSON_DRAFTS),
      archive: new EvolutionaryArchive({ workDir: dir, now }),
      autonomy: 'auto-apply',
      now,
    });
    const result = engine.runCycle();
    expect(result.selectedScenarioId).toBeNull();
    expect(result.applied).toBe(false);
    expect(result.notes[0]).toMatch(/nothing to improve/i);
  });

  it('stops cleanly when the proposer has no candidate for the target', () => {
    const port = fakePort();
    const engine = new SelfImprovementEngine({
      scenarios: SEED_BENCHMARK_SCENARIOS,
      port,
      proposer: new StaticProposer(new Map()), // no drafts
      archive: new EvolutionaryArchive({ workDir: dir, now }),
      autonomy: 'auto-apply',
      now,
    });
    const cycles = engine.runLoop();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.proposalId).toBeNull();
    expect(cycles[0]!.applied).toBe(false);
  });
});
