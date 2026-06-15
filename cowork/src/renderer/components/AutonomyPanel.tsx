/**
 * AutonomyPanel — pilot the autonomous fleet from the GUI.
 *
 * Three layers:
 * 1. Daemon lifecycle — status of the always-on `codebuddy-autonomy` service
 *    with start/stop/restart, install/uninstall, and a one-shot "run a tick"
 *    that goes through the real CLI (`autonomy.daemonStatus` & friends IPC).
 * 2. Free-first model ladder — local → network → paid rungs and the model a
 *    tick would use right now (`autonomy.modelTier` IPC).
 * 3. Colab board — the shared task queue (status + priority + claim + DAG
 *    deps), live presence, recent worklog (`autonomy.snapshot` IPC), plus the
 *    write half of the kanban: add tasks and claim/complete/block/release
 *    them, and sweep expired claims (`autonomy.task*` IPC). Completing or
 *    blocking asks for a summary/reason inline — the bridge refuses empty
 *    ones because they feed the fleet's shared worklog.
 * Mirrors the ReasoningTraceViewer/MemoryPanel shell.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LiveBudgetMeter } from './LiveBudgetMeter';
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
  Plus,
  Check,
  ScrollText,
} from 'lucide-react';

interface ColabTaskView {
  id: string;
  title: string;
  status: string;
  priority: string;
  claimedBy?: string | null;
  blockedReason?: string;
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
  const [boardError, setBoardError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  // Inline text capture for the two mutations that require one (complete → worklog summary, block → reason).
  const [pendingText, setPendingText] = useState<{ taskId: string; kind: 'complete' | 'block'; text: string } | null>(
    null
  );
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<{ source?: string; lines: string[] } | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showInstallOptions, setShowInstallOptions] = useState(false);
  const [installModel, setInstallModel] = useState('');
  const [installOllamaUrl, setInstallOllamaUrl] = useState('');
  const [installIntervalMs, setInstallIntervalMs] = useState('');
  const [installExecutor, setInstallExecutor] = useState<'artifact' | 'agent'>('artifact');
  const [installWorkspace, setInstallWorkspace] = useState('');

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

  const runBoardAction = useCallback(
    async (name: string, action: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
      setBusyAction(name);
      setBoardError(null);
      try {
        const result = await action();
        if (!result.ok) setBoardError(result.error ?? `${name} failed`);
        return result.ok;
      } catch (err) {
        setBoardError(String(err));
        return false;
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

  const submitAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const ok = await runBoardAction('task-add', () =>
      api.autonomy.taskAdd({
        title,
        priority: newPriority,
        ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
      })
    );
    if (ok) {
      setNewTitle('');
      setNewDescription('');
      setNewPriority('medium');
      setShowAddForm(false);
    }
  };

  const confirmPendingText = async () => {
    if (!pendingText) return;
    const text = pendingText.text.trim();
    if (!text) return;
    const { taskId, kind } = pendingText;
    const ok = await runBoardAction(`task-${kind}`, () =>
      kind === 'complete' ? api.autonomy.taskComplete(taskId, text) : api.autonomy.taskBlock(taskId, text)
    );
    if (ok) setPendingText(null);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const result = await api.autonomy.serviceLogs(120);
      if (result.ok) {
        setLogs({ ...(result.source ? { source: result.source } : {}), lines: result.lines ?? [] });
      } else {
        setLogs(null);
        setLogsError(result.error ?? 'logs unavailable');
      }
    } catch (err) {
      setLogsError(String(err));
    } finally {
      setLogsLoading(false);
    }
  };

  const submitCustomInstall = async () => {
    const interval = Number.parseInt(installIntervalMs, 10);
    await runDaemonAction('install-custom', () =>
      api.autonomy.serviceInstall({
        ...(installModel.trim() ? { model: installModel.trim() } : {}),
        ...(installOllamaUrl.trim() ? { ollamaUrl: installOllamaUrl.trim() } : {}),
        ...(Number.isFinite(interval) && interval > 0 ? { intervalMs: interval } : {}),
        executor: installExecutor,
        ...(installExecutor === 'agent' && installWorkspace.trim()
          ? { workspace: installWorkspace.trim() }
          : {}),
      })
    );
  };

  return (
    <div
      className="h-full w-full bg-background flex flex-col"
      data-testid="autonomy-panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-muted flex-shrink-0">
        <Cpu size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-primary">
          {t('autonomy.title', 'Advanced Autonomy Dashboard (YOLO / Daemon)')}
        </h2>
        <div className="ml-auto flex items-center gap-3">
          <LiveBudgetMeter />
          <div className="flex items-center gap-1">
            <button
              onClick={() => void load()}
              className="p-1 text-text-muted hover:text-text-primary"
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
        </div>
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
                <>
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
                  <button
                    onClick={() => setShowInstallOptions((v) => !v)}
                    disabled={busyAction !== null}
                    className="px-2 py-1 rounded border border-border-muted text-text-muted hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
                    title={t('autonomy.installOptionsHint', 'Install with a custom model, Ollama URL, interval or executor')}
                    data-testid="autonomy-daemon-install-options-toggle"
                  >
                    {t('autonomy.installOptions', 'Options')}
                  </button>
                </>
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
            {showInstallOptions && service && !service.installed && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitCustomInstall();
                }}
                className="space-y-1.5"
                data-testid="autonomy-daemon-install-form"
              >
                <input
                  value={installModel}
                  onChange={(e) => setInstallModel(e.target.value)}
                  placeholder={t('autonomy.installModel', 'Model (default qwen2.5:7b-instruct)')}
                  className="w-full px-2 py-1 rounded bg-background border border-border text-text-primary placeholder:text-text-muted"
                  data-testid="autonomy-install-model"
                />
                <div className="flex items-center gap-1.5">
                  <input
                    value={installOllamaUrl}
                    onChange={(e) => setInstallOllamaUrl(e.target.value)}
                    placeholder={t('autonomy.installOllamaUrl', 'Ollama URL (default localhost:11434)')}
                    className="flex-1 px-2 py-1 rounded bg-background border border-border text-text-primary placeholder:text-text-muted"
                    data-testid="autonomy-install-ollama-url"
                  />
                  <input
                    value={installIntervalMs}
                    onChange={(e) => setInstallIntervalMs(e.target.value)}
                    placeholder={t('autonomy.installInterval', 'Interval ms')}
                    className="w-24 px-2 py-1 rounded bg-background border border-border text-text-primary placeholder:text-text-muted"
                    data-testid="autonomy-install-interval"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={installExecutor}
                    onChange={(e) => setInstallExecutor(e.target.value as 'artifact' | 'agent')}
                    className="px-2 py-1 rounded bg-background border border-border text-text-secondary"
                    title={t(
                      'autonomy.installExecutorHint',
                      'artifact = scoped outputs, never edits a repo. agent = real headless agent, requires an explicit workspace (fail-closed).'
                    )}
                    data-testid="autonomy-install-executor"
                  >
                    <option value="artifact">artifact</option>
                    <option value="agent">agent</option>
                  </select>
                  {installExecutor === 'agent' && (
                    <input
                      value={installWorkspace}
                      onChange={(e) => setInstallWorkspace(e.target.value)}
                      placeholder={t('autonomy.installWorkspace', 'Workspace dir (required)')}
                      className="flex-1 px-2 py-1 rounded bg-background border border-border text-text-primary placeholder:text-text-muted"
                      data-testid="autonomy-install-workspace"
                    />
                  )}
                  <button
                    type="submit"
                    disabled={busyAction !== null || (installExecutor === 'agent' && !installWorkspace.trim())}
                    className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
                    data-testid="autonomy-daemon-install-custom"
                  >
                    {busyAction === 'install-custom' ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Download size={11} />
                    )}
                    {t('autonomy.installWithOptions', 'Install with options')}
                  </button>
                </div>
              </form>
            )}
            {showLogs && (
              <div data-testid="autonomy-daemon-logs">
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                  <span className="font-mono truncate">{logs?.source ?? ''}</span>
                  <button
                    onClick={() => void loadLogs()}
                    disabled={logsLoading}
                    className="ml-auto p-1 hover:text-text-primary disabled:opacity-50"
                    title={t('common.refresh', 'Refresh')}
                    data-testid="autonomy-daemon-logs-refresh"
                  >
                    <RefreshCw size={10} className={logsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
                {logsError && (
                  <p className="text-[11px] text-error" data-testid="autonomy-daemon-logs-error">
                    {logsError}
                  </p>
                )}
                {logs && logs.lines.length > 0 && (
                  <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-background border border-border-muted p-2 text-[10px] text-text-secondary">
                    {logs.lines.join('\n')}
                  </pre>
                )}
                {logs && logs.lines.length === 0 && (
                  <p className="text-[10px] text-text-muted">{t('autonomy.noLogs', 'No log lines yet.')}</p>
                )}
              </div>
            )}
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
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              {t('autonomy.agents', 'Active Subagents')} ({presence.length})
            </h3>
            {presence.length > 0 && (
               <div className="flex items-center gap-2">
                 <span className="text-[10px] text-text-muted">{presence.filter(([, p]) => p.status === 'active').length} active</span>
                 <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden border border-border-muted">
                   <div 
                     className="h-full bg-success transition-all duration-500" 
                     style={{ width: `${(presence.filter(([, p]) => p.status === 'active').length / presence.length) * 100}%` }} 
                   />
                 </div>
               </div>
            )}
          </div>
          {presence.length === 0 && <p className="text-text-muted">{t('autonomy.noAgents', 'No agents present.')}</p>}
          <div className="grid grid-cols-2 gap-2">
            {presence.map(([id, p]) => (
              <div key={id} className="flex flex-col gap-1.5 p-2 rounded-lg bg-surface/40 border border-border-muted shadow-sm hover:border-accent/40 transition-colors">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] ${p.status === 'active' ? 'bg-success animate-pulse shadow-success/50' : p.status === 'idle' ? 'bg-warning shadow-warning/50' : 'bg-text-muted'}`}
                  />
                  <span className="font-mono text-xs font-semibold truncate text-text-primary">{id}</span>
                </div>
                {p.currentTask ? (
                  <span className="text-[10px] text-text-secondary truncate bg-background px-1.5 py-0.5 rounded border border-border">
                    {p.currentTask}
                  </span>
                ) : (
                  <span className="text-[10px] text-text-muted italic px-1.5">Idle</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Task board — write half of the kanban */}
        <section data-testid="autonomy-board-section">
          <div className="flex items-center gap-1.5 mb-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              {t('autonomy.board', 'Task board')} ({tasks.length})
            </h3>
            <button
              onClick={() => {
                setShowAddForm((v) => !v);
                setBoardError(null);
              }}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50"
              data-testid="autonomy-board-add-toggle"
            >
              <Plus size={11} />
              {t('autonomy.addTask', 'Add task')}
            </button>
            <button
              onClick={() => void runBoardAction('reclaim', () => api.autonomy.reclaimExpired())}
              disabled={busyAction !== null}
              className="flex items-center gap-1 px-2 py-1 rounded border border-border-muted text-text-muted hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
              title={t('autonomy.reclaimHint', 'Sweep expired claims back to the open pool (crashed agents)')}
              data-testid="autonomy-board-reclaim"
            >
              {busyAction === 'reclaim' ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
              {t('autonomy.reclaim', 'Reclaim expired')}
            </button>
          </div>
          {showAddForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitAdd();
              }}
              className="p-2.5 rounded-lg bg-surface/40 border border-border-muted space-y-1.5 mb-2"
              data-testid="autonomy-board-add-form"
            >
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t('autonomy.addTitlePlaceholder', 'Task title')}
                className="w-full px-2 py-1 rounded bg-background border border-border text-text-primary placeholder:text-text-muted"
                autoFocus
                data-testid="autonomy-board-add-title"
              />
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t('autonomy.addDescriptionPlaceholder', 'Description (optional)')}
                className="w-full px-2 py-1 rounded bg-background border border-border text-text-primary placeholder:text-text-muted"
                data-testid="autonomy-board-add-description"
              />
              <div className="flex items-center gap-1.5">
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as 'critical' | 'high' | 'medium' | 'low')}
                  className="px-2 py-1 rounded bg-background border border-border text-text-secondary"
                  data-testid="autonomy-board-add-priority"
                >
                  {(['critical', 'high', 'medium', 'low'] as const).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || busyAction !== null}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
                  data-testid="autonomy-board-add-submit"
                >
                  {busyAction === 'task-add' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  {t('autonomy.add', 'Add')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-2 py-1 rounded border border-border-muted text-text-muted hover:text-text-primary"
                  data-testid="autonomy-board-add-cancel"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
              </div>
            </form>
          )}
          {boardError && (
            <p className="text-[11px] text-error mb-1.5" data-testid="autonomy-board-error">
              {boardError}
            </p>
          )}
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
                      {task.status === 'open' && (
                        <button
                          onClick={() => void runBoardAction('task-claim', () => api.autonomy.taskClaim(task.id))}
                          disabled={busyAction !== null}
                          className="p-1 rounded text-text-muted hover:text-success disabled:opacity-50"
                          title={t('autonomy.claim', 'Claim this task')}
                          data-testid={`autonomy-task-claim-${task.id}`}
                        >
                          <Play size={11} />
                        </button>
                      )}
                      {task.status === 'in_progress' && (
                        <>
                          <button
                            onClick={() => setPendingText({ taskId: task.id, kind: 'complete', text: '' })}
                            disabled={busyAction !== null}
                            className="p-1 rounded text-text-muted hover:text-success disabled:opacity-50"
                            title={t('autonomy.complete', 'Complete (asks for a worklog summary)')}
                            data-testid={`autonomy-task-complete-${task.id}`}
                          >
                            <CheckCircle2 size={11} />
                          </button>
                          <button
                            onClick={() => void runBoardAction('task-release', () => api.autonomy.taskRelease(task.id))}
                            disabled={busyAction !== null}
                            className="p-1 rounded text-text-muted hover:text-warning disabled:opacity-50"
                            title={t('autonomy.release', 'Release the claim back to the open pool')}
                            data-testid={`autonomy-task-release-${task.id}`}
                          >
                            <RotateCcw size={11} />
                          </button>
                        </>
                      )}
                      {(task.status === 'open' || task.status === 'in_progress') && (
                        <button
                          onClick={() => setPendingText({ taskId: task.id, kind: 'block', text: '' })}
                          disabled={busyAction !== null}
                          className="p-1 rounded text-text-muted hover:text-error disabled:opacity-50"
                          title={t('autonomy.block', 'Block (asks for a reason)')}
                          data-testid={`autonomy-task-block-${task.id}`}
                        >
                          <Ban size={11} />
                        </button>
                      )}
                      {task.status === 'blocked' && (
                        <button
                          onClick={() => void runBoardAction('task-release', () => api.autonomy.taskRelease(task.id))}
                          disabled={busyAction !== null}
                          className="p-1 rounded text-text-muted hover:text-success disabled:opacity-50"
                          title={t('autonomy.reopen', 'Reopen this task')}
                          data-testid={`autonomy-task-release-${task.id}`}
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </div>
                    {task.status === 'blocked' && task.blockedReason && (
                      <p className="mt-1 text-[10px] text-error/80 truncate" title={task.blockedReason}>
                        {task.blockedReason}
                      </p>
                    )}
                    {(task.claimedBy || (task.dependsOn && task.dependsOn.length > 0)) && (
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                        {task.claimedBy && <span className="font-mono truncate">@{task.claimedBy}</span>}
                        {task.dependsOn && task.dependsOn.length > 0 && (
                          <span className="ml-auto">⬑ {task.dependsOn.length} dep{task.dependsOn.length > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    )}
                    {pendingText?.taskId === task.id && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <input
                          value={pendingText.text}
                          onChange={(e) => setPendingText({ ...pendingText, text: e.target.value })}
                          placeholder={
                            pendingText.kind === 'complete'
                              ? t('autonomy.summaryPlaceholder', 'Worklog summary…')
                              : t('autonomy.reasonPlaceholder', 'Why is it blocked?')
                          }
                          className="flex-1 px-2 py-1 rounded bg-background border border-border text-text-primary placeholder:text-text-muted"
                          autoFocus
                          data-testid="autonomy-task-input"
                        />
                        <button
                          onClick={() => void confirmPendingText()}
                          disabled={!pendingText.text.trim() || busyAction !== null}
                          className="p-1 rounded text-text-muted hover:text-success disabled:opacity-50"
                          title={t('common.confirm', 'Confirm')}
                          data-testid="autonomy-task-input-confirm"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={() => setPendingText(null)}
                          className="p-1 rounded text-text-muted hover:text-text-primary"
                          title={t('common.cancel', 'Cancel')}
                          data-testid="autonomy-task-input-cancel"
                        >
                          <X size={12} />
                        </button>
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

        {/* YOLO Mode Logs */}
        <section data-testid="autonomy-logs-section" className="mt-4 border-t border-border-muted pt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted flex items-center gap-1.5">
              <ScrollText size={11} />
              {t('autonomy.yoloLogs', 'YOLO Mode & Daemon Logs')}
            </h3>
            {service?.installed && (
            <button
              data-testid="autonomy-daemon-logs-toggle"
              onClick={() => {
                const next = !showLogs;
                setShowLogs(next);
                if (next) void loadLogs();
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors ${
                showLogs ? 'bg-accent/10 border-accent/40 text-accent' : 'border-border-muted text-text-muted hover:text-text-primary'
              }`}
            >
              {logsLoading ? <Loader2 size={10} className="animate-spin" /> : showLogs ? <Square size={10} /> : <Play size={10} />}
              {showLogs ? t('common.hide', 'Hide Logs') : t('autonomy.tailLogs', 'Live Tail')}
            </button>)}
          </div>
          {showLogs && (
            <div data-testid="autonomy-daemon-logs" className="bg-[#1e1e1e] rounded-lg border border-[#333] p-2 overflow-hidden flex flex-col mt-2">
              <div className="flex items-center gap-1.5 mb-1 text-[10px] text-[#888]">
                <span className="font-mono truncate">{logs?.source ?? 'service logs'}</span>
                <button
                  onClick={() => void loadLogs()}
                  disabled={logsLoading}
                  className="ml-auto p-1 hover:text-[#fff] disabled:opacity-50"
                  title={t('common.refresh', 'Refresh')}
                >
                  <RefreshCw size={10} className={logsLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              {logsError && (
                <p className="text-[11px] text-[#ff5555] px-1" data-testid="autonomy-daemon-logs-error">
                  {logsError}
                </p>
              )}
              {logs && logs.lines.length > 0 && (
                <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap text-[10px] text-[#00ff00] font-mono leading-relaxed">
                  {logs.lines.join('\n')}
                </pre>
              )}
              {logs && logs.lines.length === 0 && (
                <p className="text-[10px] text-[#888] px-1 font-mono">{t('autonomy.noLogs', 'Waiting for logs...')}</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
