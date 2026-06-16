import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { useActiveProjectId, usePermissionMode } from '../store/selectors';
import { APP_NAME } from '../brand';
import { ProjectSelector } from './ProjectSelector';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Moon,
  Sun,
  Monitor,
  Settings,
  Sparkles,
  Search as SearchIcon,
  Plus,
  ListChecks,
  Check,
  Bot,
  Eye,
  Download,
  Pin,
  Archive,
  Copy,
  GitBranch,
} from 'lucide-react';
import type { Session } from '../types';
import { ExportDialog } from './ExportDialog';

import sidebarLogoSrc from '../assets/logo.png';

type SessionGroup = {
  key: string;
  label: string;
  sessions: Session[];
};

export function Sidebar() {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const activeProjectId = useActiveProjectId();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const permissionMode = usePermissionMode();
  const settings = useAppStore((s) => s.settings);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const isConfigured = useAppStore((s) => s.isConfigured);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const {
    deleteSession,
    batchDeleteSessions,
    duplicateSession,
    updateSessionSettings,
    getSessionMessages,
    getSessionTraceSteps,
    isElectron,
  } = useIPC();
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // Phase 2 step 16: session export dialog
  const [exportSessionId, setExportSessionId] = useState<string | null>(null);
  const [exportSessionTitle, setExportSessionTitle] = useState<string | undefined>(undefined);

  // Slash pilotability: `/export` / `/save` fire `cowork:open-export` with the
  // active session id (see slash-command-actions). Open the same ExportDialog the
  // per-session menu uses — additive, the menu path is untouched.
  useEffect(() => {
    const openExport = (e: Event) => {
      const sessionId = (e as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (!sessionId) return;
      setExportSessionId(sessionId);
      setExportSessionTitle(sessions.find((s) => s.id === sessionId)?.title);
    };
    window.addEventListener('cowork:open-export', openExport);
    return () => window.removeEventListener('cowork:open-export', openExport);
  }, [sessions]);

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const filteredSessions = useMemo(() => {
    const projectScoped = activeProjectId
      ? sessions.filter((session) => session.projectId === activeProjectId)
      : sessions;
    const archiveScoped = showArchived
      ? projectScoped
      : projectScoped.filter((session) => !session.archived);
    return normalizedQuery
      ? archiveScoped.filter((session) => {
          const tags = session.tags?.join(' ') ?? '';
          return `${session.title} ${tags}`.toLowerCase().includes(normalizedQuery);
        })
      : archiveScoped;
  }, [sessions, normalizedQuery, activeProjectId, showArchived]);

  const groupedSessions = useMemo(
    () =>
      groupSessionsByDate(filteredSessions, {
        pinned: t('sidebar.pinned', 'Pinned'),
        today: t('sidebar.today'),
        yesterday: t('sidebar.yesterday'),
        previousWeek: t('sidebar.previousWeek'),
        older: t('sidebar.older'),
      }),
    [filteredSessions, t]
  );

  // Exit select mode when sidebar collapses
  useEffect(() => {
    if (sidebarCollapsed && isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    }
  }, [sidebarCollapsed, isSelectMode]);

  // Escape key exits select mode
  useEffect(() => {
    if (!isSelectMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSelectMode(false);
        setSelectedIds(new Set());
        setShowDeleteConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectMode]);

  // Reset selection when search query changes to avoid deleting hidden sessions
  useEffect(() => {
    if (isSelectMode) {
      setSelectedIds(new Set());
    }
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
  }, []);

  const toggleSelectSession = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const visibleSessionIds = useMemo(() => filteredSessions.map((s) => s.id), [filteredSessions]);

  const allVisibleSelected =
    visibleSessionIds.length > 0 && visibleSessionIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      // Deselect all visible, keep others
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      // Select all visible, keep existing selections
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.add(id);
        }
        return next;
      });
    }
  }, [allVisibleSelected, visibleSessionIds]);

  const handleBatchDelete = useCallback(() => {
    const visibleSet = new Set(visibleSessionIds);
    const ids = Array.from(selectedIds).filter((id) => visibleSet.has(id));
    if (ids.length === 0) return;
    batchDeleteSessions(ids);
    exitSelectMode();
  }, [selectedIds, visibleSessionIds, batchDeleteSessions, exitSelectMode]);

  const handleSessionClick = useCallback(
    async (sessionId: string) => {
      setShowSettings(false);

      if (activeSessionId === sessionId) return;

      setActiveSession(sessionId);

      const existingMessages = sessionStates[sessionId]?.messages;
      if ((!existingMessages || existingMessages.length === 0) && isElectron) {
        try {
          const messages = await getSessionMessages(sessionId);
          if (messages && messages.length > 0) {
            setMessages(sessionId, messages);
          }
        } catch (error) {
          console.error('[Sidebar] Failed to load messages:', error);
        }
      }

      const existingSteps = sessionStates[sessionId]?.traceSteps;
      if ((!existingSteps || existingSteps.length === 0) && isElectron) {
        try {
          const steps = await getSessionTraceSteps(sessionId);
          setTraceSteps(sessionId, steps || []);
        } catch (error) {
          console.error('[Sidebar] Failed to load trace steps:', error);
        }
      }
    },
    [
      activeSessionId,
      getSessionMessages,
      getSessionTraceSteps,
      isElectron,
      sessionStates,
      setActiveSession,
      setMessages,
      setShowSettings,
      setTraceSteps,
    ]
  );

  const handleNewSession = () => {
    setActiveSession(null);
    setShowSettings(false);
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const handleTogglePinned = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    void updateSessionSettings(session.id, { pinned: !session.pinned });
  };

  const handleToggleArchived = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    void updateSessionSettings(session.id, { archived: !session.archived });
  };

  const handleDuplicateSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const duplicate = await duplicateSession(sessionId);
    if (duplicate) {
      setActiveSession(duplicate.id);
      setShowSettings(false);
    }
  };

  const toggleTheme = () => {
    const next =
      settings.theme === 'light' ? 'dark' : 
      settings.theme === 'dark' ? 'open-cowork' : 
      settings.theme === 'open-cowork' ? 'system' : 'light';
    updateSettings({ theme: next });
  };

  const themeIcon =
    settings.theme === 'dark' ? (
      <Moon strokeWidth={1.5} className="w-4 h-4" />
    ) : settings.theme === 'open-cowork' ? (
      <Sparkles strokeWidth={1.5} className="w-4 h-4 text-accent" />
    ) : settings.theme === 'light' ? (
      <Sun strokeWidth={1.5} className="w-4 h-4" />
    ) : (
      <Monitor strokeWidth={1.5} className="w-4 h-4" />
    );

  if (sidebarCollapsed) {
    return (
      <aside className="w-[4.5rem] h-full bg-surface flex flex-col overflow-hidden">
        <div className="px-2 pt-4 pb-2 flex flex-col items-center gap-2">
          <button
            onClick={toggleSidebar}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('context.expandPanel')}
          >
            <ChevronRight strokeWidth={1.5} className="w-5 h-5" />
          </button>
          <button
            onClick={handleNewSession}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('sidebar.newTask')}
          >
            <Plus strokeWidth={1.5} className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-2 py-4">
          <button
            onClick={toggleSidebar}
            className="rounded-lg px-2 py-3 text-[12px] leading-4 text-center text-text-muted hover:bg-surface-hover transition-colors"
            title={t('sidebar.expandToView')}
          >
            {t('sidebar.expandToView')}
          </button>
        </div>

        <div className="px-2 py-3 flex flex-col items-center gap-2">
          <button
            onClick={toggleTheme}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('sidebar.themeToggle')}
          >
            {settings.theme === 'dark' ? (
              <Sun strokeWidth={1.5} className="w-5 h-5" />
            ) : settings.theme === 'light' ? (
              <Moon strokeWidth={1.5} className="w-5 h-5" />
            ) : (
              <Monitor strokeWidth={1.5} className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary relative"
            title={t('sidebar.settings')}
            data-testid="sidebar-settings-button"
          >
            <Settings strokeWidth={1.5} className="w-5 h-5" />
            {!isConfigured && (
              <span className="absolute right-2.5 top-2.5 w-1.5 h-1.5 rounded-full bg-text-primary" />
            )}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full h-full bg-surface flex flex-col overflow-hidden">
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="min-w-0 flex items-center gap-2">
            <img
              src={sidebarLogoSrc}
              alt={t('common.appLogoAlt', { appName: APP_NAME })}
              className="w-7 h-7 rounded-md object-cover flex-shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-[14px] font-medium text-text-primary truncate">
                {APP_NAME}
              </h1>
            </div>
          </div>
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary flex-shrink-0"
            title={t('context.collapsePanel')}
          >
            <ChevronLeft strokeWidth={1.5} className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={handleNewSession}
          className="mt-4 w-full flex items-center justify-between rounded-lg hover:bg-surface-hover px-3 py-2 text-left transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-text-primary font-medium">{t('sidebar.newTask')}</span>
          </div>
          <Plus strokeWidth={1.5} className="w-4 h-4 text-text-secondary flex-shrink-0" />
        </button>

        {/* Project selector (Claude Cowork parity) */}
        <div className="mt-1 px-1">
          <ProjectSelector />
        </div>

          {sessions.length > 0 && (
          <div className="mt-2 flex items-center gap-1 px-1">
            <div className="relative flex-1 min-w-0">
              <SearchIcon strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.search')}
                className="w-full rounded-lg bg-transparent pl-8 pr-3 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:bg-surface-hover transition-colors"
              />
            </div>
            <button
              onClick={() => setShowArchived((value) => !value)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                showArchived
                  ? 'text-text-primary bg-surface-hover'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
              title={t('sidebar.showArchived', 'Show archived sessions')}
            >
              <Archive strokeWidth={1.5} className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (isSelectMode) {
                  exitSelectMode();
                } else {
                  setIsSelectMode(true);
                }
              }}
              className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelectMode
                  ? 'text-text-primary bg-surface-hover'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
              title={t('sidebar.manage')}
            >
              <ListChecks strokeWidth={1.5} className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {groupedSessions.length === 0 ? (
          <div className="px-3 py-6">
            <p className="text-[13px] text-text-secondary">{t('sidebar.noTasks')}</p>
            <p className="mt-1 text-[12px] leading-5 text-text-muted">{t('sidebar.noTasksHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedSessions.map((group) => (
              <section key={group.key}>
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-text-muted">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.sessions.map((session) => {
                    const isActive = activeSessionId === session.id;
                    const isSelected = selectedIds.has(session.id);
                    return (
                      <div
                        key={session.id}
                        onClick={() => {
                          if (isSelectMode) {
                            toggleSelectSession(session.id);
                          } else {
                            handleSessionClick(session.id);
                          }
                        }}
                        onMouseEnter={() => setHoveredSession(session.id)}
                        onMouseLeave={() => setHoveredSession(null)}
                        className={`group relative cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                          isSelectMode && isSelected
                            ? 'bg-surface-hover'
                            : isActive && !isSelectMode
                              ? 'bg-surface-hover'
                              : 'hover:bg-surface-hover'
                        }`}
                      >
                        <div className={`flex items-center gap-2 ${!isSelectMode ? 'pr-6' : ''}`}>
                          {isSelectMode && (
                            <div
                              className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-surface-hover text-text-primary'
                                  : 'border border-border-subtle bg-transparent'
                              }`}
                            >
                              {isSelected && <Check strokeWidth={1.5} className="w-3 h-3" />}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] leading-5 text-text-primary truncate flex items-center gap-1.5">
                              {session.isBackground && (
                                <Bot
                                  strokeWidth={1.5}
                                  className="w-3.5 h-3.5 text-text-muted shrink-0"
                                  aria-label="Background session"
                                />
                              )}
                              {isActive && permissionMode === 'plan' && (
                                <Eye
                                  strokeWidth={1.5}
                                  className="w-3.5 h-3.5 text-text-muted shrink-0"
                                  aria-label="Plan mode active"
                                />
                              )}
                              <span className="truncate">{session.title}</span>
                            </div>
                            {session.tags?.length ? (
                              <div className="mt-0.5 flex min-w-0 gap-1 overflow-hidden">
                                {session.tags.slice(0, 3).map((tag) => (
                                  <span
                                    key={tag}
                                    className="shrink-0 text-[11px] leading-none text-text-muted"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {!isSelectMode && hoveredSession === session.id && (
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                            <button
                              onClick={(e) => handleTogglePinned(e, session)}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                                session.pinned
                                  ? 'text-text-primary bg-surface-hover'
                                  : 'text-text-muted hover:text-text-primary hover:bg-background'
                              }`}
                              title={
                                session.pinned
                                  ? t('sidebar.unpinSession', 'Unpin session')
                                  : t('sidebar.pinSession', 'Pin session')
                              }
                            >
                              <Pin strokeWidth={1.5} className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => void handleDuplicateSession(e, session.id)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-background transition-colors"
                              title={t('sidebar.duplicateSession', 'Duplicate session')}
                            >
                              <Copy strokeWidth={1.5} className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleToggleArchived(e, session)}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                                session.archived
                                  ? 'text-text-primary bg-surface-hover'
                                  : 'text-text-muted hover:text-text-primary hover:bg-background'
                              }`}
                              title={
                                session.archived
                                  ? t('sidebar.unarchiveSession', 'Unarchive session')
                                  : t('sidebar.archiveSession', 'Archive session')
                              }
                            >
                              <Archive strokeWidth={1.5} className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExportSessionId(session.id);
                                setExportSessionTitle(session.title);
                              }}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-background transition-colors"
                              title={t('exportDialog.title')}
                            >
                              <Download strokeWidth={1.5} className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteSession(e, session.id)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-background transition-colors"
                              title={t('common.delete')}
                            >
                              <Trash2 strokeWidth={1.5} className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {isSelectMode ? (
        <div className="px-3 py-3">
          {showDeleteConfirm ? (
            <div className="border border-error/30 bg-error/10 rounded-lg px-3 py-3">
              <p className="text-[13px] text-text-primary mb-3">
                {t('sidebar.batchDeleteConfirm', { count: selectedIds.size })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t('sidebar.cancel')}
                </button>
                <button
                  onClick={handleBatchDelete}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-error text-white hover:bg-error/90 transition-colors"
                >
                  {t('sidebar.confirmDelete')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={toggleSelectAll}
                  className="text-[12px] font-medium text-text-primary hover:text-text-secondary transition-colors"
                >
                  {allVisibleSelected ? t('sidebar.deselectAll') : t('sidebar.selectAll')}
                </button>
                <span className="text-[12px] text-text-muted">
                  {t('sidebar.nSelected', { count: selectedIds.size })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exitSelectMode}
                  className="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t('sidebar.cancel')}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={selectedIds.size === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium bg-surface-hover text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 strokeWidth={1.5} className="w-3.5 h-3.5" />
                  {t('common.delete')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              className="flex-1 min-w-0 flex items-center gap-2 rounded-lg px-2 py-2 text-left text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
              data-testid="sidebar-settings-button"
            >
              <Settings strokeWidth={1.5} className="w-4 h-4 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[13px] text-text-primary">
                  {t('sidebar.settings')}
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  {isConfigured ? t('sidebar.apiConfigured') : t('sidebar.apiNotConfigured')}
                </div>
              </div>
            </button>

            <button
              onClick={() => useAppStore.getState().setShowWorkflowProPanel(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
              title="Workflow Builder Pro"
            >
              <GitBranch strokeWidth={1.5} className="w-4 h-4" />
            </button>

            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
              title={t('sidebar.themeToggle')}
            >
              {themeIcon}
            </button>
          </div>
        </div>
      )}

      {/* Session export dialog (Phase 2 step 16) */}
      {exportSessionId && (
        <ExportDialog
          sessionId={exportSessionId}
          sessionTitle={exportSessionTitle}
          onClose={() => {
            setExportSessionId(null);
            setExportSessionTitle(undefined);
          }}
        />
      )}
    </aside>
  );
}

function groupSessionsByDate(
  sessions: Session[],
  labels: {
    pinned: string;
    today: string;
    yesterday: string;
    previousWeek: string;
    older: string;
  }
): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfPreviousWeek = startOfToday - 7 * 86_400_000;

  const buckets: SessionGroup[] = [
    { key: 'pinned', label: labels.pinned, sessions: [] },
    { key: 'today', label: labels.today, sessions: [] },
    { key: 'yesterday', label: labels.yesterday, sessions: [] },
    { key: 'previousWeek', label: labels.previousWeek, sessions: [] },
    { key: 'older', label: labels.older, sessions: [] },
  ];

  const sortedSessions = [...sessions].sort(
    (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
  );
  for (const session of sortedSessions) {
    if (session.pinned) {
      buckets[0].sessions.push(session);
      continue;
    }
    const timestamp = session.updatedAt || session.createdAt;
    if (timestamp >= startOfToday) {
      buckets[1].sessions.push(session);
    } else if (timestamp >= startOfYesterday) {
      buckets[2].sessions.push(session);
    } else if (timestamp >= startOfPreviousWeek) {
      buckets[3].sessions.push(session);
    } else {
      buckets[4].sessions.push(session);
    }
  }

  return buckets.filter((bucket) => bucket.sessions.length > 0);
}
