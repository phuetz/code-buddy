import { isAbsolute, resolve } from 'path';
import { loadCoreModule } from '../utils/core-loader';

export interface HermesLearningLoopStatusForReview {
  autoRetrospective: {
    enabled: boolean;
    envVar: 'CODEBUDDY_LEARNING_AGENT';
    mode: 'auto' | 'disabled';
  };
  commands: {
    candidateReview: string;
    lessonCandidates: string;
    retrospective: string;
    runDoctor: string;
    skillUsage: string;
    userModel: string;
  };
  generatedAt: string;
  kind: 'hermes_learning_loop_status';
  ok: boolean;
  nextAction: {
    command: string;
    description: string;
    kind: 'review_queue' | 'run_retrospective' | 'monitor';
    requiresHumanReview: boolean;
  };
  nextRetrospectiveRun?: {
    artifactCount: number;
    channel?: string;
    command: string;
    eventCount: number;
    runId: string;
    status: string;
    tags: string[];
  };
  recommendations: string[];
  reviewGates: {
    lessonWritesRequireApproval: boolean;
    skillCandidatesRequireReview: boolean;
    skillLifecycleRequiresApproval: boolean;
    userModelWritesRequireApproval: boolean;
  };
  runsDir: string;
  schemaVersion: 1;
  state: {
    recentRuns: Array<{
      artifactCount: number;
      channel?: string;
      evidenceArtifactCount?: number;
      eventCount: number;
      hasLearningRetrospective: boolean;
      runningForMinutes?: number;
      runId: string;
      staleRunning?: boolean;
      status: string;
      tags: string[];
      toolCallCount?: number;
    }>;
    lessonCandidates: {
      byStatus: Record<string, number>;
      total: number;
    };
    patterns: {
      deprecatedCount: number;
      fileExists: boolean;
      observedCount: number;
      reinforcedCount: number;
      total: number;
      updatedAt?: string;
    };
    skillCandidates: {
      learningCandidateCount: number;
      root: string;
    };
    skillUsage: {
      count: number;
      deprecatedCount: number;
      reinforcedCount: number;
      top: Array<{
        invocationCount: number;
        recommendation: string;
        score: number;
        skillName: string;
      }>;
    };
    userModel: {
      byStatus: Record<string, number>;
      total: number;
    };
  };
  summary: {
    acceptedUserObservationCount: number;
    deprecatedSkillCount: number;
    inspectedRunLimit: number;
    lessonCandidateCount: number;
    patternCount: number;
    pendingLessonCandidateCount: number;
    pendingReviewCount: number;
    pendingUserObservationCount: number;
    recentRunCount: number;
    retrospectiveCoveragePercent: number;
    retrospectiveEligibleRunCount: number;
    reinforcedSkillCount: number;
    retrospectiveArtifactCount: number;
    runningRunCount: number;
    skillUsageCount: number;
    staleRunningRunCount: number;
  };
  workDir: string;
}

export interface HermesLearningLoopStatusOptions {
  limit?: number;
  rootDir?: string;
}

export interface HermesLearningRetrospectiveRunOptions {
  force?: boolean;
  rootDir?: string;
  runId?: string;
}

export interface HermesLearningRetrospectiveRunForReview {
  command: string;
  lessonCandidateCount: number;
  ok: boolean;
  patternLibraryPath?: string;
  retrospectiveArtifact?: string;
  runId: string;
  skillCandidateCount: number;
  skillUsageCount: number;
  skipped: boolean;
  skippedReason?: string;
  summary?: string;
  toolSequence: string[];
}

interface HermesLearningLoopStatusModule {
  buildHermesLearningLoopStatus: (options?: {
    limit?: number;
    workDir?: string;
  }) => HermesLearningLoopStatusForReview;
}

interface RunStoreLike {
  dispose?: () => void;
}

interface RunStoreModule {
  RunStore: new () => RunStoreLike;
}

