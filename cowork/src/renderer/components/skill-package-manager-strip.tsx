import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  History,
  ListChecks,
  Loader2,
  PackageOpen,
  PauseCircle,
  PencilLine,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type SkillPackageStatus = 'active' | 'disabled' | 'deprecated';
type SkillPackageFirewallCapability =
  | 'dynamic-code'
  | 'filesystem'
  | 'network'
  | 'prototype-pollution'
  | 'secrets'
  | 'shell';
type SkillPackageFirewallVerdict = 'allow' | 'review' | 'quarantine';

export interface SkillPackageManagerEntry {
  averageDurationMs?: number;
  contentPreview?: string;
  contentPreviewTruncated?: boolean;
  enabled: boolean;
  exists: boolean;
  failureCount?: number;
  firewallCapabilities?: SkillPackageFirewallCapability[];
  firewallFindingCount?: number;
  firewallQuarantineRequired?: boolean;
  firewallScore?: number;
  firewallSummary?: string;
  firewallVerdict?: SkillPackageFirewallVerdict;
  installedAt: number;
  integrityOk: boolean;
  invocationCount?: number;
  lastError?: string;
  lastLifecycleReason?: string;
  lastLifecycleReviewer?: string;
  lastUsedAt?: number;
  name: string;
  path: string;
  rollbackableCount: number;
  sizeBytes?: number;
  source: 'hub' | 'local' | 'git';
  status: SkillPackageStatus;
  staleTempPath?: boolean;
  successCount?: number;
  version: string;
}

export interface SkillPackageManagerSummary {
  cacheDir: string;
  disabledCount: number;
  enabledCount: number;
  health?: {
    healthyCount: number;
    integrityMismatchCount: number;
    issueCount: number;
    missingFileCount: number;
    nextCommand: string;
    ok: boolean;
    staleTempMissingCount?: number;
  };
  installedCount: number;
  lockfilePath: string;
  packages: SkillPackageManagerEntry[];
  reviewCommands: string[];
  rollbackableCount: number;
  skillRoot: string;
}

interface SkillPackageManagerApi {
  delete?: (options: {
    approvedBy: string;
    cwd?: string;
    name: string;
    reason?: string;
  }) => Promise<{
    deletedName?: string;
    error?: string;
    ok: boolean;
    summary?: SkillPackageManagerSummary;
  }>;
  lifecycle?: (options: {
    action: 'enable' | 'disable' | 'deprecate';
    approvedBy: string;
    cwd?: string;
    name: string;
    reason?: string;
  }) => Promise<{
    error?: string;
    ok: boolean;
    package?: SkillPackageManagerEntry;
    summary?: SkillPackageManagerSummary;
  }>;
  list?: (options?: {
    cwd?: string;
    limit?: number;
  }) => Promise<SkillPackageManagerSummary | null>;
  patch?: (options: {
    approvedBy: string;
    cwd?: string;
    expectedReplacements?: number;
    name: string;
    newText: string;
    oldText: string;
    reason?: string;
  }) => Promise<{
    error?: string;
    ok: boolean;
    package?: SkillPackageManagerEntry;
    summary?: SkillPackageManagerSummary;
  }>;
  rollback?: (options: {
    approvedBy: string;
    cwd?: string;
    name: string;
    reason?: string;
    snapshotId?: string;
  }) => Promise<{
    error?: string;
    ok: boolean;
    package?: SkillPackageManagerEntry;
    summary?: SkillPackageManagerSummary;
  }>;
  reset?: (options: {
    approvedBy: string;
    cwd?: string;
    name: string;
    reason?: string;
    version?: string;
  }) => Promise<{
    error?: string;
    ok: boolean;
    package?: SkillPackageManagerEntry;
    summary?: SkillPackageManagerSummary;
  }>;
  update?: (options: {
    approvedBy: string;
    cwd?: string;
    force?: boolean;
    name: string;
    reason?: string;
    version?: string;
  }) => Promise<{
    error?: string;
    ok: boolean;
    package?: SkillPackageManagerEntry;
    summary?: SkillPackageManagerSummary;
  }>;
}

