import { existsSync, readFileSync } from 'node:fs';
import { getConfigManager, parseTOML, resolveUserConfigFile } from '../config/toml-config.js';
import { findModelToolConfig } from '../config/model-tools.js';

export function readDoctorLocalContextCap(model: string): number | undefined {
  const file = resolveUserConfigFile();
  if (!existsSync(file)) return undefined;
  const document = parseTOML(readFileSync(file, 'utf8'));
  const models = document.models as Record<string, unknown> | undefined;
  const value = models?.[model] ?? models?.[JSON.stringify(model)];
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  const cap = Number(entry.context_window ?? entry.max_context_tokens);
  return Number.isSafeInteger(cap) && cap > 0 ? cap : undefined;
}

/** Persist a model-specific ceiling through the ordinary user configuration writer. */
export function persistDoctorLocalContextCap(model: string, maxContext: number): number {
  const file = resolveUserConfigFile();
  const document = existsSync(file) ? parseTOML(readFileSync(file, 'utf8')) : {};
  const source = document.models;
  const models = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } as Record<string, unknown> : {};
  // Quote the tag so colon, dots and slashes remain one legal TOML key.
  // Accept either spelling while the catalogue lane replaces its old parser.
  const quotedModel = JSON.stringify(model);
  const existing = models[model] ?? models[quotedModel];
  const entry = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } as Record<string, unknown> : {};
  const current = Number(entry.context_window ?? entry.max_context_tokens);
  const declared = findModelToolConfig(model)?.contextWindow ?? maxContext;
  const cap = Math.min(maxContext, declared, Number.isSafeInteger(current) && current > 0 ? current : maxContext);
  entry.provider ??= 'ollama';
  entry.max_context_tokens = cap;
  delete entry.context_window;
  delete models[model];
  models[quotedModel] = entry;
  getConfigManager().saveUserConfig('models', models);
  return cap;
}
