/**
 * Generate a synthetic LoRA training set for a character (e.g. Lisa) via image_generate.
 * Uses a fixed identity block + varied poses/lighting so captions can share one trigger phrase.
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  fillMissingCaptions,
  initLoraProject,
  listImages,
  loadProjectMeta,
  projectDir,
  resolveProjectDir,
  validateDataset,
} from './dataset.js';
import {
  getAvatarProfile,
  LISA_AVATAR_IDENTITY,
  type AvatarId,
} from './lisa-avatar-bible.js';

/**
 * Stable visual identity for Lisa — default = dark brunette muse from
 * https://www.youtube.com/watch?v=GQusMZgc1RE (multi-style training curriculum).
 */
export const LISA_IDENTITY_BLOCK = LISA_AVATAR_IDENTITY;

export type TrainingView =
  | 'front'
  | 'three-quarter'
  | 'profile'
  | 'looking-away'
  | 'smile'
  | 'soft-smile'
  | 'close-up'
  | 'upper-body';

export interface TrainingPromptSpec {
  id: string;
  view: TrainingView;
  prompt: string;
}

const VIEWS: Array<{ view: TrainingView; fragment: string }> = [
  { view: 'front', fragment: 'facing camera, eye contact, centered face' },
  { view: 'three-quarter', fragment: 'three-quarter view, slight turn to the side' },
  { view: 'profile', fragment: 'soft profile view, elegant silhouette' },
  { view: 'looking-away', fragment: 'looking slightly off-camera, thoughtful' },
  { view: 'smile', fragment: 'gentle genuine smile, warm eyes' },
  { view: 'soft-smile', fragment: 'soft closed-mouth smile, serene' },
  { view: 'close-up', fragment: 'tight headshot close-up, face fills frame' },
  { view: 'upper-body', fragment: 'upper body portrait, shoulders visible' },
];

/**
 * Deterministic curriculum of training prompts (no randomness) for reproducible sets.
 * Rotates view + style-pack inspiration + scene/outfit/light so the LoRA learns the
 * face, not one outfit (Krea 2 multi-panel avatar pattern).
 */
export function buildLisaTrainingPrompts(
  count: number,
  identity = LISA_IDENTITY_BLOCK,
  avatarId: AvatarId | string = 'lisa',
): TrainingPromptSpec[] {
  const profile = getAvatarProfile(avatarId);
  const identityBlock = identity === LISA_IDENTITY_BLOCK ? profile.identity : identity;
  const lightings = profile.lightings;
  const scenes = profile.scenes;
  const outfits = profile.outfits;
  const n = Math.max(1, Math.min(80, Math.floor(count)));
  const specs: TrainingPromptSpec[] = [];
  for (let i = 0; i < n; i++) {
    const view = VIEWS[i % VIEWS.length]!;
    const light = lightings[i % lightings.length]!;
    const scene = scenes[Math.floor(i / VIEWS.length) % scenes.length]!;
    const outfit = outfits[Math.floor(i / 3) % outfits.length]!;
    // Short curriculum only — avoid stacking full style paragraphs (turbo multi-face).
    const id = `lisa_${String(i + 1).padStart(3, '0')}`;
    const prompt = [
      identityBlock,
      view.fragment,
      outfit,
      light,
      scene,
      'solo portrait of one person, centered single face',
      'sharp eyes, natural skin, no text, no watermark',
    ]
      .filter(Boolean)
      .join(', ');
    specs.push({ id, view: view.view, prompt });
  }
  return specs;
}

export interface GenerateTrainingSetOptions {
  name: string;
  count?: number;
  triggerPhrase?: string;
  /** Avatar profile id (lisa = brunette muse, lisa-classic = soft chestnut). */
  avatarId?: string;
  rootDir?: string;
  loraRoot?: string;
  aspectRatio?: 'portrait' | 'square';
  /** Skip images that already exist on disk. */
  resume?: boolean;
  env?: NodeJS.ProcessEnv;
  generate?: (
    prompt: string,
    aspect: string,
  ) => Promise<{ success: boolean; outputPath?: string | null; error?: string }>;
  onProgress?: (info: { index: number; total: number; id: string; ok: boolean; error?: string }) => void;
}

export interface GenerateTrainingSetResult {
  projectDir: string;
  imagesDir: string;
  generated: number;
  skipped: number;
  failed: number;
  imagePaths: string[];
  errors: string[];
}

