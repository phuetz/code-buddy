/**
 * BookmarksPanel — Phase 3 step 4
 *
 * Slide-out panel listing every starred message across all
 * sessions/projects with live filtering and direct navigation to
 * the host session.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, X, Search, Trash2, MessageCircle, User2 } from 'lucide-react';
import { useAppStore } from '../store';
import { formatAppDateTime } from '../utils/i18n-format';
import { ScreenHelpButton } from './ScreenHelpButton';

interface Bookmark {
  id: number;
  sessionId: string;
  projectId?: string | null;
  messageId: string;
  preview: string;
  note?: string | null;
  role?: string | null;
  createdAt: number;
}

export function BookmarksPanel() {
  const { t } = useTranslation();
  const showBookmarksPanel = useAppStore((s) => s.showBookmarksPanel);
  const setShowBookmarksPanel = useAppStore((s) => s.setShowBookmarksPanel);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const toggleBookmarkedMessage = useAppStore((s) => s.toggleBookmarkedMessage);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<'project' | 'all'>('project');

  const load = useCallback(async () => {
    if (!window.electronAPI?.bookmarks?.list) return;
    setLoading(true);
    try {
      const result = await window.electronAPI.bookmarks.list(
        scope === 'project' ? activeProjectId : null,
        200
      );
      setBookmarks(result as Bookmark[]);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, scope]);

  useEffect(() => {
    if (showBookmarksPanel) load();
  }, [showBookmarksPanel, load]);

  const filtered = bookmarks.filter((b) =>
    query.trim() === ''
      ? true
      : `${b.preview} ${b.note ?? ''}`.toLowerCase().includes(query.toLowerCase())
  );

  const handleNavigate = (bookmark: Bookmark) => {
    setActiveSession(bookmark.sessionId);
    setShowBookmarksPanel(false);
    // Scroll to message via hash after navigation settles
    requestAnimationFrame(() => {
      const el = document.getElementById(`message-${bookmark.messageId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const handleRemove = async (bookmark: Bookmark) => {
    await window.electronAPI?.bookmarks?.remove(bookmark.id);
    toggleBookmarkedMessage(bookmark.messageId, false);
    load();
  };

  if (!showBookmarksPanel) return null;

  return (
    <div
      className="fixed inset-y-0 right-0 z-40 w-96 bg-background border-l border-border shadow-2xl flex flex-col"
      data-testid="bookmarks-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Star size={16} className="text-warning fill-warning" />
          <h2 className="text-sm font-semibold text-text-primary">{t('bookmarks.title')}</h2>
          <span className="text-xs text-text-muted">({filtered.length})</span>
        </div>
        <div className="flex items-center gap-1">
        <ScreenHelpButton screenId="bookmarks" />
        <button
          onClick={() => setShowBookmarksPanel(false)}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          aria-label={t('common.close')}
        >
          <X size={16} />
        </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b border-border space-y-2">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            data-testid="bookmarks-search-input"
            placeholder={t('bookmarks.searchPlaceholder')}
            className="w-full pl-7 pr-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setScope('project')}
            data-testid="bookmarks-scope-project"
            className={`flex-1 text-xs px-2 py-1 rounded transition-colors ${
              scope === 'project'
                ? 'bg-accent/20 text-accent'
                : 'bg-surface text-text-muted hover:text-text-primary'
            }`}
          >
            {t('bookmarks.scopeProject')}
          </button>
          <button
            onClick={() => setScope('all')}
            data-testid="bookmarks-scope-all"
            className={`flex-1 text-xs px-2 py-1 rounded transition-colors ${
              scope === 'all'
                ? 'bg-accent/20 text-accent'
                : 'bg-surface text-text-muted hover:text-text-primary'
            }`}
          >
            {t('bookmarks.scopeAll')}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-4 text-xs text-text-muted">{t('common.loading')}</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-text-muted">
            {t('bookmarks.empty')}
          </div>
        )}
        {!loading &&
          filtered.map((bookmark) => (
            <div
              key={bookmark.id}
              data-testid={`bookmark-row-${bookmark.id}`}
              className="px-4 py-3 border-b border-border-muted hover:bg-surface-hover transition-colors group"
            >
              <div className="flex items-start gap-2">
                {bookmark.role === 'user' ? (
                  <User2 size={12} className="text-text-muted shrink-0 mt-0.5" />
                ) : (
                  <MessageCircle size={12} className="text-text-muted shrink-0 mt-0.5" />
                )}
                <button
                  onClick={() => handleNavigate(bookmark)}
                  className="flex-1 text-left min-w-0"
                >
                  <p className="text-xs text-text-primary line-clamp-3 break-words">
                    {bookmark.preview}
                  </p>
                  {bookmark.note && (
                    <p className="text-[10px] text-text-muted mt-1 italic">{bookmark.note}</p>
                  )}
                  <p className="text-[10px] text-text-muted mt-1">
                    {formatAppDateTime(bookmark.createdAt)}
                  </p>
                </button>
                <button
                  onClick={() => handleRemove(bookmark)}
                  data-testid={`bookmark-remove-${bookmark.id}`}
                  className="p-1 rounded hover:bg-error/20 text-text-muted hover:text-error opacity-0 group-hover:opacity-100 transition-all"
                  title={t('bookmarks.remove')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
