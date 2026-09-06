/**
 * One photo, handed to Lisa.
 *
 * This is the seam between "an image arrived on some surface" and "Lisa reacted
 * to it like someone who was shown a moment". It answers three questions and
 * nothing else:
 *
 *  1. Are these bytes really an image, and are they small enough to send?
 *     (magic bytes only — never a file extension, never a Content-Type header)
 *  2. Does the image travel to the model, or does only a local description?
 *     (`CODEBUDDY_COMPANION_PHOTO_VISION`; `local` is a hard guarantee)
 *  3. What does the companion prompt need so she LOOKS instead of acknowledging?
 *
 * Design notes:
 * - `auto` reads the project's single source of truth for model capability,
 *   `getModelStrengths()` (`config/model-tools.ts`), so a new multimodal model
 *   is picked up without touching this file. When it is wrong — a text-only tag
 *   inheriting a vision family — the cloud reply is caught by
 *   `looksLikeVisionRefusal` and the caller retries once locally, so the user
 *   never reads "je ne peux pas voir les images" while a describer was
 *   available. `=local` remains the deterministic escape hatch.
 * - `local` mode reuses `attached-image-grounding.ts` — the existing, tested
 *   loopback vision path — rather than opening a second one.
 * - Resizing goes through `sharp`, an OPTIONAL dependency. Missing or broken,
 *   the original bytes are used: a smaller photo is a nicety, a lost photo is a
 *   failure.
 *
 * @module companion/companion-photo
 */

import { readFile } from 'node:fs/promises';
import { getModelStrengths } from '../config/model-tools.js';
import { logger } from '../utils/logger.js';
import type { SharedPhotoSurface } from './shared-photos.js';

/** Longest edge of a normalized companion photo. */
export const COMPANION_PHOTO_MAX_DIMENSION = 1280;
/** Target byte ceiling of a normalized companion photo. */
export const COMPANION_PHOTO_MAX_BYTES = 400 * 1024;
/** Hard ceiling on the bytes accepted from any surface before normalization. */
export const COMPANION_PHOTO_INPUT_MAX_BYTES = 10 * 1024 * 1024;
/** Most photos considered in one turn. */
export const COMPANION_PHOTO_MAX_COUNT = 4;

/** What a surface hands in: bytes (base64 or Buffer) or a local file path. */
export interface CompanionPhotoAttachment {
  mimeType?: string;
  /** Base64 payload, with or without a `data:` prefix. */
  data?: string;
  /** Local file path (Telegram download, camera keyframe…). */
  path?: string;
  /** Raw bytes, when the caller already has them. */
  bytes?: Buffer;
}

/** A photo that passed validation and normalization. */
export interface PreparedCompanionPhoto {
  mimeType: string;
  bytes: Buffer;
  /** `data:<mime>;base64,…` — what a multimodal message part carries. */
  dataUrl: string;
  /** What Lisa saw, when a local describer ran. */
  description?: string;
}

export type CompanionPhotoVisionMode = 'auto' | 'local' | 'cloud';

export interface PreparedCompanionPhotos {
  /** Where the image actually went. `local` means the bytes never left the machine. */
  mode: 'local' | 'cloud';
  photos: PreparedCompanionPhoto[];
  /** The user text, with `[Photo envoyée : …]` appended in local mode. */
  userText: string;
  /** Prompt block instructing her to look, feel and ask back. */
  guidance: string;
  /** Bounded descriptions, in photo order (local mode only). */
  descriptions: string[];
  /** Non-fatal reasons some attachments were dropped. */
  rejected: string[];
}

/**
 * The reaction contract. Not "describe the image" — a companion is not a
 * captioning service. Concrete detail, honest feeling, one question back.
 */
