/**
 * Compact system prompt + RAG tool cap for `buddy -p` against a local
 * runtime (Ollama / LM Studio / vLLM). Opt-out: `CODEBUDDY_PROMPT_COMPACT=false`.
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

export function isHeadlessLocalPromptCompact(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CODEBUDDY_HEADLESS !== 'true') return false;
  const compact = env.CODEBUDDY_PROMPT_COMPACT?.trim().toLowerCase();
  if (compact === 'false' || compact === '0' || compact === 'off') return false;
  return isLocalLlmProvider(env);
}
