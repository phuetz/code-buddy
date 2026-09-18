/**
 * Compact system prompt + RAG tool cap for `buddy -p` against a local
 * runtime (Ollama / LM Studio / vLLM), or against any provider on request.
 * Opt-in: `CODEBUDDY_PROMPT_COMPACT=true`. Opt-out: `CODEBUDDY_PROMPT_COMPACT=false`.
 */

export const HEADLESS_LOCAL_COMPACT_MAX_TOOLS = 8;
export const HEADLESS_LOCAL_COMPACT_MAX_TOKENS = 1500;
export const HEADLESS_LOCAL_COMPACT_ALWAYS_INCLUDE = [
  'view_file',
  'bash',
  'search',
  'tool_search',
] as const;

const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'vllm', 'lemonade']);

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
  if (compact === 'false' || compact === '0' || compact === 'off') return false;
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
