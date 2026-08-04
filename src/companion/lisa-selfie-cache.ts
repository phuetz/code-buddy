/** Pre-generate a rotating local library of Lisa selfies for instant delivery. */

import fs from 'fs/promises';
import path from 'path';
import { defaultLoraRoot } from '../lora/dataset.js';
import {
  AVATAR_STYLE_IDS,
  getAvatarProfile,
  resolveAvatarId,
  type AvatarStyleId,
} from '../lora/lisa-avatar-bible.js';
import { logger } from '../utils/logger.js';
import {
  buildMySoulmateMomentPrompt,
  resolveMySoulmateImageMoment,
} from './mysoulmate-image-prompts.js';
import {
  buildLisaSelfiePrompt,
  type LisaContentTier,
} from './lisa-selfie.js';
import { resolveUserName } from './user-name.js';

export interface LisaSelfieCacheOptions {
  rootDir?: string;
  cacheDir?: string;
  avatarId?: string;
  styles?: AvatarStyleId[];
  imagesPerStyle?: number;
  contentTier?: LisaContentTier;
  baseSeed?: number;
  env?: NodeJS.ProcessEnv;
  resume?: boolean;
  generate?: (
    prompt: string,
    aspect: 'portrait',
    env: NodeJS.ProcessEnv,
  ) => Promise<{ success: boolean; outputPath?: string | null; error?: string }>;
  onProgress?: (event: {
    index: number;
    total: number;
    style: AvatarStyleId;
    outputPath?: string;
    error?: string;
  }) => void;
}

export interface LisaSelfieCacheResult {
  cacheDir: string;
  contentTier: LisaContentTier;
  generated: number;
  skipped: number;
  failed: number;
  files: string[];
  errors: string[];
}

export async function generateLisaSelfieCache(
  options: LisaSelfieCacheOptions = {},
): Promise<LisaSelfieCacheResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const cacheDir = options.cacheDir
    ?? path.join(defaultLoraRoot(rootDir), 'lisa', 'selfie-cache');
  const avatarId = resolveAvatarId(options.avatarId, options.env ?? process.env);
  const profile = getAvatarProfile(avatarId);
  const contentTier = options.contentTier ?? 'safe';
  if (contentTier === 'explicit' && baseEnvValue(options.env, 'CODEBUDDY_ADULT_CONTENT_ENABLED') !== 'true') {
    throw new Error('Explicit cache generation requires a verified adult-content route');
  }
  if (contentTier === 'explicit') {
    throw new Error('Explicit cache generation requires a separate policy-approved prompt provider');
  }
  const styles = options.styles?.length ? options.styles : [...AVATAR_STYLE_IDS];
  const imagesPerStyle = Math.max(1, Math.min(20, Math.floor(options.imagesPerStyle ?? 5)));
  const baseSeed = Math.max(0, Math.floor(options.baseSeed ?? 880_000));
  const total = styles.length * imagesPerStyle;
  const baseEnv = { ...(options.env ?? process.env) } as NodeJS.ProcessEnv;
  const generate = options.generate ?? (async (prompt, aspect, env) => {
    const { generateImage } = await import('../tools/media-generation-tool.js');
    try {
      const result = await generateImage({ prompt, aspectRatio: aspect }, { rootDir, env });
      return { success: result.success, outputPath: result.outputPath ?? result.image };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const files: string[] = [];
  const errors: string[] = [];
  let index = 0;

  for (const style of styles) {
    const styleDir = path.join(cacheDir, contentTier, style);
    await fs.mkdir(styleDir, { recursive: true });
    for (let variation = 1; variation <= imagesPerStyle; variation++) {
      const outputPath = path.join(styleDir, `${style}-${String(variation).padStart(3, '0')}.png`);
      const eventIndex = index++;
      if (options.resume !== false) {
        try {
          const stat = await fs.stat(outputPath);
          if (stat.isFile() && stat.size > 0) {
            skipped += 1;
            files.push(outputPath);
            options.onProgress?.({ index: eventIndex, total, style, outputPath });
            continue;
          }
        } catch {
          /* generate missing cache entry */
        }
      }

      const moment = resolveMySoulmateImageMoment(style, variation);
      const momentPrompt = buildMySoulmateMomentPrompt(moment, contentTier);
      const basePrompt = buildLisaSelfiePrompt({
        trigger: profile.trigger,
        mood: style,
        style,
        avatarId,
        scene: momentPrompt,
        userName: resolveUserName(),
      });
      const prompt = contentTier === 'sensual'
        ? `${basePrompt}, adult woman, tasteful non-explicit boudoir glamour, intimate areas fully covered, elegant and consensual presentation, single continuous photograph, no collage, no split screen, no multiple panels`
        : `${basePrompt}, single continuous photograph, no collage, no split screen, no multiple panels`;
      const env = {
        ...baseEnv,
        CODEBUDDY_COMFYUI_SEED: String(baseSeed + eventIndex),
      } as NodeJS.ProcessEnv;
      const result = await generate(prompt, 'portrait', env);
      if (!result.success || !result.outputPath) {
        failed += 1;
        const message = result.error ?? 'generation failed';
        errors.push(`${style}/${variation}: ${message}`);
        options.onProgress?.({ index: eventIndex, total, style, error: message });
        logger.warn(`[lisa-selfie-cache] ${style}/${variation} failed: ${message}`);
        continue;
      }

      try {
        await fs.copyFile(result.outputPath, outputPath);
        await fs.writeFile(
          outputPath.replace(/\.png$/i, '.json'),
          JSON.stringify({
            avatarId,
            contentTier,
            style,
            momentId: moment.id,
            momentTitle: moment.title,
            momentCategory: moment.category,
            variation,
            seed: baseSeed + eventIndex,
            prompt,
            generatedAt: new Date().toISOString(),
            disclosure: 'AI-generated image',
          }, null, 2) + '\n',
          'utf8',
        );
        generated += 1;
        files.push(outputPath);
        options.onProgress?.({ index: eventIndex, total, style, outputPath });
        logger.info(`[lisa-selfie-cache] ${eventIndex + 1}/${total} ${style}/${variation}`);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${style}/${variation}: ${message}`);
        options.onProgress?.({ index: eventIndex, total, style, error: message });
      }
    }
  }

  return { cacheDir, contentTier, generated, skipped, failed, files, errors };
}

function baseEnvValue(env: NodeJS.ProcessEnv | undefined, key: string): string | undefined {
  return (env ?? process.env)[key]?.trim().toLowerCase();
}
