/**
 * Fleet — Task router with capability-based scoring (Fleet P3).
 *
 * Given a task classification (complexity, requiresVision, etc.) and
 * a registry of peers (each with their `PeerCapability` from
 * `peer.describe`), compute a `DispatchPlan` that names the best
 * peer + model for the primary lane, plus optional fallback and
 * parallel-redundancy lanes.
 *
 * Scoring formula (per peer × model candidate):
 *
 *   score = 0.4·match  +  0.3·cost  +  0.2·load  +  0.1·latency
 *
 *   - match   : how well `model.strengths` cover the task's needs
 *   - cost    : inverse of $/Mtok normalised by remaining budget
 *   - load    : inverse of `peer.activeRequests / peer.maxConcurrency`
 *   - latency : inverse of avg first-token p50
 *
 * A privacy veto fires when `task.sensitive` AND `peer.egress === 'cloud'`
 * — those candidates are dropped before scoring.
 *
 * The router does NOT make the network call itself — it returns a
 * plan that the saga executor (Fleet P4) consumes.
 *
 * @module fleet/task-router
 */

import type { TaskClassification } from '../optimization/model-routing.js';
import type {
  FleetEgress,
  FleetProvider,
  FleetModelDescriptor,
  ModelStrength,
  PeerCapability,
} from './types.js';
import {
  normalizeDispatchProfile,
  type FleetDispatchProfile,
} from './dispatch-profile.js';

/** A single dispatch lane: which peer × which model. */
export interface DispatchLane {
  peerId: string;
  model: string;
  /** Exact backend serving `model`. Optional only for legacy persisted plans. */
  provider?: FleetProvider;
  /** 0..1 — diagnostic, lets the UI explain "why this peer". */
  score: number;
  /** Per-term breakdown for the rationale text. */
  breakdown: {
    match: number;
    cost: number;
    load: number;
    latency: number;
  };
  /**
   * Hermes-style role hint. Required for chain lanes (Draft→Review→Test),
   * optional everywhere else. Values are dispatch-profile names:
   * `'code' | 'review' | 'research' | 'safe' | 'balanced'`.
   */
  role?: string;
}

/** What the router returns. */
export interface DispatchPlan {
  /** Primary lane — execute first. */
  primary: DispatchLane;
  /** Fallback if primary errors. */
  fallback?: DispatchLane;
  /** When set, run all listed lanes in parallel (ensemble / voting). */
  parallel?: DispatchLane[];
  /**
   * Sequential collaboration chain (Hermes-style). When set, lanes run
   * in order — each step starts only after the previous one completes.
   * Mutually exclusive with `parallel` semantically (the SagaStore
   * branches on `chain` first when building initial steps).
   */
  chain?: DispatchLane[];
  /** Human-readable summary, useful in UI tooltips and logs. */
  rationale: string;
}

/** Constraints the caller imposes on the plan. */
export interface DispatchConstraints {
  /**
   * When true, a peer with `egress === 'cloud'` is vetoed regardless
   * of score. Used for sensitive prompts containing secrets, source
   * code from private projects, etc. Detection lives upstream
   * (privacy lint, Phase 8).
   */
  privacyTag?: 'sensitive' | 'public';
  /** Hard cap on cost per task in USD. Drops candidates over budget. */
  maxCostUsd?: number;
  /** Hard cap on expected latency. Drops slow candidates. */
  maxLatencyMs?: number;
  /** When set, force-include this many parallel lanes for redundancy. */
  parallelism?: number;
  /** Optional hard allow-list of peer ids for operator-selected targets. */
  targetPeerIds?: string[];
  /** Hermes-style operating posture selected by the Fleet operator. */
  dispatchProfile?: FleetDispatchProfile;
  /**
   * Estimated max input tokens — used to drop models whose
   * `contextWindow` is too small. Defaults to `taskClassification.estimatedTokens`.
   */
  estimatedTokens?: number;
  /**
   * Hermes-style required role. When set, peers tagged with this role
   * (in `PeerCapability.roles`) get a match-score bonus, so a
   * review-tagged peer wins a `review` task even if a cheaper peer
   * scores higher on cost alone.
   */
  requiredRole?: string;
  /**
   * Phase H — subtractive peer filter. Inverse of `targetPeerIds`. Used
   * by chain-step retry to pick an alternative peer after a stall:
   *   `{ requiredRole: 'review', excludePeerIds: [stalledPeerId] }`.
   *
   * Throws `NoPeerAvailableError` when the exclusion empties the
   * candidate pool (caller should leave the step failed). Whitespace
   * entries are normalised; an empty array is a no-op.
   */
  excludePeerIds?: string[];
  /**
   * Provider failure-domain filter. Unlike `excludePeerIds`, this keeps the
   * machine eligible and only removes models served by the failed backend.
   * This is what lets a single robot peer fall back from (for example)
   * OpenRouter to Lemonade without pretending they are separate machines.
   */
  excludeProviders?: FleetProvider[];
}

