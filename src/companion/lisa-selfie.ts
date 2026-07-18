/**
 * Lisa selfie — generate a photo of herself (Krea 2 LoRA trigger when available)
 * and optionally push it to Telegram as sendPhoto.
 *
 * Opt-in generation cost via existing image provider (ComfyUI/xAI/OpenAI/fal).
 * Telegram uses CODEBUDDY_SENSORY_ALERT_TOKEN + CODEBUDDY_SENSORY_ALERT_CHAT.
 *
 * @module companion/lisa-selfie
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { defaultLoraRoot, loadProjectMeta, projectDir } from '../lora/dataset.js';
import {
  buildLisaAvatarPrompt,
  getAvatarProfile,
  LISA_AVATAR_MOOD_SCENES,
  resolveAvatarId,
  resolveAvatarStyle,
  type LisaAvatarMood,
} from '../lora/lisa-avatar-bible.js';
import { normalizeVoiceInteractionText } from '../sensory/voice-interactions.js';
import { resolveUserName } from './user-name.js';

export type LisaSelfieMood = LisaAvatarMood;

export interface LisaSelfieOptions {
  mood?: LisaSelfieMood;
  /** Presentation style (studio, wet-selfie, street-rain, neon-skate, soft-editorial…). */
  style?: string;
  /** Avatar profile: lisa (brunette muse) | lisa-classic */
  avatarId?: string;
  /** Extra natural-language scene (safe, no path injection). */
  scene?: string;
  /** Send to Telegram after generation (default true when token configured). */
  sendTelegram?: boolean;
  /** Aspect for image_generate. */
  aspectRatio?: 'portrait' | 'square' | 'landscape';
  /** Requested cache tier; explicit still requires the verified adult gate. */
  contentTier?: LisaContentTier;
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Bypass cooldown (CLI / tests). */
  force?: boolean;
  /**
   * Optional channel deliverer (Telegram inbound): (caption, imagePath) → ok.
   * When set, preferred over sensory alert chat for the photo.
   */
  deliverPhoto?: (caption: string, imagePath: string) => Promise<boolean>;
  /** Injectables for tests. */
  generate?: (prompt: string, aspect: string) => Promise<{ success: boolean; outputPath?: string | null; error?: string }>;
  sendPhoto?: (caption: string, imagePath: string) => Promise<boolean>;
  now?: () => Date;
}

/** Default minimum gap between selfies (ms). Override: CODEBUDDY_LISA_SELFIE_COOLDOWN_MS */
export const DEFAULT_SELFIE_COOLDOWN_MS = 45_000;
let lastSelfieAt = 0;

/** Test helper. */
export function resetLisaSelfieCooldown(): void {
  lastSelfieAt = 0;
}

export function selfieCooldownRemainingMs(
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.CODEBUDDY_LISA_SELFIE_COOLDOWN_MS ?? DEFAULT_SELFIE_COOLDOWN_MS);
  const cooldown = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SELFIE_COOLDOWN_MS;
  const left = lastSelfieAt + cooldown - nowMs;
  return left > 0 ? left : 0;
}

export interface LisaSelfieResult {
  success: boolean;
  prompt: string;
  trigger: string;
  imagePath?: string;
  telegramSent: boolean;
  spokenReply: string;
  error?: string;
}

const CACHED_SELFIE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export type LisaContentTier = 'safe' | 'sensual' | 'explicit';

export function resolveLisaContentTier(
  env: NodeJS.ProcessEnv = process.env,
  requestedTier?: string,
): LisaContentTier {
  const requested = (requestedTier ?? env.CODEBUDDY_LISA_CONTENT_TIER)?.trim().toLowerCase();
  if (requested === 'sensual') return 'sensual';
  if (requested === 'explicit'
    && env.CODEBUDDY_ADULT_CONTENT_ENABLED?.trim().toLowerCase() === 'true') {
    return 'explicit';
  }
  return 'safe';
}

