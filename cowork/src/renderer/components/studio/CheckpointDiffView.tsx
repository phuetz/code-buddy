import { useMemo } from 'react';

import { sortDiff, summarizeDiff, type DiffFileEntry } from './checkpoint-diff-model.js';

export type { DiffFileEntry } from './checkpoint-diff-model.js';

export interface CheckpointDiffViewProps {
  entries: DiffFileEntry[];
  onClose: () => void;
}

const STATUS_META: Record<DiffFileEntry['status'], { icon: string; label: string; className: string }> = {
  added: { icon: '+', label: 'Added', className: 'text-success' },
  modified: { icon: '~', label: 'Modified', className: 'text-warning' },
  deleted: { icon: '−', label: 'Deleted', className: 'text-destructive' },
};

function formatCount(value: number | undefined, sign: '+' | '-'): string | null {
  if (!value) return null;
  return `${sign}${value}`;
}

export function CheckpointDiffView({ entries, onClose }: CheckpointDiffViewProps) {
  const sortedEntries = useMemo(() => sortDiff(entries), [entries]);
  const summary = useMemo(() => summarizeDiff(entries), [entries]);

  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid="checkpoint-diff">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Checkpoint diff</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="text-success">+{summary.added}</span>{' '}
            <span className="text-warning">~{summary.modified}</span>{' '}
            <span className="text-destructive">−{summary.deleted}</span>
            {summary.additions + summary.deletions > 0 && (
              <span>
                {' '}· <span className="text-success">+{summary.additions}</span>{' '}
                <span className="text-destructive">−{summary.deletions}</span>
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          Close
        </button>
      </header>

      {sortedEntries.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-foreground">No changes</p>
          <p className="mt-1 text-xs text-muted-foreground">This checkpoint contains no files to compare.</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {sortedEntries.map((entry) => {
            const meta = STATUS_META[entry.status];
            const additions = formatCount(entry.additions, '+');
            const deletions = formatCount(entry.deletions, '-');

            return (
              <li key={`${entry.status}:${entry.path}`} className="flex items-center gap-3 py-2.5">
                <span className={`w-5 shrink-0 text-center text-sm font-semibold ${meta.className}`} aria-hidden="true">
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{entry.path}</p>
                  <p className="text-[11px] text-muted-foreground">{meta.label}</p>
                </div>
                {(additions || deletions) && (
                  <div className="shrink-0 text-xs tabular-nums">
                    {additions && <span className="text-success">{additions}</span>}
                    {additions && deletions && <span className="text-muted-foreground"> / </span>}
                    {deletions && <span className="text-destructive">{deletions}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default CheckpointDiffView;
