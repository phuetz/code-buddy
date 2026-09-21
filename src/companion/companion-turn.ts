/**
 * ONE companion turn, shared by every surface that talks to Lisa.
 * @module companion/companion-turn
 */

import {
  assembleCompanionChannelPrompt,
  isCompanionSurfaceEnabled,
} from '../channels/companion-channel-profile.js';
import { runCompanionChannelTurn } from '../channels/companion-channel-turn.js';
import { speakChannelProviderFailure } from '../channels/provider-failure-speech.js';
import { prependUserFacingFailoverNotice } from '../providers/provider-failover-user-notice.js';
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
import { applyLimitsContract } from './reply-augment.js';
import { guardRelationshipReply } from '../conversation/relationship-safety.js';
import type {
  CompanionSelfieServeResult,
  CompanionSelfieSurface,
  TryServeCompanionSelfieOptions,
} from './lisa-selfie-router.js';
import { resolveCompanionIdentity, type CompanionIdentity } from './companion-identity.js';

export type CompanionSurface = CompanionSelfieSurface;
export type { CompanionHistoryTurn } from './companion-history.js';

export interface CompanionTurnResult {
  text: string;
  kind: 'selfie' | 'text';
  image?: { mimeType: string; data: string };
  imagePath?: string;
  model?: string;
  historySuffix?: string;
  executedTools?: import('../channels/companion-channel-turn.js').CompanionExecutedTool[];
  photos?: {
    mode: 'local' | 'cloud';
    accepted: number;
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
  identity?: CompanionIdentity;
  userId?: string;
  chatId?: string;
  sessionKey?: string;
  onWaitingWord?: (word: string) => Promise<void> | void;
  attachments?: CompanionPhotoAttachment[];
  includeImageBytes?: boolean;
  resolveProvider?: (env: NodeJS.ProcessEnv) => CompanionTurnProvider | null;
  serveSelfie?: (
    text: string,
    options: TryServeCompanionSelfieOptions,
  ) => Promise<CompanionSelfieServeResult | null>;
  chat?: (
    messages: CodeBuddyMessage[],
    tools: unknown[],
    opts: { model: string; maxTokens?: number; signal?: AbortSignal; tool_choice?: unknown },
  ) => Promise<CodeBuddyResponse>;
  preparePhotos?: typeof prepareCompanionPhotos;
  rememberPhotos?: typeof rememberSharedPhotos;
}

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

export async function runCompanionTurn(
  message: string,
  options: RunCompanionTurnOptions,
): Promise<CompanionTurnResult> {
  const env = options.env ?? process.env;
  const history = options.history ?? [];
  const copine = Boolean(env.CODEBUDDY_COMPANION_PERSONA);
  const attachments = options.attachments ?? [];
  const sessionKey = options.sessionKey;

  let resolvedProvider: CompanionTurnProvider | null | undefined;
  const getProvider = async (): Promise<CompanionTurnProvider | null> => {
    if (resolvedProvider === undefined) {
      resolvedProvider = options.resolveProvider
        ? options.resolveProvider(env)
        : await defaultResolveProvider(env);
    }
    return resolvedProvider;
  };

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
  }

  const buildPrompt = (batch: PreparedCompanionPhotos | null) =>
    assembleCompanionChannelPrompt({
      userText: batch?.userText ?? message,
      history: history.map((turn) => ({ role: turn.role, content: turn.content })),
      env,
      ...(sessionKey ? { sessionKey } : {}),
      ...(batch && batch.photos.length > 0 ? { extraSystem: batch.guidance } : {}),
    });

  const prompt = await buildPrompt(prepared);

  if (!provider) {
    return { text: speakChannelProviderFailure(NO_PROVIDER_MESSAGE, { copine }), kind: 'text' };
  }

  const messagesFor = (batch: PreparedCompanionPhotos | null, base: CodeBuddyMessage[]) =>
    batch && batch.mode === 'cloud' && batch.photos.length > 0
      ? (attachPhotoParts(base as Array<{ role: string; content?: unknown }>, batch.photos) as CodeBuddyMessage[])
      : base;

  const identity =
    options.identity ??
    resolveCompanionIdentity({
      channel: options.surface === 'mobile' ? 'pwa' : options.surface,
      userId: options.userId,
      chatId: options.chatId,
      env,
    });

  const turnInput = {
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: provider.model,
    identity,
    surface: options.surface,
    env,
    ...(sessionKey ? { sessionKey } : {}),
    ...(options.onWaitingWord ? { onWaitingWord: options.onWaitingWord } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.chat ? { chat: options.chat } : {}),
  };

  try {
    let batch = prepared;
    let generated = await runCompanionChannelTurn({
      ...turnInput,
      messages: messagesFor(batch, prompt.messages),
    });

    if (
      batch &&
      batch.mode === 'cloud' &&
      batch.photos.length > 0 &&
      looksLikeVisionRefusal(generated.text)
    ) {
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
          ...turnInput,
          messages: localPrompt.messages,
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
    const guarded = guardRelationshipReply(text);
    const limited = applyLimitsContract(guarded.response, { heard: message, env });

    const firstMedia = generated.media?.[0];
    let generatedImage: { mimeType: string; data: string } | undefined;
    if (firstMedia?.imagePath && (options.includeImageBytes === true || options.surface === 'mobile')) {
      try {
        const fsMod = await import('fs/promises');
        const pathMod = await import('path');
        const ext = pathMod.extname(firstMedia.imagePath).slice(1).toLowerCase();
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext || 'png'}`;
        const data = (await fsMod.readFile(firstMedia.imagePath)).toString('base64');
        generatedImage = { mimeType, data };
      } catch {
        /* bytes optional */
      }
    }

    return {
      text: prependUserFacingFailoverNotice(limited.text, 'companion-turn'),
      kind: firstMedia ? 'selfie' : 'text',
      ...(firstMedia?.imagePath ? { imagePath: firstMedia.imagePath } : {}),
      ...(generatedImage ? { image: generatedImage } : {}),
      model: generated.model,
      ...(generated.historySuffix ? { historySuffix: generated.historySuffix } : {}),
      ...(generated.executedTools ? { executedTools: generated.executedTools } : {}),
      ...(photoSummary ? { photos: photoSummary } : {}),
    };
  } catch (error) {
    return { text: speakChannelProviderFailure(error, { copine }), kind: 'text' };
  }
}

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
  } catch {
    return { mode: batch.mode, accepted: batch.photos.length, stored: 0 };
  }
}
