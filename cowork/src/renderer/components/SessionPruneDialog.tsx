/**
 * SessionPruneDialog — bulk-archive old sessions (Hermes `sessions prune`
 * parity): filter by age and title, PREVIEW the matches with their age span,
 * then archive in one pass. Pinned/archived/active sessions never match.
 */
import { useCallback, useState } from 'react';
import { Archive, Loader2, Search, X } from 'lucide-react';

import { useAppStore } from '../store';

interface PreviewState {
  matches: Array<{ id: string; title: string; updatedAt: number }>;
  ageSpan: { oldest: number; newest: number } | null;
}

function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function SessionPruneDialog() {
  const show = useAppStore((s) => s.showSessionPrune);
  const setShow = useAppStore((s) => s.setShowSessionPrune);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setSessions = useAppStore((s) => s.setSessions);
  const sessions = useAppStore((s) => s.sessions);

  const [olderThanDays, setOlderThanDays] = useState(7);
  const [titleMatch, setTitleMatch] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const runPreview = useCallback(() => {
    setBusy(true);
    setDone(null);
    void window.electronAPI?.sessionPrune
      ?.preview({ olderThanDays, titleMatch: titleMatch || undefined, excludeId: activeSessionId ?? undefined })
      .then((result) => setPreview(result ?? { matches: [], ageSpan: null }))
      .catch(() => setPreview({ matches: [], ageSpan: null }))
      .finally(() => setBusy(false));
  }, [olderThanDays, titleMatch, activeSessionId]);

  const applyPrune = useCallback(() => {
    if (!preview || preview.matches.length === 0) return;
    setBusy(true);
    const ids = preview.matches.map((m) => m.id);
    void window.electronAPI?.sessionPrune
      ?.apply(ids)
      .then((result) => {
        setDone(result?.archived ?? 0);
        // Mirror in the renderer store so the Home list updates immediately.
        const archivedSet = new Set(ids);
        setSessions(sessions.map((s) => (archivedSet.has(s.id) ? { ...s, archived: true } : s)));
        setPreview(null);
      })
      .catch(() => setDone(0))
      .finally(() => setBusy(false));
  }, [preview, sessions, setSessions]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="session-prune-dialog">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Nettoyer les sessions</h2>
          <button type="button" onClick={() => setShow(false)} className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Fermer">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-end gap-3">
          <label className="flex-1 text-xs text-muted-foreground">
            Plus vieilles que (jours) — 0 = tout âge
            <input
              type="number"
              min={0}
              value={olderThanDays}
              onChange={(e) => setOlderThanDays(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              data-testid="prune-days"
            />
          </label>
          <label className="flex-[2] text-xs text-muted-foreground">
            Titre contient (optionnel)
            <input
              type="text"
              value={titleMatch}
              onChange={(e) => setTitleMatch(e.target.value)}
              placeholder="ex : test, e2e…"
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              data-testid="prune-match"
            />
          </label>
          <button
            type="button"
            onClick={runPreview}
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-foreground hover:bg-background disabled:opacity-50"
            data-testid="prune-preview"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Search className="h-3.5 w-3.5" aria-hidden="true" />}
            Aperçu
          </button>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          Les sessions épinglées, archivées et la session active ne sont jamais touchées. Archiver est réversible.
        </p>

        {preview ? (
          <div className="mt-3 rounded-lg border border-border bg-background p-3" data-testid="prune-result">
            {preview.matches.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune session ne correspond.</p>
            ) : (
              <>
                <p className="text-xs text-foreground">
                  <strong>{preview.matches.length}</strong> session{preview.matches.length > 1 ? 's' : ''} —{' '}
                  {preview.ageSpan
                    ? `du ${formatDay(preview.ageSpan.oldest)} au ${formatDay(preview.ageSpan.newest)}`
                    : ''}
                </p>
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                  {preview.matches.map((m) => (
                    <li key={m.id} className="truncate text-xs text-muted-foreground">
                      {formatDay(m.updatedAt)} · {m.title || 'Sans titre'}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={applyPrune}
                  disabled={busy}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-background hover:bg-accent-hover disabled:opacity-50"
                  data-testid="prune-apply"
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                  Archiver {preview.matches.length} session{preview.matches.length > 1 ? 's' : ''}
                </button>
              </>
            )}
          </div>
        ) : null}

        {done !== null ? (
          <p className="mt-3 text-xs text-success" data-testid="prune-done">
            {done} session{done > 1 ? 's' : ''} archivée{done > 1 ? 's' : ''}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
