/**
 * FleetCommandCenter — Cowork's multi-AI command center (Fleet P5).
 *
 * Three-column layout:
 *   - LEFT  (35%): peer list with status badge, egress chip
 *                 (local/lan/cloud), model count, drag handle.
 *   - CENTER(40%): goal input + dispatch button. Shows a saga status
 *                 board with progress bars and final results.
 *   - RIGHT (25%): currently-selected peer or saga detail (capability,
 *                 model list, saga route, outcome).
 *
 * Activated from a Network icon in the titlebar (already imported).
 *
 * @module renderer/components/FleetCommandCenter
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Network,
  X,
  Send,
  CalendarPlus,
  AlertCircle,
  Loader2,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { FleetPeer, ScheduleTask } from '../types';
import {
  FLEET_DISPATCH_PROFILES,
  FLEET_DISPATCH_PROFILE_LABEL_KEYS,
  buildAgentRunDraftPreview,
  buildFleetDispatchGoalContext,
  buildFleetOutcomeDispatchPreset,
  buildFleetScheduledDispatchDraft,
  isFleetActivity,
  isFleetScheduledTask,
  isFleetTerminalActivity,
  isFleetOutcomeMemory,
  shortId,
} from './fleet-command-center-helpers';
import type {
  ActivityEntry,
  FleetDispatchProfile,
  FleetMemoryEntry,
  SagaSummary,
} from './fleet-command-center-helpers';
import type { AgentRun } from '../../../../src/agent/agent-run-contract.js';
import { FleetOutcomeDetail, FleetOutcomeStrip } from './fleet-outcome-panel';
import { ScheduledWorkStrip } from './fleet-scheduled-work-strip';
import { FleetMemoryStrip } from './fleet-memory-strip';
import { HermesPlanStrip } from './hermes-plan-strip';
import { HermesProviderReadinessStrip } from './hermes-provider-readiness-strip';
import { HermesRuntimeBackendsStrip } from './hermes-runtime-backends-strip';
import { HermesBrowserBackendsStrip } from './hermes-browser-backends-strip';
import { HermesToolCatalogStrip } from './hermes-tool-catalog-strip';
import { HermesToolsetsStrip } from './hermes-toolsets-strip';
import { ToolProfileInspectorStrip } from './tool-profile-inspector-strip';
import {
  LeadDiscoveryWorkflowStrip,
  type LeadDiscoveryWorkflowScheduleMetadata,
} from './lead-discovery-workflow-strip';
import {
  BrowserOperatorDraftStrip,
  type BrowserOperatorScheduleMetadata,
} from './browser-operator-draft-strip';
import {
  SkillCandidateReviewQueueStrip,
  type SkillCandidateReviewQueueItem,
} from './skill-candidate-review-queue-strip';
import { SkillPackageManagerStrip } from './skill-package-manager-strip';
import { LearningSkillUsageStrip } from './learning-skill-usage-strip';
import { LessonCandidateReviewStrip } from './lesson-candidate-review-strip';
import { LessonsVaultStrip } from './lessons-vault-strip';
import { LessonsVaultGraph } from './LessonsVaultGraph';
import { SagaBoard } from './fleet-saga-board';
import { PeerDetail, PeerRow } from './fleet-peer-panel';
import { SagaDetail } from './fleet-saga-detail';
import {
  buildFleetInternetProofPlan,
  buildInternetProofSummaryMetadata,
  summarizeInternetProofPlan,
} from '../../shared/internet-proof-metadata';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface FleetRefreshResult {
  success: boolean;
  peer?: FleetPeer;
  peers?: FleetPeer[];
  error?: string;
}

interface FleetDispatchResult {
  ok: boolean;
  sagaId?: string;
  error?: string;
  privacyTag?: 'public' | 'sensitive';
  dispatchProfile?: FleetDispatchProfile;
  lintWarning?: string;
}

interface FleetDispatchRequest {
  goal: string;
  parallelism?: number;
  privacyTag?: 'public' | 'sensitive';
  dispatchProfile?: FleetDispatchProfile;
  targetPeerIds?: string[];
  targetPeerLabels?: string[];
  agentRunId?: string;
  agentRunSchemaVersion?: number;
  parentRunId?: string;
  outcomeId?: string;
  scheduleTaskId?: string;
  sourceSessionId?: string;
  deliveryChannel?: string;
  memoryCount?: number;
  hermesPlanId?: string;
  hermesPlanProfile?: string;
  hermesPlanSurface?: string;
  /**
   * Hermes-style chain (Draft→Review→Test). When set, the main process
   * uses `planChainDispatch` instead of the standard router plan, so
   * each role gets routed to the best-suited peer in sequence. Common
   * value: `['code', 'review', 'safe']`.
   */
  chainRoles?: string[];
  /**
   * Council mode — fan the same goal to ≥2 peers then arbitrate with the
   * consensus aggregator (cross-critique + agreement score). Forces
   * parallelism ≥ 2; ignored when `chainRoles` is set.
   */
  council?: boolean;
}

