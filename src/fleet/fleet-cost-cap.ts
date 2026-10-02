/**
 * Shared fail-closed cost gate for inbound fleet LLM calls.
 *
 * Budget check, LLM invocation, and ledger charge are serialised so parallel
 * peer requests cannot all observe the same stale budget headroom.
 */

import type { CodeBuddyClient } from '../codebuddy/client.js';
import { getModelPricing } from '../config/model-pricing.js';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_BUDGET,
  getCostTracker,
  type CostBudget,
} from './cost-tracker.js';

export const DEFAULT_FLEET_MAX_TOKENS_PER_CALL = 4096;

export interface FleetUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface FleetCallResponse {
  usage?: FleetUsage;
}

export interface CostCappedFleetCall<T extends FleetCallResponse> {
  peerId: string;
  provider?: string;
  model?: string;
  sagaId: string;
  runId?: string;
  requestedMaxTokens: unknown;
  /** Full request text, including history, used for a conservative input estimate. */
  inputText: string;
  client: CodeBuddyClient;
  invoke: (maxTokens: number) => Promise<T>;
}

let costGateTail: Promise<void> = Promise.resolve();

export function resolveFleetMaxTokens(requested: unknown): number {
  const cap = positiveIntegerEnv(
    'CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL',
    DEFAULT_FLEET_MAX_TOKENS_PER_CALL,
  );
  if (requested === undefined) return cap;
  if (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested <= 0) {
    throw new Error('INVALID_MAX_TOKENS: maxTokens must be a positive integer');
  }
  return Math.min(requested, cap);
}

export function resolveFleetCostBudget(): CostBudget {
  return {
    maxDailyUsd: nonNegativeNumberEnv(
      'CODEBUDDY_FLEET_MAX_DAILY_USD',
      DEFAULT_BUDGET.maxDailyUsd,
    ),
    maxSagaUsd: nonNegativeNumberEnv(
      'CODEBUDDY_FLEET_MAX_SAGA_USD',
      DEFAULT_BUDGET.maxSagaUsd,
    ),
  };
}

/**
 * Run an inbound fleet LLM call under the shared token and dollar caps.
 * A tracker/check/charge failure rejects the RPC instead of bypassing the cap.
 */
export async function executeCostCappedFleetCall<T extends FleetCallResponse>(
  input: CostCappedFleetCall<T>,
): Promise<T> {
  const previous = costGateTail;
  let releaseGate: (() => void) | undefined;
  costGateTail = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  await previous;

  try {
    const maxTokens = resolveFleetMaxTokens(input.requestedMaxTokens);
    const budget = resolveFleetCostBudget();
    const model = resolveModel(input.model, input.client);
    const provider = input.provider ?? 'unknown';
    const estimatedTokensIn = Math.max(1, Buffer.byteLength(input.inputText, 'utf8'));
    const estimatedUsd = calculateFleetCost(
      estimatedTokensIn,
      maxTokens,
      model,
      provider,
    );
    const tracker = getCostTracker();

    let check: Awaited<ReturnType<typeof tracker.isWithinBudget>>;
    try {
      check = await tracker.isWithinBudget(estimatedUsd, budget, input.sagaId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn('[fleet-cost-cap] budget check failed closed', {
        peer: input.peerId,
        provider,
        model,
        estimatedUsd,
        reason,
      });
      throw new Error(`FLEET_BUDGET_CHECK_FAILED: ${reason}`);
    }

    if (!check.allowed) {
      const reason = check.reason ?? 'fleet cost budget has no remaining headroom';
      logger.warn('[fleet-cost-cap] request refused', {
        peer: input.peerId,
        provider,
        model,
        estimatedUsd,
        remainingUsd: check.remainingUsd ?? 0,
        reason,
      });
      throw new Error(`FLEET_BUDGET_EXCEEDED: ${reason}`);
    }

    let response: T | undefined;
    let invocationError: unknown;
    let failed = false;
    try {
      response = await input.invoke(maxTokens);
    } catch (error) {
      // A disconnected/failed stream can already have incurred model costs.
      // Charge the reserved conservative estimate before releasing the gate.
      failed = true;
      invocationError = error;
    }
    const tokensIn = validTokenCount(response?.usage?.prompt_tokens) ?? estimatedTokensIn;
    const tokensOut = validTokenCount(response?.usage?.completion_tokens) ?? maxTokens;
    const usd = calculateFleetCost(tokensIn, tokensOut, model, provider);

    try {
      await tracker.charge({
        at: new Date().toISOString(),
        peerId: input.peerId,
        provider,
        model,
        usd,
        sagaId: input.sagaId,
        ...(input.runId ? { runId: input.runId } : {}),
        tokensIn,
        tokensOut,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error('[fleet-cost-cap] charge failed closed', {
        peer: input.peerId,
        provider,
        model,
        usd,
        reason,
      });
      throw new Error(`FLEET_COST_CHARGE_FAILED: ${reason}`);
    }

    const remainingUsd = Math.max(
      0,
      (check.remainingUsd ?? Math.min(budget.maxDailyUsd, budget.maxSagaUsd)) +
        estimatedUsd -
        usd,
    );
    logger.info('[fleet-cost-cap] charge recorded', {
      peer: input.peerId,
      provider,
      model,
      usd,
      tokensIn,
      tokensOut,
      remainingUsd,
    });
    if (failed) throw invocationError;
    return response as T;
  } finally {
    releaseGate?.();
  }
}

function resolveModel(model: string | undefined, client: CodeBuddyClient): string {
  if (model) return model;
  if (typeof client.getCurrentModel === 'function') {
    const current = client.getCurrentModel();
    if (typeof current === 'string' && current.length > 0) return current;
  }
  return 'unknown';
}

function calculateFleetCost(
  tokensIn: number,
  tokensOut: number,
  model: string,
  provider: string,
): number {
  if (isUnmeteredProvider(provider)) return 0;
  const pricing = getModelPricing(model);
  return (
    (tokensIn * pricing.inputPerMillion + tokensOut * pricing.outputPerMillion) /
    1_000_000
  );
}

function isUnmeteredProvider(provider: string): boolean {
  return (
    provider === 'ollama' ||
    provider === 'lmstudio' ||
    provider === 'lemonade' ||
    provider === 'chatgpt-oauth' ||
    provider === 'gemini-cli' ||
    provider === 'agy-cli'
  );
}

function validTokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (raw.trim() !== '' && Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  logger.warn('[fleet-cost-cap] invalid environment value; using conservative default', {
    name,
    fallback,
  });
  return fallback;
}

function nonNegativeNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (raw.trim() !== '' && Number.isFinite(parsed) && parsed >= 0) return parsed;
  logger.warn('[fleet-cost-cap] invalid environment value; using conservative default', {
    name,
    fallback,
  });
  return fallback;
}

/** Validate provider usage without trusting arbitrary streaming payload fields. */
export function fleetStreamUsage(usage: unknown): FleetUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const raw = usage as Record<string, unknown>;
  return {
    prompt_tokens: validTokenCount(raw.prompt_tokens),
    completion_tokens: validTokenCount(raw.completion_tokens),
  };
}
