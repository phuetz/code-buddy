import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenText, GitBranch, Route, Terminal } from 'lucide-react';

export interface LessonsVaultPreview {
  commands: {
    exportVault: string;
    graphJson: string;
    graphMarkdown: string;
  };
  concepts: Array<{
    id: string;
    label: string;
    lessonCount: number;
    path: string;
    sources: string[];
  }>;
  counts: {
    concepts: number;
    files: number;
    lessons: number;
    relations: number;
  };
  generatedAt: string;
  kind: 'lessons_vault_preview';
  rootDir: string;
  schemaVersion: 1;
  vaultDir: string;
}

interface LessonsVaultApi {
  preview?: (options?: {
    cwd?: string;
    includeKeywords?: boolean;
    limit?: number;
    vaultDir?: string;
  }) => Promise<LessonsVaultPreview | null>;
}

export function buildLessonsVaultCommands(): string[] {
  return [
    'buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault',
    'buddy lessons graph --no-keywords --json --graph-output .codebuddy/lessons-vault/graph.json',
    'buddy lessons graph --no-keywords --markdown --graph-output .codebuddy/lessons-vault/_lessons.md',
  ];
}

export function buildLessonsVaultGoal(preview?: LessonsVaultPreview | null): string {
  const commands = buildLessonsVaultCommands();
  const counts = preview
    ? `Current preview: ${preview.counts.lessons} lessons, ${preview.counts.concepts} concepts, ${preview.counts.relations} relations.`
    : 'Current preview is not loaded yet.';

  return [
    'Review and refresh the Code Buddy lessons vault from Cowork.',
    counts,
    '',
    'Commands:',
    `- ${commands[0]}`,
    `- ${commands[1]}`,
    '',
    'Rules:',
    '- Keep lessons.md as the canonical source.',
    '- Do not auto-create lessons during vault export.',
    '- Preserve Markdown/wiki-link structure for Obsidian-style browsing.',
    '- Report the generated manifest, concept count and any stale lessons that need human review.',
  ].join('\n');
}

export const LessonsVaultStrip: React.FC<{
  cwd?: string;
  error?: string | null;
  onBrowse?: () => void;
  onUseAsGoal?: (goal: string) => void;
  preview?: LessonsVaultPreview | null;
}> = ({ cwd, error = null, onBrowse, onUseAsGoal, preview }) => {
  const { t } = useTranslation();
  const [loadedPreview, setLoadedPreview] = useState<LessonsVaultPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visiblePreview = preview !== undefined ? preview : loadedPreview;
  const visibleError = error ?? loadError;
  const commands = useMemo(() => buildLessonsVaultCommands(), []);
  const goalDraft = useMemo(() => buildLessonsVaultGoal(visiblePreview), [visiblePreview]);
  const concepts = visiblePreview?.concepts.slice(0, 3) ?? [];

  useEffect(() => {
    if (preview !== undefined) return;
    const api = getLessonsVaultApi();
    if (!api?.preview) return;
    let cancelled = false;

    void api
      .preview({
        cwd,
        includeKeywords: false,
        limit: 20,
      })
      .then((result) => {
        if (cancelled) return;
        setLoadedPreview(result);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedPreview(null);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, preview]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-lessons-vault"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <BookOpenText size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.lessonsVault.title', 'Lessons vault')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
          {visiblePreview
            ? t('fleet.lessonsVault.countChip', '{{lessons}} lessons · {{concepts}} concepts', {
                concepts: visiblePreview.counts.concepts,
                lessons: visiblePreview.counts.lessons,
              })
            : t('fleet.lessonsVault.pendingChip', 'preview')}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          {t('fleet.lessonsVault.readOnlyChip', 'read-only')}
        </span>
        <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          {t('fleet.lessonsVault.markdownChip', 'Markdown vault')}
        </span>
        <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
          {t('fleet.lessonsVault.noAutoWriteChip', 'no auto-lesson write')}
        </span>
      </div>

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.lessonsVault.loadFailed', 'Lessons vault preview failed')}: {visibleError}
        </div>
      )}

      {visiblePreview ? (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-secondary">
          <GitBranch size={10} className="shrink-0 text-accent" />
          <span className="min-w-0 truncate">
            {t(
              'fleet.lessonsVault.summary',
              '{{relations}} relations · {{files}} generated files',
              {
                files: visiblePreview.counts.files,
                relations: visiblePreview.counts.relations,
              }
            )}
          </span>
        </div>
      ) : (
        <div className="mt-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          {t(
            'fleet.lessonsVault.empty',
            'Export the vault from CLI to browse concepts and backlinks.'
          )}
        </div>
      )}

      {concepts.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {concepts.map((concept) => (
            <li key={concept.id} className="min-w-0 rounded bg-surface/80 px-2 py-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[10px] text-text-secondary">{concept.label}</span>
                <span className="shrink-0 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
                  {t('fleet.lessonsVault.lessonCount', '{{count}} lesson(s)', {
                    count: concept.lessonCount,
                  })}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[9px] text-text-muted">{concept.path}</div>
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-1.5 space-y-1">
        {commands.slice(0, 2).map((command) => (
          <li
            key={command}
            className="flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted"
          >
            <Terminal size={10} className="shrink-0 text-text-muted" />
            <code className="truncate">{command}</code>
          </li>
        ))}
      </ul>

      {(onUseAsGoal || onBrowse) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {onBrowse && (
            <button
              type="button"
              onClick={onBrowse}
              className="flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-[10px] text-accent transition-colors hover:bg-accent/10"
              data-testid="lessons-vault-browse"
            >
              <BookOpenText size={10} />
              {t('fleet.lessonsVault.browse', 'Browse vault')}
            </button>
          )}
          {onUseAsGoal && (
            <button
              type="button"
              onClick={() => onUseAsGoal(goalDraft)}
              className="flex items-center gap-1 rounded border border-accent/50 px-2 py-1 text-[10px] text-accent transition-colors hover:bg-accent/10"
            >
              <Route size={10} />
              {t('fleet.lessonsVault.useAsGoal', 'Review vault as goal')}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

function getLessonsVaultApi(): LessonsVaultApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          lessonsVault?: LessonsVaultApi;
        };
      };
    }
  ).electronAPI?.tools?.lessonsVault;
}
