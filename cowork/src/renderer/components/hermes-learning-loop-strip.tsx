import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  GitBranch,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';

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
  state: {
    recentRuns: Array<{
      artifactCount: number;
      channel?: string;
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

interface HermesLearningLoopApi {
  get?: (options?: {
    cwd?: string;
    limit?: number;
  }) => Promise<HermesLearningLoopStatus | null>;
}

export function buildHermesLearningLoopCommand(): string {
  return 'buddy hermes learning status --json';
}

export const HermesLearningLoopStrip: React.FC<{
  cwd?: string;
  error?: string | null;
  status?: HermesLearningLoopStatus | null;
}> = ({ cwd, error = null, status }) => {
  const { t } = useTranslation();
  const [loadedStatus, setLoadedStatus] = useState<HermesLearningLoopStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
              tone={visibleStatus.summary.retrospectiveArtifactCount > 0 ? 'success' : 'default'}
              value={`${visibleStatus.summary.retrospectiveArtifactCount}/${visibleStatus.summary.recentRunCount}`}
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
              {t('fleet.hermesLearningLoop.userModelChip', '{{count}} accepted observations', {
                count: visibleStatus.summary.acceptedUserObservationCount,
              })}
            </span>
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

          {visibleStatus.nextRetrospectiveRun ? (
            <div className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
              <Terminal size={10} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="truncate">
                  {t('fleet.hermesLearningLoop.nextRetrospectiveLabel', 'Next retrospective')}: {' '}
                  {visibleStatus.nextRetrospectiveRun.runId}
                </div>
                <div className="truncate text-[9px] text-text-muted">
                  {t('fleet.hermesLearningLoop.nextRetrospectiveMeta', '{{status}} | {{artifacts}} artifacts', {
                    artifacts: visibleStatus.nextRetrospectiveRun.artifactCount,
                    status: visibleStatus.nextRetrospectiveRun.status,
                  })}
                </div>
                <code className="block truncate text-[9px] text-warning">
                  {visibleStatus.nextRetrospectiveRun.command}
                </code>
              </div>
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
