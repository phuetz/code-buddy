import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildLearningRetrospective,
  listLearningSkillUsage,
  recordLearningSkillUsage,
  runLearningRetrospective,
  type LearningPatternLibrary,
} from '../../src/agent/learning-agent.js';
import { resetLessonCandidateQueues } from '../../src/agent/lesson-candidate-queue.js';
import { RunStore } from '../../src/observability/run-store.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe('Learning Agent on real RunStore trajectories', () => {
  let tempDir: string;
  let oldCwd: string;
  let store: RunStore;
  let activeRunIds: string[];
  let oldLearningEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-learning-agent-'));
    oldCwd = process.cwd();
    oldLearningEnv = process.env.CODEBUDDY_LEARNING_AGENT;
    process.chdir(tempDir);
    store = new RunStore(path.join(tempDir, 'runs'));
    activeRunIds = [];
    resetLessonCandidateQueues();
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // Ignore already-ended runs.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    store.dispose();
    resetLessonCandidateQueues();
    process.chdir(oldCwd);
    if (oldLearningEnv === undefined) {
      delete process.env.CODEBUDDY_LEARNING_AGENT;
    } else {
      process.env.CODEBUDDY_LEARNING_AGENT = oldLearningEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function startLearningRun(): string {
    const runId = store.startRun('Real repo workflow with verification', {
      channel: 'cli',
      tags: ['learning-agent'],
    });
    activeRunIds.push(runId);
    store.emit(runId, {
      type: 'skill_selected',
      data: {
        skillName: 'web-audit',
        confidence: 0.91,
        reason: 'matched real workflow',
      },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: { toolCallId: 'call_search', toolName: 'search', args: { query: 'RunStore' } },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: { durationMs: 24, output: 'found src/observability/run-store.ts', success: true, toolName: 'search' },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: { toolCallId: 'call_read', toolName: 'view_file', args: { path: 'src/observability/run-store.ts' } },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: { durationMs: 12, output: 'RunStore source loaded', success: true, toolName: 'view_file' },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: { toolCallId: 'call_test', toolName: 'bash', args: { command: 'npm test -- tests/agent/learning-agent-real.test.ts --run' } },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: { durationMs: 100, output: 'Tests passed', success: true, toolName: 'bash' },
    });
    store.saveArtifact(runId, 'summary.md', 'Real verification passed and produced reusable sequence evidence.');
    return runId;
  }

  function runCodeBuddyCliJson(args: string[]): unknown {
    const result = spawnSync(process.execPath, [tsxCli, path.join(repoRoot, 'src/index.ts'), ...args], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEBUDDY_RUNS_DIR: path.join(tempDir, 'runs'),
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 90_000,
      windowsHide: true,
    });

    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\{/);
    return JSON.parse(result.stdout) as unknown;
  }

  it('builds a retrospective, candidates and continuous skill telemetry from real run files', async () => {
    const runId = startLearningRun();
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await waitFor(() => store.getArtifact(runId, 'proof-ledger.json') !== null);

    const result = await runLearningRetrospective(store, runId, {
      force: true,
      workDir: tempDir,
    });

    expect(result.skipped).toBe(false);
    expect(result.retrospective?.toolSequence).toEqual(['search', 'view_file', 'bash']);
    expect(result.lessonCandidateCount).toBeGreaterThan(0);
    expect(result.skillCandidateCount).toBe(1);
    expect(result.skillUsageCount).toBe(1);
    expect(store.getArtifact(runId, 'learning-retrospective.json')).toContain('"kind": "learning_retrospective"');
    expect(store.getArtifact(runId, 'learning-retrospective.md')).toContain('Learning Agent retrospective');

    const candidatePath = path.join(tempDir, '.codebuddy', 'skill-candidates', 'learning', 'learned-search-view-file-bash', 'SKILL.md');
    const reviewPath = path.join(tempDir, '.codebuddy', 'skill-candidates', 'learning', 'learned-search-view-file-bash', 'candidate-review.json');
    expect(fs.existsSync(candidatePath)).toBe(true);
    const candidateMarkdown = fs.readFileSync(candidatePath, 'utf8');
    expect(candidateMarkdown).toContain('author: Code Buddy Learning Agent');
    expect(candidateMarkdown).toContain('metadata:\n  hermes:');
    expect(candidateMarkdown).toContain('Status: not eligible yet');
    expect(candidateMarkdown).toContain('Proof-backed successful runs: 1/2.');
    expect(candidateMarkdown).toContain('Proof command');
    expect(candidateMarkdown).toContain('npm test -- tests/agent/learning-agent-real.test.ts --run');
    expect(candidateMarkdown).toContain('Proof commands: 1');
    expect(candidateMarkdown).toContain('## Quick Reference');
    expect(JSON.parse(fs.readFileSync(reviewPath, 'utf8'))).toMatchObject({
      approvalRequired: true,
      eligible: false,
      evidenceRunIds: [runId],
      proofBackedSuccessCount: 1,
      proofCommands: [
        expect.objectContaining({
          command: 'npm test -- tests/agent/learning-agent-real.test.ts --run',
          isTest: true,
          runId,
          success: true,
          toolName: 'bash',
        }),
      ],
      proofStatus: 'proven',
      skillName: 'learned-search-view-file-bash',
      sourceRunId: runId,
      status: 'not_eligible',
      successfulRunCount: 1,
    });

    const lessonQueue = JSON.parse(fs.readFileSync(path.join(tempDir, '.codebuddy', 'lesson-candidates.json'), 'utf8'));
    expect(lessonQueue.candidates.length).toBeGreaterThan(0);
    expect(lessonQueue.candidates[0].provenance.runId).toBe(runId);

    const library = JSON.parse(fs.readFileSync(path.join(tempDir, '.codebuddy', 'learning', 'pattern-library.json'), 'utf8')) as LearningPatternLibrary;
    expect(library.patterns).toEqual([
      expect.objectContaining({
        candidateSkillName: 'learned-search-view-file-bash',
        evidenceRunIds: [runId],
        observationCount: 1,
        proofBackedSuccessCount: 1,
        proofCommands: [
          expect.objectContaining({
            command: 'npm test -- tests/agent/learning-agent-real.test.ts --run',
            runId,
            success: true,
          }),
        ],
        status: 'observed',
      }),
    ]);

    expect(listLearningSkillUsage(tempDir)).toEqual([
      expect.objectContaining({
        invocationCount: 1,
        skillName: 'web-audit',
        successCount: 1,
      }),
    ]);
  });

  it('promotes learned skill candidates only after repeated proof-backed runs', async () => {
    const firstRunId = startLearningRun();
    store.endRun(firstRunId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== firstRunId);
    await waitFor(() => store.getArtifact(firstRunId, 'proof-ledger.json') !== null);
    const firstResult = await runLearningRetrospective(store, firstRunId, {
      force: true,
      workDir: tempDir,
    });
    expect(firstResult.retrospective?.skillCandidates[0]).toMatchObject({
      eligible: false,
      proofBackedSuccessCount: 1,
      promotionThreshold: 2,
    });

    const secondRunId = startLearningRun();
    store.endRun(secondRunId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== secondRunId);
    await waitFor(() => store.getArtifact(secondRunId, 'proof-ledger.json') !== null);
    const secondResult = await runLearningRetrospective(store, secondRunId, {
      force: true,
      workDir: tempDir,
    });

    expect(secondResult.retrospective?.skillCandidates[0]).toMatchObject({
      eligible: true,
      evidenceRunIds: [firstRunId, secondRunId],
      proofBackedSuccessCount: 2,
      proofStatus: 'proven',
      promotionThreshold: 2,
      reason: expect.stringContaining('met the Learning Agent promotion threshold'),
    });

    const reviewPath = path.join(tempDir, '.codebuddy', 'skill-candidates', 'learning', 'learned-search-view-file-bash', 'candidate-review.json');
    const promotedReview = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    expect(promotedReview).toMatchObject({
      eligible: true,
      evidenceRunIds: [firstRunId, secondRunId],
      proofBackedSuccessCount: 2,
      promotionThreshold: 2,
      sourceRunId: secondRunId,
      status: 'awaiting_human_approval',
      successfulRunCount: 2,
    });
    expect(promotedReview.proofCommands).toEqual([
      expect.objectContaining({ runId: firstRunId, command: 'npm test -- tests/agent/learning-agent-real.test.ts --run' }),
      expect.objectContaining({ runId: secondRunId, command: 'npm test -- tests/agent/learning-agent-real.test.ts --run' }),
    ]);
  });

  it('auto-runs after endRun when enabled and the run is complex', async () => {
    process.env.CODEBUDDY_LEARNING_AGENT = 'true';
    const runId = startLearningRun();
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);

    await waitFor(() => store.getArtifact(runId, 'learning-retrospective.json') !== null);

    const retrospective = buildLearningRetrospective(runId, { store, workDir: tempDir });
    expect(retrospective?.complexity.isComplex).toBe(true);
    expect(store.getArtifact(runId, 'learning-retrospective.json')).toContain('"skillUsageCount": 1');
  });

  it('runs the retrospective and skill usage loop through the real CLI entrypoint', async () => {
    process.env.CODEBUDDY_LEARNING_AGENT = 'false';
    const runId = startLearningRun();
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await waitFor(() => store.getArtifact(runId, 'proof-ledger.json') !== null);

    const retrospective = runCodeBuddyCliJson(['run', 'retrospective', runId, '--force', '--json']) as {
      retrospective: { toolSequence: string[] };
      skipped: boolean;
      skillUsageCount: number;
    };
    expect(retrospective.skipped).toBe(false);
    expect(retrospective.retrospective.toolSequence).toEqual(['search', 'view_file', 'bash']);
    expect(retrospective.skillUsageCount).toBe(1);
    expect(fs.existsSync(path.join(tempDir, '.codebuddy', 'skill-candidates', 'learning', 'learned-search-view-file-bash', 'SKILL.md'))).toBe(true);

    const learningUsage = runCodeBuddyCliJson(['skills', 'learning-usage', '--json']) as {
      count: number;
      skills: Array<{ invocationCount: number; recommendation: string; skillName: string; successCount: number }>;
    };
    expect(learningUsage.count).toBe(1);
    expect(learningUsage.skills).toEqual([
      expect.objectContaining({
        invocationCount: 1,
        recommendation: 'observe',
        skillName: 'web-audit',
        successCount: 1,
      }),
    ]);
  });

  it('scores repeated real skill outcomes with history and recommended next actions', () => {
    recordLearningSkillUsage('web-audit', { runId: 'run-ok-1', success: true, durationMs: 100, usedAt: '2026-05-30T10:00:00.000Z' }, tempDir);
    recordLearningSkillUsage('web-audit', { runId: 'run-ok-2', success: true, durationMs: 120, usedAt: '2026-05-30T10:10:00.000Z' }, tempDir);
    const reinforced = recordLearningSkillUsage('web-audit', {
      runId: 'run-ok-3',
      success: true,
      durationMs: 80,
      usedAt: '2026-05-30T10:20:00.000Z',
    }, tempDir);

    expect(reinforced).toMatchObject({
      deprecated: false,
      invocationCount: 3,
      recommendation: 'reinforce',
      reinforced: true,
      score: 90,
      scoreHistory: [
        expect.objectContaining({ recommendation: 'observe', runId: 'run-ok-1' }),
        expect.objectContaining({ recommendation: 'observe', runId: 'run-ok-2' }),
        expect.objectContaining({ recommendation: 'reinforce', runId: 'run-ok-3' }),
      ],
      scoreReason: expect.stringContaining('100% success over 3 run(s)'),
      nextAction: expect.stringContaining('Prefer this skill'),
    });

    recordLearningSkillUsage('flaky-skill', { runId: 'run-fail-1', success: false, error: 'real command failed', usedAt: '2026-05-30T11:00:00.000Z' }, tempDir);
    recordLearningSkillUsage('flaky-skill', { runId: 'run-fail-2', success: false, error: 'real command failed again', usedAt: '2026-05-30T11:10:00.000Z' }, tempDir);
    const deprecated = recordLearningSkillUsage('flaky-skill', {
      runId: 'run-fail-3',
      success: false,
      error: 'real command still failed',
      usedAt: '2026-05-30T11:20:00.000Z',
    }, tempDir);

    expect(deprecated).toMatchObject({
      deprecated: true,
      invocationCount: 3,
      recommendation: 'deprecate',
      reinforced: false,
      score: 15,
      scoreHistory: [
        expect.objectContaining({ recommendation: 'observe', runId: 'run-fail-1' }),
        expect.objectContaining({ recommendation: 'improve', runId: 'run-fail-2' }),
        expect.objectContaining({ recommendation: 'deprecate', runId: 'run-fail-3' }),
      ],
      scoreReason: expect.stringContaining('failure rate 100%'),
      nextAction: expect.stringContaining('do not auto-disable'),
    });

    const persisted = JSON.parse(
      fs.readFileSync(path.join(tempDir, '.codebuddy', 'learning', 'skill-usage.json'), 'utf8'),
    );
    expect(persisted.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        skillName: 'web-audit',
        recommendation: 'reinforce',
        scoreHistory: expect.arrayContaining([expect.objectContaining({ runId: 'run-ok-3' })]),
      }),
      expect.objectContaining({
        skillName: 'flaky-skill',
        recommendation: 'deprecate',
        scoreHistory: expect.arrayContaining([expect.objectContaining({ runId: 'run-fail-3' })]),
      }),
    ]));

    expect(listLearningSkillUsage(tempDir).map((skill) => skill.skillName)).toEqual([
      'flaky-skill',
      'web-audit',
    ]);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for condition');
}
