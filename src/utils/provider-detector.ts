/**
 * Provider auto-detection — extracted from src/index.ts (Phase d.25).
 *
 * Reads env vars + filesystem state to pick the active LLM provider for
 * a Code Buddy session. Pure function (no side effects beyond stat/read
 * on the OAuth file) so it's unit-testable.
 *
 * Priority order is defined in `src/providers/provider-catalog.ts`:
 *   0. CODEBUDDY_PROVIDER override (always wins when set + valid)
 *   1. ChatGPT OAuth credentials present (~/.codebuddy/codex-auth.json)
 *      → explicit "I logged in" act beats ambient env vars
 *   2. Configured cloud providers in catalog priority order
 *   3. Local providers (Ollama / LM Studio / vLLM)
 *   else null (no provider available)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveProviderFromCatalog,
  type RuntimeProviderId,
  type ProviderApiMode,
  type ProviderAuthMode,
} from '../providers/provider-catalog.js';

export interface DetectedProvider {
  provider: RuntimeProviderId | 'unknown';
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  apiMode?: ProviderApiMode;
  authMode?: ProviderAuthMode;
  source?: 'oauth' | 'environment' | 'override';
}

export function detectProviderFromEnv(): DetectedProvider | null {
  return resolveProviderFromCatalog({
    hasChatGptOAuth: hasChatGptOAuthCredentials(),
  });
}

function hasChatGptOAuthCredentials(): boolean {
  try {
    const authPath = path.join(os.homedir(), '.codebuddy', 'codex-auth.json');
    if (!fs.existsSync(authPath)) return false;
    const raw = fs.readFileSync(authPath, 'utf-8').trim();
    const parsed = raw ? JSON.parse(raw) : null;
    return Boolean(parsed?.tokens?.access_token);
  } catch {
    // Malformed auth file or unexpected — fall through to env providers.
    return false;
  }
}
