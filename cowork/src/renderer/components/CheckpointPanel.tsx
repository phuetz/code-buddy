/**
 * CheckpointPanel — Timeline of snapshots with undo/redo
 *
 * Phase 3 step 18: adds a horizontal "timeline" mode alongside the list
 * view, a compare mode for selecting two arbitrary checkpoints, and
 * uses Cowork theme tokens instead of hard-coded zinc colors.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Undo2,
  Redo2,
  Clock,
  RotateCcw,
  GitCompare,
  List as ListIcon,
  Activity,
} from 'lucide-react';
import type { CheckpointTimeline } from '../types';
import { formatAppTime } from '../utils/i18n-format';

interface CheckpointPanelProps {
  timeline: CheckpointTimeline | null;
  onUndo: () => void;
  onRedo: () => void;
  onRestore: (snapshotId: string) => void;
  /** Optional hook for the new compare flow (Phase 3 step 18) */
  onCompare?: (a: string, b: string) => void;
}

function formatTime(ts: number): string {
  return formatAppTime(ts, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

type Mode = 'list' | 'timeline';

const EMPTY_SNAPSHOTS: CheckpointTimeline['snapshots'] = [];

export const CheckpointPanel: React.FC<CheckpointPanelProps> = ({
  timeline,
  onUndo,
  onRedo,
  onRestore,
  onCompare,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('list');
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);

  const snapshots = timeline?.snapshots ?? EMPTY_SNAPSHOTS;
  const currentIndex = timeline?.currentIndex ?? -1;

  const minTs = useMemo(() => (snapshots[0]?.timestamp ?? 0), [snapshots]);
  const maxTs = useMemo(
    () => (snapshots[snapshots.length - 1]?.timestamp ?? 0),
    [snapshots]
  );
  const tsRange = Math.max(1, maxTs - minTs);

  if (!timeline || snapshots.length === 0) {
    return (
      <div className="text-xs text-text-muted px-3 py-2">
        {t('checkpoints.empty', 'No checkpoints yet. Changes will be tracked automatically.')}
      </div>
    );
  }

  const handleSnapshotClick = (snapshotId: string) => {
    if (compareMode) {
      if (!compareA) {
        setCompareA(snapshotId);
      } else if (!compareB && snapshotId !== compareA) {
        setCompareB(snapshotId);
        if (onCompare) onCompare(compareA, snapshotId);
      } else {
        setCompareA(snapshotId);
        setCompareB(null);
      }
    } else {
      onRestore(snapshotId);
    }
  };

  const toggleCompareMode = () => {
    setCompareMode((prev) => {
      const next = !prev;
      if (!next) {
        setCompareA(null);
        setCompareB(null);
      }
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-muted">
        <button
          onClick={onUndo}
          disabled={!timeline.canUndo}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-text-primary"
          title={t('checkpoints.undo', 'Undo last change')}
        >
          <Undo2 size={12} />
          {t('checkpoints.undoLabel', 'Undo')}
        </button>
        <button
          onClick={onRedo}
          disabled={!timeline.canRedo}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-text-primary"
          title={t('checkpoints.redo', 'Redo')}
        >
          <Redo2 size={12} />
          {t('checkpoints.redoLabel', 'Redo')}
        </button>
        <button
          onClick={() => setMode(mode === 'list' ? 'timeline' : 'list')}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface hover:bg-surface-hover transition-colors text-text-secondary"
          title={
            mode === 'list'
              ? t('checkpoints.timelineMode', 'Timeline view')
              : t('checkpoints.listMode', 'List view')
          }
        >
          {mode === 'list' ? <Activity size={12} /> : <ListIcon size={12} />}
        </button>
        <button
          onClick={toggleCompareMode}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
            compareMode
              ? 'bg-accent text-white'
              : 'bg-surface hover:bg-surface-hover text-text-secondary'
          }`}
          title={t('checkpoints.compare', 'Compare checkpoints')}
        >
          <GitCompare size={12} />
        </button>
        <span className="text-xs text-text-muted ml-auto">
          {snapshots.length} {t('checkpoints.count', 'checkpoint(s)')}
        </span>
      </div>

      {compareMode && (
        <div className="px-3 py-1.5 text-[10px] bg-accent/5 border-b border-accent/20 text-accent">
          {compareA && compareB
            ? t('checkpoints.comparing', 'Comparing two checkpoints')
            : compareA
              ? t('checkpoints.selectSecond', 'Click a second checkpoint to compare')
              : t('checkpoints.selectFirst', 'Click a checkpoint to start compare')}
        </div>
      )}

      {mode === 'list' ? (
        <div className="max-h-48 overflow-y-auto">
          {snapshots.map((snapshot, index) => {
            const isCurrent = index === currentIndex;
            const isCompareA = snapshot.id === compareA;
            const isCompareB = snapshot.id === compareB;
            return (
              <button
                key={snapshot.id}
                onClick={() => handleSnapshotClick(snapshot.id)}
                className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors ${
                  isCurrent ? 'bg-accent/10 border-l-2 border-accent' : ''
                } ${isCompareA || isCompareB ? 'ring-1 ring-accent ring-inset' : ''}`}
                title={snapshot.description}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {isCurrent ? (
                    <Clock size={12} className="text-accent" />
                  ) : (
                    <RotateCcw size={12} className="text-text-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-primary truncate">{snapshot.description}</div>
                  <div className="text-[10px] text-text-muted">
                    {t('checkpoints.turn', 'Turn')} {snapshot.turn} &middot;{' '}
                    {formatTime(snapshot.timestamp)}
                  </div>
                </div>
                {(isCompareA || isCompareB) && (
                  <span className="text-[9px] px-1 rounded bg-accent text-white uppercase">
                    {isCompareA ? 'A' : 'B'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-6">
          <div className="relative h-12">
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-border-muted" />
            {snapshots.map((snapshot, index) => {
              const isCurrent = index === currentIndex;
              const isCompareA = snapshot.id === compareA;
              const isCompareB = snapshot.id === compareB;
              const pct =
                snapshots.length === 1 ? 50 : ((snapshot.timestamp - minTs) / tsRange) * 100;
              return (
                <button
                  key={snapshot.id}
                  onClick={() => handleSnapshotClick(snapshot.id)}
                  style={{ left: `${pct}%` }}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 group"
                  title={`${snapshot.description} · Turn ${snapshot.turn} · ${formatTime(snapshot.timestamp)}`}
                >
                  <div
                    className={`w-3 h-3 rounded-full border-2 transition-all ${
                      isCurrent
                        ? 'bg-accent border-accent scale-125'
                        : isCompareA || isCompareB
                          ? 'bg-accent border-accent'
                          : 'bg-surface border-text-muted hover:border-accent'
                    }`}
                  />
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[9px] text-text-muted whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatTime(snapshot.timestamp)}
                  </div>
                  {(isCompareA || isCompareB) && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-semibold text-accent">
                      {isCompareA ? 'A' : 'B'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 text-[10px] text-text-muted">
            <span>{formatTime(minTs)}</span>
            <span>{formatTime(maxTs)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
