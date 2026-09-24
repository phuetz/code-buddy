/**
 * Compact system prompt + tool cap for `buddy -p` against a local
 * runtime (Ollama / LM Studio / vLLM), or against any provider on request.
 * Opt-in: `CODEBUDDY_PROMPT_COMPACT=true`. Opt-out: `CODEBUDDY_PROMPT_COMPACT=false`.
 *
 * `HEADLESS_LOCAL_COMPACT_MAX_TOOLS` is the number of tool schemas sent, not a
 * hint the selector may exceed. The selector's anti-starvation slack
 * (`alwaysInclude.length + 5` when `maxTools` > 5, `src/tools/tool-selector.ts`)
 * turned a compact request into 10 schemas: the four names below, plus
 * `restore_context` (forced by the selection strategy — observation contract,
 * kept inside the ceiling), plus five RAG hits. The last two of those hits
 * (`peer_tool_invoke`, `web_test` on « Réponds uniquement : OK ») were the
 * overflow. They are not fleet-surface injections: that path only prepends
 * fleet tools when the registry is non-empty or the question is about the
 * fleet. `capCompactToolList` drops the overflow after selection.
 */

import { logger } from '../utils/logger.js';

export const HEADLESS_LOCAL_COMPACT_MAX_TOOLS = 8;
export const HEADLESS_LOCAL_COMPACT_MAX_TOKENS = 1500;
export const HEADLESS_LOCAL_COMPACT_ALWAYS_INCLUDE = [
  'view_file',
  'bash',
  'search',
  'tool_search',
] as const;

/** Kept inside the ceiling: truncated observations name this recovery tool. */
const COMPACT_TOOL_PRIORITY = [
  ...HEADLESS_LOCAL_COMPACT_ALWAYS_INCLUDE,
  'restore_context',
] as const;

const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'vllm', 'lemonade']);

function explicitPromptCompactRefusal(value: string | undefined): boolean {
  const compact = value?.trim().toLowerCase();
  return compact === 'false' || compact === '0' || compact === 'off';
}

/**
 * Honour `--compact` without overriding an explicit refusal.
 *
 * `false` / `0` / `off` stay as they are and a headless warning is emitted.
 * Any other value (including unset) becomes `true`. The same predicate as
 * {@link isHeadlessPromptCompact}, so the flag and the variable cannot disagree.
 */
export function applyHeadlessCompactRequest(
  env: NodeJS.ProcessEnv,
  compactFlag: boolean,
): { refused: boolean } {
  if (!compactFlag) return { refused: false };
  if (explicitPromptCompactRefusal(env.CODEBUDDY_PROMPT_COMPACT)) {
    logger.warn(
      `--compact ignoré : CODEBUDDY_PROMPT_COMPACT=${env.CODEBUDDY_PROMPT_COMPACT ?? ''} a le dernier mot (false, 0 ou off).`,
    );
    return { refused: true };
  }
  env.CODEBUDDY_PROMPT_COMPACT = 'true';
  return { refused: false };
}

/**
 * Enforce the compact ceiling on the schemas about to be sent.
 *
 * Names already within the ceiling keep their order. Above it, the compact
 * core and `restore_context` are kept first, then the selection order fills
 * the remaining slots (surface tools included, never past the ceiling).
 */
export function capCompactToolList<T extends { function: { name: string } }>(
  tools: readonly T[],
  max: number = HEADLESS_LOCAL_COMPACT_MAX_TOOLS,
): T[] {
  if (!Number.isInteger(max) || max < 1 || tools.length <= max) return [...tools];
  const chosen: T[] = [];
  const used = new Set<string>();
  const byName = new Map<string, T>();
  for (const tool of tools) {
    if (!byName.has(tool.function.name)) byName.set(tool.function.name, tool);
  }
  for (const name of COMPACT_TOOL_PRIORITY) {
    if (chosen.length >= max) break;
    const tool = byName.get(name);
    if (!tool || used.has(name)) continue;
    chosen.push(tool);
    used.add(name);
  }
  for (const tool of tools) {
    if (chosen.length >= max) break;
    if (used.has(tool.function.name)) continue;
    chosen.push(tool);
    used.add(tool.function.name);
  }
  return chosen;
}



export function isLocalLlmProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  const provider = env.CODEBUDDY_PROVIDER?.trim().toLowerCase();
  if (provider && LOCAL_PROVIDERS.has(provider)) return true;
  if (provider) return false;
  if (env.OLLAMA_HOST?.trim()) return true;
  if (env.VLLM_BASE_URL?.trim()) return true;
  if (
    env.LMSTUDIO_BASE_URL?.trim()
    || env.LM_STUDIO_BASE_URL?.trim()
    || env.CODEBUDDY_LMSTUDIO_BASE_URL?.trim()
  ) {
    return true;
  }
  return false;
}

/**
 * Is the compact headless prompt in force?
 *
 * Two ways in, and the second is the point of this change:
 *
 * - **automatically**, against a local runtime, because those have small
 *   context windows. This was the original and only path.
 * - **on request**, via `CODEBUDDY_PROMPT_COMPACT=true` (or `1`/`on`), for any
 *   provider at all.
 *
 * The second exists because the saving is not about window size. Measured on a
 * one-sentence question against a remote provider: 5 991 input tokens by
 * default, and still 4 660 after replacing the entire system prompt and
 * disabling every tool. The agent surface is what costs, and a caller who only
 * wants an opinion on a text they supply has no use for it.
 *
 * `false`/`0`/`off` still wins over everything, so an automatic activation
 * stays escapable.
 */
export function isHeadlessPromptCompact(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CODEBUDDY_HEADLESS !== 'true') return false;
  const compact = env.CODEBUDDY_PROMPT_COMPACT?.trim().toLowerCase();
  if (explicitPromptCompactRefusal(env.CODEBUDDY_PROMPT_COMPACT)) return false;
  if (compact === 'true' || compact === '1' || compact === 'on') return true;
  return isLocalLlmProvider(env);
}

/**
 * @deprecated Renamed to {@link isHeadlessPromptCompact}: the mode is no longer
 * reserved to local runtimes. Kept so existing callers keep compiling.
 */
export function isHeadlessLocalPromptCompact(env: NodeJS.ProcessEnv = process.env): boolean {
  return isHeadlessPromptCompact(env);
}
