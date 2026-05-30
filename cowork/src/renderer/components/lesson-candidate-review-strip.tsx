import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap, ListChecks, PanelRightOpen, Terminal } from 'lucide-react';
import type { LessonCandidateStats, LessonCandidateStatus } from '../types/hermes';

const STATUS_CHIPS: Array<{
  fallback: string;
  key: string;
  status: LessonCandidateStatus;
}> = [
  {
    fallback: '{{count}} pending',
    key: 'fleet.lessonCandidate.pendingChip',
    status: 'pending',
  },
  {
    fallback: '{{count}} approved',
    key: 'fleet.lessonCandidate.approvedChip',
    status: 'approved',
  },
  {
    fallback: '{{count}} discarded',
    key: 'fleet.lessonCandidate.discardedChip',
    status: 'discarded',
  },
];

interface LessonCandidateReviewApi {
  stats?: () => Promise<{ ok: boolean; error?: string; stats?: LessonCandidateStats }>;
}

export function buildLessonCandidateReviewCommand(): string {
  return 'buddy lessons candidate list --status pending';
}

export const LessonCandidateReviewStrip: React.FC<{
  error?: string | null;
  onOpenReview?: () => void;
  stats?: LessonCandidateStats | null;
}> = ({ error = null, onOpenReview, stats }) => {
  const { t } = useTranslation();
  const [loadedStats, setLoadedStats] = useState<LessonCandidateStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const command = useMemo(() => buildLessonCandidateReviewCommand(), []);
  const visibleStats = stats !== undefined ? stats : loadedStats;
  const visibleError = error ?? loadError;
  const pendingCount = visibleStats?.byStatus.pending ?? 0;

  useEffect(() => {
    if (stats !== undefined) return;
    const api = getLessonCandidateReviewApi();
    if (!api?.stats) return;
    let cancelled = false;

    void api
      .stats()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLoadedStats(null);
          setLoadError(result.error ?? 'Lesson candidate stats unavailable');
          return;
        }
        setLoadedStats(result.stats ?? null);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedStats(null);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [stats]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-lesson-candidate-review"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GraduationCap size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.lessonCandidate.title', 'Lesson candidate review')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
          {t('fleet.lessonCandidate.countChip', '{{count}} pending', {
            count: pendingCount,
          })}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {STATUS_CHIPS.map((chip) => (
          <span key={chip.status} className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
            {t(chip.key, chip.fallback, {
              count: visibleStats?.byStatus[chip.status] ?? 0,
            })}
          </span>
        ))}
      </div>

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.lessonCandidate.loadFailed', 'Lesson candidate stats failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-secondary">
        <ListChecks size={10} className="shrink-0 text-accent" />
        <span className="line-clamp-2">
          {t(
            'fleet.lessonCandidate.guardrail',
            'Lessons are written only after a human opens the review queue and approves a pending candidate.'
          )}
        </span>
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>

      {onOpenReview && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onOpenReview}
            className="flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-[10px] text-accent transition-colors hover:bg-accent/10"
            data-testid="lesson-candidate-open-review"
          >
            <PanelRightOpen size={10} />
            {t('fleet.lessonCandidate.openReview', 'Open review panel')}
          </button>
        </div>
      )}
    </section>
  );
};

function getLessonCandidateReviewApi(): LessonCandidateReviewApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        lessonCandidate?: LessonCandidateReviewApi;
      };
    }
  ).electronAPI?.lessonCandidate;
}
