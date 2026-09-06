/**
 * ONE companion turn, shared by every surface that talks to Lisa.
 *
 * Before this module the mobile PWA (`produceCompanionReply` in the WebSocket
 * handler) called `defaultReply` — the VOICE loop: routed to the *fastest*
 * model, with an empty history — while Telegram went through the companion
 * channel profile with the configured provider, the persona spoken prompt, the
 * relational context and the last turns. Same Lisa, two behaviours: the phone
 * got a stateless generic assistant.
 *
 * This is the single seam now. `defaultReply` remains the voice path and is
 * deliberately untouched.
 *
 * Provider resolution is `resolveCommandProvider` (`commands/llm-provider-
 * resolution.ts`) — the same resolver the channel runtime resolves through, so
 * the phone speaks with the provider the server is configured for
 * (`CODEBUDDY_PROVIDER` / settings), not with whatever model happens to be the
 * fastest.
 *
 * Failover seam: generation goes through `runCompanionChannelTurn`, i.e.
 * `CodeBuddyClient.chat` (`COMPANION_CHANNEL_FAILOVER_SEAM`). Never reimplement
 * a fallback chain here.
 *
 * @module companion/companion-turn
 */

import {
  assembleCompanionChannelPrompt,
  isCompanionSurfaceEnabled,
} from '../channels/companion-channel-profile.js';
import { runCompanionChannelTurn } from '../channels/companion-channel-turn.js';
import { speakChannelProviderFailure } from '../channels/provider-failure-speech.js';
import type { CodeBuddyMessage, CodeBuddyResponse } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';
import type { CompanionHistoryTurn } from './companion-history.js';
import type {
  CompanionSelfieServeResult,
  CompanionSelfieSurface,
  TryServeCompanionSelfieOptions,
} from './lisa-selfie-router.js';

/** A companion surface. `voice` keeps its own loop; it is listed for symmetry. */
export type CompanionSurface = CompanionSelfieSurface;

export type { CompanionHistoryTurn } from './companion-history.js';

export interface CompanionTurnResult {
  text: string;
  kind: 'selfie' | 'text';
  image?: { mimeType: string; data: string };
  imagePath?: string;
  model?: string;
}

export interface CompanionTurnProvider {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface RunCompanionTurnOptions {
  surface: CompanionSurface;
  history?: CompanionHistoryTurn[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Read the selfie file and return its base64 (mobile pushes bytes over WS). */
  includeImageBytes?: boolean;
  /** Injectables — production resolves each of these itself. */
  resolveProvider?: (env: NodeJS.ProcessEnv) => CompanionTurnProvider | null;
  serveSelfie?: (
    text: string,
    options: TryServeCompanionSelfieOptions,
  ) => Promise<CompanionSelfieServeResult | null>;
  chat?: (
    messages: CodeBuddyMessage[],
    tools: [],
    opts: { model: string; maxTokens?: number; signal?: AbortSignal; tool_choice: 'none' },
  ) => Promise<CodeBuddyResponse>;
}

/** Fallback when no provider is configured — spoken, never a silent empty reply. */
const NO_PROVIDER_MESSAGE = 'unreachable: no configured provider for the companion turn';

export { historyHasRecentSelfie } from './companion-history.js';

async function defaultResolveProvider(
  env: NodeJS.ProcessEnv,
): Promise<CompanionTurnProvider | null> {
  const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
  const resolved = resolveCommandProvider({});
  if (!resolved) return null;
  const model = resolved.model || env.CODEBUDDY_MODEL || env.GROK_MODEL || '';
  if (!model) return null;
  return {
    apiKey: resolved.apiKey || 'local',
    baseUrl: resolved.baseURL ?? '',
    model,
  };
}

/**
 * Produce Lisa's reply for one user message: cached selfie first (no LLM), then
 * the companion profile turn through the configured provider.
 */
export async function runCompanionTurn(
  message: string,
  options: RunCompanionTurnOptions,
): Promise<CompanionTurnResult> {
  const env = options.env ?? process.env;
  const history = options.history ?? [];
  const copine = Boolean(env.CODEBUDDY_COMPANION_PERSONA);

  if (env.CODEBUDDY_LISA_SELFIE !== 'false' && isCompanionSurfaceEnabled(env)) {
    try {
      const serve =
        options.serveSelfie ??
        (await import('./lisa-selfie-router.js')).tryServeCompanionSelfie;
      const served = await serve(message, {
        surface: options.surface,
        env,
        history,
        ...(options.includeImageBytes === true ? { includeImageBytes: true } : {}),
      });
      if (served) {
        return {
          text: served.caption,
          kind: served.imagePath ? 'selfie' : 'text',
          ...(served.imagePath ? { imagePath: served.imagePath } : {}),
          ...(served.imageBase64 && served.mimeType
            ? { image: { mimeType: served.mimeType, data: served.imageBase64 } }
            : {}),
        };
      }
    } catch (err) {
      logger.warn('[companion-turn] selfie router skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const prompt = await assembleCompanionChannelPrompt({
    userText: message,
    history: history.map((turn) => ({ role: turn.role, content: turn.content })),
    env,
  });

  const provider = options.resolveProvider
    ? options.resolveProvider(env)
    : await defaultResolveProvider(env);
  if (!provider) {
    logger.warn('[companion-turn] no provider resolved for the companion surface');
    return { text: speakChannelProviderFailure(NO_PROVIDER_MESSAGE, { copine }), kind: 'text' };
  }

  try {
    const generated = await runCompanionChannelTurn({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      messages: prompt.messages,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.chat ? { chat: options.chat } : {}),
    });
    const text = generated.text.trim();
    if (!text) {
      return { text: speakChannelProviderFailure('empty', { copine }), kind: 'text' };
    }
    return { text, kind: 'text', model: generated.model };
  } catch (error) {
    logger.warn('[companion-turn] provider failure spoken to the conversation', {
      surface: options.surface,
      error: error instanceof Error ? error.message : String(error),
    });
    return { text: speakChannelProviderFailure(error, { copine }), kind: 'text' };
  }
}
