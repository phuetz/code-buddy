import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Loader2, Play, Settings2 } from 'lucide-react';
import type { ScheduleTask } from '../types';
import {
  buildFleetScheduledRunNowLabel,
  buildFleetScheduledWorkChips,
  formatScheduleRunAt,
  isFleetScheduledTask,
} from './fleet-command-center-helpers';

export const ScheduledWorkStrip: React.FC<{
  tasks: ScheduleTask[];
  upcomingTasks: ScheduleTask[];
  error: string | null;
  runningTaskId?: string | null;
  onRunNow?: (taskId: string) => void;
  onOpenSettings?: () => void;
}> = ({ tasks, upcomingTasks, error, runningTaskId, onRunNow, onOpenSettings }) => {
  const { t } = useTranslation();
  const enabledCount = tasks.filter((task) => task.enabled).length;
  const fleetCount = tasks.filter(isFleetScheduledTask).length;
  const errorCount = tasks.filter((task) => Boolean(task.lastError)).length;

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-scheduled-work"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <CalendarClock size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-text-secondary">
            {t('fleet.scheduledWork.title', 'Scheduled work')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {fleetCount > 0 && (
            <span
              className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] tabular-nums text-accent"
              title={t('fleet.scheduledWork.fleetCount', 'Fleet {{count}}', {
                count: fleetCount,
              })}
            >
              {t('fleet.scheduledWork.fleetCount', 'Fleet {{count}}', {
                count: fleetCount,
              })}
            </span>
          )}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded border border-border-muted p-1 text-text-muted transition-colors hover:border-accent/50 hover:text-text-primary"
              aria-label={t('fleet.scheduledWork.openSettings', 'Open schedule settings')}
              title={t('fleet.scheduledWork.openSettings', 'Open schedule settings')}
            >
              <Settings2 size={10} />
            </button>
          )}
          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary">
            {enabledCount}/{tasks.length}
          </span>
        </div>
      </div>

      {error ? (
        <div className="mt-1.5 truncate text-[10px] text-error">
          {t('fleet.scheduledWork.loadFailed', 'Schedule load failed')}: {error}
        </div>
      ) : upcomingTasks.length === 0 ? (
        <div className="mt-1.5 text-[10px] text-text-muted">
          {t('fleet.scheduledWork.empty', 'No enabled scheduled run')}
        </div>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {upcomingTasks.map((task) => {
            const chips = buildFleetScheduledWorkChips(task, t);
            const isRunning = runningTaskId === task.id;
            const runNowLabel = buildFleetScheduledRunNowLabel(task, t, isRunning);
            return (
              <li
                key={task.id}
                className={`flex min-w-0 items-start justify-between gap-2 rounded border px-2 py-1 ${
                  task.lastError
                    ? 'border-warning/30 bg-warning/5'
                    : 'border-border-muted bg-surface/70'
                }`}
                title={task.lastError || undefined}
              >
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-text-secondary">{task.title}</div>
                  <div className="mt-0.5 flex min-w-0 flex-wrap gap-1">
                    {chips.map((chip) => (
                      <span
                        key={chip}
                        className={`max-w-full truncate rounded px-1 py-0.5 text-[9px] ${
                          chip === t('fleet.scheduledWork.errorChip', 'Last error')
                            ? 'bg-warning/10 text-warning'
                            : 'bg-surface text-text-muted'
                        }`}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-[10px] text-text-muted">
                    {formatScheduleRunAt(task.nextRunAt)}
                  </span>
                  {onRunNow && (
                    <button
                      type="button"
                      onClick={() => onRunNow(task.id)}
                      disabled={runningTaskId !== null && runningTaskId !== undefined}
                      className="rounded border border-border p-1 text-text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={runNowLabel}
                      title={runNowLabel}
                    >
                      {isRunning ? (
                        <Loader2 size={9} className="animate-spin" />
                      ) : (
                        <Play size={9} />
                      )}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {errorCount > 0 && (
        <div className="mt-1.5 text-[10px] text-warning">
          {errorCount} {t('fleet.scheduledWork.errors', 'task(s) with last error')}
        </div>
      )}
    </section>
  );
};
