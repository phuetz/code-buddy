/**
 * GoalBanner — first-class surface for the autonomous goal loop.
 *
 * The Code Buddy engine adapter runs `maybeContinueGoalAfterTurn` server-side
 * and emits a structured `goal.status` event each turn (engine adapter →
 * runner → `goal.status` ServerEvent → useIPC → store `goalStatesBySession`).
 * This thin strip renders the active goal, turn progress (turnsUsed/maxTurns),
 * the latest judge verdict, and Pause/Clear controls.
 *
 * Pause/Clear re-use the existing slash-command bridge (`/goal pause`,
 * `/goal clear`) — both run NO LLM turn (goal-handler.ts), so we update the
 * store optimistically.
 *
 * @module renderer/components/GoalBanner
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Target, Pause, CircleCheck, CircleX, ChevronDown, ChevronRight, ArrowRight, CircleDot } from 'lucide-react';
import { useAppStore } from '../store';
import { useActiveSessionId } from '../store/selectors';

export const GoalBanner: React.FC = () => {
  const { t } = useTranslation();
  const activeSessionId = useActiveSessionId();
  const goal = useAppStore((s) =>
    activeSessionId ? s.goalStatesBySession[activeSessionId] : undefined,
  );
  const phases = useAppStore((s) =>
    activeSessionId ? s.goalPhasesBySession[activeSessionId] : undefined,
  );
  const setGoalStatus = useAppStore((s) => s.setGoalStatus);
  const clearGoalStatus = useAppStore((s) => s.clearGoalStatus);
  const [busy, setBusy] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);

  if (!activeSessionId || !goal) return null;

  // Show the per-turn timeline once the loop has advanced past the first snapshot.
  const timeline = phases ?? [];
  const hasTimeline = timeline.length > 1;

  const isPaused = goal.status === 'paused';
  const isDone = goal.status === 'done';

  const Icon = isDone ? CircleCheck : isPaused ? Pause : Target;
  const accent = isDone
    ? 'text-success'
    : isPaused
      ? 'text-warning'
      : 'text-accent';
  const pct =
    goal.maxTurns > 0
      ? Math.min(100, Math.round((goal.turnsUsed / goal.maxTurns) * 100))
      : 0;

  const runGoalCommand = async (sub: 'pause' | 'clear') => {
    if (busy) return;
    setBusy(true);
    // Optimistic first: pause/clear run no LLM turn, so no follow-up goal.status
    // event fires to refresh the banner. Update the store immediately for instant
    // feedback, then fire the bridge command (best-effort).
    if (sub === 'clear') {
      clearGoalStatus(activeSessionId);
    } else {
      setGoalStatus(activeSessionId, { ...goal, status: 'paused' });
    }
    try {
      await window.electronAPI?.command?.execute('goal', [sub], activeSessionId);
    } catch {
      /* best-effort — the optimistic UI state already reflects the intent */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="goal-banner" className="border-b border-border bg-surface/60">
      <div className="flex items-center gap-3 px-4 py-1.5 text-xs">
        <Icon className={`w-4 h-4 shrink-0 ${accent}`} />
        <span className="text-text-muted shrink-0">{t('goal.label', 'Goal')}</span>
        <span
          data-testid="goal-banner-text"
          className="truncate font-medium text-text"
          title={goal.goal}
        >
          {goal.goal}
        </span>

        {/* progress bar + count */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <div className="w-20 h-1.5 rounded-full bg-border overflow-hidden" aria-hidden>
            <div
              className={`h-full ${isDone ? 'bg-success' : 'bg-accent'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span data-testid="goal-banner-progress" className="tabular-nums text-text-muted">
            {goal.turnsUsed}/{goal.maxTurns}
          </span>
          {goal.lastVerdict && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                goal.lastVerdict === 'done' ? 'bg-success/15 text-success' : 'bg-border text-text-muted'
              }`}
              title={goal.lastReason}
            >
              {goal.lastVerdict}
            </span>
          )}
        </div>

        {/* controls */}
        <div className="flex items-center gap-1 shrink-0">
          {hasTimeline && (
            <button
              type="button"
              data-testid="goal-banner-timeline-toggle"
              onClick={() => setShowTimeline((v) => !v)}
              className="p-1 rounded hover:bg-border transition-colors"
              title={showTimeline ? t('goal.hideSteps', 'Hide steps') : t('goal.showSteps', 'Show steps')}
              aria-label={showTimeline ? t('goal.hideSteps', 'Hide steps') : t('goal.showSteps', 'Show steps')}
            >
              {showTimeline ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          {!isPaused && !isDone && (
            <button
              type="button"
              data-testid="goal-banner-pause"
              disabled={busy}
              onClick={() => runGoalCommand('pause')}
              className="p-1 rounded hover:bg-border transition-colors disabled:opacity-50"
              title={t('goal.pause', 'Pause goal')}
              aria-label={t('goal.pause', 'Pause goal')}
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            data-testid="goal-banner-clear"
            disabled={busy}
            onClick={() => runGoalCommand('clear')}
            className="p-1 rounded hover:bg-border transition-colors disabled:opacity-50"
            title={t('goal.clear', 'Clear goal')}
            aria-label={t('goal.clear', 'Clear goal')}
          >
            <CircleX className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Per-turn phase timeline — the goal-loop steps unfolding one by one. */}
      {showTimeline && hasTimeline && (
        <ol data-testid="goal-banner-timeline" className="px-4 pb-2 pt-0.5 space-y-0.5">
          {timeline.map((p, i) => {
            const done = p.lastVerdict === 'done' || p.status === 'done';
            const paused = p.status === 'paused';
            const isLast = i === timeline.length - 1;
            const PhaseIcon = done
              ? CircleCheck
              : paused
                ? Pause
                : p.turnsUsed === 0
                  ? CircleDot
                  : ArrowRight;
            const tone = done ? 'text-success' : paused ? 'text-warning' : 'text-text-muted';
            return (
              <li
                key={`${p.turnsUsed}-${i}`}
                className={`flex items-center gap-2 text-[11px] ${isLast ? 'text-text' : 'text-text-muted'}`}
              >
                <PhaseIcon className={`w-3 h-3 shrink-0 ${tone}`} />
                <span className="tabular-nums text-text-muted shrink-0">
                  {p.turnsUsed === 0
                    ? t('goal.stepSet', 'set')
                    : t('goal.stepTurn', { n: p.turnsUsed, defaultValue: 'turn {{n}}' })}
                </span>
                {p.lastVerdict && <span className={`shrink-0 ${tone}`}>· {p.lastVerdict}</span>}
                {p.lastReason && (
                  <span className="truncate text-text-muted/80" title={p.lastReason}>
                    — {p.lastReason}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
