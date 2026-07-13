import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Bot, FileText, FlaskConical, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { useAppStore } from '../store';
import { useActiveQueuedIntents, useCurrentSession } from '../store/selectors';
import { ArtifactPanel } from './ArtifactPanel';
import { FilePreviewPane } from './FilePreviewPane';
import type { DiffPreview } from '../types';
import { summarizeLatencyHistory } from '../../shared/session-latency';

type RailTab = 'activity' | 'app' | 'file' | 'artifact' | 'proofs';

interface UniversalPreviewRailProps {
  appPreview: ReactNode;
  appAvailable: boolean;
}

const TABS: Array<{ id: RailTab; label: string; icon: typeof Activity }> = [
  { id: 'activity', label: 'Activité', icon: Activity },
  { id: 'app', label: 'App', icon: Sparkles },
  { id: 'file', label: 'Fichier', icon: FileText },
  { id: 'artifact', label: 'Artefact', icon: Bot },
  { id: 'proofs', label: 'Preuves', icon: FlaskConical },
];
const EMPTY_DIFF_PREVIEWS: DiffPreview[] = [];

function formatRailLatency(value?: number): string {
  if (value === undefined) return '—';
  return value < 1_000 ? `${Math.round(value)}ms` : `${(value / 1_000).toFixed(1)}s`;
}