/** A peer entry as seen by the router (cap snapshot + dynamic load info). */
export interface PeerSlot {
  peerId: string;
  capability: PeerCapability;
}

const PRIVACY_VETO_EGRESS: FleetEgress[] = ['cloud'];

const DEFAULT_BUDGET_USD = 1; // per-task default if not provided

export class TaskRouter {
  /**
   * Build a `DispatchPlan` from peers + a task classification. Throws
   * `NoPeerAvailableError` when nothing matches after veto/filter.
   */
  plan(
    classification: TaskClassification,
    peers: PeerSlot[],
    constraints: DispatchConstraints = {},
  ): DispatchPlan {
    const dispatchProfile = normalizeDispatchProfile(constraints.dispatchProfile);
    const requiredStrengths = inferRequiredStrengths(
      classification,
      dispatchProfile,
    );
    const roleHint = constraints.requiredRole ?? roleHintFromDispatchProfile(dispatchProfile);
    const minContextWindow =
      constraints.estimatedTokens ?? classification.estimatedTokens ?? 0;
    const targetPeerIds = normalizeTargetPeerIds(constraints.targetPeerIds);
    const excludePeerIds = normalizeTargetPeerIds(constraints.excludePeerIds);
    const excludeProviders = normalizeExcludedProviders(constraints.excludeProviders);

    // 1. Enumerate every (peer, model) candidate.
    const candidates: DispatchLane[] = [];
    const budget = constraints.maxCostUsd ?? DEFAULT_BUDGET_USD;

    for (const slot of peers) {
      if (targetPeerIds && !targetPeerIds.has(slot.peerId)) {
        continue;
      }
      if (excludePeerIds && excludePeerIds.has(slot.peerId)) {
        continue;
      }

      const cap = slot.capability;

      // Privacy veto.
      if (
        constraints.privacyTag === 'sensitive' &&
        PRIVACY_VETO_EGRESS.includes(cap.egress)
      ) {
        continue;
      }

      for (const model of cap.models) {
        // Hard filters first — drop before scoring.
        if (excludeProviders?.has(model.provider)) continue;
        if (model.contextWindow < minContextWindow) continue;
        if (
          constraints.maxLatencyMs !== undefined &&
          model.avgLatencyMs !== undefined &&
          model.avgLatencyMs > constraints.maxLatencyMs
        ) {
          continue;
        }
        if (
          constraints.maxCostUsd !== undefined &&
          model.costInputUsdPerMtok !== undefined &&
          // Rough estimate: 1 Mtok input + 0.5 Mtok output.
          (model.costInputUsdPerMtok + (model.costOutputUsdPerMtok ?? 0) * 0.5) >
            constraints.maxCostUsd * 2
        ) {
          continue;
        }

        const breakdown = scoreCandidate(
          model,
          cap,
          requiredStrengths,
          budget,
          roleHint,
        );
        const score =
          0.4 * breakdown.match +
          0.3 * breakdown.cost +
          0.2 * breakdown.load +
          0.1 * breakdown.latency;

        candidates.push({
          peerId: slot.peerId,
          model: model.id,
          provider: model.provider,
          score,
          breakdown,
          role: roleHint && cap.roles?.includes(roleHint) ? roleHint : undefined,
        });
      }
    }

    if (candidates.length === 0) {
      throw new NoPeerAvailableError(
        `No peer can satisfy the task (sensitive=${
          constraints.privacyTag === 'sensitive'
        }, requiresVision=${classification.requiresVision}, ` +
          `requiresLongContext=${classification.requiresLongContext}, ` +
          `targetedPeers=${targetPeerIds?.size ?? 0}).`,
      );
    }

    candidates.sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      return Number(Boolean(b.role)) - Number(Boolean(a.role));
    });
    const primary = candidates[0];
    if (primary === undefined) {
      // Unreachable: the candidates.length === 0 check above already throws,
      // but this guard narrows DispatchLane | undefined -> DispatchLane and
      // preserves the same no-peer failure shape.
      throw new NoPeerAvailableError(
        'No peer can satisfy the task (no candidate after scoring).',
      );
    }
    // A provider is a failure domain independent from its host peer. Prefer a
    // lane that differs on both axes, then another provider on the same peer,
    // and finally the historical different-peer/same-provider fallback. This
    // keeps a one-machine, many-provider robot autonomous during an outage.
    const fallback =
      candidates.find(
        (candidate) =>
          candidate.peerId !== primary.peerId &&
          candidate.provider !== primary.provider,
      ) ??
      candidates.find((candidate) => candidate.provider !== primary.provider) ??
      candidates.find((candidate) => candidate.peerId !== primary.peerId);

    const plan: DispatchPlan = {
      primary,
      fallback,
      rationale: buildRationale(
        primary,
        fallback,
        requiredStrengths,
        classification,
        dispatchProfile,
        roleHint,
      ),
    };

    if (constraints.parallelism && constraints.parallelism > 1) {
      // Take the top-N distinct peers (or top-N candidates if not
      // enough peers — degrades to multi-model on the same peer).
      const seen = new Set<string>();
      const lanes: DispatchLane[] = [];
      for (const c of candidates) {
        if (seen.has(c.peerId)) continue;
        seen.add(c.peerId);
        lanes.push(c);
        if (lanes.length >= constraints.parallelism) break;
      }
      // If we couldn't fan out across peers, top up with same-peer
      // different models (still useful — voting across model families).
      if (lanes.length < constraints.parallelism) {
        for (const c of candidates) {
          if (lanes.find((l) => l.peerId === c.peerId && l.model === c.model)) {
            continue;
          }
          lanes.push(c);
          if (lanes.length >= constraints.parallelism) break;
        }
      }
      plan.parallel = lanes;
    }

    return plan;
  }
}

