/**
 * Opt-in heartbeat treatment: add one cached Lisa selfie per beat when ComfyUI
 * is reachable and the machine load is low. Never throws. Stops (skips) when
 * the generator is unreachable — no inner retry loop.
 *
 * @module companion/lisa-selfie-refill
 */

import { loadavg } from 'node:os';
import { logger } from '../utils/logger.js';
import {
  AVATAR_STYLE_IDS,
  getAvatarProfile,
  resolveAvatarId,
  type AvatarStyleId,
} from '../lora/lisa-avatar-bible.js';
import { buildLisaSelfiePrompt, resolveLisaContentTier, type LisaContentTier } from './lisa-selfie.js';
import {
  countLisaSelfieCacheImages,
  maybeIngestGeneratedLisaSelfie,
  resolveLisaSelfieCacheDir,
} from './lisa-selfie-ingest.js';

export const DEFAULT_SELFIE_REFILL_MIN = 2;
export const DEFAULT_SELFIE_REFILL_MAX_LOAD = 4;
export const DEFAULT_SELFIE_REFILL_EVERY = 40;

export interface LisaSelfieRefillDeps {
  env?: NodeJS.ProcessEnv;
  rootDir?: string;
  load1?: () => number;
  probeGenerator?: (url: string) => Promise<boolean>;
  generate?: (
    prompt: string,
    aspect: 'portrait',
    env: NodeJS.ProcessEnv,
  ) => Promise<{ success: boolean; outputPath?: string | null; error?: string }>;
  now?: () => Date;
}

export interface LisaSelfieRefillResult {
  ran: boolean;
  skipped?: 'disabled' | 'load' | 'unreachable' | 'full' | 'error';
  generated?: boolean;
  contentTier?: LisaContentTier;
  style?: AvatarStyleId;
}

export async function runLisaSelfieRefillPass(
  deps: LisaSelfieRefillDeps = {},
): Promise<LisaSelfieRefillResult> {
  try {
    const env = deps.env ?? process.env;
    if (env.CODEBUDDY_LISA_SELFIE_REFILL !== 'true') {
      return { ran: false, skipped: 'disabled' };
    }
    const load1 = (deps.load1 ?? (() => loadavg()[0] ?? 0))();
    const maxLoad = parsePositive(env.CODEBUDDY_LISA_SELFIE_REFILL_MAX_LOAD, DEFAULT_SELFIE_REFILL_MAX_LOAD);
    if (load1 >= maxLoad) {
      logger.info(`[lisa-selfie-refill] skip load=${load1.toFixed(2)} >= ${maxLoad}`);
      return { ran: false, skipped: 'load' };
    }
    const comfyUrl = (env.COMFYUI_URL ?? env.CODEBUDDY_IMAGE_BASE_URL ?? 'http://127.0.0.1:8188')
      .trim()
      .replace(/\/+$/, '');
    const probe = deps.probeGenerator ?? defaultProbe;
    const reachable = await probe(comfyUrl);
    if (!reachable) {
      logger.info('[lisa-selfie-refill] generator unreachable — skip this beat');
      return { ran: false, skipped: 'unreachable' };
    }

    const cacheDir = resolveLisaSelfieCacheDir(env, deps.rootDir ?? process.cwd());
    const min = Math.max(1, Math.min(20, Math.floor(
      parsePositive(env.CODEBUDDY_LISA_SELFIE_REFILL_MIN, DEFAULT_SELFIE_REFILL_MIN),
    )));
    const allowedTier = resolveLisaContentTier(env);
    const tiers: LisaContentTier[] = allowedTier === 'sensual' || allowedTier === 'explicit'
      ? ['safe', 'sensual']
      : ['safe'];
    const styles = [...AVATAR_STYLE_IDS];
    let gap: { tier: LisaContentTier; style: AvatarStyleId } | undefined;
    for (const tier of tiers) {
      for (const style of styles) {
        const count = await countLisaSelfieCacheImages(cacheDir, tier, style);
        if (count < min) {
          gap = { tier, style };
          break;
        }
      }
      if (gap) break;
    }
    if (!gap) return { ran: true, skipped: 'full' };

    const rootDir = deps.rootDir ?? process.cwd();
    const generate = deps.generate ?? (async (prompt, aspect, genEnv) => {
      const { generateImage } = await import('../tools/media-generation-tool.js');
      const generated = await generateImage(
        { prompt, aspectRatio: aspect },
        { rootDir, env: genEnv },
      );
      return {
        success: generated.success,
        outputPath: generated.outputPath ?? generated.image,
        ...(generated.error ? { error: generated.error } : {}),
      };
    });
    const avatarId = resolveAvatarId(undefined, env);
    const profile = getAvatarProfile(avatarId);
    const prompt = buildLisaSelfiePrompt({
      trigger: profile.trigger,
      mood: gap.style,
      style: gap.style,
      avatarId,
      contentTier: gap.tier,
    });
    const result = await generate(prompt, 'portrait', env);
    if (!result.success || !result.outputPath) {
      logger.warn(`[lisa-selfie-refill] generate failed: ${result.error ?? 'no path'}`);
      return { ran: true, skipped: 'error', contentTier: gap.tier, style: gap.style };
    }
    await maybeIngestGeneratedLisaSelfie({
      sourcePath: result.outputPath,
      prompt,
      contentTier: gap.tier,
      style: gap.style,
      model: 'lisa-selfie-refill',
      provider: 'refill',
      env,
      rootDir,
      ...(deps.now ? { now: deps.now } : {}),
    });
    logger.info(`[lisa-selfie-refill] generated tier=${gap.tier} style=${gap.style}`);
    return { ran: true, generated: true, contentTier: gap.tier, style: gap.style };
  } catch (err) {
    logger.warn(
      `[lisa-selfie-refill] pass failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ran: false, skipped: 'error' };
  }
}

async function defaultProbe(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    try {
      const response = await fetch(`${url}/system_stats`, { method: 'GET', signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function parsePositive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
