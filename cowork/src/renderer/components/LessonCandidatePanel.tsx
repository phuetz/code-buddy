/**
 * LessonCandidatePanel — review queue for proposed lessons (Hermes item 7).
 *
 * Surfaces the core lesson-candidate queue (propose → review → approve) that
 * was previously CLI-only (`buddy lessons candidate ...`). The agent (or a
 * human) PROPOSES lessons; nothing is written to `lessons.md` until a human
 * approves here with an explicit reviewer name. This panel makes that gate
 * visible: the reviewer field is required, edits are allowed before approval,
 * and "approve" is the only write path.
 *
 * @module cowork/renderer/components/LessonCandidatePanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, GraduationCap, Check, Trash2, AlertCircle, FolderOpen, RefreshCw, Cpu } from 'lucide-react';
import { useAppStore } from '../store';
import {
  NO_ACTIVE_PROJECT,
  type LessonCandidate,
  type LessonCandidateStatus,
  type LessonCategory,
} from '../types/hermes';

const STATUS_TABS: Array<{ key: LessonCandidateStatus | 'all'; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'discarded', label: 'Discarded' },
  { key: 'all', label: 'All' },
];

const CATEGORIES: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];

const CATEGORY_TOKEN: Record<LessonCategory, string> = {
  PATTERN: 'text-accent',
  RULE: 'text-warning',
  CONTEXT: 'text-text-secondary',
  INSIGHT: 'text-success',
};

export function LessonCandidatePanel() {
  const show = useAppStore((s) => s.showLessonCandidatePanel);
  const setShow = useAppStore((s) => s.setShowLessonCandidatePanel);

  const [tab, setTab] = useState<LessonCandidateStatus | 'all'>('pending');
  const [items, setItems] = useState<LessonCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noProject, setNoProject] = useState(false);
  const [reviewer, setReviewer] = useState('');
  // Per-candidate inline edits keyed by id.
  const [edits, setEdits] = useState<Record<string, { content: string; category: LessonCategory }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const status = tab === 'all' ? undefined : tab;
    const res = await window.electronAPI.lessonCandidate.list(status);
    setLoading(false);
    if (!res.ok) {
      setNoProject(res.error === NO_ACTIVE_PROJECT);
      setError(res.error === NO_ACTIVE_PROJECT ? null : res.error ?? 'Failed to load candidates');
      setItems([]);
      return;
    }
    setNoProject(false);
    setItems(res.items);
  }, [tab]);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  const editFor = useCallback(
    (c: LessonCandidate) => edits[c.id] ?? { content: c.content, category: c.category },
    [edits],
  );

  const setEdit = (id: string, patch: Partial<{ content: string; category: LessonCategory }>) =>
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { content: '', category: 'PATTERN' }), ...patch } as {
        content: string;
        category: LessonCategory;
      },
    }));

  const approve = async (c: LessonCandidate) => {
    if (!reviewer.trim()) {
      setError('Enter a reviewer name before approving — approving writes lessons.md.');
      return;
    }
    setBusyId(c.id);
    setError(null);
    const e = editFor(c);
    const res = await window.electronAPI.lessonCandidate.approve(c.id, {
      reviewedBy: reviewer.trim(),
      content: e.content,
      category: e.category,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error ?? 'Approve failed');
      return;
    }
    await refresh();
  };

  const discard = async (c: LessonCandidate) => {
    setBusyId(c.id);
    setError(null);
    const res = await window.electronAPI.lessonCandidate.discard(c.id, {
      reviewedBy: reviewer.trim() || undefined,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error ?? 'Discard failed');
      return;
    }
    await refresh();
  };

  const pendingCount = useMemo(() => items.filter((i) => i.status === 'pending').length, [items]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm">
      <div className="flex h-full w-[560px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Lesson candidates</h2>
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
              aria-label="Close lesson candidate panel"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        {/* Reviewer + status tabs */}
        <div className="border-b border-border px-4 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted whitespace-nowrap">Reviewer</span>
            <input
              type="text"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="your name (required to approve)"
              className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-1">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  tab === t.key
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:bg-surface'
                }`}
              >
                {t.label}
                {t.key === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
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
              hint="Select a project to review its lesson candidates."
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<GraduationCap className="w-8 h-8 text-text-muted" />}
              title={loading ? 'Loading…' : 'No candidates'}
              hint="Lessons proposed by the agent (or `buddy lessons candidate propose`) appear here for review."
            />
          ) : (
            items.map((c) => {
              const e = editFor(c);
              const isPending = c.status === 'pending';
              return (
                <div
                  key={c.id}
                  className="rounded border border-border bg-surface/40 p-3 space-y-2"
                  data-testid="lesson-candidate"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isPending ? (
                        <select
                          value={e.category}
                          onChange={(ev) => setEdit(c.id, { category: ev.target.value as LessonCategory })}
                          className="rounded border border-border bg-background-secondary px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none focus:border-accent"
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${CATEGORY_TOKEN[c.category]}`}>
                          {c.category}
                        </span>
                      )}
                      <StatusBadge status={c.status} />
                    </div>
                    <span className="text-[10px] text-text-muted shrink-0">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {isPending ? (
                    <textarea
                      value={e.content}
                      onChange={(ev) => setEdit(c.id, { content: ev.target.value })}
                      rows={2}
                      className="w-full resize-y rounded border border-border bg-background-secondary px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
                    />
                  ) : (
                    <p className="text-xs text-text-primary whitespace-pre-wrap">{c.content}</p>
                  )}

                  {c.provenance?.sagaId && (
                    <p className="flex items-center gap-1 text-[10px] text-accent" title={c.provenance.note}>
                      <Cpu className="w-3 h-3 shrink-0" />
                      proposed from Fleet Council · saga {c.provenance.sagaId.slice(0, 8)}
                    </p>
                  )}
                  {c.context && <p className="text-[10px] text-text-muted">context: {c.context}</p>}
                  {c.reviewedBy && (
                    <p className="text-[10px] text-text-muted">
                      {c.status} by {c.reviewedBy}
                      {c.approvedLessonId ? ` → lesson ${c.approvedLessonId}` : ''}
                    </p>
                  )}

                  {isPending && (
                    <div className="flex justify-end gap-2">
                      <button
                        disabled={busyId === c.id}
                        onClick={() => void discard(c)}
                        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Discard
                      </button>
                      <button
                        disabled={busyId === c.id}
                        onClick={() => void approve(c)}
                        className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LessonCandidateStatus }) {
  const token =
    status === 'approved' ? 'text-success' : status === 'discarded' ? 'text-text-muted' : 'text-warning';
  return <span className={`text-[10px] uppercase tracking-wide ${token}`}>{status}</span>;
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon}
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      <p className="max-w-[320px] text-xs text-text-muted">{hint}</p>
    </div>
  );
}
