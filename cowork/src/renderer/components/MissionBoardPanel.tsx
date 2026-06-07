/**
 * MissionBoardPanel - dedicated companion mission surface.
 *
 * Shows the persisted companion mission backlog through the existing
 * `companion.missions.*` preload bridge. This is a UI surface only: the
 * renderer never writes mission files directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock3, ListChecks, Loader2, Play, RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../store';
import { dialogA11yProps, trapFocus } from '../utils/a11y';
import type {
  CompanionMission,
  CompanionMissionBoard,
  CompanionMissionRunResult,
  CompanionMissionStatus,
  MissionRuntime,
  MissionRuntimeEvent,
} from '../types';

interface MissionBoardPanelProps {
  onClose: () => void;
}

type CompanionMissionApi = NonNullable<Window['electronAPI']>['companion'];
type MissionRuntimeApi = NonNullable<Window['electronAPI']>['missions'];
type RuntimeSubTask = MissionRuntime['subTasks'][number];

const COLUMNS: Array<{ status: CompanionMissionStatus; labelKey: string; fallback: string }> = [
  { status: 'open', labelKey: 'missionBoard.status.open', fallback: 'Open' },
  { status: 'in_progress', labelKey: 'missionBoard.status.inProgress', fallback: 'In progress' },
  { status: 'done', labelKey: 'missionBoard.status.done', fallback: 'Done' },
  { status: 'dismissed', labelKey: 'missionBoard.status.dismissed', fallback: 'Dismissed' },
];

const PRIORITY_WEIGHT: Record<CompanionMission['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

function getCompanionMissionApi(): CompanionMissionApi | undefined {
  return window.electronAPI?.companion;
}

function getMissionRuntimeApi(): MissionRuntimeApi | undefined {
  return window.electronAPI?.missions;
}

function formatDate(value: string | undefined): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

function sortMissions(missions: CompanionMission[]): CompanionMission[] {
  return [...missions].sort((a, b) => {
    const priorityDelta = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

function missionProgress(missions: CompanionMission[]): number {
  if (missions.length === 0) return 0;
  const completed = missions.filter((mission) => mission.status === 'done').length;
  return Math.round((completed / missions.length) * 100);
}

function sortRuntimeMissions(missions: MissionRuntime[]): MissionRuntime[] {
  return [...missions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function runtimeTaskProgress(mission: MissionRuntime): { completed: number; total: number } {
  return {
    completed: mission.subTasks.filter((subTask) => subTask.status === 'completed').length,
    total: mission.subTasks.length,
  };
}

function latestRuntimeEvents(events: MissionRuntimeEvent[] | undefined): MissionRuntimeEvent[] {
  return [...(events ?? [])].slice(-2).reverse();
}

export function MissionBoardPanel({ onClose }: MissionBoardPanelProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const workingDir = useAppStore((s) => s.workingDir);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const missionRuntime = useAppStore((s) => s.missionRuntime);
  const missionRuntimeEvents = useAppStore((s) => s.missionRuntimeEvents);
  const missionRuntimeHeartbeats = useAppStore((s) => s.missionRuntimeHeartbeats);
  const upsertMissionRuntime = useAppStore((s) => s.upsertMissionRuntime);
  const cwd = useMemo(
    () => sessions.find((session) => session.id === activeSessionId)?.cwd ?? workingDir ?? undefined,
    [activeSessionId, sessions, workingDir]
  );
  const runtimeMissions = useMemo(() => sortRuntimeMissions(Object.values(missionRuntime)), [missionRuntime]);

  const [board, setBoard] = useState<CompanionMissionBoard | null>(null);
  const [missions, setMissions] = useState<CompanionMission[]>([]);
  const [runResult, setRunResult] = useState<CompanionMissionRunResult | null>(null);
  const [readySubTasksByMission, setReadySubTasksByMission] = useState<Record<string, RuntimeSubTask[]>>({});
  const [readySubTaskLoadingId, setReadySubTaskLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (dialogRef.current) return trapFocus(dialogRef.current);
    return undefined;
  }, []);

  const refresh = useCallback(async () => {
    const companionApi = getCompanionMissionApi();
    const runtimeApi = getMissionRuntimeApi();
    if (!companionApi && !runtimeApi) {
      setError('Mission bridges are not available.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const errors: string[] = [];
      if (companionApi) {
        try {
          const result = await companionApi.listMissions();
          if (!result.ok) throw new Error(result.error ?? 'Failed to load missions.');
          setBoard(result.board ?? null);
          setMissions(sortMissions(result.items ?? []));
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      } else {
        setBoard(null);
        setMissions([]);
      }

      if (runtimeApi) {
        try {
          const result = await runtimeApi.list();
          if (!result.ok) throw new Error(result.error ?? 'Failed to load runtime missions.');
          for (const mission of result.missions ?? []) {
            upsertMissionRuntime(mission);
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      setError(errors.length > 0 ? errors.join(' ') : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [upsertMissionRuntime]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = async (action: string, callback: (api: CompanionMissionApi) => Promise<void>) => {
    const api = getCompanionMissionApi();
    if (!api) return;
    setBusyAction(action);
    setError(null);
    try {
      await callback(api);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const syncMissions = () =>
    runAction('sync', async (api) => {
      const result = await api.syncMissions({ recordSuggestions: true });
      if (!result.ok) throw new Error(result.error ?? 'Mission sync failed.');
      setBoard(result.result?.board ?? null);
      setMissions(sortMissions(result.result?.board.missions ?? []));
      setRunResult(null);
    });

  const prepareNextMission = () =>
    runAction('prepareNext', async (api) => {
      const result = await api.runNextMission({ dryRun: true });
      if (!result.ok) throw new Error(result.error ?? 'Mission preparation failed.');
      setRunResult(result.result ?? null);
      if (result.result?.board) {
        setBoard(result.result.board);
        setMissions(sortMissions(result.result.board.missions));
      }
    });

  const updateMissionStatus = (missionId: string, status: CompanionMissionStatus) =>
    runAction(`mission:${missionId}:${status}`, async (api) => {
      const result = await api.updateMission({ missionId, status });
      if (!result.ok) throw new Error(result.error ?? 'Mission update failed.');
    });

  const inspectReadySubTasks = useCallback(async (missionId: string) => {
    const api = getMissionRuntimeApi();
    if (!api) {
      setError('Mission runtime bridge is not available.');
      return;
    }

    setReadySubTaskLoadingId(missionId);
    setError(null);
    try {
      const result = await api.readySubTasks(missionId);
      if (!result.ok) throw new Error(result.error ?? 'Failed to inspect ready sub-tasks.');
      setReadySubTasksByMission((current) => ({
        ...current,
        [missionId]: result.subTasks ?? [],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReadySubTaskLoadingId(null);
    }
  }, []);

  const progress = missionProgress(missions);
  const activeCount = missions.filter((mission) => mission.status === 'in_progress').length;
  const openCount = missions.filter((mission) => mission.status === 'open').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        data-testid="mission-board-panel"
        {...dialogA11yProps(t('missionBoard.title', 'Mission Board'))}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <ClipboardList className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text-primary">{t('missionBoard.title', 'Mission Board')}</h2>
              <p className="truncate text-xs text-text-muted">
                {board?.storePath ?? cwd ?? t('missionBoard.noWorkspace', 'No active workspace')}
              </p>
            </div>
          </div>
          <button
            aria-label={t('common.close', 'Close')}
            className="rounded p-1 text-text-muted hover:bg-surface hover:text-text-primary"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <button
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-50"
            data-testid="mission-board-refresh"
            disabled={busyAction !== null}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {t('missionBoard.refresh', 'Refresh')}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-50"
            data-testid="mission-board-sync"
            disabled={busyAction !== null}
            onClick={() => void syncMissions()}
            type="button"
          >
            <ClipboardList size={13} />
            {busyAction === 'sync' ? t('missionBoard.syncing', 'Syncing...') : t('missionBoard.sync', 'Sync missions')}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            data-testid="mission-board-prepare-next"
            disabled={busyAction !== null}
            onClick={() => void prepareNextMission()}
            title={t('missionBoard.prepareNextTitle', 'Prepare the next mission as a dry run.')}
            type="button"
          >
            <Play size={13} />
            {busyAction === 'prepareNext'
              ? t('missionBoard.preparing', 'Preparing...')
              : t('missionBoard.prepareNext', 'Prepare next')}
          </button>
          <div className="ml-auto flex min-w-0 items-center gap-2 text-[11px] text-text-muted">
            <span className="rounded border border-border bg-surface px-2 py-1">
              {t('missionBoard.openCount', '{{count}} open', { count: openCount })}
            </span>
            <span className="rounded border border-border bg-surface px-2 py-1">
              {t('missionBoard.activeCount', '{{count}} active', { count: activeCount })}
            </span>
            <span className="rounded border border-border bg-surface px-2 py-1">
              {t('missionBoard.progress', '{{count}}% done', { count: progress })}
            </span>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
            <AlertTriangle size={13} className="shrink-0" />
            {error}
          </div>
        ) : null}

        {runResult ? (
          <div className="border-b border-border bg-surface/40 px-4 py-3" data-testid="mission-board-run-result">
            <div className="flex items-center gap-2">
              {runResult.success ? (
                <CheckCircle2 className="h-4 w-4 text-accent" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning" />
              )}
              <span className="text-sm font-medium text-text-primary">{runResult.message}</span>
              <span className="rounded bg-background px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                {runResult.dryRun ? t('missionBoard.dryRun', 'dry run') : t('missionBoard.live', 'live')}
              </span>
            </div>
            {runResult.mission && (
              <p className="mt-1 text-xs text-text-secondary">
                [{runResult.mission.priority}] {runResult.mission.title}
              </p>
            )}
          </div>
        ) : null}

        <div className="flex-1 overflow-auto px-4 py-3">
          {runtimeMissions.length > 0 ? (
            <section
              className="mb-3 rounded border border-border-muted bg-surface/30 p-3"
              data-testid="mission-runtime-section"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t('missionBoard.runtime.title', 'Live runtime')}
                </h3>
                <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                  {t('missionBoard.runtime.count', '{{count}} tracked', { count: runtimeMissions.length })}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {runtimeMissions.map((mission) => (
                  <RuntimeMissionCard
                    key={mission.id}
                    events={missionRuntimeEvents[mission.id] ?? mission.events}
                    heartbeat={missionRuntimeHeartbeats[mission.id]}
                    mission={mission}
                    onInspectReady={inspectReadySubTasks}
                    readyLoading={readySubTaskLoadingId === mission.id}
                    readySubTasks={readySubTasksByMission[mission.id]}
                    t={t}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t('missionBoard.loading', 'Loading missions...')}
            </div>
          ) : missions.length === 0 ? (
            <div
              className="rounded border border-border bg-surface/35 px-3 py-8 text-center text-sm text-text-muted"
              data-testid="mission-board-empty"
            >
              {t(
                'missionBoard.empty',
                'No missions yet. Sync missions after a competitive radar run to create the backlog.'
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {COLUMNS.map((column) => {
                const columnMissions = missions.filter((mission) => mission.status === column.status);
                return (
                  <section
                    key={column.status}
                    className="flex min-h-[180px] flex-col rounded border border-border-muted bg-surface/40 p-2"
                    data-testid={`mission-column-${column.status}`}
                  >
                    <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-text-muted">
                      <span>{t(column.labelKey, column.fallback)}</span>
                      <span className="rounded bg-background px-1.5 py-0.5">{columnMissions.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {columnMissions.map((mission) => (
                        <MissionCard
                          key={mission.id}
                          busy={busyAction !== null}
                          mission={mission}
                          onStatus={updateMissionStatus}
                          t={t}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RuntimeMissionCard({
  events,
  heartbeat,
  mission,
  onInspectReady,
  readyLoading,
  readySubTasks,
  t,
}: {
  events?: MissionRuntimeEvent[];
  heartbeat?: string;
  mission: MissionRuntime;
  onInspectReady: (missionId: string) => void;
  readyLoading: boolean;
  readySubTasks?: RuntimeSubTask[];
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string;
}) {
  const tasks = runtimeTaskProgress(mission);
  const recentEvents = latestRuntimeEvents(events);
  return (
    <article
      className="rounded border border-border bg-background/70 p-3"
      data-testid={`mission-runtime-card-${mission.id}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
          {mission.status}
        </span>
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
          {t('missionBoard.runtime.progress', '{{count}}%', { count: mission.progress })}
        </span>
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
          {t('missionBoard.runtime.tasks', '{{completed}}/{{total}} tasks', tasks)}
        </span>
      </div>
      <h3 className="mt-2 line-clamp-2 text-xs font-semibold text-text-primary">{mission.title}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{mission.description}</p>
      {recentEvents.length > 0 ? (
        <ul className="mt-2 space-y-1" data-testid={`mission-runtime-events-${mission.id}`}>
          {recentEvents.map((event) => (
            <li key={`${event.ts}:${event.type}:${event.message}`} className="truncate text-[10px] text-text-muted">
              <span className="font-medium text-text-secondary">{event.type}</span> {event.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center gap-1 text-[10px] text-text-muted">
        <Clock3 className="h-3 w-3" />
        <span className="truncate">
          {heartbeat
            ? t('missionBoard.runtime.heartbeat', 'heartbeat {{value}}', { value: formatDate(heartbeat) })
            : formatDate(mission.updatedAt)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-primary hover:bg-surface disabled:opacity-50"
          data-testid={`mission-runtime-ready-${mission.id}`}
          disabled={readyLoading}
          onClick={() => onInspectReady(mission.id)}
          type="button"
        >
          {readyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListChecks className="h-3 w-3" />}
          {readyLoading
            ? t('missionBoard.runtime.inspectingReady', 'Inspecting...')
            : t('missionBoard.runtime.ready', 'Ready work')}
        </button>
      </div>
      {readySubTasks ? (
        <div
          className="mt-2 rounded border border-border-muted bg-surface/30 px-2 py-1.5"
          data-testid={`mission-runtime-ready-list-${mission.id}`}
        >
          {readySubTasks.length === 0 ? (
            <p className="text-[10px] text-text-muted">{t('missionBoard.runtime.noReady', 'No ready work')}</p>
          ) : (
            <ul className="space-y-1">
              {readySubTasks.map((subTask) => (
                <li key={subTask.id} className="truncate text-[10px] text-text-muted">
                  <span className="font-medium text-text-secondary">{subTask.status}</span> {subTask.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  );
}

function MissionCard({
  busy,
  mission,
  onStatus,
  t,
}: {
  busy: boolean;
  mission: CompanionMission;
  onStatus: (missionId: string, status: CompanionMissionStatus) => void;
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <article className="rounded border border-border bg-background/70 p-3" data-testid={`mission-card-${mission.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
          {mission.priority}
        </span>
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">{mission.dimension}</span>
        {mission.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
            {tag}
          </span>
        ))}
      </div>
      <h3 className="mt-2 line-clamp-2 text-xs font-semibold text-text-primary">{mission.title}</h3>
      <p className="mt-1 line-clamp-3 text-xs text-text-secondary">{mission.recommendation}</p>
      {mission.command ? (
        <code className="mt-2 block truncate rounded bg-surface px-1.5 py-1 text-[10px] text-text-muted">
          {mission.command}
        </code>
      ) : null}
      <div className="mt-2 flex items-center gap-1 text-[10px] text-text-muted">
        <Clock3 className="h-3 w-3" />
        <span className="truncate">{formatDate(mission.updatedAt)}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {mission.status === 'open' ? (
          <button
            className="rounded border border-border px-2 py-1 text-[10px] text-text-primary hover:bg-surface disabled:opacity-50"
            data-testid={`mission-start-${mission.id}`}
            disabled={busy}
            onClick={() => onStatus(mission.id, 'in_progress')}
            type="button"
          >
            {t('missionBoard.start', 'Start')}
          </button>
        ) : null}
        {mission.status === 'open' || mission.status === 'in_progress' ? (
          <button
            className="rounded border border-border px-2 py-1 text-[10px] text-text-primary hover:bg-surface disabled:opacity-50"
            data-testid={`mission-done-${mission.id}`}
            disabled={busy}
            onClick={() => onStatus(mission.id, 'done')}
            type="button"
          >
            {t('missionBoard.done', 'Done')}
          </button>
        ) : null}
        {mission.status !== 'dismissed' && mission.status !== 'done' ? (
          <button
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            data-testid={`mission-dismiss-${mission.id}`}
            disabled={busy}
            onClick={() => onStatus(mission.id, 'dismissed')}
            type="button"
          >
            {t('missionBoard.dismiss', 'Dismiss')}
          </button>
        ) : null}
        {mission.status === 'dismissed' || mission.status === 'done' ? (
          <button
            className="rounded border border-border px-2 py-1 text-[10px] text-text-primary hover:bg-surface disabled:opacity-50"
            data-testid={`mission-reopen-${mission.id}`}
            disabled={busy}
            onClick={() => onStatus(mission.id, 'open')}
            type="button"
          >
            {t('missionBoard.reopen', 'Reopen')}
          </button>
        ) : null}
      </div>
    </article>
  );
}
