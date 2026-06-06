import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Laptop2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
} from 'lucide-react';
import type {
  MissionControlActionIntent,
  MissionControlAgent,
  MissionControlSnapshot,
  MissionControlWorkItem,
} from '../../main/fleet/mission-control-snapshot';

export const MissionControlStrip: React.FC<{
  error?: string | null;
  onAction?: (action: MissionControlActionIntent) => void;
  refreshing?: boolean;
  snapshot: MissionControlSnapshot | null;
}> = ({ error = null, onAction, refreshing = false, snapshot }) => {
  const { t } = useTranslation();

  return (
    <section
      className="border-b border-border-muted bg-surface/40 px-4 py-3"
      data-testid="fleet-mission-control"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Activity size={12} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-text-secondary">
            {t('fleet.mission.title', 'Mission Control')}
          </span>
          {snapshot?.generatedAt && (
            <span className="shrink-0 text-[10px] text-text-muted">
              {new Date(snapshot.generatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        {refreshing && (
          <RefreshCw size={11} className="shrink-0 animate-spin text-text-muted" />
        )}
      </div>

      {error ? (
        <div className="truncate text-[10px] text-error">
          {t('fleet.mission.loadFailed', 'Mission snapshot unavailable')}: {error}
        </div>
      ) : !snapshot ? (
        <div className="text-[10px] text-text-muted">
          {t('fleet.mission.loading', 'Loading mission snapshot...')}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            <MissionMetric
              label={t('fleet.mission.agents', 'agents')}
              value={`${snapshot.summary.activeAgents}/${snapshot.summary.agentCount}`}
            />
            <MissionMetric
              label={t('fleet.mission.active', 'active')}
              value={snapshot.summary.activeWork}
            />
            <MissionMetric
              label={t('fleet.mission.proven', 'proven')}
              value={snapshot.summary.provenWork}
            />
            <MissionMetric
              label={t('fleet.mission.attention', 'attention')}
              tone={snapshot.summary.needsAttention > 0 ? 'attention' : 'ok'}
              value={snapshot.summary.needsAttention}
            />
          </div>

          <MissionAgentList
            agents={snapshot.agents.slice(0, 4)}
            onAction={onAction}
          />
          <MissionWorkList
            onAction={onAction}
            work={snapshot.work.slice(0, 4)}
          />
        </div>
      )}
    </section>
  );
};

const MissionMetric: React.FC<{
  label: string;
  tone?: 'attention' | 'ok';
  value: number | string;
}> = ({ label, tone, value }) => (
  <div
    className={`min-w-0 rounded border px-2 py-1 ${
      tone === 'attention'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : tone === 'ok'
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-border-muted bg-background/60 text-text-secondary'
    }`}
  >
    <div className="truncate text-[9px] uppercase tracking-wider opacity-80">{label}</div>
    <div className="truncate font-mono text-[12px] tabular-nums">{value}</div>
  </div>
);

const MissionAgentList: React.FC<{
  agents: MissionControlAgent[];
  onAction?: (action: MissionControlActionIntent) => void;
}> = ({ agents, onAction }) => {
  const { t } = useTranslation();
  if (agents.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wider text-text-muted">
        {t('fleet.mission.agentsHeader', 'Agents')}
      </div>
      <ul className="space-y-1">
        {agents.map((agent) => (
          <li
            key={agent.id}
            className="flex min-h-[34px] items-center gap-2 rounded border border-border-muted bg-background/50 px-2 py-1"
          >
            <StatusIcon status={agent.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] text-text-secondary">{agent.label}</div>
              <div className="truncate text-[10px] text-text-muted">
                {[agent.machine, agent.modelCount ? `${agent.modelCount} models` : null, agent.statusDetail]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {agent.activeWork > 0 && (
              <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                {agent.activeWork}
              </span>
            )}
            <MissionActions actions={agent.actions} onAction={onAction} />
          </li>
        ))}
      </ul>
    </div>
  );
};

const MissionWorkList: React.FC<{
  onAction?: (action: MissionControlActionIntent) => void;
  work: MissionControlWorkItem[];
}> = ({ onAction, work }) => {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wider text-text-muted">
        {t('fleet.mission.workHeader', 'Work')}
      </div>
      {work.length === 0 ? (
        <div className="rounded border border-border-muted bg-background/50 px-2 py-2 text-[10px] text-text-muted">
          {t('fleet.mission.noWork', 'No recent run or saga yet')}
        </div>
      ) : (
        <ul className="space-y-1">
          {work.map((item) => {
            const lastCommandDuration = formatMissionDuration(item.proof.lastCommandDurationMs);
            const lastCommandLabel = item.proof.lastCommandText ?? item.proof.lastCommandTool;
            return (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex min-h-[42px] items-center gap-2 rounded border border-border-muted bg-background/50 px-2 py-1"
              >
                <ProofIcon status={item.proof.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-text-secondary">{item.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <MissionChip>{item.kind}</MissionChip>
                    <MissionChip>{item.status}</MissionChip>
                    {item.proof.totalTests > 0 && (
                      <MissionChip>
                        {item.proof.passedTests}/{item.proof.totalTests} tests
                      </MissionChip>
                    )}
                    {(item.proof.commandCount ?? 0) > 0 && (
                      <MissionChip>{item.proof.commandCount} cmd</MissionChip>
                    )}
                    {lastCommandLabel && item.proof.lastCommandStatus && (
                      <MissionChip tone={item.proof.lastCommandStatus === 'failed' ? 'attention' : undefined}>
                        {lastCommandLabel} {item.proof.lastCommandStatus}
                        {lastCommandDuration ? ` ${lastCommandDuration}` : ''}
                      </MissionChip>
                    )}
                    {item.filesChanged.length > 0 && (
                      <MissionChip>{item.filesChanged.length} files</MissionChip>
                    )}
                    {item.proof.highRiskCount > 0 && (
                      <MissionChip tone="attention">
                        {item.proof.highRiskCount} high risk
                      </MissionChip>
                    )}
                  </div>
                </div>
                <MissionActions actions={item.actions} onAction={onAction} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

function formatMissionDuration(ms?: number): string | null {
  if (!ms || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remainingSeconds}s`;
}

const MissionChip: React.FC<{
  children: React.ReactNode;
  tone?: 'attention';
}> = ({ children, tone }) => (
  <span
    className={`max-w-full truncate rounded border px-1.5 py-0.5 text-[9px] ${
      tone === 'attention'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-border-muted bg-surface/70 text-text-muted'
    }`}
  >
    {children}
  </span>
);

const MissionActions: React.FC<{
  actions: MissionControlActionIntent[];
  onAction?: (action: MissionControlActionIntent) => void;
}> = ({ actions, onAction }) => {
  if (actions.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {actions.map((action) => {
        const Icon = actionIcon(action.id);
        const title = action.reason ? `${action.label}: ${action.reason}` : action.label;
        return (
          <button
            key={`${action.id}:${action.targetKind}:${action.targetId}`}
            type="button"
            disabled={!action.enabled}
            onClick={() => onAction?.(action)}
            title={title}
            aria-label={title}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border-muted text-text-muted transition-colors hover:border-accent/50 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon size={11} />
          </button>
        );
      })}
    </div>
  );
};

function StatusIcon({ status }: { status: MissionControlAgent['status'] }) {
  if (status === 'error') return <AlertTriangle size={12} className="shrink-0 text-error" />;
  if (status === 'busy') return <Activity size={12} className="shrink-0 text-accent" />;
  if (status === 'offline') return <Square size={12} className="shrink-0 text-text-muted" />;
  return <Laptop2 size={12} className="shrink-0 text-success" />;
}

function ProofIcon({ status }: { status: MissionControlWorkItem['proof']['status'] }) {
  if (status === 'failed') return <AlertTriangle size={12} className="shrink-0 text-error" />;
  if (status === 'proven') return <ShieldCheck size={12} className="shrink-0 text-success" />;
  if (status === 'incomplete') return <Activity size={12} className="shrink-0 text-warning" />;
  return <CheckCircle2 size={12} className="shrink-0 text-text-muted" />;
}

function actionIcon(actionId: MissionControlActionIntent['id']) {
  if (actionId === 'merge') return GitMerge;
  if (actionId === 'reconnect' || actionId === 'resume') return RotateCcw;
  if (actionId === 'refresh') return RefreshCw;
  if (actionId === 'stop') return Square;
  return ShieldCheck;
}
