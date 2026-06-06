import { ipcMain } from 'electron';
import { log, logError, logWarn } from '../utils/logger';
import type { FleetBridge } from '../fleet/fleet-bridge';
import { loadCoreModule } from '../utils/core-loader';
import { SagaRunner } from '../fleet/saga-runner';
import { sendToRenderer } from '../ipc-main-bridge';
import type { ActivityFeed } from '../activity/activity-feed';
import { resolveWorkDir, type ProjectManagerSource } from './ipc-workdir';
import {
  buildMissionControlSnapshot,
  type CoreProofLedgerModuleLike,
  type CoreRunStoreLike,
  type CoreRunSummaryLike,
  type MissionControlDiscoveredPeer,
  type MissionControlSnapshot,
  type SagaSummaryLike,
} from '../fleet/mission-control-snapshot';
import {
  buildFleetInternetProofPlan,
  buildInternetProofSummaryMetadata,
  summarizeInternetProofPlan,
  type InternetProofPlanBuilder,
} from '../../shared/internet-proof-metadata';

const FLEET_DISPATCH_PROFILES = ['balanced', 'research', 'code', 'review', 'safe'] as const;
export type FleetDispatchProfile = (typeof FLEET_DISPATCH_PROFILES)[number];
type FleetBridgeSource = FleetBridge | null | (() => FleetBridge | null);
type ActivityFeedSource = ActivityFeed | null | (() => ActivityFeed | null);
export interface FleetDispatchInput {
  goal: string;
  parallelism?: number;
  privacyTag?: 'public' | 'sensitive';
  dispatchProfile?: FleetDispatchProfile;
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
  maxCostUsd?: number;
  estimatedCostUsd?: number;
  targetPeerIds?: string[];
  targetPeerLabels?: string[];
  /**
   * Hermes-style sequential chain. When set, the dispatch builds one
   * lane per role (in order) using `planChainDispatch` instead of the
   * standard parallel/sequential plan. Common pattern:
   *   `['code', 'review', 'safe']` → Draft → Review → Test.
   * Mutually exclusive with `parallelism`.
   */
  chainRoles?: string[];
  /**
   * Council mode — fan the same goal out to ≥2 peers, then arbitrate
   * with the consensus aggregator (cross-critique + agreement score)
   * instead of the plain synthesis. Forces `parallelism ≥ 2` and tags
   * the saga `metadata.aggregation = 'consensus'`. Ignored when
   * `chainRoles` is set (chain takes precedence).
   */
  council?: boolean;
}

export interface FleetDispatchResult {
  ok: boolean;
  sagaId?: string;
  error?: string;
  privacyTag?: 'public' | 'sensitive';
  dispatchProfile?: FleetDispatchProfile;
  lintWarning?: string;
}

export interface FleetSagaRunnerLike {
  start(sagaId: string): void;
}

export interface FleetDispatchDependencies {
  fleetBridge: FleetBridge | null;
  sagaRunner: FleetSagaRunnerLike | null;
  activityFeed?: ActivityFeed | null;
}

function isFleetDispatchProfile(value: unknown): value is FleetDispatchProfile {
  return typeof value === 'string' && FLEET_DISPATCH_PROFILES.includes(value as FleetDispatchProfile);
}

