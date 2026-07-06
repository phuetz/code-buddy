/**
 * ConversationHistoryDrawer — the ChatGPT-style conversation history: every
 * conversation, pinned first then grouped by date, searchable, with inline
 * rename / pin / archive. Opens as a left drawer over any view (rail 🕘 or
 * ⌘K); selecting a conversation activates it and switches to the chat view.
 * Mutations go through the REAL `session.updateSettings` IPC (the main
 * process echoes the change back, and the local store is patched
 * optimistically for instant feedback).
 */
import { useMemo, useState } from 'react';
import { Archive, Check, FileDown, FileText, History, Pencil, Pin, PinOff, Search, X } from 'lucide-react';

import { useAppStore } from '../store';
import { groupSessions } from './conversation-history-model';

export function ConversationHistoryDrawer() {
  const show = useAppStore((s) => s.showConversationHistory);
  const setShow = useAppStore((s) => s.setShowConversationHistory);
  const sessions = useAppStore((s) => s.sessions);
  const setSessions = useAppStore((s) => s.setSessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setPrimaryView = useAppStore((s) => s.setPrimaryView);

  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const sections = useMemo(() => groupSessions(sessions, query, Date.now()), [sessions, query]);

  if (!show) return null;

  const patchLocal = (id: string, patch: Partial<(typeof sessions)[number]>) => {
    setSessions(sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const open = (id: string) => {
    setActiveSession(id);
    setPrimaryView('chat');
    setShow(false);
  };

  const togglePin = (id: string, pinned: boolean) => {
    patchLocal(id, { pinned: !pinned });
    void window.electronAPI?.session?.updateSettings?.(id, { pinned: !pinned });
  };

  const archive = (id: string) => {
    patchLocal(id, { archived: true });
    void window.electronAPI?.session?.updateSettings?.(id, { archived: true });
  };

  const commitRename = (id: string) => {
    const title = draftTitle.trim();
    setRenaming(null);
    if (!title) return;
    patchLocal(id, { title });
    void window.electronAPI?.session?.updateSettings?.(id, { title });
  };

  return (
    <div className="fixed inset-0 z-40 flex" data-testid="conversation-history">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer l'historique"
        onClick={() => setShow(false)}
        className="absolute inset-0 bg-black/40"
      />
      {/* Drawer */}
      <aside className="relative z-10 flex h-full w-80 flex-col border-r border-border bg-surface shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Historique</h2>
          <button
            type="button"
            onClick={() => setShow(false)}
            className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une conversation…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs text-foreground focus:border-accent focus:outline-none"
              data-testid="history-search"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sections.length === 0 ? (
            <p className="px-1 py-4 text-xs text-muted-foreground">Aucune conversation.</p>
          ) : (
            sections.map((section) => (
              <div key={section.label} className="mb-3">
                <h3 className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </h3>
                {section.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group flex items-center gap-1 rounded-md px-1.5 py-1 ${
                      session.id === activeSessionId ? 'bg-accent/15' : 'hover:bg-background'
                    }`}
                  >
                    {renaming === session.id ? (
                      <>
                        <input
                          autoFocus
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(session.id);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          className="min-w-0 flex-1 rounded border border-accent bg-background px-1 py-0.5 text-xs text-foreground focus:outline-none"
                          data-testid="history-rename-input"
                        />
                        <button type="button" onClick={() => commitRename(session.id)} className="rounded p-1 text-success" aria-label="Valider">
                          <Check className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => open(session.id)}
                          className="min-w-0 flex-1 truncate text-left text-xs text-foreground"
                          title={session.title || 'Sans titre'}
                        >
                          {session.pinned ? <Pin className="mr-1 inline h-3 w-3 text-accent" aria-hidden="true" /> : null}
                          {session.title || 'Sans titre'}
                        </button>
                        <div className="hidden shrink-0 items-center group-hover:flex">
                          <button
                            type="button"
                            title="Renommer"
                            onClick={() => {
                              setRenaming(session.id);
                              setDraftTitle(session.title || '');
                            }}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            title={session.pinned ? 'Désépingler' : 'Épingler'}
                            onClick={() => togglePin(session.id, Boolean(session.pinned))}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                          >
                            {session.pinned ? <PinOff className="h-3 w-3" aria-hidden="true" /> : <Pin className="h-3 w-3" aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            title="Exporter en Markdown"
                            onClick={() => void window.electronAPI?.session?.exportToFile?.(session.id, { format: 'markdown', redactSecrets: true })}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            data-testid="history-export-md"
                          >
                            <FileText className="h-3 w-3" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            title="Exporter en PDF"
                            onClick={() => void window.electronAPI?.session?.exportPdf?.(session.id)}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            data-testid="history-export-pdf"
                          >
                            <FileDown className="h-3 w-3" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            title="Archiver"
                            onClick={() => archive(session.id)}
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                          >
                            <Archive className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
