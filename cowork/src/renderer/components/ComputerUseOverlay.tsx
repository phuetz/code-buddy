/**
 * ComputerUseOverlay — Claude Cowork parity Phase 2 step 13
 *
 * Floating rectractable panel that shows the latest gui_operate actions
 * (Computer Use) executed by the agent. Displays the screenshot, click
 * marker, and step-by-step playback of the action sequence.
 *
 * Auto-opens when a new `gui.action` event arrives; can be minimized
 * via the store `setShowComputerUseOverlay(false)`.
 *
 * @module renderer/components/ComputerUseOverlay
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Monitor,
  X,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Minimize2,
  Maximize2,
  StopCircle,
} from 'lucide-react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';

function macroActionLabel(result: unknown): string {
  if (result && typeof result === 'object' && 'action' in result) {
    return String((result as { action?: unknown }).action);
  }
  return String(result);
}

export const ComputerUseOverlay: React.FC = () => {
  const { t } = useTranslation();
  const { stopSession } = useIPC();
  const guiActions = useAppStore((s) => s.guiActions);
  const show = useAppStore((s) => s.showComputerUseOverlay);
  const setShow = useAppStore((s) => s.setShowComputerUseOverlay);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const [stepIndex, setStepIndex] = useState<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Filter to the active session
  const sessionActions = useMemo(() => {
    if (!activeSessionId) return guiActions;
    return guiActions.filter((a) => a.sessionId === activeSessionId);
  }, [guiActions, activeSessionId]);

  // When new actions come in, auto-jump to the latest one.
  React.useEffect(() => {
    if (sessionActions.length > 0) {
      setStepIndex(sessionActions.length - 1);
    } else {
      setStepIndex(-1);
    }
  }, [sessionActions.length]);

  // Playback
  React.useEffect(() => {
    if (!playing) return;
    if (stepIndex >= sessionActions.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      setStepIndex((idx) => Math.min(idx + 1, sessionActions.length - 1));
    }, 1200);
    return () => clearTimeout(timer);
  }, [playing, stepIndex, sessionActions.length]);

  if (!show || sessionActions.length === 0) return null;

  const current = sessionActions[stepIndex] ?? sessionActions[sessionActions.length - 1];
  const screenshotSrc = current?.screenshot?.startsWith('data:')
    ? current.screenshot
    : current?.screenshot
      ? `file://${current.screenshot.replace(/\\/g, '/')}`
      : undefined;
  const macroResults =
    current?.action === 'macro' && Array.isArray(current.details?.macroResults)
      ? current.details.macroResults
      : [];

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg shadow-elevated hover:bg-surface-hover transition-colors"
        title={t('computerUse.expand')}
      >
        <Monitor size={14} className="text-accent" />
        <span className="text-xs text-text-primary">
          {t('computerUse.minimized', { count: sessionActions.length })}
        </span>
        <Maximize2 size={12} className="text-text-muted" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[420px] max-w-[90vw] bg-background border border-border rounded-xl shadow-elevated flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2">
          <Monitor size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('computerUse.title', { defaultValue: 'Computer Use' })}
          </span>
          <span className="text-[10px] text-text-muted">
            {t('computerUse.stepOf', {
              current: stepIndex + 1,
              total: sessionActions.length,
              defaultValue: `${stepIndex + 1} / ${sessionActions.length}`
            })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (activeSessionId) {
                stopSession(activeSessionId);
                setPlaying(false);
              }
            }}
            className="flex items-center gap-1 px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded transition-colors mr-2 shadow-sm"
            title={t('computerUse.panicStop', { defaultValue: 'Stop Agent Immediately' })}
          >
            <StopCircle size={10} strokeWidth={3} />
            <span className="text-[9px] font-black tracking-wider">STOP</span>
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
            title={t('computerUse.minimize')}
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

      {/* Screenshot + click marker */}
      <div className="relative bg-surface/50 border-b border-border-muted min-h-[180px] max-h-[300px] overflow-auto flex items-center justify-center">
        {screenshotSrc ? (
          <div className="relative inline-block">
            <img
              src={screenshotSrc}
              alt="gui-screenshot"
              className="max-w-full max-h-[300px] block"
            />
            {current?.click && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${current.click.x}px`,
                  top: `${current.click.y}px`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="w-6 h-6 rounded-full border-2 border-error bg-error/20 animate-ping" />
                <div className="absolute inset-0 w-6 h-6 rounded-full border-2 border-error" />
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-text-muted py-8">
            {t('computerUse.noScreenshot')}
          </div>
        )}
      </div>

      {/* Action metadata */}
      <div className="px-3 py-2 bg-surface/30 border-b border-border-muted">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-accent">
            {current?.action ?? '—'}
          </span>
          <span className="text-[10px] text-text-muted truncate">
            {current?.toolName}
          </span>
        </div>
        {current?.click && (
          <div className="text-[10px] text-text-muted mt-0.5">
            {t('computerUse.clickAt', { x: current.click.x, y: current.click.y })}
          </div>
        )}
        {current?.action === 'type' && !!current?.details?.text && (
          <div className="text-[10px] text-text-muted mt-0.5">
            {t('computerUse.typeText', { text: String(current.details.text), defaultValue: `Typed: "${String(current.details.text)}"` }) as string}
          </div>
        )}
        {(current?.action === 'key' || current?.action === 'hotkey') && !!current?.details?.key && (
          <div className="text-[10px] text-text-muted mt-0.5">
            {t('computerUse.pressKey', { key: String(current.details.key), defaultValue: `Pressed: ${String(current.details.key)}` }) as string}
          </div>
        )}
        {current?.action === 'scroll' && (
          <div className="text-[10px] text-text-muted mt-0.5">
            {t('computerUse.scroll', { defaultValue: 'Scrolled' }) as string}
          </div>
        )}
        {current?.action === 'click_text' && !!current?.details?.text && (
          <div className="text-[10px] text-text-muted mt-0.5">
            {`OCR Click: "${String(current.details.text)}"`}
          </div>
        )}
        {macroResults.length > 0 && (
          <div className="text-[10px] text-text-muted mt-1 flex flex-col gap-0.5">
            <span className="font-semibold opacity-80">Macro Sequence:</span>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {macroResults.map((res, i) => (
                <span
                  key={i}
                  className="px-1.5 py-[1px] bg-background border border-border-muted rounded-sm text-[9px]"
                >
                  {macroActionLabel(res)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Visual History (Timeline) */}
      <div className="flex gap-2 px-3 py-2 bg-surface/20 border-b border-border-muted overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {sessionActions.slice(-5).map((action, idx) => {
          const actualIndex = sessionActions.length - Math.min(5, sessionActions.length) + idx;
          const isActive = actualIndex === stepIndex;
          const thumbSrc = action.screenshot?.startsWith('data:')
            ? action.screenshot
            : action.screenshot
              ? `file://${action.screenshot.replace(/\\/g, '/')}`
              : undefined;

          return (
            <button
              key={actualIndex}
              onClick={() => { setStepIndex(actualIndex); setPlaying(false); }}
              className={`shrink-0 relative w-16 h-12 rounded border ${isActive ? 'border-accent ring-1 ring-accent shadow-sm' : 'border-border-muted opacity-60 hover:opacity-100'} overflow-hidden transition-all`}
              title={action.toolName}
            >
              {thumbSrc ? (
                <img src={thumbSrc} alt="thumb" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-surface text-[8px] text-text-muted">No Img</div>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-medium text-center truncate px-0.5 py-0.5">
                {action.action || '—'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <button
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex <= 0}
          className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={t('computerUse.previous')}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => setPlaying(!playing)}
          className="flex items-center gap-1 px-3 py-1 text-xs bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
          title={playing ? t('computerUse.pause') : t('computerUse.play')}
        >
          {playing ? <Pause size={11} /> : <Play size={11} />}
          {playing ? t('computerUse.pause') : t('computerUse.play')}
        </button>
        <button
          onClick={() =>
            setStepIndex((i) => Math.min(sessionActions.length - 1, i + 1))
          }
          disabled={stepIndex >= sessionActions.length - 1}
          className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={t('computerUse.next')}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};
