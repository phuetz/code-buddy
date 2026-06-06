import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ListChecks,
  Loader2,
  PackageCheck,
  Route,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

export interface SkillCandidateReviewQueueItem {
  candidateChecksum?: string;
  candidateDiffPreview?: {
    addedLines: number;
    preview: string;
    removedLines: number;
    summary: string;
    truncated: boolean;
  };
  eligible: boolean;
  evidenceRunIds?: string[];
  installState?: 'not-installed' | 'installed-current' | 'installed-different' | 'installed-missing';
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  gradedTasks?: SkillCandidateGradedTask[];
  firewall?: {
    capabilities: string[];
    findingCounts: {
      critical: number;
      high: number;
      info: number;
      low: number;
      medium: number;
    };
    quarantineRequired: boolean;
    score: number;
    summary: string;
    verdict: 'allow' | 'review' | 'quarantine';
  };
  kind?: string;
  promotionThreshold?: number;
  proofBackedSuccessCount?: number;
  proofCommands?: SkillCandidateProofCommand[];
  proofStatus?: string;
  reason: string;
  reviewCommands?: string[];
  skillName: string;
  skillPath: string;
  sourceJobId: string;
  sourceRunId?: string;
  successfulRunCount: number;
  toolSequence?: string[];
}

export interface SkillCandidateProofCommand {
  command?: string;
  durationMs?: number;
  isTest: boolean;
  runId: string;
  sequence: number;
  success?: boolean;
  toolName: string;
}

export interface SkillCandidateGradedTask {
  command: string;
  expected: 'pass';
  id: string;
  isTest?: boolean;
  sourceJobId?: string;
  sourceRunId?: string;
  timeoutMs?: number;
  toolName?: string;
}

export interface SkillCandidateSideBySideDiffRow {
  candidate: string;
  installed: string;
  kind: 'added' | 'context' | 'removed';
}

interface SkillCandidateReviewApi {
  install?: (options: {
    approvedBy: string;
    candidatePath: string;
    cwd?: string;
    overwrite?: boolean;
    workspaceSkillRoot?: string;
  }) => Promise<{
    candidate?: SkillCandidateReviewQueueItem;
    error?: string;
    installed?: {
      approvedBy: string;
      installedPath: string;
      skillName: string;
    };
    ok: boolean;
  }>;
  list?: (options?: {
    cwd?: string;
    eligibleOnly?: boolean;
    limit?: number;
    skillRoot?: string;
  }) => Promise<SkillCandidateReviewQueueItem[]>;
}

