import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Focus, X } from 'lucide-react';
import { useAppStore } from '../store';
import { ScreenHelpButton } from './ScreenHelpButton';
import type { ContentBlock } from '../types';

interface FocusViewProps {
  open: boolean;
  onClose: () => void;
  onStopSession: (sessionId: string) => void;
}

function flattenText(content: ContentBlock[] | undefined): string {
  return (content || [])
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'thinking') return block.thinking;
      if (block.type === 'tool_result') return block.content;
      if (block.type === 'tool_use') return `[${block.name}]`;
      if (block.type === 'file_attachment') return `[file] ${block.filename}`;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function formatElapsed(startAt: number | null, endAt: number | null): string {
  if (!startAt) return '0s';
  const end = endAt ?? Date.now();
  const ms = Math.max(0, end - startAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function FocusView({ open, onClose, onStopSession }: FocusViewProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSession = useAppStore((s) =>
    s.activeSessionId ? (s.sessions.find((session) => session.id === s.activeSessionId) ?? null) : null
  );
  const messageCount = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.messages.length ?? 0) : 0
  );
  const pendingCount = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.pendingTurns.length ?? 0) : 0
  );
  const partialThinking = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.partialThinking ?? '') : ''
  );
  const partialMessage = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.partialMessage ?? '') : ''
  );
  const contextWindow = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.contextWindow ?? 0) : 0
  );
  const executionStartAt = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.executionClock.startAt ?? null) : null
  );
  const executionEndAt = useAppStore((s) =>
    s.activeSessionId ? (s.sessionStates[s.activeSessionId]?.executionClock.endAt ?? null) : null
  );
  const latestPrompt = useAppStore((s) => {
    if (!s.activeSessionId) return '';
    const messages = s.sessionStates[s.activeSessionId]?.messages ?? [];
    const latest = [...messages].reverse().find((message) => message.role === 'user');
    return latest ? flattenText(latest.content) : '';
  });
  const latestResponse = useAppStore((s) => {
    if (!s.activeSessionId) return '';
    const messages = s.sessionStates[s.activeSessionId]?.messages ?? [];
    const latest = [...messages].reverse().find((message) => message.role === 'assistant');
    return latest ? flattenText(latest.content) : '';
  });
  const latestTraceTitle = useAppStore((s) => {
    if (!s.activeSessionId) return '';
    const steps = s.sessionStates[s.activeSessionId]?.traceSteps ?? [];
    return steps.length > 0 ? steps[steps.length - 1]?.title || '' : '';
  });
  const setShowSessionInsights = useAppStore((s) => s.setShowSessionInsights);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm" data-testid="focus-view">
      <div className="absolute inset-6 rounded-[2rem] border border-border-subtle bg-background shadow-elevated overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-muted shrink-0">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-accent/10 p-2 text-accent">
              <Focus className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">
                {t('focusView.title', 'Focus view')}
              </div>
              <div className="text-xs text-text-muted">
                {activeSession?.title || t('focusView.noSession', 'No active session')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ScreenHelpButton screenId="focus" />
            <button
              type="button"
              onClick={() => setShowSessionInsights(true)}
              data-testid="focus-view-open-insights"
              className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover"
            >
              {t('focusView.openInsights', 'Open insights')}
            </button>
            {activeSessionId && activeSession?.status === 'running' && (
              <button
                type="button"
                onClick={() => onStopSession(activeSessionId)}
                className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error hover:bg-error/20"
              >
                {t('focusView.stop', 'Stop')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover"
              title={t('common.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!activeSession ? (
          <div
            className="flex-1 flex items-center justify-center text-sm text-text-muted"
            data-testid="focus-view-empty"
          >
            {t('focusView.noSession', 'No active session')}
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr]">
            <div className="border-r border-border-muted p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border-muted bg-surface px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    {t('focusView.status', 'Status')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-text-primary">
                    {activeSession.status === 'running'
                      ? t('focusView.running', 'Running')
                      : t('focusView.idle', 'Idle')}
                  </div>
                </div>
                <div className="rounded-xl border border-border-muted bg-surface px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    {t('focusView.runtime', 'Runtime')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-text-primary">
                    {formatElapsed(executionStartAt, executionEndAt)}
                  </div>
                </div>
                <div className="rounded-xl border border-border-muted bg-surface px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    {t('focusView.messages', 'Messages')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-text-primary">{messageCount}</div>
                </div>
                <div className="rounded-xl border border-border-muted bg-surface px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    {t('focusView.pending', 'Pending')}
                  </div>
                  <div className="mt-1 text-sm font-medium text-text-primary">{pendingCount}</div>
                </div>
              </div>

              <div className="rounded-xl border border-border-muted bg-surface px-4 py-3 space-y-2">
                <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                  {t('focusView.sessionMeta', 'Session')}
                </div>
                <div className="text-sm text-text-primary">{activeSession.model || '—'}</div>
                <div className="text-xs text-text-muted break-all">{activeSession.cwd || '—'}</div>
                <div className="text-xs text-text-muted">
                  {t('focusView.contextWindow', 'Context window')}: {contextWindow || 0}
                </div>
              </div>
            </div>

            <div className="p-5 grid grid-rows-[auto_auto_1fr] gap-4 min-h-0 overflow-hidden">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-border-muted bg-background px-4 py-3 overflow-hidden">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    {t('focusView.latestPrompt', 'Latest prompt')}
                  </div>
                  <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap break-words line-clamp-6">
                    {latestPrompt || t('focusView.none', 'None')}
                  </div>
                </div>
                <div className="rounded-xl border border-border-muted bg-background px-4 py-3 overflow-hidden">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    {t('focusView.latestResponse', 'Latest response')}
                  </div>
                  <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap break-words line-clamp-6">
                    {latestResponse || t('focusView.none', 'None')}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border-muted bg-background px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                  {t('focusView.liveState', 'Live state')}
                </div>
                <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap break-words line-clamp-6">
                  {partialThinking || partialMessage || t('focusView.noLiveOutput', 'No live output right now')}
                </div>
              </div>

              <div className="rounded-xl border border-border-muted bg-background px-4 py-3 min-h-0 overflow-y-auto">
                <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                  {t('focusView.recentSteps', 'Recent steps')}
                </div>
                <div className="mt-3 text-sm text-text-primary">
                  {latestTraceTitle || t('focusView.noSteps', 'No trace steps yet')}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
