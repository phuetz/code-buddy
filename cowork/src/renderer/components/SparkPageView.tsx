/**
 * SparkPageView — presentational living research page renderer.
 *
 * @module renderer/components/SparkPageView
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText, Send } from 'lucide-react';
import type { SparkPage } from './sparkpage';

export interface SparkPageViewProps {
  page: SparkPage;
  onAskFollowUp?: (q: string) => void;
  className?: string;
}

export const SparkPageView: React.FC<SparkPageViewProps> = ({
  page,
  onAskFollowUp,
  className = '',
}) => {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');

  const askFollowUp = () => {
    const trimmed = question.trim();
    if (!trimmed || !onAskFollowUp) return;
    onAskFollowUp(trimmed);
    setQuestion('');
  };

  return (
    <article
      data-testid="sparkpage-view"
      className={`space-y-4 text-sm text-text ${className}`}
      aria-label={page.title}
    >
      <header className="space-y-1 border-b border-border pb-3">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <h2 className="min-w-0 flex-1 text-base font-semibold text-text">{page.title}</h2>
        </div>
      </header>

      <div className="space-y-4">
        {page.sections.map((section) => (
          <section key={section.heading} className="space-y-1.5">
            <h3 className="text-sm font-semibold text-text">{section.heading}</h3>
            <p className="whitespace-pre-wrap leading-6 text-text-muted">{section.body}</p>
          </section>
        ))}
      </div>

      <section className="space-y-2 border-t border-border pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('sparkPage.references', 'References')}
        </h3>
        <ol className="space-y-1 text-xs text-text-muted">
          {page.citations.map((citation) => (
            <li key={`${citation.n}-${citation.url}`} className="flex min-w-0 items-start gap-2">
              <span className="shrink-0 tabular-nums">[{citation.n}]</span>
              <a
                href={citation.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline"
                title={citation.url}
              >
                <span className="truncate">{citation.title}</span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              </a>
            </li>
          ))}
        </ol>
      </section>

      {onAskFollowUp && (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <input
            data-testid="sparkpage-follow-up-input"
            aria-label={t('sparkPage.followUpInput', 'Follow-up question')}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') askFollowUp();
            }}
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
            placeholder={t('sparkPage.followUpPlaceholder', 'Ask a follow-up')}
          />
          <button
            type="button"
            data-testid="sparkpage-follow-up-submit"
            aria-label={t('sparkPage.ask', 'Ask')}
            disabled={!question.trim()}
            onClick={askFollowUp}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-border disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
            <span>{t('sparkPage.ask', 'Ask')}</span>
          </button>
        </div>
      )}
    </article>
  );
};

export default SparkPageView;
