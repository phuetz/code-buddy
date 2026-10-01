/**
 * Model Defaults — Single Source of Truth
 *
 * This module defines the canonical default model for every provider and
 * the resolution helpers that replace 124+ hardcoded model-name strings
 * scattered across the codebase.
 *
 * IMPORTANT: This file must have ZERO imports from the rest of the project
 * to prevent circular dependency chains.
 */

// ============================================================================
// Provider Keys
// ============================================================================

/**
 * Canonical provider identifiers used for model resolution.
 * These map to the upstream API provider, NOT the UI-facing config names.
 */
export type ProviderKey =
  | 'azure'
  | 'bedrock'
  | 'groq'
  | 'fal'
  | 'openrouter'
  | 'lemonade'
  | 'chatgpt'
  | 'xai'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'lmstudio'
  | 'deepseek'
  | 'mistral';

// ============================================================================
// Default Models
// ============================================================================

/**
 * The single canonical default model for each provider.
 * Every fallback chain in the codebase must resolve through this map.
 */
export const MODEL_DEFAULTS: Record<ProviderKey, string> = {
  azure: 'gpt-4o',
  bedrock: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  groq: 'qwen/qwen3.8-27b',
  fal: 'pixverse-v6',
  openrouter: 'openrouter/free',
  lemonade: 'Qwen3.6-35B-A3B-MTP-GGUF',
  chatgpt: 'gpt-6-sol',
  xai: 'grok-code-fast-1',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.5-flash',
  ollama: 'llama3.2',
  lmstudio: 'local-model',
  deepseek: 'deepseek-chat',
  mistral: 'devstral-latest',
};

/** The ultimate fallback when no provider can be determined. */
export const FALLBACK_MODEL: string = MODEL_DEFAULTS.xai;

/** The provider used when nothing else is configured. */
export const FALLBACK_PROVIDER: ProviderKey = 'xai';

// ============================================================================
// Environment Variable Resolution
// ============================================================================

/**
 * Maps each provider to the env var that can override its default model.
 */
const ENV_VAR_MAP: Partial<Record<ProviderKey, readonly string[]>> = {
  azure: ['AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_MODEL'],
  bedrock: ['AWS_BEDROCK_MODEL', 'BEDROCK_MODEL'],
  groq: ['GROQ_MODEL'],
  fal: ['FAL_VIDEO_MODEL'],
  xai: ['GROK_MODEL', 'XAI_MODEL'],
  chatgpt: ['CHATGPT_MODEL'],
  lemonade: ['LEMONADE_MODEL'],
  openrouter: ['OPENROUTER_MODEL'],
  openai: ['OPENAI_MODEL'],
  anthropic: ['ANTHROPIC_MODEL'],
  google: ['GEMINI_MODEL', 'GOOGLE_MODEL'],
  ollama: ['CODEBUDDY_LOCAL_MODEL', 'OLLAMA_MODEL'],
  lmstudio: ['LMSTUDIO_MODEL'],
  deepseek: ['DEEPSEEK_MODEL'],
  mistral: ['MISTRAL_MODEL'],
};

export type ProviderModelDefaults = Partial<Record<ProviderKey, Record<string, string | string[]>>>;
let configuredDefaults: () => ProviderModelDefaults = () => ({});

/** The TOML loader supplies a lazy accessor, keeping this module import-free. */
export function registerModelDefaultsConfig(reader: () => ProviderModelDefaults): void {
  configuredDefaults = reader;
}

export function getProviderDefaultModel(
  provider: ProviderKey,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallback: string = MODEL_DEFAULTS[provider],
): string {
  for (const key of ENV_VAR_MAP[provider] ?? []) {
    if (env[key]?.trim()) return env[key]!.trim();
  }
  const configured = configuredDefaults()[provider]?.primary;
  return typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : fallback ?? FALLBACK_MODEL;
}

/** Role override > provider override > built-in role > built-in primary. */
export function getModelForRole(
  provider: ProviderKey,
  role: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env[`CODEBUDDY_${provider.toUpperCase()}_MODEL_${role.toUpperCase()}`]?.trim();
  if (override) return override;
  const configured = configuredDefaults()[provider]?.[role];
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const primary = getProviderDefaultModel(provider, env);
  const hasPrimaryOverride = (ENV_VAR_MAP[provider] ?? []).some(key => env[key]?.trim())
    || typeof configuredDefaults()[provider]?.primary === 'string';
  if (!['embedding', 'transcription', 'speech', 'image', 'video', 'tokenizer', 'file', 'web', 'photo', 'heavy', 'krea_text_encoder', 'h3_text_encoder', 'draft', 'target', 'onboarding'].includes(role) && hasPrimaryOverride) return primary;
  return ROLE_MODEL_DEFAULTS[provider]?.[role] ?? primary;
}

