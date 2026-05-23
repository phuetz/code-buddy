/**
 * UserModelPanel — review queue for the local user model (Hermes item 24).
 *
 * Typed observations about the user's working preferences/traits/expertise/
 * working-style. Same "no silent write" gate as lessons: the agent (or a
 * human) PROPOSES; nothing enters the active model until a human accepts here
 * with an explicit reviewer. The core privacy screen refuses health/finance/
 * relationship/credential content — that refusal is surfaced as a clean error.
 *
 * @module cowork/renderer/components/UserModelPanel
 */

import { useCallback, useEffect, useState } from 'react';
import { X, UserCog, Check, Trash2, AlertCircle, FolderOpen, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store';
import { EmptyState } from './LessonCandidatePanel';
import {
  NO_ACTIVE_PROJECT,
  type UserObservation,
  type UserObservationKind,
  type UserObservationStatus,
} from '../types/hermes';

const STATUS_TABS: Array<{ key: UserObservationStatus | 'all'; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'discarded', label: 'Discarded' },
  { key: 'all', label: 'All' },
];

const KIND_LABEL: Record<UserObservationKind, string> = {
  preference: 'Preference',
  trait: 'Trait',
  expertise: 'Expertise',
  'working-style': 'Working style',
};

export function UserModelPanel() {
  const show = useAppStore((s) => s.showUserModelPanel);
  const setShow = useAppStore((s) => s.setShowUserModelPanel);

  const [tab, setTab] = useState<UserObservationStatus | 'all'>('pending');
  const [items, setItems] = useState<UserObservation[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noProject, setNoProject] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const status = tab === 'all' ? undefined : tab;
    const [listRes, sumRes] = await Promise.all([
      window.electronAPI.userModel.list(status),
      window.electronAPI.userModel.summarize(),
    ]);
    setLoading(false);
    if (!listRes.ok) {
      setNoProject(listRes.error === NO_ACTIVE_PROJECT);
      setError(listRes.error === NO_ACTIVE_PROJECT ? null : listRes.error ?? 'Failed to load observations');
      setItems([]);
      setSummary(null);
      return;
    }
    setNoProject(false);
    setItems(listRes.items);
    setSummary(sumRes.ok ? sumRes.summary ?? null : null);
  }, [tab]);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  const accept = async (o: UserObservation) => {
    if (!reviewer.trim()) {
      setError('Enter a reviewer name before accepting — accepting mutates the active user model.');
      return;
    }
    setBusyId(o.id);
    setError(null);
    const res = await window.electronAPI.userModel.accept(o.id, { reviewedBy: reviewer.trim() });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error ?? 'Accept failed');
      return;
    }
    await refresh();
  };

  const discard = async (o: UserObservation) => {
    setBusyId(o.id);
    setError(null);
    const res = await window.electronAPI.userModel.discard(o.id, { reviewedBy: reviewer.trim() || undefined });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error ?? 'Discard failed');
      return;
    }
    await refresh();
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm">
      <div className="flex h-full w-[560px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <UserCog className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">User model</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShow(false)}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Close user model panel"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        <div className="border-b border-border px-4 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted whitespace-nowrap">Reviewer</span>
            <input
              type="text"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="your name (required to accept)"
              className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-1">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-1.5 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {noProject ? (
            <EmptyState
              icon={<FolderOpen className="w-8 h-8 text-text-muted" />}
              title="No active project"
              hint="Select a project to review its user-model observations."
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<UserCog className="w-8 h-8 text-text-muted" />}
              title={loading ? 'Loading…' : 'No observations'}
              hint="Observations proposed by the agent (or `buddy user-model observe`) appear here for review."
            />
          ) : (
            items.map((o) => (
              <div
                key={o.id}
                className="rounded border border-border bg-surface/40 p-3 space-y-2"
                data-testid="user-observation"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">
                      {KIND_LABEL[o.kind]}
                    </span>
                    <StatusBadge status={o.status} />
                    {typeof o.confidence === 'number' && (
                      <span className="text-[10px] text-text-muted">conf {Math.round(o.confidence * 100)}%</span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {new Date(o.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-text-primary whitespace-pre-wrap">{o.content}</p>
                {o.reviewedBy && (
                  <p className="text-[10px] text-text-muted">
                    {o.status} by {o.reviewedBy}
                  </p>
                )}
                {o.status === 'pending' && (
                  <div className="flex justify-end gap-2">
                    <button
                      disabled={busyId === o.id}
                      onClick={() => void discard(o)}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Discard
                    </button>
                    <button
                      disabled={busyId === o.id}
                      onClick={() => void accept(o)}
                      className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Accept
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Active model summary (accepted observations) */}
        {summary && (
          <div className="border-t border-border px-4 py-2">
            <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1">Active model</p>
            <pre className="max-h-32 overflow-y-auto rounded bg-surface/40 p-2 text-[10px] text-text-secondary whitespace-pre-wrap">
              {summary}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: UserObservationStatus }) {
  const token =
    status === 'accepted' ? 'text-success' : status === 'discarded' ? 'text-text-muted' : 'text-warning';
  return <span className={`text-[10px] uppercase tracking-wide ${token}`}>{status}</span>;
}
