/**
 * DocComposer — controlled outline surface for long-form AI documents.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/DocComposer
 */

import { useTranslation } from 'react-i18next';
import { BookOpenText, FilePlus2, Sparkles } from 'lucide-react';
import { docSectionsToMarkdown, estimateReadingTime, type DocSection } from '../utils/doc-outline';
import { useAppStore } from '../store';
import { MessageMarkdown } from './MessageMarkdown';
import { OfficeExportMenu } from './OfficeExportMenu';

export interface DocComposerProps {
  sections: DocSection[];
  onGenerate: (sections: DocSection[]) => void;
}

export function DocComposer({ sections, onGenerate }: DocComposerProps) {
  const { t } = useTranslation();
  const readingMinutes = estimateReadingTime(sections);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionTitle = sessions.find((session) => session.id === activeSessionId)?.title;
  const exportTitle = sessionTitle?.trim() || t('genspark.docs.title', 'Compositeur de document');
  const exportMarkdown = docSectionsToMarkdown(exportTitle, sections);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="doc-composer">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <BookOpenText aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.docs.title', 'Compositeur de document')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {sections.length} sections · lecture estimée {readingMinutes} min
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OfficeExportMenu
            markdown={exportMarkdown}
            title={exportTitle}
            sessionId={activeSessionId}
            disabled={sections.length === 0}
          />
          <button
            type="button"
            aria-label={t('genspark.docs.generate', 'Générer le document')}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="doc-generate"
            disabled={sections.length === 0}
            onClick={() => onGenerate(sections)}
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            {t('genspark.docs.generate', 'Générer')}
          </button>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
          <FilePlus2 aria-hidden="true" className="h-5 w-5" />
          {t('genspark.docs.empty', 'Aucun plan de document fourni.')}
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {sections.map((section, index) => (
            <li
              key={section.id}
              className="rounded-lg border border-border bg-background p-3"
              data-testid={`doc-section-${section.id}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{section.title}</h3>
                    {section.estimatedWords !== undefined && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {section.estimatedWords} mots
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    <MessageMarkdown normalizedText={section.summary} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
