/**
 * MobileSupervisionPanel — S6.
 *
 * Local-operator management surface for the supervision-only mobile gateway:
 * shows the pairing code + paired devices and the follow-up review queue from a
 * phone, with approve/cancel. Approval is a REVIEW MARKER ONLY — it never
 * dispatches work (the gateway guarantees that). Requires the embedded server to
 * be running; otherwise shows an honest "start the server" state.
 *
 * @module renderer/components/MobileSupervisionPanel
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Smartphone, Check, Trash2, AlertCircle, RefreshCw, KeyRound } from 'lucide-react';
import { useAppStore } from '../store';
import { EmptyState } from './LessonCandidatePanel';

type Snapshot = Awaited<ReturnType<NonNullable<Window['electronAPI']>['mobileSupervision']['status']>>;
type Draft = NonNullable<Snapshot['drafts']>[number];

export function MobileSupervisionPanel() {
  const show = useAppStore((s) => s.showMobileSupervisionPanel);
  const setShow = useAppStore((s) => s.setShowMobileSupervisionPanel);

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await window.electronAPI.mobileSupervision.status();
    setLoading(false);
    setSnap(res);
    if (res.error) setError(res.error);
  }, []);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  const approve = async (d: Draft) => {
    setBusyId(d.id);
    setError(null);
    const res = await window.electronAPI.mobileSupervision.approve(d.id, reviewer.trim() || undefined);
    setBusyId(null);
    if (!res.ok) return setError(res.error ?? 'Approve failed');
    await refresh();
  };

  const cancel = async (d: Draft) => {
    setBusyId(d.id);
    setError(null);
    const res = await window.electronAPI.mobileSupervision.cancel(d.id);
    setBusyId(null);
    if (!res.ok) return setError(res.error ?? 'Cancel failed');
    await refresh();
  };

  const rotate = async () => {
    setError(null);
    const res = await window.electronAPI.mobileSupervision.rotateCode();
    if (!res.ok) return setError(res.error ?? 'Rotate failed');
    await refresh();
  };

  if (!show) return null;

  const pending = (snap?.drafts ?? []).filter((d) => d.status === 'needs_local_operator');
  const reviewed = (snap?.drafts ?? []).filter((d) => d.status !== 'needs_local_operator');
  const pendingCount = snap?.draftCounts?.needs_local_operator ?? pending.length;
  const reviewedCount = (snap?.draftCounts?.approved ?? 0) + (snap?.draftCounts?.cancelled ?? 0) || reviewed.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm"
      data-testid="mobile-supervision-panel"
    >
      <div className="flex h-full w-[560px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Mobile supervision</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => void refresh()} className="rounded p-1 hover:bg-surface" title="Refresh">
              <RefreshCw className={`w-4 h-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => setShow(false)} className="rounded p-1 hover:bg-surface" aria-label="Close">
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        <div className="border-b border-border px-4 py-2 text-[11px] text-text-muted">
          Supervision-only: a paired phone can read and <em>propose</em>. Approving here is a review
          marker — it never runs work automatically.
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-1.5 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!snap?.running ? (
          <div className="flex-1 px-4 py-6">
            <EmptyState
              icon={<Smartphone className="w-8 h-8 text-text-muted" />}
              title="Embedded server not running"
              hint="Start the embedded server (titlebar) to pair a phone and review its proposals."
            />
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs text-text-muted">Pairing code</span>
                  <code className="text-sm font-mono text-text-primary tracking-widest">
                    {snap.pairingCode ?? '——————'}
                  </code>
                </div>
                <button
                  onClick={() => void rotate()}
                  className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface"
                >
                  Rotate
                </button>
              </div>
              {!!snap.devices?.length && (
                <div className="mt-1 text-[11px] text-text-muted">
                  Paired: {snap.devices.length}
                  {snap.activeDeviceLimit ? ` / ${snap.activeDeviceLimit}` : ''} · {snap.devices.join(', ')}
                </div>
              )}
            </div>

            <div className="border-b border-border px-4 py-2">
              <label className="flex items-center gap-2">
                <span className="text-xs text-text-muted whitespace-nowrap">Reviewer</span>
                <input
                  type="text"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  placeholder="your name (optional)"
                  className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
              </label>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              <div className="text-[11px] text-text-muted">
                Pending: {pendingCount}
                {snap.draftLimits?.maxPendingDrafts ? ` / ${snap.draftLimits.maxPendingDrafts}` : ''} · Reviewed:{' '}
                {reviewedCount}
                {snap.draftLimits?.maxResolvedDrafts ? ` / ${snap.draftLimits.maxResolvedDrafts}` : ''}
              </div>
              {pending.length === 0 && reviewed.length === 0 ? (
                <EmptyState
                  icon={<Smartphone className="w-8 h-8 text-text-muted" />}
                  title={loading ? 'Loading…' : 'No proposals'}
                  hint="Prompts submitted from a paired phone appear here for local approval."
                />
              ) : (
                [...pending, ...reviewed].map((d) => (
                  <div key={d.id} className="rounded border border-border bg-surface/40 p-3 space-y-2" data-testid="mobile-draft">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-accent">{d.source}</span>
                      <span className="text-[10px] text-text-muted">{new Date(d.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-text-primary whitespace-pre-wrap">{d.prompt}</p>
                    {d.status !== 'needs_local_operator' ? (
                      <p className="text-[10px] text-text-muted">
                        {d.status}
                        {d.approvedBy ? ` by ${d.approvedBy}` : ''}
                      </p>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={busyId === d.id}
                          onClick={() => void cancel(d)}
                          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                        <button
                          disabled={busyId === d.id}
                          onClick={() => void approve(d)}
                          className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
