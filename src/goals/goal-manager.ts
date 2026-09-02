/**
 * GoalManager — per-session goal state + continuation decisions.
 *
 * The interactive UI holds one GoalManager per session key (lazily resolved
 * on every operation, so `--resume`/`--continue` reattach automatically and
 * sessionless runs stay durable via a cwd-derived key).
 *
 * Network-free by design: the judge is injected into `evaluateAfterTurn` so
 * the manager (and its tests) never touch a provider.
 */

import crypto from 'crypto';
import path from 'path';
import { getSettingsHierarchy } from '../config/settings-hierarchy.js';
import { getSessionStore } from '../persistence/session-store.js';
import { logger } from '../utils/logger.js';
import { GoalJudgeFn } from './goal-judge.js';
import type { GoalPlan } from './goal-decomposer.js';
import {
  DEFAULT_JUDGE_MAX_TOKENS,
  DEFAULT_JUDGE_TIMEOUT_MS,
  DEFAULT_MAX_TURNS,
  GoalState,
  GoalStatus,
  GoalVerdict,
  applyJudgeOutcome,
  buildContinuationPrompt,
  createGoalState,
  formatGoalStatusLine,
  getGoalJudgeCriteria,
  renderSubgoalsBlock,
} from './goal-state.js';
import { GoalStore } from './goal-store.js';

export interface GoalTurnDecision {
  status: GoalStatus | null;
  shouldContinue: boolean;
  continuationPrompt: string | null;
  verdict: GoalVerdict | 'inactive';
  reason: string;
  /** User-visible one-liner (✓ / ⏸ / ↻). Empty when nothing to show. */
  message: string;
}

export interface GoalsConfig {
  maxTurns: number;
  judgeModel: string;
  plannerModel: string;
  judgeMaxTokens: number;
  judgeTimeoutMs: number;
}

export class GoalManager {
  private _state: GoalState | null;

  constructor(
    readonly sessionKey: string,
    private store: GoalStore,
    private defaultMaxTurns: number = DEFAULT_MAX_TURNS
  ) {
    const loaded = this.store.load(sessionKey);
    // A cleared tombstone reads as "no goal" (kept on disk for audit).
    this._state = loaded && loaded.status !== 'cleared' ? loaded : null;
  }

  // --- introspection ------------------------------------------------

  get state(): GoalState | null {
    return this._state;
  }

  isActive(): boolean {
    return this._state?.status === 'active';
  }

  hasGoal(): boolean {
    return this._state !== null && ['active', 'paused'].includes(this._state.status);
  }

  statusLine(): string {
    return formatGoalStatusLine(this._state);
  }

  // --- mutation -----------------------------------------------------

  set(
    goal: string,
    options: { maxTurns?: number; goalPlan?: GoalPlan; goalPlanAttempted?: boolean; verifyGated?: boolean } = {},
  ): GoalState {
    const text = (goal || '').trim();
    if (!text) {
      throw new Error('goal text is empty');
    }
    const state = createGoalState(text, options.maxTurns ?? this.defaultMaxTurns);
    if (options.goalPlan) state.goalPlan = options.goalPlan;
    if (typeof options.goalPlanAttempted === 'boolean') {
      state.goalPlanAttempted = options.goalPlanAttempted;
    }
    if (options.verifyGated) state.verifyGated = true;
    this._state = state;
    this.store.save(this.sessionKey, state);
    return state;
  }

  attachGoalPlan(plan: GoalPlan): GoalState | null {
    if (!this.hasGoal() || !this._state) return null;
    this._state.goalPlan = plan;
    this._state.goalPlanAttempted = true;
    delete this._state.goalPlanLastError;
    this.store.save(this.sessionKey, this._state);
    return this._state;
  }

  markGoalPlanAttempted(error?: string): GoalState | null {
    if (!this.hasGoal() || !this._state) return null;
    this._state.goalPlanAttempted = true;
    if (error) {
      this._state.goalPlanLastError = error;
    } else {
      delete this._state.goalPlanLastError;
    }
    this.store.save(this.sessionKey, this._state);
    return this._state;
  }

  pause(reason: string = 'user-paused'): GoalState | null {
    if (!this._state || !['active', 'paused'].includes(this._state.status)) return null;
    this._state.status = 'paused';
    this._state.pausedReason = reason;
    this.store.save(this.sessionKey, this._state);
    return this._state;
  }

  resume(options: { resetBudget?: boolean } = {}): GoalState | null {
    if (!this._state || this._state.status !== 'paused') return null;
    this._state.status = 'active';
    delete this._state.pausedReason;
    delete this._state.lastVerdict;
    delete this._state.lastReason;
    this._state.consecutiveParseFailures = 0;
    if (options.resetBudget ?? true) {
      this._state.turnsUsed = 0;
    }
    this.store.save(this.sessionKey, this._state);
    return this._state;
  }

  clear(): void {
    if (!this._state) return;
    this._state.status = 'cleared';
    this.store.save(this.sessionKey, this._state);
    this._state = null;
  }

  markDone(reason: string): void {
    if (!this._state) return;
    this._state.status = 'done';
    this._state.lastVerdict = 'done';
    this._state.lastReason = reason;
    this.store.save(this.sessionKey, this._state);
  }

  // --- /subgoal user controls ---------------------------------------

  addSubgoal(text: string): string {
    if (!this.hasGoal() || !this._state) {
      throw new Error('no active goal');
    }
    const clean = (text || '').trim();
    if (!clean) {
      throw new Error('subgoal text is empty');
    }
    this._state.subgoals.push(clean);
    this.store.save(this.sessionKey, this._state);
    return clean;
  }

