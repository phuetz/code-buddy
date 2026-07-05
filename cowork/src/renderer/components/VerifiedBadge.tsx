/**
 * VerifiedBadge — compact cross-check badge for model verdicts.
 *
 * @module renderer/components/VerifiedBadge
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';

export interface ModelVerdict {
  model: string;
  verdict: 'agree' | 'disagree' | 'abstain';
}

export interface VerifiedBadgeProps {
  verdicts: ModelVerdict[];
  className?: string;
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({ verdicts, className = '' }) => {
  const { t } = useTranslation();
  const agreeCount = verdicts.filter((verdict) => verdict.verdict === 'agree').length;
  const disagreeCount = verdicts.filter((verdict) => verdict.verdict === 'disagree').length;
  const isCleanMajority = agreeCount > verdicts.length / 2 && disagreeCount === 0;
  const tone = isCleanMajority ? 'text-success' : 'text-warning';
  const title = verdicts.map((verdict) => `${verdict.model} \u2014 ${verdict.verdict}`).join('\n');

  return (
    <span
      data-testid="verified-badge"
      className={`inline-flex max-w-full items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs ${tone} ${className}`}
      title={title}
    >
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {t('verifiedBadge.label', {
          count: agreeCount,
          defaultValue: 'Verified by {{count}} models',
        })}
      </span>
    </span>
  );
};

export default VerifiedBadge;
