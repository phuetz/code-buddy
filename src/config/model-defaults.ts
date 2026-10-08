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
  xai: 'grok-code-fast-1',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-5-5',
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
const ENV_VAR_MAP: Partial<Record<ProviderKey, string[]>> = {
  xai: ['GROK_MODEL'],
  openai: ['OPENAI_MODEL'],
  anthropic: ['ANTHROPIC_MODEL', 'CLAUDE_MODEL'],
  google: ['GEMINI_MODEL'],
};

/**
 * Return the default model for a provider, respecting env-var overrides.
 *
 * Resolution: env var > MODEL_DEFAULTS[provider] > FALLBACK_MODEL
 */
export function getProviderDefaultModel(provider: ProviderKey): string {
  for (const envVar of ENV_VAR_MAP[provider] ?? []) {
    const value = process.env[envVar]?.trim();
    if (value) return value;
  }
  return MODEL_DEFAULTS[provider] ?? FALLBACK_MODEL;
}

// ============================================================================
// Anthropic (Claude) — the only place that names Claude model ids
// ============================================================================

/**
 * Claude models offered by the model pickers when the live catalogue
 * (`GET https://api.anthropic.com/v1/models`) has not been queried. This is a
 * fallback list, not a contract: the API is the source of truth, and a retired
 * id answers 404 `not_found_error` (checked 2026-10-08: every `claude-3-*` and
 * `claude-*-4-20250514` id is gone).
 */
export const ANTHROPIC_MODEL_CATALOG: readonly string[] = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
];

/** Anthropic role models; each is overridable by an environment variable. */
export const ANTHROPIC_ROLE_ENV = {
  light: 'CODEBUDDY_ANTHROPIC_LIGHT_MODEL',
  architect: 'CODEBUDDY_ANTHROPIC_ARCHITECT_MODEL',
} as const;

/**
 * Claude model for a role: env override, else `MODEL_ROLES`.
 * `default` follows {@link getProviderDefaultModel} (`ANTHROPIC_MODEL`/`CLAUDE_MODEL`).
 */
export function getAnthropicModel(role: 'default' | 'light' | 'architect' = 'default'): string {
  if (role === 'default') return getProviderDefaultModel('anthropic');
  const override = process.env[ANTHROPIC_ROLE_ENV[role]]?.trim();
  if (override) return override;
  return (role === 'light' ? MODEL_ROLES.fast.anthropic : MODEL_ROLES.architect.anthropic) ?? MODEL_DEFAULTS.anthropic;
}

// ============================================================================
// Model Roles
// ============================================================================

/**
 * Suggested models for different use-case roles.
 * Callers may override via config; these are sensible defaults.
 */
export const MODEL_ROLES = {
  /** Fast models for quick operations (tab completion, summaries) */
  fast: {
    xai: 'grok-code-fast-1',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-5-5',
    google: 'gemini-2.5-flash-lite',
  } as Partial<Record<ProviderKey, string>>,

  /** Reasoning models for complex tasks */
  reasoning: {
    xai: 'grok-4-latest',
    openai: 'o4-mini',
    anthropic: 'claude-sonnet-5-5',
    google: 'gemini-2.5-pro',
  } as Partial<Record<ProviderKey, string>>,

  /** Architect models for planning / code review */
  architect: {
    xai: 'grok-4-latest',
    openai: 'gpt-4o',
    anthropic: 'claude-opus-5-5',
    google: 'gemini-2.5-pro',
  } as Partial<Record<ProviderKey, string>>,
} as const;

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
