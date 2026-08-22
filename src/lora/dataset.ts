/**
 * LoRA dataset project: init folder layout, validate images + captions.
 */

import fs from 'fs/promises';
import path from 'path';
import type { LoraDatasetValidation, LoraProjectMeta } from './types.js';

export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.PNG', '.JPG', '.JPEG', '.WEBP']);

export function defaultLoraRoot(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'lora');
}

export function projectDir(name: string, root?: string): string {
  const safe = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  return path.join(root ?? defaultLoraRoot(), safe);
}

export async function initLoraProject(options: {
  name: string;
  triggerPhrase: string;
  root?: string;
  character?: string;
}): Promise<{ dir: string; imagesDir: string; metaPath: string }> {
  const dir = projectDir(options.name, options.root);
  const imagesDir = path.join(dir, 'images');
  await fs.mkdir(imagesDir, { recursive: true });
  const meta: LoraProjectMeta = {
    name: options.name.trim() || 'project',
    triggerPhrase: options.triggerPhrase.trim(),
    createdAt: new Date().toISOString(),
    ...(options.character?.trim() ? { character: options.character.trim() } : {}),
    notes:
      'Drop 40–50 PNG/JPG training images into images/. Optional same-stem .txt captions. ' +
      'If captions are missing, triggerPhrase is used (fal/Krea requirement when auto_captioning=Off).',
  };
  const metaPath = path.join(dir, 'project.json');
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  await fs.writeFile(
    path.join(dir, 'README.md'),
    buildDatasetReadme(meta),
    'utf8',
  );
  return { dir, imagesDir, metaPath };
}

export function buildDatasetReadme(meta: LoraProjectMeta): string {
  return `# LoRA project: ${meta.name}

Trigger phrase: \`${meta.triggerPhrase || '(none)'}\`
${meta.character ? `Character: ${meta.character}\n` : ''}
## Dataset (Krea 2 / video-aligned)

1. Put **40–50** images in \`images/\` (PNG/JPG/WebP).
2. Same face/style/lighting variety; avoid heavy text overlays.
3. Optional captions: \`images/001.jpg\` + \`images/001.txt\`.
4. Without captions, training uses the **trigger phrase** (required for fal when auto_captioning is Off).

## Next

\`\`\`bash
# Validate
buddy lora validate ${meta.name}

# Cloud train (needs FAL_KEY + CODEBUDDY_LORA_TRAIN=true)
buddy lora train cloud ${meta.name} --steps 1000

# Local plan (AI-Toolkit / musubi-style config + script)
buddy lora train local ${meta.name}

# After training: install into ComfyUI
buddy lora install path/to/lora.safetensors --name ${meta.name}
\`\`\`
`;
}

export async function loadProjectMeta(dir: string): Promise<LoraProjectMeta | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'project.json'), 'utf8');
    const j = JSON.parse(raw) as LoraProjectMeta;
    if (!j || typeof j.name !== 'string') return null;
    return j;
  } catch {
    return null;
  }
}

export async function resolveProjectDir(nameOrPath: string, root?: string): Promise<string> {
  const abs = path.isAbsolute(nameOrPath)
    ? nameOrPath
    : path.resolve(process.cwd(), nameOrPath);
  try {
    const st = await fs.stat(abs);
    if (st.isDirectory()) return abs;
  } catch {
    /* not a path */
  }
  return projectDir(nameOrPath, root);
}

export async function listImages(imagesDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(imagesDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => IMAGE_EXT.has(path.extname(n)))
    .sort((a, b) => a.localeCompare(b));
}

export async function validateDataset(
  projectDirectory: string,
  options?: { triggerPhrase?: string },
): Promise<LoraDatasetValidation> {
  const imagesDir = path.join(projectDirectory, 'images');
  const errors: string[] = [];
  const warnings: string[] = [];
  const images = await listImages(imagesDir);
  const missingCaptions: string[] = [];
  let captionCount = 0;

  if (images.length === 0) {
    errors.push(`No images in ${imagesDir} (png/jpg/webp).`);
  } else if (images.length < 15) {
    warnings.push(`Only ${images.length} images — Krea character LoRAs work best with ~40–50.`);
  } else if (images.length > 80) {
    warnings.push(`${images.length} images — training will be slower; 40–50 is typical.`);
  }

  const meta = await loadProjectMeta(projectDirectory);
  const trigger = (options?.triggerPhrase ?? meta?.triggerPhrase ?? '').trim();

  for (const img of images) {
    const stem = img.replace(/\.[^.]+$/, '');
    const capPath = path.join(imagesDir, `${stem}.txt`);
    try {
      await fs.access(capPath);
      captionCount += 1;
    } catch {
      missingCaptions.push(img);
    }
  }

  if (missingCaptions.length > 0 && !trigger) {
    errors.push(
      `${missingCaptions.length} image(s) lack .txt captions and no trigger phrase is set ` +
        '(required when auto_captioning=Off on fal/Krea).',
    );
  } else if (missingCaptions.length > 0) {
    warnings.push(
      `${missingCaptions.length} image(s) without captions will use trigger « ${trigger} ».`,
    );
  }

  return {
    ok: errors.length === 0 && images.length > 0,
    imageCount: images.length,
    captionCount,
    missingCaptions,
    images: images.map((n) => path.join(imagesDir, n)),
    errors,
    warnings,
  };
}

/** Write missing captions as the trigger phrase (DreamBooth-style). */
export async function fillMissingCaptions(
  projectDirectory: string,
  triggerPhrase: string,
): Promise<number> {
  const phrase = triggerPhrase.trim();
  if (!phrase) throw new Error('triggerPhrase is required to fill captions');
  const imagesDir = path.join(projectDirectory, 'images');
  const images = await listImages(imagesDir);
  let written = 0;
  for (const img of images) {
    const stem = img.replace(/\.[^.]+$/, '');
    const capPath = path.join(imagesDir, `${stem}.txt`);
    try {
      await fs.access(capPath);
    } catch {
      await fs.writeFile(capPath, phrase + '\n', 'utf8');
      written += 1;
    }
  }
  return written;
}
