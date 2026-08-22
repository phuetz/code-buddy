/**
 * Fleet model inventory.
 *
 * Builds a runtime view of "what models are actually available right now"
 * across the current machine and the Tailnet peers it can see. The goal is to
 * keep model discovery out of hardcoded lists and attach enough metadata for
 * routing/UI decisions: source machine, launch hint, capability profile, and
 * benchmark score.
 */

import os from 'node:os';
import { getLocalCapabilities } from './capability-registry.js';
import { loadBenchmarkScoreMap } from '../agent/model-benchmark.js';
import type { FleetModelDescriptor, FleetProvider, ModelStrength } from './types.js';
import { TailscaleManager } from '../integrations/tailscale.js';
import { getModelStrengths, getModelToolConfig } from '../config/model-tools.js';
import { normalizeBaseURL } from '../utils/base-url.js';
import { findRuntimeProvider } from '../providers/provider-catalog.js';

export type ModelExecutionLocation = 'local' | 'lan' | 'cloud';

export interface ModelInventoryEntry {
  provider: FleetProvider;
  runtimeProvider: string;
  model: string;
  baseURL?: string;
  machineLabel: string;
  machineSpec?: {
    cpu?: string;
    gpu?: string;
    ramGb?: number;
  };
  executionLocation: ModelExecutionLocation;
  launchHint: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsReasoning: boolean;
  supportsToolCalls: boolean;
  supportsVision: boolean;
  strengths: ModelStrength[];
  benchmarkScore?: number;
  bestFor: string[];
  source: 'local-capability' | 'tailnet-peer' | 'catalog';
}

export interface ModelInventorySnapshot {
  updatedAt: string;
  machineLabel: string;
  entries: ModelInventoryEntry[];
}

export interface BuildModelInventoryOptions {
  env?: NodeJS.ProcessEnv;
  includeTailnetPeers?: boolean;
  forceCapabilityRefresh?: boolean;
}

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';

export async function buildModelInventory(
  options: BuildModelInventoryOptions = {},
): Promise<ModelInventorySnapshot> {
  const env = options.env ?? process.env;
  const local = await getLocalCapabilities({ force: options.forceCapabilityRefresh });
  const benchmarkScores = await loadBenchmarkScoreMap();
  const entries: ModelInventoryEntry[] = [];

  for (const model of local.models) {
    const cfg = getModelToolConfig(model.id);
    const baseURL = resolveBaseUrlForProvider(model.provider, env);
    entries.push(enrichEntry({
      provider: model.provider,
      runtimeProvider: runtimeProviderKey(model.provider),
      model: model.id,
      baseURL,
      machineLabel: local.machineLabel,
      machineSpec: local.machineSpec,
      executionLocation: providerExecutionLocation(model.provider),
      launchHint: buildLaunchHint({
        provider: model.provider,
        model: model.id,
        baseURL,
        machineLabel: local.machineLabel,
      }),
      contextWindow: model.contextWindow || cfg.contextWindow || 8192,
      maxOutputTokens: cfg.maxOutputTokens ?? 8192,
      supportsReasoning: cfg.supportsReasoning ?? false,
      supportsToolCalls: cfg.supportsToolCalls ?? true,
      supportsVision: cfg.supportsVision ?? false,
      strengths: model.strengths,
      benchmarkScore: benchmarkScores.get(buildBenchmarkKey(baseURL, model.id)),
      bestFor: deriveBestFor(model, cfg),
      source: 'local-capability',
    }));
  }

  if (options.includeTailnetPeers !== false) {
    try {
      const peers = await TailscaleManager.getInstance().discoverOllamaPeers();
      for (const peer of peers) {
        for (const model of peer.models) {
          const cfg = getModelToolConfig(model);
          entries.push(enrichEntry({
            provider: 'ollama',
            runtimeProvider: 'ollama',
            model,
            baseURL: peer.baseURL,
            machineLabel: peer.hostname,
            executionLocation: 'lan',
            launchHint: `On ${peer.hostname}: ollama serve && ollama run ${model}`,
            contextWindow: cfg.contextWindow || 8192,
            maxOutputTokens: cfg.maxOutputTokens ?? 8192,
            supportsReasoning: cfg.supportsReasoning ?? false,
            supportsToolCalls: cfg.supportsToolCalls ?? true,
            supportsVision: cfg.supportsVision ?? false,
            strengths: cfgToStrengths(cfg, model),
            benchmarkScore: benchmarkScores.get(buildBenchmarkKey(peer.baseURL, model)),
            bestFor: deriveBestFor({ id: model, provider: 'ollama', contextWindow: cfg.contextWindow ?? 8192, strengths: cfgToStrengths(cfg, model) }, cfg),
            source: 'tailnet-peer',
          }));
        }
      }
    } catch {
      // Tailnet discovery is opportunistic; local inventory should still work.
    }
  }

  const deduped = dedupeEntries(entries);
  deduped.sort((a, b) =>
    (b.benchmarkScore ?? -Infinity) - (a.benchmarkScore ?? -Infinity)
    || a.machineLabel.localeCompare(b.machineLabel)
    || a.provider.localeCompare(b.provider)
    || a.model.localeCompare(b.model),
  );

  return {
    updatedAt: new Date().toISOString(),
    machineLabel: local.machineLabel || os.hostname(),
    entries: deduped,
  };
}

