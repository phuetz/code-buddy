/**
 * Vision reaction — on a `vision/motion` event from the nervous-system daemon
 * (buddy-sense), describe the daemon's keyframe with a LOCAL vision model
 * (Ollama, `CODEBUDDY_VISION_MODEL`), record a companion percept, and — if an
 * alert chat is configured — ping the user on Telegram with the photo + caption.
 *
 * DEBOUNCED (a VLM call is 1–10s), opt-in (`CODEBUDDY_SENSORY_CAMERA=true` + a
 * shared token), best-effort, never-throws. NOTE: the old default used "gemma
 * vision" but gemma is text-only — we now use a real vision model on the keyframe
 * the daemon already captured (no re-capture → no webcam contention).
 *
 * @module sensory/vision-reaction
 */

import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';
import { sendTelegramAlert } from './alert.js';
import {
  safeCameraKeyframePath,
  telegramVisionPhotoPath,
} from './camera-keyframe-policy.js';
import { redactVisionDescriptionForEgress } from './vision-description-safety.js';

/** Varied prefixes for the motion Telegram caption (the `${desc}` suffix already
 *  varies with the scene) so the notification isn't the exact same opening
 *  every time. `pickMotionPrefix` rotates and avoids the consecutive repeat. */
export const MOTION_PREFIXES = ['👁️ Mouvement', '👀 Ça bouge', '🎥 J’ai vu bouger', '🌟 Du mouvement'];
let lastMotionPrefixIdx = -1;
export function pickMotionPrefix(rng: () => number = Math.random): string {
  let idx = Math.floor(rng() * MOTION_PREFIXES.length) % MOTION_PREFIXES.length;
  if (idx === lastMotionPrefixIdx) idx = (idx + 1) % MOTION_PREFIXES.length;
  lastMotionPrefixIdx = idx;
  return MOTION_PREFIXES[idx]!;
}

export interface VisionAnalysis {
  success: boolean;
  description?: string;
  imagePath?: string;
}

export interface VisionAnalyzer {
  /** Describe a scene. `imagePath` is the keyframe captured by the daemon. */
  analyze(prompt: string, imagePath?: string): Promise<VisionAnalysis>;
}

export interface VisionReactionOptions {
  /** Injectable analyzer (tests / custom). Defaults to the local-VLM analyzer. */
  analyzer?: VisionAnalyzer;
  debounceMs?: number;
  cwd?: string;
  now?: () => number;
}

const DEFAULT_VISION_DEBOUNCE_MS = 8000;
const DEFAULT_VISION_ALERT_COOLDOWN_MS = 300_000;
const DEFAULT_VISION_ALERT_SIMILARITY = 0.6;

function configuredNumber(value: number | string | undefined): number {
  return typeof value === 'string' && !value.trim() ? Number.NaN : Number(value);
}

