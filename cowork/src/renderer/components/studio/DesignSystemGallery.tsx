/**
 * App Studio — visual gallery for browsing the 150 brand design systems.
 *
 * A searchable modal grid (name + category + color swatches + tagline) so picking
 * a brand is a "see it first" experience instead of a long dropdown. Presentational:
 * reads the bundled catalog, calls onSelect(id) + onClose on pick.
 */

import { Check, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DESIGN_SYSTEMS } from './design-systems-catalog.js';

export interface DesignSystemGalleryProps {
  open: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function DesignSystemGallery({ open, selectedId, onSelect, onClose }: DesignSystemGalleryProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DESIGN_SYSTEMS;
    return DESIGN_SYSTEMS.filter((s) =>
      `${s.id} ${s.name} ${s.category} ${s.tagline}`.toLowerCase().includes(q),
    );
  }, [query]);

  if (!open) return null;

  const pick = (id: string) => {
    onSelect(id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Galerie des styles de design"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a style — Spotify, brutalist, minimal, fintech…"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Search a style"
          />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {filtered.length}/{DESIGN_SYSTEMS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => pick('')}
            className={`flex flex-col justify-center gap-1 rounded-md border p-2.5 text-left hover:border-accent ${
              !selectedId ? 'border-accent bg-accent/10' : 'border-border bg-background'
            }`}
          >
            <span className="text-sm font-medium text-foreground">None (neutral)</span>
            <span className="text-[11px] text-muted-foreground">Generation with no imposed branding.</span>
          </button>

          {filtered.map((system) => {
            const selected = selectedId === system.id;
            return (
              <button
                key={system.id}
                type="button"
                onClick={() => pick(system.id)}
                title={system.tagline}
                className={`flex flex-col gap-1.5 rounded-md border p-2.5 text-left transition-colors hover:border-accent ${
                  selected ? 'border-accent bg-accent/10' : 'border-border bg-background'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{system.name}</span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" /> : null}
                </div>
                {system.colors && system.colors.length > 0 ? (
                  <span className="flex gap-1" aria-hidden="true">
                    {system.colors.slice(0, 6).map((color, index) => (
                      <span
                        key={`${color}-${index}`}
                        className="h-4 flex-1 rounded-sm border border-border/50"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                ) : null}
                <span className="truncate text-[11px] font-medium text-muted-foreground">{system.category}</span>
                <span className="line-clamp-2 text-[11px] text-muted-foreground">{system.tagline}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
