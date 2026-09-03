/**
 * Cache management for repo profiles.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';
import type { RepoProfile } from './types.js';

const CACHE_FILENAME = '.codebuddy/repoProfile.json';

export function getCachePath(cwd: string): string {
  return path.join(cwd, CACHE_FILENAME);
}

export function loadCache(cachePath: string): RepoProfile | null {
  try {
    return readJsonAtomicSync<RepoProfile | null>(cachePath, null, {
      mode: 0o600,
      isValid: (value): value is RepoProfile => Boolean(
        value && typeof value === 'object' && !Array.isArray(value),
      ),
    });
  } catch {
    return null;
  }
}

export function isCacheStale(cached: RepoProfile, cwd: string): boolean {
  if (!cached._configMtime) return true;
  const pkgJsonPath = path.join(cwd, 'package.json');
  for (const candidate of [pkgJsonPath, 'pyproject.toml', 'Cargo.toml', 'go.mod'].map(
    (f) => (path.isAbsolute(f) ? f : path.join(cwd, f))
  )) {
    if (fs.existsSync(candidate)) {
      try {
        const currentMtime = fs.statSync(candidate).mtimeMs;
        if (currentMtime !== cached._configMtime) return true;
      } catch {
        return true;
      }
      break;
    }
  }
  return false;
}

export function saveCache(cachePath: string, profile: RepoProfile): void {
  try {
    writeJsonAtomicSync(cachePath, profile, { mode: 0o600 });
  } catch (err) {
    logger.debug('RepoProfiler: failed to save cache', { err });
  }
}
