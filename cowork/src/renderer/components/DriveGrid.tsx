/**
 * DriveGrid — searchable, taggable AI Drive item surface.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/DriveGrid
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Search, Tag } from 'lucide-react';
import { filterDrive, groupByType, type DriveItem } from '../utils/drive-index';

export interface DriveGridProps {
  items: DriveItem[];
  onOpen: (item: DriveItem) => void;
  onTag: (item: DriveItem, tag: string) => void;
}

function formatDriveDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'inconnu';
  return new Date(ts).toLocaleDateString();
}

export function DriveGrid({ items, onOpen, onTag }: DriveGridProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [newTag, setNewTag] = useState('');
  const tags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags))).sort(), [items]);
  const visible = filterDrive(items, query, selectedTag ? [selectedTag] : []);
  const groups = groupByType(visible);
  const activeTypes = Object.entries(groups).filter(([, group]) => group.length > 0);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="drive-grid">
      <div className="flex flex-col gap-3 border-b border-border pb-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <FolderOpen aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('genspark.drive.title', 'AI Drive')}</h2>
            <p className="text-xs text-muted-foreground">
              {visible.length}/{items.length} livrables visibles
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1" htmlFor="drive-query">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="drive-query"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              data-testid="drive-query"
              placeholder={t('genspark.drive.search', 'Rechercher')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label={t('genspark.drive.tagFilter', 'Filtrer par tag')}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            data-testid="drive-tag-filter"
            value={selectedTag}
            onChange={(event) => setSelectedTag(event.target.value)}
          >
            <option value="">{t('genspark.drive.allTags', 'Tous les tags')}</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.drive.empty', 'Aucun livrable ne correspond aux filtres.')}
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {activeTypes.map(([type, group]) => (
            <section key={type}>
              <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">{type}</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-lg border border-border bg-background p-3"
                    data-testid={`drive-item-${item.id}`}
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      data-testid={`drive-open-${item.id}`}
                      onClick={() => onOpen(item)}
                    >
                      <h4 className="truncate text-sm font-medium text-foreground" title={item.title}>
                        {item.title}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDriveDate(item.updatedAt)}</p>
                    </button>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = newTag.trim();
                        if (!trimmed) return;
                        onTag(item, trimmed);
                        setNewTag('');
                      }}
                    >
                      <input
                        aria-label={`Tag pour ${item.title}`}
                        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        data-testid={`drive-tag-input-${item.id}`}
                        value={newTag}
                        onChange={(event) => setNewTag(event.target.value)}
                      />
                      <button
                        type="submit"
                        aria-label={t('genspark.drive.addTag', 'Ajouter un tag')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        data-testid={`drive-tag-submit-${item.id}`}
                      >
                        <Tag aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </form>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
