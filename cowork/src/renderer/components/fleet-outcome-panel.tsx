import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  CheckCircle2,
  Copy,
  Lightbulb,
  Loader2,
  Network,
  Send,
  XCircle,
} from 'lucide-react';
import {
  buildFleetOutcomeChips,
  buildFleetOutcomeFollowUpGoal,
  buildFleetOutcomeFollowUpRun,
  buildFleetOutcomeLessonContent,
  buildFleetOutcomeMemoryContent,
  formatActivityDateTime,
  formatActivityTime,
  formatOutcomeDuration,
  metadataNumber,
  metadataString,
  outcomeStatusLabel,
  outcomeStatusTone,
} from './fleet-command-center-helpers';
import type { AgentRun } from '../../../../src/agent/agent-run-contract.js';
import type { ActivityEntry } from './fleet-command-center-helpers';

type MemoryApiBridge = {
  add?: (
    category: 'preference' | 'pattern' | 'context' | 'decision',
    content: string,
    projectId?: string
  ) => Promise<{ success: boolean; error?: string }>;
};

type LessonsApiBridge = {
  add?: (
    category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT',
    content: string,
    projectId?: string
  ) => Promise<{ success: boolean; error?: string; lessonId?: string }>;
};

export const FleetOutcomeStrip: React.FC<{
  entries: ActivityEntry[];
  error: string | null;
  selectedEntryId: number | null;
  onSelectOutcome: (entryId: number) => void;
}> = ({ entries, error, selectedEntryId, onSelectOutcome }) => {
  const { t } = useTranslation();

  return (
    <section
      className="mt-2 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-recent-outcomes"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Network size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-text-secondary">
            {t('fleet.outcomes.title', 'Recent Fleet outcomes')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary">
          {entries.length}
        </span>
      </div>

      {error ? (
        <div className="mt-1.5 truncate text-[10px] text-error">
          {t('fleet.outcomes.loadFailed', 'Activity load failed')}: {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-1.5 text-[10px] text-text-muted">
          {t('fleet.outcomes.empty', 'No completed Fleet saga yet')}
        </div>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {entries.map((entry) => {
            const entryTitle = entry.description ?? entry.title;
            const outcomeStatus = outcomeStatusLabel(entry);
            const failed = outcomeStatus === 'failed';
            const selected = entry.id === selectedEntryId;
            const outcomeChips = buildFleetOutcomeChips(entry, t);
            const outcomeButtonLabel = t(
              'fleet.outcomes.openOutcome',
              'Open Fleet outcome: {{context}}',
              {
                context: [entryTitle, outcomeStatus, ...outcomeChips].filter(Boolean).join(' - '),
              }
            );
            return (
              <li
                key={entry.id}
                className={`rounded border transition-colors ${
                  selected ? 'border-accent/60 bg-accent/10' : 'border-transparent bg-surface/70'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={outcomeButtonLabel}
                  title={outcomeButtonLabel}
                  onClick={() => onSelectOutcome(entry.id)}
                  className="w-full px-2 py-1 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    {failed ? (
                      <XCircle size={10} className="shrink-0 text-error" />
                    ) : (
                      <CheckCircle2 size={10} className="shrink-0 text-success" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
                      {entryTitle}
                    </span>
                    <span className="shrink-0 text-[10px] text-text-muted">
                      {formatActivityTime(entry.timestamp)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {outcomeChips.map((chip) => (
                      <span
                        key={chip}
                        className="rounded border border-border-muted bg-surface/80 px-1.5 py-0.5 text-[10px] text-text-muted"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export const FleetOutcomeDetail: React.FC<{
  entry: ActivityEntry;
  onUseAsGoal: (entry: ActivityEntry, draft: string, run: AgentRun) => void;
  onMemorySaved?: () => void;
}> = ({ entry, onUseAsGoal, onMemorySaved }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [lessonStatus, setLessonStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lessonError, setLessonError] = useState<string | null>(null);
  const metadata = entry.metadata ?? {};
  const sagaId = metadataString(metadata, 'sagaId');
  const status = metadataString(metadata, 'status') ?? outcomeStatusLabel(entry);
  const privacyTag = metadataString(metadata, 'privacyTag') ?? '-';
  const completedSteps = metadataNumber(metadata, 'completedSteps');
  const totalSteps = metadataNumber(metadata, 'totalSteps');
  const failedSteps = metadataNumber(metadata, 'failedSteps') ?? 0;
  const durationMs = metadataNumber(metadata, 'durationMs');
  const finalResultPreview = metadataString(metadata, 'finalResultPreview');
  const errorSummary = metadataString(metadata, 'errorSummary');
  const copyText = finalResultPreview ?? errorSummary ?? entry.description ?? entry.title;
  const followUpGoal = buildFleetOutcomeFollowUpGoal(entry, t);
  const memoryContent = buildFleetOutcomeMemoryContent(entry);
  const lessonContent = buildFleetOutcomeLessonContent(entry);
  const outcomeChips = buildFleetOutcomeChips(entry, t);
  const outcomeActionContext = outcomeChips.length > 0 ? outcomeChips.join(', ') : '';
  const useAsGoalLabel = [
    t('fleet.detail.useOutcomeAsGoal', 'Use as next goal'),
    outcomeActionContext,
  ]
    .filter(Boolean)
    .join(' - ');
  const saveAsMemoryLabel = [
    t('fleet.detail.saveOutcomeMemory', 'Save as memory'),
    outcomeActionContext,
  ]
    .filter(Boolean)
    .join(' - ');
  const saveAsLessonLabel = [
    t('fleet.detail.saveOutcomeLesson', 'Save as lesson'),
    outcomeActionContext,
  ]
    .filter(Boolean)
    .join(' - ');
  const copyOutcomeLabel = [
    copied
      ? t('fleet.detail.copiedOutcome', 'Copied')
      : t('fleet.detail.copyOutcome', 'Copy outcome'),
    outcomeActionContext,
  ]
    .filter(Boolean)
    .join(' - ');
  const memoryApi = getMemoryApi();
  const lessonsApi = getLessonsApi();

  useEffect(() => {
    setCopied(false);
    setMemoryStatus('idle');
    setMemoryError(null);
    setLessonStatus('idle');
    setLessonError(null);
  }, [entry.id]);

  const handleCopyOutcome = async () => {
    if (!copyText || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleUseAsGoal = () => {
    onUseAsGoal(
      entry,
      followUpGoal,
      buildFleetOutcomeFollowUpRun({
        entry,
        followUpGoal,
        t,
      })
    );
  };

  const handleSaveAsMemory = async () => {
    const addMemory = getMemoryApi()?.add;
    if (!addMemory || memoryStatus === 'saving') return;

    setMemoryStatus('saving');
    setMemoryError(null);

    try {
      const result = await addMemory('pattern', memoryContent);
      if (result.success) {
        setMemoryStatus('saved');
        onMemorySaved?.();
        return;
      }
      setMemoryStatus('error');
      setMemoryError(
        result.error ?? t('fleet.detail.saveOutcomeMemoryFailed', 'Memory save failed')
      );
    } catch (err) {
      setMemoryStatus('error');
      setMemoryError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveAsLesson = async () => {
    const addLesson = getLessonsApi()?.add;
    if (!addLesson || lessonStatus === 'saving') return;

    setLessonStatus('saving');
    setLessonError(null);

    try {
      const result = await addLesson('PATTERN', lessonContent);
      if (result.success) {
        setLessonStatus('saved');
        return;
      }
      setLessonStatus('error');
      setLessonError(
        result.error ?? t('fleet.detail.saveOutcomeLessonFailed', 'Lesson save failed')
      );
    } catch (err) {
      setLessonStatus('error');
      setLessonError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="p-4 space-y-3 text-xs">
      <div>
        <div className="text-text-primary font-medium">{entry.description ?? entry.title}</div>
        <div className="mt-0.5 text-[11px] text-text-muted">
          {formatActivityDateTime(entry.timestamp)}
        </div>
      </div>

      {outcomeChips.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="fleet-outcome-detail-chips">
          {outcomeChips.map((chip) => (
            <span
              key={chip}
              className="rounded border border-border-muted bg-surface/80 px-1.5 py-0.5 text-[10px] text-text-muted"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <OutcomeStat
          label={t('fleet.detail.status', 'Status')}
          value={status}
          tone={outcomeStatusTone(entry)}
        />
        <OutcomeStat label={t('fleet.detail.privacy', 'Privacy')} value={privacyTag} />
        <OutcomeStat
          label={t('fleet.detail.steps', 'Steps')}
          value={
            completedSteps !== null && totalSteps !== null ? `${completedSteps}/${totalSteps}` : '-'
          }
        />
        <OutcomeStat
          label={t('fleet.detail.duration', 'Duration')}
          value={durationMs !== null ? formatOutcomeDuration(durationMs) : '-'}
        />
      </div>

      {sagaId && (
        <div className="rounded border border-border-muted bg-surface/70 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Saga</div>
          <div className="mt-0.5 break-all font-mono text-[11px] text-text-secondary">{sagaId}</div>
        </div>
      )}

      {failedSteps > 0 && (
        <div className="rounded border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error">
          {failedSteps === 1
            ? t('fleet.detail.failedStepOne', '1 failed step')
            : t('fleet.detail.failedSteps', '{{count}} failed steps', {
                count: failedSteps,
              })}
        </div>
      )}

      {copyText && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCopyOutcome()}
            aria-label={copyOutcomeLabel}
            title={copyOutcomeLabel}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:border-accent/60 hover:text-accent"
          >
            <Copy size={10} />
            {copied
              ? t('fleet.detail.copiedOutcome', 'Copied')
              : t('fleet.detail.copyOutcome', 'Copy outcome')}
          </button>
          <button
            type="button"
            onClick={handleUseAsGoal}
            aria-label={useAsGoalLabel}
            title={useAsGoalLabel}
            className="inline-flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-[10px] text-accent transition-colors hover:bg-accent/10"
          >
            <Send size={10} />
            {t('fleet.detail.useOutcomeAsGoal', 'Use as next goal')}
          </button>
          {memoryApi?.add && (
            <button
              type="button"
              onClick={() => void handleSaveAsMemory()}
              disabled={memoryStatus === 'saving'}
              aria-label={saveAsMemoryLabel}
              title={saveAsMemoryLabel}
              className="inline-flex items-center gap-1 rounded border border-success/50 px-2 py-1 text-[10px] text-success transition-colors hover:bg-success/10 disabled:opacity-60"
            >
              {memoryStatus === 'saving' ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Brain size={10} />
              )}
              {memoryStatus === 'saving'
                ? t('fleet.detail.savingOutcomeMemory', 'Saving…')
                : memoryStatus === 'saved'
                  ? t('fleet.detail.savedOutcomeMemory', 'Saved as memory')
                  : t('fleet.detail.saveOutcomeMemory', 'Save as memory')}
            </button>
          )}
          {lessonsApi?.add && (
            <button
              type="button"
              onClick={() => void handleSaveAsLesson()}
              disabled={lessonStatus === 'saving'}
              aria-label={saveAsLessonLabel}
              title={saveAsLessonLabel}
              className="inline-flex items-center gap-1 rounded border border-warning/50 px-2 py-1 text-[10px] text-warning transition-colors hover:bg-warning/10 disabled:opacity-60"
            >
              {lessonStatus === 'saving' ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Lightbulb size={10} />
              )}
              {lessonStatus === 'saving'
                ? t('fleet.detail.savingOutcomeLesson', 'Saving lesson…')
                : lessonStatus === 'saved'
                  ? t('fleet.detail.savedOutcomeLesson', 'Saved as lesson')
                  : t('fleet.detail.saveOutcomeLesson', 'Save as lesson')}
            </button>
          )}
        </div>
      )}

      {memoryStatus === 'error' && memoryError && (
        <div className="rounded border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error">
          {t('fleet.detail.saveOutcomeMemoryFailed', 'Memory save failed')}: {memoryError}
        </div>
      )}

      {lessonStatus === 'error' && lessonError && (
        <div className="rounded border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error">
          {t('fleet.detail.saveOutcomeLessonFailed', 'Lesson save failed')}: {lessonError}
        </div>
      )}

      {finalResultPreview && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t('fleet.detail.finalResultPreview', 'Final result preview')}
          </div>
          <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded border border-border-muted bg-surface/80 p-2 text-[11px] text-text-secondary">
            {finalResultPreview}
          </pre>
        </div>
      )}

      {errorSummary && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t('fleet.detail.errorSummary', 'Error summary')}
          </div>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-error/30 bg-error/10 p-2 text-[11px] text-error">
            {errorSummary}
          </pre>
        </div>
      )}

      {!finalResultPreview && !errorSummary && (
        <div className="rounded border border-border-muted bg-surface/70 px-2 py-2 text-[11px] text-text-muted">
          {t(
            'fleet.detail.noFinalPreview',
            'Outcome metadata is available, but no final preview was recorded.'
          )}
        </div>
      )}
    </div>
  );
};

const OutcomeStat: React.FC<{
  label: string;
  value: string;
  tone?: string;
}> = ({ label, value, tone }) => (
  <div className="rounded border border-border-muted bg-surface/70 px-2 py-1.5">
    <div className="uppercase tracking-wide text-text-muted">{label}</div>
    <div className={`mt-0.5 truncate ${tone ?? 'text-text-secondary'}`}>{value}</div>
  </div>
);

function getMemoryApi(): MemoryApiBridge | undefined {
  return (
    window as unknown as {
      electronAPI?: { memory?: MemoryApiBridge };
    }
  ).electronAPI?.memory;
}

function getLessonsApi(): LessonsApiBridge | undefined {
  return (
    window as unknown as {
      electronAPI?: { lessons?: LessonsApiBridge };
    }
  ).electronAPI?.lessons;
}
