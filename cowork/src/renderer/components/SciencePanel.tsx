/**
 * SciencePanel — laboratory control for scored AI-Scientist variants and video discoveries.
 *
 * The core runs a best-first search over experiment variants: each variant tests a hypothesis, runs
 * sandboxed code, is scored on a measured metric, and is gated (passedAll / no regressions / a human
 * keep-gate). This panel only *shows* what the loop produced — the winning variant, every recorded
 * variant with its score / gate status / lineage (`parentId`), and a roll-up summary. Data comes from
 * the `science.*` IPC (a direct read of the append-only variant store JSONL); nothing here runs code.
 *
 * Keep it honest: launching an experiment stays a CLI-only action (`buddy science …`) for safety —
 * there is intentionally no "run" button. Opened from the new-shell Labs launcher.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { VideoExperimentBacklog } from './VideoExperimentBacklog';

interface ScienceVariantView {
  id: string;
  hypothesis: string;
  language: string;
  score: number;
  passedAll: boolean;
  regressions: string[];
  parentId?: string;
  kept: boolean;
  createdAt: string;
  metric: { name: string; value: number | null; score: number; detail?: string };
  execution: {
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    runId: string;
  };
  detail?: string;
  codeBytes: number;
  codePreview: string;
}

interface ScienceSummary {
  total: number;
  passed: number;
  kept: number;
  bestScore: number | null;
  latestAt: string | null;
  storePath: string;
  exists: boolean;
}

interface ScienceListResult {
  variants: ScienceVariantView[];
  best: ScienceVariantView | null;
  summary: ScienceSummary;
}

interface ScienceApi {
  listVariants: (cwd?: string) => Promise<unknown>;
  status: (cwd?: string) => Promise<unknown>;
}

function scienceApi(): ScienceApi | undefined {
  return (window as unknown as { electronAPI?: { science?: ScienceApi } }).electronAPI?.science;
}

function isListResult(v: unknown): v is ScienceListResult {
  return !!v && typeof v === 'object' && Array.isArray((v as ScienceListResult).variants);
}

function shortDate(iso: string): string {
  return iso ? iso.slice(0, 10) : '';
}

function metricLabel(m: ScienceVariantView['metric']): string {
  const name = m.name || 'métrique';
  const value = m.value === null ? '—' : String(m.value);
  return `${name} ${value}`;
}

/** A single scored experiment variant — hypothesis, gate status, metric, lineage, code preview. */
function VariantRow({ v, isBest }: { v: ScienceVariantView; isBest: boolean }) {
  return (
    <li className="rounded-md border border-border p-2.5 text-sm">
      <div className="flex items-center gap-2">
        {isBest && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500"
            title="Meilleur variant éligible"
          >
            ★ meilleur
          </span>
        )}
        {v.passedAll && v.regressions.length === 0 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-500">
            ✓ passe
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500">
            ✗ {v.regressions.length ? `regr: ${v.regressions.join(', ')}` : 'échec'}
          </span>
        )}
        {v.kept && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500"
            title="Approuvé par le keep-gate humain"
          >
            gardé
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums">score {v.score.toFixed(3)}</span>
      </div>

      <div className="mt-1 text-sm">
        {v.hypothesis || <span className="text-muted-foreground">(hypothèse vide)</span>}
      </div>

      <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="font-mono">{v.id.slice(0, 8) || '?'}</span>
        <span>{metricLabel(v.metric)}</span>
        {v.language && <span>{v.language}</span>}
        <span
          title={`exit ${v.execution.exitCode ?? '?'}${v.execution.timedOut ? ', timeout' : ''}`}
        >
          {v.execution.ok ? 'exéc ok' : 'exéc ko'}
          {v.execution.durationMs ? ` · ${v.execution.durationMs}ms` : ''}
        </span>
        {v.parentId && <span title={`Dérivé de ${v.parentId}`}>⇐ {v.parentId.slice(0, 8)}</span>}
        {v.createdAt && <span>{shortDate(v.createdAt)}</span>}
      </div>

      {v.detail && <div className="mt-0.5 text-xs">{v.detail}</div>}

      {v.codePreview && (
        <details className="mt-1">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Programme de l’expérience ({v.codeBytes} o)
          </summary>
          <pre className="mt-1 text-[11px] whitespace-pre-wrap bg-muted/40 rounded p-2 max-h-48 overflow-auto">
            {v.codePreview}
          </pre>
        </details>
      )}
    </li>
  );
}

