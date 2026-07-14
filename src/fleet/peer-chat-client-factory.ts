/**
 * Peer chat client factory (Phase (d).16a V0.4.1).
 *
 * Builds a `CodeBuddyClient` for the `peer.chat` bridge by auto-detecting
 * which provider keys are present in the environment. The fleet can host
 * any one of: Ollama (local), ChatGPT subscription OAuth, Gemini CLI
 * subscription, Grok (xAI), Claude (Anthropic), Gemini (Google), or GPT
 * (OpenAI).
 *
 * Priority order (local/subscription first to spare cloud quotas):
 *   1. CODEBUDDY_PEER_PROVIDER explicit override
 *   2. OLLAMA_HOST set        → ollama (local, no cap)
 *   3. ChatGPT OAuth file     → chatgpt-oauth (subscription)
 *   4. gemini binary          → gemini-cli (subscription)
 *   5. GROK_API_KEY           → grok
 *   6. ANTHROPIC_API_KEY      → anthropic
 *   7. GOOGLE_API_KEY|GEMINI_API_KEY → gemini
 *   8. OPENAI_API_KEY         → openai
 *   9. nothing                → null (peer.chat → CLIENT_UNAVAILABLE)
 *
 * Override the model with CODEBUDDY_PEER_MODEL.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CodeBuddyClient,
  CHATGPT_OAUTH_SENTINEL,
  CHATGPT_RESPONSES_BASE_URL,
  GEMINI_CLI_SENTINEL,
  GEMINI_CLI_BASE_URL,
  AGY_CLI_SENTINEL,
  AGY_CLI_BASE_URL,
} from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';
import { classifyProviderModelEgress, type ModelEgress } from '../providers/model-egress.js';

export type PeerChatProviderId =
  | 'ollama'
  | 'lmstudio'
  | 'chatgpt-oauth'
  | 'gemini-cli'
  | 'agy-cli'
  | 'lemonade'
  | 'openrouter'
  | 'grok'
  | 'mistral'
  | 'anthropic'
  | 'gemini'
  | 'openai';

export interface PeerChatProviderInfo {
  provider: PeerChatProviderId;
  model: string;
  isLocal: boolean;
}

interface ProviderSpec {
  id: PeerChatProviderId;
  defaultModel: string;
  defaultBaseUrl: string;
  isLocal: boolean;
  /** Returns the apiKey + baseUrl actually used, or null if required env is missing. */
  resolve(explicit?: boolean): { apiKey: string; baseUrl: string } | null;
}

/**
 * Per-provider specs. Order in this array doubles as the auto-detect
 * priority (caller iterates left-to-right looking for the first whose
 * `resolve()` returns non-null).
 */
