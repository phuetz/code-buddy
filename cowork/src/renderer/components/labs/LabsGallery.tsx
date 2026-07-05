/**
 * LabsGallery — a browsable shelf that surfaces the dormant "Genspark" panel components.
 *
 * ~two dozen props-driven components were built but never mounted (`genspark-slices.ts`). This
 * gallery lists the `panel`/`labs` ones grouped by category; clicking a card opens that component
 * in a right-side drawer, rendered with HONEST empty-state props (empty arrays / zeroed summaries)
 * so each shows its own clean empty state. Components are lazy-loaded (code-split) so the gallery
 * stays light, and each is wrapped in a {@link PanelErrorBoundary} with `fallback={null}` — one
 * broken component can never crash the shelf.
 *
 * This is a discoverability surface, not a workflow: the components render with no live data and
 * no-op callbacks. Wiring real data/callbacks per component belongs to its eventual mount point.
 *
 * @module renderer/components/labs/LabsGallery
 */
import { Suspense, lazy, useMemo, useState } from 'react';
import type { LazyExoticComponent } from 'react';
import { PanelErrorBoundary } from '../PanelErrorBoundary';
import {
  LABS_ENTRIES,
  LABS_CATEGORY_LABELS,
  type LabsComponent,
  type LabsEntry,
} from './labs-catalog';
import type { GensparkSlice } from '../genspark-slices';

// Stable lazy components, created once at module scope (never re-created on render).
const LAZY: Record<string, LazyExoticComponent<LabsComponent>> = Object.fromEntries(
  LABS_ENTRIES.map((e) => [e.slice.id, lazy(e.load)]),
);

/** Group entries by category, preserving first-appearance order of both categories and entries. */
function groupByCategory(entries: LabsEntry[]): Array<{
  category: GensparkSlice['category'];
  label: string;
  entries: LabsEntry[];
}> {
  const order: GensparkSlice['category'][] = [];
  const buckets = new Map<GensparkSlice['category'], LabsEntry[]>();
  for (const entry of entries) {
    const cat = entry.slice.category;
    if (!buckets.has(cat)) {
      buckets.set(cat, []);
      order.push(cat);
    }
    buckets.get(cat)!.push(entry);
  }
  return order.map((category) => ({
    category,
    label: LABS_CATEGORY_LABELS[category] ?? category,
    entries: buckets.get(category)!,
  }));
}

function GalleryCard({ entry, onOpen }: { entry: LabsEntry; onOpen: () => void }) {
  const { slice } = entry;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border border-border bg-background hover:bg-accent transition-colors p-3 flex flex-col gap-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{slice.title}</span>
        <span className="shrink-0 text-[10px] font-mono text-muted-foreground rounded bg-accent/60 px-1.5 py-0.5">
          {slice.id}
        </span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3">{slice.needsData}</p>
    </button>
  );
}

/** Right-side drawer previewing one component with empty-state props. */
function PreviewDrawer({ entry, onClose }: { entry: LabsEntry; onClose: () => void }) {
  const Lazy = LAZY[entry.slice.id]!;
  return (
    <aside className="w-[clamp(320px,38vw,520px)] shrink-0 border-l border-border flex flex-col min-h-0 bg-background">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="font-semibold truncate">{entry.slice.title}</div>
          <div className="text-[11px] text-muted-foreground">
            {entry.slice.id} · état vide (aperçu sans données)
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l’aperçu"
          className="shrink-0 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent transition-colors"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-auto p-3">
        {/* Error boundary OUTSIDE Suspense: catches both a chunk-load failure and a render throw. */}
        <PanelErrorBoundary name={`Labs:${entry.slice.id}`} resetKey={entry.slice.id} fallback={null}>
          <Suspense
            fallback={<div className="text-xs text-muted-foreground p-2">Chargement…</div>}
          >
            <Lazy {...entry.props} />
          </Suspense>
        </PanelErrorBoundary>
      </div>
    </aside>
  );
}

export function LabsGallery() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groups = useMemo(() => groupByCategory(LABS_ENTRIES), []);
  const selected = useMemo(
    () => LABS_ENTRIES.find((e) => e.slice.id === selectedId) ?? null,
    [selectedId],
  );

  return (
    <div className="h-full min-h-0 flex overflow-hidden" data-testid="labs-gallery">
      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-6 space-y-6">
        <header>
          <h2 className="text-lg font-semibold mb-1">
            Labs <span className="text-xs font-normal text-muted-foreground">· composants</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            {LABS_ENTRIES.length} composants inspirés de Genspark, construits mais dormants. Clique
            une carte pour l’ouvrir en aperçu (état vide, sans données). Le câblage aux vraies
            données arrive à leur point de montage.
          </p>
        </header>

        {groups.map((group) => (
          <section key={group.category}>
            <h3 className="text-sm font-semibold mb-3 text-foreground/90">{group.label}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {group.entries.map((entry) => (
                <GalleryCard
                  key={entry.slice.id}
                  entry={entry}
                  onOpen={() => setSelectedId(entry.slice.id)}
                />
              ))}
            </div>
          </section>
        ))}

        {LABS_ENTRIES.length === 0 && (
          <div className="text-sm text-muted-foreground">Aucun composant Labs disponible.</div>
        )}
      </div>

      {selected && <PreviewDrawer entry={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
