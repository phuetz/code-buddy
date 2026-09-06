/**
 * Copy a generated Lisa selfie into the rotating cache and evict overflow.
 * Never writes into the git worktree. Never throws to callers.
 *
 * @module companion/lisa-selfie-ingest
 */

import { createHash } from 'node:crypto';
import fs from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { defaultLoraRoot } from '../lora/dataset.js';
import { AVATAR_STYLE_IDS, type AvatarStyleId } from '../lora/lisa-avatar-bible.js';
import { logger } from '../utils/logger.js';
import { writeJsonAtomic } from '../utils/atomic-write.js';
import {
  inferLisaContentTier,
  inferLisaSelfieStyle,
  resolveLisaContentTier,
  type LisaContentTier,
} from './lisa-selfie.js';

export const DEFAULT_LISA_SELFIE_CACHE_MAX = 200;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function resolveLisaSelfieCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  rootDir = process.cwd(),
): string {
  const configured = env.CODEBUDDY_LISA_SELFIE_CACHE_DIR?.trim();
  if (configured) return configured;
  return path.join(defaultLoraRoot(rootDir), 'lisa', 'selfie-cache');
}

export function resolveLisaSelfieRecentPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_LISA_SELFIE_RECENT_FILE?.trim();
  if (configured) return configured;
  return path.join(homedir(), '.codebuddy', 'companion', 'recent-selfies.json');
}

export function lisaSelfieCacheMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CODEBUDDY_LISA_SELFIE_CACHE_MAX ?? DEFAULT_LISA_SELFIE_CACHE_MAX);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_LISA_SELFIE_CACHE_MAX;
  return Math.min(2000, Math.floor(raw));
}

/** True when a generation prompt is a Lisa identity selfie (LoRA trigger / portrait). */
export function looksLikeLisaSelfiePrompt(
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const t = prompt.toLowerCase();
  if (!t.trim()) return false;
  if (/\bohwx\s+lisa\b/.test(t)) return true;
  if (/\blisa\b/.test(t) && /\b(?:selfie|portrait|photo of (?:you|herself|lisa)|picture of (?:you|lisa))\b/.test(t)) {
    return true;
  }
  const lora = (env.CODEBUDDY_COMFYUI_LORA ?? env.CODEBUDDY_LISA_COMFYUI_LORA ?? '').toLowerCase();
  return lora.includes('lisa') && /\b(?:selfie|portrait|photo)\b/.test(t);
}

export interface IngestLisaSelfieInput {
  sourcePath: string;
  prompt: string;
  contentTier?: LisaContentTier;
  style?: string;
  model?: string;
  provider?: string;
  env?: NodeJS.ProcessEnv;
  rootDir?: string;
  now?: () => Date;
  favorite?: boolean;
}

export interface IngestLisaSelfieResult {
  ingested: boolean;
  destPath?: string;
  skipped?: 'not-lisa' | 'explicit-blocked' | 'missing-source' | 'duplicate' | 'error';
  evicted?: number;
}