const SPECS: Record<PeerChatProviderId, ProviderSpec> = {
  ollama: {
    id: 'ollama',
    defaultModel: 'qwen2.5-coder:7b',
    defaultBaseUrl: 'http://localhost:11434/v1',
    isLocal: true,
    resolve: (explicit = false) => {
      const host = process.env.OLLAMA_HOST;
      if (!host && !explicit) return null;
      // Normalize: accept "localhost:11434" or "http://host:port" or
      // "http://host:port/v1".
      let baseUrl = host || SPECS.ollama.defaultBaseUrl;
      if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
      if (!baseUrl.endsWith('/v1')) baseUrl = baseUrl.replace(/\/+$/, '') + '/v1';
      return { apiKey: 'ollama', baseUrl };
    },
  },
  lmstudio: {
    id: 'lmstudio',
    defaultModel: 'local-model',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    isLocal: true,
    resolve: (explicit = false) => {
      const host = process.env.LMSTUDIO_HOST || process.env.LM_STUDIO_HOST ||
        process.env.LMSTUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL;
      if (!host && !explicit) return null;
      let baseUrl = host || SPECS.lmstudio.defaultBaseUrl;
      if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
      if (!/\/v1\/?$/i.test(baseUrl)) baseUrl = `${baseUrl.replace(/\/+$/, '')}/v1`;
      return {
        apiKey: process.env.LMSTUDIO_API_KEY || process.env.LM_STUDIO_API_KEY || 'lm-studio',
        baseUrl,
      };
    },
  },
  // ChatGPT subscription provider — uses the same OAuth file written by
  // `/login chatgpt` and the Codex Responses backend. Marginal token cost
  // is zero for the user, but isLocal remains false because egress goes
  // to chatgpt.com.
  'chatgpt-oauth': {
    id: 'chatgpt-oauth',
    defaultModel: 'gpt-5.5',
    defaultBaseUrl: CHATGPT_RESPONSES_BASE_URL,
    isLocal: false,
    resolve: () => {
      if (!hasChatGptOAuthCredentials()) return null;
      return {
        apiKey: CHATGPT_OAUTH_SENTINEL,
        baseUrl: CHATGPT_RESPONSES_BASE_URL,
      };
    },
  },
  // Gemini CLI subprocess — uses the user's Gemini Ultra subscription via
  // the local `gemini` binary. Marked isLocal because the marginal cost
  // for the user is zero (they already pay Ultra). Egress is still 'cloud'
  // for the privacy router (the binary contacts Google servers).
  'gemini-cli': {
    id: 'gemini-cli',
    // Pinned to 3.1 explicitly so a fleet behavior shift only happens
    // when Patrice updates this default (vs. the `gemini-3-pro-preview`
    // alias, which Google can auto-route to 3.2/3.3 etc.). Override
    // via CODEBUDDY_PEER_MODEL — works for both the alias and any
    // dotted version the binary accepts.
    defaultModel: 'gemini-3.1-pro-preview',
    defaultBaseUrl: GEMINI_CLI_BASE_URL,
    isLocal: true,
    resolve: () => {
      const binPath = resolveGeminiCliBinary();
      if (!binPath) return null;
      return { apiKey: GEMINI_CLI_SENTINEL, baseUrl: GEMINI_CLI_BASE_URL };
    },
  },
  // Google Antigravity subscription CLI. It is a local subprocess but the
  // inference leaves the machine, so isLocal must remain false for privacy.
  'agy-cli': {
    id: 'agy-cli',
    defaultModel: 'Gemini 3.1 Pro (High)',
    defaultBaseUrl: AGY_CLI_BASE_URL,
    isLocal: false,
    resolve: () => {
      const binPath = resolveCliBinary('AGY_CLI_PATH', 'agy');
      if (!binPath) return null;
      return { apiKey: AGY_CLI_SENTINEL, baseUrl: AGY_CLI_BASE_URL };
    },
  },
  // Lemonade is OpenAI-compatible. It is opt-in for peer.chat so merely
  // installing the daemon cannot unexpectedly replace another active brain.
  lemonade: {
    id: 'lemonade',
    defaultModel: 'Qwen3.6-35B-A3B-MTP-GGUF',
    defaultBaseUrl: 'http://127.0.0.1:13305/api/v1',
    isLocal: true,
    resolve: (explicit = false) => {
      const configured = process.env.LEMONADE_HOST?.trim();
      const explicitlySelected = explicit || process.env.CODEBUDDY_PEER_PROVIDER === 'lemonade';
      if (!configured && !explicitlySelected) return null;
      let baseUrl = configured || SPECS.lemonade.defaultBaseUrl;
      if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
      if (!/\/(?:api\/)?v1\/?$/i.test(baseUrl)) {
        baseUrl = `${baseUrl.replace(/\/+$/, '')}/api/v1`;
      }
      return { apiKey: process.env.LEMONADE_API_KEY || 'lemonade', baseUrl };
    },
  },
  openrouter: {
    id: 'openrouter',
    defaultModel: 'openrouter/free',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    isLocal: false,
    resolve: () => {
      const apiKey = process.env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) return null;
      return {
        apiKey,
        baseUrl: process.env.OPENROUTER_BASE_URL || SPECS.openrouter.defaultBaseUrl,
      };
    },
  },
  grok: {
    id: 'grok',
    defaultModel: 'grok-3',
    defaultBaseUrl: 'https://api.x.ai/v1',
    isLocal: false,
    resolve: () => {
      const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      if (!apiKey) return null;
      return {
        apiKey,
        baseUrl: process.env.GROK_BASE_URL || process.env.XAI_BASE_URL || SPECS.grok.defaultBaseUrl,
      };
    },
  },
  mistral: {
    id: 'mistral',
    defaultModel: 'mistral-small-latest',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    isLocal: false,
    resolve: () => {
      const apiKey = process.env.MISTRAL_API_KEY?.trim();
      if (!apiKey) return null;
      return {
        apiKey,
        baseUrl: process.env.MISTRAL_BASE_URL || SPECS.mistral.defaultBaseUrl,
      };
    },
  },
  anthropic: {
    id: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    isLocal: false,
    resolve: () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return null;
      return { apiKey, baseUrl: SPECS.anthropic.defaultBaseUrl };
    },
  },
  gemini: {
    id: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    isLocal: false,
    resolve: () => {
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) return null;
      return { apiKey, baseUrl: SPECS.gemini.defaultBaseUrl };
    },
  },
  openai: {
    id: 'openai',
    defaultModel: 'gpt-4o',
    defaultBaseUrl: 'https://api.openai.com/v1',
    isLocal: false,
    resolve: () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      return { apiKey, baseUrl: SPECS.openai.defaultBaseUrl };
    },
  },
};

