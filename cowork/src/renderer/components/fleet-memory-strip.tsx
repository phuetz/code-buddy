import React from 'react';
import { useTranslation } from 'react-i18next';
import { Brain } from 'lucide-react';
import type { FleetMemoryEntry } from './fleet-command-center-helpers';

export const FleetMemoryStrip: React.FC<{
  memories: FleetMemoryEntry[];
  error: string | null;
  includeMemoryContext: boolean;
  onToggleInclude: (include: boolean) => void;
}> = ({ memories, error, includeMemoryContext, onToggleInclude }) => {
  const { t } = useTranslation();
  const hasMemories = memories.length > 0;

  return (
    <section
      className="mt-2 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-memory-context"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Brain size={11} className="shrink-0 text-success" />
          <span className="truncate text-[10px] uppercase tracking-wider text-text-secondary">
            {t('fleet.memoryContext.title', 'Fleet memory')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary">
          {memories.length}
        </span>
      </div>

      <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-text-secondary">
        <input
          type="checkbox"
          checked={hasMemories && includeMemoryContext}
          onChange={(event) => onToggleInclude(event.target.checked)}
          disabled={!hasMemories}
          className="h-3 w-3 accent-accent disabled:opacity-40"
        />
        <span>{t('fleet.memoryContext.include', 'Include in next dispatch')}</span>
      </label>

      {error ? (
        <div className="mt-1.5 truncate text-[10px] text-error">
          {t('fleet.memoryContext.loadFailed', 'Memory load failed')}: {error}
        </div>
      ) : !hasMemories ? (
        <div className="mt-1.5 text-[10px] text-text-muted">
          {t('fleet.memoryContext.empty', 'No saved Fleet outcome memory yet')}
        </div>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {memories.map((memory, index) => (
            <li
              key={`${memory.timestamp}-${index}`}
              className="rounded bg-surface/70 px-2 py-1 text-[10px] text-text-muted"
            >
              <span className="line-clamp-2">
                {memory.content.replace(/^Fleet outcome lesson:\s*/, '')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