  removeSubgoal(index1Based: number): string {
    if (!this.hasGoal() || !this._state) {
      throw new Error('no active goal');
    }
    if (!Number.isSafeInteger(index1Based) || index1Based < 1) {
      throw new Error('index must be a positive integer');
    }
    const idx = index1Based - 1;
    if (idx < 0 || idx >= this._state.subgoals.length) {
      throw new Error(`index out of range (1..${this._state.subgoals.length})`);
    }
    const [removed] = this._state.subgoals.splice(idx, 1);
    this.store.save(this.sessionKey, this._state);
    return removed ?? '';
  }

  clearSubgoals(): number {
    if (!this.hasGoal() || !this._state) {
      throw new Error('no active goal');
    }
    const prev = this._state.subgoals.length;
    this._state.subgoals = [];
    this.store.save(this.sessionKey, this._state);
    return prev;
  }

  renderSubgoals(): string {
    if (!this._state) return '(no active goal)';
    if (!this._state.subgoals.length) {
      return '(no subgoals — use /subgoal <text> to add criteria)';
    }
    return renderSubgoalsBlock(this._state.subgoals);
  }

  // --- the main entry point called after every turn -----------------

  /**
   * Run the judge and update state. Both real user prompts and continuation
   * prompts we fed ourselves increment `turnsUsed` — both consume budget.
   */
  async evaluateAfterTurn(lastResponse: string, deps: { judge: GoalJudgeFn }): Promise<GoalTurnDecision> {
    const state = this._state;
    if (!state || state.status !== 'active') {
      return {
        status: state?.status ?? null,
        shouldContinue: false,
        continuationPrompt: null,
        verdict: 'inactive',
        reason: 'no active goal',
        message: '',
      };
    }

    const criteria = getGoalJudgeCriteria(state);
    const outcome = await deps.judge({
      goal: state.goal,
      lastResponse,
      ...(criteria.length ? { subgoals: criteria } : {}),
    });
    const decision = applyJudgeOutcome(state, outcome);
    this.store.save(this.sessionKey, state);
    return decision;
  }

  nextContinuationPrompt(): string | null {
    if (!this._state || this._state.status !== 'active') return null;
    return buildContinuationPrompt(this._state);
  }
}

// ============================================================================
// Config
// ============================================================================

export function resolveGoalsConfig(): GoalsConfig {
  let raw: Record<string, unknown> = {};
  try {
    const hierarchy = getSettingsHierarchy(process.cwd());
    hierarchy.loadAllLevels?.();
    const settings = hierarchy.getAllSettings() as Record<string, unknown>;
    if (settings && typeof settings.goals === 'object' && settings.goals !== null) {
      raw = settings.goals as Record<string, unknown>;
    }
  } catch (error) {
    logger.debug('goals: settings hierarchy unavailable, using defaults', { error: String(error) });
  }

  const maxTurns =
    positiveInt(process.env.CODEBUDDY_GOAL_MAX_TURNS, 0)
      || positiveInt(raw.maxTurns, DEFAULT_MAX_TURNS);

  const judgeModel =
    nonEmptyString(process.env.CODEBUDDY_GOAL_JUDGE_MODEL)
      || nonEmptyString(raw.judgeModel);
  const plannerModel =
    nonEmptyString(process.env.CODEBUDDY_GOAL_PLANNER_MODEL)
      || nonEmptyString(raw.plannerModel);

  return {
    maxTurns,
    judgeModel,
    plannerModel,
    judgeMaxTokens: positiveInt(raw.judgeMaxTokens, DEFAULT_JUDGE_MAX_TOKENS),
    judgeTimeoutMs:
      positiveInt(process.env.CODEBUDDY_GOAL_JUDGE_TIMEOUT_MS, 0) ||
      positiveInt(raw.judgeTimeoutMs, DEFAULT_JUDGE_TIMEOUT_MS),
  };
}

function positiveInt(value: unknown, fallback: number): number {
  const n = parsePositiveSafeInteger(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function parsePositiveSafeInteger(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

// ============================================================================
// Singleton registry (one manager per session key)
// ============================================================================

const registry = new Map<string, GoalManager>();
let storeOverride: GoalStore | null = null;

/**
 * Resolve the key goals are persisted under. Prefers the live session id
 * (so `--resume`/`--continue` reattach, Hermes `goal:<session_id>`
 * semantics); falls back to a cwd-derived key so sessionless interactive
 * runs are still durable.
 */
export function resolveGoalSessionKey(): string {
  try {
    const sessionId = getSessionStore().getCurrentSessionId();
    if (sessionId) return sessionId;
  } catch (error) {
    logger.debug('goals: session store unavailable, using cwd key', { error: String(error) });
  }
  const cwdHash = crypto.createHash('sha256').update(path.resolve(process.cwd())).digest('hex');
  return `dir-${cwdHash.slice(0, 12)}`;
}

export function getGoalManager(sessionKey?: string): GoalManager {
  const key = sessionKey ?? resolveGoalSessionKey();
  let manager = registry.get(key);
  if (!manager) {
    const store = storeOverride ?? new GoalStore();
    manager = new GoalManager(key, store, resolveGoalsConfig().maxTurns);
    registry.set(key, manager);
    if (registry.size > 20) {
      const firstKey = registry.keys().next().value;
      if (firstKey) registry.delete(firstKey);
    }
  }
  return manager;
}

/** Test seam: clear cached managers and optionally redirect persistence. */
export function resetGoalManagers(store: GoalStore | null = null): void {
  registry.clear();
  storeOverride = store;
}
