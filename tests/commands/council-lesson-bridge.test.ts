/**
 * CLI council → lesson-candidate bridge (presenter side).
 *
 * Pins the host policy: proposals happen ONLY inside a project (`.codebuddy/`
 * must already exist — a council run from ~ or /tmp must not create one), and
 * a proposed candidate is surfaced with a one-line notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/fleet/model-scoreboard.js', () => ({
  getModelScoreboard: () => ({ print: () => '(scoreboard)' }),
}));

const runCouncilPipeline = vi.fn();
vi.mock('../../src/council/council-engine.js', () => ({
  runCouncilPipeline: (...args: unknown[]) => runCouncilPipeline(...args),
}));

import { runCouncil } from '../../src/commands/council.js';
import { resetLessonCandidateQueues } from '../../src/agent/lesson-candidate-queue.js';
import type { CouncilRunResult } from '../../src/council/types.js';

/** A direct-mode run with sub-threshold agreement — a learnable disagreement. */
function cannedResult(): CouncilRunResult {
  return {
    taskType: 'general',
    plan: { mode: 'direct', reason: 'simple task: direct fan-out', roles: [] },
    answers: [
      {
        source: { kind: 'local', provider: 'p1', model: 'm1' },
        displayName: 'm1',
        content:
          'VERDICT: oui, migrer — le mode WAL règle le verrouillage inter-process si les accès restent locaux\ndétails…',
        latencyMs: 10,
        tokensUsed: 5,
        costUsd: 0,
      },
      {
        source: { kind: 'local', provider: 'p2', model: 'm2' },
        displayName: 'm2',
        content:
          'VERDICT: non si les écritures restent atomiques par rename et verrou explicite ; réviser sinon\ndétails…',
        latencyMs: 12,
        tokensUsed: 5,
        costUsd: 0,
      },
    ],
    failures: [],
    verdict: {
      kind: 'judged',
      winnerIdx: 0,
      scores: [0.9, 0.4],
      roleScores: [0.9, 0.4],
      rationale: 'la migration couvre le scénario deux-writers demandé',
      verified: 'les deux tranchent, seule A fournit un plan',
      judgeModel: 'j',
      neutral: true,
    },
    consensus: {
      score: 0.1,
      reached: false,
      threshold: 0.7,
      agreeingCount: 0,
      total: 2,
      perSource: [],
      disagreements: [{ peerId: 'p2', model: 'm2', preview: 'autre position' }],
    },
    signals: {
      confidence: 'medium',
      winnerScore: 0.9,
      runnerUpScore: 0.4,
      margin: 0.5,
      consensusScore: 0.1,
      reasons: ['low answer agreement'],
    },
    synthesis: null,
    finalText: 'réponse un',
    learned: true,
    health: {
      at: '2026-07-01T00:00:00.000Z',
      taskType: 'general',
      planMode: 'direct',
      seats: 2,
      answers: 2,
      seatSurvival: 1,
      judgeAlive: 1,
      stanceDivergence: 0.9,
      judgeDiscrimination: 0.5,
      dissentRetention: null,
      anchorRatio: null,
      dhi: 0.7,
    },
  };
}

let tmpDir: string;
let previousCwd: string;

beforeEach(() => {
  resetLessonCandidateQueues();
  runCouncilPipeline.mockReset();
  runCouncilPipeline.mockResolvedValue(cannedResult());
  previousCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-bridge-'));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(previousCwd);
  resetLessonCandidateQueues();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* ignore */
  }
});

describe('runCouncil — lesson bridge host policy', () => {
  it('outside a project: proposes nothing and never creates .codebuddy', async () => {
    const lines: string[] = [];
    await runCouncil('Compare les deux approches', {}, (s) => lines.push(s));

    expect(fs.existsSync(path.join(tmpDir, '.codebuddy'))).toBe(false);
    expect(lines.join('\n')).not.toContain('💡');
  });

  it('inside a project: writes a candidate and emits the notice line', async () => {
    fs.mkdirSync(path.join(tmpDir, '.codebuddy'));
    const lines: string[] = [];
    await runCouncil('Compare les deux approches', {}, (s) => lines.push(s));

    const file = path.join(tmpDir, '.codebuddy', 'lesson-candidates.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const candidates = Array.isArray(parsed) ? parsed : parsed.candidates;
    expect(candidates).toHaveLength(1);
    expect(lines.join('\n')).toContain('💡 Leçon candidate proposée');
    expect(lines.join('\n')).toContain('buddy lessons');
  });

  it('inside a project but abstained verdict (infra noise): no candidate', async () => {
    fs.mkdirSync(path.join(tmpDir, '.codebuddy'));
    const abstained = cannedResult();
    abstained.verdict = {
      kind: 'abstained',
      winnerIdx: null,
      scores: [0, 0],
      roleScores: [0, 0],
      rationale: '(juge indisponible: backend 400)',
      verified: '',
      judgeModel: 'dead-judge',
      neutral: true,
    };
    abstained.signals.confidence = 'low';
    runCouncilPipeline.mockResolvedValue(abstained);

    const lines: string[] = [];
    await runCouncil('Audit complet du module', {}, (s) => lines.push(s));

    expect(fs.existsSync(path.join(tmpDir, '.codebuddy', 'lesson-candidates.json'))).toBe(false);
    expect(lines.join('\n')).not.toContain('💡');
  });

  it('the candidate carries the members\' VERDICT stances and the judge resolution', async () => {
    fs.mkdirSync(path.join(tmpDir, '.codebuddy'));
    const lines: string[] = [];
    await runCouncil('Compare les deux approches', {}, (s) => lines.push(s));

    const file = path.join(tmpDir, '.codebuddy', 'lesson-candidates.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const candidate = (Array.isArray(parsed) ? parsed : parsed.candidates)[0];
    expect(candidate.content).toContain('oui, migrer');
    expect(candidate.content).toContain('non si les écritures restent atomiques');
    expect(candidate.content).toMatch(/Settled/);
    expect(candidate.provenance.pedagogicalValue).toBeGreaterThan(0.35);
    expect(candidate.category).toBe('RULE');
  });
});
