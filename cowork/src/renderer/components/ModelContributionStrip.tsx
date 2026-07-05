/**
 * ModelContributionStrip — mixture-of-agents contribution chips.
 *
 * @module renderer/components/ModelContributionStrip
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';

export interface ModelContribution {
  model: string;
  role: string;
  costUsd?: number;
  tokens?: number;
}

export interface ModelContributionStripProps {
  contributions: ModelContribution[];
  className?: string;
}

function formatCost(costUsd: number): string {
  return `$${costUsd < 1 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}

export const ModelContributionStrip: React.FC<ModelContributionStripProps> = ({
  contributions,
  className = '',
}) => {
  const { t } = useTranslation();

  return (
    <div
      data-testid="model-contribution-strip"
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
      aria-label={t('modelContributionStrip.label', 'Model contributions')}
    >
      {contributions.map((contribution) => {
        const title = [
          `${contribution.model} \u00b7 ${contribution.role}`,
          contribution.tokens
            ? t('modelContributionStrip.tokens', {
              count: contribution.tokens,
              defaultValue: '{{count}} tokens',
            })
            : undefined,
        ].filter(Boolean).join('\n');

        return (
          <span
            key={`${contribution.model}-${contribution.role}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-xs text-text"
            title={title}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
            <span className="min-w-0 truncate">
              {contribution.model} <span className="text-text-muted">{'\u00b7'}</span> {contribution.role}
            </span>
            {typeof contribution.costUsd === 'number' && (
              <span className="shrink-0 text-[11px] text-text-muted">
                {formatCost(contribution.costUsd)}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
};

export default ModelContributionStrip;
