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

type MissionFocusTone = 'attention' | 'neutral' | 'ok' | 'running';

export interface MissionControlFocusChip {
  label: string;
  tone?: 'attention' | 'ok';
}

export interface MissionControlFocusLine {
  chips: MissionControlFocusChip[];
  detail?: string;
  headline: string;
  tone: MissionFocusTone;
}

export const MissionControlStrip: React.FC<{
  error?: string | null;
  onAction?: (action: MissionControlActionIntent) => void;
  refreshing?: boolean;
  snapshot: MissionControlSnapshot | null;
}> = ({ error = null, onAction, refreshing = false, snapshot }) => {
  const { t } = useTranslation();
  const focus = snapshot ? buildMissionControlFocus(snapshot) : null;

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

          {focus && <MissionFocusLine focus={focus} />}

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

export function buildMissionControlFocus(
  snapshot: MissionControlSnapshot,
): MissionControlFocusLine | null {
  const sortedWork = [...snapshot.work].sort(
    (left, right) => (right.updatedAt ?? right.startedAt) - (left.updatedAt ?? left.startedAt),
  );
  const workFocus =
    sortedWork.find(isMissionWorkActive) ??
    sortedWork.find(isMissionWorkAttention) ??
    sortedWork[0];
  if (workFocus) return buildMissionWorkFocus(snapshot, workFocus);

  const agentFocus =
    snapshot.agents.find((agent) => agent.status === 'error') ??
    snapshot.agents.find((agent) => agent.status === 'busy') ??
    snapshot.agents[0];
  if (!agentFocus) return null;
  const prefix = agentFocus.status === 'error'
    ? 'Agent attention'
    : agentFocus.status === 'busy'
      ? 'Agent busy'
      : 'Agent ready';
  return {
    chips: [
      { label: agentFocus.status, tone: agentFocus.status === 'error' ? 'attention' : undefined },
      ...(agentFocus.activeWork > 0 ? [{ label: `${agentFocus.activeWork} active` }] : []),
      ...(agentFocus.modelCount ? [{ label: `${agentFocus.modelCount} models` }] : []),
    ],
    detail: [agentFocus.machine, agentFocus.statusDetail].filter(Boolean).join(' · '),
    headline: `${prefix}: ${agentFocus.label}`,
    tone: agentFocus.status === 'error'
      ? 'attention'
      : agentFocus.status === 'busy'
        ? 'running'
        : 'neutral',
  };
}

function buildMissionWorkFocus(
  snapshot: MissionControlSnapshot,
  item: MissionControlWorkItem,
): MissionControlFocusLine {
  const agentLabel = item.agentId
    ? snapshot.agents.find((agent) => agent.id === item.agentId)?.label ?? item.agentId
    : undefined;
  const command = formatMissionCommand(item);
  const detail = [agentLabel, item.source, command].filter(Boolean).join(' · ');
  const tone = missionWorkFocusTone(item);
  const prefix = tone === 'attention'
    ? 'Needs attention'
    : tone === 'running'
      ? 'Now'
      : tone === 'ok'
        ? 'Verified'
        : 'Latest';
  return {
    chips: buildMissionWorkFocusChips(item),
    ...(detail ? { detail } : {}),
    headline: `${prefix}: ${item.title}`,
    tone,
  };
}

function buildMissionWorkFocusChips(item: MissionControlWorkItem): MissionControlFocusChip[] {
  return [
    { label: item.kind },
    { label: item.status, tone: isMissionWorkAttention(item) ? 'attention' : undefined },
    {
      label: `proof ${item.proof.status}`,
      tone: item.proof.status === 'failed'
        ? 'attention'
        : item.proof.status === 'proven'
          ? 'ok'
          : undefined,
    },
    ...(item.proof.totalTests > 0
      ? [{ label: `${item.proof.passedTests}/${item.proof.totalTests} tests`, tone: item.proof.failedTests > 0 ? 'attention' as const : 'ok' as const }]
      : []),
    ...(item.proof.commandCount > 0 ? [{ label: `${item.proof.commandCount} cmd` }] : []),
    ...(item.filesChanged.length > 0 ? [{ label: `${item.filesChanged.length} files` }] : []),
    ...(item.proof.highRiskCount > 0
      ? [{ label: `${item.proof.highRiskCount} high risk`, tone: 'attention' as const }]
      : []),
  ];
}

function formatMissionCommand(item: MissionControlWorkItem): string | null {
  const command = item.proof.lastCommandText ?? item.proof.lastCommandTool;
  if (!command || !item.proof.lastCommandStatus) return null;
  const duration = formatMissionDuration(item.proof.lastCommandDurationMs);
  return `${item.proof.lastCommandStatus}${duration ? ` ${duration}` : ''} ${command}`;
}

function missionWorkFocusTone(item: MissionControlWorkItem): MissionFocusTone {
  if (isMissionWorkAttention(item)) return 'attention';
  if (isMissionWorkActive(item)) return 'running';
  if (item.proof.status === 'proven') return 'ok';
  return 'neutral';
}

function isMissionWorkActive(item: MissionControlWorkItem): boolean {
  return item.status === 'running' || item.status === 'pending';
}

function isMissionWorkAttention(item: MissionControlWorkItem): boolean {
  return (
    item.status === 'failed' ||
    item.proof.status === 'failed' ||
    item.proof.failedTests > 0 ||
    item.proof.highRiskCount > 0
  );
}

const MissionFocusLine: React.FC<{ focus: MissionControlFocusLine }> = ({ focus }) => (
  <div
    className={`rounded border px-2 py-1.5 ${missionFocusClass(focus.tone)}`}
    data-testid="fleet-mission-focus"
  >
    <div className="flex items-start gap-2">
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${missionFocusDotClass(focus.tone)}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-text-secondary">
          {focus.headline}
        </div>
        {focus.detail && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
            {focus.detail}
          </div>
        )}
        {focus.chips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {focus.chips.map((chip) => (
              <MissionChip key={chip.label} tone={chip.tone}>
                {chip.label}
              </MissionChip>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

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

function missionFocusClass(tone: MissionFocusTone): string {
  if (tone === 'attention') return 'border-warning/40 bg-warning/10';
  if (tone === 'running') return 'border-accent/30 bg-accent/10';
  if (tone === 'ok') return 'border-success/30 bg-success/10';
  return 'border-border-muted bg-background/60';
}

function missionFocusDotClass(tone: MissionFocusTone): string {
  if (tone === 'attention') return 'bg-warning';
  if (tone === 'running') return 'bg-accent';
  if (tone === 'ok') return 'bg-success';
  return 'bg-text-muted';
}

const MissionChip: React.FC<{
  children: React.ReactNode;
  tone?: 'attention' | 'ok';
}> = ({ children, tone }) => (
  <span
    className={`max-w-full truncate rounded border px-1.5 py-0.5 text-[9px] ${
      tone === 'attention'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : tone === 'ok'
          ? 'border-success/30 bg-success/10 text-success'
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
