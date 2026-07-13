import { getGoalManager } from '../goals/goal-manager.js';
import { buildIntentGraph, intentCriterionIds } from '../goals/intent-graph.js';
import { MissionConstitutionStore } from '../goals/mission-constitution.js';
import { MissionExchange } from '../goals/mission-exchange.js';
import { ShadowTwinStore } from '../goals/shadow-twin.js';
import { registerPeerMethod, unregisterPeerMethod } from '../server/websocket/peer-method-registry.js';
import { logger } from '../utils/logger.js';

let wired = false;

function currentMission() {
  const state = getGoalManager().state;
  if (!state || state.status === 'cleared') return null;
  const graph = buildIntentGraph(state);
  const constitutionStore = new MissionConstitutionStore(state.goalId);
  return {
    state,
    graph,
    constitutionStore,
    constitution: constitutionStore.get(graph),
    exchange: new MissionExchange(state.goalId),
    shadow: new ShadowTwinStore(state.goalId),
  };
}

function requiredString(params: Record<string, unknown>, key: string, max = 2_000): string {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`peer.mission-exchange.offer: ${key} is required`);
  return value.trim().slice(0, max);
}

function requiredNumber(params: Record<string, unknown>, key: string, max = Number.POSITIVE_INFINITY): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`peer.mission-exchange.offer: ${key} is invalid`);
  }
  return value;
}

/**
 * Fleet bridge for remote capability offers. Inbound writes are disabled by
 * default and require CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS=1 in addition to the
 * normal authenticated peer:invoke scope.
 */
export function wirePeerMissionExchangeBridge(): void {
  if (wired) return;

  registerPeerMethod('peer.mission-exchange.describe', async () => {
    const mission = currentMission();
    if (!mission) return { active: false, acceptsBids: false };
    return {
      active: true,
      acceptsBids: process.env.CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS === '1',
      goalId: mission.state.goalId,
      intentRevision: mission.graph.contractRevision,
      criterionIds: intentCriterionIds(mission.graph),
      constitution: mission.constitution,
    };
  });

  registerPeerMethod('peer.mission-exchange.offer', async (params, ctx) => {
    if (process.env.CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS !== '1') {
      throw new Error('FLEET_BIDS_DISABLED: set CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS=1 on this peer');
    }
    const mission = currentMission();
    if (!mission) throw new Error('NO_ACTIVE_INTENT: this peer has no durable mission');
    if (params.goalId !== mission.state.goalId || params.intentRevision !== mission.graph.contractRevision) {
      throw new Error('INTENT_REVISION_MISMATCH: refresh peer.mission-exchange.describe before bidding');
    }
    const privacy = params.privacy;
    const risk = params.risk;
    if (!['local', 'private', 'cloud'].includes(String(privacy))) {
      throw new Error('peer.mission-exchange.offer: privacy must be local, private or cloud');
    }
    if (!['low', 'medium', 'high'].includes(String(risk))) {
      throw new Error('peer.mission-exchange.offer: risk must be low, medium or high');
    }
    if (typeof params.reversible !== 'boolean') {
      throw new Error('peer.mission-exchange.offer: reversible must be boolean');
    }
    const criterionIds = Array.isArray(params.criterionIds)
      ? params.criterionIds.filter((value): value is string => typeof value === 'string').slice(0, 100)
      : undefined;
    const bid = mission.exchange.submit(mission.graph, {
      label: requiredString(params, 'label', 120),
      provider: requiredString(params, 'provider', 120),
      model: requiredString(params, 'model', 200),
      origin: `peer:${ctx.connectionId}`,
      strategy: requiredString(params, 'strategy'),
      hypothesis: requiredString(params, 'hypothesis', 1_000),
      evidencePlan: requiredString(params, 'evidencePlan'),
      ...(criterionIds ? { criterionIds } : {}),
      prediction: {
        quality: requiredNumber(params, 'quality', 1),
        latencyMs: requiredNumber(params, 'latencyMs'),
        costUsd: requiredNumber(params, 'costUsd'),
      },
      privacy: privacy as 'local' | 'private' | 'cloud',
      reversible: params.reversible,
      risk: risk as 'low' | 'medium' | 'high',
    });
    const evaluation = mission.exchange.rank(
      mission.graph,
      mission.constitution,
      mission.shadow.list(1000),
    ).find((entry) => entry.bid.id === bid.id)!;
    return { bid, policy: evaluation.policy, pareto: evaluation.pareto, score: evaluation.score };
  });

  registerPeerMethod('peer.mission-exchange.rank', async () => {
    const mission = currentMission();
    if (!mission) return [];
    return mission.exchange.rank(mission.graph, mission.constitution, mission.shadow.list(1000));
  });

  wired = true;
  logger.debug('[peer-mission-exchange] wired');
}

export function unwirePeerMissionExchangeBridge(): void {
  if (!wired) return;
  unregisterPeerMethod('peer.mission-exchange.describe');
  unregisterPeerMethod('peer.mission-exchange.offer');
  unregisterPeerMethod('peer.mission-exchange.rank');
  wired = false;
  logger.debug('[peer-mission-exchange] unwired');
}

export function _resetPeerMissionExchangeBridgeForTests(): void {
  unregisterPeerMethod('peer.mission-exchange.describe');
  unregisterPeerMethod('peer.mission-exchange.offer');
  unregisterPeerMethod('peer.mission-exchange.rank');
  wired = false;
}
