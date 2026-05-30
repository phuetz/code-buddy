import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrainCircuit, ListChecks, Terminal, TrendingDown, TrendingUp } from 'lucide-react';

export interface LearningSkillUsageItem {
  averageDurationMs?: number;
  deprecated: boolean;
  failureCount: number;
  invocationCount: number;
  lastDurationMs?: number;
  lastError?: string;
  lastRunId?: string;
  lastUsedAt: string;
  reinforced: boolean;
  skillName: string;
  successCount: number;
}

interface LearningSkillUsageApi {
  list?: (options?: {
    cwd?: string;
    limit?: number;
  }) => Promise<LearningSkillUsageItem[]>;
}

export function buildLearningSkillUsageCommand(): string {
  return 'buddy skills learning-usage --json';
}

export const LearningSkillUsageStrip: React.FC<{
  cwd?: string;
  error?: string | null;
  usage?: LearningSkillUsageItem[];
}> = ({ cwd, error = null, usage }) => {
  const { t } = useTranslation();
  const [loadedUsage, setLoadedUsage] = useState<LearningSkillUsageItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const command = useMemo(() => buildLearningSkillUsageCommand(), []);
  const items = usage ?? loadedUsage;
  const visibleError = error ?? loadError;
  const visibleItems = items.slice(0, 3);
  const reinforcedCount = items.filter((item) => item.reinforced).length;
  const deprecatedCount = items.filter((item) => item.deprecated).length;

  useEffect(() => {
    if (usage !== undefined) return;
    const api = getLearningSkillUsageApi();
    if (!api?.list) return;
    let cancelled = false;

    void api
      .list({ cwd, limit: 6 })
      .then((result) => {
        if (cancelled) return;
        setLoadedUsage(Array.isArray(result) ? result : []);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedUsage([]);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, usage]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-learning-skill-usage"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <BrainCircuit size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.learningUsage.title', 'Learning skill usage')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
          {t('fleet.learningUsage.countChip', '{{count}} skills', {
            count: items.length,
          })}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="flex items-center gap-1 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          <TrendingUp size={9} />
          {t('fleet.learningUsage.reinforcedChip', '{{count}} reinforced', {
            count: reinforcedCount,
          })}
        </span>
        <span className="flex items-center gap-1 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          <TrendingDown size={9} />
          {t('fleet.learningUsage.deprecatedChip', '{{count}} deprecated', {
            count: deprecatedCount,
          })}
        </span>
      </div>

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.learningUsage.loadFailed', 'Learning usage load failed')}: {visibleError}
        </div>
      )}

      {visibleItems.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {visibleItems.map((item) => (
            <li key={item.skillName} className="min-w-0 rounded bg-surface/80 px-2 py-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[10px] text-text-secondary">
                  {item.skillName}
                </span>
                <span className="shrink-0 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                  {t('fleet.learningUsage.runsChip', '{{count}} runs', {
                    count: item.invocationCount,
                  })}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[9px] text-text-muted">
                {item.successCount} ok / {item.failureCount} fail
                {item.averageDurationMs !== undefined
                  ? ` - avg ${Math.round(item.averageDurationMs)}ms`
                  : ''}
                {item.lastRunId ? ` - ${item.lastRunId}` : ''}
              </div>
              {item.lastError ? (
                <div className="mt-0.5 truncate text-[9px] text-warning">
                  {item.lastError}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          <ListChecks size={10} className="shrink-0 text-text-muted" />
          <span className="truncate">
            {t('fleet.learningUsage.empty', 'No Learning Agent skill usage recorded yet.')}
          </span>
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{command}</code>
      </div>
    </section>
  );
};

function getLearningSkillUsageApi(): LearningSkillUsageApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          learningUsage?: LearningSkillUsageApi;
        };
      };
    }
  ).electronAPI?.tools?.learningUsage;
}
