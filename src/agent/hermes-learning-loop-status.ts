import fs from 'fs';
import path from 'path';
import { getLessonCandidateQueue } from './lesson-candidate-queue.js';
import {
  LEARNING_PATTERN_LIBRARY_SCHEMA_VERSION,
  isLearningAgentEnabled,
  listLearningSkillUsage,
} from './learning-agent.js';
import { getUserModel } from '../memory/user-model.js';
import { RunStore, type RunSummary } from '../observability/run-store.js';

export interface HermesLearningLoopRunRow {
  artifactCount: number;
  channel?: string;
  evidenceArtifactCount: number;
  eventCount: number;
  hasLearningRetrospective: boolean;
  runId: string;
  status: RunSummary['status'];
  tags: string[];
  toolCallCount: number;
}

export interface HermesLearningLoopRetrospectiveCandidate {
  artifactCount: number;
  channel?: string;
  command: string;
  evidenceArtifactCount: number;
  eventCount: number;
  runId: string;
  status: RunSummary['status'];
  tags: string[];
  toolCallCount: number;
}

export interface HermesLearningLoopStatus {
  kind: 'hermes_learning_loop_status';
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  workDir: string;
  runsDir: string;
  summary: {
    recentRunCount: number;
    retrospectiveEligibleRunCount: number;
    retrospectiveArtifactCount: number;
    retrospectiveCoveragePercent: number;
    lessonCandidateCount: number;
    pendingLessonCandidateCount: number;
    pendingReviewCount: number;
    acceptedUserObservationCount: number;
    pendingUserObservationCount: number;
    skillUsageCount: number;
    reinforcedSkillCount: number;
    deprecatedSkillCount: number;
    patternCount: number;
  };
  autoRetrospective: {
    enabled: boolean;
    envVar: 'CODEBUDDY_LEARNING_AGENT';
    mode: 'auto' | 'disabled';
  };
  reviewGates: {
    lessonWritesRequireApproval: boolean;
    userModelWritesRequireApproval: boolean;
    skillCandidatesRequireReview: boolean;
    skillLifecycleRequiresApproval: boolean;
  };
  nextRetrospectiveRun?: HermesLearningLoopRetrospectiveCandidate;
  state: {
    recentRuns: HermesLearningLoopRunRow[];
    lessonCandidates: ReturnType<ReturnType<typeof getLessonCandidateQueue>['getStats']>;
    userModel: ReturnType<ReturnType<typeof getUserModel>['getStats']>;
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
  };
  commands: {
    retrospective: string;
    skillUsage: string;
    lessonCandidates: string;
    userModel: string;
    candidateReview: string;
  };
  recommendations: string[];
}

interface BuildHermesLearningLoopStatusOptions {
  generatedAt?: string;
  limit?: number;
  store?: RunStore;
  workDir?: string;
}

interface PatternLibraryFile {
  schemaVersion?: number;
  updatedAt?: string;
  patterns?: Array<{ status?: string }>;
}

const RETROSPECTIVE_READY_STATUSES = new Set<RunSummary['status']>([
  'completed',
  'failed',
  'cancelled',
]);
const MIN_ACTIONABLE_TOOL_CALLS = 3;
const LEARNING_RETROSPECTIVE_ARTIFACTS = new Set([
  'learning-retrospective.json',
  'learning-retrospective.md',
]);

function isRetrospectiveEligible(row: HermesLearningLoopRunRow): boolean {
  return RETROSPECTIVE_READY_STATUSES.has(row.status) && isRetrospectiveActionable(row);
}

function isRetrospectiveActionable(row: HermesLearningLoopRunRow): boolean {
  if (row.evidenceArtifactCount > 0) return true;
  if (row.toolCallCount >= MIN_ACTIONABLE_TOOL_CALLS) return true;
  return row.status === 'failed' && row.eventCount >= 3;
}