function buildInheritedRunMetadata(run: AgentRun | null): Record<string, unknown> {
  if (!run) return {};
  return {
    parentRunId: run.id,
    ...(run.lineage?.outcomeId ? { outcomeId: run.lineage.outcomeId } : {}),
    ...(run.lineage?.sagaId ? { sagaId: run.lineage.sagaId } : {}),
    ...(run.lineage?.scheduleTaskId ? { scheduleTaskId: run.lineage.scheduleTaskId } : {}),
    ...(run.lineage?.sourceSessionId ? { sourceSessionId: run.lineage.sourceSessionId } : {}),
    ...(run.lineage?.deliveryChannel ? { deliveryChannel: run.lineage.deliveryChannel } : {}),
    ...(run.lineage?.hermesPlanId ? { hermesPlanId: run.lineage.hermesPlanId } : {}),
    ...(run.lineage?.hermesPlanProfile ? { hermesPlanProfile: run.lineage.hermesPlanProfile } : {}),
    ...(run.lineage?.hermesPlanSurface ? { hermesPlanSurface: run.lineage.hermesPlanSurface } : {}),
  };
}

function buildDispatchRunMetadata(run: AgentRun | null): Partial<FleetDispatchRequest> {
  if (!run) return {};
  return {
    agentRunId: run.id,
    agentRunSchemaVersion: run.schemaVersion,
    ...(run.lineage?.parentRunId ? { parentRunId: run.lineage.parentRunId } : {}),
    ...(run.lineage?.outcomeId ? { outcomeId: run.lineage.outcomeId } : {}),
    ...(run.lineage?.scheduleTaskId ? { scheduleTaskId: run.lineage.scheduleTaskId } : {}),
    ...(run.lineage?.sourceSessionId ? { sourceSessionId: run.lineage.sourceSessionId } : {}),
    ...(run.lineage?.deliveryChannel ? { deliveryChannel: run.lineage.deliveryChannel } : {}),
    ...(run.lineage?.hermesPlanId ? { hermesPlanId: run.lineage.hermesPlanId } : {}),
    ...(run.lineage?.hermesPlanProfile ? { hermesPlanProfile: run.lineage.hermesPlanProfile } : {}),
    ...(run.lineage?.hermesPlanSurface ? { hermesPlanSurface: run.lineage.hermesPlanSurface } : {}),
    ...(run.memory?.included ? { memoryCount: run.memory.count } : {}),
  };
}

interface FleetApiBridge {
  list?: () => Promise<FleetPeer[]>;
  refreshCapabilities?: (peerId?: string) => Promise<FleetRefreshResult>;
}

interface ScheduleApiBridge {
  list?: () => Promise<ScheduleTask[]>;
  runNow?: (taskId: string) => Promise<ScheduleTask | null>;
}

interface ActivityApiBridge {
  recent?: (limit?: number, projectId?: string) => Promise<ActivityEntry[]>;
}

interface MemoryApiBridge {
  list?: (projectId?: string) => Promise<FleetMemoryEntry[]>;
}

interface SkillCandidateApiBridge {
  install?: (options: {
    approvedBy: string;
    candidatePath: string;
    cwd?: string;
    overwrite?: boolean;
    workspaceSkillRoot?: string;
  }) => Promise<{ error?: string; ok: boolean }>;
  list?: (options?: {
    cwd?: string;
    eligibleOnly?: boolean;
    limit?: number;
    skillRoot?: string;
  }) => Promise<SkillCandidateReviewQueueItem[]>;
}

function getFleetApi(): FleetApiBridge | undefined {
  return (
    window as unknown as {
      electronAPI?: { fleet?: FleetApiBridge };
    }
  ).electronAPI?.fleet;
}

function getScheduleApi(): ScheduleApiBridge | undefined {
  return (
    window as unknown as {
      electronAPI?: { schedule?: ScheduleApiBridge };
    }
  ).electronAPI?.schedule;
}

function getActivityApi(): ActivityApiBridge | undefined {
  return (
    window as unknown as {
      electronAPI?: { activity?: ActivityApiBridge };
    }
  ).electronAPI?.activity;
}

function getMemoryApi(): MemoryApiBridge | undefined {
  return (
    window as unknown as {
      electronAPI?: { memory?: MemoryApiBridge };
    }
  ).electronAPI?.memory;
}

function getSkillCandidateApi(): SkillCandidateApiBridge | undefined {
  return (
    window as unknown as {
      electronAPI?: { tools?: { skillCandidate?: SkillCandidateApiBridge } };
    }
  ).electronAPI?.tools?.skillCandidate;
}