export function registerFleetIpcHandlers(
  fleetBridgeSource: FleetBridgeSource,
  activityFeedSource: ActivityFeedSource = null,
  // B1 — resolves the active project's workDir so a finished council saga can
  // auto-propose a review lesson into that project's `.codebuddy/`. Optional:
  // omitted (null) → SagaRunner skips the auto-propose.
  projectManagerSource: ProjectManagerSource = null,
) {
  let sagaRunner:
    | {
        bridge: FleetBridge;
        activityFeed: ActivityFeed | null;
        runner: SagaRunner;
      }
    | null = null;
  const getFleetBridge = () => resolveSource(fleetBridgeSource);
  const getActivityFeed = () => resolveSource(activityFeedSource);
  const getSagaRunner = () => {
    const bridge = getFleetBridge();
    if (!bridge) return null;
    const currentActivityFeed = getActivityFeed();
    if (
      !sagaRunner ||
      sagaRunner.bridge !== bridge ||
      sagaRunner.activityFeed !== currentActivityFeed
    ) {
      sagaRunner = {
        bridge,
        activityFeed: currentActivityFeed,
        runner: new SagaRunner(
          bridge,
          sendToRenderer,
          currentActivityFeed,
          () => resolveWorkDir(projectManagerSource),
        ),
      };
    }
    return sagaRunner.runner;
  };

  ipcMain.handle('fleet.list', async () => {
    const fleetBridge = getFleetBridge();
    if (!fleetBridge) return [];
    return fleetBridge.listPeers();
  });

  ipcMain.handle(
    'fleet.addPeer',
    async (
      _event,
      input: { url: string; apiKey?: string; jwt?: string; label?: string }
    ) => {
      const fleetBridge = getFleetBridge();
      if (!fleetBridge) return { success: false, error: 'FleetBridge not initialized' };
      return fleetBridge.addPeer(input);
    }
  );

  ipcMain.handle('fleet.removePeer', async (_event, peerId: string) => {
    const fleetBridge = getFleetBridge();
    if (!fleetBridge) return { success: false };
    return fleetBridge.removePeer(peerId);
  });

  ipcMain.handle('fleet.reconnect', async (_event, peerId: string) => {
    const fleetBridge = getFleetBridge();
    if (!fleetBridge) return { success: false, error: 'FleetBridge not initialized' };
    return fleetBridge.reconnectPeer(peerId);
  });

  ipcMain.handle('fleet.refreshCapabilities', async (_event, peerId?: string) => {
    const fleetBridge = getFleetBridge();
    if (!fleetBridge) return { success: false, error: 'FleetBridge not initialized' };
    return fleetBridge.refreshCapabilities(peerId);
  });

  ipcMain.handle(
    'fleet.events',
    async (_event, peerId?: string, limit?: number) => {
      const fleetBridge = getFleetBridge();
      if (!fleetBridge) return [];
      return fleetBridge.getRecentEvents(peerId, limit);
    }
  );

  // ── Fleet dispatch (Wiring W1+W3+W4+W5) ─────────────────────────
  //
  // 1. Privacy lint pre-dispatch (W4) — auto-bumps privacyTag to
  //    'sensitive' if the goal contains secrets.
  // 2. Cost cap pre-dispatch (W5) — refuses if today's spend or this
  //    saga's accumulated spend would exceed the configured caps.
  // 3. Build DispatchPlan via TaskRouter, persist saga via SagaStore.
  // 4. Hand off to SagaRunner (W1) which fires peer.dispatch, polls
  //    peer.dispatchStatus, updates step status, and finalises the
  //    saga via the result aggregator (W3).
  ipcMain.handle(
    'fleet.dispatch',
    async (
      _event,
      input: FleetDispatchInput,
    ) => {
      return dispatchFleetSaga(input, {
        fleetBridge: getFleetBridge(),
        sagaRunner: getSagaRunner(),
        activityFeed: getActivityFeed(),
      });
    },
  );

  // (W6) Manual + auto discovery handler — returns peers detected on
  // the Tailscale tailnet and via the manual YAML fallback that aren't
  // already paired in the FleetBridge.
  ipcMain.handle('fleet.discoverPeers', async () => {
    const fleetBridge = getFleetBridge();
    if (!fleetBridge) return { ok: false, error: 'FleetBridge not initialized', peers: [] };
    try {
      const { discoverPeers } = await import('../fleet/discovery');
      const all = await discoverPeers();
      const known = new Set(
        (await Promise.resolve(fleetBridge.listPeers())).map((p) => p.url),
      );
      const fresh = all.filter((p) => !known.has(p.url));
      return { ok: true, peers: fresh, total: all.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[fleet.discoverPeers] failed:', message);
      return { ok: false, error: message, peers: [] };
    }
  });

  ipcMain.handle('fleet.listSagas', async () => {
    try {
      type SagaMod = {
        getSagaStore: () => { list: () => Promise<unknown[]> };
      };
      const sagaMod = await loadCoreModule<SagaMod>('fleet/saga-store.js');
      if (!sagaMod) return [];
      return await sagaMod.getSagaStore().list();
    } catch (err) {
      logError('[fleet.listSagas] failed:', err);
      return [];
    }
  });

  ipcMain.handle('fleet.missionControlSnapshot', async (): Promise<MissionControlSnapshot> => {
    try {
      const fleetBridge = getFleetBridge();
      const peers = fleetBridge ? await Promise.resolve(fleetBridge.listPeers()) : [];
      const discoveredPeers = await loadMissionControlDiscoveredPeers(peers);
      const { proofLedger, runs, runStore } = await loadMissionControlRuns();
      const sagas = await loadMissionControlSagas();
      return buildMissionControlSnapshot({
        discoveredPeers,
        peers,
        proofLedger,
        runs,
        runStore,
        sagas,
      });
    } catch (err) {
      logError('[fleet.missionControlSnapshot] failed:', err);
      return buildMissionControlSnapshot({ peers: [] });
    }
  });
}

async function loadMissionControlDiscoveredPeers(
  peers: Array<{ url?: string }>,
): Promise<MissionControlDiscoveredPeer[]> {
  try {
    const { discoverPeers } = await import('../fleet/discovery');
    const knownUrls = new Set(peers.map((peer) => peer.url).filter(Boolean));
    const discovered = await discoverPeers();
    return discovered
      .filter((peer) => peer.url && !knownUrls.has(peer.url))
      .map((peer) => ({
        label: peer.label,
        source: peer.source,
        url: peer.url,
      }));
  } catch (err) {
    logWarn('[fleet.missionControlSnapshot] peer discovery unavailable:', err);
    return [];
  }
}

async function loadMissionControlRuns(): Promise<{
  proofLedger: CoreProofLedgerModuleLike | null;
  runs: CoreRunSummaryLike[];
  runStore: CoreRunStoreLike | null;
}> {
  try {
    type RunStoreMod = {
      RunStore?: {
        getInstance?: () => CoreRunStoreLike;
      };
    };
    const runStoreMod = await loadCoreModule<RunStoreMod>('observability/run-store.js');
    const runStore = runStoreMod?.RunStore?.getInstance?.() ?? null;
    if (!runStore) {
      return { proofLedger: null, runs: [], runStore: null };
    }
    let proofLedger: CoreProofLedgerModuleLike | null = null;
    try {
      proofLedger = await loadCoreModule<CoreProofLedgerModuleLike>('observability/proof-ledger.js');
    } catch (err) {
      logWarn('[fleet.missionControlSnapshot] proof ledger unavailable:', err);
    }
    return {
      proofLedger,
      runs: runStore.listRuns(25),
      runStore,
    };
  } catch (err) {
    logWarn('[fleet.missionControlSnapshot] run store unavailable:', err);
    return { proofLedger: null, runs: [], runStore: null };
  }
}

async function loadMissionControlSagas(): Promise<SagaSummaryLike[]> {
  try {
    type SagaMod = {
      getSagaStore: () => { list: () => Promise<SagaSummaryLike[]> | SagaSummaryLike[] };
    };
    const sagaMod = await loadCoreModule<SagaMod>('fleet/saga-store.js');
    if (!sagaMod) return [];
    return await Promise.resolve(sagaMod.getSagaStore().list());
  } catch (err) {
    logWarn('[fleet.missionControlSnapshot] saga store unavailable:', err);
    return [];
  }
}

export async function dispatchFleetSaga(
  input: FleetDispatchInput,
  dependencies: FleetDispatchDependencies,
): Promise<FleetDispatchResult> {
  const { fleetBridge, sagaRunner, activityFeed = null } = dependencies;
  if (!fleetBridge || !sagaRunner) {
    return { ok: false, error: 'FleetBridge not initialized' };
  }
  if (
    input.dispatchProfile !== undefined &&
    !isFleetDispatchProfile(input.dispatchProfile)
  ) {
    return {
      ok: false,
      error: `dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}`,
    };
  }
  const targetPeerIds = normalizeStringList(input.targetPeerIds);
  const targetPeerLabels = normalizeStringList(input.targetPeerLabels);
  const runLineageMetadata = buildDispatchRunLineageMetadata(input, targetPeerLabels);
  try {
    type ClassificationLike = Record<string, unknown>;
    type RouterMod = {
      TaskRouter: new () => {
        plan: (
          cls: ClassificationLike,
          peers: Array<{ peerId: string; capability: unknown }>,
          constraints?: unknown,
        ) => unknown;
      };
      planChainDispatch?: (
        cls: ClassificationLike,
        peers: Array<{ peerId: string; capability: unknown }>,
        opts: { chainRoles: string[]; constraints?: unknown },
      ) => unknown;
    };
    type ClsMod = {
      classifyTaskComplexity: (msg: string) => ClassificationLike;
    };
    type SagaMod = {
      getSagaStore: () => {
        create: (input: {
          goal: string;
          plan: unknown;
          metadata?: Record<string, unknown>;
        }) => Promise<{ id: string }>;
      };
      /**
       * Phase F (Hermes self-improving loop) — present on core SagaStore
       * since commit > 97633bc7. Older cores return `undefined` and the
       * dispatch path falls through to the bare goal.
       */
      loadRelevantSagaLessons?: (
        query: string,
        opts?: { limit?: number },
      ) => Promise<string[]>;
    };
    type LintMod = {
      scanForSecrets: (
        prompt: string,
      ) => { hasSecrets: boolean; highConfidence: boolean; matches: unknown[] };
    };
    type CostMod = {
      getCostTracker: () => {
        canSpend: (
          estimated: number,
          sagaId: string | undefined,
        ) => Promise<{ ok: boolean; reason?: string; remainingUsd?: number }>;
      };
    };
    const [routerMod, clsMod, sagaMod, lintMod, costMod, proofPlanMod] = await Promise.all([
      loadCoreModule<RouterMod>('fleet/task-router.js'),
      loadCoreModule<ClsMod>('optimization/model-routing.js'),
      loadCoreModule<SagaMod>('fleet/saga-store.js'),
      loadCoreModule<LintMod>('fleet/privacy-lint.js'),
      loadCoreModule<CostMod>('fleet/cost-tracker.js'),
      loadCoreModule<InternetProofPlanBuilder>('browser-automation/internet-proof-plan.js'),
    ]);
    if (!routerMod || !clsMod || !sagaMod) {
      return { ok: false, error: 'core fleet modules unavailable' };
    }

    // (W4) Privacy lint — auto-bump to 'sensitive' if secrets detected
    // unless caller explicitly set 'public' (in which case we refuse).
    let effectivePrivacyTag = input.privacyTag;
    let lintWarning: string | undefined;
    if (lintMod) {
      const lint = lintMod.scanForSecrets(input.goal);
      if (lint.hasSecrets) {
        if (input.privacyTag === 'public') {
          return {
            ok: false,
            error: `Privacy lint blocked dispatch — secrets detected (${lint.matches.length} match(es)) but caller forced privacyTag='public'. Remove the secret or drop privacyTag.`,
          };
        }
        if (effectivePrivacyTag !== 'sensitive') {
          effectivePrivacyTag = 'sensitive';
          lintWarning = `auto-bumped to sensitive (${lint.matches.length} match(es))`;
          logWarn('[fleet.dispatch] privacy lint auto-bumped privacyTag', {
            matches: lint.matches.length,
            highConfidence: lint.highConfidence,
          });
        }
      }
    }

    // (W5) Cost cap pre-dispatch.
    if (costMod && typeof input.estimatedCostUsd === 'number') {
      const tracker = costMod.getCostTracker();
      const check = await tracker.canSpend(input.estimatedCostUsd, undefined);
      if (!check.ok) {
        return {
          ok: false,
          error: `Cost cap reached — ${check.reason ?? 'unknown reason'}`,
        };
      }
    }

    const peers = (await Promise.resolve(fleetBridge.listPeers())) as Array<
      { id: string; capability?: unknown }
    >;
    const peerSlots = peers
      .filter((p) => Boolean(p.capability))
      .map((p) => ({
        peerId: p.id,
        capability: p.capability as unknown,
      }));
    if (peerSlots.length === 0) {
      return {
        ok: false,
        error:
          'No peer with known capabilities — use the Command Center refresh button, then verify the peer key has both fleet:listen and peer:invoke scopes.',
      };
    }

    const classification = clsMod.classifyTaskComplexity(input.goal);
    const router = new routerMod.TaskRouter();
    const chainRoles = (input.chainRoles ?? [])
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    // Council mode needs ≥2 parallel lanes to deliberate. Chain takes
    // precedence (mutually exclusive), so council only applies when no
    // chainRoles were requested.
    const councilMode = input.council === true && chainRoles.length === 0;
    const effectiveParallelism = councilMode
      ? Math.max(2, input.parallelism ?? 2)
      : input.parallelism;
    let plan: unknown;
    if (chainRoles.length > 0) {
      // Hermes-style chain dispatch (Draft→Review→Test). Mutually
      // exclusive with parallelism — chain takes precedence.
      if (typeof routerMod.planChainDispatch !== 'function') {
        return {
          ok: false,
          error: 'core router missing planChainDispatch — upgrade Code Buddy',
        };
      }
      plan = routerMod.planChainDispatch(classification, peerSlots, {
        chainRoles,
        constraints: {
          privacyTag: effectivePrivacyTag,
          dispatchProfile: input.dispatchProfile,
          maxCostUsd: input.maxCostUsd,
          targetPeerIds: targetPeerIds.length > 0 ? targetPeerIds : undefined,
        },
      });
    } else {
      plan = router.plan(classification, peerSlots, {
        parallelism: effectiveParallelism,
        privacyTag: effectivePrivacyTag,
        dispatchProfile: input.dispatchProfile,
        maxCostUsd: input.maxCostUsd,
        targetPeerIds: targetPeerIds.length > 0 ? targetPeerIds : undefined,
      });
    }
    const internetProofPlan = buildFleetInternetProofPlan(input.goal, proofPlanMod, (err) => {
      logWarn('[fleet.dispatch] failed to build core internet proof plan', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const internetProofSummary = summarizeInternetProofPlan(internetProofPlan);

    // Phase F — recall recent saga lessons and prepend them so the
    // dispatched chain (or single saga) inherits what past fleet runs
    // learned about similar goals. Warning-only: any failure leaves
    // the bare goal untouched.
    let augmentedGoal = input.goal;
    let injectedLessonCount = 0;
    if (typeof sagaMod.loadRelevantSagaLessons === 'function') {
      try {
        const lessons = await sagaMod.loadRelevantSagaLessons(input.goal);
        if (lessons.length > 0) {
          augmentedGoal = `## Past fleet lessons\n${lessons.join(
            '\n',
          )}\n\n## Goal\n${input.goal}`;
          injectedLessonCount = lessons.length;
        }
      } catch (err) {
        logWarn('[fleet.dispatch] loadRelevantSagaLessons failed (ignored)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const saga = await sagaMod.getSagaStore().create({
      goal: augmentedGoal,
      plan,
      metadata: {
        privacyTag: effectivePrivacyTag,
        dispatchProfile: input.dispatchProfile ?? 'balanced',
        parallelism: effectiveParallelism,
        ...(councilMode ? { aggregation: 'consensus' as const } : {}),
        ...(input.hermesPlanId ? { hermesPlanId: input.hermesPlanId } : {}),
        ...(input.hermesPlanProfile ? { hermesPlanProfile: input.hermesPlanProfile } : {}),
        ...(input.hermesPlanSurface ? { hermesPlanSurface: input.hermesPlanSurface } : {}),
        requestedAt: Date.now(),
        lintWarning,
        // Preserve the untouched user goal so observers can compare
        // pre- and post-injection prompts. Set only when injection
        // actually happened to keep saga metadata noise-free.
        ...(injectedLessonCount > 0 ? { rawGoal: input.goal, injectedLessonCount } : {}),
        ...runLineageMetadata,
        ...(targetPeerIds.length > 0 ? { targetPeerIds } : {}),
        ...(internetProofPlan ? { internetProofPlan } : {}),
      },
    });
    log('[fleet.dispatch] saga created — handing off to runner', {
      sagaId: saga.id,
    });
    activityFeed?.record({
      type: 'fleet.dispatch',
      title: 'Fleet saga started',
      description: truncateActivityText(input.goal, 140),
      metadata: {
        sagaId: saga.id,
        peerCount: peerSlots.length,
        privacyTag: effectivePrivacyTag ?? 'public',
        dispatchProfile: input.dispatchProfile ?? 'balanced',
        parallelism: input.parallelism ?? 1,
        ...runLineageMetadata,
        ...(input.hermesPlanId ? { hermesPlanId: input.hermesPlanId } : {}),
        ...(input.hermesPlanProfile ? { hermesPlanProfile: input.hermesPlanProfile } : {}),
        ...(input.hermesPlanSurface ? { hermesPlanSurface: input.hermesPlanSurface } : {}),
        lintWarning,
        ...(targetPeerIds.length > 0
          ? { targetPeerIds, targetPeerCount: targetPeerIds.length }
          : {}),
        ...buildInternetProofSummaryMetadata(internetProofSummary),
      },
    });

    // (W1+W3) Hand off to SagaRunner — fires peer.dispatch, polls
    // status, finalises via aggregator.
    sagaRunner.start(saga.id);

    return {
      ok: true,
      sagaId: saga.id,
      privacyTag: effectivePrivacyTag,
      dispatchProfile: input.dispatchProfile ?? 'balanced',
      lintWarning,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('[fleet.dispatch] failed:', message);
    return { ok: false, error: message };
  }
}

function truncateActivityText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildDispatchRunLineageMetadata(
  input: FleetDispatchInput,
  targetPeerLabels: string[],
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  setOptionalMetadataString(metadata, 'agentRunId', input.agentRunId);
  setOptionalMetadataString(metadata, 'parentRunId', input.parentRunId);
  setOptionalMetadataString(metadata, 'outcomeId', input.outcomeId);
  setOptionalMetadataString(metadata, 'scheduleTaskId', input.scheduleTaskId);
  setOptionalMetadataString(metadata, 'sourceSessionId', input.sourceSessionId);
  setOptionalMetadataString(metadata, 'deliveryChannel', input.deliveryChannel);
  if (
    typeof input.agentRunSchemaVersion === 'number' &&
    Number.isFinite(input.agentRunSchemaVersion)
  ) {
    metadata.agentRunSchemaVersion = input.agentRunSchemaVersion;
  }
  if (typeof input.memoryCount === 'number' && Number.isFinite(input.memoryCount)) {
    metadata.memoryCount = input.memoryCount;
  }
  if (targetPeerLabels.length > 0) {
    metadata.targetPeerLabels = targetPeerLabels;
  }
  return metadata;
}

function setOptionalMetadataString(
  metadata: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  metadata[key] = trimmed;
}

function resolveSource<T>(source: T | null | (() => T | null)): T | null {
  return typeof source === 'function' ? (source as () => T | null)() : source;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}
