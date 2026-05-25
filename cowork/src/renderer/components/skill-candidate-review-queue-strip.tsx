import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks, PackageCheck, Route, ShieldCheck, Terminal } from 'lucide-react';

export interface SkillCandidateReviewQueueItem {
  eligible: boolean;
  reason: string;
  skillName: string;
  skillPath: string;
  sourceJobId: string;
  successfulRunCount: number;
}

interface SkillCandidateReviewApi {
  list?: (options?: {
    cwd?: string;
    eligibleOnly?: boolean;
    limit?: number;
    skillRoot?: string;
  }) => Promise<SkillCandidateReviewQueueItem[]>;
}

export function buildSkillCandidateReviewQueueGoal(): string {
  return [
    'Review the research-script SKILL.md candidate queue from Cowork.',
    'Use the CLI review surface:',
    '- buddy tools skill-candidate list --eligible-only --json',
    '- buddy tools skill-candidate inspect <candidate-dir>',
    '',
    'Rules:',
    '- Do not install a candidate automatically.',
    '- Preserve reviewer edits in the materialized SKILL.md.',
    '- Install only after a human reviewer approves with --approved-by.',
    '- Keep public-data and no-contact-action guardrails intact.',
  ].join('\n');
}

export function buildSkillCandidateReviewCommands(): string[] {
  return [
    'buddy tools skill-candidate list --eligible-only --json',
    'buddy tools skill-candidate inspect <candidate-dir>',
    'buddy tools skill-candidate install <candidate-dir> --approved-by <name>',
  ];
}

export const SkillCandidateReviewQueueStrip: React.FC<{
  candidates?: SkillCandidateReviewQueueItem[];
  cwd?: string;
  error?: string | null;
  onUseAsGoal?: (goal: string) => void;
}> = ({ candidates, cwd, error = null, onUseAsGoal }) => {
  const { t } = useTranslation();
  const [loadedCandidates, setLoadedCandidates] = useState<SkillCandidateReviewQueueItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const commands = useMemo(() => buildSkillCandidateReviewCommands(), []);
  const goalDraft = useMemo(() => buildSkillCandidateReviewQueueGoal(), []);
  const reviewCandidates = candidates ?? loadedCandidates;
  const visibleError = error ?? loadError;
  const eligibleCount = reviewCandidates.filter((candidate) => candidate.eligible).length;
  const visibleCandidates = reviewCandidates.slice(0, 3);

  useEffect(() => {
    if (candidates !== undefined) return;
    const api = getSkillCandidateReviewApi();
    if (!api?.list) return;
    let cancelled = false;

    void api
      .list({
        cwd,
        eligibleOnly: true,
        limit: 3,
      })
      .then((items) => {
        if (cancelled) return;
        setLoadedCandidates(Array.isArray(items) ? items : []);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedCandidates([]);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [candidates, cwd]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-skill-candidate-review-queue"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <PackageCheck size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.skillCandidate.title', 'Skill candidate review')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
          {t('fleet.skillCandidate.countChip', '{{count}} eligible', {
            count: eligibleCount,
          })}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          {t('fleet.skillCandidate.reviewChip', 'human approval required')}
        </span>
        <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          {t('fleet.skillCandidate.noAutoInstallChip', 'no auto-install')}
        </span>
        <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          {t('fleet.skillCandidate.publicDataChip', 'public-data guardrails')}
        </span>
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-secondary">
        <ShieldCheck size={10} className="shrink-0 text-accent" />
        <span className="line-clamp-2">
          {t(
            'fleet.skillCandidate.guardrail',
            'Candidates can become workspace skills only after repeated successful runs and explicit reviewer approval.'
          )}
        </span>
      </div>

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.skillCandidate.loadFailed', 'Candidate queue load failed')}: {visibleError}
        </div>
      )}

      {visibleCandidates.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {visibleCandidates.map((candidate) => (
            <li key={candidate.skillName} className="min-w-0 rounded bg-surface/80 px-2 py-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[10px] text-text-secondary">
                  {candidate.skillName}
                </span>
                <span className="shrink-0 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                  {candidate.successfulRunCount} runs
                </span>
              </div>
              <div className="mt-0.5 truncate text-[9px] text-text-muted">
                {candidate.sourceJobId} · {candidate.reason}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <ListChecks size={10} className="shrink-0 text-text-muted" />
          <span className="truncate">
            {t('fleet.skillCandidate.empty', 'Use the CLI queue to list materialized candidates.')}
          </span>
        </div>
      )}

      <ul className="mt-1.5 space-y-1">
        {commands.slice(0, 2).map((command) => (
          <li
            key={command}
            className="flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted"
          >
            <Terminal size={10} className="shrink-0 text-text-muted" />
            <code className="truncate">{command}</code>
          </li>
        ))}
      </ul>

      {onUseAsGoal && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onUseAsGoal(goalDraft)}
            className="flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-[10px] text-accent transition-colors hover:bg-accent/10"
          >
            <Route size={10} />
            {t('fleet.skillCandidate.useAsGoal', 'Review queue as goal')}
          </button>
        </div>
      )}
    </section>
  );
};

function getSkillCandidateReviewApi(): SkillCandidateReviewApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          skillCandidate?: SkillCandidateReviewApi;
        };
      };
    }
  ).electronAPI?.tools?.skillCandidate;
}
