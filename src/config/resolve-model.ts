/**
 * Model Resolution — Single resolution chain
 *
 * Replaces the 7+ different fallback chains that existed across the codebase,
 * each of which used DIFFERENT default values (causing the HTTP server to
 * resolve to a different model than the CLI).
 *
 * This module provides:
 *   - `inferProvider(modelId)` — detect provider from model name prefix
 *   - `resolveModel(input)` — deterministic priority chain
 */

import {
  type ProviderKey,
  MODEL_DEFAULTS,
  FALLBACK_PROVIDER,
  getProviderDefaultModel,
} from './model-defaults.js';

// ============================================================================
// Provider Inference
// ============================================================================

/**
 * Infer the provider from a model ID string based on naming conventions.
 *
 * Returns `null` when the model name doesn't match any known prefix.
 */
export function inferProvider(modelId: string): ProviderKey | null {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();

  if (lower.startsWith('grok-')) return 'xai';
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) return 'openai';
  if (lower.startsWith('claude-')) return 'anthropic';
  if (lower.startsWith('gemini-')) return 'google';
  if (lower.startsWith('deepseek')) return 'deepseek';
  if (lower.startsWith('devstral') || lower.startsWith('mistral') || lower.startsWith('mixtral')) return 'mistral';
  if (lower.startsWith('llama') || lower.startsWith('phi') || lower.startsWith('gemma') || lower.startsWith('command-r') || lower.startsWith('qwen')) return 'ollama';

  return null;
}

// ============================================================================
// Model Resolution
// ============================================================================

/**
 * Resolution source — tells the caller where the model came from.
 */
export type ModelSource = 'explicit' | 'saved' | 'env' | 'provider-default' | 'fallback';

/**
 * Input to the model resolution chain.
 * All fields are optional; the resolver walks the priority chain.
 */
export interface ResolveModelInput {
  /** Model explicitly passed via CLI flag or API parameter */
  explicitModel?: string;
  /** Model saved in user settings / profile */
  savedModel?: string;
  /** Known provider (skips inference) */
  provider?: ProviderKey;
}

/**
 * Result of model resolution.
 */
export interface ResolvedModel {
  /** The resolved model ID */
  model: string;
  /** The provider that owns this model */
  provider: ProviderKey;
  /** Where the model value came from */
  source: ModelSource;
}

/**
 * Deterministic model resolution with a single priority chain:
 *
 *   1. `explicitModel` (CLI flag, API param)
 *   2. `savedModel` (user settings)
 *   3. Provider env var (GROK_MODEL, OPENAI_MODEL, etc.)
 *   4. Provider default from MODEL_DEFAULTS
 *   5. FALLBACK_MODEL
 *
 * The `provider` hint is used when no model is explicitly given,
 * to look up the correct provider default.
 */
export function resolveModel(input: ResolveModelInput = {}): ResolvedModel {
  const { explicitModel, savedModel, provider } = input;

  // 1. Explicit model (highest priority)
  if (explicitModel) {
    const inferred = inferProvider(explicitModel) ?? provider ?? FALLBACK_PROVIDER;
    return { model: explicitModel, provider: inferred, source: 'explicit' };
  }

  // 2. Saved model
  if (savedModel) {
    const inferred = inferProvider(savedModel) ?? provider ?? FALLBACK_PROVIDER;
    return { model: savedModel, provider: inferred, source: 'saved' };
  }

  // 3 & 4. Provider env var → provider default
  if (provider) {
    const envOrDefault = getProviderDefaultModel(provider);
    // If the env var was set, the value differs from the static default
    const source: ModelSource =
      envOrDefault !== MODEL_DEFAULTS[provider] ? 'env' : 'provider-default';
    return { model: envOrDefault, provider, source };
  }

  // 5. Ultimate fallback
  return {
    model: getProviderDefaultModel(FALLBACK_PROVIDER),
    provider: FALLBACK_PROVIDER,
    source: 'fallback',
  };
}