export function buildSkillPackageManagerGoal(): string {
  return [
    'Review installed Code Buddy SKILL.md packages from Cowork.',
    'Inspect status, usage, integrity, Skill Firewall verdicts, rollback history and Learning Agent recommendations before changing anything.',
    '',
    'Use review-gated actions only:',
    '- buddy skills list --all --json',
    '- buddy skills learning-usage --json',
    '- skill_manage action=history name=<skill>',
    '- skill_manage action=enable|disable|deprecate|delete|patch|rollback|reset|update name=<skill> approved_by=<reviewer>',
    '',
    'Rules:',
    '- Do not mutate an installed skill without a named reviewer.',
    '- Prefer rollback over deletion when a valid snapshot exists.',
    '- Keep candidate installation separate from installed package lifecycle changes.',
  ].join('\n');
}

export const SkillPackageManagerStrip: React.FC<{
  cwd?: string;
  error?: string | null;
  maxVisible?: number;
  onUseAsGoal?: (goal: string) => void;
  summary?: SkillPackageManagerSummary | null;
}> = ({ cwd, error = null, maxVisible = 3, onUseAsGoal, summary }) => {
  const { t } = useTranslation();
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleFeedback, setLifecycleFeedback] = useState<string | null>(null);
  const [loadedSummary, setLoadedSummary] = useState<SkillPackageManagerSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [patchDrafts, setPatchDrafts] = useState<Record<string, { newText: string; oldText: string }>>({});
  const [reviewerName, setReviewerName] = useState('');
  const [updatingSkillKey, setUpdatingSkillKey] = useState<string | null>(null);
  const goalDraft = useMemo(() => buildSkillPackageManagerGoal(), []);
  const visibleSummary = summary !== undefined ? summary : loadedSummary;
  const visibleError = error ?? loadError;
  const visiblePackages = visibleSummary?.packages.slice(0, Math.max(0, maxVisible)) ?? [];

  useEffect(() => {
    if (summary !== undefined) return;
    const api = getSkillPackageManagerApi();
    if (!api?.list) return;
    let cancelled = false;

    void api
      .list({ cwd, limit: 6 })
      .then((result) => {
        if (cancelled) return;
        setLoadedSummary(result);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedSummary(null);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, summary]);

  const handlePackageAction = async (
    skill: SkillPackageManagerEntry,
    action: SkillPackageReviewAction,
  ) => {
    const approvedBy = reviewerName.trim();
    if (!approvedBy) {
      setLifecycleError(t('fleet.skillPackage.reviewerRequired', 'Reviewer is required.'));
      setLifecycleFeedback(null);
      return;
    }

    const api = getSkillPackageManagerApi();
    const deletePackage = api?.delete;
    const lifecycle = api?.lifecycle;
    const list = api?.list;
    const patch = api?.patch;
    const rollback = api?.rollback;
    const reset = api?.reset;
    const update = api?.update;
    if (
      (action === 'delete' && !deletePackage)
      || (action === 'patch' && !patch)
      || (action === 'rollback' && !rollback)
      || (action === 'reset' && !reset)
      || (action === 'update' && !update)
      || (
        action !== 'delete'
        && action !== 'patch'
        && action !== 'rollback'
        && action !== 'reset'
        && action !== 'update'
        && !lifecycle
      )
    ) {
      onUseAsGoal?.(buildSkillLifecycleGoal(skill.name, action, approvedBy));
      return;
    }

    const updateKey = `${skill.name}:${action}`;
    setUpdatingSkillKey(updateKey);
    setLifecycleError(null);
    setLifecycleFeedback(null);

    try {
      let result: {
        deletedName?: string;
        error?: string;
        ok: boolean;
        package?: SkillPackageManagerEntry;
        summary?: SkillPackageManagerSummary;
      };

      if (action === 'delete') {
        result = await deletePackage!({
          approvedBy,
          cwd,
          name: skill.name,
        });
      } else if (action === 'patch') {
        const draft = patchDrafts[skill.name] ?? { newText: '', oldText: '' };
        if (draft.oldText.length === 0) {
          setLifecycleError(t('fleet.skillPackage.patchOldTextRequired', 'Old text is required.'));
          return;
        }
        result = await patch!({
          approvedBy,
          cwd,
          expectedReplacements: 1,
          name: skill.name,
          newText: draft.newText,
          oldText: draft.oldText,
        });
      } else if (action === 'rollback') {
        result = await rollback!({
          approvedBy,
          cwd,
          name: skill.name,
        });
      } else if (action === 'reset') {
        result = await reset!({
          approvedBy,
          cwd,
          name: skill.name,
        });
      } else if (action === 'update') {
        result = await update!({
          approvedBy,
          cwd,
          name: skill.name,
        });
      } else {
        result = await lifecycle!({
          action,
          approvedBy,
          cwd,
          name: skill.name,
        });
      }
      if (!result.ok) {
        setLifecycleError(result.error ?? t('fleet.skillPackage.lifecycleFailed', 'Lifecycle update failed.'));
        return;
      }

      setLifecycleFeedback(
        t('fleet.skillPackage.lifecycleFeedback', '{{action}} {{skill}} by {{reviewer}}.', {
          action,
          reviewer: approvedBy,
          skill: ('deletedName' in result ? result.deletedName : result.package?.name) ?? skill.name,
        })
      );

      if (summary === undefined) {
        if (result.summary) {
          setLoadedSummary(result.summary);
        } else if (list) {
          const refreshed = await list({ cwd, limit: 6 });
          setLoadedSummary(refreshed);
        }
      }
    } catch (lifecycleErrorValue: unknown) {
      setLifecycleError(
        lifecycleErrorValue instanceof Error ? lifecycleErrorValue.message : String(lifecycleErrorValue)
      );
    } finally {
      setUpdatingSkillKey(null);
    }
  };

  const updatePatchDraft = (
    skillName: string,
    key: 'newText' | 'oldText',
    value: string,
  ) => {
    setPatchDrafts((current) => ({
      ...current,
      [skillName]: {
        newText: current[skillName]?.newText ?? '',
        oldText: current[skillName]?.oldText ?? '',
        [key]: value,
      },
    }));
  };

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-skill-package-manager"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <PackageOpen size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.skillPackage.title', 'Skill package manager')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
          {t('fleet.skillPackage.countChip', '{{count}} installed', {
            count: visibleSummary?.installedCount ?? 0,
          })}
        </span>
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
        <input
          aria-label={t('fleet.skillPackage.reviewerLabel', 'Reviewer')}
          className="min-w-0 flex-1 rounded border border-border-muted bg-surface px-2 py-1 text-[10px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
          data-testid="skill-package-reviewer-input"
          onChange={(event) => setReviewerName(event.target.value)}
          placeholder={t('fleet.skillPackage.reviewerPlaceholder', 'Reviewer')}
          type="text"
          value={reviewerName}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          {t('fleet.skillPackage.enabledChip', '{{count}} enabled', {
            count: visibleSummary?.enabledCount ?? 0,
          })}
        </span>
        <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          {t('fleet.skillPackage.disabledChip', '{{count}} inactive', {
            count: visibleSummary?.disabledCount ?? 0,
          })}
        </span>
        <span className="flex items-center gap-1 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          <History size={9} />
          {t('fleet.skillPackage.rollbackChip', '{{count}} rollback snapshots', {
            count: visibleSummary?.rollbackableCount ?? 0,
          })}
        </span>
        {visibleSummary?.health ? (
          <span
            className={`rounded px-1 py-0.5 text-[9px] ${
              visibleSummary.health.ok
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning'
            }`}
          >
            {t('fleet.skillPackage.healthChip', '{{issues}} issues', {
              issues: visibleSummary.health.issueCount,
            })}
          </span>
        ) : null}
      </div>

      {visibleSummary?.health && !visibleSummary.health.ok ? (
        <div className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          <AlertCircle size={10} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            {t('fleet.skillPackage.healthWarning', '{{missing}} missing / {{mismatch}} mismatch / {{temp}} temp stale. Next: {{command}}', {
              command: visibleSummary.health.nextCommand,
              mismatch: visibleSummary.health.integrityMismatchCount,
              missing: visibleSummary.health.missingFileCount,
              temp: visibleSummary.health.staleTempMissingCount ?? 0,
            })}
          </span>
        </div>
      ) : null}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-secondary">
        <ShieldCheck size={10} className="shrink-0 text-accent" />
        <span className="line-clamp-2">
          {t(
            'fleet.skillPackage.guardrail',
            'Lifecycle changes stay review-gated: use skill_manage with approved_by before enabling, disabling, patching, rolling back, resetting or deleting skills.'
          )}
        </span>
      </div>

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.skillPackage.loadFailed', 'Skill package load failed')}: {visibleError}
        </div>
      )}

      {lifecycleError ? (
        <div className="mt-1.5 flex items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          <AlertCircle size={10} className="mt-0.5 shrink-0" />
          <span>{lifecycleError}</span>
        </div>
      ) : null}

      {lifecycleFeedback ? (
        <div className="mt-1.5 flex items-start gap-1.5 rounded border border-success/30 bg-success/10 px-2 py-1 text-[10px] text-success">
          <CheckCircle2 size={10} className="mt-0.5 shrink-0" />
          <span>{lifecycleFeedback}</span>
        </div>
      ) : null}

      {visiblePackages.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {visiblePackages.map((skill) => {
            const patchDraft = patchDrafts[skill.name] ?? { newText: '', oldText: '' };
            const hasPatchPreview = patchDraft.oldText.length > 0 || patchDraft.newText.length > 0;

            return (
              <li key={skill.name} className="min-w-0 rounded bg-surface/80 px-2 py-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[10px] text-text-secondary">
                  {skill.name}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                    v{skill.version}
                  </span>
                  <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                    {skill.status}
                  </span>
                </div>
              </div>
              <div className="mt-0.5 truncate text-[9px] text-text-muted">
                {skill.source}
                {!skill.exists
                  ? ' - missing SKILL.md'
                  : skill.integrityOk
                    ? ' - integrity ok'
                    : ' - integrity warning'}
                {skill.rollbackableCount > 0 ? ` - ${skill.rollbackableCount} rollback` : ''}
                {skill.staleTempPath ? ' - temp stale' : ''}
                {typeof skill.invocationCount === 'number'
                  ? ` - ${skill.invocationCount} run(s)`
                  : ''}
              </div>
              {skill.firewallVerdict ? (
                <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                  <span
                    className={`flex items-center gap-1 rounded px-1 py-0.5 ${firewallToneClass(skill.firewallVerdict)}`}
                    title={skill.firewallSummary}
                  >
                    <ShieldCheck size={9} />
                    {t('fleet.skillPackage.firewallVerdict', 'Firewall {{verdict}} {{score}}/100', {
                      score: typeof skill.firewallScore === 'number' ? skill.firewallScore : '?',
                      verdict: skill.firewallVerdict,
                    })}
                  </span>
                  {typeof skill.firewallFindingCount === 'number' && skill.firewallFindingCount > 0 ? (
                    <span className="rounded bg-warning/10 px-1 py-0.5 text-warning">
                      {t('fleet.skillPackage.firewallFindings', '{{count}} findings', {
                        count: skill.firewallFindingCount,
                      })}
                    </span>
                  ) : null}
                  {skill.firewallCapabilities && skill.firewallCapabilities.length > 0 ? (
                    <span
                      className="max-w-full truncate rounded bg-surface px-1 py-0.5 text-text-muted"
                      title={skill.firewallCapabilities.join(', ')}
                    >
                      {formatFirewallCapabilities(skill.firewallCapabilities)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {skill.contentPreview ? (
                <pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap rounded bg-surface px-2 py-1 text-[9px] leading-snug text-text-muted">
                  {skill.contentPreview}
                  {skill.contentPreviewTruncated ? '...' : ''}
                </pre>
              ) : null}
              {skill.exists ? (
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  <textarea
                    aria-label={t('fleet.skillPackage.patchOldText', 'Old text')}
                    className="min-h-14 resize-y rounded border border-border-muted bg-surface px-2 py-1 text-[9px] leading-snug text-text-secondary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
                    data-testid={`skill-package-patch-old-${skill.name}`}
                    onChange={(event) => updatePatchDraft(skill.name, 'oldText', event.target.value)}
                    placeholder={t('fleet.skillPackage.patchOldText', 'Old text')}
                    value={patchDraft.oldText}
                  />
                  <textarea
                    aria-label={t('fleet.skillPackage.patchNewText', 'New text')}
                    className="min-h-14 resize-y rounded border border-border-muted bg-surface px-2 py-1 text-[9px] leading-snug text-text-secondary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
                    data-testid={`skill-package-patch-new-${skill.name}`}
                    onChange={(event) => updatePatchDraft(skill.name, 'newText', event.target.value)}
                    placeholder={t('fleet.skillPackage.patchNewText', 'New text')}
                    value={patchDraft.newText}
                  />
                </div>
              ) : null}
              {hasPatchPreview ? (
                <div
                  className="mt-1 rounded border border-border-muted bg-surface px-2 py-1"
                  data-testid={`skill-package-patch-preview-${skill.name}`}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2 text-[9px] text-text-muted">
                    <span>{t('fleet.skillPackage.patchPreview', 'Patch preview')}</span>
                    <span>{t('fleet.skillPackage.patchReplacementCount', '1 exact replacement')}</span>
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap text-[9px] leading-snug">
                    <span className="text-warning">
                      - {patchDraft.oldText || t('fleet.skillPackage.emptyOldText', 'empty old text')}
                    </span>
                    {'\n'}
                    <span className="text-success">
                      + {patchDraft.newText || t('fleet.skillPackage.emptyNewText', 'empty new text')}
                    </span>
                  </pre>
                </div>
              ) : null}
              {(skill.lastLifecycleReviewer || skill.lastLifecycleReason) ? (
                <div className="mt-0.5 truncate text-[9px] text-text-muted">
                  {skill.lastLifecycleReviewer ? `${skill.lastLifecycleReviewer}: ` : ''}
                  {skill.lastLifecycleReason ?? ''}
                </div>
              ) : null}
              {skill.lastError ? (
                <div className="mt-0.5 truncate text-[9px] text-warning">
                  {skill.lastError}
                </div>
              ) : null}
              <div className="mt-1 flex flex-wrap justify-end gap-1">
                {skill.status !== 'active' ? (
                  <LifecycleButton
                    action="enable"
                    disabled={!reviewerName.trim() || updatingSkillKey !== null}
                    icon={PlayCircle}
                    loading={updatingSkillKey === `${skill.name}:enable`}
                    onClick={() => void handlePackageAction(skill, 'enable')}
                  />
                ) : null}
                {skill.enabled ? (
                  <LifecycleButton
                    action="disable"
                    disabled={!reviewerName.trim() || updatingSkillKey !== null}
                    icon={PauseCircle}
                    loading={updatingSkillKey === `${skill.name}:disable`}
                    onClick={() => void handlePackageAction(skill, 'disable')}
                  />
                ) : null}
                {skill.status !== 'deprecated' ? (
                  <LifecycleButton
                    action="deprecate"
                    disabled={!reviewerName.trim() || updatingSkillKey !== null}
                    icon={Archive}
                    loading={updatingSkillKey === `${skill.name}:deprecate`}
                    onClick={() => void handlePackageAction(skill, 'deprecate')}
                  />
                ) : null}
                {skill.rollbackableCount > 0 ? (
                  <LifecycleButton
                    action="rollback"
                    disabled={!reviewerName.trim() || updatingSkillKey !== null}
                    icon={RotateCcw}
                    loading={updatingSkillKey === `${skill.name}:rollback`}
                    onClick={() => void handlePackageAction(skill, 'rollback')}
                  />
                ) : null}
                {!skill.exists || !skill.integrityOk ? (
                  <LifecycleButton
                    action="reset"
                    disabled={!reviewerName.trim() || updatingSkillKey !== null}
                    icon={RotateCw}
                    loading={updatingSkillKey === `${skill.name}:reset`}
                    onClick={() => void handlePackageAction(skill, 'reset')}
                  />
                ) : null}
                {skill.exists ? (
                  <LifecycleButton
                    action="patch"
                    disabled={
                      !reviewerName.trim()
                      || updatingSkillKey !== null
                      || !(patchDraft.oldText.length)
                    }
                    icon={PencilLine}
                    loading={updatingSkillKey === `${skill.name}:patch`}
                    onClick={() => void handlePackageAction(skill, 'patch')}
                  />
                ) : null}
                {skill.exists ? (
                  <LifecycleButton
                    action="update"
                    disabled={!reviewerName.trim() || updatingSkillKey !== null}
                    icon={RefreshCw}
                    loading={updatingSkillKey === `${skill.name}:update`}
                    onClick={() => void handlePackageAction(skill, 'update')}
                  />
                ) : null}
                <LifecycleButton
                  action="delete"
                  disabled={!reviewerName.trim() || updatingSkillKey !== null}
                  icon={Trash2}
                  loading={updatingSkillKey === `${skill.name}:delete`}
                  onClick={() => void handlePackageAction(skill, 'delete')}
                />
              </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <ListChecks size={10} className="shrink-0 text-text-muted" />
          <span className="truncate">
            {t('fleet.skillPackage.empty', 'No installed workspace skills yet.')}
          </span>
        </div>
      )}

      <ul className="mt-1.5 space-y-1">
        {(visibleSummary?.reviewCommands ?? ['buddy skills list --all --json']).slice(0, 3).map((command) => (
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
            <PackageOpen size={10} />
            {t('fleet.skillPackage.useAsGoal', 'Manage skills as goal')}
          </button>
        </div>
      )}
    </section>
  );
};

function firewallToneClass(verdict: SkillPackageFirewallVerdict): string {
  if (verdict === 'allow') return 'bg-success/10 text-success';
  if (verdict === 'review') return 'bg-warning/10 text-warning';
  return 'bg-warning/20 text-warning';
}

function formatFirewallCapabilities(capabilities: SkillPackageFirewallCapability[]): string {
  return capabilities.slice(0, 3).join(', ')
    + (capabilities.length > 3 ? ` +${capabilities.length - 3}` : '');
}

function getSkillPackageManagerApi(): SkillPackageManagerApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          skillPackage?: SkillPackageManagerApi;
        };
      };
    }
  ).electronAPI?.tools?.skillPackage;
}

type SkillPackageReviewAction =
  | 'enable'
  | 'disable'
  | 'deprecate'
  | 'rollback'
  | 'reset'
  | 'delete'
  | 'update'
  | 'patch';

const LifecycleButton: React.FC<{
  action: SkillPackageReviewAction;
  disabled: boolean;
  icon: LucideIcon;
  loading: boolean;
  onClick: () => void;
}> = ({ action, disabled, icon: Icon, loading, onClick }) => (
  <button
    className="flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-[10px] text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
    data-testid={`skill-package-${action}`}
    disabled={disabled}
    onClick={onClick}
    type="button"
  >
    {loading ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
    {action}
  </button>
);

function buildSkillLifecycleGoal(
  skillName: string,
  action: SkillPackageReviewAction,
  approvedBy: string,
): string {
  return [
    `Apply the reviewed ${action} lifecycle action to skill ${skillName}.`,
    '',
    'Use the review-gated command:',
    `- skill_manage action=${action} name=${skillName} approved_by=${formatReviewerForCommand(approvedBy)}`,
  ].join('\n');
}

function formatReviewerForCommand(value: string): string {
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : JSON.stringify(value);
}
