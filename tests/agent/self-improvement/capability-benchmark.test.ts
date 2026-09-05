import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  SEED_BENCHMARK_SCENARIOS,
  scoreBenchmark,
  type LessonSearchPort,
} from '../../../src/agent/self-improvement/capability-benchmark.js';
import { SEED_LESSON_DRAFTS } from '../../../src/agent/self-improvement/proposer.js';

function createSingleLessonPort(content: string, context?: string): LessonSearchPort {
  return {
    search(query: string) {
      const q = query.toLowerCase();
      const text = `${content} ${context ?? ''}`.toLowerCase();
      if (text.includes(q)) {
        return [{ id: 'lesson-1', content, context }];
      }
      return [];
    },
  };
}

describe('capability-benchmark: 15 real documented scenarios (DGM3)', () => {
  it('defines exactly 15 curated benchmark scenarios', () => {
    expect(SEED_BENCHMARK_SCENARIOS).toHaveLength(15);
  });

  it('has 15 unique kebab-case IDs', () => {
    const ids = SEED_BENCHMARK_SCENARIOS.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(15);

    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('provides all mandatory fields with at least 2 expectIncludes terms for each scenario', () => {
    for (const scenario of SEED_BENCHMARK_SCENARIOS) {
      expect(scenario.id).toBeTruthy();
      expect(scenario.query.trim()).toBeTruthy();
      expect(scenario.description.trim()).toBeTruthy();
      expect(Array.isArray(scenario.expectIncludes)).toBe(true);
      expect(scenario.expectIncludes.length).toBeGreaterThanOrEqual(2);
      for (const term of scenario.expectIncludes) {
        expect(typeof term).toBe('string');
        expect(term.trim().length).toBeGreaterThan(0);
      }
      expect(scenario.source).toBeDefined();
      expect(typeof scenario.source).toBe('string');
      expect(scenario.source).toMatch(/^(CLAUDE\.md|docs\/agents\.md|AGENTS\.md):\d+$/);
    }
  });

  it('references valid documentation sources that exist on disk at the indicated line', () => {
    const repoRoot = path.resolve(__dirname, '../../../');
    for (const scenario of SEED_BENCHMARK_SCENARIOS) {
      const [relPath, lineStr] = (scenario.source ?? '').split(':');
      expect(relPath).toBeTruthy();
      expect(lineStr).toBeTruthy();
      const absPath = path.join(repoRoot, relPath!);
      expect(fs.existsSync(absPath)).toBe(true);

      const lines = fs.readFileSync(absPath, 'utf8').split('\n');
      const lineNum = Number.parseInt(lineStr!, 10);
      expect(lineNum).toBeGreaterThan(0);
      expect(lineNum).toBeLessThanOrEqual(lines.length);
    }
  });

  it('proves non-triviality: an empty store or empty lesson covers 0 scenarios', () => {
    const emptyPort: LessonSearchPort = { search: () => [] };
    const scoreEmpty = scoreBenchmark(SEED_BENCHMARK_SCENARIOS, emptyPort);
    expect(scoreEmpty.covered).toBe(0);
    expect(scoreEmpty.total).toBe(15);

    const blankLessonPort = createSingleLessonPort('');
    const scoreBlank = scoreBenchmark(SEED_BENCHMARK_SCENARIOS, blankLessonPort);
    expect(scoreBlank.covered).toBe(0);

    // Query-only lesson without expectIncludes terms does not cover any scenario
    for (const scenario of SEED_BENCHMARK_SCENARIOS) {
      const queryOnlyPort = createSingleLessonPort(`Just querying ${scenario.query}`);
      const scoreQueryOnly = scoreBenchmark(SEED_BENCHMARK_SCENARIOS, queryOnlyPort);
      expect(scoreQueryOnly.results.find((r) => r.scenarioId === scenario.id)?.covered).toBe(false);
    }
  });

  it('proves strict orthogonality: no single lesson covers more than one scenario', () => {
    expect(SEED_LESSON_DRAFTS.size).toBe(15);

    for (const scenario of SEED_BENCHMARK_SCENARIOS) {
      const draft = SEED_LESSON_DRAFTS.get(scenario.id);
      expect(draft, `Draft for scenario ${scenario.id} must exist`).toBeDefined();

      const port = createSingleLessonPort(draft!.content, draft!.context);
      const score = scoreBenchmark(SEED_BENCHMARK_SCENARIOS, port);

      const coveredResults = score.results.filter((r) => r.covered);
      expect(
        coveredResults.map((r) => r.scenarioId),
        `Draft for ${scenario.id} must cover only ${scenario.id}`,
      ).toEqual([scenario.id]);
      expect(score.covered).toBe(1);
    }
  });
});