function buildRetrospectiveCommand(runId: string): string {
  return `buddy run retrospective ${runId} --force --json`;
}

function selectNextRetrospectiveRun(
  runRows: HermesLearningLoopRunRow[],
): HermesLearningLoopRetrospectiveCandidate | undefined {
  const readyRuns = runRows.filter((row) =>
    !row.hasLearningRetrospective && isRetrospectiveEligible(row)
  );
  const run = [...readyRuns]
    .sort((left, right) =>
      retrospectiveEvidenceScore(right) - retrospectiveEvidenceScore(left)
    )[0];
  if (!run) return undefined;
  return {
    artifactCount: run.artifactCount,
    ...(run.channel ? { channel: run.channel } : {}),
    command: buildRetrospectiveCommand(run.runId),
    evidenceArtifactCount: run.evidenceArtifactCount,
    eventCount: run.eventCount,
    runId: run.runId,
    status: run.status,
    tags: run.tags,
    toolCallCount: run.toolCallCount,
  };
}

function retrospectiveEvidenceScore(row: HermesLearningLoopRunRow): number {
  return row.evidenceArtifactCount * 20 + row.toolCallCount * 5 + row.eventCount;
}

function countEvidenceArtifacts(artifacts: string[]): number {
  return artifacts
    .map((artifact) => artifact.replace(/\\/g, '/').split('/').pop() ?? artifact)
    .filter((artifactName) => !LEARNING_RETROSPECTIVE_ARTIFACTS.has(artifactName))
    .length;
}

function countLearningSkillCandidates(workDir: string): { learningCandidateCount: number; root: string } {
  const root = path.join(workDir, '.codebuddy', 'skill-candidates', 'learning');
  let learningCandidateCount = 0;
  try {
    if (fs.existsSync(root)) {
      learningCandidateCount = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) => fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
        .length;
    }
  } catch {
    learningCandidateCount = 0;
  }
  return { learningCandidateCount, root };
}

function readPatternStats(workDir: string): HermesLearningLoopStatus['state']['patterns'] {
  const filePath = path.join(workDir, '.codebuddy', 'learning', 'pattern-library.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PatternLibraryFile;
    const patterns = parsed.schemaVersion === LEARNING_PATTERN_LIBRARY_SCHEMA_VERSION && Array.isArray(parsed.patterns)
      ? parsed.patterns
      : [];
    return {
      deprecatedCount: patterns.filter((pattern) => pattern.status === 'deprecated').length,
      fileExists: true,
      observedCount: patterns.filter((pattern) => pattern.status === 'observed').length,
      reinforcedCount: patterns.filter((pattern) => pattern.status === 'reinforced').length,
      total: patterns.length,
      ...(parsed.updatedAt ? { updatedAt: parsed.updatedAt } : {}),
    };
  } catch {
    return {
      deprecatedCount: 0,
      fileExists: fs.existsSync(filePath),
      observedCount: 0,
      reinforcedCount: 0,
      total: 0,
    };
  }
}

function buildRecommendations(status: HermesLearningLoopStatus): string[] {
  const recommendations: string[] = [];
  if (!status.autoRetrospective.enabled) {
    recommendations.push('Set CODEBUDDY_LEARNING_AGENT=true to enable automatic post-run retrospectives outside forced CLI runs.');
  }
  if (status.nextRetrospectiveRun) {
    recommendations.push(`Run ${status.nextRetrospectiveRun.command} on the next finished real run to feed the Learning Agent loop.`);
  } else if (status.summary.recentRunCount > 0 && status.summary.retrospectiveArtifactCount === 0) {
    recommendations.push('Wait for a real run to finish, then run buddy run retrospective <run-id> --force --json to seed the Learning Agent loop.');
  }
  if (status.summary.pendingLessonCandidateCount > 0) {
    recommendations.push('Review pending lesson candidates before relying on them in future prompt context.');
  }
  if (status.state.skillCandidates.learningCandidateCount > 0) {
    recommendations.push('Review Learning Agent SKILL.md candidates through Cowork or skill_manage before installing.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Learning loop state is locally coherent; keep reviewing candidates before promotion.');
  }
  return recommendations;
}

