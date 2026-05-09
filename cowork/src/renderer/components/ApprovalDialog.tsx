/**
 * ApprovalDialog — modal that surfaces a pending workflow approval and
 * forwards the user's answer back to the bridge via `workflow.approve`.
 *
 * Driven by `state.pendingApprovals[0]` from the app store: as soon as
 * the bridge emits `workflow.approval_required`, the head of the queue
 * pops up. Approving or rejecting calls the IPC bridge and removes the
 * entry from the local queue.
 *
 * @module cowork/renderer/components/ApprovalDialog
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useAppStore } from '../store';

export const ApprovalDialog: React.FC = () => {
  const pending = useAppStore((s) => s.pendingApprovals);
  const remove = useAppStore((s) => s.removePendingApproval);

  const head = pending[0] ?? null;
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick every second so the countdown stays accurate.
  useEffect(() => {
    if (!head) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [head]);

  if (!head) return null;

  const remainingMs = head.expiresAt ? Math.max(0, head.expiresAt - now) : null;
  const remainingLabel =
    remainingMs !== null ? `${Math.ceil(remainingMs / 1000)}s` : '—';

  const reply = async (approved: boolean) => {
    setSubmitting(true);
    try {
      await window.electronAPI.workflow.approve(head.stepId, approved);
    } finally {
      setSubmitting(false);
      remove(head.stepId);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[420px] max-w-[90vw] bg-background border border-border rounded-xl shadow-elevated p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Workflow approval required
          </h3>
          <p className="text-xs text-text-muted mt-1 break-words">
            {head.message || 'Approve to continue the workflow.'}
          </p>
        </div>

        {head.expiresAt && (
          <div className="flex items-center gap-1 text-[11px] text-text-muted">
            <Clock size={11} />
            <span>auto-rejects in {remainingLabel}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            disabled={submitting}
            onClick={() => void reply(false)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-secondary hover:bg-surface-hover disabled:opacity-50 transition-colors"
          >
            <XCircle size={12} />
            Reject
          </button>
          <button
            disabled={submitting}
            onClick={() => void reply(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 size={12} />
            Approve
          </button>
        </div>

        {pending.length > 1 && (
          <div className="text-[10px] text-text-muted">
            {pending.length - 1} more approval(s) queued
          </div>
        )}
      </div>
    </div>
  );
};
