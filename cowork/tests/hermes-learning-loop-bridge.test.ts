import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  getHermesLearningLoopStatusForReview,
  runHermesLearningRetrospectiveForReview,
} from '../src/main/tools/hermes-learning-loop-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes learning loop bridge', () => {
  it('loads the core Learning Agent status for the active workspace without private observations', async () => {
    const buildHermesLearningLoopStatus = vi.fn(() => ({
      autoRetrospective: {
        enabled: false,
        envVar: 'CODEBUDDY_LEARNING_AGENT',
        mode: 'disabled',
      },
      commands: {
        candidateReview: 'skill_manage action=candidate_list',
        lessonCandidates: 'buddy lessons candidate list --json',
        retrospective: 'buddy run retrospective <run-id> --force --json',
        runDoctor: 'buddy run doctor --json --limit 6',
        skillUsage: 'buddy skills learning-usage --json',
        userModel: 'buddy user-model show --json',
      },
      generatedAt: '2026-05-31T21:40:00.000Z',
      kind: 'hermes_learning_loop_status',
      nextAction: {
        command: 'buddy lessons candidate show lc-real --json',
        description: 'lesson_candidate review is waiting behind lessonWritesRequireApproval.',
        kind: 'review_queue',
        requiresHumanReview: true,
      },
      ok: true,
      nextRetrospectiveRun: {
        artifactCount: 1,
        command: 'buddy run retrospective run-needs-retro --force --json',
        eventCount: 8,
        runId: 'run-needs-retro',
        status: 'completed',
        tags: ['real'],
      },
      recommendations: ['Review pending lesson candidates before relying on them.'],
      reviewGates: {
        lessonWritesRequireApproval: true,
        skillCandidatesRequireReview: true,
        skillLifecycleRequiresApproval: true,
        userModelWritesRequireApproval: true,
      },
      runsDir: 'C:/Users/patri/.codebuddy/runs',
      schemaVersion: 1,
      state: {
        recentRuns: [
          {
            artifactCount: 2,
            eventCount: 12,
            hasLearningRetrospective: true,
            runId: 'run-learning-loop',
            status: 'completed',
            tags: ['real'],
          },
        ],
        lessonCandidates: { byStatus: { pending: 1 }, total: 2 },
        patterns: {
          deprecatedCount: 0,
          fileExists: true,
          observedCount: 1,
          reinforcedCount: 1,
          total: 2,
        },
        skillCandidates: {
          learningCandidateCount: 1,
          root: 'D:/workspace/.codebuddy/skill-candidates/learning',
        },
        skillUsage: {
          count: 1,
          deprecatedCount: 0,
          reinforcedCount: 1,
          top: [
            {
              invocationCount: 4,
              recommendation: 'reinforce',
              score: 95,
              skillName: 'learned-search-view-file-bash',
            },
          ],
        },
        userModel: { byStatus: { accepted: 3 }, total: 5 },
      },
      summary: {
        acceptedUserObservationCount: 3,
        deprecatedSkillCount: 0,
        inspectedRunLimit: 6,
        lessonCandidateCount: 2,
        patternCount: 2,
        pendingLessonCandidateCount: 1,
        pendingReviewCount: 1,
        pendingUserObservationCount: 0,
        recentRunCount: 1,
        retrospectiveCoveragePercent: 100,
        retrospectiveEligibleRunCount: 1,
        reinforcedSkillCount: 1,
        retrospectiveArtifactCount: 1,
        runningRunCount: 1,
        skillUsageCount: 1,
        staleRunningRunCount: 1,
      },
      workDir: path.resolve('workspace'),
    }));
    mockedLoadCoreModule.mockResolvedValue({ buildHermesLearningLoopStatus });

    const rootDir = path.resolve('workspace');
    const status = await getHermesLearningLoopStatusForReview({ rootDir, limit: 6 });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-learning-loop-status.js');
    expect(buildHermesLearningLoopStatus).toHaveBeenCalledWith({
      limit: 6,
      workDir: rootDir,
    });
    expect(status?.commands).toMatchObject({
      retrospective: 'buddy run retrospective <run-id> --force --json',
      runDoctor: 'buddy run doctor --json --limit 6',
      skillUsage: 'buddy skills learning-usage --json',
    });
    expect(status?.nextAction).toMatchObject({
      command: 'buddy lessons candidate show lc-real --json',
      kind: 'review_queue',
      requiresHumanReview: true,
    });
    expect(status?.nextRetrospectiveRun).toMatchObject({
      command: 'buddy run retrospective run-needs-retro --force --json',
      eventCount: 8,
      runId: 'run-needs-retro',
    });
    expect(status?.summary.pendingLessonCandidateCount).toBe(1);
    expect(JSON.stringify(status)).not.toContain('salary');
    expect(JSON.stringify(status)).not.toContain('private observation');
  });

  it('degrades to null when the core Learning Agent status module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesLearningLoopStatusForReview({
      rootDir: path.resolve('workspace'),
    })).resolves.toBeNull();
  });

  it('does not forward relative workspace roots to the core module', async () => {
    const buildHermesLearningLoopStatus = vi.fn(() => ({
      autoRetrospective: { enabled: true, envVar: 'CODEBUDDY_LEARNING_AGENT', mode: 'auto' },
      commands: {
        candidateReview: 'skill_manage action=candidate_list',
        lessonCandidates: 'buddy lessons candidate list --json',
        retrospective: 'buddy run retrospective <run-id> --force --json',
        runDoctor: 'buddy run doctor --json --limit 10',
        skillUsage: 'buddy skills learning-usage --json',
        userModel: 'buddy user-model show --json',
      },
      generatedAt: '2026-05-31T21:40:00.000Z',
      kind: 'hermes_learning_loop_status',
      nextAction: {
        command: 'buddy hermes learning status --json',
        description: 'No pending Learning Agent action; monitor the loop after the next real run.',
        kind: 'monitor',
        requiresHumanReview: false,
      },
      ok: true,
      recommendations: [],
      reviewGates: {
        lessonWritesRequireApproval: true,
        skillCandidatesRequireReview: true,
        skillLifecycleRequiresApproval: true,
        userModelWritesRequireApproval: true,
      },
      runsDir: 'runs',
      schemaVersion: 1,
      state: {
        recentRuns: [],
        lessonCandidates: { byStatus: {}, total: 0 },
        patterns: { deprecatedCount: 0, fileExists: false, observedCount: 0, reinforcedCount: 0, total: 0 },
        skillCandidates: { learningCandidateCount: 0, root: 'skills' },
        skillUsage: { count: 0, deprecatedCount: 0, reinforcedCount: 0, top: [] },
        userModel: { byStatus: {}, total: 0 },
      },
      summary: {
        acceptedUserObservationCount: 0,
        deprecatedSkillCount: 0,
        inspectedRunLimit: 10,
        lessonCandidateCount: 0,
        patternCount: 0,
        pendingLessonCandidateCount: 0,
        pendingReviewCount: 0,
        pendingUserObservationCount: 0,
        recentRunCount: 0,
        retrospectiveCoveragePercent: 100,
        retrospectiveEligibleRunCount: 0,
        reinforcedSkillCount: 0,
        retrospectiveArtifactCount: 0,
        runningRunCount: 0,
        skillUsageCount: 0,
        staleRunningRunCount: 0,
      },
      workDir: process.cwd(),
    }));
    mockedLoadCoreModule.mockResolvedValue({ buildHermesLearningLoopStatus });

    await getHermesLearningLoopStatusForReview({ rootDir: 'relative-workspace' });

    expect(buildHermesLearningLoopStatus).toHaveBeenCalledWith({ limit: 10 });
  });

  it('runs the core Learning Agent retrospective without returning private trajectory content', async () => {
    const dispose = vi.fn();
    const runLearningRetrospective = vi.fn().mockResolvedValue({
      lessonCandidateCount: 2,
      patternLibraryPath: 'D:/workspace/.codebuddy/learning/pattern-library.json',
      retrospective: {
        summary: '3 tools, 1 effective pattern',
        toolSequence: ['search', 'view_file', 'bash'],
      },
      retrospectiveArtifact: 'learning-retrospective.json',
      skillCandidateCount: 1,
      skillUsageCount: 1,
      skipped: false,
    });
    const RunStore = vi.fn(function MockRunStore(this: { dispose: typeof dispose }) {
      this.dispose = dispose;
    });
    mockedLoadCoreModule
      .mockResolvedValueOnce({ RunStore })
      .mockResolvedValueOnce({ runLearningRetrospective });

    const rootDir = path.resolve('workspace');
    const result = await runHermesLearningRetrospectiveForReview({
      rootDir,
      runId: 'run-learning-loop',
    });

    expect(mockedLoadCoreModule).toHaveBeenNthCalledWith(1, 'observability/run-store.js');
    expect(mockedLoadCoreModule).toHaveBeenNthCalledWith(2, 'agent/learning-agent.js');
    expect(runLearningRetrospective).toHaveBeenCalledWith(
      expect.anything(),
      'run-learning-loop',
      {
        force: true,
        workDir: rootDir,
      },
    );
    expect(dispose).toHaveBeenCalled();
    expect(result).toMatchObject({
      command: 'buddy run retrospective run-learning-loop --force --json',
      lessonCandidateCount: 2,
      ok: true,
      retrospectiveArtifact: 'learning-retrospective.json',
      runId: 'run-learning-loop',
      skillCandidateCount: 1,
      skillUsageCount: 1,
      skipped: false,
      toolSequence: ['search', 'view_file', 'bash'],
    });
    expect(JSON.stringify(result)).not.toContain('private observation');
  });
});
