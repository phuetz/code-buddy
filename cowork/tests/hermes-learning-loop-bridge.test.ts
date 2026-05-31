import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { getHermesLearningLoopStatusForReview } from '../src/main/tools/hermes-learning-loop-bridge';

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
        skillUsage: 'buddy skills learning-usage --json',
        userModel: 'buddy user-model show --json',
      },
      generatedAt: '2026-05-31T21:40:00.000Z',
      kind: 'hermes_learning_loop_status',
      ok: true,
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
        lessonCandidateCount: 2,
        patternCount: 2,
        pendingLessonCandidateCount: 1,
        recentRunCount: 1,
        reinforcedSkillCount: 1,
        retrospectiveArtifactCount: 1,
        skillUsageCount: 1,
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
      skillUsage: 'buddy skills learning-usage --json',
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
        skillUsage: 'buddy skills learning-usage --json',
        userModel: 'buddy user-model show --json',
      },
      generatedAt: '2026-05-31T21:40:00.000Z',
      kind: 'hermes_learning_loop_status',
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
        lessonCandidateCount: 0,
        patternCount: 0,
        pendingLessonCandidateCount: 0,
        recentRunCount: 0,
        reinforcedSkillCount: 0,
        retrospectiveArtifactCount: 0,
        skillUsageCount: 0,
      },
      workDir: process.cwd(),
    }));
    mockedLoadCoreModule.mockResolvedValue({ buildHermesLearningLoopStatus });

    await getHermesLearningLoopStatusForReview({ rootDir: 'relative-workspace' });

    expect(buildHermesLearningLoopStatus).toHaveBeenCalledWith({ limit: 10 });
  });
});
