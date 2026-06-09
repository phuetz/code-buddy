/**
 * AutonomyPanel — pilot the autonomous fleet from the GUI.
 *
 * Three layers:
 * 1. Daemon lifecycle — status of the always-on `codebuddy-autonomy` service
 *    with start/stop/restart, install/uninstall, and a one-shot "run a tick"
 *    that goes through the real CLI (`autonomy.daemonStatus` & friends IPC).
 * 2. Free-first model ladder — local → network → paid rungs and the model a
 *    tick would use right now (`autonomy.modelTier` IPC).
 * 3. Colab queue — the shared task queue (status + priority + claim + DAG
 *    deps), live presence, recent worklog (`autonomy.snapshot` IPC).
 * Mirrors the ReasoningTraceViewer/MemoryPanel shell.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Cpu,
  RefreshCw,
  Loader2,
  CheckCircle2,
  CircleDot,
  Ban,
  Play,
  Square,
  RotateCcw,
  Zap,
  Download,
  Trash2,
} from 'lucide-react';

interface ColabTaskView {
  id: string;
  title: string;
  status: string;
  priority: string;
  claimedBy?: string | null;
  dependsOn?: string[];
}
interface WorklogView {
  taskId?: string | null;
  agent?: string;
  summary?: string;
  date?: string;
}
interface PresenceView {
  status?: string;
  currentTask?: string | null;
}
interface Snapshot {
  ok: boolean;
  error?: string;
  dir: string | null;
  tasks: ColabTaskView[];
  worklog: WorklogView[];
  presence: Record<string, PresenceView>;
}
interface DaemonStatusView {
  ok: boolean;
  error?: string;
  serviceName: string;
  service: { installed: boolean; running: boolean; platform: string } | null;
  queueDir: string;
  manageCommand: string;
}
interface ModelTierView {
  ok: boolean;
  error?: string;
  ladder: Array<{
    tier: 'local' | 'network' | 'escalated';
    model: string;
    baseUrl?: string;
    paid: boolean;
    configured: boolean;
  }>;
  currentChoice?: { model: string; tier: string; paid: boolean; reason: string };
}
interface TickResultView {
  ok: boolean;
  error?: string;
  ticks?: number;
  outcomes?: Record<string, number>;
  stoppedReason?: string;
}

interface AutonomyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'text-error border-error/40',
  high: 'text-warning border-warning/40',
  medium: 'text-text-secondary border-border',
  low: 'text-text-muted border-border-muted',
};

// in_progress first (what's running now), then claimable, then done/blocked.
const STATUS_ORDER: { id: string; label: string; icon: typeof CircleDot }[] = [
  { id: 'in_progress', label: 'In progress', icon: Loader2 },
  { id: 'open', label: 'Queued', icon: CircleDot },
  { id: 'blocked', label: 'Blocked', icon: Ban },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
];

export function AutonomyPanel({ isOpen, onClose }: AutonomyPanelProps) {
  const { t } = useTranslation();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [daemon, setDaemon] = useState<DaemonStatusView | null>(null);
  const [tier, setTier] = useState<ModelTierView | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<TickResultView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      const result = api?.autonomy ? await api.autonomy.snapshot() : null;
      setSnap(result as Snapshot | null);
      if (api?.autonomy?.daemonStatus) {
        setDaemon((await api.autonomy.daemonStatus()) as DaemonStatusView);
      }
      if (api?.autonomy?.modelTier) {
        setTier((await api.autonomy.modelTier()) as ModelTierView);
      }
    } catch (err) {
      setSnap({ ok: false, error: String(err), dir: null, tasks: [], worklog: [], presence: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const runDaemonAction = useCallback(
    async (name: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusyAction(name);
      setActionError(null);
      try {
        const result = await action();
        if (!result.ok) setActionError(result.error ?? `${name} failed`);
      } catch (err) {
        setActionError(String(err));
      } finally {
        setBusyAction(null);
        void load();
      }
    },
    [load]
  );

  if (!isOpen) return null;

  const tasks = snap?.tasks ?? [];
  const presence = Object.entries(snap?.presence ?? {});
  const service = daemon?.service ?? null;
  const api = window.electronAPI;

  return (
    <div
      className="fixed right-0 top-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border shadow-2xl z-40 flex flex-col"
      data-testid="autonomy-panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-muted flex-shrink-0">
        <Cpu size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-primary">
          {t('autonomy.title', 'Autonomy')}
        </h2>
        <button
          onClick={() => void load()}
          className="ml-auto p-1 text-text-muted hover:text-text-primary"
          title={t('common.refresh', 'Refresh')}
          data-testid="autonomy-refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary"
          aria-label={t('common.close', 'Close')}
          title={t('common.close', 'Close')}
          data-testid="autonomy-panel-close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {/* Queue dir + status */}
        <p className="text-[10px] text-text-muted font-mono truncate" title={snap?.dir ?? ''}>
          {snap?.dir ?? t('common.loading', 'Loading…')}
        </p>
        {snap && !snap.ok && (
          <p className="text-[11px] text-error">{snap.error ?? t('autonomy.unavailable', 'Queue unavailable')}</p>
        )}

        {/* Daemon lifecycle */}
        <section data-testid="autonomy-daemon-section">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
            {t('autonomy.daemon', 'Always-on daemon')}
          </h3>
          <div className="p-2.5 rounded-lg bg-surface/40 border border-border-muted space-y-2">
            <div className="flex items-center gap-2">
              <span
                data-testid="autonomy-daemon-dot"
                className={`w-2 h-2 rounded-full ${
                  service?.running ? 'bg-success' : service?.installed ? 'bg-warning' : 'bg-text-muted'
                }`}
              />
              <span className="text-text-secondary">
                {service?.running
                  ? t('autonomy.daemonRunning', 'Service running')
                  : service?.installed
                    ? t('autonomy.daemonStopped', 'Installed, stopped')
                    : t('autonomy.daemonNotInstalled', 'Not installed')}
              </span>
              {daemon?.serviceName && (
                <span className="ml-auto font-mono text-[10px] text-text-muted truncate">{daemon.serviceName}</span>
              )}
            </div>
            {daemon && !daemon.ok && <p className="text-[11px] text-error">{daemon.error}</p>}
            <div className="flex flex-wrap items-center gap-1.5">
              {service?.installed && !service.running && (
                <button
                  onClick={() => void runDaemonAction('start', () => api.autonomy.serviceControl('start'))}
                  disabled={busyAction !== null}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
                  data-testid="autonomy-daemon-start"
                >
                  {busyAction === 'start' ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  {t('autonomy.start', 'Start')}
                </button>
              )}
              {service?.running && (
                <>
                  <button
                    onClick={() => void runDaemonAction('stop', () => api.autonomy.serviceControl('stop'))}
                    disabled={busyAction !== null}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-warning/50 disabled:opacity-50"
                    data-testid="autonomy-daemon-stop"
                  >
                    {busyAction === 'stop' ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />}
                    {t('autonomy.stop', 'Stop')}
                  </button>
                  <button
                    onClick={() => void runDaemonAction('restart', () => api.autonomy.serviceControl('restart'))}
                    disabled={busyAction !== null}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
                    data-testid="autonomy-daemon-restart"
                  >
                    {busyAction === 'restart' ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                    {t('autonomy.restart', 'Restart')}
                  </button>
                </>
              )}
              {service && !service.installed && (
                <button
                  onClick={() => void runDaemonAction('install', () => api.autonomy.serviceInstall())}
                  disabled={busyAction !== null}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
                  title={t(
                    'autonomy.installHint',
                    'Installs the always-on service (artifact executor: no repo edits, local $0 model)'
                  )}
                  data-testid="autonomy-daemon-install"
                >
                  {busyAction === 'install' ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                  {t('autonomy.install', 'Install service')}
                </button>
              )}
              <button
                onClick={() =>
                  void runDaemonAction('tick', async () => {
                    const result = (await api.autonomy.runTick()) as TickResultView;
                    setLastTick(result);
                    return result;
                  })
                }
                disabled={busyAction !== null}
                className="flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
                title={t('autonomy.tickHint', 'Run one autonomous tick now through the real CLI')}
                data-testid="autonomy-daemon-tick"
              >
                {busyAction === 'tick' ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                {t('autonomy.tick', 'Run one tick')}
              </button>
              {service?.installed && (
                <button
                  onClick={() => void runDaemonAction('uninstall', () => api.autonomy.serviceUninstall())}
                  disabled={busyAction !== null}
                  className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-border-muted text-text-muted hover:text-error hover:border-error/50 disabled:opacity-50"
                  data-testid="autonomy-daemon-uninstall"
                >
                  {busyAction === 'uninstall' ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  {t('autonomy.uninstall', 'Uninstall')}
                </button>
              )}
            </div>
            {actionError && (
              <p className="text-[11px] text-error" data-testid="autonomy-daemon-error">
                {actionError}
              </p>
            )}
            {lastTick?.ok && (
              <p className="text-[10px] text-text-muted" data-testid="autonomy-daemon-tick-result">
                {t('autonomy.tickResult', 'Last tick')}: {lastTick.ticks ?? 0} tick(s)
                {lastTick.outcomes
                  ? ` — ${Object.entries(lastTick.outcomes)
                      .map(([k, v]) => `${k}×${v}`)
                      .join(', ')}`
                  : ''}
              </p>
            )}
            {daemon?.manageCommand && (
              <p className="text-[10px] text-text-muted font-mono truncate" title={daemon.manageCommand}>
                {daemon.manageCommand}
              </p>
            )}
          </div>
        </section>

        {/* Free-first model ladder */}
        {tier && (
          <section data-testid="autonomy-model-tier-section">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
              {t('autonomy.modelTier', 'Model ladder (free-first)')}
            </h3>
            {!tier.ok && <p className="text-[11px] text-error">{tier.error}</p>}
            <div className="space-y-1">
              {tier.ladder.map((rung, i) => (
                <div
                  key={`${rung.tier}-${i}`}
                  className={`flex items-center gap-2 px-2 py-1 rounded border ${
                    tier.currentChoice?.model === rung.model && rung.configured
                      ? 'bg-accent/10 border-accent/40'
                      : 'bg-surface/40 border-border-muted'
                  } ${rung.configured ? '' : 'opacity-60'}`}
                >
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-border uppercase text-text-muted">
                    {rung.tier}
                  </span>
                  <span className="font-mono truncate text-text-secondary">{rung.model}</span>
                  {rung.paid ? (
                    <span className="ml-auto text-[9px] px-1 rounded border border-warning/40 text-warning">$</span>
                  ) : (
                    <span className="ml-auto text-[9px] px-1 rounded border border-success/40 text-success">$0</span>
                  )}
                  {rung.baseUrl && (
                    <span className="text-[10px] text-text-muted truncate max-w-[160px]" title={rung.baseUrl}>
                      {rung.baseUrl}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {tier.currentChoice && (
              <p className="mt-1 text-[10px] text-text-muted" title={tier.currentChoice.reason}>
                {t('autonomy.currentChoice', 'Next tick uses')}:{' '}
                <span className="font-mono">{tier.currentChoice.model}</span> ({tier.currentChoice.tier},{' '}
                {tier.currentChoice.paid ? '$' : '$0'})
              </p>
            )}
          </section>
        )}

        {/* Presence */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
            {t('autonomy.agents', 'Agents')} ({presence.length})
          </h3>
          {presence.length === 0 && <p className="text-text-muted">{t('autonomy.noAgents', 'No agents present.')}</p>}
          <div className="space-y-1">
            {presence.map(([id, p]) => (
              <div key={id} className="flex items-center gap-2 px-2 py-1 rounded bg-surface/40 border border-border-muted">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${p.status === 'active' ? 'bg-success' : p.status === 'idle' ? 'bg-warning' : 'bg-text-muted'}`}
                />
                <span className="font-mono truncate">{id}</span>
                {p.currentTask && <span className="ml-auto text-text-muted truncate">{p.currentTask}</span>}
              </div>
            ))}
          </div>
        </section>

        {/* Tasks by status */}
        {STATUS_ORDER.map((grp) => {
          const groupTasks = tasks.filter((task) => task.status === grp.id);
          if (groupTasks.length === 0) return null;
          const GroupIcon = grp.icon;
          return (
            <section key={grp.id}>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5 flex items-center gap-1.5">
                <GroupIcon size={11} className={grp.id === 'in_progress' && loading ? 'animate-spin' : ''} />
                {t(`autonomy.status.${grp.id}`, grp.label)} ({groupTasks.length})
              </h3>
              <div className="space-y-1.5">
                {groupTasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-2.5 rounded-lg bg-surface/40 border border-border-muted"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded border uppercase ${PRIORITY_COLOR[task.priority] ?? PRIORITY_COLOR.medium}`}
                      >
                        {task.priority}
                      </span>
                      <span className="text-text-secondary truncate flex-1">{task.title}</span>
                    </div>
                    {(task.claimedBy || (task.dependsOn && task.dependsOn.length > 0)) && (
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                        {task.claimedBy && <span className="font-mono truncate">@{task.claimedBy}</span>}
                        {task.dependsOn && task.dependsOn.length > 0 && (
                          <span className="ml-auto">⬑ {task.dependsOn.length} dep{task.dependsOn.length > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {tasks.length === 0 && snap?.ok && (
          <p className="text-text-muted text-center py-4">{t('autonomy.empty', 'The fleet queue is empty.')}</p>
        )}

        {/* Worklog */}
        {snap && snap.worklog.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
              {t('autonomy.worklog', 'Recent worklog')}
            </h3>
            <div className="space-y-1">
              {snap.worklog.map((entry, i) => (
                <div key={i} className="px-2 py-1.5 rounded bg-surface/30 border border-border-muted">
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    {entry.agent && <span className="font-mono truncate">{entry.agent}</span>}
                    {entry.taskId && <span className="truncate">{entry.taskId}</span>}
                  </div>
                  {entry.summary && <p className="text-text-secondary mt-0.5 leading-relaxed">{entry.summary}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
