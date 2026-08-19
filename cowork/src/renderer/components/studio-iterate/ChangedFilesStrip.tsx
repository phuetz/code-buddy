import { FilePenLine, FilePlus2, FileX2 } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState.js';
import type { StudioFileChange } from './iterate-model.js';
import { summarizeChanges } from './iterate-model.js';

export interface ChangedFilesStripProps {
  changes: StudioFileChange[];
  onOpen?: (path: string) => void;
}

const KIND_META = {
  added: { label: 'Added', icon: FilePlus2, className: 'border-green-500/30 bg-green-500/10 text-green-500' },
  modified: { label: 'Modified', icon: FilePenLine, className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  deleted: { label: 'Deleted', icon: FileX2, className: 'border-red-500/30 bg-red-500/10 text-red-500' },
} as const;

export function ChangedFilesStrip({ changes, onOpen }: ChangedFilesStripProps) {
  const summary = summarizeChanges(changes);

  if (changes.length === 0) {
    return (
      <EmptyState
        icon={<FilePenLine className="h-5 w-5" aria-hidden="true" />}
        title="No files changed"
        hint="The next iteration turn will list the added, modified or deleted files here."
      />
    );
  }

  return (
    <section className="rounded-lg border border-border bg-background p-3" aria-label="Files changed in the last turn">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">Latest changes</h3>
        <div className="flex gap-1 text-xs tabular-nums" aria-label={`${summary.added} added, ${summary.modified} modified, ${summary.deleted} deleted`}>
          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-green-500">+{summary.added}</span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-500">~{summary.modified}</span>
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-500">-{summary.deleted}</span>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {changes.map((change) => {
          const meta = KIND_META[change.kind];
          const Icon = meta.icon;

          return (
            <button
              key={`${change.kind}:${change.path}`}
              type="button"
              className={`inline-flex max-w-72 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${meta.className} ${onOpen ? 'hover:bg-muted' : 'cursor-default'}`}
              onClick={() => onOpen?.(change.path)}
              disabled={!onOpen}
              title={change.path}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">{meta.label}</span>
              <span className="truncate font-mono">{change.path}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