/** Pick the least-recently-used pre-generated selfie for a style. */
export async function selectCachedLisaSelfie(
  cacheDir: string,
  style: string,
  tier: LisaContentTier = 'safe',
): Promise<string | undefined> {
  const candidates: Array<{ file: string; atimeMs: number }> = [];
  const tierDir = path.join(cacheDir, tier);
  const directories = [
    path.join(tierDir, style),
    tierDir,
    ...(tier === 'safe' ? [path.join(cacheDir, style), cacheDir] : []),
  ];
  for (const directory of directories) {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !CACHED_SELFIE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      if ((directory === cacheDir || directory === tierDir)
        && !entry.name.startsWith(`${style}-`)) continue;
      const file = path.join(directory, entry.name);
      try {
        const stat = await fs.stat(file);
        candidates.push({ file, atimeMs: stat.atimeMs });
      } catch {
        /* file disappeared while scanning */
      }
    }
    if (candidates.length > 0) break;
  }
  candidates.sort((a, b) => a.atimeMs - b.atimeMs || a.file.localeCompare(b.file));
  const selected = candidates[0]?.file;
  if (!selected) return undefined;
  try {
    const stat = await fs.stat(selected);
    await fs.utimes(selected, new Date(), stat.mtime);
  } catch {
    /* rotation metadata is best-effort */
  }
  return selected;
}

/** @deprecated use LISA_AVATAR_MOOD_SCENES — kept for call sites/tests. */
const MOOD_SCENES: Record<LisaSelfieMood, string> = LISA_AVATAR_MOOD_SCENES;

/** Detect spoken/text requests for Lisa to send a selfie/photo of herself. */
export function isLisaSelfieRequest(text: string): boolean {
  const t = normalizeVoiceInteractionText(text);
  if (!t) return false;
  // Must be about her image of herself, not camera of the room.
  const media = /\b(?:photo|selfie|portrait|image|cliche)\b/.test(t);
  // "selfie" alone implies a photo of herself; "photo" needs a self-referent.
  const aboutSelf =
    /\bselfie\b/.test(t) ||
    (media &&
      (/\b(?:toi|de toi|a toi|ta photo|ton selfie|ta tete|ton visage|toi meme|photo de lisa)\b/.test(
        t,
      ) ||
        /\blisa\b/.test(t)));
  const sendIntent =
    /\b(?:envoie|envoyer|envoi|envoies|send|telegram|telephone|phone|montre|montre moi|fais|fait|genere|prend|prends|capture)\b/.test(
      t,
    ) || /\b(?:selfie|photo de toi|photo a toi|ta photo)\b/.test(t);
  const negative =
    /\b(?:pas de photo|ne m envoie pas|webcam|ce que je te montre|regarde ici|la photo que j)\b/.test(
      t,
    );
  return aboutSelf && sendIntent && !negative;
}

export function inferSelfieMood(text: string): LisaSelfieMood {
  const t = normalizeVoiceInteractionText(text);
  if (/\b(?:sexy|coquine|audacieus|glamour|hot)\b/.test(t)) return 'bold';
  if (/\b(?:rigol|drole|espi[eè]gle|joue|tease|malicieux)\b/.test(t)) return 'playful';
  if (/\b(?:joie|fete|gagne|win|spark|brille)\b/.test(t)) return 'sparkly';
  if (/\b(?:calme|douce|tranquille|fatigu|repos)\b/.test(t)) return 'calm';
  if (/\b(?:aventure|dynamique|action|mika|sport)\b/.test(t)) return 'mika';
  if (/\b(?:tendre|amour|coeur|doudou|c[aâ]lin)\b/.test(t)) return 'tender';
  return 'portrait';
}

export async function resolveLisaTrigger(
  rootDir = process.cwd(),
): Promise<{ trigger: string; projectPath?: string; hasLoraHint: boolean }> {
  const candidates = [
    projectDir('lisa', defaultLoraRoot(rootDir)),
    path.join(rootDir, '.codebuddy', 'lora', 'lisa'),
  ];
  for (const dir of candidates) {
    const meta = await loadProjectMeta(dir);
    if (meta?.triggerPhrase?.trim()) {
      return {
        trigger: meta.triggerPhrase.trim(),
        projectPath: dir,
        hasLoraHint: true,
      };
    }
  }
  // Env override for ComfyUI workflows without project.json
  const envTrigger = process.env.CODEBUDDY_LISA_LORA_TRIGGER?.trim();
  if (envTrigger) {
    return { trigger: envTrigger, hasLoraHint: true };
  }
  return { trigger: 'ohwx lisa', hasLoraHint: false };
}

