import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Bot, FileText, FlaskConical, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { useAppStore } from '../store';
import { useActiveQueuedIntents, useCurrentSession } from '../store/selectors';
import { ArtifactPanel } from './ArtifactPanel';
import { FilePreviewPane } from './FilePreviewPane';
import type { DiffPreview } from '../types';
import { summarizeLatencyHistory } from '../../shared/session-latency';
import { formatHandoffNotice } from '../commands/terminal-handoff';
import { formatResourceDetail, resourceStateLabel, resourceStateTone, type ResourceRowView } from '../commands/resources-view';

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
const RAIL_WIDTH_PX = 460;
/** Narrowest conversation column kept beside an inline rail. */
export const MIN_CHAT_COLUMN_WITH_RAIL_PX = 380;

/**
 * When the chat pane cannot hold the rail plus a usable conversation column, the open rail
 * overlays the message list instead of squeezing it, and stops above the composer so the
 * composer stays visible and usable. Wide panes keep the inline rail unchanged.
 */
function useRailOverlay(open: boolean) {
  const railRef = useRef<HTMLElement>(null);
  const [overlay, setOverlay] = useState<{ active: boolean; bottom: number }>({ active: false, bottom: 0 });
  useEffect(() => {
    const rail = railRef.current;
    const pane = rail?.parentElement;
    if (!open || !rail || !pane || typeof ResizeObserver === 'undefined') {
      setOverlay({ active: false, bottom: 0 });
      return;
    }
    const composer = pane.querySelector<HTMLElement>('[data-testid="message-composer"]');
    const update = () => setOverlay({
      active: pane.clientWidth - RAIL_WIDTH_PX < MIN_CHAT_COLUMN_WITH_RAIL_PX,
      bottom: composer?.offsetHeight ?? 0,
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    if (composer) observer.observe(composer);
    return () => observer.disconnect();
  }, [open]);
  return { railRef, overlay };
}

export function UniversalPreviewRail({ appPreview, appAvailable }: UniversalPreviewRailProps) {
  const session = useCurrentSession();
  const sessions = useAppStore((state) => state.sessions);
  const previewFilePath = useAppStore((state) => state.previewFilePath);
  const activeArtifact = useAppStore((state) => state.activeArtifact);
  const diffPreviews = useAppStore((state) => session ? state.diffPreviews[session.id] ?? EMPTY_DIFF_PREVIEWS : EMPTY_DIFF_PREVIEWS);
  const approvals = useAppStore((state) => state.pendingApprovals);
  const setPrimaryView = useAppStore((state) => state.setPrimaryView);
  const queued = useActiveQueuedIntents();
  // The rail lives inside the dock's Chat panel, which can be much narrower
  // than the application window when Context is open. Starting expanded at
  // 460px can reduce the conversation column (and its composer) to zero.
  // Keep the explicit open button and the file/artifact auto-open effects,
  // but give every newly mounted chat a usable composer first.
  const [open, setOpen] = useState(false);
  const { railRef, overlay } = useRailOverlay(open);
  const [tab, setTab] = useState<RailTab>('activity');
  const [externalSessions, setExternalSessions] = useState<Array<{
    id: string;
    name: string;
    model: string;
    messageCount: number;
    lastAccessedAt: string;
    origin?: 'cli' | 'cowork' | 'mobile';
  }>>([]);
  const [handoff, setHandoff] = useState<{ state: 'idle' | 'working' | 'done' | 'error'; text?: string }>({ state: 'idle' });
  const [resources, setResources] = useState<{ status: 'ok'; resources: ResourceRowView[] } | { status: 'empty'; hint: string } | { status: 'error'; message: string } | null>(null);

  useEffect(() => {
    setHandoff({ state: 'idle' });
  }, [session?.id]);

  useEffect(() => {
    if (tab !== 'activity') return;
    void window.electronAPI?.session?.externalList?.().then(setExternalSessions).catch(() => setExternalSessions([]));
    // Read-only: the main process lists the catalog file; it never probes.
    void window.electronAPI?.tools?.resourceCatalog?.list?.().then(setResources).catch(() => setResources(null));
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
  const unifiedRecents = useMemo(() => {
    const local = recentSessions.map((item) => ({
      id: item.id,
      title: item.title,
      origin: item.source === 'cli-import' ? 'cli' : 'cowork',
      kind: 'local' as const,
      session: item,
    }));
    const imported = new Set(sessions.map((item) => item.id));
    const external = externalSessions
      .filter((item) => !imported.has(item.id) && !imported.has(`cli-import:${item.id}`))
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        title: item.name,
        origin: item.origin ?? 'cli',
        kind: 'external' as const,
        session: item,
      }));
    return [...local, ...external].slice(0, 10);
  }, [recentSessions, sessions, externalSessions]);

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
    <aside
      ref={railRef}
      className={overlay.active
        ? 'absolute right-0 top-0 z-30 flex w-[min(460px,100%)] flex-col border-l border-border bg-surface shadow-2xl'
        : 'flex w-[460px] shrink-0 flex-col border-l border-border bg-surface'}
      style={overlay.active ? { bottom: overlay.bottom } : undefined}
      data-testid="universal-preview-rail"
      data-layout={overlay.active ? 'overlay' : 'inline'}
    >
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
            {session ? (
              <div className="space-y-1 rounded-lg border border-border-muted bg-background/60 p-3" data-testid="continue-in-terminal">
                <button type="button" onClick={async () => {
                  setHandoff({ state: 'working' });
                  try {
                    const result = await window.electronAPI?.session?.exportToCli?.(session.id);
                    if (!result) throw new Error('API indisponible');
                    let copied = false;
                    try { await navigator.clipboard.writeText(result.command); copied = true; } catch { copied = false; }
                    setHandoff({ state: 'done', text: formatHandoffNotice(result, copied) });
                  } catch (error) {
                    setHandoff({ state: 'error', text: error instanceof Error ? error.message : String(error) });
                  }
                }} disabled={handoff.state === 'working'} className="rounded border border-border-muted px-2 py-1 text-[10px] text-text-secondary hover:bg-surface-hover disabled:opacity-50">Continuer dans le terminal</button>
                {handoff.text ? <p className={`break-all text-[10px] ${handoff.state === 'error' ? 'text-danger' : 'text-text-muted'}`}>{handoff.text}</p> : null}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border-muted bg-background/60 p-3"><div className="text-lg font-semibold text-text-primary">{queued.length}</div><div className="text-[10px] text-text-muted">messages en attente</div></div>
              <div className="rounded-lg border border-border-muted bg-background/60 p-3"><div className="text-lg font-semibold text-text-primary">{approvals.length}</div><div className="text-[10px] text-text-muted">approbations</div></div>
            </div>
            {unifiedRecents.length > 0 ? (
              <div className="space-y-1.5" data-testid="unified-recents">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Récents</h4>
                {unifiedRecents.map((item) => (
                  <div key={`${item.kind}:${item.id}`} className="flex items-center gap-2 rounded-lg border border-border-muted bg-background/60 px-3 py-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (item.kind === 'local') {
                          useAppStore.getState().setActiveSession(item.id);
                          return;
                        }
                        const imported = await window.electronAPI?.session?.externalImport?.(item.id);
                        if (!imported) return;
                        const store = useAppStore.getState();
                        if (!store.sessions.some((candidate) => candidate.id === imported.id)) store.addSession(imported);
                        store.setActiveSession(imported.id);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-xs text-text-primary">{item.title}</div>
                      <div className="text-[10px] text-text-muted">{item.origin}</div>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
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
            {resources ? (
              <div className="space-y-1.5" data-testid="resource-catalog-view">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Ressources déclarées (lecture seule)</h4>
                {resources.status === 'ok' ? resources.resources.map((item) => {
                  const tone = resourceStateTone(item.state);
                  return (
                    <div key={item.id} className="rounded-lg border border-border-muted bg-background/60 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{item.id}</span>
                        <span className={`text-[10px] font-medium ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text-muted'}`}>{resourceStateLabel(item.state)}</span>
                      </div>
                      <div className="truncate text-[10px] text-text-muted" title={formatResourceDetail(item)}>{formatResourceDetail(item)}</div>
                    </div>
                  );
                }) : null}
                {resources.status === 'empty' ? <p className="rounded-lg border border-dashed border-border-muted p-3 text-[10px] text-text-muted">{resources.hint}</p> : null}
                {resources.status === 'error' ? <p className="text-[10px] text-danger">{resources.message}</p> : null}
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
