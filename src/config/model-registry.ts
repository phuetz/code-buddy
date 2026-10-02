/**
 * Model Registry — Unified model metadata, pricing, and aliases
 *
 * Sprint 2 of the Model Architecture refactor.
 *
 * Provides:
 *   - `ModelRegistry` class with pricing, aliases, and model listing
 *   - `getModelRegistry()` singleton accessor
 *   - Alias resolution from the model data table
 *   - Pricing only from model-price-data.ts; snapshot cost fields are ignored
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { inferProvider } from './resolve-model.js';
import { MODEL_PRICE_DATA, MODEL_ALIASES, UNKNOWN_MODEL_PRICE } from './model-price-data.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const cataloguePrices = new Map<string, ModelPricing>();

/** Explicit prices from the active user/project catalogue. */
export function installRegistryPriceOverlays(entries: Record<string, ModelPricing> | null): void {
  cataloguePrices.clear();
  if (!entries) return;
  for (const [name, price] of Object.entries(entries)) {
    const key = name.trim().toLowerCase();
    if (key && Number.isFinite(price.inputPerMillion) && Number.isFinite(price.outputPerMillion)
      && price.inputPerMillion >= 0 && price.outputPerMillion >= 0) {
      cataloguePrices.set(key, { ...price });
    }
  }
}

interface SnapshotEntry {
  maxTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
  /** Present in external snapshots for compatibility; never used as a price source. */
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
}

// ============================================================================
// Default pricing fallback
// ============================================================================

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
   *   1. Explicit catalogue price for the requested name or its alias target
   *   2. Versioned price data for the resolved model (exact match)
   *   3. Versioned price data for a dated snapshot or latest suffix
   *   4. Unknown-model estimate
   */
  getPricing(model: string): ModelPricing {
    const requested = model.trim().toLowerCase();
    const resolved = this.resolveAlias(requested).trim().toLowerCase();
    const overlay = cataloguePrices.get(requested) ?? cataloguePrices.get(resolved);
    if (overlay) return { ...overlay };
    const key = this.findPriceKey(resolved);
    const price = key ? MODEL_PRICE_DATA[key] : undefined;
    return price
      ? { inputPerMillion: price.inputPerMillion, outputPerMillion: price.outputPerMillion }
      : { ...UNKNOWN_MODEL_PRICE };
  }

  /** True when a model or its alias has a table or explicit catalogue rate. */
  hasPricing(model: string): boolean {
    const requested = model.trim().toLowerCase();
    const resolved = this.resolveAlias(requested).trim().toLowerCase();
    return cataloguePrices.has(requested) || cataloguePrices.has(resolved)
      || this.findPriceKey(resolved) !== undefined;
  }

  private findPriceKey(resolved: string): string | undefined {
    if (Object.hasOwn(MODEL_PRICE_DATA, resolved)) return resolved;
    // Only known snapshot/alias suffixes may inherit a base rate. A different
    // model generation must not inherit the old generation's price.
    let bestMatch = '';
    for (const key of Object.keys(MODEL_PRICE_DATA)) {
      const suffix = resolved.startsWith(key) ? resolved.slice(key.length) : '';
      if (/^-(?:latest|\d{8}|\d{4}-\d{2}-\d{2})(?:$|[-:])/.test(suffix) && key.length > bestMatch.length) {
        bestMatch = key;
      }
    }
    return bestMatch || undefined;
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
    for (const [alias, model] of Object.entries(MODEL_ALIASES)) this.aliases.set(alias, model);

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

let hasWarnedMissingSnapshot = false;

function loadSnapshot(): Record<string, SnapshotEntry> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const snapshotPath = join(__dirname, 'models-snapshot.json');
    const raw = readFileSync(snapshotPath, 'utf-8');
    return JSON.parse(raw) as Record<string, SnapshotEntry>;
  } catch {
    if (!hasWarnedMissingSnapshot) {
      logger.warn('models-snapshot.json introuvable ou invalide. Registre de modèles potentiellement vide.');
      hasWarnedMissingSnapshot = true;
    }
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