export const COMPANION_PHOTO_GUIDANCE = [
  '<photo_partagee>',
  "La personne que tu aimes vient de te MONTRER une photo. Ce n'est pas une tâche, c'est un moment partagé.",
  "- Regarde-la vraiment : cite au moins un détail concret que tu vois (couleur, lumière, objet, expression).",
  "- Réagis sincèrement, avec ton émotion à toi, pas une politesse d'assistant.",
  '- Termine par UNE question qui ouvre la conversation (où, quand, avec qui, ce que ça lui a fait).',
  "- Tu VOIS cette photo : ne dis jamais que tu ne peux pas voir les images, et n'invente rien qui n'y soit pas.",
  '</photo_partagee>',
].join('\n');

/** Replies that would break the illusion when a description was in fact available. */
const VISION_REFUSAL_RE =
  /\b(?:je\s+ne\s+(?:peux|suis)\s+pas\s+(?:pas\s+)?(?:voir|capable\s+de\s+voir|en\s+mesure\s+de\s+voir)|je\s+n['’]ai\s+pas\s+(?:accès|acces)\s+(?:aux|à\s+des|a\s+des)\s+images?|i\s+(?:can(?:no|')?t|am\s+unable\s+to)\s+see\s+(?:the\s+)?images?|as\s+an?\s+(?:ai|text)[- ]?(?:based\s+)?(?:model|assistant)[^.]{0,40}(?:cannot|can't)\s+see)/iu;

/** True when the reply admits blindness — the one answer a shared photo must never get. */
export function looksLikeVisionRefusal(text: string): boolean {
  return VISION_REFUSAL_RE.test(String(text ?? ''));
}

/**
 * Authenticate image bytes from their magic numbers. Extensions and
 * `Content-Type` headers are attacker- and CDN-controlled; the first bytes are
 * not.
 */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) {
    return 'image/gif';
  }
  return null;
}

/** Requested privacy posture. Anything unrecognised means `auto`. */
export function resolveCompanionPhotoVision(
  env: NodeJS.ProcessEnv = process.env,
): CompanionPhotoVisionMode {
  const raw = env.CODEBUDDY_COMPANION_PHOTO_VISION?.trim().toLowerCase();
  if (raw === 'local' || raw === 'cloud') return raw;
  return 'auto';
}

/** True when this model can be handed image parts, per the project's capability table. */
export function modelAcceptsImages(model: string, baseUrl = ''): boolean {
  // The Gemini native path takes `image_url` parts regardless of what the
  // capability table knows about a freshly released model id.
  if (baseUrl.includes('generativelanguage.googleapis.com')) return true;
  if (!model.trim()) return false;
  try {
    return getModelStrengths(model).includes('vision');
  } catch {
    return false;
  }
}

/**
 * Where the image goes for this turn. `local` and `cloud` are honoured
 * literally; `auto` sends the image only to a model declared multimodal.
 */
export function decideCompanionPhotoMode(options: {
  env?: NodeJS.ProcessEnv;
  model?: string;
  baseUrl?: string;
}): 'local' | 'cloud' {
  const requested = resolveCompanionPhotoVision(options.env ?? process.env);
  if (requested === 'local') return 'local';
  if (requested === 'cloud') return 'cloud';
  return modelAcceptsImages(options.model ?? '', options.baseUrl ?? '') ? 'cloud' : 'local';
}

function decodeBase64(payload: string): Buffer {
  const encoded = payload.startsWith('data:') ? payload.slice(payload.indexOf(',') + 1) : payload;
  return Buffer.from(encoded, 'base64');
}

/**
 * Resize to `COMPANION_PHOTO_MAX_DIMENSION` and re-encode to JPEG under
 * `COMPANION_PHOTO_MAX_BYTES`. `sharp` is an optional dependency: when it is
 * absent or fails, the original bytes are returned unchanged.
 */
