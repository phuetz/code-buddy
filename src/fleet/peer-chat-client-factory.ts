/**
 * Peer chat client factory (Phase (d).16a V0.4.1).
 *
 * Builds a `CodeBuddyClient` for the `peer.chat` bridge by auto-detecting
 * which provider keys are present in the environment. The fleet can host
 * any one of: ChatGPT subscription (Codex OAuth), Ollama (local),
 * Grok (xAI), Claude (Anthropic), Gemini (Google), or GPT (OpenAI).
 *
 * Priority order (local first to spare cloud quotas):
 *   1. CODEBUDDY_PEER_PROVIDER explicit override
 *   2. ChatGPT Codex OAuth    → chatgpt (subscription)
 *   3. OLLAMA_HOST set        → ollama (local, no cap)
 *   4. Gemini CLI             → gemini-cli (subscription)
 *   5. GROK_API_KEY           → grok
 *   6. ANTHROPIC_API_KEY      → anthropic
 *   7. GOOGLE_API_KEY|GEMINI_API_KEY → gemini
 *   8. OPENAI_API_KEY         → openai
 *   9. nothing                → null (peer.chat → CLIENT_UNAVAILABLE)
 *
 * Override the model with CODEBUDDY_PEER_MODEL.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CodeBuddyClient, GEMINI_CLI_SENTINEL, GEMINI_CLI_BASE_URL } from '../codebuddy/client.js';
import { hasCodexCredentials } from '../providers/codex-oauth.js';
import { logger } from '../utils/logger.js';

export type PeerChatProviderId =
  | 'chatgpt'
  | 'ollama'
  | 'gemini-cli'
  | 'grok'
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
  resolve(): { apiKey: string; baseUrl: string } | null;
}

/**
 * Per-provider specs. Order in this array doubles as the auto-detect
 * priority (caller iterates left-to-right looking for the first whose
 * `resolve()` returns non-null).
 */
const SPECS: Record<PeerChatProviderId, ProviderSpec> = {
  chatgpt: {
    id: 'chatgpt',
    defaultModel: 'gpt-5.5',
    defaultBaseUrl: 'https://chatgpt.com/backend-api/codex',
    isLocal: false,
    resolve: () => {
      if (!hasCodexCredentials()) return null;
      return { apiKey: 'oauth-chatgpt', baseUrl: SPECS.chatgpt.defaultBaseUrl };
    },
  },
  ollama: {
    id: 'ollama',
    defaultModel: 'qwen2.5-coder:7b',
    defaultBaseUrl: 'http://localhost:11434/v1',
    isLocal: true,
    resolve: () => {
      const host = process.env.OLLAMA_HOST;
      if (!host) return null;
      // Normalize: accept "localhost:11434" or "http://host:port" or
      // "http://host:port/v1".
      let baseUrl = host;
      if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
      if (!baseUrl.endsWith('/v1')) baseUrl = baseUrl.replace(/\/+$/, '') + '/v1';
      return { apiKey: 'ollama', baseUrl };
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
  grok: {
    id: 'grok',
    defaultModel: 'grok-3',
    defaultBaseUrl: 'https://api.x.ai/v1',
    isLocal: false,
    resolve: () => {
      const apiKey = process.env.GROK_API_KEY;
      if (!apiKey) return null;
      return { apiKey, baseUrl: process.env.GROK_BASE_URL || SPECS.grok.defaultBaseUrl };
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

/** Detection priority: subscription/local first to spare API quotas.
 *
 * ChatGPT Codex OAuth and `gemini-cli` both represent subscriptions the
 * user already pays for, so they sit above metered API-key providers.
 */
const AUTO_DETECT_ORDER: PeerChatProviderId[] = [
  'chatgpt',
  'ollama',
  'gemini-cli',
  'grok',
  'anthropic',
  'gemini',
  'openai',
];

/**
 * Locate the `gemini` binary on the host. Honours `GEMINI_CLI_PATH` if
 * set, otherwise walks `PATH` looking for `gemini`. Returns null when
 * not found so the factory can short-circuit cleanly.
 */
function resolveGeminiCliBinary(): string | null {
  const explicit = process.env.GEMINI_CLI_PATH;
  if (explicit) {
    return fs.existsSync(explicit) ? explicit : null;
  }
  const PATH = process.env.PATH ?? '';
  if (!PATH) return null;
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'gemini');
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
    return buildOne(override);
  }
  for (const id of AUTO_DETECT_ORDER) {
    const built = buildOne(id);
    if (built) return built;
  }
  return null;
}

/** Try to build a client for one specific provider. Returns null when env is incomplete. */
function buildOne(id: PeerChatProviderId): { client: CodeBuddyClient; info: PeerChatProviderInfo } | null {
  const spec = SPECS[id];
  const resolved = spec.resolve();
  if (!resolved) return null;
  const model =
    process.env.CODEBUDDY_PEER_MODEL ||
    (id === 'chatgpt' ? process.env.CHATGPT_MODEL : undefined) ||
    spec.defaultModel;
  try {
    const client = new CodeBuddyClient(resolved.apiKey, model, resolved.baseUrl);
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
    const resolved = spec.resolve();
    if (!resolved) return null;
    return {
      provider: preferred,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: process.env.CODEBUDDY_PEER_MODEL || spec.defaultModel,
      isLocal: spec.isLocal,
    };
  }
  // Auto-detect with override fallthrough
  const override = process.env.CODEBUDDY_PEER_PROVIDER as PeerChatProviderId | undefined;
  if (override && override in SPECS) {
    const r = resolveProviderFromEnv(override);
    if (r) return r;
  }
  for (const id of AUTO_DETECT_ORDER) {
    const r = resolveProviderFromEnv(id);
    if (r) return r;
  }
  return null;
}

/** Test-only helper: list provider IDs in detection priority order. */
export function _getDetectionOrderForTests(): PeerChatProviderId[] {
  return [...AUTO_DETECT_ORDER];
}
