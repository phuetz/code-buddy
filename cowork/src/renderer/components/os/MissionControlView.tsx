/**
 * MissionControlView — the Mission Control OS cockpit as a full-screen primaryView.
 *
 * Composes the OS views (fleet topology, fleet load, council arena, peer capability
 * matrix) plus the autonomy posture panel. Fleet data is read from the Cowork
 * renderer store; the store itself is fed by the existing fleet IPC events.
 */
import { useCallback, useMemo, useState } from 'react';

import { usePolling } from './util/use-polling';

import { useAppStore } from '../../store';
import { AutonomyControlPanel, type AutonomyControlState } from '../os-actions/AutonomyControlPanel';
import type { AutonomyPosture } from '../os-actions/utils/autonomy-control-model.js';
import { CouncilArenaView } from './CouncilArenaView';
import { FleetLoadStrip } from './FleetLoadStrip';
import { FleetTopologyView } from './FleetTopologyView';
import { IntentProofPanel } from './IntentProofPanel';
import { PeerCapabilityMatrix } from './PeerCapabilityMatrix';
import { KnowledgeGraphView } from '../os-panels/KnowledgeGraphView';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '../os-panels/knowledge-graph-view-model.js';
import { OsStatusBar } from '../os-panels/OsStatusBar';
import type { OsStatusItem } from '../os-panels/os-status-bar-model.js';
import { AutonomyQueueBoard } from '../os-panels/AutonomyQueueBoard';
import { summarizeAutonomyQueue, type AutonomySnapshot } from '../os-panels/autonomy-queue-model.js';
import { Sparkline } from '../viz/Sparkline';
import type { CouncilSession } from './util/council-model';
import type { FleetLoad } from './util/fleet-load-model';
import type { Peer, PeerStatus } from './util/fleet-model';
import type {
  OsCapsuleCreateInput,
  OsConstitutionUpdateInput,
  OsExchangeBidInput,
  OsExchangeRehearseInput,
  OsForgeCreateInput,
  OsIntentActionResult,
  OsIntentProofPayload,
} from '../../../shared/intent-proof-types';

const EMPTY_LOAD: FleetLoad = { queued: 0, running: 0, capacity: 0, backpressure: 0, utilization: 0 };
const EMPTY_COUNCIL: CouncilSession = { id: 'council', title: 'Council', dhi: 0, verdicts: [] };
const DEFAULT_COST_CAP_USD = 10;

type FleetStorePeer = ReturnType<typeof useAppStore.getState>['fleetPeers'][string];

function toOsPeerStatus(status: string, utilization: number): PeerStatus {
  if (status === 'disconnected' || status === 'error') {
    return 'offline';
  }
  if (utilization > 0) {
    return 'busy';
  }
  return 'online';
}

function toOsPeer(peer: FleetStorePeer): Peer {
  const capability = peer.capability;
  const capacity = Math.max(1, capability?.maxConcurrency ?? 1);
  const running = Math.max(0, Math.min(capacity, capability?.activeRequests ?? 0));
  const utilization = running / capacity;
  const models = capability?.models.map((model) => model.id) ?? (peer.peerChatProvider ? [peer.peerChatProvider.model] : []);
  const strengths = capability?.models.flatMap((model) => model.strengths) ?? [];

  return {
    id: peer.id,
    label: peer.label ?? capability?.machineLabel ?? peer.url,
    status: toOsPeerStatus(peer.status, utilization),
    role: capability?.egress ?? (peer.peerChatProvider?.isLocal ? 'local' : 'peer'),
    utilization,
    latencyMs: capability?.models.find((model) => typeof model.avgLatencyMs === 'number')?.avgLatencyMs,
    models,
    tools: [],
    capabilities: Array.from(new Set(strengths)),
  };
}

function deriveFleetLoad(peers: Peer[]): FleetLoad {
  if (peers.length === 0) {
    return EMPTY_LOAD;
  }
  const running = peers.filter((peer) => peer.status === 'busy').length;
  const capacity = peers.filter((peer) => peer.status !== 'offline').length;
  const utilization = capacity === 0 ? 0 : running / capacity;

  return {
    queued: 0,
    running,
    capacity,
    backpressure: capacity === 0 ? 0 : Math.max(0, utilization - 0.8) / 0.2,
    utilization,
  };
}

function deriveCapabilities(peers: Peer[]): string[] {
  return Array.from(new Set(peers.flatMap((peer) => [
    ...(peer.models ?? []),
    ...(peer.tools ?? []),
    ...(peer.capabilities ?? []),
  ]))).sort((left, right) => left.localeCompare(right));
}

