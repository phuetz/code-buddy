import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, ClipboardList, Route, TerminalSquare } from 'lucide-react';
import {
  buildHermesIntegrationPlan,
  type HermesIntegrationPlan,
} from '../../../../src/agent/hermes-agent-profile.js';
import type { FleetDispatchProfile } from './fleet-command-center-helpers';

export interface HermesPlanRiskSummary {
  readOnly: number;
  localWrite: number;
  interactive: number;
}

export function summarizeHermesPlanRisks(plan: HermesIntegrationPlan): HermesPlanRiskSummary {
  return plan.items.reduce<HermesPlanRiskSummary>(
    (summary, item) => {
      if (item.risk === 'read-only') {
        summary.readOnly++;
      } else if (item.risk === 'local-write') {
        summary.localWrite++;
      } else {
        summary.interactive++;
      }
      return summary;
    },
    { readOnly: 0, localWrite: 0, interactive: 0 }
  );
}

export function buildHermesPlanGoal(plan: HermesIntegrationPlan): string {
  const lines = [
    'Run this Hermes integration plan from Cowork.',
    `Dispatch profile: ${plan.dispatchProfile}`,
    `Toolset: ${plan.toolsetId}`,
    `Recommended CLI check: ${plan.recommendedNextCommand}`,
    '',
    'Interaction surfaces:',
    ...plan.interactionSurfaces.map((surface) => `- ${surface.label}: ${surface.primaryAction}`),
    '',
    'Checklist:',
  ];

  for (const item of plan.items) {
    lines.push(`- ${item.title} [${item.kind}, ${item.risk}]`);
    lines.push(`  Command: ${item.command}`);
    if (item.expectedArtifacts.length > 0) {
      lines.push(`  Expected artifacts: ${item.expectedArtifacts.join(', ')}`);
    }
    lines.push(`  Acceptance: ${item.acceptanceCriteria.join(' | ')}`);
  }

  lines.push(
    '',
    'Execute the safest next step, show evidence, and record lessons if a reusable pattern emerges.'
  );
  return lines.join('\n');
}

export const HermesPlanStrip: React.FC<{
  profile: FleetDispatchProfile;
  onUseAsGoal?: (goal: string) => void;
  onScheduleGoal?: (goal: string) => void;
}> = ({ profile, onUseAsGoal, onScheduleGoal }) => {
  const { t } = useTranslation();
  const plan = useMemo(() => buildHermesIntegrationPlan(profile), [profile]);
  const riskSummary = useMemo(() => summarizeHermesPlanRisks(plan), [plan]);
  const cliSurface = plan.interactionSurfaces.find((surface) => surface.id === 'cli');
  const coworkSurface = plan.interactionSurfaces.find((surface) => surface.id === 'cowork');
  const visibleItems = plan.items.slice(0, 4);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-plan"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <ClipboardList size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-text-secondary">
            {t('fleet.hermesPlan.title', 'Hermes plan')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-secondary">
          {plan.toolsetId}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-surface px-1 py-0.5 text-[9px] text-text-muted">
          {t('fleet.hermesPlan.itemsChip', '{{count}} steps', {
            count: plan.items.length,
          })}
        </span>
        <span className="rounded bg-surface px-1 py-0.5 text-[9px] text-text-muted">
          {t('fleet.hermesPlan.readOnlyChip', '{{count}} read-only', {
            count: riskSummary.readOnly,
          })}
        </span>
        <span className="rounded bg-surface px-1 py-0.5 text-[9px] text-text-muted">
          {t('fleet.hermesPlan.localWriteChip', '{{count}} local-write', {
            count: riskSummary.localWrite,
          })}
        </span>
        <span className="rounded bg-surface px-1 py-0.5 text-[9px] text-text-muted">
          {t('fleet.hermesPlan.interactiveChip', '{{count}} interactive', {
            count: riskSummary.interactive,
          })}
        </span>
      </div>

      {cliSurface && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/70 px-2 py-1 text-[10px] text-text-muted">
          <TerminalSquare size={10} className="shrink-0 text-text-muted" />
          <code className="truncate">{cliSurface.entrypoint}</code>
        </div>
      )}

      {coworkSurface && (
        <div className="mt-1.5 text-[10px] text-text-muted line-clamp-2">
          {coworkSurface.primaryAction}
        </div>
      )}

      <ul className="mt-1.5 space-y-1">
        {visibleItems.map((item) => (
          <li
            key={item.id}
            className="flex min-w-0 items-center justify-between gap-2 rounded bg-surface/70 px-2 py-1"
          >
            <span className="truncate text-[10px] text-text-secondary">{item.title}</span>
            <span className="shrink-0 rounded bg-surface px-1 py-0.5 text-[9px] text-text-muted">
              {item.risk}
            </span>
          </li>
        ))}
      </ul>

      {(onUseAsGoal || onScheduleGoal) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {onUseAsGoal && (
            <button
              type="button"
              onClick={() => onUseAsGoal(buildHermesPlanGoal(plan))}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              <Route size={10} />
              {t('fleet.hermesPlan.useAsGoal', 'Use as Fleet goal')}
            </button>
          )}
          {onScheduleGoal && (
            <button
              type="button"
              onClick={() => onScheduleGoal(buildHermesPlanGoal(plan))}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              <CalendarPlus size={10} />
              {t('fleet.hermesPlan.schedule', 'Schedule plan')}
            </button>
          )}
        </div>
      )}
    </section>
  );
};
