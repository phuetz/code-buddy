/**
 * On-demand camera share — « qu'est-ce que tu vois ? »
 *
 * Reads one frame from the eye sidecar's keyframe ring (the brain must not
 * open /dev/video0 — buddy-vision-eye already owns the camera), describes it
 * with CODEBUDDY_VISION_MODEL (loopback only; CODEBUDDY_VISION_REMOTE_IMAGE
 * stays false), and optionally sends the photo to CODEBUDDY_SENSORY_ALERT_CHAT
 * via sendTelegramAlert.
 *
 * Telegram never uses an inbound chat id other than the configured alert chat.
 * Voice does not send a photo unless the utterance explicitly asks to send it.
 *
 * @module companion/camera-share
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { normalizeVoiceInteractionText } from '../sensory/voice-interactions.js';
import { shouldAllowVisionImageEndpoint } from '../sensory/vision-reaction.js';
import { redactVisionDescriptionForEgress } from '../sensory/vision-description-safety.js';
import { safeCameraKeyframePath } from '../sensory/camera-keyframe-policy.js';
import { isLisaSelfieRequest } from './lisa-selfie.js';
import type {
  CameraSnapshotOptions,
  CameraSnapshotResult,
} from './camera.js';

/** Default minimum gap between Telegram photo sends (ms). */
export const DEFAULT_CAMERA_SHARE_COOLDOWN_MS = 10_000;
/** Default max age of an eye keyframe before we admit we have no current image. */
export const DEFAULT_CAMERA_SHARE_MAX_AGE_MS = 30_000;

const EYE_KEYFRAME_NAME = /^(?:motion-\d+|semantic-\d+)\.(?:jpg|jpeg|png|webp)$/i;

let lastPhotoSendAt = 0;

/** Test helper. */
export function resetCameraShareCooldown(): void {
  lastPhotoSendAt = 0;
}

export function cameraShareCooldownRemainingMs(
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.CODEBUDDY_CAMERA_SHARE_COOLDOWN_MS ?? DEFAULT_CAMERA_SHARE_COOLDOWN_MS);
  const cooldown = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CAMERA_SHARE_COOLDOWN_MS;
  const left = lastPhotoSendAt + cooldown - nowMs;
  return left > 0 ? left : 0;
}

export type CameraShareSurface = 'telegram' | 'voice';

export interface CameraShareOptions {
  surface?: CameraShareSurface;
  /** Inbound Telegram chat id. A photo is sent only to this requester's chat. */
  inboundChatId?: string;
  cwd?: string;
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Force/forbid the Telegram send independently of surface heuristics. */
  sendTelegram?: boolean;
  capture?: (options: CameraSnapshotOptions) => Promise<CameraSnapshotResult>;
  analyze?: (imagePath: string) => Promise<string>;
  /** Sends to the requester's chat when provided by a channel adapter. */
  sendPhoto?: (caption: string, imagePath: string, destinationChatId?: string) => Promise<boolean>;
  now?: () => Date;
}

export interface CameraShareResult {
  success: boolean;
  telegramSent: boolean;
  spokenReply: string;
  description?: string;
  imagePath?: string;
  error?: string;
}

const NON_CAMERA_CONTEXT =
  /\b(?:code|fichier|fonction|classe|bug|erreur|log|terminal|commit|branche|repo|depot|document|page web|site|message|texte|raisonnement|idee|probleme|difference|actualite|actualites|news|meteo|temperature|prix|bitcoin|bourse|agenda|calendrier|email|mail|information|informations|resultat|resultats|situation|reponse|question|profil|conversation|discussion)\b/;

const CAMERA_SCENE =
  /\b(?:camera|webcam|piece|scene|salon|cuisine|couloir|bureau|room)\b/;

const SCENE_DEIXIS = /\b(?:devant toi|autour(?: de toi)?|ici|la piece|the room)\b/;

const NAMED_OBJECT =
  /\b(?:hamburger|burger|assiette|repas|tournevis|tatouage|livre|plante|dessin|salade|gateau|fleur|chien|chat|vetement|tenue|tasse|verre|plat)\b/;