export function summarizeInventoryByProvider(snapshot: ModelInventorySnapshot): Record<string, ModelInventoryEntry[]> {
  const grouped: Record<string, ModelInventoryEntry[]> = {};
  for (const entry of snapshot.entries) {
    const key = entry.provider;
    grouped[key] = grouped[key] || [];
    grouped[key]!.push(entry);
  }
  return grouped;
}

function enrichEntry(entry: ModelInventoryEntry): ModelInventoryEntry {
  return {
    ...entry,
    ...(entry.baseURL ? { baseURL: normalizeBaseURL(entry.baseURL) } : {}),
    bestFor: Array.from(new Set(entry.bestFor)),
  };
}

function buildBenchmarkKey(baseURL: string | undefined, model: string): string {
  if (!baseURL) return '';
  return `${normalizeBaseURL(baseURL)}::${model}`;
}

function dedupeEntries(entries: ModelInventoryEntry[]): ModelInventoryEntry[] {
  const seen = new Map<string, ModelInventoryEntry>();
  for (const entry of entries) {
    const key = [
      entry.provider,
      entry.baseURL?.replace(/\/+$/, '') ?? '',
      entry.machineLabel,
      entry.model,
    ].join('|');
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, entry);
      continue;
    }
    const existingScore = existing.benchmarkScore ?? -Infinity;
    const incomingScore = entry.benchmarkScore ?? -Infinity;
    if (incomingScore > existingScore) {
      seen.set(key, entry);
    }
  }
  return Array.from(seen.values());
}

function resolveBaseUrlForProvider(provider: FleetProvider, env: NodeJS.ProcessEnv): string | undefined {
  if (provider === 'ollama') {
    return normalizeOpenAICompatibleLocalBaseURL(
      env['OLLAMA_BASE_URL'] ?? env['OLLAMA_HOST'] ?? DEFAULT_OLLAMA_BASE_URL,
    );
  }
  if (provider === 'lm-studio') {
    return normalizeOpenAICompatibleLocalBaseURL(
      env['LMSTUDIO_BASE_URL']
      ?? env['LM_STUDIO_BASE_URL']
      ?? env['LMSTUDIO_HOST']
      ?? env['LM_STUDIO_HOST']
      ?? DEFAULT_LMSTUDIO_BASE_URL,
    );
  }
  if (provider === 'chatgpt-oauth') {
    return 'https://chatgpt.com/backend-api/codex';
  }
  const runtime = findRuntimeProvider(provider);
  return runtime?.defaultBaseURL;
}

function normalizeOpenAICompatibleLocalBaseURL(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = new URL(raw.trim());
    let pathname = parsed.pathname.replace(/\/+$/, '');
    pathname = pathname
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/models$/i, '')
      .replace(/\/+$/, '');

    if (!pathname || pathname === '/') {
      parsed.pathname = '/v1';
    } else if (!/\/v1$/i.test(pathname)) {
      parsed.pathname = `${pathname}/v1`;
    } else {
      parsed.pathname = pathname;
    }

    return normalizeBaseURL(parsed.toString());
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

function providerExecutionLocation(provider: FleetProvider): ModelExecutionLocation {
  if (provider === 'ollama' || provider === 'lm-studio') return 'local';
  if (provider === 'chatgpt-oauth' || provider === 'anthropic' || provider === 'openai' || provider === 'gemini' || provider === 'grok' || provider === 'mistral') {
    return 'cloud';
  }
  // OmniRoute listens on loopback but routes inference to cloud free tiers.
  if (provider === 'omniroute') return 'cloud';
  return 'local';
}

function buildLaunchHint(input: {
  provider: FleetProvider;
  model: string;
  baseURL?: string;
  machineLabel: string;
}): string {
  if (input.provider === 'ollama') {
    return `On ${input.machineLabel}: ollama serve && ollama run ${input.model}`;
  }
  if (input.provider === 'lm-studio') {
    return `On ${input.machineLabel}: open LM Studio, enable the local server, then select ${input.model}`;
  }
  if (input.provider === 'chatgpt-oauth') {
    return 'ChatGPT OAuth subscription backend; no local launch step';
  }
  if (input.baseURL) {
    return `Use ${input.baseURL} with ${input.model}`;
  }
  return `Use ${input.model}`;
}

function runtimeProviderKey(provider: FleetProvider): string {
  if (provider === 'lm-studio') return 'lmstudio';
  if (provider === 'chatgpt-oauth') return 'chatgpt';
  return provider;
}

/** Delegates to `getModelStrengths()` (config/model-tools.ts, single source of truth). */
function cfgToStrengths(cfg: ReturnType<typeof getModelToolConfig>, model: string): ModelStrength[] {
  void cfg; // capabilities are re-derived from the config inside getModelStrengths
  return getModelStrengths(model);
}

function deriveBestFor(
  model: Pick<FleetModelDescriptor, 'id' | 'provider' | 'contextWindow' | 'strengths'>,
  cfg: ReturnType<typeof getModelToolConfig>,
): string[] {
  const out = new Set<string>();
  const strengths = new Set(model.strengths);
  if (strengths.has('vision')) out.add('vision');
  if (strengths.has('code') || cfg.supportsToolCalls) out.add('coding');
  if (strengths.has('reasoning') || strengths.has('thinking')) {
    out.add('council');
    out.add('review');
    out.add('research');
  }
  if (strengths.has('fast') || strengths.has('cheap')) out.add('voice');
  if (strengths.has('long-context') || (model.contextWindow ?? 0) >= 128_000) {
    out.add('long-context');
    out.add('research');
  }
  if (out.size === 0) {
    out.add('general');
  }
  return Array.from(out);
}
