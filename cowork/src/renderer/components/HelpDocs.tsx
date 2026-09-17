import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Book, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import {
  HELP_COPY_FIELDS,
  SHELL_NAV_TREE,
  helpCopyKey,
  helpGroupKey,
  listShellNavScreenIds,
  type ShellNavScreenId,
} from '../help/shell-nav-catalog';

const SCREEN_IDS = listShellNavScreenIds();

function isScreenId(value: string | null | undefined): value is ShellNavScreenId {
  return Boolean(value && (SCREEN_IDS as string[]).includes(value));
}

export function HelpDocs({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const anchor = useAppStore((s) => s.helpDocsAnchor);
  const searchRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<ShellNavScreenId>(() =>
    isScreenId(anchor) ? anchor : SCREEN_IDS[0]!
  );

  useEffect(() => {
    if (isScreenId(anchor)) {
      setActiveId(anchor);
      setQuery('');
    }
  }, [anchor]);

  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    articleRef.current?.scrollTo({ top: 0 });
  }, [activeId]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return SHELL_NAV_TREE.map((group) => {
      const actions = group.actions.filter((id) => {
        if (!needle) return true;
        const haystack = HELP_COPY_FIELDS.map((field) =>
          t(helpCopyKey(id, field), '')
        )
          .concat(id, t(helpGroupKey(group.id), group.id))
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      });
      return { ...group, actions };
    }).filter((group) => group.actions.length > 0);
  }, [query, t]);

  const visibleIds = useMemo(
    () => filteredGroups.flatMap((group) => [...group.actions]),
    [filteredGroups]
  );

  useEffect(() => {
    if (visibleIds.length === 0) return;
    if (!visibleIds.includes(activeId)) {
      setActiveId(visibleIds[0]!);
    }
  }, [visibleIds, activeId]);

  const moveSelection = (delta: number) => {
    if (visibleIds.length === 0) return;
    const current = Math.max(0, visibleIds.indexOf(activeId));
    const next = (current + delta + visibleIds.length) % visibleIds.length;
    setActiveId(visibleIds[next]!);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      articleRef.current?.focus();
    }
  };

  const purpose = t(helpCopyKey(activeId, 'purpose'), t('helpDocs.undocumented', 'To be documented'));
  const when = t(helpCopyKey(activeId, 'when'), t('helpDocs.undocumented', 'To be documented'));
  const prerequisites = t(helpCopyKey(activeId, 'prerequisites'), '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200"
      data-testid="help-docs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-docs-title"
    >
      <div className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-border bg-surface/50 p-4">
          <div className="flex items-center gap-2 text-text">
            <Book className="h-5 w-5" />
            <h2 id="help-docs-title" className="font-semibold">
              {t('helpDocs.title', 'Cowork help')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-background hover:text-text"
            aria-label={t('common.close', 'Close')}
            data-testid="help-docs-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="border-b border-border px-4 py-2 text-[11px] text-text-muted">
          {t('helpDocs.keyboardHint', 'F1 opens this index. Escape closes it.')}
        </p>

        <div className="flex min-h-0 flex-1">
          <nav
            className="flex w-64 shrink-0 flex-col border-r border-border bg-background-secondary/80"
            aria-label={t('helpDocs.indexTitle', 'All screens')}
          >
            <div className="relative border-b border-border px-3 py-2">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={t('helpDocs.searchPlaceholder', 'Search screens…')}
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                data-testid="help-docs-search"
              />
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {filteredGroups.length === 0 ? (
                <p className="px-3 py-4 text-xs text-text-muted" data-testid="help-docs-empty">
                  {t('helpDocs.noResults', 'No screen matches.')}
                </p>
              ) : (
                filteredGroups.map((group) => (
                  <div key={group.id} className="mb-2">
                    <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                      {t(helpGroupKey(group.id), group.id)}
                    </div>
                    {group.actions.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setActiveId(id)}
                        data-testid={`help-docs-nav-${id}`}
                        className={`flex w-full px-3 py-1.5 text-left text-xs transition-colors ${
                          id === activeId
                            ? 'bg-accent/10 font-medium text-accent'
                            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                        }`}
                      >
                        {t(helpCopyKey(id, 'title'), id)}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </nav>

          <article
            ref={articleRef}
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-y-auto p-6 text-text outline-none"
            data-testid="help-docs-article"
            data-help-screen={activeId}
          >
            <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
              {t('helpDocs.indexTitle', 'All screens')}
            </p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em]" data-testid="help-docs-article-title">
              {t(helpCopyKey(activeId, 'title'), activeId)}
            </h3>

            <section className="mt-5 space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('helpDocs.purposeLabel', 'What it is for')}
              </h4>
              <p className="text-sm leading-relaxed" data-testid="help-docs-purpose">
                {purpose}
              </p>
            </section>

            <section className="mt-4 space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('helpDocs.whenLabel', 'When to use it')}
              </h4>
              <p className="text-sm leading-relaxed" data-testid="help-docs-when">
                {when}
              </p>
            </section>

            <section className="mt-4 space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('helpDocs.prerequisitesLabel', 'What you need first')}
              </h4>
              <p className="text-sm leading-relaxed" data-testid="help-docs-prerequisites">
                {prerequisites.trim()
                  ? prerequisites
                  : t('helpDocs.none', 'Nothing extra.')}
              </p>
            </section>
          </article>
        </div>
      </div>
    </div>
  );
}