const ABSTRACT_SEE =
  /\b(?:tu|vous)\s+(?:vois|voyez)\s+(?:bien\s+)?(?:ce\s+)?que\s+(?:je|j)\s+(?:veux|voulais)\s+dire\b/;

const ABSTRACT_SEE_QUE = /\b(?:tu|vous)\s+(?:vois|voyez)\s+(?:bien\s+)?que\b/;

const WHAT_DO_YOU_SEE =
  /\b(?:qu est ce que|que)\s+(?:tu|vous)\s+(?:vois|voyez|regardes|regardez|apercois|apercevez)\b/;

const INVERTED_WHAT_SEE =
  /\b(?:que\s+(?:vois|voyez|regardes|regardez)\s+(?:tu|vous)|what do you (?:see|look at))\b/;

const SHOW_CAMERA =
  /\b(?:montre(?: moi)?|fais moi voir|show me)\s+(?:la |le |l |the )?(?:camera|webcam|piece|scene|room)\b/;

const SHOW_WHAT_YOU_SEE =
  /\b(?:montre(?: moi)?|fais moi voir|show me)\s+(?:ce que tu (?:vois|regardes)|what you see)\b/;

const BARE_LOOK =
  /^(?:lisa\s+)?(?:regarde|regardez|look)(?:\s+(?:un peu|donc|maintenant|autour|ici|around))?(?:\s+(?:s il te plait|stp|please))?$/;

const LOOK_AT_CAMERA =
  /\b(?:regarde|regardez|look(?: at)?)\s+(?:la |le |l |the )?(?:camera|webcam|piece|scene|room)\b/;

const SEND_VERB = /\b(?:envoie|envoyer|envoi|envoies|send)\b/;

function hasNamedObjectWithoutScene(text: string): boolean {
  return NAMED_OBJECT.test(text) && !CAMERA_SCENE.test(text) && !SCENE_DEIXIS.test(text);
}

function isNonCameraTopic(text: string): boolean {
  return NON_CAMERA_CONTEXT.test(text) && !CAMERA_SCENE.test(text);
}

/** Explicit voice/text request to push the frame to Telegram. */
export function isCameraShareTelegramSendRequest(text: string): boolean {
  const t = normalizeVoiceInteractionText(text);
  if (!t || !SEND_VERB.test(t)) return false;
  if (isNonCameraTopic(t)) return false;
  if (/\btelegram\b/.test(t)) return true;
  if (/\b(?:photo|image|picture|cliche)\b/.test(t) && CAMERA_SCENE.test(t)) return true;
  if (/\b(?:ce que tu vois|what you see)\b/.test(t)) return true;
  return false;
}

/** Detect a request to look through the local camera at the room/scene. */
export function isCameraShareRequest(text: string): boolean {
  if (!text?.trim()) return false;
  if (isLisaSelfieRequest(text)) return false;
  const t = normalizeVoiceInteractionText(text);
  if (!t) return false;
  if (ABSTRACT_SEE.test(t) || ABSTRACT_SEE_QUE.test(t)) return false;
  if (isNonCameraTopic(t)) return false;
  if (hasNamedObjectWithoutScene(t)) return false;

  if (isCameraShareTelegramSendRequest(text)) return true;
  if (WHAT_DO_YOU_SEE.test(t) || INVERTED_WHAT_SEE.test(t)) return true;
  if (SHOW_CAMERA.test(t) || SHOW_WHAT_YOU_SEE.test(t)) return true;
  if (BARE_LOOK.test(t) || LOOK_AT_CAMERA.test(t)) return true;
  return false;
}

function isPhotoSendEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.CODEBUDDY_VISION_TELEGRAM_PHOTO === 'true';
}

function alertChatId(env: NodeJS.ProcessEnv): string {
  return env.CODEBUDDY_SENSORY_ALERT_CHAT?.trim() ?? '';
}

function isConfiguredAlertChat(inboundChatId: string | undefined, env: NodeJS.ProcessEnv): boolean {
  const alert = alertChatId(env);
  return Boolean(alert && inboundChatId?.trim() && inboundChatId.trim() === alert);
}

