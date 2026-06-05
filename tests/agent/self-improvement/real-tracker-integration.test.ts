import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getLessonsTracker } from '../../../src/agent/lessons-tracker.js';
import { scoreBenchmark } from '../../../src/agent/self-improvement/capability-benchmark.js';
import { validateProposal, type LessonMutatorPort } from '../../../src/agent/self-improvement/empirical-gate.js';
import type { BenchmarkScenario, ImprovementProposal } from '../../../src/agent/self-improvement/types.js';

/**
 * Proves the gate works against the REAL singleton LessonsTracker — the
 * staleness trap the design had to avoid: search() memoises load(), so a
 * file-level rollback would read stale state, but add()/remove() mutate the
 * in-memory items that search() reads, keeping apply→re-score→rollback
 * consistent in-process.
 */
function trackerPort(workDir: string): LessonMutatorPort {
  const tracker = getLessonsTracker(workDir);
  return {
    search: (query) => tracker.search(query).map((l) => ({ id: l.id, content: l.content, context: l.context })),
    add: (category, content, context) => {
      const item = tracker.add(category, content, 'manual', context);
      return { id: item.id };
    },
    remove: (id) => tracker.remove(id),
  };
}

const SCENARIOS: BenchmarkScenario[] = [
  { id: 's-logger', query: 'console.log', expectIncludes: ['logger', 'not console'], description: 'use logger not console' },
];

describe('self-improvement gate against the real LessonsTracker', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improve-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('moves the real benchmark number and persists under auto-apply', () => {
    const port = trackerPort(dir);
    expect(scoreBenchmark(SCENARIOS, port).covered).toBe(0);

    const proposal: ImprovementProposal = {
      id: 'p-logger',
      kind: 'lesson',
      targetScenarioId: 's-logger',
      lesson: {
        category: 'RULE',
        content: 'Production code must use logger, not console.log, because tests spy on logger.',
      },
    };

    const result = validateProposal(proposal, SCENARIOS, port, { keepOnAccept: true });
    expect(result.outcome.accepted).toBe(true);
    expect(result.outcome.delta).toBe(1);
    expect(result.appliedRef).toBeTruthy();

    // No staleness: a fresh search through the real tracker sees the new lesson.
    expect(scoreBenchmark(SCENARIOS, port).covered).toBe(1);
    expect(getLessonsTracker(dir).search('console.log').length).toBeGreaterThan(0);

    // Rollback path restores exactly.
    expect(port.remove(result.appliedRef!)).toBe(true);
    expect(scoreBenchmark(SCENARIOS, port).covered).toBe(0);
  });

  it('leaves the real tracker untouched when proposing-only', () => {
    const port = trackerPort(dir);
    const proposal: ImprovementProposal = {
      id: 'p-logger',
      kind: 'lesson',
      targetScenarioId: 's-logger',
      lesson: { category: 'RULE', content: 'Use logger, not console.log, so tests can spy on logger output.' },
    };
    const result = validateProposal(proposal, SCENARIOS, port, { keepOnAccept: false });
    expect(result.outcome.accepted).toBe(true);
    expect(result.outcome.rolledBack).toBe(true);
    // Nothing persisted.
    expect(getLessonsTracker(dir).search('console.log')).toHaveLength(0);
    expect(scoreBenchmark(SCENARIOS, port).covered).toBe(0);
  });
});
