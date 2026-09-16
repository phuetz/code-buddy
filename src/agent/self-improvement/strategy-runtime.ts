/**
 * Strategy runtime — the ONE place the rest of the agent reads the active
 * strategy. Opt-in: without `CODEBUDDY_SELF_IMPROVE_STRATEGIES=true` it returns
 * an empty overlay, so every consumer keeps its historical behavior byte for byte.
 * Explicit user choices (a `--max-tool-rounds` flag, a `MAX_COST` env) always win
 * over the strategy: it only fills what the user left unset.
 *
 * @module agent/self-improvement/strategy-runtime
 */

import { StrategyStore } from './strategy-store.js';
import type { StrategyScope, StrategySpec } from './strategy-types.js';

export const STRATEGY_OPT_IN_ENV = 'CODEBUDDY_SELF_IMPROVE_STRATEGIES';

export interface StrategyOverlay {
  /** Id of the strategy in force (absent when the layer is off). */
  strategyId?: string;
  maxToolRounds?: number;
  maxCostUsd?: number;
  reasoning?: StrategySpec['reasoning'];
  /** Text to append to the system prompt (directives), or undefined when none. */
  systemPromptAppend?: string;
}

export function strategiesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[STRATEGY_OPT_IN_ENV]?.trim().toLowerCase() ?? '';
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

export function renderDirectives(spec: StrategySpec): string | undefined {
  if (spec.directives.length === 0) return undefined;
  return ['<execution_strategy>', ...spec.directives.map((d) => `- ${d}`), '</execution_strategy>'].join('\n');
}

/**
 * Resolve the overlay for `scope`. `explicit` carries what the user already
 * chose; those keys are left untouched (absent from the overlay).
 */
export function resolveStrategyOverlay(
  scope: StrategyScope,
  explicit: { maxToolRounds?: number | undefined; maxCostUsd?: number | undefined } = {},
  options: { env?: NodeJS.ProcessEnv; workDir?: string; store?: StrategyStore } = {},
): StrategyOverlay {
  if (!strategiesEnabled(options.env ?? process.env)) return {};
  const store = options.store ?? new StrategyStore({ workDir: options.workDir });
  const spec = store.resolveActive(scope);
  if (spec.id === 'baseline') return { strategyId: spec.id };
  const overlay: StrategyOverlay = { strategyId: spec.id, reasoning: spec.reasoning };
  if (explicit.maxToolRounds === undefined) overlay.maxToolRounds = spec.limits.maxToolRounds;
  if (explicit.maxCostUsd === undefined) overlay.maxCostUsd = spec.limits.maxCostUsd;
  const append = renderDirectives(spec);
  if (append) overlay.systemPromptAppend = append;
  return overlay;
}

/**
 * Carry the overlay's cost cap into the environment the agent reads (`MAX_COST`),
 * only when the user set none. Returns what was applied (for logging/tests).
 * Never lowers or overrides an explicit value.
 */
export function applyStrategyCostCap(
  overlay: StrategyOverlay,
  env: NodeJS.ProcessEnv = process.env,
): { maxCostUsd?: number } {
  if (overlay.maxCostUsd === undefined) return {};
  const explicit = env.MAX_COST?.trim();
  if (explicit) return {};
  env.MAX_COST = String(overlay.maxCostUsd);
  return { maxCostUsd: overlay.maxCostUsd };
}