export function buildHermesLearningLoopStatus(
  options: BuildHermesLearningLoopStatusOptions = {},
): HermesLearningLoopStatus {
  const workDir = path.resolve(options.workDir ?? process.cwd());
  const store = options.store ?? new RunStore();
  const limit = Math.max(1, options.limit ?? 10);
  const recentRuns = store.listRuns(limit);
  const runRows: HermesLearningLoopRunRow[] = recentRuns.map((run) => {
    const record = store.getRun(run.runId);
    const artifacts = record?.artifacts ?? [];
    const eventToolCallCount = store.getEvents(run.runId).filter((event) => event.type === 'tool_call').length;
    return {
      artifactCount: artifacts.length || run.artifactCount,
      ...(run.metadata?.channel ? { channel: run.metadata.channel } : {}),
      evidenceArtifactCount: countEvidenceArtifacts(artifacts),
      eventCount: run.eventCount,
      hasLearningRetrospective: artifacts.includes('learning-retrospective.json'),
      runId: run.runId,
      status: run.status,
      tags: run.metadata?.tags ?? [],
      toolCallCount: eventToolCallCount || record?.metrics.toolCallCount || 0,
    };
  });
  const nextRetrospectiveRun = selectNextRetrospectiveRun(runRows);
  const lessonCandidates = getLessonCandidateQueue(workDir).getStats();
  const userModel = getUserModel(workDir).getStats();
  const skillUsageRecords = listLearningSkillUsage(workDir);
  const patterns = readPatternStats(workDir);
  const skillCandidates = countLearningSkillCandidates(workDir);
  const autoEnabled = isLearningAgentEnabled();
  const retrospectiveArtifactCount = runRows.filter((run) =>
    isRetrospectiveEligible(run) && run.hasLearningRetrospective
  ).length;
  const retrospectiveEligibleRunCount = runRows.filter(isRetrospectiveEligible).length;
  const retrospectiveCoveragePercent = retrospectiveEligibleRunCount === 0
    ? 100
    : Math.round((retrospectiveArtifactCount / retrospectiveEligibleRunCount) * 100);
  const pendingReviewCount =
    lessonCandidates.byStatus.pending
    + userModel.byStatus.pending
    + skillCandidates.learningCandidateCount;

  const status: HermesLearningLoopStatus = {
    kind: 'hermes_learning_loop_status',
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ok: true,
    workDir,
    runsDir: store.getRunsDir(),
    summary: {
      recentRunCount: recentRuns.length,
      retrospectiveEligibleRunCount,
      retrospectiveArtifactCount,
      retrospectiveCoveragePercent,
      lessonCandidateCount: lessonCandidates.total,
      pendingLessonCandidateCount: lessonCandidates.byStatus.pending,
      pendingReviewCount,
      acceptedUserObservationCount: userModel.byStatus.accepted,
      pendingUserObservationCount: userModel.byStatus.pending,
      skillUsageCount: skillUsageRecords.length,
      reinforcedSkillCount: skillUsageRecords.filter((skill) => skill.reinforced).length,
      deprecatedSkillCount: skillUsageRecords.filter((skill) => skill.deprecated).length,
      patternCount: patterns.total,
    },
    autoRetrospective: {
      enabled: autoEnabled,
      envVar: 'CODEBUDDY_LEARNING_AGENT',
      mode: autoEnabled ? 'auto' : 'disabled',
    },
    reviewGates: {
      lessonWritesRequireApproval: true,
      userModelWritesRequireApproval: true,
      skillCandidatesRequireReview: true,
      skillLifecycleRequiresApproval: true,
    },
    ...(nextRetrospectiveRun ? { nextRetrospectiveRun } : {}),
    state: {
      recentRuns: runRows,
      lessonCandidates,
      userModel,
      skillUsage: {
        count: skillUsageRecords.length,
        deprecatedCount: skillUsageRecords.filter((skill) => skill.deprecated).length,
        reinforcedCount: skillUsageRecords.filter((skill) => skill.reinforced).length,
        top: skillUsageRecords.slice(0, 5).map((skill) => ({
          invocationCount: skill.invocationCount,
          recommendation: skill.recommendation,
          score: skill.score,
          skillName: skill.skillName,
        })),
      },
      patterns,
      skillCandidates,
    },
    commands: {
      retrospective: 'buddy run retrospective <run-id> --force --json',
      skillUsage: 'buddy skills learning-usage --json',
      lessonCandidates: 'buddy lessons candidate list --json',
      userModel: 'buddy user-model show --json',
      candidateReview: 'skill_manage action=candidate_list',
    },
    recommendations: [],
  };
  status.recommendations = buildRecommendations(status);
  return status;
}