export function buildSkillCandidateReviewQueueGoal(): string {
  return [
    'Review the shared SKILL.md candidate queue from Cowork.',
    'The queue may contain research-script candidates and Learning Agent retrospective candidates.',
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
  onInstalled?: () => void;
  onUseAsGoal?: (goal: string) => void;
}> = ({ candidates, cwd, error = null, onInstalled, onUseAsGoal }) => {
  const { t } = useTranslation();
  const [installError, setInstallError] = useState<string | null>(null);
  const [installFeedback, setInstallFeedback] = useState<string | null>(null);
  const [installingSkillName, setInstallingSkillName] = useState<string | null>(null);
  const [loadedCandidates, setLoadedCandidates] = useState<SkillCandidateReviewQueueItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState('');
  const [expandedDiffSkillName, setExpandedDiffSkillName] = useState<string | null>(null);
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

  const handleInstallCandidate = async (candidate: SkillCandidateReviewQueueItem) => {
    const approvedBy = reviewerName.trim();
    if (!approvedBy) {
      setInstallError(t('fleet.skillCandidate.reviewerRequired', 'Reviewer is required.'));
      setInstallFeedback(null);
      return;
    }

    const api = getSkillCandidateReviewApi();
    if (!api?.install) {
      onUseAsGoal?.(buildCandidateInstallGoal(candidate, approvedBy));
      return;
    }

    setInstallingSkillName(candidate.skillName);
    setInstallError(null);
    setInstallFeedback(null);

    try {
      const result = await api.install({
        approvedBy,
        candidatePath: candidate.skillPath,
        cwd,
        overwrite: candidate.installState === 'installed-different',
      });
      if (!result.ok) {
        setInstallError(result.error ?? t('fleet.skillCandidate.installFailed', 'Install failed.'));
        return;
      }

      setInstallFeedback(
        t('fleet.skillCandidate.installedFeedback', 'Installed {{skill}} by {{reviewer}}.', {
          reviewer: result.installed?.approvedBy ?? approvedBy,
          skill: result.installed?.skillName ?? candidate.skillName,
        })
      );

      if (candidates === undefined && api.list) {
        const refreshed = await api.list({
          cwd,
          eligibleOnly: true,
          limit: 3,
        });
        setLoadedCandidates(Array.isArray(refreshed) ? refreshed : []);
      }
      onInstalled?.();
    } catch (installErrorValue: unknown) {
      setInstallError(
        installErrorValue instanceof Error ? installErrorValue.message : String(installErrorValue)
      );
    } finally {
      setInstallingSkillName(null);
    }
  };

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

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
        <input
          aria-label={t('fleet.skillCandidate.reviewerLabel', 'Reviewer')}
          className="min-w-0 flex-1 rounded border border-border-muted bg-surface px-2 py-1 text-[10px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
          data-testid="skill-candidate-reviewer-input"
          onChange={(event) => setReviewerName(event.target.value)}
          placeholder={t('fleet.skillCandidate.reviewerPlaceholder', 'Reviewer')}
          type="text"
          value={reviewerName}
        />
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

      {installError ? (
        <div className="mt-1.5 flex items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          <AlertCircle size={10} className="mt-0.5 shrink-0" />
          <span>{installError}</span>
        </div>
      ) : null}

      {installFeedback ? (
        <div className="mt-1.5 flex items-start gap-1.5 rounded border border-success/30 bg-success/10 px-2 py-1 text-[10px] text-success">
          <CheckCircle2 size={10} className="mt-0.5 shrink-0" />
          <span>{installFeedback}</span>
        </div>
      ) : null}

      {visibleCandidates.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {visibleCandidates.map((candidate) => (
            <li key={candidate.skillName} className="min-w-0 rounded bg-surface/80 px-2 py-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[10px] text-text-secondary">
                  {candidate.skillName}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                    {candidate.kind === 'learning'
                      ? t('fleet.skillCandidate.learningKind', 'Learning Agent')
                      : t('fleet.skillCandidate.researchKind', 'Research script')}
                  </span>
                  <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                    {candidate.successfulRunCount} runs
                  </span>
                  {candidate.proofBackedSuccessCount !== undefined || candidate.promotionThreshold !== undefined ? (
                    <span className={`rounded px-1 py-0.5 text-[9px] ${candidate.eligible ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                      {t('fleet.skillCandidate.proofBackedRuns', 'proof {{count}}/{{threshold}}', {
                        count: candidate.proofBackedSuccessCount ?? candidate.successfulRunCount,
                        threshold: candidate.promotionThreshold ?? '?',
                      })}
                    </span>
                  ) : null}
                  {candidate.installState ? (
                    <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                      {formatInstallState(candidate.installState)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-0.5 truncate text-[9px] text-text-muted">
                {(candidate.sourceRunId || candidate.sourceJobId) || 'unknown source'} · {candidate.reason}
              </div>
              {candidate.proofStatus || candidate.evidenceRunIds?.length ? (
                <div className="mt-0.5 truncate text-[9px] text-text-muted">
                  {candidate.proofStatus
                    ? `${t('fleet.skillCandidate.proofStatus', 'Proof')}: ${candidate.proofStatus}`
                    : t('fleet.skillCandidate.proofStatusUnknown', 'Proof: unknown')}
                  {candidate.evidenceRunIds?.length
                    ? ` · ${candidate.evidenceRunIds.slice(-2).join(', ')}`
                    : ''}
                </div>
              ) : null}
              {formatLatestProofCommand(candidate) ? (
                <div
                  className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] text-text-muted"
                  data-testid={`skill-candidate-proof-command-${candidate.skillName}`}
                >
                  <Terminal size={9} className="shrink-0 text-text-muted" />
                  <span className="shrink-0">
                    {t('fleet.skillCandidate.proofCommand', 'Proof command')}:
                  </span>
                  <code className="truncate">{formatLatestProofCommand(candidate)}</code>
                </div>
              ) : null}
              {formatLatestGradedTask(candidate) ? (
                <div
                  className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] text-text-muted"
                  data-testid={`skill-candidate-graded-task-${candidate.skillName}`}
                >
                  <ListChecks size={9} className="shrink-0 text-text-muted" />
                  <span className="shrink-0">
                    {t('fleet.skillCandidate.gradedTask', 'Graded task')}:
                  </span>
                  <code className="truncate">{formatLatestGradedTask(candidate)}</code>
                </div>
              ) : null}
              {candidate.installedVersion ? (
                <div className="mt-0.5 truncate text-[9px] text-text-muted">
                  {t('fleet.skillCandidate.installedVersion', 'Installed')}: v{candidate.installedVersion}
                  {candidate.installedIntegrityOk === false ? ' · integrity warning' : ''}
                </div>
              ) : null}
              {candidate.firewall ? (
                <SkillCandidateFirewallPanel candidate={candidate} />
              ) : null}
              {candidate.toolSequence?.length ? (
                <div className="mt-0.5 truncate text-[9px] text-text-muted">
                  {t('fleet.skillCandidate.toolSequence', 'Tools')}: {candidate.toolSequence.join(' -> ')}
                </div>
              ) : null}
              {candidate.reviewCommands?.[0] ? (
                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] text-text-muted">
                  <Terminal size={9} className="shrink-0 text-text-muted" />
                  <code className="truncate">{candidate.reviewCommands[0]}</code>
                </div>
              ) : null}
              {candidate.candidateDiffPreview ? (
                <div className="mt-1 rounded bg-surface px-2 py-1">
                  <div className="truncate text-[9px] text-text-muted">
                    {candidate.candidateDiffPreview.summary}
                    {candidate.candidateDiffPreview.truncated ? '...' : ''}
                  </div>
                  <pre className="mt-0.5 max-h-24 overflow-hidden whitespace-pre-wrap text-[9px] leading-snug text-text-muted">
                    {candidate.candidateDiffPreview.preview}
                    {candidate.candidateDiffPreview.truncated ? '\n...' : ''}
                  </pre>
                  <button
                    className="mt-1 rounded border border-accent/40 px-2 py-1 text-[9px] text-accent transition-colors hover:bg-accent/10"
                    data-testid={`skill-candidate-toggle-diff-${candidate.skillName}`}
                    onClick={() =>
                      setExpandedDiffSkillName((current) =>
                        current === candidate.skillName ? null : candidate.skillName
                      )
                    }
                    type="button"
                  >
                    {expandedDiffSkillName === candidate.skillName
                      ? t('fleet.skillCandidate.collapseDiff', 'Hide side-by-side diff')
                      : t('fleet.skillCandidate.expandDiff', 'Show side-by-side diff')}
                  </button>
                </div>
              ) : null}
              {candidate.candidateDiffPreview && expandedDiffSkillName === candidate.skillName ? (
                <SkillCandidateSideBySideDiff candidate={candidate} />
              ) : null}
              {isCandidateInstallActionVisible(candidate) ? (
                <div className="mt-1 flex justify-end">
                  <button
                    className="flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-[10px] text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`skill-candidate-install-${candidate.skillName}`}
                    disabled={
                      !reviewerName.trim() ||
                      installingSkillName !== null ||
                      candidate.firewall?.quarantineRequired === true
                    }
                    onClick={() => void handleInstallCandidate(candidate)}
                    type="button"
                  >
                    {installingSkillName === candidate.skillName ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Download size={10} />
                    )}
                    {candidate.installState === 'installed-different'
                      ? t('fleet.skillCandidate.overwriteCandidate', 'Overwrite')
                      : t('fleet.skillCandidate.installCandidate', 'Install')}
                  </button>
                </div>
              ) : null}
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

const SkillCandidateSideBySideDiff: React.FC<{
  candidate: SkillCandidateReviewQueueItem;
}> = ({ candidate }) => {
  const { t } = useTranslation();
  const diff = candidate.candidateDiffPreview;
  const rows = useMemo(
    () => buildSkillCandidateSideBySideDiffRows(diff?.preview ?? ''),
    [diff?.preview],
  );
  if (!diff) return null;

  return (
    <div
      className="mt-1 rounded border border-accent/20 bg-background/40 p-1.5"
      data-testid={`skill-candidate-side-by-side-${candidate.skillName}`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 text-[9px] text-text-muted">
        <span className="truncate">
          {t('fleet.skillCandidate.diffStats', '{{added}} added / {{removed}} removed', {
            added: diff.addedLines,
            removed: diff.removedLines,
          })}
        </span>
        {diff.truncated ? (
          <span className="shrink-0 text-warning">
            {t('fleet.skillCandidate.diffTruncated', 'preview truncated')}
          </span>
        ) : null}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]">
        <div className="rounded bg-surface px-2 py-1 font-medium text-text-secondary">
          {t('fleet.skillCandidate.installedColumn', 'Installed SKILL.md')}
        </div>
        <div className="rounded bg-surface px-2 py-1 font-medium text-text-secondary">
          {t('fleet.skillCandidate.candidateColumn', 'Candidate SKILL.md')}
        </div>
        {rows.map((row, index) => (
          <React.Fragment key={`${row.kind}-${index}-${row.installed}-${row.candidate}`}>
            <pre className={`min-w-0 whitespace-pre-wrap rounded px-2 py-1 leading-snug ${diffCellClass(row.kind, 'installed')}`}>
              {row.installed || ' '}
            </pre>
            <pre className={`min-w-0 whitespace-pre-wrap rounded px-2 py-1 leading-snug ${diffCellClass(row.kind, 'candidate')}`}>
              {row.candidate || ' '}
            </pre>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const SkillCandidateFirewallPanel: React.FC<{
  candidate: SkillCandidateReviewQueueItem;
}> = ({ candidate }) => {
  const { t } = useTranslation();
  const firewall = candidate.firewall;
  if (!firewall) return null;
  const toneClass = firewall.verdict === 'quarantine'
    ? 'border-error/30 bg-error/10 text-error'
    : firewall.verdict === 'review'
      ? 'border-warning/30 bg-warning/10 text-warning'
      : 'border-success/30 bg-success/10 text-success';

  return (
    <div
      className={`mt-1 rounded border px-2 py-1 text-[9px] ${toneClass}`}
      data-testid={`skill-candidate-firewall-${candidate.skillName}`}
      title={firewall.summary}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate">
          {t('fleet.skillCandidate.firewallVerdict', 'Firewall')}: {firewall.verdict}
        </span>
        <span className="shrink-0 font-mono tabular-nums">{firewall.score}/100</span>
      </div>
      <div className="mt-0.5 truncate text-current/80">
        {firewall.capabilities.length
          ? firewall.capabilities.join(', ')
          : t('fleet.skillCandidate.noCapabilities', 'no risky capability detected')}
      </div>
      {firewall.quarantineRequired ? (
        <div className="mt-0.5 truncate font-medium">
          {t('fleet.skillCandidate.quarantineRequired', 'Quarantine required before install')}
        </div>
      ) : null}
    </div>
  );
};

export function buildSkillCandidateSideBySideDiffRows(
  unifiedDiffPreview: string,
): SkillCandidateSideBySideDiffRow[] {
  return unifiedDiffPreview
    .split(/\r?\n/)
    .flatMap((line): SkillCandidateSideBySideDiffRow[] => {
      if (!line) return [];
      if (line.startsWith('@@')) return [];
      if (line.startsWith('--- a/') || line.startsWith('+++ b/')) return [];
      if (line.startsWith('--- /dev/null') || line.startsWith('+++ /dev/null')) return [];

      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === '-') {
        return [{ candidate: '', installed: content, kind: 'removed' }];
      }
      if (prefix === '+') {
        return [{ candidate: content, installed: '', kind: 'added' }];
      }
      if (prefix === ' ') {
        return [{ candidate: content, installed: content, kind: 'context' }];
      }
      return [];
    });
}

function diffCellClass(
  kind: SkillCandidateSideBySideDiffRow['kind'],
  side: 'candidate' | 'installed',
): string {
  if (kind === 'removed' && side === 'installed') {
    return 'bg-warning/10 text-warning';
  }
  if (kind === 'added' && side === 'candidate') {
    return 'bg-success/10 text-success';
  }
  return 'bg-surface text-text-muted';
}

function formatInstallState(
  state: NonNullable<SkillCandidateReviewQueueItem['installState']>,
): string {
  switch (state) {
    case 'installed-current':
      return 'installed current';
    case 'installed-different':
      return 'installed differs';
    case 'installed-missing':
      return 'installed missing';
    case 'not-installed':
      return 'not installed';
  }
}

function formatLatestProofCommand(candidate: SkillCandidateReviewQueueItem): string | null {
  const command = candidate.proofCommands?.at(-1);
  if (!command) return null;
  const status = command.success === undefined ? 'unknown' : command.success ? 'passed' : 'failed';
  const duration = command.durationMs === undefined ? '' : ` ${command.durationMs}ms`;
  const count = candidate.proofCommands && candidate.proofCommands.length > 1
    ? ` (${candidate.proofCommands.length} proof commands)`
    : '';
  return `${status}${duration} ${command.command ?? command.toolName}${count}`;
}

function formatLatestGradedTask(candidate: SkillCandidateReviewQueueItem): string | null {
  const task = candidate.gradedTasks?.at(-1);
  if (!task) return null;
  const source = task.sourceRunId ?? task.sourceJobId;
  const sourceText = source ? ` from ${source}` : '';
  const timeout = task.timeoutMs === undefined ? '' : ` timeout ${task.timeoutMs}ms`;
  const count = candidate.gradedTasks && candidate.gradedTasks.length > 1
    ? ` (${candidate.gradedTasks.length} graded tasks)`
    : '';
  return `${task.command} must ${task.expected}${sourceText}${timeout}${count}`;
}

function isCandidateInstallActionVisible(candidate: SkillCandidateReviewQueueItem): boolean {
  if (!candidate.eligible) return false;
  return candidate.installState !== 'installed-current';
}

function buildCandidateInstallGoal(
  candidate: SkillCandidateReviewQueueItem,
  approvedBy: string,
): string {
  const command = buildCandidateInstallCommand(candidate, approvedBy);
  return [
    `Install reviewed skill candidate ${candidate.skillName} from Cowork.`,
    '',
    'Use the review-gated command:',
    `- ${command}`,
  ].join('\n');
}

function buildCandidateInstallCommand(
  candidate: SkillCandidateReviewQueueItem,
  approvedBy: string,
): string {
  const existing = candidate.reviewCommands?.find((command) =>
    command.includes('action=candidate_install')
  );
  const fallback = [
    'skill_manage action=candidate_install',
    `candidate_path=${candidate.skillPath}`,
    'approved_by=<reviewer>',
    candidate.installState === 'installed-different' ? 'overwrite=true' : '',
  ].filter(Boolean).join(' ');
  return (existing ?? fallback).replace(
    'approved_by=<reviewer>',
    `approved_by=${formatReviewerForCommand(approvedBy)}`
  );
}

function formatReviewerForCommand(value: string): string {
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : JSON.stringify(value);
}
