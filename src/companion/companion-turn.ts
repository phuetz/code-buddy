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
import {
  attachPhotoParts,
  looksLikeVisionRefusal,
  prepareCompanionPhotos,
  type CompanionPhotoAttachment,
  type PreparedCompanionPhotos,
} from './companion-photo.js';
import type { CompanionHistoryTurn } from './companion-history.js';
import { rememberSharedPhotos } from './shared-photo-memory.js';
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
  /** Present only when the user shared photos in this turn. */
  photos?: {
    /** Where the image went. `local` means the bytes never left the machine. */
    mode: 'local' | 'cloud';
    /** Photos accepted after magic-byte authentication. */
    accepted: number;
    /** Photos filed in the shared album. */
    stored: number;
  };
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
  /**
   * Photos the user shared with this message. Absent (the default) the turn is
   * byte-identical to a text-only turn: no photo module is even imported.
   */
  attachments?: CompanionPhotoAttachment[];
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
  /** Photo seams — production uses the real pipeline and the real album. */
  preparePhotos?: typeof prepareCompanionPhotos;
  rememberPhotos?: typeof rememberSharedPhotos;
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
  const attachments = options.attachments ?? [];

  // Resolved lazily: a cached-selfie turn must stay LLM-free and provider-free,
  // but a shared photo needs the model id before it can decide whether the
  // image may travel (`auto` mode).
  let resolvedProvider: CompanionTurnProvider | null | undefined;
  const getProvider = async (): Promise<CompanionTurnProvider | null> => {
    if (resolvedProvider === undefined) {
      resolvedProvider = options.resolveProvider
        ? options.resolveProvider(env)
        : await defaultResolveProvider(env);
    }
    return resolvedProvider;
  };

  // A photo shared is not a request for one of hers: skip the selfie router so
  // "regarde ce que j'ai vu" never comes back as a selfie.
  if (attachments.length === 0 && env.CODEBUDDY_LISA_SELFIE !== 'false' && isCompanionSurfaceEnabled(env)) {
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

  const provider = await getProvider();

  let prepared: PreparedCompanionPhotos | null = null;
  if (attachments.length > 0) {
    const preparePhotos = options.preparePhotos ?? prepareCompanionPhotos;
    prepared = await preparePhotos(attachments, {
      env,
      caption: message,
      ...(provider?.model ? { model: provider.model } : {}),
      ...(provider?.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    });
    if (prepared) {
      logger.info('[companion-turn] shared photos prepared', {
        surface: options.surface,
        mode: prepared.mode,
        accepted: prepared.photos.length,
        rejected: prepared.rejected.length,
      });
    }
  }

  const buildPrompt = (batch: PreparedCompanionPhotos | null) =>
    assembleCompanionChannelPrompt({
      userText: batch?.userText ?? message,
      history: history.map((turn) => ({ role: turn.role, content: turn.content })),
      env,
      ...(batch && batch.photos.length > 0 ? { extraSystem: batch.guidance } : {}),
    });

  const prompt = await buildPrompt(prepared);

  if (!provider) {
    logger.warn('[companion-turn] no provider resolved for the companion surface');
    return { text: speakChannelProviderFailure(NO_PROVIDER_MESSAGE, { copine }), kind: 'text' };
  }

  const messagesFor = (batch: PreparedCompanionPhotos | null, base: CodeBuddyMessage[]) =>
    batch && batch.mode === 'cloud' && batch.photos.length > 0
      ? (attachPhotoParts(base as Array<{ role: string; content?: unknown }>, batch.photos) as CodeBuddyMessage[])
      : base;

  try {
    let batch = prepared;
    let generated = await runCompanionChannelTurn({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      messages: messagesFor(batch, prompt.messages),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.chat ? { chat: options.chat } : {}),
    });

    // The capability table can over-declare vision on a family-matched tag. If
    // the model answers that it cannot see, retry ONCE with a local describer
    // so the user never gets "je ne peux pas voir les images" for a photo the
    // machine could perfectly well have described.
    if (
      batch &&
      batch.mode === 'cloud' &&
      batch.photos.length > 0 &&
      looksLikeVisionRefusal(generated.text)
    ) {
      logger.warn('[companion-turn] cloud model denied seeing the photo — retrying locally', {
        surface: options.surface,
        model: provider.model,
      });
      const preparePhotos = options.preparePhotos ?? prepareCompanionPhotos;
      const localBatch = await preparePhotos(attachments, {
        env,
        caption: message,
        forceMode: 'local',
      });
      if (localBatch && localBatch.photos.length > 0) {
        batch = localBatch;
        const localPrompt = await buildPrompt(localBatch);
        generated = await runCompanionChannelTurn({
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          model: provider.model,
          messages: localPrompt.messages,
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.chat ? { chat: options.chat } : {}),
        });
      }
    }

    const text = generated.text.trim();
    const photoSummary = batch ? await fileSharedPhotos(batch, message, options) : undefined;
    if (!text) {
      return {
        text: speakChannelProviderFailure('empty', { copine }),
        kind: 'text',
        ...(photoSummary ? { photos: photoSummary } : {}),
      };
    }
    return {
      text,
      kind: 'text',
      model: generated.model,
      ...(photoSummary ? { photos: photoSummary } : {}),
    };
  } catch (error) {
    logger.warn('[companion-turn] provider failure spoken to the conversation', {
      surface: options.surface,
      error: error instanceof Error ? error.message : String(error),
    });
    return { text: speakChannelProviderFailure(error, { copine }), kind: 'text' };
  }
}

/** File the batch in the shared album and the rolling photo memory. Never throws. */
async function fileSharedPhotos(
  batch: PreparedCompanionPhotos,
  caption: string,
  options: RunCompanionTurnOptions,
): Promise<{ mode: 'local' | 'cloud'; accepted: number; stored: number } | undefined> {
  if (batch.photos.length === 0) {
    return { mode: batch.mode, accepted: 0, stored: 0 };
  }
  try {
    const remember = options.rememberPhotos ?? rememberSharedPhotos;
    const records = await remember(batch.photos, {
      surface: options.surface === 'voice' ? 'voice' : options.surface === 'telegram' ? 'telegram' : 'mobile',
      caption,
      ...(options.env ? { env: options.env } : {}),
    });
    return { mode: batch.mode, accepted: batch.photos.length, stored: records.length };
  } catch (error) {
    logger.warn('[companion-turn] shared album write skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { mode: batch.mode, accepted: batch.photos.length, stored: 0 };
  }
}
