import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Clock } from 'lucide-react';
import type { SessionExecutionClock } from '../store';

interface LiveTimerProps {
  executionClock: SessionExecutionClock | undefined;
  hasActiveTurn: boolean;
  partialMessage: string | null;
  partialThinking: string | null;
}

function formatExecutionTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Self-contained real-time execution timer.
 *
 * The 100 ms tick lives here (its own state + interval) so the running clock
 * never re-renders the parent ChatView / the whole message list — only this
 * tiny component repaints 10×/s while a turn is active.
 */
export function LiveTimer({
  executionClock,
  hasActiveTurn,
  partialMessage,
  partialThinking,
}: LiveTimerProps) {
  const { t } = useTranslation();
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const isActive = Boolean(executionClock?.startAt && executionClock.endAt === null);
    if (!isActive) {
      return;
    }
    setClockNow(Date.now());
    const interval = setInterval(() => {
      setClockNow(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, [executionClock?.startAt, executionClock?.endAt]);

  const liveElapsed =
    executionClock?.startAt == null
      ? 0
      : Math.max(0, (executionClock.endAt ?? clockNow) - executionClock.startAt);
  const timerActive = Boolean(executionClock?.startAt && executionClock.endAt === null);

  return (
    <>
      {hasActiveTurn && (!partialMessage || partialMessage.trim() === '') && !partialThinking && (
        <div className="max-w-3xl mx-auto px-4 w-full">
          <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl bg-background/80 border border-border-subtle max-w-fit">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-accent animate-spin" />
              <span className="text-sm text-text-secondary">
                {t('chat.processing')}
                {liveElapsed > 1000 && (
                  <span className="text-text-muted/80 ml-2 tabular-nums">
                    · {Math.floor(liveElapsed / 1000)}s
                  </span>
                )}
              </span>
            </div>
            {liveElapsed > 5000 && liveElapsed < 30000 && (
              <span className="text-[11px] text-text-muted/70 ml-7 italic">
                {t(
                  'chat.modelLoading',
                  'Loading model or generating thinking — first token usually arrives within 30 s.'
                )}
              </span>
            )}
            {liveElapsed >= 30000 && (
              <span className="text-[11px] text-warning/80 ml-7 italic">
                {t(
                  'chat.modelColdStart',
                  'Cold start in progress (large local models can take 30–120 s on first run).'
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Real-time execution timer */}
      {liveElapsed > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1 ml-0.5">
          <Clock className="w-3 h-3" />
          <span>
            {timerActive
              ? formatExecutionTime(liveElapsed)
              : t('messageCard.executionTime', { time: formatExecutionTime(liveElapsed) })}
          </span>
        </div>
      )}
    </>
  );
}
