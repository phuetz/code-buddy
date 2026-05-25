import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import {
  formatSagaAge,
  getActiveSagaStageColumn,
  laneClass,
  summarizeSagaToolDecisions,
} from './fleet-command-center-helpers';
import type { SagaBoardColumnKey, SagaStatus, SagaSummary } from './fleet-command-center-helpers';

export const SAGA_BOARD_COLUMNS: Array<{
  key: SagaBoardColumnKey;
  titleKey: string;
  title: string;
  emptyKey: string;
  empty: string;
  statuses: SagaStatus[];
  accentClass: string;
}> = [
  {
    key: 'queued',
    titleKey: 'fleet.sagaBoard.queued',
    title: 'Queued',
    emptyKey: 'fleet.sagaBoard.emptyQueued',
    empty: 'No queued work',
    statuses: ['pending'],
    accentClass: 'bg-border',
  },
  {
    key: 'running',
    titleKey: 'fleet.sagaBoard.running',
    title: 'Running',
    emptyKey: 'fleet.sagaBoard.emptyRunning',
    empty: 'No active run',
    statuses: ['running'],
    accentClass: 'bg-accent',
  },
  // Hermes-style chain stages — only chain sagas surface here. The
  // bucketing logic in `groupSagasForBoard` routes a running chain
  // saga to the column matching its active step's `role`.
  {
    key: 'in_review',
    titleKey: 'fleet.sagaBoard.inReview',
    title: 'In review',
    emptyKey: 'fleet.sagaBoard.emptyInReview',
    empty: 'No saga under review',
    statuses: [],
    accentClass: 'bg-indigo-500',
  },
  {
    key: 'in_test',
    titleKey: 'fleet.sagaBoard.inTest',
    title: 'In test',
    emptyKey: 'fleet.sagaBoard.emptyInTest',
    empty: 'No saga under test',
    statuses: [],
    accentClass: 'bg-purple-500',
  },
  {
    key: 'done',
    titleKey: 'fleet.sagaBoard.done',
    title: 'Done',
    emptyKey: 'fleet.sagaBoard.emptyDone',
    empty: 'No completed saga',
    statuses: ['completed'],
    accentClass: 'bg-success',
  },
  {
    key: 'attention',
    titleKey: 'fleet.sagaBoard.attention',
    title: 'Needs attention',
    emptyKey: 'fleet.sagaBoard.emptyAttention',
    empty: 'No blocked saga',
    statuses: ['failed', 'cancelled'],
    accentClass: 'bg-error',
  },
];

/**
 * Bucket sagas into Kanban columns.
 *
 * Chain sagas (Hermes-style sequential collab) take precedence: their
 * active step's `role` drives the column (in_review / in_test / running).
 * Non-chain sagas fall back to status-based bucketing (the legacy
 * behaviour preserved here unchanged).
 */
export function groupSagasForBoard(
  sagas: SagaSummary[]
): Record<SagaBoardColumnKey, SagaSummary[]> {
  const buckets: Record<SagaBoardColumnKey, SagaSummary[]> = {
    queued: [],
    running: [],
    in_review: [],
    in_test: [],
    done: [],
    attention: [],
  };
  for (const saga of sagas) {
    const stageColumn = getActiveSagaStageColumn(saga);
    if (stageColumn) {
      buckets[stageColumn].push(saga);
      continue;
    }
    const column = SAGA_BOARD_COLUMNS.find((c) => c.statuses.includes(saga.status));
    if (column) {
      buckets[column.key].push(saga);
    }
  }
  return buckets;
}