export function hasProviderFallbackOverride(provider: ProviderKey): boolean {
  return process.env[`CODEBUDDY_${provider.toUpperCase()}_FALLBACK_MODELS`] !== undefined
    || Array.isArray(configuredDefaults()[provider]?.fallback);
}

export function getProviderFallbackModels(
  provider: ProviderKey,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const raw = env[`CODEBUDDY_${provider.toUpperCase()}_FALLBACK_MODELS`];
  if (raw !== undefined) return raw.split(',').map(m => m.trim()).filter(Boolean);
  const configured = configuredDefaults()[provider]?.fallback;
  if (Array.isArray(configured)) return configured.map(m => m.trim()).filter(Boolean);
  return provider === 'azure' ? ['gpt-4']
    : provider === 'google' ? [...GEMINI_FALLBACK_CHAIN]
    : provider === 'chatgpt' ? [getModelForRole('chatgpt', 'fallback', env)] : [];
}

const ROLE_MODEL_DEFAULTS: Partial<Record<ProviderKey, Record<string, string>>> = {
  xai: { quality: 'grok-4-latest', review: 'grok-4-latest', fast: 'grok-code-fast-1', reasoning: 'grok-4-latest', architect: 'grok-4-latest', vision: 'grok-2-vision', search: 'grok-4.20-reasoning', embedding: 'grok-embedding', image: 'grok-imagine-image', video: 'grok-imagine-video' },
  openai: { fast: 'gpt-4o-mini', reasoning: 'o4-mini', vision: 'gpt-4o', tokenizer: 'gpt-4', embedding: 'text-embedding-3-small', transcription: 'whisper-1', speech: 'tts-1', image: 'gpt-image-2.5-flare' },
  chatgpt: { companion: 'gpt-5.6-sol', fallback: 'gpt-5.5' },
  anthropic: { fast: 'claude-haiku-4-5-20251001', architect: 'claude-opus-4-20250514', advisor: 'claude-opus-4-7' },
  google: { cli: 'gemini-3.1-pro-preview', gemma: 'gemma-4-9b-it', fast: 'gemini-2.5-flash-lite', reasoning: 'gemini-2.5-pro', architect: 'gemini-2.5-pro' },
  openrouter: { vision: 'google/gemini-2.5-flash' },
  mistral: { peer: 'mistral-small-latest' },
  ollama: { hint: 'qwen2.5-coder:7b', runtime: 'llama3.1', embedding: 'nomic-embed-text', file: 'llama-3.1-8b-q4_k_m.gguf', photo: 'qwen3:4b-instruct', autonomy: 'qwen2.5:7b-instruct', web: 'Llama-3.1-8B-Instruct-q4f16_1-MLC', heavy: 'qwen2.5-72b-instruct', krea_text_encoder: 'qwen3vl_4b_fp8_scaled.safetensors', h3_text_encoder: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', video: 'minimax-h3', onboarding: 'qwen3:8b', draft: 'qwen2.5-0.5b', target: 'qwen2.5-7b' },
};

// ============================================================================
// Model Roles
// ============================================================================

/**
 * Suggested models for different use-case roles.
 * Callers may override via config; these are sensible defaults.
 */
export const MODEL_ROLES = Object.fromEntries(
  ['fast', 'reasoning', 'architect'].map(role => [role, Object.fromEntries(
    (Object.keys(MODEL_DEFAULTS) as ProviderKey[]).map(provider => [provider,
      ROLE_MODEL_DEFAULTS[provider]?.[role] ?? MODEL_DEFAULTS[provider],
    ]),
  )]),
) as Record<'fast' | 'reasoning' | 'architect', Partial<Record<ProviderKey, string>>>;

// ============================================================================
// Gemini Fallback Chain
// ============================================================================

/**
 * Ordered fallback chain for Gemini models.
 * Used when the primary Gemini model returns 404/400 "Model not found".
 */
export const GEMINI_FALLBACK_CHAIN: string[] = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

/** Offline catalogue; runtime discovery and explicit configuration take priority. */
export const PROVIDER_MODEL_LISTS: Partial<Record<ProviderKey, string[]>> = {
  xai: ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4-1-fast', 'grok-4-latest', 'grok-4-fast', 'grok-code-fast-1', 'grok-3-latest', 'grok-3-fast', 'grok-3-mini'],
  chatgpt: ['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-thinking', 'gemini-1.5-pro', 'gemini-1.5-flash'],
};

export function getProviderModels(provider: ProviderKey): string[] {
  const configured = configuredDefaults()[provider]?.models;
  const models = Array.isArray(configured) ? configured : PROVIDER_MODEL_LISTS[provider] ?? [];
  return [...new Set([getProviderDefaultModel(provider), ...models])];
}
