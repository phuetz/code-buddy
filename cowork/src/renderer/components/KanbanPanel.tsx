/**
 * KanbanPanel — Hermes Kanban board (CLI parity → Cowork)
 *
 * CRUD surface for the persistent workspace board that `buddy hermes kanban`
 * manages (`<cwd>/.codebuddy/kanban-board.json`). Columns by status; create,
 * complete, block/unblock, comment, and link cards. All mutations go through
 * the `hermes.kanban.*` IPC bridge against the active workspace cwd.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Archive, CheckCircle2, Link2, Loader2, MessageSquare, Plus, X } from 'lucide-react';
import { useAppStore } from '../store';
import { dialogA11yProps, trapFocus } from '../utils/a11y';
import type {
  KanbanBoardInfoPayload,
  KanbanCardPayload,
  KanbanPriority,
  KanbanStatus,
  HermesKanbanApi,
} from '../types/hermes';

interface KanbanPanelProps {
  onClose: () => void;
}

const COLUMNS: { status: KanbanStatus; labelKey: string; fallback: string }[] = [
  { status: 'todo', labelKey: 'kanban.todo', fallback: 'To do' },
  { status: 'in_progress', labelKey: 'kanban.inProgress', fallback: 'In progress' },
  { status: 'blocked', labelKey: 'kanban.blocked', fallback: 'Blocked' },
  { status: 'done', labelKey: 'kanban.done', fallback: 'Done' },
];

const PRIORITIES: KanbanPriority[] = ['low', 'medium', 'high', 'urgent'];

function getKanbanApi(): HermesKanbanApi | undefined {
  return (window as unknown as { electronAPI?: { tools?: { hermesKanban?: HermesKanbanApi } } })
    .electronAPI?.tools?.hermesKanban;
}

export function KanbanPanel({ onClose }: KanbanPanelProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const workingDir = useAppStore((s) => s.workingDir);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const cwd = useMemo(
    () => sessions.find((s) => s.id === activeSessionId)?.cwd ?? workingDir ?? undefined,
    [activeSessionId, sessions, workingDir],
  );

  const [cards, setCards] = useState<KanbanCardPayload[]>([]);
  const [boards, setBoards] = useState<KanbanBoardInfoPayload[]>([]);
  const [currentBoard, setCurrentBoard] = useState<string>('default');
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardSlug, setNewBoardSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<KanbanPriority>('medium');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (dialogRef.current) return trapFocus(dialogRef.current);
  }, []);

  const refresh = useCallback(async () => {
    const api = getKanbanApi();
    if (!api) {
      setError(t('kanban.notAvailable', 'Kanban bridge is not available.'));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (api.boards?.list) {
        const boardRes = await api.boards.list({ cwd });
        if (boardRes.ok && boardRes.boards) {
          setBoards(boardRes.boards);
          setCurrentBoard(boardRes.boards.find((b) => b.current)?.slug ?? 'default');
        }
      }
      const res = await api.list({ cwd, filter: { includeDone: true } });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load board.');
      setCards(res.cards ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchBoard = async (slug: string) => {
    const api = getKanbanApi();
    if (!api?.boards?.switch) return;
    setBusy(true);
    try {
      const res = await api.boards.switch({ cwd, slug });
      if (!res.ok) throw new Error(res.error ?? 'Failed to switch board.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createBoard = async () => {
    const slug = newBoardSlug.trim();
    if (!slug) return;
    const api = getKanbanApi();
    if (!api?.boards?.create) return;
    setBusy(true);
    try {
      const res = await api.boards.create({ cwd, slug });
      if (!res.ok) throw new Error(res.error ?? 'Failed to create board.');
      setNewBoardSlug('');
      setCreatingBoard(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runMutation = async (fn: (api: HermesKanbanApi) => Promise<{ ok: boolean; error?: string }>) => {
    const api = getKanbanApi();
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fn(api);
      if (!res.ok) throw new Error(res.error ?? 'Action failed.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createCard = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await runMutation((api) => api.create({ cwd, input: { title, priority: newPriority } }));
    setNewTitle('');
  };

  const byStatus = (status: KanbanStatus) => cards.filter((card) => card.status === status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        data-testid="kanban-panel"
        {...dialogA11yProps(t('kanban.title', 'Hermes Kanban board'))}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {t('kanban.title', 'Hermes Kanban board')}
            </h2>
            {/* Board switcher (multi-board) */}
            <select
              aria-label={t('kanban.boardSwitcher', 'Active board')}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-primary"
              data-testid="kanban-board-switcher"
              disabled={busy}
              onChange={(e) => void switchBoard(e.target.value)}
              value={currentBoard}
            >
              {boards.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.name} ({b.cardCount})
                </option>
              ))}
            </select>
            {creatingBoard ? (
              <input
                autoFocus
                className="w-28 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-primary"
                data-testid="kanban-new-board-slug"
                disabled={busy}
                onBlur={() => !newBoardSlug.trim() && setCreatingBoard(false)}
                onChange={(e) => setNewBoardSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createBoard();
                  if (e.key === 'Escape') setCreatingBoard(false);
                }}
                placeholder={t('kanban.newBoardSlug', 'new-board-slug')}
                value={newBoardSlug}
              />
            ) : (
              <button
                aria-label={t('kanban.newBoard', 'New board')}
                className="rounded border border-border bg-surface p-0.5 text-text-muted hover:border-accent hover:text-accent"
                data-testid="kanban-new-board"
                disabled={busy}
                onClick={() => setCreatingBoard(true)}
                title={t('kanban.newBoard', 'New board')}
                type="button"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          <button
            aria-label={t('common.close', 'Close')}
            className="rounded p-1 text-text-muted hover:bg-surface hover:text-text-primary"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        {/* Create row */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <input
            className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
            data-testid="kanban-new-title"
            disabled={busy}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createCard();
            }}
            placeholder={t('kanban.newCardPlaceholder', 'New card title…')}
            value={newTitle}
          />
          <select
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
            disabled={busy}
            onChange={(e) => setNewPriority(e.target.value as KanbanPriority)}
            value={newPriority}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <button
            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            data-testid="kanban-create"
            disabled={busy || !newTitle.trim()}
            onClick={createCard}
            type="button"
          >
            <Plus size={13} />
            {t('kanban.add', 'Add')}
          </button>
        </div>

        {error ? (
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
            <AlertTriangle size={13} className="shrink-0" />
            {error}
          </div>
        ) : null}

        {/* Columns */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t('kanban.loading', 'Loading board…')}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {COLUMNS.map((column) => {
                const columnCards = byStatus(column.status);
                return (
                  <div
                    key={column.status}
                    className="flex min-h-[120px] flex-col rounded border border-border-muted bg-surface/40 p-2"
                    data-testid={`kanban-column-${column.status}`}
                  >
                    <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-text-muted">
                      <span>{t(column.labelKey, column.fallback)}</span>
                      <span className="rounded bg-background px-1.5 py-0.5">{columnCards.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {columnCards.map((card) => (
                        <KanbanCardView
                          key={card.id}
                          busy={busy}
                          card={card}
                          onBlock={(reason) =>
                            runMutation((api) => api.block({ cwd, id: card.id, reason }))
                          }
                          onComment={(text) =>
                            runMutation((api) => api.comment({ cwd, id: card.id, text }))
                          }
                          onArchive={() => runMutation((api) => api.archive({ cwd, id: card.id }))}
                          onComplete={() => runMutation((api) => api.complete({ cwd, id: card.id }))}
                          onLink={(target) =>
                            runMutation((api) => api.link({ cwd, id: card.id, target }))
                          }
                          onUnblock={() => runMutation((api) => api.unblock({ cwd, id: card.id }))}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const KanbanCardView: React.FC<{
  busy: boolean;
  card: KanbanCardPayload;
  onArchive: () => void;
  onBlock: (reason: string) => void;
  onComment: (text: string) => void;
  onComplete: () => void;
  onLink: (target: string) => void;
  onUnblock: () => void;
}> = ({ busy, card, onArchive, onBlock, onComment, onComplete, onLink, onUnblock }) => {
  const { t } = useTranslation();
  const [drawer, setDrawer] = useState<'none' | 'comment' | 'block' | 'link'>('none');
  const [text, setText] = useState('');

  const submitDrawer = () => {
    const value = text.trim();
    if (!value) return;
    if (drawer === 'comment') onComment(value);
    else if (drawer === 'block') onBlock(value);
    else if (drawer === 'link') onLink(value);
    setText('');
    setDrawer('none');
  };

  const priorityTone =
    card.priority === 'urgent' || card.priority === 'high' ? 'text-warning' : 'text-text-muted';

  return (
    <div className="rounded border border-border-muted bg-background px-2 py-1.5 text-xs" data-testid={`kanban-card-${card.id}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words text-text-primary">{card.title}</span>
        <span className={`shrink-0 text-[9px] uppercase ${priorityTone}`}>{card.priority}</span>
      </div>
      {card.blockedReason ? (
        <div className="mt-1 truncate text-[10px] text-warning">⛔ {card.blockedReason}</div>
      ) : null}
      {card.comments.length > 0 ? (
        <div className="mt-1 text-[10px] text-text-muted">
          💬 {card.comments.length}
          {card.links.length > 0 ? ` · 🔗 ${card.links.length}` : ''}
        </div>
      ) : card.links.length > 0 ? (
        <div className="mt-1 text-[10px] text-text-muted">🔗 {card.links.length}</div>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {card.status !== 'done' ? (
          <IconBtn
            disabled={busy}
            label={t('kanban.complete', 'Complete')}
            onClick={onComplete}
            testid={`kanban-complete-${card.id}`}
          >
            <CheckCircle2 size={12} />
          </IconBtn>
        ) : null}
        {card.status === 'blocked' ? (
          <IconBtn
            disabled={busy}
            label={t('kanban.unblock', 'Unblock')}
            onClick={onUnblock}
            testid={`kanban-unblock-${card.id}`}
          >
            <AlertTriangle size={12} />
          </IconBtn>
        ) : (
          <IconBtn
            disabled={busy}
            label={t('kanban.block', 'Block')}
            onClick={() => setDrawer(drawer === 'block' ? 'none' : 'block')}
            testid={`kanban-block-${card.id}`}
          >
            <AlertTriangle size={12} />
          </IconBtn>
        )}
        <IconBtn
          disabled={busy}
          label={t('kanban.comment', 'Comment')}
          onClick={() => setDrawer(drawer === 'comment' ? 'none' : 'comment')}
          testid={`kanban-comment-${card.id}`}
        >
          <MessageSquare size={12} />
        </IconBtn>
        <IconBtn
          disabled={busy}
          label={t('kanban.link', 'Link')}
          onClick={() => setDrawer(drawer === 'link' ? 'none' : 'link')}
          testid={`kanban-link-${card.id}`}
        >
          <Link2 size={12} />
        </IconBtn>
        <IconBtn
          disabled={busy}
          label={t('kanban.archive', 'Archive')}
          onClick={onArchive}
          testid={`kanban-archive-${card.id}`}
        >
          <Archive size={12} />
        </IconBtn>
      </div>

      {drawer !== 'none' ? (
        <div className="mt-1.5 flex items-center gap-1">
          <input
            autoFocus
            className="flex-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-primary"
            data-testid={`kanban-drawer-input-${card.id}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitDrawer();
              if (e.key === 'Escape') setDrawer('none');
            }}
            placeholder={
              drawer === 'block'
                ? t('kanban.blockReason', 'Reason…')
                : drawer === 'link'
                  ? t('kanban.linkTarget', 'Target (URL or id)…')
                  : t('kanban.commentText', 'Comment…')
            }
            value={text}
          />
          <button
            className="rounded bg-accent px-2 py-0.5 text-[11px] text-white hover:bg-accent/90 disabled:opacity-50"
            data-testid={`kanban-drawer-submit-${card.id}`}
            disabled={busy || !text.trim()}
            onClick={submitDrawer}
            type="button"
          >
            {t('kanban.apply', 'Apply')}
          </button>
        </div>
      ) : null}
    </div>
  );
};

const IconBtn: React.FC<{
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  testid?: string;
}> = ({ children, disabled, label, onClick, testid }) => (
  <button
    aria-label={label}
    className="rounded border border-border-muted bg-surface p-1 text-text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
    data-testid={testid}
    disabled={disabled}
    onClick={onClick}
    title={label}
    type="button"
  >
    {children}
  </button>
);
