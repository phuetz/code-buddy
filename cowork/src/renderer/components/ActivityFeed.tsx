/**
 * ActivityFeed — Claude Cowork parity Phase 2 step 18
 *
 * Slide-out panel from the right edge showing cross-project activity
 * (session start/end, subagents, notifications, checkpoints, gui actions).
 * Grouped by day, filterable by project/type.
 *
 * @module renderer/components/ActivityFeed
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  X,
  Loader2,
  Clock,
  FolderKanban,
  Brain,
  Bot,
  Bell,
  Monitor,
  CheckCircle2,
  GitCommit,
  Trash2,
  Network,
  CalendarClock,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../store';
import { formatAppTime, getAppLocale } from '../utils/i18n-format';
import {
  buildFleetActivityChips,
  buildFleetInternetProofStepLabels,
  buildActivityActionLines,
  buildScheduledTaskActivityChips,
  filterActivityEntries,
  shouldRenderFleetActivityMeta,
  shouldRenderScheduledTaskActivityMeta,
  shouldOpenFleetCommandCenter,
  shouldOpenScheduleSettings,
  type ActivityActionLine,
  type ActivityEntry,
  type ActivityFilter,
} from './activity-feed-helpers';

interface ActivityFeedProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  'session.start': Clock,
  'session.end': Clock,
  'subagent.spawned': Bot,
  'subagent.completed': Bot,
  notification: Bell,
  'checkpoint.created': GitCommit,
  'gui.action': Monitor,
  'task.complete': CheckCircle2,
  'project.created': FolderKanban,
  'project.deleted': FolderKanban,
  'workflow.run': Activity,
  'memory.added': Brain,
  'scheduledTask.started': CalendarClock,
  'scheduledTask.failed': CalendarClock,
  'fleet.dispatch': Network,
  'fleet.saga.completed': Network,
  'fleet.saga.failed': Network,
  'fleet.chatSession.started': Network,
  'fleet.chatSession.turn': Network,
  'fleet.chatSession.ended': Network,
};

function groupByDay(entries: ActivityEntry[], language: string): Array<[string, ActivityEntry[]]> {
  const groups = new Map<string, ActivityEntry[]>();
  const formatter = new Intl.DateTimeFormat(getAppLocale(language), {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  for (const entry of entries) {
    const key = formatter.format(new Date(entry.timestamp));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return Array.from(groups.entries());
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ open, onClose }) => {
  const { i18n, t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);
  const setShowFleetCommandCenter = useAppStore((s) => s.setShowFleetCommandCenter);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.activity?.recent) {
        setEntries([]);
        return;
      }
      const result = await api.activity.recent(100);
      setEntries(result);
    } catch (err) {
      console.error('[ActivityFeed] load failed:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const visibleEntries = useMemo(
    () => filterActivityEntries(entries, filter),
    [entries, filter],
  );
  const activityLocale = i18n.resolvedLanguage || i18n.language;
  const grouped = useMemo(
    () => groupByDay(visibleEntries, activityLocale),
    [visibleEntries, activityLocale],
  );

  const handleClick = (entry: ActivityEntry) => {
    if (entry.projectId) setActiveProjectId(entry.projectId);
    if (entry.sessionId) setActiveSession(entry.sessionId);
    if (shouldOpenScheduleSettings(entry)) {
      setSettingsTab('schedule');
      setShowSettings(true);
    } else if (shouldOpenFleetCommandCenter(entry)) {
      setShowFleetCommandCenter(true);
    }
    onClose();
  };

  const handleClear = async () => {
    if (!confirm(t('activity.clearConfirm'))) return;
    const api = window.electronAPI;
    if (!api?.activity?.clear) return;
    await api.activity.clear();
    await load();
  };

  if (!open) return null;

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-[400px] max-w-[90vw] bg-background border-l border-border shadow-elevated z-40 flex flex-col"
      data-testid="activity-feed"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('activity.title')}
          </span>
          <span className="text-[10px] text-text-muted">
            {t('activity.count', { count: visibleEntries.length })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-1 flex overflow-hidden rounded-md border border-border-muted">
            <button
              type="button"
              onClick={() => setFilter('all')}
              data-testid="activity-filter-all"
              className={`px-2 py-1 text-[10px] transition-colors ${
                filter === 'all'
                  ? 'bg-accent text-background'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t('activity.filterAll', 'All')}
            </button>
            <button
              type="button"
              onClick={() => setFilter('fleet')}
              data-testid="activity-filter-fleet"
              className={`px-2 py-1 text-[10px] transition-colors ${
                filter === 'fleet'
                  ? 'bg-accent text-background'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t('activity.filterFleet', 'Fleet')}
            </button>
            <button
              type="button"
              onClick={() => setFilter('scheduled')}
              data-testid="activity-filter-scheduled"
              className={`px-2 py-1 text-[10px] transition-colors ${
                filter === 'scheduled'
                  ? 'bg-accent text-background'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t('activity.filterScheduled', 'Scheduled')}
            </button>
          </div>
          <button
            onClick={handleClear}
            className="p-1.5 text-text-muted hover:text-error transition-colors"
            title={t('activity.clear')}
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
            title={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {!loading && visibleEntries.length === 0 && (
          <div className="text-center py-12">
            <Activity size={28} className="mx-auto text-text-muted opacity-30 mb-2" />
            <div className="text-xs text-text-muted">
              {filter === 'fleet'
                ? t('activity.emptyFleet', 'No Fleet activity yet')
                : filter === 'scheduled'
                  ? t('activity.emptyScheduled', 'No scheduled activity yet')
                : t('activity.empty')}
            </div>
          </div>
        )}

        {!loading &&
          grouped.map(([day, dayEntries]) => (
            <div key={day} className="border-b border-border-muted last:border-b-0">
              <div className="px-4 py-1.5 bg-surface/50 sticky top-0">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-text-muted">
                  {day}
                </span>
              </div>
              {dayEntries.map((entry) => {
                const Icon = TYPE_ICONS[entry.type] ?? Activity;
                const time = formatAppTime(entry.timestamp);
                const actionLines = buildActivityActionLines(entry);
                return (
                  <button
                    key={entry.id}
                    onClick={() => handleClick(entry)}
                    data-testid={`activity-entry-${entry.id}`}
                    className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors text-left border-l-2 border-transparent hover:border-accent"
                  >
                    <Icon size={12} className="text-text-muted shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-text-primary truncate">
                        {entry.title}
                      </div>
                      {entry.description && (
                        <div className="text-[11px] text-text-muted truncate mt-0.5">
                          {entry.description}
                        </div>
                      )}
                      {actionLines.length > 0 && (
                        <ActivityActionRail lines={actionLines} />
                      )}
                      {shouldRenderFleetActivityMeta(entry) && (
                        <FleetActivityMeta metadata={entry.metadata} />
                      )}
                      {shouldRenderScheduledTaskActivityMeta(entry) && (
                        <ScheduledTaskActivityMeta metadata={entry.metadata} />
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted shrink-0">{time}</span>
                  </button>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
};

const ActivityActionRail: React.FC<{ lines: ActivityActionLine[] }> = ({ lines }) => (
  <div className="mt-1 space-y-0.5">
    {lines.map((line) => (
      <div
        key={line.label}
        title={line.title ?? line.label}
        className={`flex min-h-[18px] items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] leading-4 ${activityActionToneClass(line.tone)}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${activityActionDotClass(line.tone)}`} />
        <span className="min-w-0 truncate font-mono">{line.label}</span>
      </div>
    ))}
  </div>
);

const FleetActivityMeta: React.FC<{ metadata?: Record<string, unknown> }> = ({ metadata }) => {
  if (!metadata) return null;
  const chips = buildFleetActivityChips(metadata);
  const proofSteps = buildFleetInternetProofStepLabels(metadata);
  if (chips.length === 0 && proofSteps.length === 0) return null;
  return (
    <div className="mt-1">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded border border-border-muted bg-surface px-1.5 py-0.5 text-[10px] text-text-muted"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
      {proofSteps.length > 0 && (
        <div className="mt-1 space-y-0.5 text-[10px] leading-4 text-text-muted">
          {proofSteps.map((step) => (
            <div key={step} className="truncate">
              {step}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function activityActionToneClass(tone: ActivityActionLine['tone']): string {
  if (tone === 'success') return 'border-success/30 bg-success/10 text-success';
  if (tone === 'warning') return 'border-warning/40 bg-warning/10 text-warning';
  if (tone === 'running') return 'border-accent/30 bg-accent/10 text-accent';
  return 'border-border-muted bg-background/60 text-text-muted';
}

function activityActionDotClass(tone: ActivityActionLine['tone']): string {
  if (tone === 'success') return 'bg-success';
  if (tone === 'warning') return 'bg-warning';
  if (tone === 'running') return 'bg-accent';
  return 'bg-text-muted';
}

const ScheduledTaskActivityMeta: React.FC<{ metadata?: Record<string, unknown> }> = ({
  metadata,
}) => {
  if (!metadata) return null;
  const chips = buildScheduledTaskActivityChips(metadata);
  const proofSteps = buildFleetInternetProofStepLabels(metadata);
  if (chips.length === 0 && proofSteps.length === 0) return null;
  return (
    <div className="mt-1">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded border border-border-muted bg-surface px-1.5 py-0.5 text-[10px] text-text-muted"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
      {proofSteps.length > 0 && (
        <div className="mt-1 space-y-0.5 text-[10px] leading-4 text-text-muted">
          {proofSteps.map((step) => (
            <div key={step} className="truncate">
              {step}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