export function renderHermesLearningLoopStatus(status: HermesLearningLoopStatus): string {
  const lines = [
    `Hermes learning loop: ${status.ok ? 'ok' : 'needs attention'}`,
    `  Auto retrospective: ${status.autoRetrospective.mode}`,
    `  Recent runs: ${status.summary.recentRunCount}`,
    `  Runs with retrospectives: ${status.summary.retrospectiveArtifactCount}/${status.summary.retrospectiveEligibleRunCount} eligible (${status.summary.retrospectiveCoveragePercent}%)`,
    `  Lesson candidates: ${status.summary.lessonCandidateCount} (${status.summary.pendingLessonCandidateCount} pending)`,
    `  User-model observations: ${status.summary.acceptedUserObservationCount} accepted, ${status.summary.pendingUserObservationCount} pending`,
    `  Pending review items: ${status.summary.pendingReviewCount}`,
    `  Skill usage records: ${status.summary.skillUsageCount} (${status.summary.reinforcedSkillCount} reinforced, ${status.summary.deprecatedSkillCount} deprecated)`,
    `  Pattern records: ${status.summary.patternCount}`,
    `  Learning skill candidates: ${status.state.skillCandidates.learningCandidateCount}`,
  ];

  if (status.nextRetrospectiveRun) {
    lines.push(
      `  Next retrospective run: ${status.nextRetrospectiveRun.runId} (${status.nextRetrospectiveRun.status}, ${status.nextRetrospectiveRun.artifactCount} artifacts)`,
      `  Next retrospective events: ${status.nextRetrospectiveRun.eventCount}`,
      `  Next retrospective tool calls: ${status.nextRetrospectiveRun.toolCallCount}`,
    );
  }

  lines.push(
    '',
    'Review gates:',
    `  Lesson writes require approval: ${status.reviewGates.lessonWritesRequireApproval ? 'yes' : 'no'}`,
    `  User-model writes require approval: ${status.reviewGates.userModelWritesRequireApproval ? 'yes' : 'no'}`,
    `  Skill candidates require review: ${status.reviewGates.skillCandidatesRequireReview ? 'yes' : 'no'}`,
    `  Skill lifecycle requires approval: ${status.reviewGates.skillLifecycleRequiresApproval ? 'yes' : 'no'}`,
    '',
    'Commands:',
    `  Retrospective: ${status.commands.retrospective}`,
  );

  if (status.nextRetrospectiveRun) {
    lines.push(`  Retrospective candidate: ${status.nextRetrospectiveRun.command}`);
  }

  lines.push(
    `  Skill usage: ${status.commands.skillUsage}`,
    `  Lesson candidates: ${status.commands.lessonCandidates}`,
    `  User model: ${status.commands.userModel}`,
  );

  if (status.recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const recommendation of status.recommendations) {
      lines.push(`  - ${recommendation}`);
    }
  }

  return lines.join('\n');
}