function visionEndpointAllowed(env: NodeJS.ProcessEnv): boolean {
  if (!env.CODEBUDDY_VISION_MODEL?.trim()) return false;
  const baseURL = env.CODEBUDDY_VISION_BASE_URL?.trim() || 'http://127.0.0.1:11434/v1';
  return shouldAllowVisionImageEndpoint(baseURL, env.CODEBUDDY_VISION_REMOTE_IMAGE === 'true');
}

const NO_IMAGE_REPLY = "Je n'ai pas d'image en ce moment.";
const PHOTO_DISABLED_NOTE = "L'envoi de photo est désactivé.";
const WRONG_CHAT_REPLY = "Je n'envoie ce que je vois qu'au chat Telegram configuré.";

function buildSpokenReply(input: {
  description: string;
  wantSend: boolean;
  photoEnabled: boolean;
  telegramSent: boolean;
  cooldown: boolean;
}): string {
  const bits: string[] = [];
  if (input.description) bits.push(input.description);
  else bits.push("J'ai une image, mais je n'arrive pas à la décrire localement.");
  if (input.wantSend && !input.photoEnabled) bits.push(PHOTO_DISABLED_NOTE);
  else if (input.telegramSent) bits.push('Je te l\'envoie sur Telegram.');
  else if (input.cooldown) bits.push('Doucement — attends quelques secondes avant une nouvelle photo.');
  return bits.join(' ');
}

async function defaultAnalyze(imagePath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { loadImageFromFile, buildMultimodalContent } = await import('../tools/image-input.js');
  const { CodeBuddyClient } = await import('../codebuddy/client.js');
  const img = await loadImageFromFile(imagePath);
  const content = buildMultimodalContent(
    "Décris en une ou deux phrases courtes, en français, ce que montre cette image. Sois factuelle. N'invente rien hors champ.",
    [img],
  );
  const model = env.CODEBUDDY_VISION_MODEL?.trim() || 'moondream';
  const baseURL = env.CODEBUDDY_VISION_BASE_URL?.trim() || 'http://127.0.0.1:11434/v1';
  const client = new CodeBuddyClient(env.OLLAMA_API_KEY || 'ollama', model, baseURL);
  const resp = await client.chat([{ role: 'user', content } as never], []);
  return String(resp?.choices?.[0]?.message?.content ?? '').trim();
}

function eyeKeyframeRoot(env: NodeJS.ProcessEnv): string {
  const configured = env.BUDDY_SENSE_FRAME_DIR?.trim();
  if (!configured) return path.join(homedir(), '.codebuddy', 'companion');
  if (configured.startsWith('~/')) return path.join(homedir(), configured.slice(2));
  return path.resolve(configured);
}

function maxKeyframeAgeMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.CODEBUDDY_CAMERA_SHARE_MAX_AGE_MS ?? DEFAULT_CAMERA_SHARE_MAX_AGE_MS);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_CAMERA_SHARE_MAX_AGE_MS;
  return raw;
}

/**
 * Pick the newest motion/semantic keyframe from the eye spool, if it is fresh.
 * Never opens the webcam — the eye sidecar owns /dev/video0.
 */
export async function findRecentEyeKeyframe(options: {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  maxAgeMs?: number;
  root?: string;
} = {}): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const root = options.root ?? eyeKeyframeRoot(env);
  const nowMs = (options.now ?? (() => new Date()))().getTime();
  const maxAgeMs = options.maxAgeMs ?? maxKeyframeAgeMs(env);
  let names: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    names = entries.filter((entry) => entry.isFile() && EYE_KEYFRAME_NAME.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  let best: { file: string; mtimeMs: number } | undefined;
  for (const name of names) {
    const candidate = path.join(root, name);
    const safe = await safeCameraKeyframePath(candidate, { root });
    if (!safe) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(safe)).mtimeMs;
    } catch {
      continue;
    }
    if (nowMs - mtimeMs > maxAgeMs) continue;
    if (!best || mtimeMs > best.mtimeMs) best = { file: safe, mtimeMs };
  }
  return best?.file;
}

