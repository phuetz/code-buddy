import { useState } from 'react';
import { GitFork, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../types';
import { useAppStore } from '../store';
import { SESSION_BRANCH_CHANGED_EVENT } from '../utils/session-branch-events';

interface ForkFromMessageButtonProps {
  message: Message;
  className?: string;
}

/** Forks from the selected persisted message (inclusive), then renders that exact checkout. */
export function ForkFromMessageButton({ message, className = '' }: ForkFromMessageButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createBranch = async () => {
    const normalizedName = name.trim();
    const fork = window.electronAPI?.session?.fork;
    if (!normalizedName || !fork) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fork(
        message.sessionId,
        normalizedName,
        undefined,
        message.id,
      );
      if (!result.success) {
        setError(result.error ?? t('branch.operationFailed'));
        return;
      }
      if (result.messages) {
        useAppStore.getState().setMessages(message.sessionId, result.messages);
      }
      window.dispatchEvent(new CustomEvent(SESSION_BRANCH_CHANGED_EVENT, {
        detail: { sessionId: message.sessionId },
      }));
      setName('');
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('branch.operationFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        title={t('branch.forkFromThisMessage')}
        aria-label={t('branch.forkFromThisMessage')}
        data-testid={`message-fork-${message.id}`}
      >
        <GitFork className="h-3 w-3 text-text-muted" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`fork-title-${message.id}`}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-elevated">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 id={`fork-title-${message.id}`} className="text-base font-semibold text-text-primary">
                  {t('branch.forkFromThisMessage')}
                </h2>
                <p className="mt-1 text-[11px] text-text-muted">
                  {t('branch.forkInclusiveHint')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createBranch();
              }}
              maxLength={80}
              autoFocus
              placeholder={t('branch.namePlaceholder')}
              className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            {error ? (
              <p className="mt-2 rounded border border-error/30 bg-error/10 px-2 py-1.5 text-xs text-error">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void createBranch()}
                disabled={busy || !name.trim()}
                className="flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitFork className="h-3.5 w-3.5" />}
                {t('branch.createFork')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
