import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  GitBranch,
  PanelRightOpen,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { LESSON_CANDIDATES_UPDATED_EVENT } from './lesson-candidate-review-strip';

export interface HermesLearningLoopStatus {
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
  nextAction: {
    command: string;
    description: string;
    kind: 'review_queue' | 'run_retrospective' | 'monitor';
    requiresHumanReview: boolean;
  };
  ok: boolean;
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
  reviewQueue?: {
    items: Array<{
      command: string;
      description: string;
      kind: 'lesson_candidate' | 'skill_candidate' | 'user_model_observation';
      nextReviewCommand?: string;
      pendingCount: number;
      reviewGate: keyof HermesLearningLoopStatus['reviewGates'];
      sampleIds?: string[];
    }>;
    totalPending: number;
  };
  state: {
    recentRuns: Array<{
      artifactCount: number;
      channel?: string;
      eventCount: number;
      hasLearningRetrospective: boolean;
      runId: string;
      status: string;
      tags: string[];
    }>;
    patterns: {
      deprecatedCount: number;
      observedCount: number;
      reinforcedCount: number;
      total: number;
    };
    skillCandidates: {
      learningCandidateCount: number;
      root: string;
      samples?: Array<{
        candidateId: string;
        eligible: boolean;
        inspectCommand: string;
        skillName: string;
      }>;
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

export interface HermesLearningRetrospectiveRunResult {
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

interface HermesLearningLoopApi {
  get?: (options?: {
    cwd?: string;
    limit?: number;
  }) => Promise<HermesLearningLoopStatus | null>;
  runRetrospective?: (options: {
    cwd?: string;
    force?: boolean;
    runId: string;
  }) => Promise<{
    error?: string;
    ok: boolean;
    result?: HermesLearningRetrospectiveRunResult;
  }>;
}

export function buildHermesLearningLoopCommand(): string {
  return 'buddy hermes learning status --json';
}

export const HermesLearningLoopStrip: React.FC<{
  cwd?: string;
  error?: string | null;
  onOpenLessonReview?: () => void;
  status?: HermesLearningLoopStatus | null;
}> = ({ cwd, error = null, onOpenLessonReview, status }) => {
  const { t } = useTranslation();
  const [loadedStatus, setLoadedStatus] = useState<HermesLearningLoopStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrospectiveError, setRetrospectiveError] = useState<string | null>(null);
  const [retrospectiveResult, setRetrospectiveResult] = useState<HermesLearningRetrospectiveRunResult | null>(null);
  const [runningRetrospectiveRunId, setRunningRetrospectiveRunId] = useState<string | null>(null);
  const visibleStatus = status ?? loadedStatus;
  const visibleError = error ?? loadError;
  const command = useMemo(() => buildHermesLearningLoopCommand(), []);
  const reviewGatesEnabled = visibleStatus
    ? Object.values(visibleStatus.reviewGates).every(Boolean)
    : false;
  const attentionCount = visibleStatus
    ? Number(!visibleStatus.autoRetrospective.enabled)
      + Number(!reviewGatesEnabled)
      + visibleStatus.summary.pendingLessonCandidateCount
      + visibleStatus.state.skillCandidates.learningCandidateCount
    : 0;
  const statusClass = attentionCount === 0
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-warning/40 bg-warning/10 text-warning';
  const statusText = attentionCount === 0
    ? t('fleet.hermesLearningLoop.readyChip', 'learning ready')
    : t('fleet.hermesLearningLoop.attentionChip', 'learning attention');

  useEffect(() => {
    if (status !== undefined) return;
    const api = getHermesLearningLoopApi();
    if (!api?.get) return;
    let cancelled = false;

    void api
      .get({ cwd, limit: 6 })
      .then((result) => {
        if (cancelled) return;
        setLoadedStatus(result);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedStatus(null);
        setLoadError(loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue));
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, status]);

  const handleRunRetrospective = async () => {
    const candidate = visibleStatus?.nextRetrospectiveRun;
    if (!candidate) return;
    const api = getHermesLearningLoopApi();
    if (!api?.runRetrospective) {
      setRetrospectiveError(t(
        'fleet.hermesLearningLoop.retrospectiveUnavailable',
        'Retrospective runner is unavailable.',
      ));
      return;
    }

    setRunningRetrospectiveRunId(candidate.runId);
    setRetrospectiveError(null);
    setRetrospectiveResult(null);

    try {
      const response = await api.runRetrospective({
        cwd,
        force: true,
        runId: candidate.runId,
      });
      if (!response.ok || !response.result || !response.result.ok) {
        throw new Error(response.error ?? response.result?.skippedReason ?? 'Learning retrospective failed.');
      }
      setRetrospectiveResult(response.result);
      if (response.result.lessonCandidateCount > 0) {
        window.dispatchEvent(new CustomEvent(LESSON_CANDIDATES_UPDATED_EVENT, {
          detail: {
            lessonCandidateCount: response.result.lessonCandidateCount,
            runId: response.result.runId,
            source: 'hermes-learning-loop',
          },
        }));
      }
      if (status === undefined && api.get) {
        const refreshed = await api.get({ cwd, limit: 6 });
        setLoadedStatus(refreshed);
      }
    } catch (retrospectiveErrorValue) {
      setRetrospectiveError(
        retrospectiveErrorValue instanceof Error
          ? retrospectiveErrorValue.message
          : String(retrospectiveErrorValue),
      );
    } finally {
      setRunningRetrospectiveRunId(null);
    }
  };

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-learning-loop"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <BrainCircuit size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesLearningLoop.title', 'Hermes learning loop')}
          </span>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass}`}>
          {visibleStatus
            ? statusText
            : t('fleet.hermesLearningLoop.loadingChip', 'learning')}
        </span>
      </div>

      {visibleStatus ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-text-secondary">
            <LearningMetric
              icon={<Activity size={10} />}
              label={t('fleet.hermesLearningLoop.runsLabel', 'Runs')}
              tone={visibleStatus.summary.retrospectiveCoveragePercent === 100 ? 'success' : 'warning'}
              value={`${visibleStatus.summary.retrospectiveArtifactCount}/${visibleStatus.summary.retrospectiveEligibleRunCount}`}
            />
            <LearningMetric
              icon={<GitBranch size={10} />}
              label={t('fleet.hermesLearningLoop.candidatesLabel', 'Candidates')}
              tone={visibleStatus.summary.pendingLessonCandidateCount > 0 ? 'warning' : 'success'}
              value={`${visibleStatus.summary.pendingLessonCandidateCount}/${visibleStatus.summary.lessonCandidateCount}`}
            />
            <LearningMetric
              icon={<Sparkles size={10} />}
              label={t('fleet.hermesLearningLoop.patternsLabel', 'Patterns')}
              tone={visibleStatus.summary.patternCount > 0 ? 'success' : 'default'}
              value={String(visibleStatus.summary.patternCount)}
            />
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1">
            <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
              {t('fleet.hermesLearningLoop.autoChip', 'auto {{mode}}', {
                mode: visibleStatus.autoRetrospective.mode,
              })}
            </span>
            <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
              {t('fleet.hermesLearningLoop.coverageChip', '{{percent}}% reviewed', {
                percent: visibleStatus.summary.retrospectiveCoveragePercent,
              })}
            </span>
            <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
              {t('fleet.hermesLearningLoop.userModelChip', '{{count}} accepted observations', {
                count: visibleStatus.summary.acceptedUserObservationCount,
              })}
            </span>
            {visibleStatus.summary.pendingReviewCount > 0 ? (
              <span className="rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning">
                {t('fleet.hermesLearningLoop.pendingReviewChip', '{{count}} pending review', {
                  count: visibleStatus.summary.pendingReviewCount,
                })}
              </span>
            ) : null}
            <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
              {t('fleet.hermesLearningLoop.skillsChip', '{{reinforced}} reinforced / {{deprecated}} deprecated', {
                reinforced: visibleStatus.summary.reinforcedSkillCount,
                deprecated: visibleStatus.summary.deprecatedSkillCount,
              })}
            </span>
            <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
              {t('fleet.hermesLearningLoop.skillCandidatesChip', '{{count}} skill candidates', {
                count: visibleStatus.state.skillCandidates.learningCandidateCount,
              })}
            </span>
          </div>

          {visibleStatus.summary.staleRunningRunCount > 0 ? (
            <div
              className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning"
              data-testid="hermes-learning-run-doctor"
            >
              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {t(
                    'fleet.hermesLearningLoop.staleRuns',
                    '{{stale}} stale / {{running}} running runs in last {{limit}} inspected',
                    {
                      limit: visibleStatus.summary.inspectedRunLimit,
                      running: visibleStatus.summary.runningRunCount,
                      stale: visibleStatus.summary.staleRunningRunCount,
                    },
                  )}
                </div>
                <code className="block truncate text-[9px] text-warning">
                  {visibleStatus.commands.runDoctor}
                </code>
              </div>
            </div>
          ) : null}

          <div
            className={`mt-1.5 rounded border px-2 py-1 text-[10px] ${
              visibleStatus.nextAction.requiresHumanReview
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-accent/20 bg-accent/5 text-text-secondary'
            }`}
            data-testid="hermes-learning-next-action"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-accent">
                {t('fleet.hermesLearningLoop.nextAction', 'Next action')}
              </span>
              <span className="shrink-0 rounded bg-background px-1 py-0.5 text-[9px] text-text-secondary">
                {visibleStatus.nextAction.kind}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[9px] text-text-muted">
              {visibleStatus.nextAction.description}
            </div>
            <code className="mt-0.5 block truncate text-[9px] text-warning">
              {visibleStatus.nextAction.command}
            </code>
          </div>

          {visibleStatus.nextRetrospectiveRun ? (
            <div className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
              <Terminal size={10} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="truncate">
                    {t('fleet.hermesLearningLoop.nextRetrospectiveLabel', 'Next retrospective')}: {' '}
                    {visibleStatus.nextRetrospectiveRun.runId}
                  </div>
                  <button
                    aria-label={t('fleet.hermesLearningLoop.runRetrospective', 'Run retrospective')}
                    className="shrink-0 rounded border border-warning/30 bg-background p-0.5 text-warning transition hover:border-warning hover:text-warning disabled:cursor-not-allowed disabled:opacity-40"
                    data-testid={`hermes-learning-retrospective-${visibleStatus.nextRetrospectiveRun.runId}`}
                    disabled={runningRetrospectiveRunId === visibleStatus.nextRetrospectiveRun.runId}
                    onClick={handleRunRetrospective}
                    title={t('fleet.hermesLearningLoop.runRetrospective', 'Run retrospective')}
                    type="button"
                  >
                    <PlayCircle size={10} />
                  </button>
                </div>
                <div className="truncate text-[9px] text-text-muted">
                  {t('fleet.hermesLearningLoop.nextRetrospectiveMeta', '{{status}} | {{artifacts}} artifacts', {
                    artifacts: visibleStatus.nextRetrospectiveRun.artifactCount,
                    status: visibleStatus.nextRetrospectiveRun.status,
                  })}
                  {' '}
                  {t('fleet.hermesLearningLoop.nextRetrospectiveEvents', '| {{events}} events', {
                    events: visibleStatus.nextRetrospectiveRun.eventCount,
                  })}
                </div>
                <code className="block truncate text-[9px] text-warning">
                  {visibleStatus.nextRetrospectiveRun.command}
                </code>
              </div>
            </div>
          ) : null}

          {retrospectiveResult ? (
            <div className="mt-1.5 rounded border border-success/30 bg-success/10 px-2 py-1 text-[10px] text-success">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0">
                  {t(
                    'fleet.hermesLearningLoop.retrospectiveDone',
                    'Retrospective saved: {{artifact}} | {{lessons}} lessons | {{skills}} skills',
                    {
                      artifact: retrospectiveResult.retrospectiveArtifact ?? 'none',
                      lessons: retrospectiveResult.lessonCandidateCount,
                      skills: retrospectiveResult.skillCandidateCount,
                    },
                  )}
                </span>
                {retrospectiveResult.lessonCandidateCount > 0 && onOpenLessonReview ? (
                  <button
                    aria-label={t('fleet.hermesLearningLoop.reviewLessons', 'Review lessons')}
                    className="flex shrink-0 items-center gap-1 rounded border border-success/40 px-1.5 py-0.5 text-[9px] text-success transition hover:bg-success/10"
                    data-testid="hermes-learning-review-lessons"
                    onClick={onOpenLessonReview}
                    title={t('fleet.hermesLearningLoop.reviewLessons', 'Review lessons')}
                    type="button"
                  >
                    <PanelRightOpen size={10} />
                    {t('fleet.hermesLearningLoop.reviewLessons', 'Review lessons')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {retrospectiveError ? (
            <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
              {t('fleet.hermesLearningLoop.retrospectiveFailed', 'Retrospective failed')}: {retrospectiveError}
            </div>
          ) : null}

          <div className="mt-1.5 grid gap-1">
            {visibleStatus.state.skillUsage.top.slice(0, 3).map((skill) => (
              <div
                key={skill.skillName}
                className="flex min-w-0 items-center justify-between gap-2 rounded bg-surface/80 px-2 py-1 text-[10px]"
              >
                <span className="min-w-0 truncate text-text-secondary">{skill.skillName}</span>
                <span className="shrink-0 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                  {t('fleet.hermesLearningLoop.skillScoreChip', '{{score}}/100 {{state}}', {
                    score: skill.score,
                    state: skill.recommendation,
                  })}
                </span>
              </div>
            ))}
          </div>

          {visibleStatus.reviewQueue && visibleStatus.reviewQueue.items.length > 0 ? (
            <div
              className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1"
              data-testid="hermes-learning-review-queue"
            >
              <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] text-warning">
                <span className="min-w-0 truncate">
                  {t('fleet.hermesLearningLoop.reviewQueueTitle', 'Review queue')}
                </span>
                <span className="shrink-0 rounded bg-warning/10 px-1 py-0.5 text-[9px]">
                  {t('fleet.hermesLearningLoop.reviewQueueCount', '{{count}} pending', {
                    count: visibleStatus.reviewQueue.totalPending,
                  })}
                </span>
              </div>
              <ul className="mt-1 space-y-1">
                {visibleStatus.reviewQueue.items.slice(0, 3).map((item) => (
                  <li key={item.kind} className="min-w-0 text-[9px] text-text-muted">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {t('fleet.hermesLearningLoop.reviewQueueItem', '{{kind}}: {{count}}', {
                          count: item.pendingCount,
                          kind: item.kind,
                        })}
                      </span>
                      {item.kind === 'lesson_candidate' && onOpenLessonReview ? (
                        <button
                          aria-label={t('fleet.hermesLearningLoop.reviewLessons', 'Review lessons')}
                          className="shrink-0 rounded border border-warning/30 bg-background px-1 py-0.5 text-[9px] text-warning transition hover:border-warning hover:text-warning"
                          data-testid="hermes-learning-review-queue-lessons"
                          onClick={onOpenLessonReview}
                          type="button"
                        >
                          {t('fleet.hermesLearningLoop.openReview', 'Open')}
                        </button>
                      ) : null}
                    </div>
                    <code className="block truncate text-[9px] text-warning">
                      {item.nextReviewCommand ?? item.command}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div
            className={`mt-1.5 flex min-w-0 items-start gap-1.5 rounded border px-2 py-1 text-[10px] ${
              reviewGatesEnabled
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-warning/30 bg-warning/10 text-warning'
            }`}
          >
            <ShieldCheck size={10} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              {reviewGatesEnabled
                ? t(
                  'fleet.hermesLearningLoop.reviewGate',
                  'Review gates enabled: lessons, user model, skill candidates and skill lifecycle all require approval.',
                )
                : t(
                  'fleet.hermesLearningLoop.reviewGateMissing',
                  'Review gates need attention before automatic learning output can be trusted.',
                )}
            </span>
          </div>

          {visibleStatus.recommendations.slice(0, 2).map((recommendation) => (
            <div
              key={recommendation}
              className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted"
            >
              <AlertTriangle size={10} className="mt-0.5 shrink-0 text-warning" />
              <span className="min-w-0">{recommendation}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <AlertTriangle size={10} className="shrink-0 text-warning" />
          <span className="truncate">
            {t('fleet.hermesLearningLoop.unavailable', 'Hermes learning loop status is not loaded yet.')}
          </span>
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesLearningLoop.loadFailed', 'Hermes learning loop load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

const LearningMetric: React.FC<{
  icon: React.ReactNode;
  label: string;
  tone?: 'default' | 'success' | 'warning';
  value: string;
}> = ({ icon, label, tone = 'default', value }) => {
  const valueClass =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-text-secondary';
  return (
    <div className="min-w-0 rounded bg-surface/80 px-2 py-1">
      <div className="flex min-w-0 items-center gap-1 text-[9px] uppercase tracking-wider text-text-muted">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-0.5 truncate ${valueClass}`}>{value}</div>
    </div>
  );
};

function getHermesLearningLoopApi(): HermesLearningLoopApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesLearningLoop?: HermesLearningLoopApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesLearningLoop;
}
