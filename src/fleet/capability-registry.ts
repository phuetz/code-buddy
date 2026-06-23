/**
 * Fleet — capability registry (Fleet P2).
 *
 * Builds a `PeerCapability` snapshot from local config so the running
 * Code Buddy peer can advertise itself in `peer.describe`. The
 * router (Fleet P3) consumes these snapshots to score "which peer is
 * best for which task".
 *
 * Detection layers, in order:
 *   1. Explicit `CODEBUDDY_FLEET_*` env vars (machineLabel, gpu, ram)
 *   2. ChatGPT Codex OAuth credentials (`buddy login chatgpt`)
 *   3. Configured cloud keys (`process.env.ANTHROPIC_API_KEY`,
 *      `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROK_API_KEY`,
 *      `MISTRAL_API_KEY`)
 *   4. Local Ollama daemon — best-effort `GET http://127.0.0.1:11434/api/tags`
 *      (fails silently when Ollama isn't running)
 *   5. Local LM Studio — best-effort `GET http://127.0.0.1:1234/v1/models`
 *
 * The registry is **opportunistic** — it only advertises providers
 * that are actually reachable at boot time. A 5-min refresh keeps
 * the snapshot in sync if the user starts/stops Ollama mid-session.
 *
 * @module fleet/capability-registry
 */

import * as fs from 'node:fs';
import * as os from 'os';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';
import { getFleetLoad } from './fleet-load.js';
import { getModelToolConfig } from '../config/model-tools.js';
import type {
  FleetModelDescriptor,
  ModelStrength,
  PeerCapability,
  FleetProvider,
} from './types.js';

/** Cached snapshot — rebuilt every refresh interval. */
let cached: PeerCapability | null = null;
let lastRefreshAt = 0;
/** Refresh window: 5 minutes — enough to catch a manual Ollama restart. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Get the local peer's capability snapshot. Cached for 5 minutes
 * since the underlying network probes can take ~200 ms. Pass
 * `force: true` after a config change to bust.
 */
export async function getLocalCapabilities(
  options: { force?: boolean } = {}
): Promise<PeerCapability> {
  const now = Date.now();
  if (
    !options.force &&
    cached &&
    now - lastRefreshAt < REFRESH_INTERVAL_MS
  ) {
    // `activeRequests` is live load, never cached — a 5-min-old count
    // would make the router's load term worse than useless.
    return { ...cached, activeRequests: getFleetLoad().activeRequests };
  }
  cached = await buildCapabilitySnapshot();
  lastRefreshAt = now;
  return { ...cached, activeRequests: getFleetLoad().activeRequests };
}

/** Sync getter — returns last cached snapshot or empty stub. */
export function getCachedCapabilities(): PeerCapability {
  return cached ?? emptyCapability();
}

/** Reset the cache. For tests + after config mutation. */
export function resetCapabilityCache(): void {
  cached = null;
  lastRefreshAt = 0;
}

// ─────────── Internals ───────────

async function buildCapabilitySnapshot(): Promise<PeerCapability> {
  const machineLabel =
    process.env.CODEBUDDY_FLEET_HOSTNAME?.trim() ||
    process.env.CODEBUDDY_FLEET_MACHINE_LABEL?.trim() ||
    os.hostname();

  const models: FleetModelDescriptor[] = [];

  // Layer 1 — ChatGPT subscription auth. This is not the OpenAI API:
  // it routes through chatgpt.com/backend-api/codex and should be priced
  // as zero marginal cost for the fleet router.
  if (hasChatGptOAuthCredentials()) {
    models.push(...buildChatGptOAuthCatalog());
  }

  // Layer 2 — cloud keys. Each detection adds 1-3 representative model
  // descriptors (we don't enumerate every Anthropic model, just a
  // handful that the router can route to).
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    models.push(...buildAnthropicCatalog());
  }
  if (process.env.OPENAI_API_KEY) {
    models.push(...buildOpenAICatalog());
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    models.push(...buildGeminiCatalog());
  }
  if (detectGeminiCliBinary()) {
    models.push(...buildGeminiCliCatalog());
  }
  if (process.env.GROK_API_KEY) {
    models.push(...buildGrokCatalog());
  }
  if (process.env.MISTRAL_API_KEY) {
    models.push(...buildMistralCatalog());
  }

  // Layer 3 — local Ollama probe.
  const ollamaModels = await probeOllama();
  models.push(...ollamaModels);

  // Layer 4 — local LM Studio probe.
  const lmStudioModels = await probeLmStudio();
  models.push(...lmStudioModels);

  const egress: PeerCapability['egress'] = models.some((m) =>
    isCloudProvider(m.provider)
  )
    ? 'cloud' // any cloud key present → peer is a cloud-egress peer
    : 'local';

  return {
    models,
    egress,
    machineLabel,
    machineSpec: {
      cpu: process.env.CODEBUDDY_FLEET_CPU,
      gpu: process.env.CODEBUDDY_FLEET_GPU,
      ramGb: parseRamGb(process.env.CODEBUDDY_FLEET_RAM_GB),
    },
    maxConcurrency: parseConcurrency(
      process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY,
    ),
    roles: deriveRolesForPeer(models),
  };
}

