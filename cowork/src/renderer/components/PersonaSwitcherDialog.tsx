/**
 * PersonaSwitcherDialog — Claude Cowork parity Phase 3 step 11
 *
 * Cmd+Shift+P command palette for switching between identity files
 * (SOUL.md, USER.md, AGENTS.md…) and user-authored personas under
 * `.codebuddy/persona/*.md`. Supports preview, activate, and a read-only
 * content panel. Data loads lazily on open and refreshes on file changes
 * via the `identity.updated` renderer event.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UserCircle, FileText, Sparkles, Play, Search, RefreshCw } from 'lucide-react';

interface PersonaEntry {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  source: 'workspace' | 'global';
  kind: 'identity' | 'persona';
  mtime: number;
  size: number;
  active: boolean;
}

interface PersonaDetail extends PersonaEntry {
  content: string;
}

interface PersonaSwitcherDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PersonaSwitcherDialog({ isOpen, onClose }: PersonaSwitcherDialogProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PersonaEntry[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonaDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!window.electronAPI?.identity?.list) return;
    setIsLoading(true);
    setError(null);
    try {
      const list = (await window.electronAPI.identity.list()) as PersonaEntry[];
      setEntries(list);
      if (list.length > 0 && !selectedId) {
        const active = list.find((e) => e.active);
        setSelectedId(active?.id ?? list[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  // Subscribe to identity.updated events from main so hot-reload works
  useEffect(() => {
    const api = window.electronAPI as unknown as {
      onEvent?: (
        types: string | string[],
        cb: (event: { type: string; payload?: unknown }) => void,
      ) => () => void;
    };
    if (!api?.onEvent) return;
    const unsubscribe = api.onEvent(['identity.updated', 'identity.activated'], (event) => {
      if (event.type === 'identity.updated' && Array.isArray(event.payload)) {
        setEntries(event.payload as PersonaEntry[]);
      } else if (event.type === 'identity.activated') {
        void load();
      }
    });
    return unsubscribe;
  }, [load]);

  // Load detail when selection changes
  useEffect(() => {
    if (!selectedId || !isOpen) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      if (!window.electronAPI?.identity?.getDetail) return;
      try {
        const d = (await window.electronAPI.identity.getDetail(selectedId)) as PersonaDetail | null;
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) setDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        e.filePath.toLowerCase().includes(q)
    );
  }, [entries, query]);

  const handleActivate = useCallback(async () => {
    if (!selectedId || !window.electronAPI?.identity?.activate) return;
    setActivating(true);
    try {
      const result = await window.electronAPI.identity.activate(selectedId);
      if (!result.success) {
        setError(result.error ?? 'Activation failed');
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivating(false);
    }
  }, [selectedId, load]);

  // ESC closes
  useEffect(() => {
    if (!isOpen) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      } else if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
        ev.preventDefault();
        void handleActivate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, handleActivate]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-background/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[820px] max-w-[90vw] max-h-[70vh] rounded-xl bg-background border border-border shadow-2xl overflow-hidden flex flex-col"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              {t('personaSwitcher.title', 'Persona switcher')}
            </h2>
            <span className="text-[10px] text-text-muted">
              {t('personaSwitcher.shortcut', 'Cmd+Shift+P')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            aria-label={t('common.close', 'Close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-border-muted">
          <div className="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-1.5">
            <Search size={12} className="text-text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder={t('personaSwitcher.searchPlaceholder', 'Search personas…')}
              className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted"
            />
            <button
              onClick={() => void load()}
              disabled={isLoading}
              className="p-1 rounded hover:bg-surface-hover text-text-muted"
              title={t('common.refresh', 'Refresh')}
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-error bg-error/10 border-b border-error/30">
            {error}
          </div>
        )}

        <div className="flex-1 grid grid-cols-[280px_1fr] overflow-hidden">
          <div className="border-r border-border-muted overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-text-muted">
                {isLoading
                  ? t('common.loading', 'Loading…')
                  : t('personaSwitcher.empty', 'No personas found')}
              </div>
            )}
            {filtered.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
                className={`w-full text-left px-3 py-2 border-b border-border-muted transition-colors ${
                  selectedId === entry.id ? 'bg-accent/10' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-start gap-2">
                  {entry.kind === 'identity' ? (
                    <FileText size={12} className="mt-0.5 text-text-muted shrink-0" />
                  ) : (
                    <UserCircle size={12} className="mt-0.5 text-accent shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-text-primary truncate">
                        {entry.name}
                      </span>
                      {entry.active && (
                        <span className="text-[9px] uppercase tracking-wide text-success bg-success/10 px-1 rounded">
                          {t('personaSwitcher.active', 'Active')}
                        </span>
                      )}
                    </div>
                    {entry.description && (
                      <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2">
                        {entry.description}
                      </p>
                    )}
                    <p className="text-[9px] text-text-muted mt-0.5 font-mono truncate">
                      {entry.source} · {entry.kind}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-col overflow-hidden">
            {detail ? (
              <>
                <div className="px-4 py-3 border-b border-border-muted">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{detail.name}</h3>
                      <p className="text-[10px] text-text-muted font-mono mt-0.5 truncate">
                        {detail.filePath}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleActivate()}
                      disabled={activating || detail.active}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                    >
                      <Play size={10} />
                      {detail.active
                        ? t('personaSwitcher.active', 'Active')
                        : t('personaSwitcher.activate', 'Activate')}
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">
                    {detail.content}
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
                {t('personaSwitcher.selectHint', 'Select a persona to preview')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