export function SciencePanel({ onClose }: { onClose: () => void }) {
  const workingDir = useAppStore((s) => s.workingDir);
  const [activeTab, setActiveTab] = useState<'variants' | 'video'>('variants');
  const [data, setData] = useState<ScienceListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = scienceApi();
      if (!api) {
        setError('API AI-Scientist indisponible.');
        return;
      }
      const res = await api.listVariants(workingDir || undefined);
      setData(isListResult(res) ? res : { variants: [], best: null, summary: emptySummary() });
    } catch {
      setError('Impossible de lire les expériences.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [workingDir]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  // Newest-first ordering for the list (append-only store is oldest-first on disk).
  const variants = data ? [...data.variants].reverse() : [];
  const bestId = data?.best?.id ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-[860px] max-w-[93vw] max-h-[86vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="font-semibold">Laboratoire IA</span>
          {activeTab === 'variants' && summary && (
            <span className="text-xs text-muted-foreground">
              {summary.total} variant(s) · {summary.passed} passent
              {summary.kept > 0 ? ` · ${summary.kept} gardé(s)` : ''}
              {summary.bestScore !== null ? ` · meilleur ${summary.bestScore.toFixed(3)}` : ''}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {activeTab === 'variants' && (
              <button
                type="button"
                onClick={() => void load()}
                className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent"
              >
                ↻ Rafraîchir
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent"
            >
              Fermer
            </button>
          </div>
        </div>

        <div
          className="flex gap-1 border-b border-border px-4 pt-2"
          role="tablist"
          aria-label="Vues du laboratoire IA"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'variants'}
            className={`rounded-t-md px-3 py-2 text-xs ${activeTab === 'variants' ? 'border border-b-background border-border bg-background font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('variants')}
          >
            Variants scorés
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'video'}
            className={`rounded-t-md px-3 py-2 text-xs ${activeTab === 'video' ? 'border border-b-background border-border bg-background font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('video')}
          >
            Découvertes vidéo
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-5">
          {activeTab === 'video' ? (
            <VideoExperimentBacklog workingDir={workingDir || undefined} />
          ) : (
            <>
              {/* Read-only reminder: execution is CLI-only by design. */}
              <div className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
                Suivi en lecture seule. Lancer une expérience reste une action CLI :{' '}
                <code className="text-[11px]">
                  buddy science &quot;&lt;objectif&gt;&quot; --score
                </code>
                . Cette vue n’exécute jamais de code.
              </div>

              {loading ? (
                <div className="text-sm text-muted-foreground">Chargement…</div>
              ) : error ? (
                <div className="text-sm text-red-500">{error}</div>
              ) : !summary || summary.total === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Aucune expérience pour ce workspace.
                  <br />
                  Lance la boucle AI-Scientist en CLI :{' '}
                  <code className="text-xs">
                    buddy science &quot;&lt;objectif&gt;&quot; --score --metric accuracy
                  </code>
                  .
                </div>
              ) : (
                <>
                  {data?.best && (
                    <section>
                      <h3 className="text-sm font-semibold mb-2">Meilleur variant</h3>
                      <ul className="space-y-1.5">
                        <VariantRow v={data.best} isBest />
                      </ul>
                    </section>
                  )}

                  <section>
                    <h3 className="text-sm font-semibold mb-2">
                      Tous les variants{' '}
                      <span className="font-normal text-muted-foreground">· {variants.length}</span>
                    </h3>
                    <ul className="space-y-1.5">
                      {variants.map((v) => (
                        <VariantRow
                          key={v.id || v.createdAt}
                          v={v}
                          isBest={!!bestId && v.id === bestId}
                        />
                      ))}
                    </ul>
                  </section>
                </>
              )}

              {summary?.storePath && (
                <div
                  className="text-[10px] text-muted-foreground/70 truncate"
                  title={summary.storePath}
                >
                  Store : {summary.storePath}
                  {!summary.exists ? ' (absent)' : ''}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function emptySummary(): ScienceSummary {
  return {
    total: 0,
    passed: 0,
    kept: 0,
    bestScore: null,
    latestAt: null,
    storePath: '',
    exists: false,
  };
}
