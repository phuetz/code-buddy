/**
 * SkillsManagerPage — full-page Hermes skills parity surface for Cowork.
 *
 * The cockpit (FleetCommandCenter) only exposes compact 3-item "strips" for the
 * installed skill-package lifecycle and the candidate review queue. This page is
 * the daily-operations equivalent: it aggregates both surfaces full-height so a
 * reviewer can see every installed skill (status / integrity / SKILL.md preview /
 * rollback snapshots) and every materialized candidate (with side-by-side diffs)
 * in one view, and run every review-gated action exposed by the existing bridges
 * (install/overwrite/enable/disable/deprecate/rollback/reset/delete/update/patch).
 *
 * It owns NO skill business logic: it re-uses {@link SkillPackageManagerStrip} and
 * {@link SkillCandidateReviewQueueStrip}, which call the `tools.skillPackage.*` and
 * `tools.skillCandidate.*` IPC bridges. The page only loads the full installed
 * summary (high `limit`) so the lifecycle strip can render the complete list
 * instead of the cockpit's 3-item cap.
 *
 * Trigger: Cmd/Ctrl+Shift+K, the command palette ("Skills Manager"), or the
 * store flag `showSkillsManager`. Mounted from App.tsx via SkillsManagerWrapper.
 *
 * @module renderer/components/skills-manager-page
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, PackageOpen, RefreshCw, X } from 'lucide-react';

import { useAppStore } from '../store';
import { ScreenHelpButton } from './ScreenHelpButton';
import {
  SkillPackageManagerStrip,
  type SkillPackageManagerSummary,
} from './skill-package-manager-strip';
import { SkillCandidateReviewQueueStrip } from './skill-candidate-review-queue-strip';

const FULL_LIST_LIMIT = 100;

interface SkillsManagerPageProps {
  onClose: () => void;
  /** Optional override; defaults to the active session / working directory. */
  cwd?: string;
  /** Optional goal hand-off (mirrors the cockpit strips' "use as goal"). */
  onUseAsGoal?: (goal: string) => void;
}

interface SkillPackageManagerApi {
  list?: (options?: {
    cwd?: string;
    limit?: number;
  }) => Promise<SkillPackageManagerSummary | null>;
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

export function SkillsManagerPage({ onClose, cwd, onUseAsGoal }: SkillsManagerPageProps): JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workingDir = useAppStore((s) => s.workingDir);

  const activeWorkspaceCwd = useMemo(
    () =>
      cwd ??
      sessions.find((session) => session.id === activeSessionId)?.cwd ??
      workingDir ??
      undefined,
    [cwd, activeSessionId, sessions, workingDir],
  );

  const [summary, setSummary] = useState<SkillPackageManagerSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getSkillPackageManagerApi();
      if (!api?.list) {
        if (!cancelled) {
          setSummary(null);
          setLoadError(null);
        }
        return;
      }
      setLoading(true);
      try {
        const result = await api.list({ cwd: activeWorkspaceCwd, limit: FULL_LIST_LIMIT });
        if (cancelled) return;
        setSummary(result);
        setLoadError(null);
      } catch (error: unknown) {
        if (cancelled) return;
        setSummary(null);
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceCwd, refreshToken]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const installedCount = summary?.installedCount ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      data-testid="skills-manager-page"
    >
      <header className="flex items-center justify-between border-b border-border-muted px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <PackageOpen size={16} className="shrink-0 text-accent" />
          <h1 className="truncate text-sm font-semibold text-text-primary">
            {t('skillsManager.title', 'Skills Manager')}
          </h1>
          <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
            {t('skillsManager.installedChip', '{{count}} installed', { count: installedCount })}
          </span>
          {activeWorkspaceCwd ? (
            <span className="truncate text-[10px] text-text-muted" title={activeWorkspaceCwd}>
              {activeWorkspaceCwd}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ScreenHelpButton screenId="skills" />
          <button
            type="button"
            data-testid="skills-manager-refresh"
            onClick={() => setRefreshToken((value) => value + 1)}
            className="flex h-7 items-center gap-1 rounded-md border border-border-muted px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {t('skillsManager.refresh', 'Refresh')}
          </button>
          <button
            type="button"
            data-testid="skills-manager-close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover"
            aria-label={t('skillsManager.close', 'Close')}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-3 text-[11px] leading-relaxed text-text-muted">
          {t(
            'skillsManager.subtitle',
            'Review installed SKILL.md packages and the candidate queue. All lifecycle actions stay review-gated: enter a reviewer name before enabling, disabling, deprecating, rolling back, resetting, patching, updating, deleting or installing a skill.',
          )}
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <section data-testid="skills-manager-installed">
            <h2 className="mb-1 text-[10px] uppercase tracking-wider text-text-secondary">
              {t('skillsManager.installedSection', 'Installed skills')}
            </h2>
            <SkillPackageManagerStrip
              cwd={activeWorkspaceCwd}
              error={loadError}
              maxVisible={FULL_LIST_LIMIT}
              onLifecycleComplete={() => setRefreshToken((value) => value + 1)}
              onUseAsGoal={onUseAsGoal}
              summary={summary}
            />
          </section>

          <section data-testid="skills-manager-candidates">
            <h2 className="mb-1 text-[10px] uppercase tracking-wider text-text-secondary">
              {t('skillsManager.candidatesSection', 'Candidate review queue')}
            </h2>
            <SkillCandidateReviewQueueStrip
              cwd={activeWorkspaceCwd}
              maxVisible={FULL_LIST_LIMIT}
              onInstalled={() => setRefreshToken((value) => value + 1)}
              onUseAsGoal={onUseAsGoal}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Reactive wrapper so the page mounts/unmounts off the `showSkillsManager`
 * store flag, mirroring {@link FleetCommandCenterWrapper} in App.tsx.
 */
export function SkillsManagerWrapper(): JSX.Element | null {
  const open = useAppStore((s) => s.showSkillsManager);
  const close = useAppStore((s) => s.setShowSkillsManager);
  if (!open) return null;
  return <SkillsManagerPage onClose={() => close(false)} />;
}