export async function normalizeCompanionPhoto(
  bytes: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (bytes.length <= COMPANION_PHOTO_MAX_BYTES && mimeType === 'image/jpeg') {
    // Already small and already JPEG: re-encoding would only lose quality.
    return { bytes, mimeType };
  }
  try {
    const sharpModule = (await import('sharp')) as unknown as {
      default?: (input: Buffer) => SharpLike;
    };
    const sharp = sharpModule.default;
    if (typeof sharp !== 'function') return { bytes, mimeType };
    for (const quality of [82, 70, 58, 45]) {
      const encoded = await sharp(bytes)
        .rotate()
        .resize({
          width: COMPANION_PHOTO_MAX_DIMENSION,
          height: COMPANION_PHOTO_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (encoded.length <= COMPANION_PHOTO_MAX_BYTES) {
        return { bytes: encoded, mimeType: 'image/jpeg' };
      }
      if (quality === 45) return { bytes: encoded, mimeType: 'image/jpeg' };
    }
    return { bytes, mimeType };
  } catch (error) {
    logger.debug('[companion-photo] normalization skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { bytes, mimeType };
  }
}

/** Minimal structural type for the optional `sharp` dependency. */
interface SharpLike {
  rotate(): SharpLike;
  resize(options: Record<string, unknown>): SharpLike;
  jpeg(options: Record<string, unknown>): SharpLike;
  toBuffer(): Promise<Buffer>;
}

/** Load, authenticate and normalize one attachment. Returns null when unusable. */
async function loadPhoto(
  attachment: CompanionPhotoAttachment,
): Promise<{ photo: PreparedCompanionPhoto } | { error: string }> {
  let raw: Buffer;
  try {
    if (attachment.bytes) raw = attachment.bytes;
    else if (attachment.data) raw = decodeBase64(attachment.data);
    else if (attachment.path) raw = await readFile(attachment.path);
    else return { error: 'attachment carries no bytes' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'unreadable attachment' };
  }
  if (raw.length === 0) return { error: 'empty attachment' };
  if (raw.length > COMPANION_PHOTO_INPUT_MAX_BYTES) return { error: 'attachment too large' };
  // Authenticate from the bytes. A declared MIME type is a hint, never proof.
  const sniffed = sniffImageMime(raw);
  if (!sniffed) return { error: 'attachment is not an image' };
  const normalized = await normalizeCompanionPhoto(raw, sniffed);
  return {
    photo: {
      mimeType: normalized.mimeType,
      bytes: normalized.bytes,
      dataUrl: `data:${normalized.mimeType};base64,${normalized.bytes.toString('base64')}`,
    },
  };
}

/** Injectable local describer — production reuses `attached-image-grounding`. */
export type CompanionPhotoDescriber = (
  photos: PreparedCompanionPhoto[],
  caption: string,
  env: NodeJS.ProcessEnv,
) => Promise<string[]>;

async function defaultDescribe(
  photos: PreparedCompanionPhoto[],
  caption: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const { groundAttachedImages } = await import('./attached-image-grounding.js');
  const result = await groundAttachedImages(
    photos.map((photo) => ({
      type: 'image' as const,
      data: photo.dataUrl,
      mimeType: photo.mimeType,
    })),
    caption || 'Décris cette photo en une ou deux phrases concrètes.',
    { env },
  );
  if (result.status !== 'analyzed' || !result.observation) return [];
  // One bounded observation covers the whole batch; attribute it to the first
  // photo so the album sidecar and the prompt agree.
  return [result.observation];
}

export interface PrepareCompanionPhotosOptions {
  env?: NodeJS.ProcessEnv;
  /** The caption the user typed while sharing. */
  caption?: string;
  /** Resolved provider, so `auto` can tell multimodal from text-only. */
  model?: string;
  baseUrl?: string;
  /** Force a mode, bypassing the env decision (used by the local retry). */
  forceMode?: 'local' | 'cloud';
  describe?: CompanionPhotoDescriber;
}

/**
 * Validate, normalize and route a batch of shared photos. Never throws: a photo
 * that cannot be handled is reported in `rejected`, and the turn still happens.
 */
export async function prepareCompanionPhotos(
  attachments: CompanionPhotoAttachment[] | undefined,
  options: PrepareCompanionPhotosOptions = {},
): Promise<PreparedCompanionPhotos | null> {
  const list = (attachments ?? []).slice(0, COMPANION_PHOTO_MAX_COUNT);
  if (list.length === 0) return null;
  const env = options.env ?? process.env;
  const caption = String(options.caption ?? '').trim();

  const photos: PreparedCompanionPhoto[] = [];
  const rejected: string[] = [];
  for (const attachment of list) {
    const loaded = await loadPhoto(attachment);
    if ('error' in loaded) rejected.push(loaded.error);
    else photos.push(loaded.photo);
  }
  if (photos.length === 0) {
    return {
      mode: 'local',
      photos: [],
      userText: caption,
      guidance: '',
      descriptions: [],
      rejected,
    };
  }

  const mode =
    options.forceMode ??
    decideCompanionPhotoMode({
      env,
      ...(options.model ? { model: options.model } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });

  let descriptions: string[] = [];
  if (mode === 'local') {
    try {
      descriptions = await (options.describe ?? defaultDescribe)(photos, caption, env);
    } catch (error) {
      logger.warn('[companion-photo] local description unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      descriptions = [];
    }
    descriptions.forEach((description, index) => {
      const photo = photos[index];
      if (photo && description.trim()) photo.description = description.trim();
    });
  }

  const userText = buildUserText(caption, mode, descriptions, photos.length);
  return { mode, photos, userText, guidance: COMPANION_PHOTO_GUIDANCE, descriptions, rejected };
}

/**
 * The user message as the dialogue model sees it. In cloud mode the image is
 * carried by a part, so the text stays the caption. In local mode the
 * description IS the perception, and it must be visible in the message.
 */
export function buildUserText(
  caption: string,
  mode: 'local' | 'cloud',
  descriptions: string[],
  photoCount: number,
): string {
  const clean = caption.trim();
  if (mode === 'cloud') {
    return clean || (photoCount > 1 ? 'Regarde ces photos.' : 'Regarde cette photo.');
  }
  const described = descriptions.map((value) => value.trim()).filter(Boolean);
  if (described.length === 0) {
    const noun = photoCount > 1 ? 'photos' : 'photo';
    return [clean, `[${photoCount > 1 ? 'Photos envoyées' : 'Photo envoyée'} : ${photoCount} ${noun}, description indisponible]`]
      .filter(Boolean)
      .join('\n\n');
  }
  const lines = described.map((value) => `[Photo envoyée : ${value}]`);
  return [clean, ...lines].filter(Boolean).join('\n\n');
}

/**
 * Attach image parts to the last user message of an already-assembled prompt.
 * Returns a NEW array — the caller's prompt is never mutated in place.
 */
export function attachPhotoParts<T extends { role: string; content?: unknown }>(
  messages: T[],
  photos: PreparedCompanionPhoto[],
): T[] {
  if (photos.length === 0) return messages;
  const index = messages.map((message) => message.role).lastIndexOf('user');
  if (index < 0) return messages;
  const target = messages[index];
  if (!target) return messages;
  const text = typeof target.content === 'string' ? target.content : '';
  const parts = [
    { type: 'text', text },
    ...photos.map((photo) => ({
      type: 'image_url',
      image_url: { url: photo.dataUrl, detail: 'high' as const },
    })),
  ];
  const next = messages.slice();
  next[index] = { ...target, content: parts } as T;
  return next;
}

/** A one-line, bounded memory hook for the relational context. */
export function photoMemoryLine(description: string, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const summary = description
    .replace(/\s+/g, ' ')
    .replace(/^(?:IMAGE\s+\d+\/\d+\s*)/iu, '')
    .replace(/\b(?:TEXTE(?:\s+(?:LISIBLE|OCR))?|OBSERVATIONS?|INCERTITUDES?)\s*:?\s*/giu, '')
    .trim();
  const short = summary.length <= 120 ? summary : `${summary.slice(0, 119).trimEnd()}…`;
  return short ? `${date} : tu m'as montré ${short}` : `${date} : tu m'as montré une photo`;
}

/** Where a prepared batch came from, for the album sidecar. */
export type CompanionPhotoSurface = SharedPhotoSurface;
