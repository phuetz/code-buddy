/**
 * CreditsMeter — Genspark-style "credits" usage chip + budget bar.
 *
 * Presentational only: takes the raw USD spend + budget as props and renders
 * a compact single-row meter (icon, "N credits left" label, a thin progress
 * bar, and the raw $used / $budget in muted text). No store, no IPC, no
 * callbacks — a pure read-only meter. Cost-as-credits conversion is
 * delegated entirely to `./credits`.
 *
 * @module renderer/components/CreditsMeter
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Coins } from 'lucide-react';
import { creditsRemaining, budgetPct, formatCredits } from './credits';

export interface CreditsMeterProps {
  /** Cumulative spend so far, in USD. */
  usedUsd: number;
  /** Total budget for the session/period, in USD. Defaults to $10. */
  budgetUsd?: number;
  /** Extra classes merged onto the root element. */
  className?: string;
}

export const CreditsMeter: React.FC<CreditsMeterProps> = ({
  usedUsd,
  budgetUsd = 10,
  className = '',
}) => {
  const { t } = useTranslation();
  const remaining = creditsRemaining(usedUsd, budgetUsd);
  const pct = budgetPct(usedUsd, budgetUsd);

  const fillClass = pct >= 90 ? 'bg-error' : pct >= 75 ? 'bg-warning' : 'bg-accent';
  const labelClass = pct >= 90 ? 'text-warning' : 'text-text';

  return (
    <div data-testid="credits-meter" className={`flex items-center gap-2 text-xs ${className}`}>
      <Coins className="w-3.5 h-3.5 shrink-0 text-accent" />
      <span className={`font-medium tabular-nums shrink-0 ${labelClass}`}>
        {t('credits.left', '{{n}} credits left', { n: formatCredits(remaining) })}
      </span>
      <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden shrink-0" aria-hidden>
        <div className={`h-full ${fillClass} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-text-muted tabular-nums shrink-0">
        ${usedUsd.toFixed(2)} / ${budgetUsd.toFixed(2)}
      </span>
    </div>
  );
};

export default CreditsMeter;
