import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BrainCircuit,
  Check,
  FileText,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import type { Project } from '../../types';
import type {
  ProjectEvolutionCreateInput,
  ProjectEvolutionProposal,
  ProjectEvolutionProposalStatus,
  ProjectEvolutionProposalType,
} from '../../../shared/project-evolution';

interface ProjectEvolutionPanelProps {
  project: Project;
  activeSessionId: string | null;
}

const STATUS_CLASS: Record<ProjectEvolutionProposalStatus, string> = {
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  rejected: 'border-border bg-muted text-text-muted',
  rolled_back: 'border-sky-500/30 bg-sky-500/10 text-sky-600',
};

function replaceProposal(
  proposals: ProjectEvolutionProposal[],
  proposal: ProjectEvolutionProposal,
): ProjectEvolutionProposal[] {
  return proposals.map((current) => current.id === proposal.id ? proposal : current);
}

export function ProjectEvolutionPanel({ project, activeSessionId }: ProjectEvolutionPanelProps) {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState<ProjectEvolutionProposal[]>([]);
  const [sourceKind, setSourceKind] = useState<'session' | 'summary'>(
    activeSessionId ? 'session' : 'summary'
  );
  const [targetType, setTargetType] = useState<ProjectEvolutionProposalType>('master_instruction');
  const [summary, setSummary] = useState('');
  const [targetPath, setTargetPath] = useState('docs/project-knowledge.md');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const api = window.electronAPI?.projectEvolution;
    if (!api) return;
    try {
      const result = await api.list(project.id);
      setProposals(result.proposals ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t(
        'projects.evolutionLoadFailed',
        'Failed to load Project proposals.'
      ));
    }
  }, [project.id, t]);

  useEffect(() => {
    setProposals([]);
    setNotice('');
    void load();
  }, [load]);

  const createProposal = useCallback(async () => {
    const api = window.electronAPI?.projectEvolution;
    if (!api || busy) return;
    if (sourceKind === 'session' && !activeSessionId) {
      setNotice(t('projects.evolutionNoSession', 'Open a Project session or use a review summary.'));
      return;
    }
    if (sourceKind === 'summary' && !summary.trim()) {
      setNotice(t('projects.evolutionSummaryRequired', 'Write a review summary first.'));
      return;
    }
    if (targetType === 'knowledge_file' && !targetPath.trim()) {
      setNotice(t('projects.evolutionPathRequired', 'Choose a workspace-relative knowledge path.'));
      return;
    }

    const input: ProjectEvolutionCreateInput = {
      projectId: project.id,
      source: sourceKind === 'session'
        ? { kind: 'session', sessionId: activeSessionId! }
        : { kind: 'summary', text: summary.trim() },
      target: targetType === 'master_instruction'
        ? { type: 'master_instruction' }
        : { type: 'knowledge_file', path: targetPath.trim() },
    };
    setBusy(true);
    setNotice('');
    try {
      const proposal = await api.create(input);
      setProposals((current) => [proposal, ...current]);
      if (sourceKind === 'summary') setSummary('');
      setNotice(t(
        'projects.evolutionCreated',
        'Proposal created. Review the before/after preview before approving it.'
      ));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t(
        'projects.evolutionCreateFailed',
        'Could not create the proposal.'
      ));
    } finally {
      setBusy(false);
    }
  }, [activeSessionId, busy, project.id, sourceKind, summary, t, targetPath, targetType]);

  const approve = useCallback(async (proposalId: string) => {
    const api = window.electronAPI?.projectEvolution;
    if (!api || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api.approve(proposalId);
      if (result.proposal) {
        setProposals((current) => replaceProposal(current, result.proposal!));
      }
      setNotice(result.ok
        ? t('projects.evolutionApproved', 'Approved. Future Project sessions use this update.')
        : result.error ?? t('projects.evolutionApproveFailed', 'Approval failed.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t(
        'projects.evolutionApproveFailed',
        'Approval failed.'
      ));
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  const reject = useCallback(async (proposalId: string) => {
    const api = window.electronAPI?.projectEvolution;
    if (!api || busy || !window.confirm(t(
      'projects.evolutionRejectConfirm',
      'Reject this proposal without changing the Project?'
    ))) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api.reject({ proposalId });
      if (result.proposal) {
        setProposals((current) => replaceProposal(current, result.proposal!));
      }
      setNotice(result.ok
        ? t('projects.evolutionRejected', 'Proposal rejected. The Project was not changed.')
        : result.error ?? t('projects.evolutionRejectFailed', 'Rejection failed.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t(
        'projects.evolutionRejectFailed',
        'Rejection failed.'
      ));
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  const rollback = useCallback(async (proposalId: string) => {
    const api = window.electronAPI?.projectEvolution;
    if (!api || busy || !window.confirm(t(
      'projects.evolutionRollbackConfirm',
      'Restore the exact value from before this approved update?'
    ))) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api.rollback(proposalId);
      if (result.proposal) {
        setProposals((current) => replaceProposal(current, result.proposal!));
      }
      setNotice(result.ok
        ? t('projects.evolutionRolledBack', 'The approved update was rolled back.')
        : result.error ?? t('projects.evolutionRollbackFailed', 'Rollback failed.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t(
        'projects.evolutionRollbackFailed',
        'Rollback failed.'
      ));
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  return (
    <section
      className="space-y-4 rounded-xl border border-accent/20 bg-accent/5 p-4"
      aria-labelledby="project-evolution-title"
      data-testid="project-evolution-panel"
    >
      <div className="flex items-start gap-3">
        <BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <h3 id="project-evolution-title" className="text-sm font-semibold text-text-primary">
            {t('projects.evolutionTitle', 'Project learning proposals')}
          </h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {t(
              'projects.evolutionHint',
              'Detect reusable decisions locally, inspect an exact before/after preview, then approve or reject. Nothing is sent to a remote model and pending proposals never change the Project.'
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <fieldset className="space-y-2 rounded-lg border border-border bg-background p-3">
          <legend className="px-1 text-xs font-medium text-text-secondary">
            {t('projects.evolutionSource', 'Learning source')}
          </legend>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="radio"
              name="project-evolution-source"
              value="session"
              checked={sourceKind === 'session'}
              onChange={() => setSourceKind('session')}
              data-testid="project-evolution-source-session"
            />
            {t('projects.evolutionActiveSession', 'Active session')}
            <span className="truncate font-mono text-[10px] text-text-muted">
              {activeSessionId ?? t('projects.evolutionNoActiveSession', 'none')}
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="radio"
              name="project-evolution-source"
              value="summary"
              checked={sourceKind === 'summary'}
              onChange={() => setSourceKind('summary')}
              data-testid="project-evolution-source-summary"
            />
            {t('projects.evolutionReviewSummary', 'Review summary')}
          </label>
        </fieldset>

        <label className="space-y-2 rounded-lg border border-border bg-background p-3 text-xs font-medium text-text-secondary">
          {t('projects.evolutionTarget', 'Proposed target')}
          <select
            value={targetType}
            onChange={(event) => setTargetType(event.target.value as ProjectEvolutionProposalType)}
            data-testid="project-evolution-target-type"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          >
            <option value="master_instruction">
              {t('projects.evolutionMasterInstruction', 'Master instruction')}
            </option>
            <option value="knowledge_file">
              {t('projects.evolutionKnowledgeFile', 'Knowledge file')}
            </option>
          </select>
        </label>
      </div>

      {sourceKind === 'summary' ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">
            {t('projects.evolutionSummaryLabel', 'Reusable decisions or rules')}
          </span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={4}
            placeholder={t(
              'projects.evolutionSummaryPlaceholder',
              'Example: Always cite the source date. Use a warm, concise French tone.'
            )}
            data-testid="project-evolution-summary"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
          />
        </label>
      ) : null}

      {targetType === 'knowledge_file' ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">
            {t('projects.evolutionKnowledgePath', 'Workspace-relative text file')}
          </span>
          <input
            value={targetPath}
            onChange={(event) => setTargetPath(event.target.value)}
            data-testid="project-evolution-target-path"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-text-primary"
          />
          <span className="block text-[11px] leading-4 text-text-muted">
            {t(
              'projects.evolutionKnowledgePathHint',
              'The parent folder must already exist. Secret files, symlinks and paths outside the workspace are refused.'
            )}
          </span>
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => void createProposal()}
        disabled={busy}
        data-testid="project-evolution-create"
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {t('projects.evolutionCreate', 'Create review proposal')}
      </button>

      {notice ? (
        <div role="status" aria-live="polite" className="text-xs text-text-muted">
          {notice}
        </div>
      ) : null}

      <div className="space-y-3" data-testid="project-evolution-list">
        {proposals.length === 0 ? (
          <p className="text-xs text-text-muted">
            {t('projects.evolutionEmpty', 'No learning proposals for this Project yet.')}
          </p>
        ) : null}
        {proposals.map((proposal) => (
          <article
            key={proposal.id}
            className="rounded-xl border border-border bg-background p-4"
            data-testid={`project-evolution-proposal-${proposal.id}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {proposal.type === 'master_instruction'
                    ? <BrainCircuit className="h-4 w-4 text-accent" aria-hidden="true" />
                    : <FileText className="h-4 w-4 text-accent" aria-hidden="true" />}
                  <h4 className="text-sm font-medium text-text-primary">{proposal.title}</h4>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[proposal.status]}`}
                    data-testid="project-evolution-status"
                  >
                    {proposal.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-text-muted">{proposal.reason}</p>
              </div>
              <time className="text-[10px] text-text-muted" dateTime={new Date(proposal.createdAt).toISOString()}>
                {new Date(proposal.createdAt).toLocaleString()}
              </time>
            </div>

            {proposal.staleReason ? (
              <div
                className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700"
                role="alert"
                data-testid="project-evolution-stale"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {proposal.staleReason} {t(
                  'projects.evolutionStaleHint',
                  'Create a fresh proposal from the current context.'
                )}
              </div>
            ) : null}

            <details className="mt-3" open={proposal.status === 'pending'}>
              <summary className="cursor-pointer text-xs font-medium text-text-secondary">
                {t('projects.evolutionPreview', 'Before / after preview')}
              </summary>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {t('projects.evolutionBefore', 'Before')}
                  </div>
                  <pre
                    className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 text-xs text-text-secondary"
                    data-testid="project-evolution-before"
                  >
                    {proposal.beforeContent || t('projects.evolutionEmptyValue', '(empty)')}
                  </pre>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {t('projects.evolutionAfter', 'After')}
                  </div>
                  <pre
                    className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-text-primary"
                    data-testid="project-evolution-after"
                  >
                    {proposal.afterContent}
                  </pre>
                </div>
              </div>
            </details>

            {proposal.evidence.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-text-secondary">
                  {t('projects.evolutionEvidence', {
                    count: proposal.evidence.length,
                    defaultValue: '{{count}} evidence excerpt(s)',
                  })}
                </summary>
                <ul className="mt-2 space-y-2">
                  {proposal.evidence.map((evidence, index) => (
                    <li key={`${proposal.id}-evidence-${index}`} className="rounded-lg bg-muted/40 p-2 text-xs text-text-muted">
                      <span className="mr-2 font-medium text-text-secondary">{evidence.role ?? 'source'}</span>
                      {evidence.excerpt}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {proposal.status === 'pending' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void approve(proposal.id)}
                    disabled={busy || Boolean(proposal.staleReason)}
                    data-testid="project-evolution-approve"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('projects.evolutionApprove', 'Approve and apply')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void reject(proposal.id)}
                    disabled={busy}
                    data-testid="project-evolution-reject"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-text-secondary disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('projects.evolutionReject', 'Reject')}
                  </button>
                </>
              ) : null}
              {proposal.status === 'approved' ? (
                <button
                  type="button"
                  onClick={() => void rollback(proposal.id)}
                  disabled={busy}
                  data-testid="project-evolution-rollback"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-text-secondary disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('projects.evolutionRollback', 'Rollback')}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