function resolveNonNegativeMs(
  value: number | string | undefined,
  fallback: number,
  label: string,
): number {
  const parsed = configuredNumber(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  if (value !== undefined) {
    logger.warn(`[vision] invalid ${label} ${JSON.stringify(value)}; using ${fallback}`);
  }
  return fallback;
}

function resolveSimilarityThreshold(value: string | undefined): number {
  const parsed = configuredNumber(value);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  if (value !== undefined) {
    logger.warn(
      `[vision] invalid alert similarity ${JSON.stringify(value)}; using ${DEFAULT_VISION_ALERT_SIMILARITY}`,
    );
  }
  return DEFAULT_VISION_ALERT_SIMILARITY;
}

export function shouldAllowVisionImageEndpoint(
  baseURL: string,
  remoteConsent = process.env.CODEBUDDY_VISION_REMOTE_IMAGE === 'true',
): boolean {
  try {
    const url = new URL(baseURL);
    const loopback = url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '[::1]';
    if (loopback) return url.protocol === 'http:' || url.protocol === 'https:';
    return remoteConsent && url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Default analyzer: describe a validated daemon keyframe with a local Ollama
 * vision model. It never re-captures: missing frames fail closed. */
async function defaultAnalyze(prompt: string, imagePath?: string): Promise<VisionAnalysis> {
  if (imagePath) {
    try {
      const baseURL = process.env.CODEBUDDY_VISION_BASE_URL || 'http://127.0.0.1:11434/v1';
      if (!shouldAllowVisionImageEndpoint(baseURL)) {
        logger.warn('[vision] refusing raw image egress to a non-loopback VLM endpoint');
        return { success: false, imagePath };
      }
      const { loadImageFromFile, buildMultimodalContent } = await import('../tools/image-input.js');
      const { CodeBuddyClient } = await import('../codebuddy/client.js');
      const img = await loadImageFromFile(imagePath);
      const content = buildMultimodalContent(prompt, [img]);
      const model = process.env.CODEBUDDY_VISION_MODEL || 'moondream';
      const client = new CodeBuddyClient(process.env.OLLAMA_API_KEY || 'ollama', model, baseURL);
      const resp = await client.chat([{ role: 'user', content } as never], []);
      const desc = (resp?.choices?.[0]?.message?.content ?? '').trim();
      return { success: Boolean(desc), description: desc, imagePath };
    } catch (err) {
      logger.warn(`[vision] local VLM analyze failed: ${err instanceof Error ? err.message : String(err)}`);
      return { success: false, imagePath };
    }
  }
  return { success: false };
}

/** Security invariant (pure + testable): the camera reaction may only be wired
 * when explicitly enabled AND a shared token is set — a crafted local frame can
 * trigger the analysis, so an unauthenticated bridge must not be able to. */
export function shouldWireVisionReaction(env: { camera?: string; token?: string }): boolean {
  return env.camera === 'true' && Boolean(env.token);
}

/** Word-overlap (Jaccard) between two scene descriptions, 0..1. Used to decide
 *  whether a new scene is "the same as last time" (→ suppress a duplicate alert). */
function sceneSimilarity(a: string, b: string): number {
  const toks = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const wa = toks(a);
  const wb = toks(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export function wireVisionReaction(options: VisionReactionOptions = {}): () => void {
  const bus = getGlobalEventBus();
  const debounceMs = resolveNonNegativeMs(
    options.debounceMs ?? process.env.CODEBUDDY_VISION_DEBOUNCE_MS,
    DEFAULT_VISION_DEBOUNCE_MS,
    'debounce',
  );
  const now = options.now ?? (() => Date.now());
  const analyzer: VisionAnalyzer = options.analyzer ?? { analyze: defaultAnalyze };
  // Anti-spam: for a remote watch, only alert when the scene meaningfully CHANGES
  // vs the last alerted scene, or after a long cooldown (periodic refresh).
  const alertCooldownMs = resolveNonNegativeMs(
    process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS,
    DEFAULT_VISION_ALERT_COOLDOWN_MS,
    'alert cooldown',
  );
  const alertSimThreshold = resolveSimilarityThreshold(process.env.CODEBUDDY_VISION_ALERT_SIM);
  let lastAlertAt = Number.NEGATIVE_INFINITY;
  let lastAlertedDesc = '';
  let lastAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    if (p.modality !== 'vision' || p.kind !== 'motion') return;

    const t = now();
    if (t - lastAt < debounceMs) {
      logger.info('[vision] motion (debounced — analysis throttled)');
      return;
    }
    if (inFlight) return; // a prior analyze() (VLM, 1–10s) is still running
    lastAt = t;
    inFlight = true;

    const payload = (p.payload ?? {}) as { imagePath?: string; camera?: string };
    void (async () => {
      try {
        const suppliedFrame = await safeCameraKeyframePath(payload.imagePath);
        if (payload.imagePath && !suppliedFrame) {
          logger.warn('[vision] rejected keyframe outside the configured camera spool');
          return;
        }
        const res = await analyzer.analyze(
          'Décris la scène en une phrase courte : objets génériques et situation notable. Ne transcris aucun texte/OCR, nom, adresse, téléphone, identifiant, secret ou visage reconnu.',
          suppliedFrame,
        );
        if (!res.success) return;
        const desc = res.description?.trim();
        if (!desc) {
          logger.warn('[vision] analyzer reported success without a description; ignoring result');
          return;
        }
        const alertDescription = redactVisionDescriptionForEgress(desc, 900) ?? '(description indisponible)';
        const frame = await safeCameraKeyframePath(res.imagePath ?? suppliedFrame);
        // Publish perception before optional journaling/notification work. A
        // filesystem or channel failure must not make Lisa cognitively blind.
        const describedAt = now();
        bus.emit('sensory:perception', {
          source: 'sensory_motion_reaction',
          metadata: {
            modality: 'vision',
            kind: 'scene_described',
            tsMs: describedAt,
            salience: 150,
            payload: {
              camera: payload.camera,
              description: desc,
              confidence: 0.9,
            },
          },
        });
        const { recordCompanionPercept } = await import('../companion/percepts.js');
        await recordCompanionPercept(
          {
            modality: 'vision',
            source: 'sensory_motion_reaction',
            summary: `Motion → ${desc}`,
            confidence: 0.9,
            payload: { description: desc, imagePath: frame, camera: payload.camera },
            tags: ['motion', 'camera', 'vision'],
          },
          options.cwd ? { cwd: options.cwd } : {},
        );
        logger.info(`[vision] motion analyzed → ${desc}`);
        // Alert only on a meaningfully different scene OR after the cooldown.
        if (sceneSimilarity(desc, lastAlertedDesc) < alertSimThreshold || now() - lastAlertAt >= alertCooldownMs) {
          const delivered = await sendTelegramAlert(
            `${pickMotionPrefix()}${payload.camera ? ' (caméra locale)' : ''} : ${alertDescription}`,
            telegramVisionPhotoPath(frame),
          );
          if (delivered) {
            lastAlertAt = now();
            lastAlertedDesc = desc;
          } else if (
            process.env.CODEBUDDY_SENSORY_ALERT_TOKEN &&
            process.env.CODEBUDDY_SENSORY_ALERT_CHAT
          ) {
            logger.warn('[vision] Telegram alert was not delivered; cooldown not armed');
          }
        } else {
          logger.info('[vision] alert suppressed (scène similaire dans le cooldown)');
        }
      } catch (err) {
        logger.warn(`[vision] reaction failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        inFlight = false;
      }
    })();
  });

  return () => {
    bus.off(id);
  };
}
