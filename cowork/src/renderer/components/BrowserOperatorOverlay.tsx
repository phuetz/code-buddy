/**
 * BrowserOperatorOverlay — S2 (Browser Operator pilotability)
 *
 * Floating, retractable panel that shows the live browser-automation action log
 * executed by the agent (navigate / click / type / extract / screenshot …),
 * with the latest page screenshot when available and a panic STOP control.
 *
 * Auto-opens when a `browser.action` event arrives (store.appendBrowserAction).
 * Mirrors ComputerUseOverlay but for the browser tool; positioned bottom-LEFT so
 * the two operator overlays don't overlap.
 *
 * @module renderer/components/BrowserOperatorOverlay
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, X, Minimize2, Maximize2, StopCircle } from 'lucide-react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { BrowserOperatorRuntimeCard } from './BrowserOperatorRuntimeCard';
import type {
  BrowserOperatorRuntimeEvent,
  BrowserOperatorRuntimeView,
  BrowserOperatorSessionDraftInput,
} from '../../shared/browser-operator-runtime-types';

interface PreparedRuntime {
  runtime: BrowserOperatorRuntimeView;
  draft: BrowserOperatorSessionDraftInput;
}

export const BrowserOperatorOverlay: React.FC = () => {
  const { t } = useTranslation();
  const { stopSession } = useIPC();
  const browserActions = useAppStore((s) => s.browserActions);
  const show = useAppStore((s) => s.showBrowserOperatorOverlay);
  const setShow = useAppStore((s) => s.setShowBrowserOperatorOverlay);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const [minimized, setMinimized] = useState(false);
  const [preparedRuntime, setPreparedRuntime] = useState<PreparedRuntime | null>(null);
  const [runtimeEvents, setRuntimeEvents] = useState<BrowserOperatorRuntimeEvent[]>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [preparingRuntime, setPreparingRuntime] = useState(false);

  const sessionActions = useMemo(() => {
    if (!activeSessionId) return browserActions;
    return browserActions.filter((a) => a.sessionId === activeSessionId);
  }, [browserActions, activeSessionId]);

  const proposedDraft = useMemo(() => {
    const candidate = [...sessionActions]
      .reverse()
      .find((action) => action.action === 'browser_operator')
      ?.details?.operatorDraft;
    return isBrowserOperatorDraft(candidate) ? candidate : null;
  }, [sessionActions]);
  const proposalKey = proposedDraft
    ? `${proposedDraft.sessionId}:${proposedDraft.generatedAt}`
    : null;

  useEffect(() => {
    setPreparedRuntime((current) => {
      if (current && ['running', 'stopping'].includes(current.runtime.state)) return current;
      return null;
    });
    setRuntimeEvents([]);
    setRuntimeError(null);
  }, [activeSessionId, proposalKey]);

  useEffect(() => {
    const api = window.electronAPI?.browserOperatorRuntime;
    const runtimeId = preparedRuntime?.runtime.runtimeId;
    if (!api?.onEvent || !runtimeId) return;
    return api.onEvent((event) => {
      if (event.runtime.runtimeId !== runtimeId) return;
      setPreparedRuntime((current) => current
        ? { ...current, runtime: event.runtime }
        : current);
      setRuntimeEvents((current) => [...current, event].slice(-100));
    });
  }, [preparedRuntime?.runtime.runtimeId]);

  const prepareRuntime = useCallback(async () => {
    const api = window.electronAPI?.browserOperatorRuntime;
    if (!api || !activeSessionId || !proposedDraft || preparingRuntime) return;
    setPreparingRuntime(true);
    setRuntimeError(null);
    try {
      const result = await api.prepare({
        ownerSessionId: activeSessionId,
        draft: proposedDraft,
      });
      if (!result.ok) {
        setRuntimeError(result.error);
        return;
      }
      setPreparedRuntime({ runtime: result.runtime, draft: result.draft });
      setRuntimeEvents([]);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreparingRuntime(false);
    }
  }, [activeSessionId, preparingRuntime, proposedDraft]);

  const runtimeIsActive = preparedRuntime
    ? ['running', 'stopping'].includes(preparedRuntime.runtime.state)
    : false;

  const panicStop = useCallback(async () => {
    const api = window.electronAPI?.browserOperatorRuntime;
    if (runtimeIsActive && preparedRuntime && api) {
      const result = await api.stop({
        runtimeId: preparedRuntime.runtime.runtimeId,
        ownerSessionId: preparedRuntime.runtime.ownerSessionId,
      });
      if (result.ok) {
        setPreparedRuntime((current) => current
          ? { ...current, runtime: result.runtime }
          : current);
      } else {
        setRuntimeError(result.error);
      }
      return;
    }
    if (activeSessionId) stopSession(activeSessionId);
  }, [activeSessionId, preparedRuntime, runtimeIsActive, stopSession]);

  if ((!show || sessionActions.length === 0) && !runtimeIsActive) return null;

  if (!show && runtimeIsActive) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-lg border border-red-500/40 bg-background px-3 py-2 text-xs text-text-primary shadow-elevated"
        data-testid="browser-operator-running-handle"
      >
        <Globe size={14} className="text-red-500" />
        Browser Operator actif
        <Maximize2 size={12} className="text-text-muted" />
      </button>
    );
  }

  const latest = sessionActions[sessionActions.length - 1];
  const screenshotSrc = latest?.screenshot?.startsWith('data:')
    ? latest.screenshot
    : latest?.screenshot
      ? `file://${latest.screenshot.replace(/\\/g, '/')}`
      : undefined;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg shadow-elevated hover:bg-surface-hover transition-colors"
        title={t('browserOperator.expand', { defaultValue: 'Expand browser operator' })}
      >
        <Globe size={14} className="text-accent" />
        <span className="text-xs text-text-primary">
          {t('browserOperator.minimized', {
            count: sessionActions.length,
            defaultValue: `${sessionActions.length} browser actions`,
          })}
        </span>
        <Maximize2 size={12} className="text-text-muted" />
      </button>
    );
  }

  return (
    <div data-testid="browser-operator-overlay" className="fixed bottom-4 left-4 z-40 flex max-h-[80vh] w-[520px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-elevated transition-all duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('browserOperator.title', { defaultValue: 'Browser Operator' })}
          </span>
          <span className="text-[10px] text-text-muted">
            {t('browserOperator.count', {
              count: preparedRuntime?.runtime.actionCount ?? sessionActions.length,
              defaultValue: `${preparedRuntime?.runtime.actionCount ?? sessionActions.length} actions`,
            })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(!preparedRuntime || runtimeIsActive) && (
            <button
              onClick={() => void panicStop()}
              className="flex items-center gap-1 px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded transition-colors mr-2 shadow-sm"
              title={runtimeIsActive
                ? 'Arrêter immédiatement ce navigateur'
                : t('browserOperator.panicStop', { defaultValue: 'Stop Agent Immediately' })}
            >
              <StopCircle size={10} strokeWidth={3} />
              <span className="text-[9px] font-black tracking-wider">STOP</span>
            </button>
          )}
          <button
            onClick={() => setMinimized(true)}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
            title={t('common.minimize', { defaultValue: 'Minimize' })}
          >
            <Minimize2 size={12} />
          </button>
          <button
            onClick={() => setShow(false)}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
            title={t('common.close')}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* The old "Live View" webview loaded the same URL in a different browser
          and was therefore misleading. This panel now shows only the actual
          runtime receipt, screenshots and action events. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(proposedDraft || preparedRuntime || runtimeError) && (
          <div className="border-b border-border-muted p-3">
            {preparedRuntime ? (
              <BrowserOperatorRuntimeCard
                runtime={preparedRuntime.runtime}
                draft={preparedRuntime.draft}
                events={runtimeEvents}
                onApprove={(input) => window.electronAPI.browserOperatorRuntime.start(input)}
                onStop={(input) => window.electronAPI.browserOperatorRuntime.stop(input)}
                onRuntimeChange={(runtime) => setPreparedRuntime((current) => current
                  ? { ...current, runtime }
                  : current)}
              />
            ) : proposedDraft ? (
              <div className="rounded-xl border border-accent/25 bg-accent/5 p-3">
                <p className="text-xs font-semibold text-text-primary">Plan Browser Operator prêt à relire</p>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                  La préparation compile le plan exact et calcule son empreinte. Elle ne lance pas le navigateur.
                </p>
                <button
                  type="button"
                  onClick={() => void prepareRuntime()}
                  disabled={preparingRuntime || !activeSessionId}
                  data-testid="browser-operator-prepare-runtime"
                  className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {preparingRuntime ? 'Préparation…' : 'Préparer le runtime réel'}
                </button>
              </div>
            ) : null}
            {runtimeError && (
              <p role="alert" className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
                {runtimeError}
              </p>
            )}
          </div>
        )}

          {/* Latest screenshot (if any) */}
          {screenshotSrc && (
            <div className="relative bg-surface/50 border-b border-border-muted max-h-[240px] overflow-auto flex items-center justify-center shrink-0">
              <img src={screenshotSrc} alt="browser-screenshot" className="max-w-full max-h-[240px] block" />
            </div>
          )}

          {/* Live action log (latest last) */}
          <div className="flex-1 overflow-y-auto divide-y divide-border-muted/60 min-h-[100px]">
            {sessionActions.map((a, idx) => (
          <div key={`${a.toolUseId}-${idx}`} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-accent">
                {a.action}
              </span>
              {a.url && (
                <span className="text-[10px] text-text-muted truncate" title={a.url}>
                  {a.url}
                </span>
              )}
            </div>
            {a.target && (
              <div className="text-[10px] text-text-muted mt-0.5 truncate" title={a.target}>
                → {a.target}
              </div>
            )}
            {a.evidence && (
              <div className="text-[10px] text-text-muted/80 mt-0.5 line-clamp-2">{a.evidence}</div>
            )}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
};

function isBrowserOperatorDraft(value: unknown): value is BrowserOperatorSessionDraftInput {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<BrowserOperatorSessionDraftInput>;
  return draft.schemaVersion === 1
    && typeof draft.sessionId === 'string'
    && typeof draft.generatedAt === 'string'
    && typeof draft.goal === 'string'
    && (draft.mode === 'isolated' || draft.mode === 'local')
    && Array.isArray(draft.actionLog);
}