async function defaultCaptureFromEye(
  env: NodeJS.ProcessEnv,
  now: () => Date,
): Promise<CameraSnapshotResult> {
  const recent = await findRecentEyeKeyframe({ env, now });
  if (recent) {
    return { success: true, path: recent, command: 'eye-keyframe' };
  }
  return {
    success: false,
    error: 'no recent eye keyframe',
    command: 'eye-keyframe',
  };
}

function wantsTelegramSend(
  heard: string,
  options: CameraShareOptions,
): boolean {
  if (options.sendTelegram === false) return false;
  if (options.sendTelegram === true) return true;
  if (options.surface === 'voice') return isCameraShareTelegramSendRequest(heard);
  // Telegram inbound: the message itself is the request to see / receive the frame.
  return options.surface === 'telegram' || isCameraShareTelegramSendRequest(heard);
}

/**
 * Capture one frame, describe it locally, and maybe send it to the alert chat.
 * Never throws. Returns null when the text is not a camera-share request.
 */
export async function maybeHandleCameraShareRequest(
  heard: string,
  options: CameraShareOptions = {},
): Promise<CameraShareResult | null> {
  if (!isCameraShareRequest(heard)) return null;

  const env = options.env ?? process.env;
  const nowMs = (options.now ?? (() => new Date()))().getTime();
  const surface = options.surface ?? 'voice';
  const wantSend = wantsTelegramSend(heard, options);
  const photoEnabled = isPhotoSendEnabled(env);
  const inboundChatId = surface === 'telegram' ? options.inboundChatId?.trim() : undefined;
  const hasRequesterDestination = Boolean(inboundChatId);
  const canUseInjectedSender = hasRequesterDestination && Boolean(options.sendPhoto);
  const allowedChat = canUseInjectedSender || isConfiguredAlertChat(inboundChatId, env);

  if (
    surface === 'telegram' &&
    !isConfiguredAlertChat(inboundChatId, env) &&
    !canUseInjectedSender
  ) {
    return {
      success: true,
      telegramSent: false,
      spokenReply: WRONG_CHAT_REPLY,
    };
  }

  try {
    const capture = options.capture
      ?? ((_: CameraSnapshotOptions) => defaultCaptureFromEye(env, options.now ?? (() => new Date())));
    const snapshot = await capture({
      cwd: options.cwd ?? options.rootDir ?? process.cwd(),
      recordPercept: false,
      recordSafetyEvent: false,
    });
    if (!snapshot.success || !snapshot.path) {
      return {
        success: false,
        telegramSent: false,
        spokenReply: NO_IMAGE_REPLY,
        error: snapshot.error ?? 'camera snapshot failed',
      };
    }

    let description = '';
    if (visionEndpointAllowed(env)) {
      try {
        const analyze = options.analyze ?? ((imagePath: string) => defaultAnalyze(imagePath, env));
        description = (await analyze(snapshot.path)).trim();
      } catch (err) {
        logger.warn(
          `[camera-share] local describe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const caption = redactVisionDescriptionForEgress(description)
      ?? "Voici ce que je vois.";

    let telegramSent = false;
    let cooldown = false;
    const maySend = wantSend && photoEnabled && allowedChat;
    if (wantSend && !photoEnabled) {
      /* description-only path; note added in spokenReply */
    } else if (maySend) {
      const remaining = cameraShareCooldownRemainingMs(nowMs, env);
      if (remaining > 0) {
        cooldown = true;
      } else {
        try {
          const sendPhoto = options.sendPhoto
            ?? (async (text: string, imagePath: string) => {
              const { sendTelegramAlert } = await import('../sensory/alert.js');
              return sendTelegramAlert(text, imagePath);
            });
          telegramSent = await sendPhoto(caption, snapshot.path, inboundChatId);
          if (telegramSent) lastPhotoSendAt = nowMs;
        } catch (err) {
          logger.warn(
            `[camera-share] telegram photo failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return {
      success: true,
      telegramSent,
      spokenReply: buildSpokenReply({
        description,
        wantSend,
        photoEnabled,
        telegramSent,
        cooldown,
      }),
      ...(description ? { description } : {}),
      imagePath: snapshot.path,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[camera-share] failed: ${msg}`);
    return {
      success: false,
      telegramSent: false,
      spokenReply: NO_IMAGE_REPLY,
      error: msg,
    };
  }
}
