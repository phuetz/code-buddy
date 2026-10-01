/**
 * EvolutionPanel — lists the versions of Code Buddy the recursive self-improvement loop generated
 * (`buddy evolve`). Read-only: fetches the workspace's variant store via the `evolve.listVariants`
 * IPC and shows the genealogy grouped by generation. Opened from the new-shell Labs launcher.
 *
 * Keep it honest: keeping/merging a variant stays a human-gated CLI action (`buddy evolve keep`);
 * this panel only *shows* what evolution produced.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { groupByGeneration, isWinner, type EvolvedVariant } from './evolution-panel-helpers';

export function EvolutionPanel({ onClose }: { onClose: () => void }) {
  const workingDir = useAppStore((s) => s.workingDir);
  const [variants, setVariants] = useState<EvolvedVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = (window as unknown as { electronAPI?: { evolve?: { listVariants: (cwd?: string) => Promise<unknown> } } }).electronAPI;
      const rows = (await api?.evolve?.listVariants(workingDir || undefined)) as EvolvedVariant[] | undefined;
      setVariants(Array.isArray(rows) ? rows : []);
    } catch {
      setError('Impossible de lire les versions évoluées.');
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, [workingDir]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = groupByGeneration(variants);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-[820px] max-w-[92vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="font-semibold">Évolution — versions générées</span>
          <span className="text-xs text-muted-foreground">{variants.length} variant(s)</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => void load()} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent">
              ↻ Rafraîchir
            </button>
            <button type="button" onClick={onClose} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent">
              Fermer
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Chargement…</div>
          ) : error ? (
            <div className="text-sm text-red-500">{error}</div>
          ) : variants.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Aucune version évaluée pour ce workspace.
              <br />
              Évaluer une variante de code : <code className="text-xs">CODEBUDDY_EVOLVE=true buddy evolve run --goal &quot;&lt;faiblesse&gt;&quot;</code>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <section key={g.generation}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                    Génération {g.generation} <span className="font-normal">· {g.variants.length}</span>
                  </h3>
                  <ul className="space-y-1.5">
                    {g.variants.map((v) => (
                      <li key={v.id} className="rounded-md border border-border p-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{v.id}</span>
                          {isWinner(v) ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-500">✓ passe</span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-500">
                              ✗ {v.regressions.length ? `regr: ${v.regressions.join(', ')}` : 'échec'}
                            </span>
                          )}
                          <span className="ml-auto text-xs tabular-nums">score {v.score.toFixed(3)}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                          {v.behavior && <span>niche {v.behavior}</span>}
                          {(v.parents ?? []).length > 0 && <span>⇐ {(v.parents ?? []).join(', ')}</span>}
                          <span>{v.createdAt.slice(0, 10)}</span>
                        </div>
                        {v.detail && <div className="mt-0.5 text-xs">{v.detail}</div>}
                        {v.plan && (
                          <details className="mt-1">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              Plan qui a produit cette version
                            </summary>
                            <pre className="mt-1 text-[11px] whitespace-pre-wrap bg-muted/40 rounded p-2 max-h-48 overflow-auto">{v.plan}</pre>
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