export const SagaBoard: React.FC<{
  sagas: SagaSummary[];
  selectedSagaId: string | null;
  onSelectSaga: (sagaId: string) => void;
}> = ({ sagas, selectedSagaId, onSelectSaga }) => {
  const { t } = useTranslation();
  const sagaBoard = useMemo(() => groupSagasForBoard(sagas), [sagas]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-text-muted sticky top-0 bg-background border-b border-border-muted">
        {t('fleet.sagaBoard.title', 'Saga board')} ({sagas.length})
      </div>
      {sagas.length === 0 ? (
        <div className="p-6 text-xs text-text-muted text-center">
          {t('fleet.noSagas', 'Aucune saga en cours.')}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 p-2" data-testid="fleet-saga-board">
          {SAGA_BOARD_COLUMNS.map((column) => (
            <SagaBoardLane
              key={column.key}
              columnKey={column.key}
              title={t(column.titleKey, column.title)}
              emptyLabel={t(column.emptyKey, column.empty)}
              accentClass={column.accentClass}
              sagas={sagaBoard[column.key]}
              selectedSagaId={selectedSagaId}
              onSelectSaga={onSelectSaga}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const SagaBoardLane: React.FC<{
  columnKey: SagaBoardColumnKey;
  title: string;
  emptyLabel: string;
  accentClass: string;
  sagas: SagaSummary[];
  selectedSagaId: string | null;
  onSelectSaga: (sagaId: string) => void;
}> = ({ columnKey, title, emptyLabel, accentClass, sagas, selectedSagaId, onSelectSaga }) => (
  <section
    className="min-w-0 rounded border border-border-muted bg-surface/60 overflow-hidden"
    data-testid={`fleet-saga-lane-${columnKey}`}
  >
    <div className={`h-0.5 ${accentClass}`} />
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border-muted">
      <span className="min-w-0 truncate text-[10px] uppercase tracking-wider text-text-secondary">
        {title}
      </span>
      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary">
        {sagas.length}
      </span>
    </div>
    {sagas.length === 0 ? (
      <div className="px-2 py-3 text-center text-[10px] text-text-muted">{emptyLabel}</div>
    ) : (
      <ul className="space-y-1 p-1.5">
        {sagas.map((saga) => (
          <SagaRow
            key={saga.id}
            saga={saga}
            selected={saga.id === selectedSagaId}
            onSelect={onSelectSaga}
          />
        ))}
      </ul>
    )}
  </section>
);

const SagaRow: React.FC<{
  saga: SagaSummary;
  selected: boolean;
  onSelect: (sagaId: string) => void;
}> = ({ saga, selected, onSelect }) => {
  const { t } = useTranslation();
  const total = saga.steps.length;
  const done = saga.steps.filter((s) => s.status === 'completed').length;
  const failed = saga.steps.filter((s) => s.status === 'failed').length;
  const running = saga.steps.filter((s) => s.status === 'running').length;
  const age = formatSagaAge(saga.createdAt);
  const toolDecisions = summarizeSagaToolDecisions(saga);
  return (
    <li
      className={`p-2 rounded border transition-colors ${
        selected ? 'border-accent/60 bg-accent/10' : 'border-border-muted bg-surface/60'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(saga.id)}
        aria-pressed={selected}
        className="w-full text-left"
      >
        <div className="flex items-center gap-2">
          <SagaStatusIcon status={saga.status} />
          <span className="text-xs text-text-primary truncate flex-1">{saga.goal}</span>
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted tabular-nums">
            <span>{saga.status}</span>
            {age && <span>{age}</span>}
            <span>
              {done}/{total}
            </span>
          </div>
        </div>
        <div className="mt-1.5 h-1 bg-surface rounded overflow-hidden flex">
          <div
            className="bg-success transition-all"
            style={{ width: `${(done / Math.max(1, total)) * 100}%` }}
          />
          <div
            className="bg-accent transition-all"
            style={{ width: `${(running / Math.max(1, total)) * 100}%` }}
          />
          <div
            className="bg-error transition-all"
            style={{ width: `${(failed / Math.max(1, total)) * 100}%` }}
          />
        </div>
        {toolDecisions.total > 0 && (
          <div
            data-testid="fleet-saga-tool-decision-summary"
            className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px]"
          >
            <span className="rounded border border-border bg-surface/80 px-1 py-0.5 uppercase tracking-wide text-text-muted">
              {t('fleet.detail.toolPolicy', 'Tool policy')}
            </span>
            <span className="rounded border border-success/30 bg-success/10 px-1 py-0.5 font-mono text-success">
              allow {toolDecisions.allow}
            </span>
            <span className="rounded border border-warning/30 bg-warning/10 px-1 py-0.5 font-mono text-warning">
              confirm {toolDecisions.confirm}
            </span>
            <span className="rounded border border-error/30 bg-error/10 px-1 py-0.5 font-mono text-error">
              deny {toolDecisions.deny}
            </span>
          </div>
        )}
      </button>
      {total > 0 && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-text-muted cursor-pointer hover:text-text-primary">
            {t('fleet.detail.trace', 'Trace')} ({total})
          </summary>
          <ol className="mt-1 space-y-1">
            {saga.steps.map((step, index) => (
              <li
                key={`${step.peerId}-${step.model}-${step.lane}-${index}`}
                className="flex items-center gap-2 rounded bg-surface/70 px-2 py-1 text-[10px]"
              >
                <StepStatusIcon status={step.status} />
                <span className={`shrink-0 uppercase tracking-wide ${laneClass(step.lane)}`}>
                  {step.lane}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-secondary">{step.peerId}</span>
                <span className="min-w-0 max-w-[42%] truncate font-mono text-text-muted">
                  {step.model}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {saga.finalResult && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-text-muted cursor-pointer hover:text-text-primary">
            {t('fleet.detail.viewFinalResult', 'View final result')}
          </summary>
          <pre className="mt-1 p-2 text-[11px] bg-background rounded text-text-secondary whitespace-pre-wrap overflow-x-auto max-h-32">
            {saga.finalResult}
          </pre>
        </details>
      )}
    </li>
  );
};

const SagaStatusIcon: React.FC<{ status: SagaSummary['status'] }> = ({ status }) => {
  if (status === 'running') {
    return <Loader2 size={11} className="text-accent animate-spin shrink-0" />;
  }
  if (status === 'completed') {
    return <CheckCircle2 size={11} className="text-success shrink-0" />;
  }
  if (status === 'failed' || status === 'cancelled') {
    return <XCircle size={11} className="text-error shrink-0" />;
  }
  return <CircleDashed size={11} className="text-text-muted shrink-0" />;
};

export const StepStatusIcon: React.FC<{
  status: SagaSummary['steps'][number]['status'];
}> = ({ status }) => {
  if (status === 'running') {
    return <Loader2 size={10} className="text-accent animate-spin shrink-0" />;
  }
  if (status === 'completed') {
    return <CheckCircle2 size={10} className="text-success shrink-0" />;
  }
  if (status === 'failed') {
    return <XCircle size={10} className="text-error shrink-0" />;
  }
  if (status === 'skipped') {
    return <CircleDashed size={10} className="text-text-muted shrink-0" />;
  }
  return <CircleDashed size={10} className="text-text-muted shrink-0" />;
};
