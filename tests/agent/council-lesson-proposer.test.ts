import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MIN_PEDAGOGICAL_VALUE,
  proposeFromCouncilOutcome,
  proposeFromCouncilRunResult,
  scorePedagogicalValue,
  type CouncilOutcomeInput,
  type CouncilRunLessonInput,
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
    fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

const SUBSTANTIVE_POSITIONS = [
  {
    label: 'Architect',
    stance: 'oui, migrer vers SQLite — le mode WAL règle le verrouillage inter-process si les accès restent locaux',
  },
  {
    label: 'Reviewer',
    stance: 'non si les écritures restent atomiques par rename et verrou explicite ; réviser sinon, la dépendance native coûte cher',
  },
];

const SETTLED_RESOLUTION = {
  winner: 'Architect',
  rationale: 'la position migration couvre le scénario deux-writers explicitement demandé',
  verified: 'les deux réponses tranchent, seule A fournit un plan',
};

function runInput(overrides: Partial<CouncilRunLessonInput> = {}): CouncilRunLessonInput {
  return {
    task: 'Compare REST et GraphQL pour ce projet',
    planMode: 'direct',
    confidence: 'medium',
    verdictKind: 'judged',
    consensus: {
      score: 0.3,
      threshold: 0.7,
      total: 3,
      disagreements: [{ peerId: 'grok', model: 'grok-4', preview: 'REST' }],
    },
    positions: SUBSTANTIVE_POSITIONS,
    resolution: SETTLED_RESOLUTION,
    ...overrides,
  };
}

describe('proposeFromCouncilRunResult (CLI council bridge, value-gated)', () => {
  it('NEVER proposes on an abstained verdict — infrastructure noise, not knowledge', () => {
    // Inverted from the first version on purpose: replaying real transcripts
    // showed most proposals existed only because the judge DIED (400/timeout).
    const res = proposeFromCouncilRunResult(
      runInput({ planMode: 'collective', verdictKind: 'abstained' }),
      workDir,
    );
    expect(res.proposed).toBe(false);
    expect(res.reason).toMatch(/infrastructure noise/);
    expect(getLessonCandidateQueue(workDir).list('pending')).toHaveLength(0);
  });

  it('proposes a settled substantive divergence EVEN on a healthy collective run (the old gate\'s false negative)', () => {
    const res = proposeFromCouncilRunResult(
      runInput({ planMode: 'collective', confidence: 'high' }),
      workDir,
    );
    expect(res.proposed).toBe(true);
    expect(res.candidate?.category).toBe('RULE'); // settled → closer to a rule
    expect(res.candidate?.content).toContain('«Architect»');
    expect(res.candidate?.content).toContain('«Reviewer»');
    expect(res.candidate?.content).toMatch(/Settled for «Architect»/);
    expect(res.candidate?.provenance?.pedagogicalValue).toBeGreaterThanOrEqual(MIN_PEDAGOGICAL_VALUE);
  });

  it('skips metadata-only divergences (no positions, thin previews) as journal noise', () => {
    const res = proposeFromCouncilRunResult(
      runInput({ positions: [], resolution: undefined }),
      workDir,
    );
    expect(res.proposed).toBe(false);
    expect(res.reason).toMatch(/below.*noise/);
  });

  it('an unsettled but substantive divergence proposes as an INSIGHT with the open-question framing', () => {
    const res = proposeFromCouncilRunResult(runInput({ resolution: undefined }), workDir);
    expect(res.proposed).toBe(true);
    expect(res.candidate?.category).toBe('INSIGHT');
    expect(res.candidate?.content).toMatch(/Unsettled/);
  });

  it('dedups re-runs of the same task via the stable task-hash id', () => {
    const first = proposeFromCouncilRunResult(runInput(), workDir);
    expect(first.proposed).toBe(true);
    const second = proposeFromCouncilRunResult(
      runInput({ consensus: { score: 0.25, threshold: 0.7, total: 3, disagreements: [] } }),
      workDir,
    );
    expect(second.proposed).toBe(false);
    expect(second.reason).toMatch(/already proposed/);
    expect(getLessonCandidateQueue(workDir).list('pending')).toHaveLength(1);
  });

  it('still respects the unanimity gate (full agreement, no divergence)', () => {
    const res = proposeFromCouncilRunResult(
      runInput({ consensus: { score: 0.95, threshold: 0.7, total: 3, disagreements: [] } }),
      workDir,
    );
    expect(res.proposed).toBe(false);
    expect(res.reason).toMatch(/full agreement/);
  });

  it('never throws without a workDir', () => {
    const res = proposeFromCouncilRunResult(runInput(), '');
    expect(res.proposed).toBe(false);
  });
});

describe('scorePedagogicalValue — deterministic triage', () => {
  it('scores an abstained verdict at exactly 0 (hard infra gate)', () => {
    const value = scorePedagogicalValue({
      verdictKind: 'abstained',
      positions: SUBSTANTIVE_POSITIONS,
      resolution: SETTLED_RESOLUTION,
    });
    expect(value.score).toBe(0);
  });

  it('scores metadata-only candidates far below the proposal threshold', () => {
    const value = scorePedagogicalValue({ verdictKind: 'judged', positions: [] });
    expect(value.score).toBeLessThan(MIN_PEDAGOGICAL_VALUE);
    expect(value.factors.substance).toBe(0);
  });

  it('scores a settled, testable, general divergence high', () => {
    const value = scorePedagogicalValue({
      verdictKind: 'judged',
      positions: SUBSTANTIVE_POSITIONS,
      resolution: SETTLED_RESOLUTION,
    });
    expect(value.score).toBeGreaterThan(0.6);
    expect(value.factors.substance).toBe(1);
    expect(value.factors.resolution).toBe(1); // rationale + verified
    expect(value.factors.stanceDivergence).toBeGreaterThan(0.5);
  });

  it('rates case-bound positions (paths, ids, versions) less generalizable than principle-level ones', () => {
    const contingent = scorePedagogicalValue({
      verdictKind: 'judged',
      positions: [
        { label: 'A', stance: 'le bug vient de src/tools/apply-patch.ts ligne 4217 dans le commit 0c517b6e sur la v1.1.0' },
        { label: 'B', stance: 'non, il vient de tests/review/write-gate.test.ts ligne 8841 depuis la v1.0.9' },
      ],
    });
    const general = scorePedagogicalValue({
      verdictKind: 'judged',
      positions: [
        { label: 'A', stance: 'toujours vérifier les écritures concurrentes avant de choisir un stockage fichier' },
        { label: 'B', stance: 'préférer une base embarquée dès que plusieurs process écrivent le même état' },
      ],
    });
    expect(general.factors.generalizability).toBeGreaterThan(contingent.factors.generalizability);
  });

  it('rewards falsifiable content (si/alors conditions, suggested fixes, verified facts)', () => {
    const testable = scorePedagogicalValue({
      verdictKind: 'judged',
      positions: [
        { label: 'A', stance: 'la migration est sûre si le verrou WAL est activé, sinon elle corrompt les sessions' },
        { label: 'B', stance: 'would change my mind: un test de 48h à 10 écritures/s sans corruption' },
      ],
    });
    const vague = scorePedagogicalValue({
      verdictKind: 'judged',
      positions: [
        { label: 'A', stance: 'il faut bien réfléchir aux compromis avant de choisir la solution' },
        { label: 'B', stance: 'chaque approche possède des avantages comme des inconvénients notables' },
      ],
    });
    expect(testable.factors.testability).toBeGreaterThan(vague.factors.testability);
  });
});