/** One session-aware rail for every inspectable output and live task. */
export function UniversalPreviewRail({ appPreview, appAvailable }: UniversalPreviewRailProps) {
  const session = useCurrentSession();
  const sessions = useAppStore((state) => state.sessions);
  const previewFilePath = useAppStore((state) => state.previewFilePath);
  const activeArtifact = useAppStore((state) => state.activeArtifact);
  const diffPreviews = useAppStore((state) => session ? state.diffPreviews[session.id] ?? EMPTY_DIFF_PREVIEWS : EMPTY_DIFF_PREVIEWS);
  const approvals = useAppStore((state) => state.pendingApprovals);
  const setPrimaryView = useAppStore((state) => state.setPrimaryView);
  const queued = useActiveQueuedIntents();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<RailTab>('activity');
  const [externalSessions, setExternalSessions] = useState<Array<{ id: string; name: string; model: string; messageCount: number; lastAccessedAt: string }>>([]);

  useEffect(() => {
    if (tab !== 'activity') return;
    void window.electronAPI?.session?.externalList?.().then(setExternalSessions).catch(() => setExternalSessions([]));
  }, [tab]);

  useEffect(() => {
    if (previewFilePath) {
      setTab('file');
      setOpen(true);
    }
  }, [previewFilePath]);

  useEffect(() => {
    if (activeArtifact) {
      setTab('artifact');
      setOpen(true);
    }
  }, [activeArtifact]);

  const running = useMemo(() => sessions.filter((item) => item.status === 'running'), [sessions]);
  const recentSessions = useMemo(
    () => [...sessions].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 6),
    [sessions],
  );

  if (!open) {
    return (
      <aside className="flex w-9 shrink-0 flex-col items-center gap-2 border-l border-border bg-surface pt-3" data-testid="universal-preview-rail-collapsed">
        <button type="button" onClick={() => setOpen(true)} className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary" title="Ouvrir le rail universel">
          <PanelRightOpen size={16} />
        </button>
        {running.length > 0 ? <span className="h-2 w-2 rounded-full bg-success" title={`${running.length} session(s) active(s)`} /> : null}
      </aside>
    );
  }

  return (
    <aside className="flex w-[460px] shrink-0 flex-col border-l border-border bg-surface" data-testid="universal-preview-rail">
      <header className="flex items-center gap-1 border-b border-border px-2 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              disabled={id === 'app' && !appAvailable}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-35 ${tab === id ? 'bg-accent/12 text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'}`}
              data-testid={`preview-rail-tab-${id}`}
            >
              <Icon size={11} /> {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-text-muted hover:bg-surface-hover" title="Réduire le rail">
          <PanelRightClose size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'activity' ? (
          <div className="space-y-4 p-4" data-testid="continuity-activity">
            <div>
              <h3 className="text-xs font-semibold text-text-primary">Centre d’activité</h3>
              <p className="mt-1 text-[10px] text-text-muted">Sessions, messages en attente et approbations dans un même flux.</p>
            </div>
            <div className="space-y-1.5">
              {running.map((item) => (
                <button key={item.id} type="button" onClick={() => useAppStore.getState().setActiveSession(item.id)} className="flex w-full items-center gap-2 rounded-lg border border-border-muted bg-background/60 px-3 py-2 text-left">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
                  <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{item.title}</span>
                  <span className="text-[10px] text-text-muted">{item.intelligence?.profileId ?? 'default'}</span>
                </button>
              ))}
              {running.length === 0 ? <p className="rounded-lg border border-dashed border-border-muted p-4 text-center text-xs text-text-muted">Aucune exécution active.</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border-muted bg-background/60 p-3"><div className="text-lg font-semibold text-text-primary">{queued.length}</div><div className="text-[10px] text-text-muted">messages en attente</div></div>
              <div className="rounded-lg border border-border-muted bg-background/60 p-3"><div className="text-lg font-semibold text-text-primary">{approvals.length}</div><div className="text-[10px] text-text-muted">approbations</div></div>
            </div>
            {recentSessions.length > 0 ? (
              <div className="space-y-1.5" data-testid="runtime-observatory">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Observatoire des runtimes</h4>
                {recentSessions.map((item) => {
                  const summary = item.intelligence
                    ? summarizeLatencyHistory(item.intelligence, { configSetId: item.intelligence.configSetId, model: item.model })
                    : null;
                  const p95 = summary?.p95Ms;
                  const overBudget = p95 !== undefined && p95 > (item.intelligence?.latencyBudgetMs ?? 900);
                  return (
                    <button key={item.id} type="button" onClick={() => useAppStore.getState().setActiveSession(item.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-border-muted bg-background/60 px-3 py-2 text-left hover:bg-surface-hover">
                      <span className="min-w-0"><span className="block truncate text-xs text-text-primary">{item.title}</span><span className="block truncate text-[10px] text-text-muted">{item.model ?? 'modèle par défaut'} · {item.intelligence?.executionLocation ?? 'local'}</span></span>
                      <span className={`text-[10px] font-medium ${overBudget ? 'text-warning' : 'text-success'}`}>p95 {formatRailLatency(p95)}</span>
                      <span className={`h-2 w-2 rounded-full ${item.status === 'running' ? 'animate-pulse bg-success' : item.status === 'error' ? 'bg-danger' : 'bg-text-muted/30'}`} title={item.status} />
                    </button>
                  );
                })}
              </div>
            ) : null}
            {externalSessions.length > 0 ? (
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Sessions CLI et canaux</h4>
                {externalSessions.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border-muted bg-background/60 px-3 py-2">
                    <div className="min-w-0 flex-1"><div className="truncate text-xs text-text-primary">{item.name}</div><div className="text-[10px] text-text-muted">{item.model} · {item.messageCount} messages</div></div>
                    <button type="button" onClick={async () => {
                      const imported = await window.electronAPI?.session?.externalImport?.(item.id);
                      if (!imported) return;
                      const store = useAppStore.getState();
                      if (!store.sessions.some((candidate) => candidate.id === imported.id)) store.addSession(imported);
                      store.setActiveSession(imported.id);
                    }} className="rounded border border-border-muted px-2 py-1 text-[10px] text-text-secondary hover:bg-surface-hover">Importer</button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {tab === 'app' ? appPreview : null}
        {tab === 'file' ? <FilePreviewPane inline /> : null}
        {tab === 'artifact' ? <ArtifactPanel inline /> : null}
        {tab === 'proofs' ? (
          <div className="space-y-3 p-4" data-testid="proof-aware-preview">
            <div><h3 className="text-xs font-semibold text-text-primary">Preuves de session</h3><p className="mt-1 text-[10px] text-text-muted">Les modifications validées peuvent être compilées dans Mission Control.</p></div>
            {diffPreviews.map((preview) => <div key={preview.turnId} className="rounded-lg border border-border-muted bg-background/60 p-3 text-xs text-text-secondary">Tour {preview.turnId} · {preview.diffs.length} changement(s)</div>)}
            {diffPreviews.length === 0 ? <div className="rounded-lg border border-dashed border-border-muted p-5 text-center text-xs text-text-muted">Aucune preuve de diff disponible.</div> : null}
            <button type="button" onClick={() => setPrimaryView('os')} className="w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500">Ouvrir les Outcome Capsules</button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
