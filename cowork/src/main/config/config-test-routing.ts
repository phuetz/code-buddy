import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-store';
import { probeWithClaudeSdk } from '../claude/claude-sdk-one-shot';
import { loadCoreModule } from '../utils/core-loader';

/** ChatGPT OAuth probes must answer within this budget. */
const CHATGPT_PROBE_TIMEOUT_MS = 20_000;

interface CoreClientModule {
  CHATGPT_OAUTH_SENTINEL: string;
  CodeBuddyClient: new (
    apiKey: string,
    model?: string,
    baseURL?: string
  ) => {
    chat(
      messages: Array<{ role: string; content: string }>
    ): Promise<{ choices: Array<{ message: { content: string | null } }> }>;
  };
}

/**
 * Probe the ChatGPT OAuth (Codex Responses) provider through the SAME core
 * strategy the real chat uses. The generic pi-ai probe speaks plain
 * chat-completions, which the Codex backend answers with an empty body —
 * the long-standing « Test de connexion » false negative.
 */
async function probeChatGptOAuth(payload: ApiTestInput, config: AppConfig): Promise<ApiTestResult> {
  const started = Date.now();
  try {
    const core = await loadCoreModule<CoreClientModule>('codebuddy/client.js');
    if (!core?.CodeBuddyClient) {
      return {
        ok: false,
        errorType: 'unknown',
        details: 'Code Buddy core introuvable (dist non buildé ?) — impossible de sonder ChatGPT OAuth.',
      };
    }
    const model = (typeof payload.model === 'string' && payload.model.trim()) || config.model || 'gpt-5.5';
    const client = new core.CodeBuddyClient(core.CHATGPT_OAUTH_SENTINEL, model);
    const response = await Promise.race([
      client.chat([{ role: 'user', content: "Réponds uniquement: ok" }]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`ChatGPT OAuth probe timed out after ${CHATGPT_PROBE_TIMEOUT_MS}ms`)), CHATGPT_PROBE_TIMEOUT_MS)
      ),
    ]);
    const text = response?.choices?.[0]?.message?.content ?? '';
    const latencyMs = Date.now() - started;
    if (text.trim().length > 0) {
      return { ok: true, latencyMs };
    }
    return {
      ok: false,
      latencyMs,
      errorType: 'server_error',
      details: 'Le backend Codex a répondu sans contenu.',
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const lowered = details.toLowerCase();
    return {
      ok: false,
      latencyMs: Date.now() - started,
      errorType: /401|403|unauthorized|token|oauth|login/.test(lowered)
        ? 'unauthorized'
        : /timed out|timeout|network|fetch failed|econn/.test(lowered)
          ? 'network_error'
          : 'unknown',
      details,
    };
  }
}

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig,
): Promise<ApiTestResult> {
  // ChatGPT OAuth (Codex Responses backend) speaks its own protocol — the
  // generic one-shot probe returns an empty body there (known false negative).
  if (payload.provider === 'chatgpt') {
    return probeChatGptOAuth(payload, config);
  }
  return probeWithClaudeSdk(payload, config);
}
