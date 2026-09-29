/** Exact model list emitted by older user-settings.json scaffolds. */
export const LEGACY_GENERATED_MODELS = [
  'grok-code-fast-1', 'grok-4-latest', 'grok-3-latest',
  'grok-3-fast', 'grok-3-mini-fast',
] as const;

interface LegacySelection {
  defaultModel?: string;
  models?: string[];
  baseURL?: string;
  apiKey?: string;
  provider?: string;
  model?: string;
  connection?: unknown;
}

/** Read-only migration: discard only the exact historical generated choice. */
export function withoutLegacyGeneratedSelection<T extends LegacySelection>(settings: T): T {
  if (settings.defaultModel !== LEGACY_GENERATED_MODELS[0] ||
      !Array.isArray(settings.models) ||
      settings.models.length !== LEGACY_GENERATED_MODELS.length ||
      !settings.models.every((model, index) => model === LEGACY_GENERATED_MODELS[index])) {
    return settings;
  }

  const selected = { ...settings };
  delete selected.defaultModel;
  delete selected.models;
  if (selected.baseURL === 'https://api.x.ai/v1' &&
      !selected.apiKey && !selected.provider && !selected.model && !selected.connection) {
    delete selected.baseURL;
  }
  return selected;
}
