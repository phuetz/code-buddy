/**
 * Provider auto-detection — extracted from src/index.ts (Phase d.25).
 *
 * Reads env vars + filesystem state to pick the active LLM provider for
 * a Code Buddy session. Pure function (no side effects beyond stat/read
 * on the OAuth file) so it's unit-testable.
 *
 * Priority order:
 *   0. CODEBUDDY_PROVIDER override (always wins when set + valid)
 *   1. ChatGPT OAuth credentials present (~/.codebuddy/codex-auth.json)
 *      or shared Codex CLI credentials present (~/.codex/auth.json)
 *      → explicit "I logged in" act beats ambient env vars
 *   2. OLLAMA_HOST    → ollama (local, free, unlimited)
 *   3. GROK_API_KEY   → grok / OpenAI-compat (incl. xAI)
 *   4. GEMINI/GOOGLE  → gemini
 *   5. OPENAI         → openai
 *   6. ANTHROPIC      → anthropic
 *   else null (no provider available)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DetectedProvider {
  provider: 'gemini' | 'grok' | 'openai' | 'anthropic' | 'ollama' | 'chatgpt' | 'unknown';
  apiKey: string;
  baseURL: string;
  defaultModel: string;
}

function isLikelyGrokModel(model: string): boolean {
  return /^grok[-_]/i.test(model.trim());
}

/**
 * Preserve explicit model overrides without letting legacy Grok defaults leak
 * into a non-Grok provider selected by env/OAuth detection.
 */
export function selectModelForDetectedProvider(
  detected: DetectedProvider | null,
  configuredModel?: string,
): string | undefined {
  const model = configuredModel?.trim();
  if (!detected) return model || undefined;
  if (!model) return detected.defaultModel;
  if (detected.provider !== 'grok' && isLikelyGrokModel(model)) {
    return detected.defaultModel;
  }
  return model;
}

export interface ClientTargetForDetectedProvider {
  baseURL?: string;
  model: string;
  matchedDetectedProvider: boolean;
}

export function inferProviderFromBaseURL(baseURL?: string): DetectedProvider['provider'] | null {
  const url = baseURL?.toLowerCase() ?? '';
  if (!url) return null;
  if (url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('openai.com')) return 'openai';
  if (url.includes('anthropic.com')) return 'anthropic';
  if (url.includes('generativelanguage.googleapis.com') || url.includes('gemini')) return 'gemini';
  if (url.includes(':11434') || url.includes('ollama')) return 'ollama';
  if (url.includes('api.x.ai') || url.includes('x.ai') || url.includes('xai')) return 'grok';
  return null;
}

export function getDefaultModelForProvider(provider: DetectedProvider['provider']): string | undefined {
  switch (provider) {
    case 'chatgpt':
      return process.env.CHATGPT_MODEL || 'gpt-5.5';
    case 'openai':
      return process.env.OPENAI_MODEL || 'gpt-4o';
    case 'anthropic':
      return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
    case 'gemini':
      return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    case 'ollama':
      return process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';
    case 'grok':
      return process.env.GROK_MODEL || 'grok-3-fast';
    default:
      return undefined;
  }
}

export function selectModelForExplicitBaseURL(
  baseURL: string | undefined,
  configuredModel?: string,
): string | undefined {
  const model = configuredModel?.trim();
  const provider = inferProviderFromBaseURL(baseURL);
  if (!provider) return model || undefined;

  if (provider !== 'grok' && model && isLikelyGrokModel(model)) {
    return getDefaultModelForProvider(provider);
  }

  return model || getDefaultModelForProvider(provider);
}

/**
 * Resolve the model/baseURL for a caller that already has an api key and
 * may have been handed the active provider tuple by the detection chain.
 *
 * This preserves explicit model choices, but replaces legacy Grok fallback
 * defaults when the target is actually the detected non-Grok provider.
 */
export function resolveClientTargetForDetectedProvider(
  apiKey: string,
  baseURL: string | undefined,
  configuredModel: string | undefined,
  fallbackModel: string,
): ClientTargetForDetectedProvider {
  const configured = configuredModel?.trim();
  const fallback = fallbackModel.trim();
  const detected = detectProviderFromEnv();

  if (
    detected &&
    apiKey === detected.apiKey &&
    (!baseURL || trimTrailingSlashes(baseURL) === trimTrailingSlashes(detected.baseURL))
  ) {
    return {
      baseURL: baseURL || detected.baseURL,
      model: configured || selectModelForDetectedProvider(detected, fallback) || fallback,
      matchedDetectedProvider: true,
    };
  }

  return {
    baseURL,
    model: configured || fallback,
    matchedDetectedProvider: false,
  };
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function hasChatGptAccessToken(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { tokens?: { access_token?: unknown } };
    return typeof parsed.tokens?.access_token === 'string' && parsed.tokens.access_token.length > 0;
  } catch {
    return false;
  }
}

export function detectProviderFromEnv(): DetectedProvider | null {
  const override = process.env.CODEBUDDY_PROVIDER?.toLowerCase();

  // ChatGPT subscription auth — explicit login wins over ambient
  // env-detected providers. User who ran `buddy login chatgpt` recently
  // expects subsequent calls to route through their ChatGPT plan, not
  // get hijacked by an OLLAMA_HOST set in their shell rc weeks ago.
  if (override === 'chatgpt' || !override) {
    const authPaths = [
      path.join(os.homedir(), '.codebuddy', 'codex-auth.json'),
      path.join(os.homedir(), '.codex', 'auth.json'),
    ];
    for (const authPath of authPaths) {
      if (hasChatGptAccessToken(authPath)) {
        return {
          provider: 'chatgpt',
          apiKey: 'oauth-chatgpt',
          baseURL: 'https://chatgpt.com/backend-api/codex',
          defaultModel: process.env.CHATGPT_MODEL || 'gpt-5.5',
        };
      }
    }
  }

  if (override === 'ollama' || (!override && process.env.OLLAMA_HOST)) {
    let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
    if (!host.endsWith('/v1')) host = host.replace(/\/+$/, '') + '/v1';
    return {
      provider: 'ollama',
      apiKey: 'ollama',
      baseURL: host,
      defaultModel: process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
    };
  }

  if (
    (override === 'grok' || override === 'xai') ||
    (!override && (process.env.GROK_API_KEY || process.env.XAI_API_KEY))
  ) {
    return {
      provider: 'grok',
      apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
      baseURL: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
      defaultModel: process.env.GROK_MODEL || 'grok-3-fast',
    };
  }

  if (
    (override === 'gemini' || override === 'google') ||
    (!override && (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY))
  ) {
    return {
      provider: 'gemini',
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    };
  }

  if (override === 'openai' || (!override && process.env.OPENAI_API_KEY)) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o',
    };
  }

  if (override === 'anthropic' || (!override && process.env.ANTHROPIC_API_KEY)) {
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      baseURL: 'https://api.anthropic.com/v1',
      defaultModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    };
  }

  return null;
}
