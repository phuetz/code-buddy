import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import { intentCriterionIds, type IntentGraph } from './intent-graph.js';
import {
  MissionConstitutionStore,
  type BidPrivacy,
  type ConstitutionGate,
  type MissionConstitution,
  type MissionRiskLevel,
} from './mission-constitution.js';
import type { MissionPrediction, ShadowRehearsal } from './shadow-twin.js';

export type MissionBidStatus = 'submitted' | 'rehearsed' | 'awarded' | 'rejected';

export interface MissionBid {
  schemaVersion: 1;
  id: string;
  goalId: string;
  intentRevision: string;
  label: string;
  provider: string;
  model: string;
  origin: string;
  strategy: string;
  hypothesis: string;
  evidencePlan: string;
  criterionIds: string[];
  prediction: MissionPrediction;
  privacy: BidPrivacy;
  reversible: boolean;
  risk: MissionRiskLevel;
  status: MissionBidStatus;
  createdAt: string;
  updatedAt: string;
  shadowRehearsalId?: string;
  forgeBranchId?: string;
}

export interface SubmitMissionBidInput {
  label: string;
  provider: string;
  model: string;
  origin?: string;
  strategy: string;
  hypothesis: string;
  evidencePlan: string;
  criterionIds?: string[];
  prediction: MissionPrediction;
  privacy: BidPrivacy;
  reversible: boolean;
  risk: MissionRiskLevel;
}

export interface MissionSettlementGates {
  constitution: boolean;
  shadow: boolean;
  proofPlan: boolean;
  reversibility: boolean;
  readyToAward: boolean;
}

export interface MissionBidEvaluation {
  bid: MissionBid;
  policy: ConstitutionGate;
  pareto: boolean;
  score: number;
  rehearsal: ShadowRehearsal | null;
  settlement: MissionSettlementGates;
}

interface MissionExchangeEvent {
  schemaVersion: 1;
  type: 'bid.snapshot';
  at: string;
  bid: MissionBid;
}

export interface MissionExchangeOptions {
  storeDir?: string;
  now?: () => Date;
  idFactory?: () => string;
}

export interface AwardMissionBidOptions {
  humanApproved?: boolean;
  createForgeBranch?: (bid: MissionBid) => string;
}

function safeGoalId(goalId: string): string {
  const clean = goalId.trim();
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(clean)) throw new Error('invalid goal id for Mission Exchange');
  return clean;
}

