import { mkdirSync, readFileSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeJsonAtomicSync } from './atomic-write.js';

/** Shared envelope: legacy SSH/ADB nodes and Android authentication coexist. */
export function readDeviceStoreFile(file: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid device store');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // Never recover a stale backup: that could resurrect a revoked key.
    throw new Error('Device store unavailable');
  }
}

/** Cross-process exclusion for the local CLI and server. Busy/crashed locks fail closed. */
export function updateDeviceStoreFile<T>(
  file: string,
  update: (data: Record<string, unknown>) => T,
): T {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error('Device store unavailable');
  }
  try {
    const data = readDeviceStoreFile(file);
    const result = update(data);
    writeJsonAtomicSync(file, data, { mode: 0o600 });
    return result;
  } finally {
    rmdirSync(lock);
  }
}