/** Detection priority: local/subscription first to spare cloud quotas.
 *
 * `chatgpt-oauth` sits above paid API keys so Patrice's ChatGPT plan is
 * used before metered providers.
 *
 * `gemini-cli` sits above `gemini` (API key) so a user with both will
 * always burn the Ultra subscription (zero marginal cost) before
 * tapping a paid AI Studio quota. */
const AUTO_DETECT_ORDER: PeerChatProviderId[] = [
  'ollama',
  'lmstudio',
  'chatgpt-oauth',
  'agy-cli',
  'gemini-cli',
  'lemonade',
  'openrouter',
  'grok',
  'mistral',
  'anthropic',
  'gemini',
  'openai',
];

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
 * Locate the `gemini` binary on the host. Honours `GEMINI_CLI_PATH` if
 * set, otherwise walks `PATH` looking for `gemini`. Returns null when
 * not found so the factory can short-circuit cleanly.
 */
function resolveGeminiCliBinary(): string | null {
  return resolveCliBinary('GEMINI_CLI_PATH', 'gemini');
}

function resolveCliBinary(envName: string, binaryName: string): string | null {
  const explicit = process.env[envName];
  if (explicit) {
    return fs.existsSync(explicit) ? explicit : null;
  }
  const PATH = process.env.PATH ?? '';
  if (!PATH) return null;
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binaryName);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* permission errors etc — keep walking */
    }
  }
  return null;
}

/**
 * Build a peer.chat client + provider info from env, or null when no
 * provider can be resolved. Returns the FIRST match in the priority
 * order (overridable via CODEBUDDY_PEER_PROVIDER).
 *
 * Pure function — no side effects beyond logging. Safe to call at boot
 * and re-call (e.g. after env reload).
 */
export function createPeerChatClientFromEnv():
  | { client: CodeBuddyClient; info: PeerChatProviderInfo }
  | null {
  const override = process.env.CODEBUDDY_PEER_PROVIDER as PeerChatProviderId | undefined;
  if (override) {
    if (!(override in SPECS)) {
      logger.warn(`[peer-chat-factory] Unknown CODEBUDDY_PEER_PROVIDER: "${override}" — ignored`);
      return null;
    }
    return buildOne(override, undefined, true, true);
  }
  for (const id of AUTO_DETECT_ORDER) {
    const built = buildOne(id, undefined, false, true);
    if (built) return built;
  }
  return null;
}

function providerModel(id: PeerChatProviderId): string | undefined {
  switch (id) {
    case 'chatgpt-oauth': return process.env.CHATGPT_MODEL;
    case 'ollama': return process.env.OLLAMA_MODEL;
    case 'lmstudio': return process.env.LMSTUDIO_MODEL || process.env.LM_STUDIO_MODEL;
    case 'lemonade': return process.env.LEMONADE_MODEL;
    case 'openrouter': return process.env.OPENROUTER_MODEL;
    case 'grok': return process.env.GROK_MODEL || process.env.XAI_MODEL;
    case 'mistral': return process.env.MISTRAL_MODEL;
    case 'gemini': return process.env.GEMINI_MODEL;
    case 'openai': return process.env.OPENAI_MODEL;
    default: return undefined;
  }
}

/** Whether an untrusted RPC string names a supported peer.chat backend. */
export function isPeerChatProviderId(value: unknown): value is PeerChatProviderId {
  return typeof value === 'string' && value in SPECS;
}

/**
 * Normalize a provider id received from Fleet/RPC boundaries.
 *
 * Fleet capability descriptors historically advertise LM Studio as
 * `lm-studio`, while the peer-chat factory uses `lmstudio` internally.
 * Accept both spellings without widening the internal provider union.
 * Unknown values return null so callers can fail closed; the legacy
 * `unknown` sentinel is handled by call sites that intentionally fall
 * back to the default client.
 */
export function normalizePeerChatProviderId(value: unknown): PeerChatProviderId | null {
  if (value === 'lm-studio') return 'lmstudio';
  return isPeerChatProviderId(value) ? value : null;
}

