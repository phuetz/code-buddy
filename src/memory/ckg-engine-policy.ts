/**
 * Policy for choosing the CKG backend: in-process TypeScript vs Rust sidecar.
 *
 * Default (env unset or `auto`): rust ONLY when the buddy-memory binary exists on disk
 * and the snapshot is loadable (missing snapshot is vacuously loadable; a corrupt or
 * unknown-version snapshot keeps TS). Explicit `rust` still tries and falls back on
 * error. Explicit `ts`/`off`/`false` forces the in-process path.
 *
 * @module memory/ckg-engine-policy
 */

import { existsSync, readFileSync } from 'node:fs';

export type CkgEnginePreference = 'rust' | 'ts';

export function snapshotPathFor(ledgerPath: string): string {
  return `${ledgerPath}.snap`;
}

/** True when the snapshot is missing (rust will create one) or parses as v1/v2. */
export function isCkgSnapshotLoadable(snapshotPath: string): boolean {
  if (!existsSync(snapshotPath)) return true;
  try {
    const snap = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      version?: unknown;
      offset?: unknown;
    };
    return (snap.version === 1 || snap.version === 2) && typeof snap.offset === 'number';
  } catch {
    return false;
  }
}

export function chooseCkgEngine(input: {
  env?: string | undefined;
  binaryPath: string | null;
  snapshotLoadable: boolean;
}): CkgEnginePreference {
  const raw = (input.env ?? '').trim().toLowerCase();
  if (raw === 'ts' || raw === 'typescript' || raw === 'off' || raw === 'false') return 'ts';
  if (raw === 'rust') return 'rust';
  if (!input.binaryPath) return 'ts';
  if (!input.snapshotLoadable) return 'ts';
  return 'rust';
}
