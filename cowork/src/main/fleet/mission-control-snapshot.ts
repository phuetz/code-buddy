import os from 'node:os';
import type { FleetPeer } from '../../renderer/types';

export type MissionControlAgentKind = 'local' | 'fleet-peer';
export type MissionControlAgentStatus = 'online' | 'busy' | 'offline' | 'error' | 'unknown';
export type MissionControlWorkKind = 'run' | 'saga';
export type MissionControlWorkStatus =
  | 'running'
  | 'pending'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete';
export type MissionControlProofStatus = 'proven' | 'incomplete' | 'failed' | 'unknown';
export type MissionControlActionId =
  | 'audit'
  | 'merge'
  | 'reconnect'
  | 'refresh'
  | 'resume'
  | 'stop';

export interface MissionControlActionIntent {
  enabled: boolean;
  id: MissionControlActionId;
  label: string;
  reason?: string;
  targetId: string;
  targetKind: MissionControlAgentKind | MissionControlWorkKind;
}

export interface MissionControlProof {
  artifactCount: number;
  commandCount: number;
  failedTests: number;
  highRiskCount: number;
  lastCommandDurationMs?: number;
  lastCommandStatus?: 'passed' | 'failed' | 'unknown';
  lastCommandText?: string;
  lastCommandTool?: string;
  passedTests: number;
  redactionCount: number;
  riskCount: number;
  status: MissionControlProofStatus;
  testCommandCount: number;
  totalTests: number;
}

export interface MissionControlAgent {
  actions: MissionControlActionIntent[];
  activeWork: number;
  id: string;
  kind: MissionControlAgentKind;
  label: string;
  lastEventType?: string;
  lastSeenAt?: number;
  machine?: string;
  modelCount?: number;
  status: MissionControlAgentStatus;
  statusDetail?: string;
  url?: string;
}

export interface MissionControlWorkItem {
  actions: MissionControlActionIntent[];
  agentId?: string;
  filesChanged: string[];
  id: string;
  kind: MissionControlWorkKind;
  proof: MissionControlProof;
  source?: string;
  startedAt: number;
  status: MissionControlWorkStatus;
  title: string;
  updatedAt?: number;
}

export interface MissionControlSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  hostname: string;
  summary: {
    activeAgents: number;
    activeWork: number;
    agentCount: number;
    errorAgents: number;
    offlineAgents: number;
    failedProof: number;
    incompleteProof: number;
    needsAttention: number;
    provenWork: number;
    workCount: number;
  };
  agents: MissionControlAgent[];
  work: MissionControlWorkItem[];
}

