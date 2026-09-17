/**
 * Project names used for compose project identity and overlay labels.
 * Lowercase npm-style slugs only — no path separators, no env injection.
 */

import { ProvisionError } from './types.js';

const PROJECT_NAME_RE = /^[a-z][a-z0-9-]{0,62}$/;

const RESERVED = new Set([
  'node_modules',
  'package',
  'package-lock',
  'supabase',
  'postgres',
  'root',
  'usr',
  'etc',
]);

export function assertProjectName(name: string): string {
  const trimmed = name.trim();
  if (!PROJECT_NAME_RE.test(trimmed) || RESERVED.has(trimmed) || trimmed.includes('--')) {
    throw new ProvisionError(
      'INVALID_NAME',
      `Invalid project name "${name}". Use a lowercase slug: start with a letter, then letters, digits or hyphens (max 63).`,
    );
  }
  return trimmed;
}

export function projectNameFromDir(dir: string, pathBasename: (p: string) => string): string {
  return pathBasename(dir);
}
