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

/** Default analyzer: describe the daemon's keyframe with a LOCAL Ollama vision
 *  model. Falls back to the `camera_analyze` tool (re-capture) when no keyframe. */
async function defaultAnalyze(prompt: string, imagePath?: string): Promise<VisionAnalysis> {
  if (imagePath) {
    try {
      const { loadImageFromFile, buildMultimodalContent } = await import('../tools/image-input.js');
      const { CodeBuddyClient } = await import('../codebuddy/client.js');
      const img = await loadImageFromFile(imagePath);
      const content = buildMultimodalContent(prompt, [img]);
      const model = process.env.CODEBUDDY_VISION_MODEL || 'moondream';
      const baseURL = process.env.CODEBUDDY_VISION_BASE_URL || 'http://127.0.0.1:11434/v1';
      const client = new CodeBuddyClient(process.env.OLLAMA_API_KEY || 'ollama', model, baseURL);
      const resp = await client.chat([{ role: 'user', content } as never], []);
      const desc = (resp?.choices?.[0]?.message?.content ?? '').trim();
      return { success: Boolean(desc), description: desc, imagePath };
    } catch (err) {
      logger.warn(`[vision] local VLM analyze failed: ${err instanceof Error ? err.message : String(err)}`);
      return { success: false, imagePath };
    }
  }
  // No keyframe supplied → legacy re-capture path (camera_analyze tool).
  const { CameraAnalyzeTool } = await import('../tools/registry/vision-tools.js');
  const tool = new CameraAnalyzeTool({});
  const result = await tool.execute({ prompt });
  const data = result.data as { description?: string; imagePath?: string } | undefined;
  return { success: result.success, description: data?.description ?? result.output, imagePath: data?.imagePath };
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
  const debounceMs = options.debounceMs ?? Number(process.env.CODEBUDDY_VISION_DEBOUNCE_MS ?? 8000);
  const now = options.now ?? (() => Date.now());
  const analyzer: VisionAnalyzer = options.analyzer ?? { analyze: defaultAnalyze };
  // Anti-spam: for a remote watch, only alert when the scene meaningfully CHANGES
  // vs the last alerted scene, or after a long cooldown (periodic refresh).
  const alertCooldownMs = Number(process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS ?? 300_000);
  const alertSimThreshold = Number(process.env.CODEBUDDY_VISION_ALERT_SIM ?? 0.6);
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
        const res = await analyzer.analyze(
          'Décris la scène en une phrase courte : qui/quoi, et est-ce notable (personne, mouvement inhabituel) ?',
          payload.imagePath,
        );
        if (!res.success) return;
        const desc = res.description ?? '(no description)';
        const frame = res.imagePath ?? payload.imagePath;
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
          lastAlertAt = now();
          lastAlertedDesc = desc;
          await sendTelegramAlert(`${pickMotionPrefix()}${payload.camera ? ` (${payload.camera})` : ''} : ${desc}`, frame);
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
