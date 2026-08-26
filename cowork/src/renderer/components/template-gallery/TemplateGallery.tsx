import { useMemo, useState } from 'react';
import { TemplateThumbnail } from './TemplateThumbnail.js';
import { DEFAULT_TEMPLATES, filterTemplates, type TemplateGalleryItem } from './template-kinds.js';

export interface TemplateGalleryProps {
  items?: TemplateGalleryItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function TemplateGallery({ items = DEFAULT_TEMPLATES, selectedId, onSelect }: TemplateGalleryProps) {
  const [query, setQuery] = useState('');
  const visibleItems = useMemo(() => filterTemplates(items, query), [items, query]);

  return (
    <section className="rounded-xl border border-border bg-surface p-4 text-foreground">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Templates</p>
          <h2 className="text-lg font-semibold">Choose what to create</h2>
          <p className="text-sm text-muted-foreground">Schematic thumbnails to preview the shape of the deliverable.</p>
        </div>
        <label className="text-sm text-muted-foreground">
          Search
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Dashboard, API, document…"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary sm:w-64"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visibleItems.map((item) => {
          const selected = item.id === selectedId;

          return (
            <button
              key={item.id}
              type="button"
              aria-label={`Select ${item.name}`}
              aria-pressed={selected}
              onClick={() => onSelect?.(item.id)}
              className={`group rounded-xl border bg-background p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-sm ${
                selected ? 'border-primary ring-2 ring-primary/25' : 'border-border'
              }`}
              style={{ borderColor: selected ? item.accent : undefined }}
            >
              <div className="aspect-[16/10] overflow-hidden rounded-xl border border-border bg-muted/30">
                <TemplateThumbnail kind={item.kind} accent={item.accent} />
              </div>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{item.name}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.tagline}</p>
                </div>
                <span
                  className="mt-0.5 h-3 w-3 shrink-0 rounded-full border border-border"
                  style={{ background: item.accent ?? 'var(--color-accent)' }}
                  aria-hidden="true"
                />
              </div>
            </button>
          );
        })}
      </div>

      {visibleItems.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No template matches this search.
        </div>
      )}
    </section>
  );
}
