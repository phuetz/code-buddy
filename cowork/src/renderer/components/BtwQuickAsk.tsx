/**
 * BtwQuickAsk — P3.9 + global floating window.
 *
 * In-app overlay still uses /btw. The frameless panel (`variant="panel"`)
 * sends to the active conversation and lists running tasks.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, X, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';
import { listRunningTasks, type RunningTaskLine } from '../utils/running-tasks';

interface BtwQuickAskProps {
  onClose: () => void;
  variant?: 'modal' | 'panel';
}

type AppshotPreview = { dataUrl: string; windowName: string } | null;

export function BtwQuickAsk({ onClose, variant = 'modal' }: BtwQuickAskProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteTasks, setRemoteTasks] = useState<RunningTaskLine[]>([]);
  const [appshot, setAppshot] = useState<AppshotPreview>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const storeTasks = listRunningTasks(sessions, sessionStates);
  const tasks = variant === 'panel' ? remoteTasks : storeTasks;
  const isPanel = variant === 'panel';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (appshot) {
          void window.electronAPI?.appshot?.cancel();
          setAppshot(null);
          return;
        }
        onClose();
        if (isPanel) void window.electronAPI?.quickask?.hide();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, appshot, isPanel]);

  useEffect(() => {
    if (!isPanel) return;
    const api = window.electronAPI?.quickask;
    api?.getTasks?.().then((initial) => {
      if (Array.isArray(initial) && initial.length > 0) {
        setRemoteTasks(initial);
      }
    }).catch(() => undefined);
    const offTasks = api?.onTasks?.((next) => setRemoteTasks(next));
    const offPreview = window.electronAPI?.appshot?.onPreview?.((preview) => setAppshot(preview));
    return () => {
      offTasks?.();
      offPreview?.();
    };
  }, [isPanel]);

  const submit = async () => {
    if (!prompt.trim() && !appshot) return;
    setLoading(true);
    setAnswer(null);
    setError(null);
    if (isPanel) {
      try {
        if (appshot) {
          setError(t('appshot.confirmFirst', 'Confirm the screenshot before sending.'));
          setLoading(false);
          return;
        }
        const result = await window.electronAPI?.quickask?.submit(prompt.trim());
        if (result && result.ok === false) {
          setError(
            result.error === 'no_active_session'
              ? t('btw.noActiveSession', 'No active session. Open or create a conversation first.')
              : (result.error ?? t('btw.notAvailable', 'Quick ask is not available.')),
          );
        } else {
          setPrompt('');
          onClose();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
      return;
    }
    const api = window.electronAPI?.command?.execute;
    if (!api) {
      setError(t('btw.notAvailable', '/btw command not available.'));
      setLoading(false);
      return;
    }
    try {
      const result = await api('btw', [prompt.trim()], activeSessionId ?? undefined);
      if (result?.error) {
        setError(result.error);
      } else if (result?.message) {
        setAnswer(result.message);
      } else if (result?.prompt) {
        // Some backends echo the resolved prompt — show as answer for V1.
        setAnswer(result.prompt);
      } else if (result?.handled) {
        setAnswer(t('btw.queued', 'Asked. Reply will appear in the chat.'));
      } else {
        setAnswer(t('btw.noAnswer', 'No answer returned.'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const shellClass = isPanel
    ? 'h-full w-full bg-background text-text-primary'
    : 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center px-4 pt-32';

  return (
    <div
      className={shellClass}
      data-testid="btw-quick-ask"
      data-variant={variant}
      onClick={(e) => {
        if (!isPanel && e.target === e.currentTarget) {
          if (appshot) {
            void window.electronAPI?.appshot?.cancel();
            setAppshot(null);
          }
          onClose();
        }
      }}
    >
      <div className={isPanel ? 'h-full w-full overflow-hidden flex flex-col' : 'bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden'}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">
              {isPanel ? t('btw.panelTitle', 'Quick ask') : t('btw.title', 'By the way…')}
            </h2>
            <span className="text-[10px] text-text-muted">
              {isPanel
                ? t('btw.panelSubtitle', 'sends to the active conversation')
                : t('btw.subtitle', 'one-shot, no tools, no history mutation')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (appshot) {
                void window.electronAPI?.appshot?.cancel();
                setAppshot(null);
              }
              if (isPanel) void window.electronAPI?.quickask?.hide();
              onClose();
            }}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          {tasks.length > 0 && (
            <ul className="space-y-1" data-testid="btw-running-tasks">
              {tasks.map((task) => (
                <li key={task.id} className="text-[11px] text-text-muted truncate">
                  {task.label}
                </li>
              ))}
            </ul>
          )}
          {appshot && (
            <div className="space-y-2" data-testid="appshot-preview">
              <img src={appshot.dataUrl} alt={appshot.windowName} className="w-full max-h-36 object-contain rounded border border-border" />
              <p className="text-[11px] text-text-muted truncate">{appshot.windowName}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="appshot-confirm"
                  className="px-3 py-1.5 text-xs rounded-md bg-accent text-background"
                  onClick={async () => {
                    try {
                      const res = await window.electronAPI?.appshot?.confirm();
                      if (res && res.ok === false) {
                        setError(
                          res.error === 'no_active_session'
                            ? t('btw.noActiveSession', 'No active session. Open or create a conversation first.')
                            : (res.error ?? t('appshot.confirmFailed', 'Failed to send screenshot.')),
                        );
                        return;
                      }
                      setAppshot(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    }
                  }}
                >
                  {t('appshot.send', 'Send screenshot')}
                </button>
                <button
                  type="button"
                  data-testid="appshot-cancel"
                  className="px-3 py-1.5 text-xs rounded-md border border-border"
                  onClick={() => {
                    void window.electronAPI?.appshot?.cancel();
                    setAppshot(null);
                  }}
                >
                  {t('appshot.cancel', 'Cancel')}
                </button>
              </div>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              isPanel
                ? t('btw.panelPlaceholder', 'Message the active chat…')
                : t('btw.placeholder', 'Ask a quick question without touching the conversation…')
            }
            rows={isPanel ? 2 : 3}
            className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            data-testid="btw-input"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted">
              {t('btw.shortcutHint', 'Cmd/Ctrl+Enter to send')}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={loading || !prompt.trim() || Boolean(appshot)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background disabled:opacity-40 hover:bg-accent-hover"
              data-testid="btw-submit"
            >
              {loading && <Loader2 size={12} className="animate-spin" />}
              {loading ? t('btw.asking', 'Asking…') : t('btw.ask', 'Ask')}
            </button>
          </div>
          {error && (
            <div className="text-[11px] text-error bg-error/10 px-2 py-1 rounded">{error}</div>
          )}
          {answer && (
            <div className="border-t border-border-muted pt-3 text-sm text-text-primary whitespace-pre-wrap max-h-72 overflow-y-auto">
              {answer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