interface LearningAgentRunResult {
  lessonCandidateCount: number;
  patternLibraryPath?: string;
  retrospective?: {
    summary: string;
    toolSequence: string[];
  };
  retrospectiveArtifact?: string;
  skillCandidateCount: number;
  skillUsageCount: number;
  skipped: boolean;
  skippedReason?: string;
}

interface LearningAgentModule {
  runLearningRetrospective: (
    store: RunStoreLike,
    runId: string,
    options?: {
      force?: boolean;
      workDir?: string;
    },
  ) => Promise<LearningAgentRunResult>;
}

export async function getHermesLearningLoopStatusForReview(
  options: HermesLearningLoopStatusOptions = {},
): Promise<HermesLearningLoopStatusForReview | null> {
  const mod = await loadCoreModule<HermesLearningLoopStatusModule>('agent/hermes-learning-loop-status.js');
  if (!mod?.buildHermesLearningLoopStatus) return null;

  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  const limit = normalizeLimit(options.limit);
  const status = mod.buildHermesLearningLoopStatus({
    limit,
    ...(rootDir ? { workDir: rootDir } : {}),
  });
  return normalizeHermesLearningLoopStatus(status, limit);
}

export async function runHermesLearningRetrospectiveForReview(
  options: HermesLearningRetrospectiveRunOptions,
): Promise<HermesLearningRetrospectiveRunForReview> {
  const runId = normalizeRunId(options.runId);
  const rootDir = normalizeAbsoluteRoot(options.rootDir) ?? process.cwd();
  const runStoreMod = await loadCoreModule<RunStoreModule>('observability/run-store.js');
  const learningMod = await loadCoreModule<LearningAgentModule>('agent/learning-agent.js');

  if (!runStoreMod?.RunStore) {
    throw new Error('Core RunStore module is unavailable.');
  }
  if (!learningMod?.runLearningRetrospective) {
    throw new Error('Core Learning Agent module is unavailable.');
  }

  const store = new runStoreMod.RunStore();
  try {
    const result = await learningMod.runLearningRetrospective(store, runId, {
      force: options.force !== false,
      workDir: rootDir,
    });
    return {
      command: `buddy run retrospective ${runId} --force --json`,
      lessonCandidateCount: result.lessonCandidateCount,
      ok: !result.skipped,
      ...(result.patternLibraryPath ? { patternLibraryPath: result.patternLibraryPath } : {}),
      ...(result.retrospectiveArtifact ? { retrospectiveArtifact: result.retrospectiveArtifact } : {}),
      runId,
      skillCandidateCount: result.skillCandidateCount,
      skillUsageCount: result.skillUsageCount,
      skipped: result.skipped,
      ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
      ...(result.retrospective?.summary ? { summary: result.retrospective.summary } : {}),
      toolSequence: result.retrospective?.toolSequence ?? [],
    };
  } finally {
    store.dispose?.();
  }
}

function normalizeAbsoluteRoot(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function normalizeRunId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error('runId is required to run a Hermes learning retrospective.');
  }
  return trimmed;
}

function normalizeHermesLearningLoopStatus(
  status: HermesLearningLoopStatusForReview,
  limit: number,
): HermesLearningLoopStatusForReview {
  const runningRunCount = status.summary.runningRunCount
    ?? status.state.recentRuns.filter((run) => run.status === 'running').length;
  const staleRunningRunCount = status.summary.staleRunningRunCount
    ?? status.state.recentRuns.filter((run) => run.staleRunning).length;
  return {
    ...status,
    commands: {
      ...status.commands,
      runDoctor: status.commands.runDoctor ?? `buddy run doctor --json --limit ${limit}`,
    },
    summary: {
      ...status.summary,
      inspectedRunLimit: status.summary.inspectedRunLimit ?? limit,
      runningRunCount,
      staleRunningRunCount,
    },
  };
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(1, Math.trunc(value as number)));
}