export const FleetCommandCenter: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const workingDir = useAppStore((s) => s.workingDir);
  const fleetPeers = useAppStore((s) => s.fleetPeers);
  const setFleetPeers = useAppStore((s) => s.setFleetPeers);
  const upsertFleetPeer = useAppStore((s) => s.upsertFleetPeer);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const setScheduleDraft = useAppStore((s) => s.setScheduleDraft);
  const fleetGoalDraft = useAppStore((s) => s.fleetGoalDraft);
  const setFleetGoalDraft = useAppStore((s) => s.setFleetGoalDraft);
  const setShowLessonCandidatePanel = useAppStore((s) => s.setShowLessonCandidatePanel);
  const peers = useMemo(() => Object.values(fleetPeers), [fleetPeers]);
  const routablePeers = useMemo(
    () => peers.filter((p) => Boolean(p.capability?.models.length)),
    [peers]
  );
  const onlinePeers = useMemo(
    () => peers.filter((p) => p.status === 'authenticated' || p.status === 'connected'),
    [peers]
  );
  // Wiring W7 — bumped on every fleet.saga.update event so we re-fetch
  // sagas reactively instead of waiting for the 3s polling cycle.
  const sagaUpdateToken = useAppStore((s) => s.fleetSagaUpdateToken);

  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [selectedSagaId, setSelectedSagaId] = useState<string | null>(null);
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<number | null>(null);
  const [goalText, setGoalText] = useState('');
  const [sagas, setSagas] = useState<SagaSummary[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduleTask[]>([]);
  const [scheduleLoadError, setScheduleLoadError] = useState<string | null>(null);
  const [runningScheduledTaskId, setRunningScheduledTaskId] = useState<string | null>(null);
  const [fleetActivities, setFleetActivities] = useState<ActivityEntry[]>([]);
  const [activityLoadError, setActivityLoadError] = useState<string | null>(null);
  const [fleetMemories, setFleetMemories] = useState<FleetMemoryEntry[]>([]);
  const [memoryLoadError, setMemoryLoadError] = useState<string | null>(null);
  const [memoryRefreshToken, setMemoryRefreshToken] = useState(0);
  const [skillCandidates, setSkillCandidates] = useState<SkillCandidateReviewQueueItem[]>([]);
  const [skillCandidateLoadError, setSkillCandidateLoadError] = useState<string | null>(null);
  const [skillCandidateRefreshToken, setSkillCandidateRefreshToken] = useState(0);
  const [includeMemoryContext, setIncludeMemoryContext] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [refreshingPeerId, setRefreshingPeerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispatchFeedback, setDispatchFeedback] = useState<FleetDispatchResult | null>(null);
  const [parallelism, setParallelism] = useState(1);
  const [council, setCouncil] = useState(false);
  const [privacyTag, setPrivacyTag] = useState<'public' | 'sensitive'>('public');
  const [dispatchProfile, setDispatchProfile] = useState<FleetDispatchProfile>('balanced');
  const [goalRunDraft, setGoalRunDraft] = useState<AgentRun | null>(null);
  // Store-backed so `/knowledge-graph` can open the lessons-vault graph via slash
  // (the FCC "browse" button still toggles the same flag).
  const showLessonsGraph = useAppStore((s) => s.showLessonsGraph);
  const setShowLessonsGraph = useAppStore((s) => s.setShowLessonsGraph);
  const runningSagas = useMemo(
    () => sagas.filter((s) => s.status === 'pending' || s.status === 'running').length,
    [sagas]
  );
  const selectedSaga = useMemo(
    () => sagas.find((saga) => saga.id === selectedSagaId) ?? null,
    [sagas, selectedSagaId]
  );
  const selectedOutcome = useMemo(
    () => fleetActivities.find((entry) => entry.id === selectedOutcomeId) ?? null,
    [fleetActivities, selectedOutcomeId]
  );
  const upcomingScheduledTasks = useMemo(
    () =>
      scheduledTasks
        .filter((task) => task.enabled && task.nextRunAt !== null)
        .sort((left, right) => {
          const fleetRank =
            Number(isFleetScheduledTask(right)) - Number(isFleetScheduledTask(left));
          if (fleetRank !== 0) return fleetRank;
          return (left.nextRunAt ?? 0) - (right.nextRunAt ?? 0);
        })
        .slice(0, 3),
    [scheduledTasks]
  );
  const recentFleetOutcomes = useMemo(
    () => fleetActivities.filter(isFleetTerminalActivity).slice(0, 3),
    [fleetActivities]
  );
  const recentFleetMemories = useMemo(
    () => fleetMemories.filter(isFleetOutcomeMemory).slice(-3).reverse(),
    [fleetMemories]
  );
  const activeWorkspaceCwd = useMemo(
    () =>
      sessions.find((session) => session.id === activeSessionId)?.cwd ?? workingDir ?? undefined,
    [activeSessionId, sessions, workingDir]
  );
  const goalRunPreview = useMemo(
    () => (goalRunDraft ? buildAgentRunDraftPreview(goalRunDraft, t) : null),
    [goalRunDraft, t]
  );
  const refreshingPeers = refreshingPeerId !== null;
  const readiness = getFleetReadiness(peers.length, onlinePeers.length, routablePeers.length);

  useEffect(() => {
    if (!isOpen || !fleetGoalDraft?.goal.trim()) return;
    setGoalText(fleetGoalDraft.goal);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
    if (fleetGoalDraft.dispatchProfile) {
      setDispatchProfile(fleetGoalDraft.dispatchProfile);
    }
    if (fleetGoalDraft.privacyTag) {
      setPrivacyTag(fleetGoalDraft.privacyTag);
    }
    setFleetGoalDraft(null);
  }, [fleetGoalDraft, isOpen, setFleetGoalDraft]);

  const loadFleetActivities = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const list = await getActivityApi()?.recent?.(60);
      if (!isCancelled() && list) {
        setFleetActivities(list.filter(isFleetActivity));
        setActivityLoadError(null);
      }
    } catch (err) {
      if (!isCancelled()) {
        setActivityLoadError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  // ESC closes
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadPeers = async () => {
      try {
        const list = await getFleetApi()?.list?.();
        if (!cancelled && list) setFleetPeers(list);
      } catch {
        /* snapshot refresh is opportunistic */
      }
    };
    void loadPeers();
    return () => {
      cancelled = true;
    };
  }, [isOpen, setFleetPeers]);

  // Refresh sagas every 3s while open.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const api = (
          window as unknown as {
            electronAPI?: {
              fleet?: { listSagas?: () => Promise<SagaSummary[]> };
            };
          }
        ).electronAPI;
        if (!api?.fleet?.listSagas) return;
        const list = await api.fleet.listSagas();
        if (!cancelled) setSagas(list);
      } catch {
        /* polish feature */
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOpen, sagaUpdateToken]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadScheduledWork = async () => {
      try {
        const list = await getScheduleApi()?.list?.();
        if (!cancelled && list) {
          setScheduledTasks(list);
          setScheduleLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setScheduleLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void loadScheduledWork();
    const id = setInterval(loadScheduledWork, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void loadFleetActivities(() => cancelled);
    const id = setInterval(() => void loadFleetActivities(() => cancelled), 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOpen, sagaUpdateToken, loadFleetActivities]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadFleetMemories = async () => {
      try {
        const list = await getMemoryApi()?.list?.();
        if (!cancelled && list) {
          setFleetMemories(list);
          setMemoryLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setMemoryLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void loadFleetMemories();
    const id = setInterval(loadFleetMemories, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOpen, memoryRefreshToken]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadSkillCandidates = async () => {
      try {
        const list = await getSkillCandidateApi()?.list?.({
          cwd: activeWorkspaceCwd,
          eligibleOnly: true,
          limit: 6,
        });
        if (!cancelled && list) {
          setSkillCandidates(list);
          setSkillCandidateLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSkillCandidateLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void loadSkillCandidates();
    const id = setInterval(loadSkillCandidates, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeWorkspaceCwd, isOpen, skillCandidateRefreshToken]);

  const handleRefreshPeers = async (peerId?: string) => {
    if (refreshingPeerId) return;
    setRefreshingPeerId(peerId ?? 'all');
    setError(null);
    try {
      const api = getFleetApi();
      if (!api) {
        setError(t('fleet.bridgeUnavailable', 'Fleet IPC bridge unavailable'));
        return;
      }

      if (api.refreshCapabilities) {
        const result = await api.refreshCapabilities(peerId);
        if (!result.success) {
          setError(result.error ?? 'capability refresh failed');
          return;
        }
        if (result.peers) setFleetPeers(result.peers);
        if (result.peer) upsertFleetPeer(result.peer);
        return;
      }

      const list = await api.list?.();
      if (list) setFleetPeers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingPeerId(null);
    }
  };

  const handleDispatch = async () => {
    if (!goalText.trim() || dispatching || routablePeers.length === 0) return;
    setDispatching(true);
    setError(null);
    setDispatchFeedback(null);
    try {
      const api = (
        window as unknown as {
          electronAPI?: {
            fleet?: {
              dispatch?: (input: FleetDispatchRequest) => Promise<FleetDispatchResult>;
            };
          };
        }
      ).electronAPI;
      if (!api?.fleet?.dispatch) {
        setError(t('fleet.bridgeUnavailable', 'Fleet IPC bridge unavailable'));
        return;
      }
      const trimmedGoal = goalText.trim();
      const dispatchMemories =
        includeMemoryContext && recentFleetMemories.length > 0 ? recentFleetMemories : [];
      const dispatchGoal = buildFleetDispatchGoalContext(
        trimmedGoal,
        dispatchProfile,
        dispatchMemories,
        t
      );
      const dispatchPeerTargets = routablePeers.map((peer) => ({
        id: peer.id,
        label: peer.label?.trim() || peer.capability?.machineLabel?.trim() || shortId(peer.id),
      }));
      // Council needs ≥2 lanes to deliberate; force it so the toggle
      // works even if the parallelism input was left at 1.
      const effectiveParallelism = council ? Math.max(2, parallelism) : parallelism;
      const result = await api.fleet.dispatch({
        goal: dispatchGoal,
        parallelism: effectiveParallelism > 1 ? effectiveParallelism : undefined,
        privacyTag,
        dispatchProfile,
        ...(council ? { council: true } : {}),
        targetPeerIds: dispatchPeerTargets.map((peer) => peer.id),
        targetPeerLabels: dispatchPeerTargets.map((peer) => peer.label),
        ...buildDispatchRunMetadata(goalRunDraft),
      });
      if (!result.ok) {
        setError(result.error ?? 'dispatch failed');
        return;
      }
      setDispatchFeedback(result);
      if (result.sagaId) {
        setSelectedSagaId(result.sagaId);
        setSelectedPeerId(null);
        setSelectedOutcomeId(null);
      }
      setGoalText('');
      setGoalRunDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDispatching(false);
    }
  };

  const handleRunScheduledTaskNow = async (taskId: string) => {
    if (runningScheduledTaskId) return;
    setRunningScheduledTaskId(taskId);
    setScheduleLoadError(null);
    const api = getScheduleApi();
    const refreshRunNowContext = async () => {
      const list = await api?.list?.();
      if (list) {
        setScheduledTasks(list);
      }
      await loadFleetActivities();
    };
    try {
      if (!api?.runNow) {
        setScheduleLoadError(
          t('fleet.scheduledWork.runNowUnavailable', 'Schedule IPC bridge unavailable')
        );
        return;
      }
      const updated = await api.runNow(taskId);
      if (updated) {
        setScheduledTasks((tasks) =>
          tasks.map((task) => (task.id === updated.id ? updated : task))
        );
        if (isFleetScheduledTask(updated) && updated.lastRunSessionId) {
          setSelectedSagaId(updated.lastRunSessionId);
          setSelectedPeerId(null);
          setSelectedOutcomeId(null);
        }
      }
      await refreshRunNowContext();
    } catch (err) {
      setScheduleLoadError(err instanceof Error ? err.message : String(err));
      try {
        await refreshRunNowContext();
      } catch {
        /* best effort after failed scheduled run */
      }
    } finally {
      setRunningScheduledTaskId(null);
    }
  };

  const handleOpenScheduleSettings = () => {
    setSettingsTab('schedule');
    setShowSettings(true);
    onClose();
  };

  const handleOpenApiSettings = () => {
    setSettingsTab('api');
    setShowSettings(true);
    onClose();
  };

  const scheduleDispatchGoal = (rawGoal: string, metadataExtras: Record<string, unknown> = {}) => {
    const trimmedGoal = rawGoal.trim();
    if (!trimmedGoal) return;
    const scheduleMemories =
      includeMemoryContext && recentFleetMemories.length > 0 ? recentFleetMemories : [];
    const dispatchGoal = buildFleetDispatchGoalContext(
      trimmedGoal,
      dispatchProfile,
      scheduleMemories,
      t
    );
    const internetProofPlan = buildFleetInternetProofPlan(dispatchGoal);
    const internetProofMetadata = buildInternetProofSummaryMetadata(
      summarizeInternetProofPlan(internetProofPlan)
    );
    const scheduledPeerTargets = routablePeers.map((peer) => ({
      id: peer.id,
      label: peer.label?.trim() || peer.capability?.machineLabel?.trim() || shortId(peer.id),
    }));
    const inheritedRunMetadata = buildInheritedRunMetadata(goalRunDraft);
    setScheduleDraft(
      buildFleetScheduledDispatchDraft({
        dispatchGoal,
        dispatchProfile,
        privacyTag,
        parallelism,
        t,
        targetPeerIds: scheduledPeerTargets.map((peer) => peer.id),
        targetPeerLabels: scheduledPeerTargets.map((peer) => peer.label),
        deliveryChannel: 'cowork-schedule',
        includeMemoryContext: scheduleMemories.length > 0,
        memoryCount: scheduleMemories.length,
        proofMetadata: internetProofMetadata,
        metadataExtras: {
          ...inheritedRunMetadata,
          ...metadataExtras,
        },
      })
    );
    handleOpenScheduleSettings();
  };

  const handleScheduleDispatch = () => {
    scheduleDispatchGoal(goalText);
  };

  const handleUseOutcomeAsGoal = (entry: ActivityEntry, draft: string, run: AgentRun) => {
    const outcomePreset = buildFleetOutcomeDispatchPreset(entry);
    setGoalText(draft);
    setGoalRunDraft(run);
    setDispatchFeedback(null);
    setError(null);
    if (outcomePreset.privacyTag) {
      setPrivacyTag(outcomePreset.privacyTag);
    }
    if (outcomePreset.dispatchProfile) {
      setDispatchProfile(outcomePreset.dispatchProfile);
    }
  };

  const handleUseHermesPlanAsGoal = (draft: string) => {
    setGoalText(draft);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
  };

  const handleScheduleHermesPlan = (draft: string) => {
    setGoalText(draft);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
    scheduleDispatchGoal(draft, {
      hermesPlanId: 'hermes-integration-plan',
      hermesPlanSurface: 'cowork',
      hermesPlanProfile: dispatchProfile,
    });
  };

  const handleUseLeadDiscoveryWorkflowAsGoal = (draft: string) => {
    setGoalText(draft);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
    setDispatchProfile('research');
    setPrivacyTag('public');
  };

  const handleUseSkillCandidateReviewAsGoal = (draft: string) => {
    setGoalText(draft);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
    setDispatchProfile('research');
    setPrivacyTag('public');
  };

  const handleUseLessonsVaultAsGoal = (draft: string) => {
    setGoalText(draft);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
    setDispatchProfile('review');
    setPrivacyTag('public');
  };

  const handleScheduleLeadDiscoveryWorkflow = (
    draft: string,
    metadata: LeadDiscoveryWorkflowScheduleMetadata
  ) => {
    setGoalText(draft);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
    setDispatchProfile('research');
    setPrivacyTag('public');
    scheduleDispatchGoal(draft, metadata);
  };

  const handleUseBrowserOperatorDraftAsGoal = (draft: string) => {
    setGoalText(draft);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
    setDispatchProfile('research');
    setPrivacyTag('public');
  };

  const handleScheduleBrowserOperatorDraft = (
    draft: string,
    metadata: BrowserOperatorScheduleMetadata
  ) => {
    setGoalText(draft);
    setGoalRunDraft(null);
    setDispatchFeedback(null);
    setError(null);
    setDispatchProfile('research');
    setPrivacyTag('public');
    scheduleDispatchGoal(draft, metadata);
  };

  const dispatchDisabled = !goalText.trim() || dispatching || routablePeers.length === 0;

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/35 p-4 backdrop-blur-sm lg:p-6"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        data-testid="fleet-command-center"
      >
        <div
          className="w-full max-w-[1440px] bg-background border border-border rounded-[1.5rem] shadow-elevated flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted shrink-0">
            <div className="flex items-center gap-2">
              <Network size={14} className="text-accent" />
              <h2 className="text-sm font-medium text-text-primary">
                {t('fleet.title', 'Fleet Command Center')}
              </h2>
              <span className="text-[10px] text-text-muted ml-2">
                {peers.length} {t('fleet.peers', 'peers')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRefreshPeers()}
                disabled={refreshingPeers}
                className="text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
                aria-label={t('fleet.refreshCapabilities', 'Refresh peer capabilities')}
                title={t('fleet.refreshCapabilities', 'Refresh peer capabilities')}
              >
                {refreshingPeers ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
              </button>
              <button
                onClick={onClose}
                className="text-text-muted hover:text-text-primary transition-colors"
                aria-label={t('common.close', 'Close')}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.9fr)_minmax(430px,1.2fr)_minmax(300px,0.95fr)]">
            {/* Left — peer list */}
            <div className="min-w-0 border-r border-border-muted overflow-y-auto">
              <div className="sticky top-0 border-b border-border-muted bg-background/95 px-4 py-2 text-[10px] uppercase tracking-wider text-text-muted">
                {t('fleet.peerList', 'Peers')}
              </div>
              {peers.length === 0 ? (
                <div className="p-6 text-xs text-text-muted text-center">
                  {t(
                    'fleet.noPeers',
                    'Aucun peer configuré. Utilise Settings → A2A pour en ajouter, ou démarre un Code Buddy avec --serve sur le tailnet.'
                  )}
                </div>
              ) : (
                <ul>
                  {peers.map((p) => (
                    <PeerRow
                      key={p.id}
                      peer={p}
                      selected={p.id === selectedPeerId}
                      onSelect={() => {
                        setSelectedPeerId(p.id);
                        setSelectedSagaId(null);
                        setSelectedOutcomeId(null);
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Center — dispatch + sagas */}
            <div className="min-w-0 flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-border-muted">
                <div
                  className={`mb-3 flex items-center justify-between gap-3 border-l-2 pl-3 py-2 ${readiness.borderClass}`}
                >
                  <div className="min-w-0">
                    <div className={`text-[11px] font-medium ${readiness.textClass}`}>
                      {t(readiness.titleKey, readiness.title)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-muted">
                      <span>
                        {routablePeers.length}/{peers.length} {t('fleet.routable', 'routable')}
                      </span>
                      <span>
                        {onlinePeers.length} {t('fleet.online', 'online')}
                      </span>
                      <span>
                        {runningSagas} {t('fleet.running', 'running')}
                      </span>
                    </div>
                  </div>
                  {readiness.action === 'refresh' && (
                    <button
                      type="button"
                      onClick={() => void handleRefreshPeers()}
                      disabled={refreshingPeers}
                      className="shrink-0 rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:border-accent/60 hover:text-text-primary disabled:opacity-50"
                    >
                      {refreshingPeers
                        ? t('fleet.refreshing', 'Refreshing')
                        : t('fleet.refresh', 'Refresh')}
                    </button>
                  )}
                </div>
                <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
                  {t('fleet.dispatchGoal', 'Dispatch a goal to the fleet')}
                </label>
                <textarea
                  value={goalText}
                  onChange={(e) => {
                    setGoalText(e.target.value);
                    setGoalRunDraft(null);
                  }}
                  data-testid="fleet-command-goal-input"
                  placeholder={t(
                    'fleet.goalPlaceholder',
                    'Décris ton objectif… le router choisira le meilleur peer × modèle (Cmd+Enter pour lancer)'
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void handleDispatch();
                    }
                  }}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                {goalRunPreview && (
                  <div
                    className="mt-2 rounded border border-accent/30 bg-accent/10 p-2"
                    data-testid="fleet-agent-run-draft-preview"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-medium text-accent">
                        {goalRunPreview.title}
                      </div>
                      <div className="shrink-0 font-mono text-[10px] text-text-secondary">
                        {shortId(goalRunPreview.runId)}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {goalRunPreview.chips.map((chip) => (
                        <span
                          key={chip}
                          className="rounded border border-border bg-surface/70 px-1.5 py-0.5 text-[10px] text-text-secondary"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 text-[10px] leading-relaxed text-text-secondary">
                      {goalRunPreview.promptPreview}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <label className="text-[10px] text-text-muted">
                    {t('fleet.parallelism', 'Parallel')}:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={parallelism}
                    data-testid="fleet-command-parallelism-input"
                    onChange={(e) =>
                      setParallelism(Math.max(1, Math.min(5, Number(e.target.value) || 1)))
                    }
                    className="w-12 rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-text-primary focus:border-accent focus:outline-none"
                  />
                  <label className="text-[10px] text-text-muted ml-2">
                    {t('fleet.privacy', 'Privacy')}:
                  </label>
                  <select
                    value={privacyTag}
                    onChange={(e) => setPrivacyTag(e.target.value as 'public' | 'sensitive')}
                    data-testid="fleet-command-privacy-select"
                    className="rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-text-primary focus:border-accent focus:outline-none"
                  >
                    <option value="public">{t('fleet.privacyPublic', 'public')}</option>
                    <option value="sensitive">
                      {t('fleet.privacySensitive', 'sensitive (no cloud)')}
                    </option>
                  </select>
                  <label className="text-[10px] text-text-muted ml-2">
                    {t('fleet.dispatchProfile', 'Profile')}:
                  </label>
                  <select
                    value={dispatchProfile}
                    onChange={(e) => setDispatchProfile(e.target.value as FleetDispatchProfile)}
                    data-testid="fleet-command-profile-select"
                    className="rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-text-primary focus:border-accent focus:outline-none"
                  >
                    {FLEET_DISPATCH_PROFILES.map((profile) => (
                      <option key={profile} value={profile}>
                        {t(FLEET_DISPATCH_PROFILE_LABEL_KEYS[profile], profile)}
                      </option>
                    ))}
                  </select>
                  <label
                    className="ml-2 flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer select-none"
                    title={t(
                      'fleet.councilHint',
                      'Ask the same question to ≥2 peers, then score their agreement and surface divergences. LLM arbitration of the final answer runs when an aggregator client is wired; otherwise the answers are concatenated.'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={council}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setCouncil(next);
                        if (next && parallelism < 2) setParallelism(2);
                      }}
                      className="h-3 w-3 accent-accent"
                    />
                    {t('fleet.council', 'Council')}
                  </label>
                  <button
                    type="button"
                    onClick={handleScheduleDispatch}
                    disabled={!goalText.trim()}
                    data-testid="fleet-command-schedule-button"
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent/60 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CalendarPlus size={11} />
                    {t('fleet.scheduleDispatch', 'Schedule')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDispatch()}
                    disabled={dispatchDisabled}
                    data-testid="fleet-command-dispatch-button"
                    className="ml-auto flex items-center gap-1 px-3 py-1 text-xs rounded bg-accent text-background hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {dispatching ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Send size={11} />
                    )}
                    {t('fleet.dispatch', 'Dispatch')}
                  </button>
                </div>
                {error && (
                  <div className="mt-2 p-2 bg-error/10 border border-error/30 rounded text-error text-[11px] flex items-start gap-1.5">
                    <AlertCircle size={11} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                {!error && dispatchFeedback?.sagaId && (
                  <div
                    className="mt-2 rounded border border-success/30 bg-success/10 p-2 text-[11px] text-success"
                    data-testid="fleet-command-dispatch-feedback"
                  >
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 size={11} className="shrink-0" />
                      <span className="min-w-0 truncate">
                        {t('fleet.sagaStarted', 'Saga {{id}} started · privacy {{privacy}}', {
                          id: shortId(dispatchFeedback.sagaId),
                          privacy: dispatchFeedback.privacyTag ?? privacyTag,
                        })}
                      </span>
                    </div>
                    {dispatchFeedback.lintWarning && (
                      <div className="mt-1 text-warning">{dispatchFeedback.lintWarning}</div>
                    )}
                  </div>
                )}
                <ToolProfileInspectorStrip profile={dispatchProfile} />
                <HermesToolsetsStrip profile={dispatchProfile} />
                <HermesProviderReadinessStrip onOpenSettings={handleOpenApiSettings} />
                <HermesRuntimeBackendsStrip />
                <HermesBrowserBackendsStrip />
                <HermesPlanStrip
                  profile={dispatchProfile}
                  onUseAsGoal={handleUseHermesPlanAsGoal}
                  onScheduleGoal={handleScheduleHermesPlan}
                />
                <HermesToolCatalogStrip />
                <LessonsVaultStrip
                  cwd={activeWorkspaceCwd}
                  onBrowse={() => setShowLessonsGraph(true)}
                  onUseAsGoal={handleUseLessonsVaultAsGoal}
                />
                <LessonCandidateReviewStrip
                  onOpenReview={() => setShowLessonCandidatePanel(true)}
                />
                <SkillPackageManagerStrip
                  cwd={activeWorkspaceCwd}
                  onUseAsGoal={handleUseSkillCandidateReviewAsGoal}
                />
                <LearningSkillUsageStrip cwd={activeWorkspaceCwd} />
                <SkillCandidateReviewQueueStrip
                  candidates={skillCandidates}
                  cwd={activeWorkspaceCwd}
                  error={skillCandidateLoadError}
                  onInstalled={() => setSkillCandidateRefreshToken((value) => value + 1)}
                  onUseAsGoal={handleUseSkillCandidateReviewAsGoal}
                />
                {dispatchProfile === 'research' && (
                  <>
                    <LeadDiscoveryWorkflowStrip
                      goal={goalText}
                      onUseAsGoal={handleUseLeadDiscoveryWorkflowAsGoal}
                      onScheduleGoal={handleScheduleLeadDiscoveryWorkflow}
                    />
                    <BrowserOperatorDraftStrip
                      goal={goalText}
                      onUseAsGoal={handleUseBrowserOperatorDraftAsGoal}
                      onScheduleGoal={handleScheduleBrowserOperatorDraft}
                    />
                  </>
                )}
                <ScheduledWorkStrip
                  tasks={scheduledTasks}
                  upcomingTasks={upcomingScheduledTasks}
                  error={scheduleLoadError}
                  runningTaskId={runningScheduledTaskId}
                  onRunNow={(taskId) => void handleRunScheduledTaskNow(taskId)}
                  onOpenSettings={handleOpenScheduleSettings}
                />
                <FleetMemoryStrip
                  memories={recentFleetMemories}
                  error={memoryLoadError}
                  includeMemoryContext={includeMemoryContext}
                  onToggleInclude={setIncludeMemoryContext}
                />
                <FleetOutcomeStrip
                  entries={recentFleetOutcomes}
                  error={activityLoadError}
                  selectedEntryId={selectedOutcomeId}
                  onSelectOutcome={(entryId) => {
                    setSelectedOutcomeId(entryId);
                    setSelectedSagaId(null);
                    setSelectedPeerId(null);
                  }}
                />
              </div>

              <SagaBoard
                sagas={sagas}
                selectedSagaId={selectedSagaId}
                onSelectSaga={(sagaId) => {
                  setSelectedSagaId(sagaId);
                  setSelectedPeerId(null);
                  setSelectedOutcomeId(null);
                }}
              />
            </div>

            {/* Right — peer or saga detail */}
            <div className="min-w-0 border-l border-border-muted overflow-y-auto">
              <div className="sticky top-0 border-b border-border-muted bg-background/95 px-4 py-2 text-[10px] uppercase tracking-wider text-text-muted">
                {selectedSaga
                  ? t('fleet.sagaDetail', 'Saga detail')
                  : selectedOutcome
                    ? t('fleet.outcomeDetail', 'Fleet outcome')
                    : t('fleet.peerDetail', 'Peer detail')}
              </div>
              {selectedSaga ? (
                <SagaDetail saga={selectedSaga} peersById={fleetPeers} />
              ) : selectedOutcome ? (
                <FleetOutcomeDetail
                  entry={selectedOutcome}
                  onUseAsGoal={handleUseOutcomeAsGoal}
                  onMemorySaved={() => setMemoryRefreshToken((token) => token + 1)}
                />
              ) : !selectedPeerId ? (
                <div className="p-6 text-xs text-text-muted text-center">
                  {t(
                    'fleet.selectPeerHint',
                    'Sélectionne un peer ou une saga pour inspecter les détails.'
                  )}
                </div>
              ) : (
                <PeerDetail
                  peer={fleetPeers[selectedPeerId]}
                  onRefreshCapabilities={(peerId) => void handleRefreshPeers(peerId)}
                  refreshing={refreshingPeerId === 'all' || refreshingPeerId === selectedPeerId}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      {showLessonsGraph && <LessonsVaultGraph onClose={() => setShowLessonsGraph(false)} />}
    </>
  );
};

function getFleetReadiness(
  totalPeers: number,
  onlinePeers: number,
  routablePeers: number
): {
  action: 'none' | 'refresh';
  borderClass: string;
  textClass: string;
  title: string;
  titleKey: string;
} {
  if (totalPeers === 0) {
    return {
      action: 'none',
      borderClass: 'border-border',
      textClass: 'text-text-secondary',
      title: 'No peers configured',
      titleKey: 'fleet.readiness.none',
    };
  }
  if (routablePeers === 0) {
    return {
      action: 'refresh',
      borderClass: 'border-warning/70',
      textClass: 'text-warning',
      title: onlinePeers > 0 ? 'Waiting for capabilities' : 'Peers offline',
      titleKey: onlinePeers > 0 ? 'fleet.readiness.waiting' : 'fleet.readiness.offline',
    };
  }
  return {
    action: 'none',
    borderClass: 'border-success/70',
    textClass: 'text-success',
    title: 'Ready to dispatch',
    titleKey: 'fleet.readiness.ready',
  };
}
