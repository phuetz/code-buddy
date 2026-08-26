/**
 * Model ↔ provider compatibility for the CLI model resolver (`loadModel`).
 *
 * A model saved in settings (or left over from a previous provider) must never
 * be sent to a backend that cannot serve it: the result is a cryptic 404 on the
 * very first turn. Gateways (OpenRouter, OmniRoute, Bedrock, Azure, Copilot,
 * Together, …) legitimately re-serve first-party families, so they keep the
 * permissive default; only first-party backends are strict.
 */

export const LOCAL_RUNTIME_PROVIDERS: ReadonlySet<string> = new Set(['ollama', 'lmstudio', 'vllm']);

/** A model id that only makes sense on a hosted cloud backend (never a local Ollama tag). */
export function looksLikeCloudModel(model: string): boolean {
  return /grok|^gpt-|^o[1-9]|codex|claude|gemini/i.test(model);
}

/**
 * First-party model families and the only first-party provider that serves
 * them directly. A slug from one family sent to ANOTHER first-party backend
 * (e.g. a stale `grok-code-fast-1` default against NVIDIA NIM, Anthropic or
 * Gemini) can only 404.
 */
const FIRST_PARTY_MODEL_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/grok/i, 'grok'],
  [/^claude-/i, 'anthropic'],
  [/^gemini-/i, 'gemini'],
  [/^(?:gpt-|o[1-9]\b|codex)/i, 'openai'],
];

/** Backends that serve exactly one vendor's catalog (never a cross-vendor gateway). */
const FIRST_PARTY_PROVIDERS: ReadonlySet<string> = new Set([
  'grok', 'anthropic', 'gemini', 'openai', 'chatgpt', 'nvidia', 'mistral', 'groq', 'cerebras', 'deepseek',
]);

export function isModelCompatibleWithProvider(model: string, provider?: string): boolean {
  if (!provider) return true;
  const looksGrok = /grok/i.test(model);
  if (provider === 'grok') return looksGrok;
  if (provider === 'chatgpt') return /^(gpt-|o[1-9]|codex)/i.test(model) && !looksGrok;
  if (LOCAL_RUNTIME_PROVIDERS.has(provider)) return !looksLikeCloudModel(model);
  if (FIRST_PARTY_PROVIDERS.has(provider)) {
    const family = FIRST_PARTY_MODEL_FAMILIES.find(([pattern]) => pattern.test(model));
    if (family && family[1] !== provider) return false;
  }
  return true;
}
