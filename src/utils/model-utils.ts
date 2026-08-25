/**
 * Model validation and utility functions
 */

import { SUPPORTED_MODELS } from '../config/constants.js';
import { findModelToolConfig } from '../config/model-tools.js';
import { ValidationError } from './errors.js';

export type ModelName = keyof typeof SUPPORTED_MODELS;
export type ModelProvider = 'xai' | 'anthropic' | 'google' | 'openai' | 'lmstudio' | 'ollama' | 'bundled-gemma4' | 'unknown';

export interface ModelInfo {
  maxTokens: number;
  provider: ModelProvider;
  isSupported: boolean;
}

/**
 * Check if a model is officially supported
 */
export function isSupportedModel(model: string): model is ModelName {
  return model in SUPPORTED_MODELS;
}

function resolveSupportedModelName(model: string): ModelName | null {
  if (isSupportedModel(model)) return model;

  const withoutLatest = model.endsWith(':latest') ? model.slice(0, -':latest'.length) : '';
  if (withoutLatest && isSupportedModel(withoutLatest)) return withoutLatest;

  return null;
}

/**
 * Get information about a model
 */
export function getModelInfo(model: string): ModelInfo {
  const supportedModel = resolveSupportedModelName(model);
  if (supportedModel) {
    return {
      ...SUPPORTED_MODELS[supportedModel],
      isSupported: true,
    };
  }

  // `SUPPORTED_MODELS` ne liste que les modèles des fournisseurs directs. Les modèles
  // servis par une passerelle (OpenRouter, NVIDIA…) sont décrits dans `model-tools.ts`,
  // qui est la source de vérité des capacités par modèle. Sans ce recours, tous étaient
  // annoncés « non supportés » et retombaient sur 8 192 tokens : le million de contexte
  // de minimax/minimax-m3 restait inutilisé, et son prompt système tronqué à 14 336.
  const parCapacites = findModelToolConfig(model);
  if (parCapacites?.contextWindow) {
    return {
      maxTokens: parCapacites.contextWindow,
      provider: 'unknown',
      isSupported: true,
    };
  }

  // Return default info for unknown models
  return {
    maxTokens: 8192,
    provider: 'unknown',
    isSupported: false,
  };
}

/**
 * Validate a model name and throw if invalid
 * @param model Model name to validate
 * @param strict If true, only accept officially supported models
 */
export function validateModel(model: string, strict: boolean = false): void {
  if (!model || model.trim() === '') {
    throw new ValidationError('Model name cannot be empty', 'model', model);
  }

  if (strict && !isSupportedModel(model)) {
    const supportedList = Object.keys(SUPPORTED_MODELS).join(', ');
    throw new ValidationError(
      `Unsupported model: ${model}. Supported models: ${supportedList}`,
      'model',
      model
    );
  }
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(provider: ModelProvider = 'xai'): string {
  switch (provider) {
    case 'xai':
      return 'grok-4-latest';
    case 'anthropic':
      return 'claude-opus-4-6';
    case 'openai':
      return 'gpt-4o';
    case 'google':
      return 'gemini-2.5-pro';
    case 'lmstudio':
      return 'local-model';
    case 'ollama':
      return 'llama3.2';
    default:
      return 'grok-4-latest';
  }
}

/**
 * Get a list of all supported models
 */
export function getSupportedModels(): ModelName[] {
  return Object.keys(SUPPORTED_MODELS) as ModelName[];
}

/**
 * Get models by provider
 */
export function getModelsByProvider(provider: ModelProvider): string[] {
  return Object.entries(SUPPORTED_MODELS)
    .filter(([_, info]) => info.provider === provider)
    .map(([name]) => name);
}

/**
 * Suggest a model based on a partial name (fuzzy matching)
 */
export function suggestModel(partial: string): string[] {
  const lowerPartial = partial.toLowerCase();
  const models = getSupportedModels();

  // Exact match first
  const exactMatch = models.filter((m) => m.toLowerCase() === lowerPartial);
  if (exactMatch.length > 0) return exactMatch;

  // Starts with
  const startsWith = models.filter((m) =>
    m.toLowerCase().startsWith(lowerPartial)
  );
  if (startsWith.length > 0) return startsWith;

  // Contains
  const contains = models.filter((m) => m.toLowerCase().includes(lowerPartial));
  return contains;
}

/**
 * Format model information for display
 */
export function formatModelInfo(model: string): string {
  const info = getModelInfo(model);

  let output = `Model: ${model}\n`;
  output += `Provider: ${info.provider}\n`;
  output += `Max Tokens: ${info.maxTokens.toLocaleString()}\n`;
  output += `Supported: ${info.isSupported ? 'Yes' : 'No (using default settings)'}`;

  return output;
}