export async function maybeIngestGeneratedLisaSelfie(
  input: IngestLisaSelfieInput,
): Promise<IngestLisaSelfieResult> {
  try {
    const env = input.env ?? process.env;
    if (!looksLikeLisaSelfiePrompt(input.prompt, env) && !input.contentTier && !input.style) {
      return { ingested: false, skipped: 'not-lisa' };
    }
    const inferred = inferLisaContentTier(input.prompt);
    const requested = input.contentTier ?? inferred;
    if (requested === 'explicit' && resolveLisaContentTier(env, 'explicit') !== 'explicit') {
      return { ingested: false, skipped: 'explicit-blocked' };
    }
    const tier: LisaContentTier = requested === 'explicit'
      ? 'explicit'
      : requested === 'sensual'
        ? 'sensual'
        : 'safe';
    const style = sanitizeStyle(input.style) ?? inferLisaSelfieStyle(input.prompt) ?? 'portrait';
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(input.sourcePath);
    } catch {
      return { ingested: false, skipped: 'missing-source' };
    }
    if (bytes.length < 8) return { ingested: false, skipped: 'missing-source' };
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const cacheDir = resolveLisaSelfieCacheDir(env, input.rootDir ?? process.cwd());
    const destDir = path.join(cacheDir, tier, style);
    const existing = await findByHash(destDir, hash, path.extname(input.sourcePath) || '.png');
    if (existing) return { ingested: false, destPath: existing, skipped: 'duplicate' };
    await fs.mkdir(destDir, { recursive: true });
    const stamp = (input.now ?? (() => new Date()))()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace(/Z$/, 'Z');
    const ext = IMAGE_EXT.has(path.extname(input.sourcePath).toLowerCase())
      ? path.extname(input.sourcePath).toLowerCase()
      : '.png';
    const destPath = path.join(destDir, `${stamp}-${hash}${ext}`);
    await fs.copyFile(input.sourcePath, destPath);
    await writeJsonAtomic(
      destPath.replace(/\.[^.]+$/, '.json'),
      {
        prompt: input.prompt,
        contentTier: tier,
        style,
        model: input.model ?? null,
        provider: input.provider ?? null,
        generatedAt: new Date().toISOString(),
        hash,
        favorite: input.favorite === true,
        disclosure: 'AI-generated image',
      },
      { mode: 0o600 },
    );
    const evicted = await evictLisaSelfieCacheOverflow(cacheDir, lisaSelfieCacheMax(env));
    logger.info(`[lisa-selfie-cache] ingested tier=${tier} style=${style} hash=${hash}`);
    return { ingested: true, destPath, ...(evicted > 0 ? { evicted } : {}) };
  } catch (err) {
    logger.warn(
      `[lisa-selfie-cache] ingest skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ingested: false, skipped: 'error' };
  }
}

export async function evictLisaSelfieCacheOverflow(
  cacheDir: string,
  maxImages: number,
): Promise<number> {
  const images = await listCacheImages(cacheDir);
  if (images.length <= maxImages) return 0;
  const ranked = images
    .filter((entry) => !entry.favorite)
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
  let evicted = 0;
  let remaining = images.length;
  for (const entry of ranked) {
    if (remaining <= maxImages) break;
    try {
      await fs.unlink(entry.file);
      await fs.unlink(entry.file.replace(/\.[^.]+$/, '.json')).catch(() => undefined);
      evicted += 1;
      remaining -= 1;
    } catch {
      /* best-effort eviction */
    }
  }
  return evicted;
}

export async function countLisaSelfieCacheImages(
  cacheDir: string,
  tier?: LisaContentTier,
  style?: string,
): Promise<number> {
  const images = await listCacheImages(cacheDir);
  return images.filter((entry) => {
    if (tier && entry.tier !== tier) return false;
    if (style && entry.style !== style) return false;
    return true;
  }).length;
}

interface CacheImage {
  file: string;
  mtimeMs: number;
  favorite: boolean;
  tier: string;
  style: string;
}

async function listCacheImages(cacheDir: string): Promise<CacheImage[]> {
  const out: CacheImage[] = [];
  await walk(cacheDir, cacheDir, out);
  return out;
}

async function walk(root: string, directory: string, out: CacheImage[]): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, out);
      continue;
    }
    if (!entry.isFile() || !IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const stat = await fs.stat(full);
      const rel = path.relative(root, full).split(path.sep);
      const tier = rel[0] ?? 'safe';
      const style = rel.length > 2 ? rel[1]! : (rel[0] === tier ? 'portrait' : rel[0]!);
      let favorite = false;
      try {
        const sidecar = JSON.parse(
          await fs.readFile(full.replace(/\.[^.]+$/, '.json'), 'utf8'),
        ) as { favorite?: unknown };
        favorite = sidecar.favorite === true;
      } catch {
        favorite = false;
      }
      out.push({ file: full, mtimeMs: stat.mtimeMs, favorite, tier, style });
    } catch {
      /* disappeared */
    }
  }
}

async function findByHash(directory: string, hash: string, ext: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch {
    return undefined;
  }
  const suffix = `-${hash}${ext.toLowerCase()}`;
  const hit = entries.find((name) => name.toLowerCase().endsWith(suffix));
  return hit ? path.join(directory, hit) : undefined;
}

function sanitizeStyle(style: string | undefined): AvatarStyleId | undefined {
  const raw = style?.trim().toLowerCase();
  if (!raw) return undefined;
  return AVATAR_STYLE_IDS.find((id) => id === raw);
}