function postureFromPermissionMode(permissionMode: ReturnType<typeof useAppStore.getState>['permissionMode']): AutonomyPosture {
  if (permissionMode === 'bypassPermissions') {
    return 'full';
  }
  if (permissionMode === 'acceptEdits' || permissionMode === 'dontAsk') {
    return 'auto';
  }
  return 'plan';
}

export function MissionControlView() {
  const fleetPeers = useAppStore((state) => state.fleetPeers);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const permissionMode = useAppStore((state) => state.permissionMode);
  const setPermissionMode = useAppStore((state) => state.setPermissionMode);

  // Code Buddy 2.0 mission contract: GoalState projected as an Intent Graph,
  // with its append-only Proof Ledger. Prefer the active Cowork session; when
  // there is no active chat, main returns the most recent local mission.
  const [intentProof, setIntentProof] = useState<OsIntentProofPayload | null>(null);
  const [intentLoading, setIntentLoading] = useState(true);
  const [intentAction, setIntentAction] = useState<string | null>(null);
  const [intentActionError, setIntentActionError] = useState<string | null>(null);
  const refreshIntent = useCallback(() => {
    const readIntentProof = window.electronAPI?.os?.intentProof;
    if (!readIntentProof) {
      setIntentProof(null);
      setIntentLoading(false);
      return;
    }
    void readIntentProof({
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
      proofLimit: 50,
    })
      .then((payload) => setIntentProof(payload ?? null))
      .catch(() => setIntentProof(null))
      .finally(() => setIntentLoading(false));
  }, [activeSessionId]);
  usePolling(refreshIntent, 10_000);

  const manuallyRefreshIntent = useCallback(() => {
    setIntentLoading(true);
    refreshIntent();
  }, [refreshIntent]);

  const performIntentAction = useCallback(async (
    action: string,
    run: () => Promise<OsIntentActionResult>,
  ) => {
    setIntentAction(action);
    setIntentActionError(null);
    try {
      const result = await run();
      setIntentProof(result.payload);
      if (!result.ok) setIntentActionError(result.error ?? 'Action impossible.');
    } catch (error) {
      setIntentActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIntentAction(null);
    }
  }, []);

  const createForgeBranch = useCallback(async (input: Omit<OsForgeCreateInput, 'sessionId'>) => {
    const api = window.electronAPI?.os?.intentForgeCreate;
    if (!api) {
      setIntentActionError('Le pont Counterfactual Forge n’est pas disponible.');
      return;
    }
    await performIntentAction('create', () => api({
      ...input,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const evaluateForgeBranch = useCallback(async (branchId: string) => {
    const api = window.electronAPI?.os?.intentForgeEvaluate;
    if (!api) {
      setIntentActionError('Le pont Counterfactual Forge n’est pas disponible.');
      return;
    }
    await performIntentAction(`evaluate:${branchId}`, () => api({
      branchId,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const selectForgeBranch = useCallback(async (branchId: string) => {
    const api = window.electronAPI?.os?.intentForgeSelect;
    if (!api) {
      setIntentActionError('Le pont Counterfactual Forge n’est pas disponible.');
      return;
    }
    await performIntentAction(`select:${branchId}`, () => api({
      branchId,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const updateConstitution = useCallback(async (input: Omit<OsConstitutionUpdateInput, 'sessionId'>) => {
    const api = window.electronAPI?.os?.intentConstitutionUpdate;
    if (!api) {
      setIntentActionError('Le pont de constitution n’est pas disponible.');
      return;
    }
    await performIntentAction('constitution', () => api({
      ...input,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const submitExchangeBid = useCallback(async (input: Omit<OsExchangeBidInput, 'sessionId'>) => {
    const api = window.electronAPI?.os?.intentExchangeBid;
    if (!api) {
      setIntentActionError('Le pont Mission Exchange n’est pas disponible.');
      return;
    }
    await performIntentAction('exchange:bid', () => api({
      ...input,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const rehearseExchangeBid = useCallback(async (input: Omit<OsExchangeRehearseInput, 'sessionId'>) => {
    const api = window.electronAPI?.os?.intentExchangeRehearse;
    if (!api) {
      setIntentActionError('Le pont Shadow Twin n’est pas disponible.');
      return;
    }
    await performIntentAction(`exchange:shadow:${input.bidId}`, () => api({
      ...input,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const awardExchangeBid = useCallback(async (bidId: string) => {
    const api = window.electronAPI?.os?.intentExchangeAward;
    if (!api) {
      setIntentActionError('Le pont de règlement n’est pas disponible.');
      return;
    }
    await performIntentAction(`exchange:award:${bidId}`, () => api({
      bidId,
      humanApproved: true,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const rejectExchangeBid = useCallback(async (bidId: string) => {
    const api = window.electronAPI?.os?.intentExchangeReject;
    if (!api) {
      setIntentActionError('Le pont de règlement n’est pas disponible.');
      return;
    }
    await performIntentAction(`exchange:reject:${bidId}`, () => api({
      bidId,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const createCapsule = useCallback(async (input: Omit<OsCapsuleCreateInput, 'sessionId'>) => {
    const api = window.electronAPI?.os?.intentCapsuleCreate;
    if (!api) {
      setIntentActionError('Le pont Outcome Capsules n’est pas disponible.');
      return;
    }
    await performIntentAction('capsule:create', () => api({
      ...input,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const activateCapsule = useCallback(async (capsuleId: string) => {
    const api = window.electronAPI?.os?.intentCapsuleActivate;
    if (!api) {
      setIntentActionError('Le pont Outcome Capsules n’est pas disponible.');
      return;
    }
    await performIntentAction(`capsule:activate:${capsuleId}`, () => api({
      capsuleId,
      humanApproved: true,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  const revokeCapsule = useCallback(async (capsuleId: string) => {
    const api = window.electronAPI?.os?.intentCapsuleRevoke;
    if (!api) {
      setIntentActionError('Le pont Outcome Capsules n’est pas disponible.');
      return;
    }
    await performIntentAction(`capsule:revoke:${capsuleId}`, () => api({
      capsuleId,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    }));
  }, [activeSessionId, performIntentAction]);

  // Real council data: the latest CLI council run read from the
  // ~/.codebuddy JSONL ledgers (os.councilHealth IPC). Null → honest empty.
  const [council, setCouncil] = useState<CouncilSession | null>(null);
  const [dhiHistory, setDhiHistory] = useState<Array<{ at: string; taskType: string; dhi: number }>>([]);
  const refreshCouncil = useCallback(() => {
    void window.electronAPI?.os
      ?.councilHealth()
      .then((payload) => {
        if (!payload) return;
        if (payload.session) setCouncil(payload.session);
        setDhiHistory(payload.history ?? []);
      })
      .catch(() => {});
  }, []);
  usePolling(refreshCouncil, 30_000);

  // Real autonomy daemon queue (the ~/.codebuddy/fleet task board).
  const [daemonSnapshot, setDaemonSnapshot] = useState<AutonomySnapshot | null>(null);
  const refreshSnapshot = useCallback(() => {
    void window.electronAPI?.autonomy
      ?.snapshot()
      .then((snap) => {
        if (!snap?.ok) return;
        setDaemonSnapshot({ tasks: snap.tasks ?? [], worklog: snap.worklog ?? [], presence: snap.presence ?? {} });
      })
      .catch(() => {});
  }, []);
  usePolling(refreshSnapshot, 30_000);

  // Real Collective Knowledge Graph (the robot's shared memory), folded from
  // the append-only ledger by the os.knowledgeGraph IPC.
  const [knowledge, setKnowledge] = useState<{ nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] }>({ nodes: [], edges: [] });
  const refreshKnowledge = useCallback(() => {
    void window.electronAPI?.os
      ?.knowledgeGraph()
      .then((payload) => {
        if (payload) setKnowledge({ nodes: payload.nodes, edges: payload.edges });
      })
      .catch(() => {});
  }, []);
  usePolling(refreshKnowledge, 30_000);

  // Real autonomy daemon state (the always-on `codebuddy-autonomy` service).
  const [daemonRunning, setDaemonRunning] = useState<boolean | null>(null);
  const refreshDaemon = useCallback(() => {
    void window.electronAPI?.autonomy
      ?.daemonStatus()
      .then((status) => setDaemonRunning(status.ok ? Boolean(status.service?.running) : null))
      .catch(() => setDaemonRunning(null));
  }, []);
  usePolling(refreshDaemon, 30_000);

  const controlDaemon = useCallback(
    (action: 'start' | 'stop') => {
      void window.electronAPI?.autonomy
        ?.serviceControl(action)
        .then((result) => {
          if (result.service) setDaemonRunning(Boolean(result.service.running));
          else refreshDaemon();
        })
        .catch(() => refreshDaemon());
    },
    [refreshDaemon],
  );

  const peers = useMemo(() => Object.values(fleetPeers).map(toOsPeer), [fleetPeers]);
  const load = useMemo(() => deriveFleetLoad(peers), [peers]);
  const capabilities = useMemo(() => deriveCapabilities(peers), [peers]);
  const autonomyState: AutonomyControlState = {
    posture: postureFromPermissionMode(permissionMode),
    // Honest: paused when the real daemon service is not running (unknown → paused).
    daemonPaused: daemonRunning !== true,
    costCapUsd: DEFAULT_COST_CAP_USD,
  };

  const setPosture = (posture: AutonomyPosture) => {
    setPermissionMode(posture === 'full' ? 'bypassPermissions' : posture === 'auto' ? 'acceptEdits' : 'plan');
  };

  // TODO(os-wiring): no cost-cap IPC exists in the renderer bridge yet.
  const noop = () => {};

  // Status bar composed from the REAL signals this view already loads —
  // one glance: daemon, council health, collective memory, fleet.
  const statusItems: OsStatusItem[] = [
    {
      label: 'Daemon autonomie',
      value: daemonRunning === null ? 'inconnu' : daemonRunning ? 'actif' : 'arrêté',
      tone: daemonRunning === null ? 'muted' : daemonRunning ? 'ok' : 'warn',
    },
    {
      label: 'Council DHI',
      value: council ? String(Math.round(council.dhi * 100)) : '—',
      tone: !council ? 'muted' : council.dhi > 0.75 ? 'ok' : council.dhi > 0.5 ? 'warn' : 'error',
    },
    {
      label: 'Mémoire collective',
      value: knowledge.nodes.length > 0 ? `${knowledge.nodes.length} nœuds · ${knowledge.edges.length} liens` : 'vide',
      tone: knowledge.nodes.length > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Pairs flotte',
      value: peers.length > 0 ? String(peers.length) : 'aucun',
      tone: peers.length > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Intention',
      value: intentProof?.state
        ? `${intentProof.state.turnsUsed}/${intentProof.state.maxTurns} tours`
        : 'aucune',
      tone: !intentProof?.state
        ? 'muted'
        : intentProof.state.status === 'done'
          ? 'ok'
          : intentProof.state.status === 'paused'
            ? 'warn'
            : 'ok',
    },
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1500px] space-y-4 p-4 sm:p-5">
        <header>
          <h1 className="text-xl font-semibold text-foreground">Mission Control</h1>
        </header>

        <IntentProofPanel
          payload={intentProof}
          loading={intentLoading}
          pendingAction={intentAction}
          actionError={intentActionError}
          onRefresh={manuallyRefreshIntent}
          onForgeCreate={createForgeBranch}
          onForgeEvaluate={evaluateForgeBranch}
          onForgeSelect={selectForgeBranch}
          onConstitutionUpdate={updateConstitution}
          onExchangeBid={submitExchangeBid}
          onExchangeRehearse={rehearseExchangeBid}
          onExchangeAward={awardExchangeBid}
          onExchangeReject={rejectExchangeBid}
          onCapsuleCreate={createCapsule}
          onCapsuleActivate={activateCapsule}
          onCapsuleRevoke={revokeCapsule}
        />

        <OsStatusBar items={statusItems} />

        <FleetLoadStrip load={load} />

        <FleetTopologyView peers={peers} />

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-3">
            <CouncilArenaView session={council ?? EMPTY_COUNCIL} />
            {dhiHistory.length >= 2 ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
                <Sparkline
                  values={dhiHistory.map((h) => Math.round(h.dhi * 100))}
                  width={160}
                  height={36}
                  tone={(dhiHistory[dhiHistory.length - 1]?.dhi ?? 0) > 0.75 ? 'success' : 'warning'}
                />
                <div className="min-w-0 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Tendance DHI</span> — {dhiHistory.length} runs,
                  dernier {Math.round((dhiHistory[dhiHistory.length - 1]?.dhi ?? 0) * 100)} ({dhiHistory[dhiHistory.length - 1]?.taskType})
                </div>
              </div>
            ) : null}
          </div>
          <PeerCapabilityMatrix peers={peers} capabilities={capabilities} />
        </div>

        <KnowledgeGraphView nodes={knowledge.nodes} edges={knowledge.edges} />

        <AutonomyControlPanel
          state={autonomyState}
          onPostureChange={setPosture}
          onDaemonPause={() => controlDaemon('stop')}
          onDaemonResume={() => controlDaemon('start')}
          onCostCapChange={noop}
        />
        {daemonSnapshot ? <AutonomyQueueBoard summary={summarizeAutonomyQueue(daemonSnapshot, new Date())} /> : null}
      </div>
    </div>
  );
}
