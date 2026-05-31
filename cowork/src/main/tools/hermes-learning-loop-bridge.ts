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
    skillUsage: string;
    userModel: string;
  };
  generatedAt: string;
  kind: 'hermes_learning_loop_status';
  ok: boolean;
  nextRetrospectiveRun?: {
    artifactCount: number;
    channel?: string;
    command: string;
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
      hasLearningRetrospective: boolean;
      runId: string;
      status: string;
      tags: string[];
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
    lessonCandidateCount: number;
    patternCount: number;
    pendingLessonCandidateCount: number;
    recentRunCount: number;
    reinforcedSkillCount: number;
    retrospectiveArtifactCount: number;
    skillUsageCount: number;
  };
  workDir: string;
}

export interface HermesLearningLoopStatusOptions {
  limit?: number;
  rootDir?: string;
}

interface HermesLearningLoopStatusModule {
  buildHermesLearningLoopStatus: (options?: {
    limit?: number;
    workDir?: string;
  }) => HermesLearningLoopStatusForReview;
}

export async function getHermesLearningLoopStatusForReview(
  options: HermesLearningLoopStatusOptions = {},
): Promise<HermesLearningLoopStatusForReview | null> {
  const mod = await loadCoreModule<HermesLearningLoopStatusModule>('agent/hermes-learning-loop-status.js');
  if (!mod?.buildHermesLearningLoopStatus) return null;

  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  return mod.buildHermesLearningLoopStatus({
    limit: normalizeLimit(options.limit),
    ...(rootDir ? { workDir: rootDir } : {}),
  });
}

function normalizeAbsoluteRoot(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(1, Math.trunc(value as number)));
}