/**
 * Build the Hermes-style role tags advertised by this peer. Env var
 * `CODEBUDDY_FLEET_ROLES` (CSV) is the operator override and wins
 * outright; otherwise we infer from model strengths so a peer with a
 * Codex-class model auto-claims the `code` role, a Claude/Opus-class
 * one claims `review`+`research`, and a cheap/fast peer claims `safe`.
 */
function deriveRolesForPeer(models: FleetModelDescriptor[]): string[] {
  const explicit = process.env.CODEBUDDY_FLEET_ROLES?.trim();
  if (explicit) {
    const list = explicit
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (list.length > 0) return Array.from(new Set(list));
  }
  const set = new Set<string>();
  for (const m of models) {
    for (const s of m.strengths) {
      if (s === 'code') set.add('code');
      if (s === 'reasoning' || s === 'thinking') {
        set.add('review');
        set.add('research');
      }
      if (s === 'cheap' || s === 'fast') {
        set.add('safe');
      }
      if (s === 'long-context') set.add('research');
    }
  }
  if (set.size === 0) set.add('balanced');
  return Array.from(set);
}

function emptyCapability(): PeerCapability {
  return {
    models: [],
    egress: 'local',
    machineLabel: os.hostname(),
  };
}

function isCloudProvider(p: FleetProvider): boolean {
  return (
    p === 'anthropic' ||
    p === 'openai' ||
    p === 'gemini' ||
    p === 'gemini-cli' ||
    p === 'grok' ||
    p === 'mistral' ||
    p === 'chatgpt-oauth'
  );
}

function hasChatGptOAuthCredentials(): boolean {
  const explicitPath = process.env.CODEBUDDY_CODEX_AUTH_PATH?.trim();
  const authPath =
    explicitPath || path.join(os.homedir(), '.codebuddy', 'codex-auth.json');

  try {
    if (!fs.existsSync(authPath)) return false;
    const raw = fs.readFileSync(authPath, 'utf-8').trim();
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      tokens?: { access_token?: unknown };
    };
    return typeof parsed.tokens?.access_token === 'string' &&
      parsed.tokens.access_token.length > 0;
  } catch {
    return false;
  }
}

/**
 * Best-effort detection of the local `gemini` binary. Mirrors the
 * factory's `resolveGeminiCliBinary` but kept private here to avoid a
 * cross-module dependency between capability registry and the factory.
 */
function detectGeminiCliBinary(): boolean {
  const explicit = process.env.GEMINI_CLI_PATH;
  if (explicit) {
    try { return fs.existsSync(explicit); } catch { return false; }
  }
  const PATH = process.env.PATH ?? '';
  if (!PATH) return false;
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    try {
      if (fs.existsSync(path.join(dir, 'gemini'))) return true;
    } catch {
      /* skip dir */
    }
  }
  return false;
}

/**
 * Glob-match a model id against the existing `model-tools.ts` config
 * to derive its strengths. The mapping below extends `getModelToolConfig`
 * (which only knows reasoning/tool-calls/vision booleans) with the
 * router's richer `ModelStrength` taxonomy.
 */
function deriveStrengths(modelId: string, provider: FleetProvider): ModelStrength[] {
  const cfg = getModelToolConfig(modelId);
  const out: Set<ModelStrength> = new Set();
  if (cfg.supportsReasoning) out.add('reasoning');
  if (cfg.supportsVision) out.add('vision');
  if (cfg.supportsToolCalls) out.add('tool-calling');
  if ((cfg.contextWindow ?? 0) >= 128_000) out.add('long-context');

  // Provider-derived heuristics on top of the config.
  if (provider === 'mistral' || /qwen3\.6.*fr/i.test(modelId)) out.add('french');
  if (/codex|gpt-5-codex|qwen.*coder/i.test(modelId)) out.add('code');
  if (/-thinking|-reasoner|qwen.*a3b/i.test(modelId)) out.add('thinking');
  if (/haiku|mini|nano|gemma|tiny|3b\b|7b\b|8b\b/i.test(modelId)) {
    out.add('cheap');
    out.add('fast');
  }
  return Array.from(out);
}

