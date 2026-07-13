/**
 * SecretRef — Resolve secret references in config values.
 *
 * Built-in reference types in config string values:
 * - ${env:NAME}       — Environment variable
 * - ${file:/path}     — File contents (trimmed)
 * - ${exec:command}   — Command stdout (trimmed, 5s timeout)
 * - ${op:vault/item/field} — 1Password via the `op` CLI
 * - a WHOLE value of the form `op://vault/item/field` is also resolved
 *   through 1Password (Hermes-parity: their native secret notation).
 *
 * The type set is PLUGGABLE (Hermes SecretSource parity): call
 * `registerSecretSource({ id, resolve })` to add a source; `${<id>:ref}`
 * then resolves through it. Built-ins are pre-registered and can be
 * overridden for tests.
 *
 * References can appear anywhere in a string value and are resolved
 * recursively through nested objects/arrays.
 */

import * as fs from 'fs/promises';
import { execSync, execFileSync } from 'child_process';
import { logger } from '../utils/logger.js';

// Matches ${<source-id>:<ref>} for any registered source id.
const SECRET_REF_PATTERN = /\$\{([a-z][\w-]*):([^}]+)\}/g;

/** A pluggable secret source (Hermes SecretSource parity). */
export interface SecretSource {
  /** Reference type, used as `${<id>:...}` in config values. */
  id: string;
  /** Resolve a reference; return null/'' on failure (never throw). */
  resolve(ref: string): Promise<string | null>;
}

const sources = new Map<string, SecretSource>();

/** Register (or override) a secret source. */
export function registerSecretSource(source: SecretSource): void {
  sources.set(source.id, source);
}

/** Registered source ids (for diagnostics). */
export function getSecretSourceIds(): string[] {
  return [...sources.keys()];
}

/** Resolve a 1Password `op://` reference through the official CLI. */
async function resolveOnePassword(ref: string): Promise<string | null> {
  const uri = ref.startsWith('op://') ? ref : `op://${ref}`;
  try {
    // execFile (no shell) — the ref can never be interpreted as shell syntax.
    const stdout = execFileSync('op', ['read', uri], {
      timeout: 10_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return stdout.trim();
  } catch (error) {
    const notFound = (error as NodeJS.ErrnoException).code === 'ENOENT';
    logger.warn(
      notFound
        ? `SecretRef: "${uri}" requires the 1Password CLI (op) — install it and run \`op signin\``
        : `SecretRef: 1Password read failed for "${uri}"`,
      { source: 'SecretRef' },
    );
    return null;
  }
}

// Built-in sources.
registerSecretSource({
  id: 'env',
  async resolve(ref) {
    const value = process.env[ref];
    if (value === undefined) {
      logger.warn(`SecretRef: environment variable "${ref}" is not set`, { source: 'SecretRef' });
      return null;
    }
    return value;
  },
});

registerSecretSource({
  id: 'file',
  async resolve(ref) {
    try {
      const content = await fs.readFile(ref, 'utf-8');
      return content.trim();
    } catch {
      logger.warn(`SecretRef: failed to read file "${ref}"`, { source: 'SecretRef' });
      return null;
    }
  },
});

registerSecretSource({
  id: 'exec',
  async resolve(ref) {
    try {
      const stdout = execSync(ref, { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return stdout.trim();
    } catch {
      logger.warn(`SecretRef: failed to execute command "${ref}"`, { source: 'SecretRef' });
      return null;
    }
  },
});

registerSecretSource({ id: 'op', resolve: resolveOnePassword });

/**
 * Resolve a single secret reference token via the registered sources.
 * Returns the resolved value, null for an unknown source, or an empty string
 * when a known source fails. Keeping those cases distinct prevents a typo in a
 * source id from silently erasing configuration text.
 */
async function resolveToken(type: string, ref: string): Promise<string | null> {
  const source = sources.get(type);
  if (!source) {
    logger.warn(`SecretRef: unknown reference type "${type}"`, { source: 'SecretRef' });
    return null;
  }
  try {
    return (await source.resolve(ref)) ?? '';
  } catch {
    logger.warn(`SecretRef: source "${type}" threw while resolving`, { source: 'SecretRef' });
    return '';
  }
}

/**
 * Resolve all `${<source>:...}` patterns in a single string value, plus the
 * whole-value `op://…` 1Password notation.
 */
export async function resolveSecretRef(value: string): Promise<string> {
  // Whole-value 1Password notation (`op://vault/item/field`).
  if (value.startsWith('op://')) {
    return (await resolveOnePassword(value)) ?? '';
  }

  // Quick check — avoid async work if no refs present
  if (!value.includes('${')) {
    return value;
  }

  // Collect all matches so we can resolve them
  const matches: Array<{ full: string; type: string; ref: string }> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(SECRET_REF_PATTERN.source, 'g');
  while ((match = re.exec(value)) !== null) {
    const [full, type, ref] = match;
    // Both capture groups are required by SECRET_REF_PATTERN, so a successful
    // match always yields them; guard to satisfy noUncheckedIndexedAccess
    // without altering behavior (an incomplete match is simply skipped).
    if (full === undefined || type === undefined || ref === undefined) {
      continue;
    }
    matches.push({ full, type, ref });
  }

  if (matches.length === 0) {
    return value;
  }

  // Resolve all tokens (could be parallelized, but order doesn't matter for replacement)
  let result = value;
  for (const m of matches) {
    const resolved = await resolveToken(m.type, m.ref);
    if (resolved !== null) result = result.replace(m.full, resolved);
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