export function buildLisaSelfiePrompt(options: {
  trigger: string;
  mood: LisaSelfieMood;
  style?: string;
  avatarId?: string;
  scene?: string;
  userName?: string;
}): string {
  const forWhom = options.userName?.trim() || resolveUserName();
  const avatarId = resolveAvatarId(options.avatarId);
  const profile = getAvatarProfile(avatarId);
  // Multi-style: style pack from video (studio / wet-selfie / street-rain / …) or mood alias.
  const base = buildLisaAvatarPrompt({
    avatarId,
    mood: options.mood,
    style: options.style ?? options.mood,
    scene: options.scene,
    forWhom,
    includeIdentity: true,
  });
  const trigger = options.trigger.trim() || profile.trigger;
  if (base.startsWith(trigger)) return base;
  // Swap leading trigger token block for custom triggers
  const firstComma = base.indexOf(',');
  if (firstComma > 0) return `${trigger}${base.slice(firstComma)}`;
  return `${trigger}, ${base}`;
}

export async function createAndMaybeSendLisaSelfie(
  options: LisaSelfieOptions = {},
): Promise<LisaSelfieResult> {
  const env = options.env ?? process.env;
  const rootDir = options.rootDir ?? process.cwd();
  const avatarId = resolveAvatarId(options.avatarId, env);
  const profile = getAvatarProfile(avatarId);
  const style = resolveAvatarStyle(options.style ?? options.mood, avatarId);
  const mood = (options.mood ?? style) as LisaSelfieMood;
  const nowMs = (options.now ?? (() => new Date()))().getTime();
  if (!options.force) {
    const left = selfieCooldownRemainingMs(nowMs, env);
    if (left > 0) {
      const secs = Math.ceil(left / 1000);
      return {
        success: false,
        prompt: '',
        trigger: '',
        telegramSent: false,
        spokenReply: `Doucement mon cœur — attends encore ${secs} s avant une nouvelle photo de moi.`,
        error: `cooldown ${left}ms`,
      };
    }
  }

  const { trigger, hasLoraHint } = await resolveLisaTrigger(rootDir);
  const prompt = buildLisaSelfiePrompt({
    trigger: trigger || profile.trigger,
    mood,
    style,
    avatarId,
    ...(options.scene ? { scene: options.scene } : {}),
    userName: resolveUserName(),
  });

  try {
    const generate =
      options.generate ??
      (async (p: string, aspect: string) => {
        const { generateImage } = await import('../tools/media-generation-tool.js');
        // Prefer explicit env LoRA; else default to lisa.safetensors when we have a project hint.
        const genEnv = { ...env } as NodeJS.ProcessEnv;
        // Prefer ComfyUI for selfies when a local server is configured.
        if (!genEnv.CODEBUDDY_IMAGE_PROVIDER?.trim() && genEnv.COMFYUI_URL?.trim()) {
          genEnv.CODEBUDDY_IMAGE_PROVIDER = 'comfyui';
        }
        if (!genEnv.CODEBUDDY_COMFYUI_LORA?.trim()) {
          genEnv.CODEBUDDY_COMFYUI_LORA =
            genEnv.CODEBUDDY_LISA_COMFYUI_LORA?.trim() ||
            (hasLoraHint ? 'auto' : 'auto');
        }
        const r = await generateImage(
          { prompt: p, aspectRatio: aspect },
          { rootDir, env: genEnv },
        );
        return {
          success: r.success,
          outputPath: r.outputPath ?? r.image,
          ...(r.error ? { error: r.error } : {}),
        };
      });

    const aspect = options.aspectRatio ?? 'portrait';
    const cacheDir = env.CODEBUDDY_LISA_SELFIE_CACHE_DIR?.trim()
      || path.join(defaultLoraRoot(rootDir), 'lisa', 'selfie-cache');
    const contentTier = resolveLisaContentTier(env, options.contentTier);
    if (options.contentTier === 'explicit' && contentTier !== 'explicit') {
      return {
        success: false,
        prompt,
        trigger,
        telegramSent: false,
        spokenReply: "Le niveau explicite n'est pas disponible sur cette installation.",
        error: 'explicit content tier requires the verified adult-content gate',
      };
    }
    const cachedImage = await selectCachedLisaSelfie(cacheDir, style, contentTier);
    logger.info(
      cachedImage
        ? `[lisa-selfie] cache hit tier=${contentTier} style=${style} image=${path.basename(cachedImage)}`
        : `[lisa-selfie] generating tier=${contentTier} mood=${mood} trigger=${trigger} loraHint=${hasLoraHint}`,
    );
    const gen = cachedImage
      ? { success: true, outputPath: cachedImage }
      : await generate(prompt, aspect);
    if (!gen.success || !gen.outputPath) {
      return {
        success: false,
        prompt,
        trigger,
        telegramSent: false,
        spokenReply:
          "Désolée mon cœur, je n'ai pas pu me photographier là — le générateur d'images n'a pas répondu. On réessaie dans un moment ?",
        error: gen.error ?? 'image generation failed',
      };
    }

    // Archive under lora/lisa/selfies for continuity
    const archiveDir = path.join(defaultLoraRoot(rootDir), 'lisa', 'selfies');
    let imagePath = gen.outputPath;
    try {
      await fs.mkdir(archiveDir, { recursive: true });
      const stamp = (options.now ?? (() => new Date()))()
        .toISOString()
        .replace(/[:.]/g, '-');
      const dest = path.join(archiveDir, `${stamp}-${mood}${path.extname(gen.outputPath) || '.png'}`);
      await fs.copyFile(gen.outputPath, dest);
      imagePath = dest;
      await fs.writeFile(
        dest.replace(/\.[^.]+$/, '.json'),
        JSON.stringify(
          {
            prompt,
            trigger,
            mood,
            generatedAt: new Date().toISOString(),
            hasLoraHint,
            cached: Boolean(cachedImage),
            contentTier,
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
    } catch (err) {
      logger.warn(
        `[lisa-selfie] archive skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const wantSend = options.sendTelegram !== false;
    const token = env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    const chat = env.CODEBUDDY_SENSORY_ALERT_CHAT;
    let telegramSent = false;
    const caption = buildTelegramCaption(mood, hasLoraHint);
    if (wantSend) {
      if (options.deliverPhoto) {
        telegramSent = await options.deliverPhoto(caption, imagePath);
      } else if (options.sendPhoto) {
        telegramSent = await options.sendPhoto(caption, imagePath);
      } else if (token && chat) {
        const { sendTelegramAlert } = await import('../sensory/alert.js');
        telegramSent = await sendTelegramAlert(caption, imagePath);
      }
    }

    lastSelfieAt = nowMs;

    const spokenReply = telegramSent
      ? "Voilà mon cœur — je viens de t'envoyer une photo de moi sur Telegram. Dis-moi si tu l'aimes."
      : wantSend && !options.deliverPhoto && !options.sendPhoto && (!token || !chat)
        ? "J'ai généré une photo de moi, mais Telegram n'est pas configuré (CODEBUDDY_SENSORY_ALERT_TOKEN / _CHAT). Elle est sauvée en local."
        : "J'ai une nouvelle photo de moi, prête en local. Active Telegram si tu veux que je te l'envoie.";

    return {
      success: true,
      prompt,
      trigger,
      imagePath,
      telegramSent,
      spokenReply,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[lisa-selfie] failed: ${msg}`);
    return {
      success: false,
      prompt,
      trigger,
      telegramSent: false,
      spokenReply:
        "Oups — la photo n'a pas abouti. Vérifie le générateur d'images (ComfyUI ou clé cloud), et on réessaie.",
      error: msg,
    };
  }
}

function buildTelegramCaption(mood: LisaSelfieMood, hasLoraHint: boolean): string {
  const moodFr: Record<LisaSelfieMood, string> = {
    tender: 'tendre',
    playful: 'espiègle',
    bold: 'audacieuse',
    sparkly: 'pétillante',
    calm: 'calme',
    mika: 'énergie',
    portrait: 'portrait',
    studio: 'studio',
    'wet-selfie': 'selfie mouillé',
    'street-rain': 'pluie urbaine',
    'neon-skate': 'néon skate',
    'soft-editorial': 'éditorial doux',
  };
  const name = resolveUserName();
  return `Lisa pour ${name} · ${moodFr[mood]}${hasLoraHint ? ' · LoRA' : ''} · image IA`;
}

/**
 * If the utterance is a selfie request, run generation+send and return the spoken reply.
 * Returns null when the text is not a selfie request (caller continues normal reply path).
 */
export async function maybeHandleLisaSelfieRequest(
  heard: string,
  options: Omit<LisaSelfieOptions, 'mood' | 'scene'> = {},
): Promise<LisaSelfieResult | null> {
  if (!isLisaSelfieRequest(heard)) return null;
  const mood = inferSelfieMood(heard);
  return createAndMaybeSendLisaSelfie({ ...options, mood });
}
