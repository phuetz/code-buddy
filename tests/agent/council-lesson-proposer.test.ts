import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  proposeFromCouncilOutcome,
  type CouncilOutcomeInput,
} from '../../src/agent/council-lesson-proposer.js';
import {
  getLessonCandidateQueue,
  resetLessonCandidateQueues,
} from '../../src/agent/lesson-candidate-queue.js';

let workDir: string;

function input(overrides: Partial<CouncilOutcomeInput> = {}): CouncilOutcomeInput {
  return {
    sagaId: 'saga-1',
    goal: 'Refactor the auth module',
    aggregation: 'consensus',
    consensus: {
      score: 0.4,
      threshold: 0.7,
      total: 3,
      disagreements: [{ peerId: 'darkstar', model: 'qwen', preview: 'use JWT' }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  resetLessonCandidateQueues();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-lesson-'));
});

afterEach(() => {
  resetLessonCandidateQueues();
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('proposeFromCouncilOutcome', () => {
  it('proposes an INSIGHT candidate when peers diverged', () => {
    const res = proposeFromCouncilOutcome(input(), workDir);
    expect(res.proposed).toBe(true);
    expect(res.candidate?.category).toBe('INSIGHT');
    expect(res.candidate?.provenance?.sagaId).toBe('saga-1');
    // It actually landed in the queue (no silent write to lessons.md, only the queue).
    const pending = getLessonCandidateQueue(workDir).list('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].content).toContain('Fleet Council');
  });

  it('proposes when consensus is below threshold even without explicit divergences', () => {
    const res = proposeFromCouncilOutcome(
      input({ consensus: { score: 0.3, threshold: 0.7, total: 3, disagreements: [] } }),
      workDir,
    );
    expect(res.proposed).toBe(true);
  });

  it('does NOT propose for a unanimous council (full agreement, nothing to learn)', () => {
    const res = proposeFromCouncilOutcome(
      input({ consensus: { score: 0.95, threshold: 0.7, total: 3, disagreements: [] } }),
      workDir,
    );
    expect(res.proposed).toBe(false);
    expect(res.reason).toMatch(/full agreement/);
    expect(getLessonCandidateQueue(workDir).list('pending')).toHaveLength(0);
  });

  it('skips non-council sagas', () => {
    const res = proposeFromCouncilOutcome(input({ aggregation: 'parallel' }), workDir);
    expect(res.proposed).toBe(false);
    expect(res.reason).toMatch(/not a council saga/);
  });

  it('dedups at the saga level (one candidate per saga)', () => {
    const first = proposeFromCouncilOutcome(input(), workDir);
    expect(first.proposed).toBe(true);
    const second = proposeFromCouncilOutcome(input(), workDir);
    expect(second.proposed).toBe(false);
    expect(second.reason).toMatch(/already proposed/);
    expect(getLessonCandidateQueue(workDir).list('pending')).toHaveLength(1);
  });

  it('skips when no workDir is resolvable', () => {
    const res = proposeFromCouncilOutcome(input(), '');
    expect(res.proposed).toBe(false);
    expect(res.reason).toMatch(/no workDir/);
  });
});