// ─────────── Scoring internals ───────────

function normalizeTargetPeerIds(peerIds: string[] | undefined): Set<string> | null {
  if (!Array.isArray(peerIds)) return null;
  const normalized = peerIds
    .map((peerId) => peerId.trim())
    .filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function normalizeExcludedProviders(
  providers: FleetProvider[] | undefined,
): Set<FleetProvider> | null {
  if (!Array.isArray(providers)) return null;
  const normalized = providers.filter((provider) => provider !== 'unknown');
  return normalized.length > 0 ? new Set(normalized) : null;
}

function roleHintFromDispatchProfile(profile: FleetDispatchProfile): string | undefined {
  return profile === 'balanced' ? undefined : profile;
}

function scoreCandidate(
  model: FleetModelDescriptor,
  cap: PeerCapability,
  requiredStrengths: ModelStrength[],
  budgetUsd: number,
  requiredRole?: string,
): DispatchLane['breakdown'] {
  let match = scoreMatch(model.strengths, requiredStrengths);
  // Hermes role bonus — multiply match by 1.25 (cap at 1.0) when the
  // caller asked for a specific role and the peer advertises it. This
  // lets a `review`-tagged peer win a review chain step even if a
  // cheaper peer scores higher on cost alone.
  if (requiredRole && cap.roles && cap.roles.includes(requiredRole)) {
    match = Math.min(1, match * 1.25);
  }
  const cost = scoreCost(model, budgetUsd);
  const load = scoreLoad(cap);
  const latency = scoreLatency(model);
  return { match, cost, load, latency };
}

/**
 * 1.0 when the model has every required strength; falls off
 * proportionally when missing some. Bonuses (model has strengths
 * the task didn't ask for, e.g. vision on a text-only task) don't
 * count negatively but don't help either — just neutral.
 */
function scoreMatch(
  modelStrengths: ModelStrength[],
  required: ModelStrength[],
): number {
  if (required.length === 0) return 0.7; // no specific need → neutral OK
  const have = new Set(modelStrengths);
  let hits = 0;
  for (const r of required) {
    if (have.has(r)) hits++;
  }
  return hits / required.length;
}

/**
 * 1.0 = free / very cheap, 0.0 = at or way over budget.
 *
 * Smooth decay `1 / (1 + ratio)` so even expensive models still get a
 * non-zero score (lets the router pick them when they're the only
 * candidate matching capabilities) while still strongly preferring
 * cheap ones in head-to-head comparisons.
 */
function scoreCost(model: FleetModelDescriptor, budgetUsd: number): number {
  if (model.costInputUsdPerMtok === undefined) {
    // Local model, no $ cost — best score.
    return 1;
  }
  // Estimate cost for a typical 1Mtok in / 0.5Mtok out exchange.
  const expected =
    model.costInputUsdPerMtok + (model.costOutputUsdPerMtok ?? 0) * 0.5;
  if (budgetUsd <= 0) return 0;
  const ratio = expected / budgetUsd;
  return 1 / (1 + ratio);
}

/** 1.0 = idle, 0.0 = at max concurrency. */
function scoreLoad(cap: PeerCapability): number {
  const max = cap.maxConcurrency ?? 1;
  const active = cap.activeRequests ?? 0;
  if (max <= 0) return 0;
  if (active >= max) return 0;
  return 1 - active / max;
}

/** 1.0 = sub-second, decays linearly to 0 at 30 s. */
function scoreLatency(model: FleetModelDescriptor): number {
  if (model.avgLatencyMs === undefined) {
    // No data — neutral.
    return 0.6;
  }
  if (model.avgLatencyMs <= 1000) return 1;
  if (model.avgLatencyMs >= 30000) return 0;
  return 1 - (model.avgLatencyMs - 1000) / 29000;
}

/**
 * Translate a task classification into the set of `ModelStrength`s
 * the model ideally has. The mapping is intentionally conservative —
 * we'd rather the router pick a slightly oversized model than miss
 * a critical capability.
 */
function inferRequiredStrengths(
  c: TaskClassification,
  dispatchProfile: FleetDispatchProfile = 'balanced',
): ModelStrength[] {
  const set: Set<ModelStrength> = new Set();
  if (c.requiresVision) set.add('vision');
  if (c.requiresReasoning || c.complexity === 'reasoning_heavy') {
    set.add('reasoning');
    if (c.complexity === 'reasoning_heavy') set.add('thinking');
  }
  if (c.requiresLongContext) set.add('long-context');
  if (dispatchProfile === 'research') {
    set.add('long-context');
  }
  if (
    dispatchProfile === 'code' ||
    dispatchProfile === 'review' ||
    dispatchProfile === 'safe'
  ) {
    set.add('reasoning');
  }
  // Only nudge towards cheap+fast when no specialized strength was
  // already required — otherwise a "simple" vision task would lose
  // to a vision-less cheap model just on cheap+fast hits.
  if (
    c.complexity === 'simple' &&
    c.estimatedTokens < 4000 &&
    set.size === 0
  ) {
    set.add('cheap');
    set.add('fast');
  }
  return Array.from(set);
}

function buildRationale(
  primary: DispatchLane,
  fallback: DispatchLane | undefined,
  required: ModelStrength[],
  c: TaskClassification,
  dispatchProfile: FleetDispatchProfile = 'balanced',
  roleHint?: string,
): string {
  const reqStr =
    required.length > 0 ? required.join(', ') : 'no specific strength';
  const parts = [
    `Primary: ${primary.peerId} ${primary.model} (score ${primary.score.toFixed(3)})`,
    `Required: ${reqStr}`,
    `Complexity: ${c.complexity}`,
    `Profile: ${dispatchProfile}`,
  ];
  if (roleHint) {
    parts.push(`Role hint: ${roleHint}`);
  }
  if (fallback) {
    parts.push(`Fallback: ${fallback.peerId} ${fallback.model}`);
  }
  return parts.join(' · ');
}

export class NoPeerAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoPeerAvailableError';
  }
}

