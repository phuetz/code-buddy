import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
  buildHermesToolsetDescriptor,
  type FleetDispatchToolDecision,
  type FleetHermesToolsetDescriptor,
} from '../../../../src/fleet/dispatch-profile.js';
import type { FleetDispatchProfile } from './fleet-command-center-helpers';

type ToolDecisionAction = FleetDispatchToolDecision['action'];

const ACTION_CLASSNAMES: Record<ToolDecisionAction, string> = {
  allow: 'border-success/30 bg-success/10 text-success',
  confirm: 'border-warning/30 bg-warning/10 text-warning',
  deny: 'border-error/30 bg-error/10 text-error',
};

const MUTATION_OR_EXECUTION_GROUPS = new Set<string>([
  'group:fs:write',
  'group:fs:delete',
  'group:runtime',
  'group:runtime:shell',
  'group:runtime:process',
  'group:git:write',
  'group:system:modify',
  'group:docker',
  'group:kubernetes',
  'group:dangerous',
]);

export interface ToolProfileCounts {
  allow: number;
  confirm: number;
  deny: number;
}

export function summarizeToolProfileDecisions(
  toolset: FleetHermesToolsetDescriptor
): ToolProfileCounts {
  return toolset.decisions.reduce<ToolProfileCounts>(
    (counts, decision) => {
      counts[decision.action]++;
      return counts;
    },
    { allow: 0, confirm: 0, deny: 0 }
  );
}

export function getBlockedMutationExecutionTools(
  decisions: readonly FleetDispatchToolDecision[]
): string[] {
  return decisions
    .filter(
      (decision) =>
        decision.action === 'deny' &&
        decision.groups.some((group) => MUTATION_OR_EXECUTION_GROUPS.has(group))
    )
    .map((decision) => decision.tool);
}

export const ToolProfileInspectorStrip: React.FC<{
  profile: FleetDispatchProfile;
}> = ({ profile }) => {
  const { t } = useTranslation();
  const toolset = useMemo(
    () => buildHermesToolsetDescriptor(profile, DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS),
    [profile]
  );
  const counts = useMemo(() => summarizeToolProfileDecisions(toolset), [toolset]);
  const blockedMutationExecutionTools = useMemo(
    () => getBlockedMutationExecutionTools(toolset.decisions),
    [toolset]
  );

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-tool-profile-inspector"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SlidersHorizontal size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-text-secondary">
            {t('fleet.toolProfile.title', 'Tool profile')}
          </span>
        </div>
        <span className="shrink-0 rounded border border-border-muted bg-surface px-1.5 py-0.5 text-[10px] text-text-secondary">
          {toolset.toolsetId}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-success/10 px-1 py-0.5 text-[9px] text-success">
          {t('fleet.toolProfile.allowChip', '{{count}} allow', {
            count: counts.allow,
          })}
        </span>
        <span className="rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning">
          {t('fleet.toolProfile.confirmChip', '{{count}} confirm', {
            count: counts.confirm,
          })}
        </span>
        <span className="rounded bg-error/10 px-1 py-0.5 text-[9px] text-error">
          {t('fleet.toolProfile.denyChip', '{{count}} deny', {
            count: counts.deny,
          })}
        </span>
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-secondary">
        <ShieldCheck size={10} className="shrink-0 text-accent" />
        <span className="line-clamp-2">{toolset.summary}</span>
      </div>

      {blockedMutationExecutionTools.length > 0 && (
        <div
          className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded border border-error/30 bg-error/10 px-2 py-1 text-[10px] text-error"
          data-testid="fleet-tool-profile-blocked-risk"
        >
          <ShieldAlert size={10} className="shrink-0 text-error" />
          <span className="min-w-0 truncate">
            {t('fleet.toolProfile.blockedRiskLabel', 'Blocked mutation/execution')}:{' '}
            <span className="font-mono">{blockedMutationExecutionTools.join(', ')}</span>
          </span>
        </div>
      )}

      <ul className="mt-1.5 grid grid-cols-2 gap-1">
        {toolset.decisions.map((decision) => (
          <li
            key={decision.tool}
            className={`min-w-0 rounded border px-2 py-1 text-[10px] ${ACTION_CLASSNAMES[decision.action]}`}
            title={decision.reason}
          >
            <span className="block truncate font-mono">
              {decision.tool} {decision.action}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
