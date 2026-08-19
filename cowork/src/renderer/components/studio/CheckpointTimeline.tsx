import { useMemo } from 'react';

import { groupByDay, summarize, type CheckpointEntry } from './checkpoint-timeline-model.js';

export type { CheckpointEntry } from './checkpoint-timeline-model.js';

export interface CheckpointTimelineProps {
  checkpoints: CheckpointEntry[];
  onRestore: (id: string) => void;
  onDiff?: (id: string) => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CheckpointTimeline({ checkpoints, onRestore, onDiff }: CheckpointTimelineProps) {
  const sections = useMemo(() => groupByDay(checkpoints, Date.now()), [checkpoints]);

  if (checkpoints.length === 0) {
    return (
      <section
        className="rounded-xl border border-border bg-surface p-6 text-center"
        data-testid="checkpoint-timeline"
      >
        <h3 className="text-sm font-semibold text-foreground">No checkpoints</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Project snapshots will appear here as soon as they are created.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4" data-testid="checkpoint-timeline">
      {sections.map((section) => (
        <div key={section.label} className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.label}</h3>
          <ol className="space-y-2 border-l border-border pl-4">
            {section.entries.map((checkpoint) => (
              <li key={checkpoint.id} className="relative">
                <span className="absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full border border-accent bg-surface" />
                <article className="rounded-lg border border-border bg-surface p-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <time className="text-[11px] font-medium text-muted-foreground">
                        {formatTime(checkpoint.createdAt)}
                      </time>
                      <h4 className="mt-1 truncate text-sm font-semibold text-foreground">{checkpoint.label}</h4>
                      <p className="mt-1 text-xs text-muted-foreground">{summarize(checkpoint)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {onDiff && (
                        <button
                          type="button"
                          onClick={() => onDiff(checkpoint.id)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          Diff
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRestore(checkpoint.id)}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90"
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

export default CheckpointTimeline;