function parseRamGb(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseConcurrency(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ─── Catalogs ───────────────────────────────────────────────────────

/** Representative Anthropic models the router knows about. */
function buildAnthropicCatalog(): FleetModelDescriptor[] {
  const ids = ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4'];
  return ids.map((id) => ({
    id,
    contextWindow: 200_000,
    strengths: deriveStrengths(id, 'anthropic'),
    costInputUsdPerMtok: id.includes('opus') ? 15 : id.includes('sonnet') ? 3 : 0.8,
    costOutputUsdPerMtok: id.includes('opus') ? 75 : id.includes('sonnet') ? 15 : 4,
    provider: 'anthropic',
  }));
}

function buildOpenAICatalog(): FleetModelDescriptor[] {
  const ids = ['gpt-5', 'gpt-5-codex', 'gpt-5-mini'];
  return ids.map((id) => ({
    id,
    contextWindow: 200_000,
    strengths: deriveStrengths(id, 'openai'),
    costInputUsdPerMtok: id.includes('mini') ? 0.4 : 5,
    costOutputUsdPerMtok: id.includes('mini') ? 1.6 : 20,
    provider: 'openai',
  }));
}

function buildChatGptOAuthCatalog(): FleetModelDescriptor[] {
  const preferred = process.env.CHATGPT_MODEL || 'gpt-5.5';
  const ids = [
    preferred,
    'gpt-5.5',
    'gpt-5.2',
    'gpt-5.1-codex',
    'gpt-5.1-codex-max',
    'gpt-5-codex',
  ].filter((id, index, all) => all.indexOf(id) === index);

  return ids.map((id) => ({
    id,
    contextWindow: 200_000,
    strengths: deriveStrengths(id, 'chatgpt-oauth'),
    costInputUsdPerMtok: 0,
    costOutputUsdPerMtok: 0,
    provider: 'chatgpt-oauth',
  }));
}

function buildGeminiCatalog(): FleetModelDescriptor[] {
  const ids = ['gemini-2.5-pro', 'gemini-2.5-flash'];
  return ids.map((id) => ({
    id,
    contextWindow: 1_000_000,
    strengths: deriveStrengths(id, 'gemini'),
    costInputUsdPerMtok: id.includes('flash') ? 0.3 : 2.5,
    costOutputUsdPerMtok: id.includes('flash') ? 1.2 : 10,
    provider: 'gemini',
  }));
}

/**
 * Catalog for the Gemini CLI subprocess provider. Cost is reported as
 * 0/Mtok because the user has already paid for the Ultra subscription
 * — the marginal cost per token is zero from the fleet router's POV.
 * Egress is still classified `cloud` upstream so privacy-tagged tasks
 * can avoid this peer.
 */
function buildGeminiCliCatalog(): FleetModelDescriptor[] {
  // Concrete versions pinned first (so the router scoring keys on
  // stable identifiers), then the auto-bumping aliases as fallbacks.
  const ids = [
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ];
  return ids.map((id) => ({
    id,
    contextWindow: 1_000_000,
    strengths: deriveStrengths(id, 'gemini-cli'),
    costInputUsdPerMtok: 0,
    costOutputUsdPerMtok: 0,
    provider: 'gemini-cli',
  }));
}

function buildGrokCatalog(): FleetModelDescriptor[] {
  const ids = ['grok-3-latest', 'grok-3-fast', 'grok-2-vision'];
  return ids.map((id) => ({
    id,
    contextWindow: 128_000,
    strengths: deriveStrengths(id, 'grok'),
    costInputUsdPerMtok: id.includes('fast') ? 0.5 : 2,
    costOutputUsdPerMtok: id.includes('fast') ? 2 : 10,
    provider: 'grok',
  }));
}

function buildMistralCatalog(): FleetModelDescriptor[] {
  const ids = [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'codestral-latest',
    'devstral-latest',
    'magistral-medium-latest',
    'ministral-8b-latest',
  ];
  return ids.map((id) => ({
    id,
    contextWindow: 128_000,
    strengths: deriveStrengths(id, 'mistral'),
    costInputUsdPerMtok: id.includes('small') ? 0.2 : id.includes('medium') ? 1 : 4,
    costOutputUsdPerMtok: id.includes('small') ? 0.6 : id.includes('medium') ? 3 : 12,
    provider: 'mistral',
  }));
}

// ─── Local probes ───────────────────────────────────────────────────

async function probeOllama(): Promise<FleetModelDescriptor[]> {
  const url = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`${url}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string; size?: number }> };
    if (!Array.isArray(data.models)) return [];
    return data.models.map((m): FleetModelDescriptor => ({
      id: m.name,
      // Ollama doesn't expose ctx via /api/tags — best-effort heuristic.
      contextWindow: guessOllamaContext(m.name),
      strengths: deriveStrengths(m.name, 'ollama'),
      provider: 'ollama',
    }));
  } catch (err) {
    logger.debug?.('[capability-registry] Ollama probe skipped', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function probeLmStudio(): Promise<FleetModelDescriptor[]> {
  const url = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`${url}/v1/models`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    if (!Array.isArray(data.data)) return [];
    return data.data.map((m): FleetModelDescriptor => ({
      id: m.id,
      contextWindow: 32_000,
      strengths: deriveStrengths(m.id, 'lm-studio'),
      provider: 'lm-studio',
    }));
  } catch (err) {
    logger.debug?.('[capability-registry] LM Studio probe skipped', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function guessOllamaContext(modelName: string): number {
  // Best-effort heuristic from the Ollama model card conventions.
  if (/q?wen.*32k|gemma.*32k|llama-?3.*-32k|long/i.test(modelName)) {
    return 32_000;
  }
  if (/qwen3?\.?6.*a3b|llama-?3.*70b/i.test(modelName)) {
    return 32_000;
  }
  return 8_000;
}
