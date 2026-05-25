import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FleetPeer } from '../types';
import { formatSagaAge, laneClass, sagaStatusTone } from './fleet-command-center-helpers';
import type { SagaSummary } from './fleet-command-center-helpers';
import { buildFleetInternetProofStepLabels } from './activity-feed-helpers';
import { PeerStat } from './fleet-peer-panel';
import { StepStatusIcon } from './fleet-saga-board';
import { FleetCouncilStrip } from './FleetCouncilStrip';

export const SagaDetail: React.FC<{
  saga: SagaSummary;
  peersById: Record<string, FleetPeer>;
}> = ({ saga, peersById }) => {
  const { t } = useTranslation();
  const total = saga.steps.length;
  const completed = saga.steps.filter((s) => s.status === 'completed').length;
  const running = saga.steps.filter((s) => s.status === 'running').length;
  const failed = saga.steps.filter((s) => s.status === 'failed').length;
  const proofSteps = buildFleetInternetProofStepLabels({
    internetProofPlan: saga.metadata?.internetProofPlan,
  });

  return (
    <div className="p-4 space-y-3 text-xs">
      <div>
        <div className="text-text-primary font-medium">{saga.goal}</div>
        <div className="mt-0.5 text-[11px] text-text-muted break-all">Saga {saga.id}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <PeerStat
          label={t('fleet.detail.status', 'Status')}
          value={saga.status}
          tone={sagaStatusTone(saga.status)}
        />
        <PeerStat
          label={t('fleet.detail.age', 'Age')}
          value={formatSagaAge(saga.createdAt) || '-'}
        />
        <PeerStat label={t('fleet.detail.steps', 'Steps')} value={`${completed}/${total}`} />
        <PeerStat label={t('fleet.detail.active', 'Active')} value={String(running)} />
      </div>

      {failed > 0 && (
        <div className="rounded border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error">
          {failed === 1
            ? t('fleet.detail.failedStepInRouteOne', '1 failed step in this route.')
            : t('fleet.detail.failedStepsInRoute', '{{count}} failed steps in this route.', {
                count: failed,
              })}
        </div>
      )}

      <FleetCouncilStrip saga={saga} peersById={peersById} />

      {proofSteps.length > 0 && (
        <div data-testid="fleet-saga-internet-proof-loop">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t('fleet.detail.internetProofLoop', 'Web proof loop')} ({proofSteps.length})
          </div>
          <ol className="space-y-1">
            {proofSteps.map((step) => (
              <li
                key={step}
                className="rounded border border-border-muted bg-surface/70 px-2 py-1 text-[10px] leading-4 text-text-secondary"
              >
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
          {t('fleet.detail.routeTrace', 'Route trace')} ({total})
        </div>
        {total === 0 ? (
          <div className="rounded border border-border-muted bg-surface/70 px-2 py-2 text-text-muted">
            {t('fleet.detail.noRoutedStep', 'No routed step yet.')}
          </div>
        ) : (
          <ol className="space-y-1.5">
            {saga.steps.map((step, index) => {
              const peer = peersById[step.peerId];
              const peerLabel = peer?.label ?? peer?.capability?.machineLabel ?? step.peerId;
              const hasToolMetadata =
                Boolean(step.toolPolicy) ||
                Boolean(step.toolDecisions && step.toolDecisions.length > 0) ||
                Boolean(step.toolset?.toolsetId);
              return (
                <li
                  key={`${step.peerId}-${step.model}-${step.lane}-${index}`}
                  className="rounded border border-border-muted bg-surface/70 px-2 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <StepStatusIcon status={step.status} />
                    <span className={`shrink-0 uppercase tracking-wide ${laneClass(step.lane)}`}>
                      {step.lane}
                    </span>
                    <span className="ml-auto text-[10px] text-text-muted">#{index + 1}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-text-secondary">{peerLabel}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
                    {step.model}
                  </div>
                  {hasToolMetadata && (
                    <div className="mt-1 rounded border border-border bg-surface/70 px-1.5 py-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-text-secondary">
                        <span className="uppercase tracking-wide">
                          {t('fleet.detail.toolPolicy', 'Tool policy')}
                        </span>
                        <span className="rounded bg-surface px-1 py-0.5 font-mono text-[9px] text-text-secondary">
                          {step.toolPolicy?.policyProfile ?? step.toolPolicy?.profile ?? '-'}
                        </span>
                        {step.toolPolicy?.defaultAction && (
                          <span className="text-text-muted">{step.toolPolicy.defaultAction}</span>
                        )}
                        {step.toolset?.toolsetId && (
                          <span className="rounded bg-sky-950 px-1 py-0.5 font-mono text-[9px] text-sky-200/70">
                            {step.toolset.toolsetId}
                          </span>
                        )}
                      </div>
                      {step.toolPolicy?.summary && (
                        <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-text-muted">
                          {step.toolPolicy.summary}
                        </div>
                      )}
                      {step.toolDecisions && step.toolDecisions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {step.toolDecisions.slice(0, 6).map((decision) => (
                            <span
                              key={`${decision.tool}-${decision.action}`}
                              className={`rounded border px-1 py-0.5 font-mono text-[9px] ${toolDecisionClass(
                                decision.action
                              )}`}
                              title={decision.matchedGroup}
                            >
                              {decision.tool}:{decision.action}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {saga.finalResult && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t('fleet.detail.finalResult', 'Final result')}
          </div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded border border-border-muted bg-surface/80 p-2 text-[11px] text-text-secondary">
            {saga.finalResult}
          </pre>
        </div>
      )}
    </div>
  );
};

function toolDecisionClass(action: string): string {
  if (action === 'allow') return 'border-success/30 bg-success/10 text-success';
  if (action === 'deny') return 'border-error/30 bg-error/10 text-error';
  return 'border-warning/30 bg-warning/10 text-warning';
}