function boundedText(value: string, label: string, max: number): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${label} is required`);
  return clean.slice(0, max);
}

function validatePrediction(prediction: MissionPrediction): MissionPrediction {
  if (!Number.isFinite(prediction.quality) || prediction.quality < 0 || prediction.quality > 1) {
    throw new Error('prediction quality must be between 0 and 1');
  }
  if (!Number.isFinite(prediction.latencyMs) || prediction.latencyMs < 0) {
    throw new Error('prediction latencyMs must be non-negative');
  }
  if (!Number.isFinite(prediction.costUsd) || prediction.costUsd < 0) {
    throw new Error('prediction costUsd must be non-negative');
  }
  return prediction;
}

function dominates(left: MissionBid, right: MissionBid): boolean {
  const atLeastAsGood =
    left.prediction.quality >= right.prediction.quality &&
    left.prediction.latencyMs <= right.prediction.latencyMs &&
    left.prediction.costUsd <= right.prediction.costUsd;
  const strictlyBetter =
    left.prediction.quality > right.prediction.quality ||
    left.prediction.latencyMs < right.prediction.latencyMs ||
    left.prediction.costUsd < right.prediction.costUsd;
  return atLeastAsGood && strictlyBetter;
}

/**
 * Market of model/peer execution offers. Settlement remains proof-gated and
 * an award creates a normal Forge branch rather than bypassing the dev loop.
 */
export class MissionExchange {
  private readonly goalId: string;
  private readonly storeDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(goalId: string, options: MissionExchangeOptions = {}) {
    this.goalId = safeGoalId(goalId);
    this.storeDir = options.storeDir ?? getCodeBuddyPath('exchange');
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  getFilePath(): string {
    return path.join(this.storeDir, `${this.goalId}.jsonl`);
  }

  submit(graph: IntentGraph, input: SubmitMissionBidInput): MissionBid {
    if (graph.goalId !== this.goalId) throw new Error('intent graph does not match Mission Exchange');
    const at = this.now().toISOString();
    const allCriteria = new Set(intentCriterionIds(graph));
    const requestedCriteria = input.criterionIds?.length ? input.criterionIds : [...allCriteria];
    const criterionIds = [...new Set(requestedCriteria.filter((id) => allCriteria.has(id)))];
    const bid: MissionBid = {
      schemaVersion: 1,
      id: `bid-${this.idFactory()}`,
      goalId: this.goalId,
      intentRevision: graph.contractRevision,
      label: boundedText(input.label, 'label', 120),
      provider: boundedText(input.provider, 'provider', 120),
      model: boundedText(input.model, 'model', 200),
      origin: boundedText(input.origin ?? 'local', 'origin', 200),
      strategy: boundedText(input.strategy, 'strategy', 2_000),
      hypothesis: boundedText(input.hypothesis, 'hypothesis', 1_000),
      evidencePlan: boundedText(input.evidencePlan, 'evidencePlan', 2_000),
      criterionIds,
      prediction: validatePrediction(input.prediction),
      privacy: input.privacy,
      reversible: input.reversible,
      risk: input.risk,
      status: 'submitted',
      createdAt: at,
      updatedAt: at,
    };
    this.append(bid);
    return bid;
  }

  rank(
    graph: IntentGraph,
    constitution: MissionConstitution,
    rehearsals: ShadowRehearsal[],
  ): MissionBidEvaluation[] {
    const bids = this.list().filter((bid) => bid.intentRevision === graph.contractRevision);
    const constitutionStore = new MissionConstitutionStore(this.goalId);
    const latestRehearsal = new Map<string, ShadowRehearsal>();
    for (const rehearsal of rehearsals) {
      if (!latestRehearsal.has(rehearsal.bidId)) latestRehearsal.set(rehearsal.bidId, rehearsal);
    }
    const policies = new Map(bids.map((bid) => [bid.id, constitutionStore.evaluate(constitution, {
      privacy: bid.privacy,
      costUsd: bid.prediction.costUsd,
      latencyMs: bid.prediction.latencyMs,
      reversible: bid.reversible,
      risk: bid.risk,
    })]));
    const policyAllowed = bids.filter((bid) => policies.get(bid.id)?.allowed && bid.status !== 'rejected');
    const allCriteria = intentCriterionIds(graph);
    return bids.map((bid) => {
      const policy = policies.get(bid.id)!;
      const rehearsal = latestRehearsal.get(bid.id) ?? null;
      const pareto = policy.allowed && !policyAllowed.some((other) => other.id !== bid.id && dominates(other, bid));
      const latencyEfficiency = 1 - Math.min(1, bid.prediction.latencyMs / Math.max(1, constitution.maxLatencyMs));
      const costEfficiency = 1 - Math.min(1, bid.prediction.costUsd / Math.max(0.01, constitution.maxCostUsd));
      const privacyValue = bid.privacy === 'local' ? 1 : bid.privacy === 'private' ? 0.7 : 0.3;
      const score = policy.allowed
        ? bid.prediction.quality * 0.55 + latencyEfficiency * 0.2 + costEfficiency * 0.15 +
          privacyValue * 0.05 + Number(bid.reversible) * 0.05
        : 0;
      const proofPlan = Boolean(bid.evidencePlan) && allCriteria.every((id) => bid.criterionIds.includes(id));
      const reversibility = !constitution.requireReversible || (
        bid.reversible &&
        Boolean(rehearsal?.reversibility.checkpointTaken) &&
        Boolean(rehearsal?.reversibility.rollbackValidated) &&
        Boolean(rehearsal?.reversibility.noPersistentSideEffects)
      );
      const settlement = {
        constitution: policy.allowed,
        shadow: rehearsal?.status === 'pass',
        proofPlan,
        reversibility,
        readyToAward: false,
      };
      settlement.readyToAward =
        settlement.constitution && settlement.shadow && settlement.proofPlan && settlement.reversibility;
      return { bid, policy, pareto, score, rehearsal, settlement };
    }).sort((left, right) => Number(right.settlement.readyToAward) - Number(left.settlement.readyToAward) || right.score - left.score);
  }

  linkRehearsal(bidId: string, rehearsal: ShadowRehearsal): MissionBid {
    const bid = this.requireBid(bidId);
    if (rehearsal.bidId !== bid.id || rehearsal.intentRevision !== bid.intentRevision) {
      throw new Error('Shadow rehearsal does not match bid intent revision');
    }
    const updated: MissionBid = {
      ...bid,
      status: bid.status === 'awarded' ? 'awarded' : 'rehearsed',
      shadowRehearsalId: rehearsal.id,
      updatedAt: this.now().toISOString(),
    };
    this.append(updated);
    return updated;
  }

  award(
    graph: IntentGraph,
    constitution: MissionConstitution,
    rehearsals: ShadowRehearsal[],
    bidId: string,
    options: AwardMissionBidOptions = {},
  ): MissionBid {
    const evaluation = this.rank(graph, constitution, rehearsals).find((entry) => entry.bid.id === bidId);
    if (!evaluation) throw new Error(`mission bid not found: ${bidId}`);
    const previousAward = this.list().find((bid) => bid.status === 'awarded' && bid.id !== bidId);
    if (previousAward) throw new Error(`mission already awarded to ${previousAward.id}`);
    if (!evaluation.settlement.readyToAward) {
      throw new Error('mission bid is not ready: constitution, shadow, proof plan and reversibility must pass');
    }
    if (evaluation.policy.requiresApproval && !options.humanApproved) {
      throw new Error('mission constitution requires explicit human approval');
    }
    const forgeBranchId = options.createForgeBranch?.(evaluation.bid);
    const awarded: MissionBid = {
      ...evaluation.bid,
      status: 'awarded',
      ...(forgeBranchId ? { forgeBranchId } : {}),
      updatedAt: this.now().toISOString(),
    };
    this.append(awarded);
    return awarded;
  }

  reject(bidId: string): MissionBid {
    const bid = this.requireBid(bidId);
    if (bid.status === 'awarded') throw new Error('an awarded mission bid cannot be rejected');
    const rejected: MissionBid = { ...bid, status: 'rejected', updatedAt: this.now().toISOString() };
    this.append(rejected);
    return rejected;
  }

  get(bidId: string): MissionBid | null {
    return this.list().find((bid) => bid.id === bidId) ?? null;
  }

  list(): MissionBid[] {
    const bids = new Map<string, MissionBid>();
    try {
      for (const line of fs.readFileSync(this.getFilePath(), 'utf8').split('\n')) {
        try {
          const event = JSON.parse(line) as MissionExchangeEvent;
          if (event?.schemaVersion === 1 && event.type === 'bid.snapshot' && event.bid.goalId === this.goalId) {
            bids.delete(event.bid.id);
            bids.set(event.bid.id, event.bid);
          }
        } catch {
          // One torn event never hides the remaining exchange.
        }
      }
    } catch {
      return [];
    }
    return [...bids.values()].reverse();
  }

  private requireBid(bidId: string): MissionBid {
    const bid = this.get(bidId);
    if (!bid) throw new Error(`mission bid not found: ${bidId}`);
    return bid;
  }

  private append(bid: MissionBid): void {
    fs.mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
    const event: MissionExchangeEvent = { schemaVersion: 1, type: 'bid.snapshot', at: bid.updatedAt, bid };
    fs.appendFileSync(this.getFilePath(), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(this.getFilePath(), 0o600);
  }
}
