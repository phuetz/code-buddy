/**
 * CompanionPanel — Buddy's Lisa-inspired cockpit.
 *
 * Surfaces local companion readiness and the append-only sensory journal:
 * vision, hearing, screen, self-state, memory, tools, and suggestions.
 *
 * @module renderer/components/CompanionPanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Brain,
  Camera,
  ClipboardCheck,
  Eye,
  FolderOpen,
  Mic,
  Monitor,
  Radio,
  RefreshCw,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useAppStore } from '../store';
import type {
  CameraSnapshotResult,
  CompanionPercept,
  CompanionPerceptModality,
  CompanionPerceptStats,
  CompanionSelfEvaluation,
  CompanionStatus,
} from '../types';

const MODALITIES: Array<{ key: CompanionPerceptModality | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'vision', label: 'Vision' },
  { key: 'hearing', label: 'Hearing' },
  { key: 'screen', label: 'Screen' },
  { key: 'self', label: 'Self' },
  { key: 'memory', label: 'Memory' },
  { key: 'tool', label: 'Tools' },
  { key: 'suggestion', label: 'Ideas' },
];

const MODALITY_ICON: Record<CompanionPerceptModality, typeof Activity> = {
  vision: Eye,
  hearing: Mic,
  screen: Monitor,
  self: Bot,
  memory: Brain,
  tool: Activity,
  suggestion: Sparkles,
};

function ready(ok: boolean): string {
  return ok ? 'Ready' : 'Needs attention';
}

function StatusTile({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded border border-border bg-surface/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${ok ? 'text-accent' : 'text-warning'}`} />
        <span className="text-[11px] font-semibold uppercase text-text-muted">{label}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-text-primary">{value}</div>
    </div>
  );
}

function payloadPath(percept: CompanionPercept): string | null {
  const value = percept.payload?.path;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function PerceptRow({ percept }: { percept: CompanionPercept }) {
  const Icon = MODALITY_ICON[percept.modality] ?? Activity;
  const path = payloadPath(percept);

  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-percept">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-accent" />
            <span className="text-xs font-semibold text-text-primary">
              {percept.modality}/{percept.source}
            </span>
            <span className="text-[10px] text-text-muted">
              {Math.round(percept.confidence * 100)}%
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{percept.summary}</p>
          {path && (
            <button
              onClick={() => void window.electronAPI?.showItemInFolder(path)}
              className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {path}
            </button>
          )}
          {percept.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {percept.tags.map((tag) => (
                <span key={tag} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <time className="shrink-0 text-[10px] text-text-muted">
          {new Date(percept.timestamp).toLocaleString()}
        </time>
      </div>
    </div>
  );
}

export function CompanionPanel() {
  const show = useAppStore((s) => s.showCompanionPanel);
  const setShow = useAppStore((s) => s.setShowCompanionPanel);

  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [stats, setStats] = useState<CompanionPerceptStats | null>(null);
  const [percepts, setPercepts] = useState<CompanionPercept[]>([]);
  const [evaluation, setEvaluation] = useState<CompanionSelfEvaluation | null>(null);
  const [modality, setModality] = useState<CompanionPerceptModality | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<'self' | 'camera' | 'evaluate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<CameraSnapshotResult | null>(null);

  const filteredStats = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byModality).sort(([a], [b]) => a.localeCompare(b));
  }, [stats]);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.companion) return;
    setLoading(true);
    setError(null);

    const selected = modality === 'all' ? undefined : modality;
    const [statusRes, recentRes, statsRes] = await Promise.all([
      window.electronAPI.companion.status(),
      window.electronAPI.companion.recentPercepts({ limit: 30, modality: selected }),
      window.electronAPI.companion.perceptStats(),
    ]);

    setLoading(false);
    if (!statusRes.ok) {
      setStatus(null);
      setStats(null);
      setPercepts([]);
      setError(statusRes.error === 'NO_ACTIVE_PROJECT'
        ? 'Select a project before opening Buddy companion senses.'
        : statusRes.error ?? 'Failed to load companion status');
      return;
    }

    setStatus(statusRes.status ?? null);
    setPercepts(recentRes.ok ? recentRes.items : []);
    setStats(statsRes.ok ? statsRes.stats ?? null : null);
    if (!recentRes.ok || !statsRes.ok) {
      setError(recentRes.error ?? statsRes.error ?? 'Failed to load companion percepts');
    }
  }, [modality]);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  const recordSelf = async () => {
    setBusyAction('self');
    setError(null);
    const res = await window.electronAPI.companion.recordSelf();
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Self-state recording failed');
      return;
    }
    await refresh();
  };

  const captureCamera = async () => {
    setBusyAction('camera');
    setError(null);
    const res = await window.electronAPI.companion.cameraSnapshot({ timeoutMs: 10000 });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Camera snapshot failed');
      return;
    }
    setLastSnapshot(res.result ?? null);
    await refresh();
  };

  const runEvaluation = async () => {
    setBusyAction('evaluate');
    setError(null);
    const res = await window.electronAPI.companion.evaluate({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Self-evaluation failed');
      return;
    }
    setEvaluation(res.evaluation ?? null);
    await refresh();
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm">
      <div className="flex h-full w-[640px] max-w-[calc(100vw-32px)] flex-col border-l border-border bg-background-secondary shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Buddy companion</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Refresh companion panel"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShow(false)}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Close companion panel"
            >
              <X className="h-4 w-4 text-text-muted" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Readiness</h3>
              {status?.cwd && <span className="text-[10px] text-text-muted truncate max-w-[360px]">{status.cwd}</span>}
            </div>

            {status ? (
              <div className="grid grid-cols-2 gap-2">
                <StatusTile
                  icon={Brain}
                  label="Brain"
                  value={status.chatGptCredentialsPresent ? status.model : 'ChatGPT login missing'}
                  ok={status.chatGptCredentialsPresent}
                />
                <StatusTile
                  icon={Bot}
                  label="Identity"
                  value={status.identity.soulIsCompanion && status.identity.bootIsCompanion ? 'Companion identity' : 'Identity incomplete'}
                  ok={status.identity.soulIsCompanion && status.identity.bootIsCompanion}
                />
                <StatusTile
                  icon={Mic}
                  label="Voice input"
                  value={`${ready(status.voice.enabled && status.voice.available)} / ${status.voice.provider}`}
                  ok={status.voice.enabled && status.voice.available}
                />
                <StatusTile
                  icon={Volume2}
                  label="Voice output"
                  value={`${ready(status.tts.enabled && status.tts.available)} / ${status.tts.provider}`}
                  ok={status.tts.enabled && status.tts.available}
                />
                <StatusTile
                  icon={Camera}
                  label="Camera"
                  value={`${ready(status.camera.available)} / ${status.camera.platform}`}
                  ok={status.camera.available}
                />
                <StatusTile
                  icon={Radio}
                  label="Wake word"
                  value={`${status.wakeWord.engine} / ${status.wakeWord.wakeWords.join(', ')}`}
                  ok={status.wakeWord.available}
                />
              </div>
            ) : (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                {loading ? 'Loading companion state...' : 'No companion status loaded.'}
              </div>
            )}
          </section>

          <section className="flex flex-wrap gap-2">
            <button
              disabled={busyAction !== null}
              onClick={() => void recordSelf()}
              className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Bot className="h-4 w-4" />
              {busyAction === 'self' ? 'Recording...' : 'Record self-state'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void captureCamera()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
              {busyAction === 'camera' ? 'Capturing...' : 'Camera snapshot'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runEvaluation()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <ClipboardCheck className="h-4 w-4" />
              {busyAction === 'evaluate' ? 'Evaluating...' : 'Self-evaluate'}
            </button>
            {lastSnapshot?.path && (
              <button
                onClick={() => void window.electronAPI.showItemInFolder(lastSnapshot.path!)}
                className="inline-flex min-w-0 items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface"
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate max-w-[260px]">{lastSnapshot.path}</span>
              </button>
            )}
          </section>

          {evaluation && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Self-evaluation</h3>
                <span className="text-[10px] text-text-muted">
                  {new Date(evaluation.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-accent" />
                    <span className="text-sm font-semibold text-text-primary">
                      {evaluation.score}/100
                    </span>
                    <span className="rounded bg-background px-2 py-0.5 text-[10px] uppercase text-text-muted">
                      {evaluation.level}
                    </span>
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {evaluation.findings.length} finding(s)
                  </span>
                </div>
                {evaluation.nextActions.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {evaluation.nextActions.slice(0, 3).map((action) => (
                      <p key={action} className="text-xs text-text-secondary">
                        {action}
                      </p>
                    ))}
                  </div>
                )}
                {evaluation.findings.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {evaluation.findings.slice(0, 4).map((finding) => (
                      <div key={finding.id} className="rounded bg-background px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold uppercase ${
                            finding.severity === 'action'
                              ? 'text-warning'
                              : finding.severity === 'warning'
                                ? 'text-warning'
                                : 'text-text-muted'
                          }`}>
                            {finding.severity}
                          </span>
                          <span className="text-[10px] uppercase text-text-muted">{finding.area}</span>
                        </div>
                        <p className="mt-1 text-xs text-text-primary">{finding.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Sensory journal</h3>
              <span className="text-[10px] text-text-muted">
                {stats ? `${stats.total} percepts` : 'No stats'}
              </span>
            </div>
            {stats?.storePath && (
              <button
                onClick={() => void window.electronAPI.showItemInFolder(stats.storePath)}
                className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{stats.storePath}</span>
              </button>
            )}
            {filteredStats.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {filteredStats.map(([key, count]) => (
                  <span key={key} className="rounded bg-surface px-2 py-1 text-[10px] text-text-muted">
                    {key}: {count}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {MODALITIES.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setModality(item.key)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    modality === item.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {percepts.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-8 text-center text-xs text-text-muted">
                {loading ? 'Loading percepts...' : 'No percepts for this filter yet.'}
              </div>
            ) : (
              <div className="space-y-2">
                {percepts.map((percept) => (
                  <PerceptRow key={percept.id} percept={percept} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
