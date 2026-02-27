/**
 * SecretRef — Resolve secret references in config values.
 *
 * Supports three reference types in config string values:
 * - ${env:NAME}       — Environment variable
 * - ${file:/path}     — File contents (trimmed)
 * - ${exec:command}   — Command stdout (trimmed, 5s timeout)
 *
 * References can appear anywhere in a string value and are resolved
 * recursively through nested objects/arrays.
 */

import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

// Matches ${env:NAME}, ${file:/path/to/secret}, ${exec:command args}
const SECRET_REF_PATTERN = /\$\{(env|file|exec):([^}]+)\}/g;

/**
 * Resolve a single secret reference token.
 * Returns the resolved value or empty string on failure.
 */
async function resolveToken(type: string, ref: string): Promise<string> {
  switch (type) {
    case 'env': {
      const value = process.env[ref];
      if (value === undefined) {
        logger.warn(`SecretRef: environment variable "${ref}" is not set`, { source: 'SecretRef' });
        return '';
      }
      return value;
    }

    case 'file': {
      try {
        const content = await fs.readFile(ref, 'utf-8');
        return content.trim();
      } catch {
        logger.warn(`SecretRef: failed to read file "${ref}"`, { source: 'SecretRef' });
        return '';
      }
    }

    case 'exec': {
      try {
        const stdout = execSync(ref, { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return stdout.trim();
      } catch {
        logger.warn(`SecretRef: failed to execute command "${ref}"`, { source: 'SecretRef' });
        return '';
      }
    }

    default:
      logger.warn(`SecretRef: unknown reference type "${type}"`, { source: 'SecretRef' });
      return '';
  }
}

/**
 * Resolve all `${env:...}`, `${file:...}`, and `${exec:...}` patterns
 * in a single string value.
 */
export async function resolveSecretRef(value: string): Promise<string> {
  // Quick check — avoid async work if no refs present
  if (!value.includes('${')) {
    return value;
  }

  // Collect all matches so we can resolve them
  const matches: Array<{ full: string; type: string; ref: string }> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(SECRET_REF_PATTERN.source, 'g');
  while ((match = re.exec(value)) !== null) {
    matches.push({ full: match[0], type: match[1], ref: match[2] });
  }

  if (matches.length === 0) {
    return value;
  }

  // Resolve all tokens (could be parallelized, but order doesn't matter for replacement)
  let result = value;
  for (const m of matches) {
    const resolved = await resolveToken(m.type, m.ref);
    result = result.replace(m.full, resolved);
  }

  return result;
}

/**
 * Deep-walk an object, resolving any string values containing secret
 * references. Non-string primitives (numbers, booleans, null) are
 * returned as-is. Objects and arrays are recursed into.
 *
 * Returns a new object — the input is not mutated.
 */
export async function resolveSecretRefs(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return resolveValue(config) as Promise<Record<string, unknown>>;
}

/**
 * Internal recursive resolver for any value type.
 */
async function resolveValue(value: unknown): Promise<unknown> {
  if (typeof value === 'string') {
    return resolveSecretRef(value);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map(item => resolveValue(item)));
  }

  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = await resolveValue(obj[key]);
    }
    return result;
  }

  // number, boolean, null, undefined — pass through
  return value;
}