/**
 * Build a client for one exact backend. Unlike boot auto-detection, this never
 * applies CODEBUDDY_PEER_MODEL: that global belongs to the default client and
 * must not leak a model id into a different provider selected by Fleet.
 */
export function createPeerChatClientForProvider(
  id: PeerChatProviderId,
  model?: string,
): { client: CodeBuddyClient; info: PeerChatProviderInfo } | null {
  // Exact Fleet routing must stay observable at the orchestration layer. A
  // CodeBuddyClient normally enables its own env/auth-profile fallbacks; if we
  // left those on, a request labelled `providerResolved: lemonade` could
  // silently be answered by OpenAI. The saga runner owns explicit failover.
  return buildOne(id, model, true, false, false);
}

/** Try to build a client for one specific provider. Returns null when env is incomplete. */
function buildOne(
  id: PeerChatProviderId,
  explicitModel?: string,
  explicitProvider = false,
  allowGlobalModel = false,
  enableFallbacks = true,
): { client: CodeBuddyClient; info: PeerChatProviderInfo } | null {
  const spec = SPECS[id];
  const resolved = spec.resolve(explicitProvider);
  if (!resolved) return null;
  const model =
    explicitModel ||
    (allowGlobalModel ? process.env.CODEBUDDY_PEER_MODEL : undefined) ||
    providerModel(id) ||
    spec.defaultModel;
  try {
    const client = new CodeBuddyClient(
      resolved.apiKey,
      model,
      resolved.baseUrl,
      { enableFallbacks },
    );
    return {
      client,
      info: { provider: id, model, isLocal: spec.isLocal },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[peer-chat-factory] Failed to build ${id} client: ${msg}`);
    return null;
  }
}

/**
 * Resolved provider tuple — Phase (d).20.
 * Returned by `resolveProviderFromEnv()` for callers that want to
 * construct something other than a `CodeBuddyClient` (e.g. the
 * autonomous fleet tick which constructs a `CodeBuddyAgent`).
 */
export interface ResolvedProvider {
  provider: PeerChatProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  isLocal: boolean;
  egress: ModelEgress;
}

/**
 * Resolve provider env without constructing a client. Useful for
 * non-`peer.chat` consumers that need the same auto-detection logic
 * (e.g. autonomous fleet tick → `CodeBuddyAgent`).
 *
 * `preferred`:
 *   - undefined / 'auto' → use `CODEBUDDY_PEER_PROVIDER` override or
 *     auto-detect order (same as `createPeerChatClientFromEnv`)
 *   - explicit provider id → resolve only that provider, return null
 *     if its env is incomplete
 *
 * Pure function. Returns null when no provider is resolvable.
 */
export function resolveProviderFromEnv(
  preferred?: PeerChatProviderId | 'auto',
): ResolvedProvider | null {
  // Explicit provider id — resolve only that one
  if (preferred && preferred !== 'auto') {
    const spec = SPECS[preferred];
    if (!spec) return null;
    const resolved = spec.resolve(true);
    if (!resolved) return null;
    return {
      provider: preferred,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: process.env.CODEBUDDY_PEER_MODEL || providerModel(preferred) || spec.defaultModel,
      isLocal: spec.isLocal,
      egress: classifyProviderModelEgress(preferred, resolved.baseUrl, spec.isLocal),
    };
  }
  // Auto-detect with override fallthrough
  const override = process.env.CODEBUDDY_PEER_PROVIDER as PeerChatProviderId | undefined;
  if (override && override in SPECS) {
    const r = resolveProviderFromEnv(override);
    if (r) return r;
  }
  for (const id of AUTO_DETECT_ORDER) {
    // Auto-detection is a probe, not an explicit selection. Calling the public
    // explicit branch here made local providers resolve to their default URL
    // even when they were not configured, so `auto` always chose Ollama.
    const spec = SPECS[id];
    const resolved = spec.resolve(false);
    if (resolved) {
      return {
        provider: id,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: process.env.CODEBUDDY_PEER_MODEL || providerModel(id) || spec.defaultModel,
        isLocal: spec.isLocal,
        egress: classifyProviderModelEgress(id, resolved.baseUrl, spec.isLocal),
      };
    }
  }
  return null;
}

/** Test-only helper: list provider IDs in detection priority order. */
export function _getDetectionOrderForTests(): PeerChatProviderId[] {
  return [...AUTO_DETECT_ORDER];
}
