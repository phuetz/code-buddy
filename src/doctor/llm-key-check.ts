import { xaiApiKey, xaiBaseURL } from '../config/legacy-env.js';
/**
 * Live LLM key validation for `buddy doctor` — ZERO tokens consumed.
 *
 * Hits each configured provider's model-listing endpoint (a free GET) and
 * interprets the status code the way jarvis-OS's preflight does (concept,
 * clean-room): 401/403 ⇒ the key itself is wrong/revoked (error), 429 ⇒ the
 * key is valid but the quota/rate limit is exhausted (warn — a different fix
 * than "check your key"), network failure ⇒ offline-safe warn, never blocking.
 */

import type { DoctorCheck } from './index.js';

const LIVE_CHECK_TIMEOUT_MS = 4000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface ProviderKeyCheck {
  /** Env vars checked in order — the first one set provides the key. */
  envVars: string[];
  label: string;
  /** Build URL + headers for the free models-listing endpoint. */
  request: (key: string) => { url: string; headers?: Record<string, string> };
  /** Statuses meaning "the key itself is rejected" (default 401/403). */
  invalidKeyStatuses?: number[];
}

const PROVIDER_CHECKS: ProviderKeyCheck[] = [
  {
    envVars: ['OPENAI_API_KEY'],
    label: 'OpenAI',
    request: (key) => ({
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${key}` },
    }),
  },
  {
    envVars: ['XAI_API_KEY', 'GROK_API_KEY'],
    label: 'xAI (Grok)',
    request: (key) => ({
      url: `${(xaiBaseURL() ?? 'https://api.x.ai/v1').replace(/\/$/, '')}/models`,
      headers: { Authorization: `Bearer ${key}` },
    }),
  },
  {
    envVars: ['ANTHROPIC_API_KEY'],
    label: 'Anthropic',
    request: (key) => ({
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    }),
  },
  {
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    label: 'Google (Gemini)',
    request: (key) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    }),
    // Google répond 400 API_KEY_INVALID (pas 401) à une clé invalide — vérifié live.
    invalidKeyStatuses: [400, 401, 403],
  },
];

async function checkOneKey(
  provider: ProviderKeyCheck,
  key: string,
  fetchImpl: FetchLike,
): Promise<DoctorCheck> {
  const name = `LLM key live: ${provider.label}`;
  const { url, headers } = provider.request(key);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIVE_CHECK_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        ...(headers ? { headers } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) {
      return { name, status: 'ok', message: 'key accepted by the provider (models endpoint, 0 tokens)' };
    }
    if ((provider.invalidKeyStatuses ?? [401, 403]).includes(response.status)) {
      return {
        name,
        status: 'error',
        message: `key REJECTED (HTTP ${response.status}) — invalid or revoked; fix the key, not the quota`,
      };
    }
    if (response.status === 429) {
      return {
        name,
        status: 'warn',
        message: 'key valid but rate-limited/quota exhausted (HTTP 429) — top up or wait; the key itself is fine',
      };
    }
    return { name, status: 'warn', message: `unexpected HTTP ${response.status} from models endpoint` };
  } catch {
    // Offline-safe: a network failure is not a key problem and never blocks.
    return { name, status: 'warn', message: 'provider unreachable (offline?) — live validation skipped' };
  }
}

/**
 * Validate every configured provider key live (in parallel). Keys that are
 * not set are skipped — `checkApiKeys()` already reports set/not-set.
 */
export async function checkLlmKeysLive(
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<DoctorCheck[]> {
  const configured = PROVIDER_CHECKS.map((p) => ({
    p,
    key: p.label === 'xAI (Grok)' ? xaiApiKey() : p.envVars.map((v) => process.env[v]).find(Boolean),
  })).filter((x): x is { p: ProviderKeyCheck; key: string } => !!x.key);
  if (configured.length === 0) return [];
  return Promise.all(configured.map(({ p, key }) => checkOneKey(p, key, fetchImpl)));
}
