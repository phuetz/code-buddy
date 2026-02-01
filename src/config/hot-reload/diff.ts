/**
 * Config Diff Module
 *
 * Compares configuration snapshots to detect changes and
 * determine which subsystems need to be reloaded.
 */

import { createHash } from 'crypto';
import type { ConfigChange, ConfigSnapshot, SubsystemId } from './types.js';

/**
 * Mapping of config paths to subsystems
 */
const PATH_TO_SUBSYSTEM: Record<string, SubsystemId> = {
  'model': 'model',
  'defaultModel': 'model',
  'provider': 'model',
  'tools': 'tools',
  'toolPolicy': 'policies',
  'policies': 'policies',
  'securityMode': 'security',
  'security': 'security',
  'plugins': 'plugins',
  'mcp': 'mcp',
  'mcpServers': 'mcp',
  'skills': 'skills',
  'memory': 'memory',
  'memoryConfig': 'memory',
};

/**
 * Create a hash of config data for quick comparison
 */
export function hashConfig(data: Record<string, unknown>): string {
  const json = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(json).digest('hex').substring(0, 16);
}

/**
 * Create a config snapshot from data
 */
export function createSnapshot(data: Record<string, unknown>): ConfigSnapshot {
  return {
    timestamp: Date.now(),
    hash: hashConfig(data),
    data: structuredClone(data),
  };
}

/**
 * Check if two snapshots are equal (quick hash comparison)
 */
export function snapshotsEqual(a: ConfigSnapshot, b: ConfigSnapshot): boolean {
  return a.hash === b.hash;
}

/**
 * Deep compare two values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

/**
 * Get the subsystem for a config path
 */
export function getSubsystemForPath(path: string): SubsystemId | null {
  // Check exact match first
  if (path in PATH_TO_SUBSYSTEM) {
    return PATH_TO_SUBSYSTEM[path];
  }

  // Check prefix match
  const rootKey = path.split('.')[0];
  if (rootKey in PATH_TO_SUBSYSTEM) {
    return PATH_TO_SUBSYSTEM[rootKey];
  }

  return null;
}

/**
 * Find all changes between two config snapshots
 */
export function diffConfigs(
  oldSnapshot: ConfigSnapshot,
  newSnapshot: ConfigSnapshot
): ConfigChange[] {
  const changes: ConfigChange[] = [];
  const timestamp = Date.now();

  // Quick check - if hashes match, no changes
  if (oldSnapshot.hash === newSnapshot.hash) {
    return changes;
  }

  const oldData = oldSnapshot.data;
  const newData = newSnapshot.data;

  // Find changed and added keys
  for (const key of Object.keys(newData)) {
    if (!(key in oldData)) {
      // New key added
      const subsystem = getSubsystemForPath(key);
      if (subsystem) {
        changes.push({
          subsystem,
          path: key,
          oldValue: undefined,
          newValue: newData[key],
          timestamp,
        });
      }
    } else if (!deepEqual(oldData[key], newData[key])) {
      // Key changed
      const subsystem = getSubsystemForPath(key);
      if (subsystem) {
        changes.push({
          subsystem,
          path: key,
          oldValue: oldData[key],
          newValue: newData[key],
          timestamp,
        });
      }
    }
  }

  // Find removed keys
  for (const key of Object.keys(oldData)) {
    if (!(key in newData)) {
      const subsystem = getSubsystemForPath(key);
      if (subsystem) {
        changes.push({
          subsystem,
          path: key,
          oldValue: oldData[key],
          newValue: undefined,
          timestamp,
        });
      }
    }
  }

  return changes;
}

/**
 * Group changes by subsystem
 */
export function groupChangesBySubsystem(
  changes: ConfigChange[]
): Map<SubsystemId, ConfigChange[]> {
  const groups = new Map<SubsystemId, ConfigChange[]>();

  for (const change of changes) {
    const existing = groups.get(change.subsystem) || [];
    existing.push(change);
    groups.set(change.subsystem, existing);
  }

  return groups;
}

/**
 * Get affected subsystems from changes
 */
export function getAffectedSubsystems(changes: ConfigChange[]): SubsystemId[] {
  const subsystems = new Set<SubsystemId>();
  for (const change of changes) {
    subsystems.add(change.subsystem);
  }
  return Array.from(subsystems);
}

/**
 * Merge multiple changes to the same path
 */
export function mergeChanges(changes: ConfigChange[]): ConfigChange[] {
  const pathMap = new Map<string, ConfigChange>();

  for (const change of changes) {
    const existing = pathMap.get(change.path);
    if (existing) {
      // Keep first old value, update new value
      existing.newValue = change.newValue;
      existing.timestamp = change.timestamp;
    } else {
      pathMap.set(change.path, { ...change });
    }
  }

  return Array.from(pathMap.values());
}

/**
 * Create a patch object from changes
 */
export function createPatch(changes: ConfigChange[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const change of changes) {
    patch[change.path] = change.newValue;
  }

  return patch;
}

/**
 * Create a rollback patch from changes (reverses the changes)
 */
export function createRollbackPatch(changes: ConfigChange[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const change of changes) {
    patch[change.path] = change.oldValue;
  }

  return patch;
}
