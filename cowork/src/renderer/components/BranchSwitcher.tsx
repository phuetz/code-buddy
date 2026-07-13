/**
 * BranchSwitcher — Claude Cowork parity Phase 2
 *
 * Dropdown UI for listing, switching, creating, and deleting conversation
 * branches for the active session. Appears in the ChatView header.
 *
 * @module renderer/components/BranchSwitcher
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitBranch,
  GitFork,
  Check,
  Trash2,
  ChevronDown,
  Plus,
  X,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '../store';
import { SESSION_BRANCH_CHANGED_EVENT } from '../utils/session-branch-events';

interface BranchSummary {
  id: string;
  sessionId: string;
  name: string;
  parentId?: string;
  parentMessageId?: string;
  parentMessageIndex?: number;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isCurrent: boolean;
}

interface BranchSwitcherProps {
  sessionId: string;
  /** Optional message index for "fork from here" context */
  forkFromMessageIndex?: number;
  /** Stable persisted ID preferred over an index when forking from a message. */
  forkFromMessageId?: string;
  /** Called after successful checkout/fork so the caller can refresh messages */
  onBranchChanged?: () => void;
}

export const BranchSwitcher: React.FC<BranchSwitcherProps> = ({
  sessionId,
  forkFromMessageIndex,
  forkFromMessageId,
  onBranchChanged,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForkDialog, setShowForkDialog] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.session?.branches) return;
      const result = await api.session.branches(sessionId);
      setBranches(result);
    } catch (err) {
      console.error('[BranchSwitcher] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    const handleBranchChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId === sessionId) void load();
    };
    window.addEventListener(SESSION_BRANCH_CHANGED_EVENT, handleBranchChanged);
    return () => window.removeEventListener(SESSION_BRANCH_CHANGED_EVENT, handleBranchChanged);
  }, [load, sessionId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleCheckout = useCallback(
    async (branchId: string) => {
      const api = window.electronAPI;
      if (!api?.session?.checkout) return;
      setBusy(true);
      try {
        setError(null);
        const result = await api.session.checkout(sessionId, branchId);
        if (result.success) {
          if (result.messages) {
            useAppStore.getState().setMessages(sessionId, result.messages);
          }
          onBranchChanged?.();
          await load();
          setOpen(false);
        } else {
          setError(result.error ?? t('branch.operationFailed'));
        }
      } finally {
        setBusy(false);
      }
    },
    [sessionId, load, onBranchChanged, t]
  );

  const handleFork = useCallback(async () => {
    const name = newBranchName.trim();
    if (!name) return;
    const api = window.electronAPI;
    if (!api?.session?.fork) return;
    setBusy(true);
    try {
      setError(null);
      const result = await api.session.fork(
        sessionId,
        name,
        forkFromMessageIndex,
        forkFromMessageId,
      );
      if (result.success) {
        if (result.messages) {
          useAppStore.getState().setMessages(sessionId, result.messages);
        }
        setNewBranchName('');
        setShowForkDialog(false);
        onBranchChanged?.();
        await load();
      } else {
        setError(result.error ?? t('branch.operationFailed'));
      }
    } finally {
      setBusy(false);
    }
  }, [newBranchName, sessionId, forkFromMessageIndex, forkFromMessageId, onBranchChanged, load, t]);

  const handleDelete = useCallback(
    async (branchId: string, branchName: string) => {
      if (!confirm(t('branch.deleteConfirm', { name: branchName }))) return;
      const api = window.electronAPI;
      if (!api?.session?.deleteBranch) return;
      setBusy(true);
      try {
        setError(null);
        const result = await api.session.deleteBranch(sessionId, branchId);
        if (!result.success) setError(result.error ?? t('branch.operationFailed'));
        await load();
      } finally {
        setBusy(false);
      }
    },
    [sessionId, load, t]
  );

  const current = branches.find((b) => b.isCurrent);

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary bg-surface hover:bg-surface-hover transition-colors"
          title={t('branch.switcherTooltip')}
        >
          <GitBranch size={12} className="text-accent" />
          <span className="font-medium truncate max-w-[120px]">
            {current?.name ?? 'main'}
          </span>
          <ChevronDown
            size={10}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="absolute top-full mt-1 right-0 w-72 bg-background border border-border rounded-lg shadow-elevated z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-border-muted flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">
                {t('branch.title')}
              </span>
              <button
                onClick={() => setShowForkDialog(true)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-accent hover:bg-accent-hover text-white"
              >
                <Plus size={10} />
                {t('branch.fork')}
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {error ? (
                <div className="mx-3 mt-2 rounded border border-error/30 bg-error/10 px-2 py-1.5 text-[10px] text-error">
                  {error}
                </div>
              ) : null}
              {loading && (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-text-muted">
                  <Loader2 size={12} className="animate-spin" />
                  {t('common.loading')}
                </div>
              )}
              {!loading && branches.length === 0 && (
                <div className="text-xs text-text-muted text-center py-4">
                  {t('branch.empty')}
                </div>
              )}
              {!loading &&
                branches.map((branch) => (
                  <div
                    key={branch.id}
                    className={`group flex items-start gap-2 px-3 py-2 hover:bg-surface-hover cursor-pointer ${
                      branch.isCurrent ? 'bg-surface-active' : ''
                    }`}
                    onClick={() => void handleCheckout(branch.id)}
                  >
                    <GitBranch
                      size={12}
                      className={`shrink-0 mt-0.5 ${
                        branch.isCurrent ? 'text-accent' : 'text-text-muted'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium text-text-primary truncate">
                          {branch.name}
                        </span>
                        {branch.isCurrent && (
                          <Check size={10} className="text-success shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] text-text-muted">
                        {branch.messageCount}{' '}
                        {t('branch.messagesCount', { count: branch.messageCount })}
                        {branch.parentMessageIndex !== undefined && (
                          <>
                            {' · '}
                            {t('branch.forkedAt', { index: branch.parentMessageIndex })}
                          </>
                        )}
                      </div>
                    </div>
                    {!branch.isCurrent && branch.name !== 'main' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(branch.id, branch.name);
                        }}
                        disabled={busy}
                        className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-error transition-opacity"
                        title={t('common.delete')}
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Fork dialog */}
      {showForkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl shadow-elevated w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <GitFork size={20} className="text-accent" />
                {t('branch.forkDialogTitle')}
              </h2>
              <button
                onClick={() => setShowForkDialog(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X size={18} />
              </button>
            </div>
            {forkFromMessageIndex !== undefined && (
              <p className="text-[11px] text-text-muted mb-3">
                {t('branch.forkingFromMessage', { index: forkFromMessageIndex })}
              </p>
            )}
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFork()}
              placeholder={t('branch.namePlaceholder')}
              autoFocus
              className="w-full px-3 py-2 text-sm bg-surface border border-border rounded text-text-primary focus:outline-none focus:border-accent"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowForkDialog(false)}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void handleFork()}
                disabled={!newBranchName.trim() || busy}
                className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded flex items-center gap-1"
              >
                <GitFork size={12} />
                {t('branch.createFork')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
