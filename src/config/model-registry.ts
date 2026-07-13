/**
 * Model Registry — Unified model metadata, pricing, and aliases
 *
 * Sprint 2 of the Model Architecture refactor.
 *
 * Provides:
 *   - `ModelRegistry` class with pricing, aliases, and model listing
 *   - `getModelRegistry()` singleton accessor
 *   - Alias resolution (e.g., 'sonnet' → 'claude-sonnet-4-20250514')
 *   - Pricing from models-snapshot.json with prefix-match fallback
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { inferProvider } from './resolve-model.js';

// ============================================================================
// Types
// ============================================================================

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

interface SnapshotEntry {
  maxTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
}

// ============================================================================
// Default pricing fallback
// ============================================================================

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
};

/**
 * Built-in pricing for known model families (per 1M tokens).
 * Used when the snapshot doesn't contain pricing data.
 */
const BUILTIN_PRICING: Record<string, ModelPricing> = {
  // xAI Grok
  'grok-4': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'grok-3': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'grok-3-fast': { inputPerMillion: 0.60, outputPerMillion: 4.0 },
  'grok-3-mini': { inputPerMillion: 0.30, outputPerMillion: 0.50 },
  'grok-code-fast': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'grok-2': { inputPerMillion: 2.0, outputPerMillion: 10.0 },
  'grok-2-mini': { inputPerMillion: 0.20, outputPerMillion: 1.0 },

  // OpenAI
  'gpt-5.6-sol': { inputPerMillion: 5.0, outputPerMillion: 30.0 },
  'gpt-5.6': { inputPerMillion: 5.0, outputPerMillion: 30.0 },
  'gpt-5': { inputPerMillion: 5.0, outputPerMillion: 15.0 },
  'gpt-4.1': { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4-turbo': { inputPerMillion: 10.0, outputPerMillion: 30.0 },
  'gpt-4': { inputPerMillion: 30.0, outputPerMillion: 60.0 },
  'gpt-3.5-turbo': { inputPerMillion: 0.50, outputPerMillion: 1.50 },

  // Anthropic
  'claude-opus-4': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'claude-sonnet-4': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-haiku-4': { inputPerMillion: 0.80, outputPerMillion: 4.0 },
  'claude-3-opus': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'claude-3-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  'claude-3.5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },

  // Google Gemini
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },

  // Local (free)
  'local': { inputPerMillion: 0, outputPerMillion: 0 },
  'ollama': { inputPerMillion: 0, outputPerMillion: 0 },
  'lmstudio': { inputPerMillion: 0, outputPerMillion: 0 },
};

// ============================================================================
// ModelRegistry
// ============================================================================

export class ModelRegistry {
  private snapshot: Record<string, SnapshotEntry>;
  private aliases = new Map<string, string>();

  constructor(snapshot?: Record<string, SnapshotEntry>) {
    this.snapshot = snapshot ?? loadSnapshot();
    this.loadAliases();
  }

  // --------------------------------------------------------------------------
  // Pricing
  // --------------------------------------------------------------------------

  /**
   * Get pricing for a model.
   *
   * Resolution order:
   *   1. Snapshot per-token cost fields (converted to per-1M)
   *   2. Built-in pricing (exact match)
   *   3. Built-in pricing (prefix match)
   *   4. Default fallback
   */
  getPricing(model: string): ModelPricing {
    // 1. Check snapshot cost fields
    const entry = this.snapshot[model];
    if (entry) {
      const inputCost = entry.input_cost_per_token ?? entry.inputCostPerToken;
      const outputCost = entry.output_cost_per_token ?? entry.outputCostPerToken;
      if (typeof inputCost === 'number' && typeof outputCost === 'number') {
        return {
          inputPerMillion: inputCost * 1_000_000,
          outputPerMillion: outputCost * 1_000_000,
        };
      }
    }

    // 2. Exact match in built-in pricing
    if (BUILTIN_PRICING[model]) {
      return { ...BUILTIN_PRICING[model] };
    }

    // 3. Prefix match in built-in pricing (longest prefix wins)
    const lower = model.toLowerCase();
    let bestMatch = '';
    for (const key of Object.keys(BUILTIN_PRICING)) {
      if (lower.startsWith(key.toLowerCase()) && key.length > bestMatch.length) {
        bestMatch = key;
      }
    }
    if (bestMatch) {
      const matched = BUILTIN_PRICING[bestMatch];
      if (matched) {
        return { ...matched };
      }
    }

    // 4. Default
    return { ...DEFAULT_PRICING };
  }

  // --------------------------------------------------------------------------
  // Aliases
  // --------------------------------------------------------------------------

  /**
   * Resolve a shorthand alias to a full model ID.
   * Returns the input unchanged if no alias matches.
   */
  resolveAlias(alias: string): string {
    return this.aliases.get(alias.toLowerCase()) || alias;
  }

  /**
   * Register a custom alias.
   */
  setAlias(alias: string, model: string): void {
    this.aliases.set(alias.toLowerCase(), model);
  }

  /**
   * Get all registered aliases.
   */
  getAliases(): Map<string, string> {
    return new Map(this.aliases);
  }

  // --------------------------------------------------------------------------
  // Model listing
  // --------------------------------------------------------------------------

  /**
   * List all models in the snapshot.
   * Optionally filter by provider prefix.
   */
  listModels(filter?: { provider?: string }): string[] {
    const models = Object.keys(this.snapshot);

    if (filter?.provider) {
      return models.filter(m => {
        const prov = inferProvider(m);
        return prov === filter.provider;
      });
    }

    return models;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private loadAliases(): void {
    // Built-in aliases
    this.aliases.set('sonnet', 'claude-sonnet-4-20250514');
    this.aliases.set('opus', 'claude-opus-4-6');
    this.aliases.set('haiku', 'claude-haiku-4-5-20251001');
    this.aliases.set('gpt4', 'gpt-4o');
    this.aliases.set('gpt-5.6', 'gpt-5.6-sol');
    this.aliases.set('gemini', 'gemini-2.5-flash');
    this.aliases.set('grok', 'grok-code-fast-1');
    this.aliases.set('flash', 'gemini-2.5-flash');
    this.aliases.set('mini', 'gpt-4o-mini');

    // Env var overrides: CODEBUDDY_ALIAS_SONNET etc.
    for (const [alias] of this.aliases) {
      const envKey = `CODEBUDDY_ALIAS_${alias.toUpperCase()}`;
      if (process.env[envKey]) {
        this.aliases.set(alias, process.env[envKey]!);
      }
    }
  }
}

// ============================================================================
// Snapshot loader
// ============================================================================

function loadSnapshot(): Record<string, SnapshotEntry> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const snapshotPath = join(__dirname, 'models-snapshot.json');
    const raw = readFileSync(snapshotPath, 'utf-8');
    return JSON.parse(raw) as Record<string, SnapshotEntry>;
  } catch {
    return {};
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: ModelRegistry | null = null;

export function getModelRegistry(): ModelRegistry {
  if (!_instance) {
    _instance = new ModelRegistry();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetModelRegistry(): void {
  _instance = null;
}
