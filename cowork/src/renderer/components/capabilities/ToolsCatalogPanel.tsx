/**
 * ToolsCatalogPanel — the agent's REAL tool registry, full page, with
 * Hermes-style per-tool gating.
 *
 * Backed by the `tools.list` IPC (the same registry the agent dispatches
 * from). Each tool carries a three-state gate — Défaut (profile/group
 * rules) / Autorisé / Refusé — persisted through `tools.setOverride` into
 * the core PolicyManager (`~/.codebuddy` policy config), the SAME policy the
 * tool-handler consults before every execution. Session overrides still
 * outrank these gates by design.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Search, Wrench, X } from 'lucide-react';

interface ToolEntry {
  name: string;
  description: string;
  category: string;
}

type Gate = 'allow' | 'deny' | null;

function GateButtons({ gate, onChange }: { gate: Gate; onChange: (gate: Gate) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-testid="tool-gate">
      <button
        type="button"
        title="Autoriser toujours"
        onClick={() => onChange(gate === 'allow' ? null : 'allow')}
        className={`rounded p-1 ${gate === 'allow' ? 'bg-success/20 text-success' : 'text-muted-foreground hover:text-success'}`}
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Refuser toujours"
        onClick={() => onChange(gate === 'deny' ? null : 'deny')}
        className={`rounded p-1 ${gate === 'deny' ? 'bg-destructive/20 text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToolsCatalogPanel() {
  const [tools, setTools] = useState<ToolEntry[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.tools
      ?.list()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setTools(list);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      });
    void window.electronAPI?.tools
      ?.getOverrides?.()
      .then((current) => {
        if (!cancelled && current) setOverrides(current);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setGate = useCallback((name: string, gate: Gate) => {
    // Optimistic; the IPC result re-syncs the authoritative map.
    setOverrides((prev) => {
      const next = { ...prev };
      if (gate === null) delete next[name];
      else next[name] = gate;
      return next;
    });
    void window.electronAPI?.tools
      ?.setOverride?.(name, gate)
      .then((result) => {
        if (result?.ok && result.overrides) setOverrides(result.overrides);
      })
      .catch(() => {});
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (tools ?? []).filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
    const byCategory = new Map<string, ToolEntry[]>();
    for (const tool of filtered) {
      const cat = tool.category || 'divers';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(tool);
    }
    return [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [tools, query]);

  const total = tools?.length ?? 0;
  const shown = groups.reduce((n, [, list]) => n + list.length, 0);
  const gated = Object.keys(overrides).length;

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="tools-catalog-panel">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un outil…"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none"
              data-testid="tools-catalog-search"
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {tools === null ? '…' : `${shown} / ${total} outils`}
            {gated > 0 ? ` · ${gated} gardé${gated > 1 ? 's' : ''}` : ''}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          ✓ / ✗ fixent une règle PERSISTANTE par outil (au-dessus des règles de groupe, sous les
          décisions de session). Re-cliquer retire la règle.
        </p>

        {tools !== null && total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Registre indisponible — le moteur embarqué n'est pas chargé.
          </p>
        ) : null}

        {groups.map(([category, list]) => (
          <section key={category}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {category} · {list.length}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((tool) => {
                const gate = (overrides[tool.name] as Gate) ?? null;
                return (
                  <div
                    key={tool.name}
                    className={`rounded-lg border p-3 ${
                      gate === 'deny' ? 'border-destructive/40 bg-destructive/5' : gate === 'allow' ? 'border-success/40 bg-surface' : 'border-border bg-surface'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <code className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{tool.name}</code>
                      <GateButtons gate={gate} onChange={(g) => setGate(tool.name, g)} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