export async function generateLisaTrainingSet(
  options: GenerateTrainingSetOptions,
): Promise<GenerateTrainingSetResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const loraRoot = options.loraRoot ?? path.join(rootDir, '.codebuddy', 'lora');
  const trigger = options.triggerPhrase?.trim() || 'ohwx lisa';
  const count = options.count ?? 40;

  // Ensure project exists
  let dir = projectDir(options.name, loraRoot);
  try {
    await fs.access(path.join(dir, 'project.json'));
  } catch {
    const created = await initLoraProject({
      name: options.name,
      triggerPhrase: trigger,
      root: loraRoot,
      character: options.name === 'lisa' ? 'lisa' : options.name,
    });
    dir = created.dir;
  }

  // Refresh trigger if needed
  const meta = await loadProjectMeta(dir);
  if (meta && !meta.triggerPhrase?.trim()) {
    await fs.writeFile(
      path.join(dir, 'project.json'),
      JSON.stringify({ ...meta, triggerPhrase: trigger }, null, 2) + '\n',
      'utf8',
    );
  }

  const imagesDir = path.join(dir, 'images');
  await fs.mkdir(imagesDir, { recursive: true });

  const avatarId = options.avatarId ?? (options.name === 'lisa-classic' ? 'lisa-classic' : 'lisa');
  const profile = getAvatarProfile(avatarId);
  const specs = buildLisaTrainingPrompts(count, profile.identity, avatarId);
  const env = { ...(options.env ?? process.env) } as NodeJS.ProcessEnv;
  if (!env.CODEBUDDY_IMAGE_PROVIDER?.trim() && (env.COMFYUI_URL?.trim() || true)) {
    // Prefer local Comfy when available; generateImage also infers from COMFYUI_URL.
    env.CODEBUDDY_IMAGE_PROVIDER = env.CODEBUDDY_IMAGE_PROVIDER || 'comfyui';
    env.COMFYUI_URL = env.COMFYUI_URL || 'http://127.0.0.1:8188';
    env.CODEBUDDY_IMAGE_MODEL =
      env.CODEBUDDY_IMAGE_MODEL || env.COMFYUI_CHECKPOINT || 'sd_turbo.safetensors';
  }
  // Training set must NOT load the unfinished LoRA (would pollute the base identity).
  env.CODEBUDDY_COMFYUI_LORA = 'none';

  const generate =
    options.generate ??
    (async (prompt: string, aspect: string) => {
      const { generateImage } = await import('../tools/media-generation-tool.js');
      try {
        const r = await generateImage({ prompt, aspectRatio: aspect }, { rootDir, env });
        return {
          success: r.success,
          outputPath: r.outputPath ?? r.image,
          ...(r.error ? { error: r.error } : {}),
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

  const aspect = options.aspectRatio ?? 'portrait';
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const imagePaths: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const dest = path.join(imagesDir, `${spec.id}.png`);
    if (options.resume !== false) {
      try {
        await fs.access(dest);
        skipped += 1;
        imagePaths.push(dest);
        options.onProgress?.({ index: i, total: specs.length, id: spec.id, ok: true });
        continue;
      } catch {
        /* generate */
      }
    }

    const result = await generate(spec.prompt, aspect);
    if (!result.success || !result.outputPath) {
      failed += 1;
      const err = result.error ?? 'generation failed';
      errors.push(`${spec.id}: ${err}`);
      options.onProgress?.({ index: i, total: specs.length, id: spec.id, ok: false, error: err });
      logger.warn(`[lora-dataset] ${spec.id} failed: ${err}`);
      continue;
    }

    try {
      await fs.copyFile(result.outputPath, dest);
      // Preserve pose, outfit, light, and scene so training learns the identity
      // behind the trigger instead of baking every visual attribute into it.
      await fs.writeFile(path.join(imagesDir, `${spec.id}.txt`), `${spec.prompt}\n`, 'utf8');
      // sidecar for audit
      await fs.writeFile(
        path.join(imagesDir, `${spec.id}.json`),
        JSON.stringify(
          {
            id: spec.id,
            view: spec.view,
            prompt: spec.prompt,
            trigger,
            source: result.outputPath,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      generated += 1;
      imagePaths.push(dest);
      options.onProgress?.({ index: i, total: specs.length, id: spec.id, ok: true });
      logger.info(`[lora-dataset] ${i + 1}/${specs.length} ${spec.id} ok`);
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${spec.id}: ${msg}`);
      options.onProgress?.({ index: i, total: specs.length, id: spec.id, ok: false, error: msg });
    }
  }

  // Ensure any orphans have captions
  await fillMissingCaptions(dir, trigger);

  return {
    projectDir: dir,
    imagesDir,
    generated,
    skipped,
    failed,
    imagePaths,
    errors,
  };
}

export async function ensureProjectAndCount(nameOrPath: string): Promise<{
  dir: string;
  imageCount: number;
}> {
  const dir = await resolveProjectDir(nameOrPath);
  const images = await listImages(path.join(dir, 'images'));
  return { dir, imageCount: images.length };
}
