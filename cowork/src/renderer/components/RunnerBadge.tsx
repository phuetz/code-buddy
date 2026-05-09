/**
 * RunnerBadge — surfaces which agentic loop is active in the titlebar.
 *
 * Polls `electronAPI.runner.status()` every 5 s. Shows:
 *   - Green "engine" dot when the embedded Code Buddy core engine is
 *     running (the modern path with middlewares + sanitizer).
 *   - Orange "pi" dot when we fell back to the legacy pi-coding-agent
 *     runner (engine bundle missing or `CODEBUDDY_EMBEDDED=0`).
 *   - Red dot if the boot reported an error.
 *
 * Click → opens a tiny tooltip-like dialog explaining what the badge
 * means and how to switch. Read-only for V1; the toggle UI lives in
 * Settings → Advanced (Phase 4).
 *
 * @module renderer/components/RunnerBadge
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';

interface RunnerStatus {
  runner: 'engine' | 'pi';
  engineReady: boolean;
  bootError: string | null;
}

export const RunnerBadge: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await window.electronAPI?.runner?.status();
        if (!cancelled && s) setStatus(s);
      } catch {
        /* ignore — IPC channel might not be ready at first paint */
      }
    };
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!status) return null;

  const isEngine = status.runner === 'engine';
  const hasError = status.bootError !== null;
  const dotColor = hasError
    ? 'bg-error'
    : isEngine
      ? 'bg-success'
      : 'bg-warning';
  const tooltip = hasError
    ? `Runner error: ${status.bootError}`
    : isEngine
      ? t(
          'runner.engineActive',
          'Code Buddy core engine active (middlewares + sanitizer)',
        )
      : t(
          'runner.piFallback',
          'Legacy pi-coding-agent fallback (engine bundle unavailable or opted out)',
        );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={tooltip}
        aria-label={tooltip}
        data-testid="runner-badge"
      >
        <Cpu
          className={`w-4 h-4 ${
            hasError ? 'text-error' : isEngine ? 'text-success' : 'text-warning'
          }`}
        />
        <span
          className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${dotColor}`}
        />
      </button>
      {open && <RunnerDetailsDialog status={status} onClose={() => setOpen(false)} />}
    </>
  );
};

interface RunnerDetailsDialogProps {
  status: RunnerStatus;
  onClose: () => void;
}

const RunnerDetailsDialog: React.FC<RunnerDetailsDialogProps> = ({ status, onClose }) => {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[480px] max-w-[92vw] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 text-sm text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Cpu
            className={`w-4 h-4 ${
              status.runner === 'engine' ? 'text-success' : 'text-warning'
            }`}
          />
          <h2 className="font-medium">
            {status.runner === 'engine'
              ? t('runner.dialog.titleEngine', 'Code Buddy core engine')
              : t('runner.dialog.titlePi', 'pi-coding-agent fallback')}
          </h2>
        </div>
        <p className="text-zinc-400 text-xs leading-relaxed">
          {status.runner === 'engine'
            ? t(
                'runner.dialog.bodyEngine',
                'Cowork is running on the embedded Code Buddy core engine. This includes the 7 conversation middlewares (turn limits, cost tracking, reasoning injection, auto-repair, …), output sanitizer, and transcript repair. MCP servers configured in Settings are kept in sync automatically.',
              )
            : t(
                'runner.dialog.bodyPi',
                'Cowork fell back to the legacy pi-coding-agent runner. This happens when the engine bundle is absent (run `npm run build` from the repo root to ship it) or when `CODEBUDDY_EMBEDDED=0` is set. The pi path is functional but lacks the core middlewares.',
              )}
        </p>
        {status.bootError && (
          <div className="mt-3 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
            {status.bootError}
          </div>
        )}
        <div className="mt-4 text-[10px] text-zinc-500">
          {t('runner.dialog.envHint', 'Set CODEBUDDY_EMBEDDED=0 to force pi.')}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            {t('common.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