export interface CoreRunSummaryLike {
  artifactCount?: number;
  endedAt?: number;
  eventCount?: number;
  metadata?: {
    channel?: string;
    tags?: string[];
  };
  objective: string;
  runId: string;
  startedAt: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

export interface CoreRunRecordLike {
  summary: CoreRunSummaryLike;
}

export interface CoreRunStoreLike {
  getRun(runId: string): CoreRunRecordLike | null;
  listRuns(limit?: number): CoreRunSummaryLike[];
}

export interface CoreProofLedgerCommandLike {
  command?: string;
  durationMs?: number;
  isTest?: boolean;
  sequence?: number;
  success?: boolean;
  toolName?: string;
  ts?: number;
}

export interface CoreProofLedgerLike {
  artifacts?: unknown[];
  commands?: CoreProofLedgerCommandLike[];
  filesChanged?: unknown[];
  privacy?: {
    redactionCount?: number;
  };
  risks?: Array<{
    level?: string;
  }>;
  status?: MissionControlProofStatus;
  tests?: {
    commands?: CoreProofLedgerCommandLike[];
    failed?: number;
    passed?: number;
    total?: number;
  };
}

export interface CoreProofLedgerModuleLike {
  buildProofLedgerForRun?: (
    store: CoreRunStoreLike,
    runId: string,
  ) => CoreProofLedgerLike | null;
}

export interface SagaSummaryLike {
  createdAt: number;
  goal: string;
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  steps?: Array<{
    peerId?: string;
    status?: string;
  }>;
}

export interface BuildMissionControlSnapshotInput {
  hostname?: string;
  now?: Date;
  peers: FleetPeer[];
  proofLedger?: CoreProofLedgerModuleLike | null;
  runs?: CoreRunSummaryLike[];
  runStore?: CoreRunStoreLike | null;
  sagas?: SagaSummaryLike[];
}

export function buildMissionControlSnapshot(
  input: BuildMissionControlSnapshotInput,
): MissionControlSnapshot {
  const hostname = input.hostname ?? os.hostname();
  const runs = input.runs ?? input.runStore?.listRuns(25) ?? [];
  const sagas = input.sagas ?? [];
  const work = [
    ...runs.map((run) => buildRunWorkItem(run, input.runStore, input.proofLedger)),
    ...sagas.map(buildSagaWorkItem),
  ].sort((left, right) => (right.updatedAt ?? right.startedAt) - (left.updatedAt ?? left.startedAt));

  const activeWorkByAgent = new Map<string, number>();
  for (const item of work) {
    if (!item.agentId || !isActiveWorkStatus(item.status)) continue;
    activeWorkByAgent.set(item.agentId, (activeWorkByAgent.get(item.agentId) ?? 0) + 1);
  }

  const localActiveWork = work.filter((item) =>
    item.kind === 'run' && item.agentId === 'local' && isActiveWorkStatus(item.status),
  ).length;
  const agents = [
    buildLocalAgent(hostname, localActiveWork),
    ...input.peers.map((peer) => buildPeerAgent(peer, activeWorkByAgent.get(peer.id) ?? 0)),
  ];
  const activeWork = work.filter((item) => isActiveWorkStatus(item.status)).length;
  const needsAttention = work.filter((item) =>
    item.status === 'failed' ||
    item.proof.status === 'failed' ||
    item.proof.highRiskCount > 0,
  ).length + agents.filter((agent) => agent.status === 'error').length;
  const failedProof = work.filter((item) => item.proof.status === 'failed').length;
  const incompleteProof = work.filter((item) => item.proof.status === 'incomplete').length;

  return {
    schemaVersion: 1,
    generatedAt: (input.now ?? new Date()).toISOString(),
    hostname,
    summary: {
      activeAgents: agents.filter((agent) => agent.status === 'online' || agent.status === 'busy').length,
      activeWork,
      agentCount: agents.length,
      errorAgents: agents.filter((agent) => agent.status === 'error').length,
      failedProof,
      incompleteProof,
      needsAttention,
      offlineAgents: agents.filter((agent) => agent.status === 'offline').length,
      provenWork: work.filter((item) => item.proof.status === 'proven').length,
      workCount: work.length,
    },
    agents,
    work,
  };
}

function buildLocalAgent(hostname: string, activeWork: number): MissionControlAgent {
  return {
    actions: [
      actionIntent('audit', 'Audit', 'local', 'local', {
        enabled: activeWork > 0,
        reason: activeWork > 0 ? undefined : 'No active local run',
      }),
    ],
    activeWork,
    id: 'local',
    kind: 'local',
    label: 'Cowork local',
    machine: hostname,
    status: activeWork > 0 ? 'busy' : 'online',
    statusDetail: activeWork > 0 ? `${activeWork} active run(s)` : 'ready',
  };
}

function buildPeerAgent(peer: FleetPeer, activeWork: number): MissionControlAgent {
  const totalActiveWork = Math.max(activeWork, peer.capability?.activeRequests ?? 0);
  const status = mapPeerStatus(peer.status, totalActiveWork);
  const canRefresh = peer.status !== 'connecting' && peer.status !== 'reconnecting';
  const canReconnect = peer.status === 'disconnected' || peer.status === 'error';
  return {
    actions: [
      actionIntent('refresh', 'Refresh', peer.id, 'fleet-peer', {
        enabled: canRefresh,
        reason: canRefresh ? undefined : 'Peer is already negotiating a connection',
      }),
      actionIntent('reconnect', 'Reconnect', peer.id, 'fleet-peer', {
        enabled: canReconnect,
        reason: canReconnect ? undefined : 'Reconnect is only needed for offline/error peers',
      }),
    ],
    activeWork: totalActiveWork,
    id: peer.id,
    kind: 'fleet-peer',
    label: peer.label ?? peer.capability?.machineLabel ?? peer.id,
    lastEventType: peer.lastEventType,
    lastSeenAt: peer.lastSeenAt,
    machine: peer.capability?.machineLabel,
    modelCount: peer.capability?.models.length,
    status,
    statusDetail: peer.lastError ?? peer.status,
    url: peer.url,
  };
}

function buildRunWorkItem(
  run: CoreRunSummaryLike,
  runStore?: CoreRunStoreLike | null,
  proofLedger?: CoreProofLedgerModuleLike | null,
): MissionControlWorkItem {
  const proof = runStore && proofLedger?.buildProofLedgerForRun
    ? proofLedger.buildProofLedgerForRun(runStore, run.runId)
    : null;
  return {
    actions: buildRunActions(run, proof),
    agentId: 'local',
    filesChanged: normalizeStringList(proof?.filesChanged).slice(0, 8),
    id: run.runId,
    kind: 'run',
    proof: normalizeProof(proof, run),
    source: inferRunSource(run),
    startedAt: run.startedAt,
    status: run.status,
    title: run.objective,
    updatedAt: run.endedAt ?? run.startedAt,
  };
}

function buildSagaWorkItem(saga: SagaSummaryLike): MissionControlWorkItem {
  const activeStep = saga.steps?.find((step) => step.status === 'running') ?? saga.steps?.[0];
  const active = saga.status === 'running' || saga.status === 'pending';
  return {
    actions: [
      actionIntent('audit', 'Audit', saga.id, 'saga'),
      actionIntent('stop', 'Stop', saga.id, 'saga', {
        enabled: false,
        reason: active ? 'Stop controls are not wired from Mission Control yet' : 'Saga is not active',
      }),
      actionIntent('resume', 'Resume', saga.id, 'saga', {
        enabled: false,
        reason: active ? 'Saga is already active' : 'Resume is not wired from Mission Control yet',
      }),
    ],
    agentId: activeStep?.peerId,
    filesChanged: [],
    id: saga.id,
    kind: 'saga',
    proof: emptyProof('unknown'),
    source: 'fleet',
    startedAt: saga.createdAt,
    status: saga.status,
    title: saga.goal,
    updatedAt: saga.createdAt,
  };
}

function buildRunActions(
  run: CoreRunSummaryLike,
  proof: CoreProofLedgerLike | null,
): MissionControlActionIntent[] {
  const actions: MissionControlActionIntent[] = [
    actionIntent('audit', 'Audit', run.runId, 'run', {
      enabled: false,
      reason: 'Run audit opens from the Audit log for now',
    }),
  ];
  if (run.status === 'running') {
    actions.push(actionIntent('stop', 'Stop', run.runId, 'run', {
      enabled: false,
      reason: 'Stop controls are not wired from Mission Control yet',
    }));
  } else {
    actions.push(actionIntent('resume', 'Resume', run.runId, 'run', {
      enabled: false,
      reason: 'Resume controls are not wired from Mission Control yet',
    }));
  }
  if (normalizeStringList(proof?.filesChanged).length > 0) {
    actions.push(actionIntent('merge', 'Merge', run.runId, 'run', {
      enabled: false,
      reason: 'Merge needs an explicit VCS handoff',
    }));
  }
  return actions;
}

function normalizeProof(
  proof: CoreProofLedgerLike | null,
  run: CoreRunSummaryLike,
): MissionControlProof {
  if (!proof) {
    return emptyProof(run.status === 'completed' ? 'unknown' : run.status === 'failed' ? 'failed' : 'incomplete');
  }
  const risks = Array.isArray(proof.risks) ? proof.risks : [];
  const commands = normalizeProofCommands(proof.commands);
  const testCommands = normalizeProofCommands(proof.tests?.commands);
  const commandTimeline = commands.length > 0 ? commands : testCommands;
  const lastCommand = commandTimeline.at(-1);
  return {
    artifactCount: Array.isArray(proof.artifacts) ? proof.artifacts.length : run.artifactCount ?? 0,
    commandCount: commandTimeline.length,
    failedTests: proof.tests?.failed ?? 0,
    highRiskCount: risks.filter((risk) => risk.level === 'high').length,
    lastCommandDurationMs: lastCommand?.durationMs,
    lastCommandStatus: lastCommand ? mapProofCommandStatus(lastCommand.success) : undefined,
    lastCommandText: lastCommand?.command,
    lastCommandTool: lastCommand?.toolName,
    passedTests: proof.tests?.passed ?? 0,
    redactionCount: proof.privacy?.redactionCount ?? 0,
    riskCount: risks.length,
    status: proof.status ?? 'unknown',
    testCommandCount: testCommands.length || commandTimeline.filter((command) => command.isTest).length,
    totalTests: proof.tests?.total ?? 0,
  };
}

function emptyProof(status: MissionControlProofStatus): MissionControlProof {
  return {
    artifactCount: 0,
    commandCount: 0,
    failedTests: 0,
    highRiskCount: 0,
    passedTests: 0,
    redactionCount: 0,
    riskCount: 0,
    status,
    testCommandCount: 0,
    totalTests: 0,
  };
}

function normalizeProofCommands(commands?: CoreProofLedgerCommandLike[]): CoreProofLedgerCommandLike[] {
  if (!Array.isArray(commands)) return [];
  return commands
    .filter((command) => command && typeof command === 'object')
    .map((command, index) => ({
      durationMs: typeof command.durationMs === 'number' ? command.durationMs : undefined,
      command: typeof command.command === 'string' && command.command.trim()
        ? command.command.trim()
        : undefined,
      isTest: command.isTest === true,
      sequence: typeof command.sequence === 'number' ? command.sequence : index + 1,
      success: typeof command.success === 'boolean' ? command.success : undefined,
      toolName: typeof command.toolName === 'string' && command.toolName.trim()
        ? command.toolName.trim()
        : 'unknown_tool',
      ts: typeof command.ts === 'number' ? command.ts : undefined,
    }))
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
}

function mapProofCommandStatus(success?: boolean): MissionControlProof['lastCommandStatus'] {
  if (success === true) return 'passed';
  if (success === false) return 'failed';
  return 'unknown';
}

function mapPeerStatus(
  status: FleetPeer['status'],
  activeWork: number,
): MissionControlAgentStatus {
  if (status === 'error') return 'error';
  if (activeWork > 0) return 'busy';
  if (status === 'authenticated' || status === 'connected') return 'online';
  if (status === 'disconnected') return 'offline';
  if (status === 'connecting' || status === 'reconnecting') return 'unknown';
  return 'unknown';
}

function actionIntent(
  id: MissionControlActionId,
  label: string,
  targetId: string,
  targetKind: MissionControlActionIntent['targetKind'],
  options: { enabled?: boolean; reason?: string } = {},
): MissionControlActionIntent {
  return {
    enabled: options.enabled ?? true,
    id,
    label,
    ...(options.reason ? { reason: options.reason } : {}),
    targetId,
    targetKind,
  };
}

function inferRunSource(run: CoreRunSummaryLike): string | undefined {
  const tags = run.metadata?.tags ?? [];
  if (tags.includes('fleet')) return 'fleet';
  if (tags.includes('scheduled') || run.metadata?.channel === 'cron') return 'scheduled';
  if (tags.includes('mobile') || run.metadata?.channel === 'mobile') return 'mobile';
  if (run.metadata?.channel === 'cowork' || run.metadata?.channel === 'desktop') return 'cowork';
  if (run.metadata?.channel === 'terminal') return 'cli';
  return run.metadata?.channel;
}

function isActiveWorkStatus(status: MissionControlWorkStatus): boolean {
  return status === 'running' || status === 'pending';
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)),
  ];
}