/**
 * Compose a Hermes-style chain `DispatchPlan` — one lane per requested
 * role, each routed independently so the best-suited peer wins for
 * every stage (Draft→Review→Test by default).
 *
 * Each role gets its own router invocation with `requiredRole` set, so
 * the role-bonus tilt from {@link scoreCandidate} steers Draft to a
 * `code`-tagged peer, Review to a `review`-tagged peer, etc. When no
 * peer advertises the role, the bonus is a no-op and the router falls
 * back to its standard match/cost/load/latency scoring — so the chain
 * still resolves end-to-end on a single-peer fleet.
 *
 * Throws `NoPeerAvailableError` for the FIRST role that can't be
 * satisfied (privacy veto, no capable model, etc.). The caller can
 * catch and fall back to a non-chain plan.
 *
 * Returns a plan with both `chain: DispatchLane[]` populated **and**
 * `primary` set to the first lane (for back-compat with code that
 * reads `plan.primary` for rationale chips, etc.). The SagaStore
 * branches on `chain` first when building initial steps, so the
 * primary lane is ignored at execution time when chain is set.
 */
export function planChainDispatch(
  classification: TaskClassification,
  peers: PeerSlot[],
  options: {
    chainRoles: string[];
    constraints?: Omit<DispatchConstraints, 'requiredRole'>;
  },
): DispatchPlan {
  if (options.chainRoles.length === 0) {
    throw new Error('planChainDispatch requires at least one role');
  }
  const router = new TaskRouter();
  const chain: DispatchLane[] = [];
  for (const role of options.chainRoles) {
    const sub = router.plan(classification, peers, {
      ...(options.constraints ?? {}),
      requiredRole: role,
    });
    chain.push({ ...sub.primary, role });
  }
  const head = chain[0]!;
  const rationale =
    `Chain dispatch: ${options.chainRoles.join(' → ')}. ` +
    chain.map((lane) => `${lane.role}=${lane.peerId}`).join(', ');
  return {
    primary: head,
    chain,
    rationale,
  };
}
