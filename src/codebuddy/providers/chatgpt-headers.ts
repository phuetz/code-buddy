/**
 * Shared ChatGPT/Codex HTTP headers builder.
 *
 * Extracted from `provider-chatgpt-responses.ts` to allow reuse by both
 * the chat responses provider and the `chatgpt` media generation provider
 * without code duplication.
 */

import type { ChatGptAuth } from '../../providers/codex-oauth.js';
import { getInstallationId } from '../../utils/installation-id.js';

export const CODEX_ORIGINATOR = 'codex_cli_rs';
export const CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

export interface ChatGptHeadersOptions {
  accept?: string;
  useResponsesLite?: boolean;
}

/**
 * Builds the headers expected by the ChatGPT Codex backend.
 */
export function buildChatGptHeaders(
  auth: ChatGptAuth,
  options?: ChatGptHeadersOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.access_token}`,
    Accept: options?.accept ?? 'application/json',
    'Content-Type': 'application/json',
    originator: CODEX_ORIGINATOR,
    // Stable per-install UUID — Codex backend uses this for telemetry
    // and rate-limiting. Generated lazily on first read, persisted to
    // ~/.codebuddy/installation-id. Mirrors openai/codex upstream.
    'x-codex-installation-id': getInstallationId(),
    'User-Agent': `codebuddy/${process.env.npm_package_version ?? 'dev'}`,
  };
  if (auth.account_id) {
    headers['ChatGPT-Account-ID'] = auth.account_id;
  }
  if (auth.is_fedramp) {
    headers['X-OpenAI-Fedramp'] = 'true';
  }
  if (options?.useResponsesLite) {
    headers['x-openai-internal-codex-responses-lite'] = 'true';
  }
  return headers;
}
