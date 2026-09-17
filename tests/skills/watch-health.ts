import fs from 'node:fs';

import type { SkillRegistry } from '../../src/skills/registry.js';

function describeInotifyLimits(): string {
  if (process.platform !== 'linux') {
    return `platform=${process.platform}`;
  }
  try {
    const maxWatches = fs.readFileSync('/proc/sys/fs/inotify/max_user_watches', 'utf8').trim();
    const maxInstances = fs.readFileSync('/proc/sys/fs/inotify/max_user_instances', 'utf8').trim();
    return (
      `fs.inotify.max_user_watches=${maxWatches} ` +
      `fs.inotify.max_user_instances=${maxInstances}`
    );
  } catch {
    return 'linux inotify limits unreadable';
  }
}

function formatWatchShortage(
  label: string,
  expected: string,
  actual: number,
  registry: SkillRegistry
): string {
  const health = registry.getWatchHealth();
  const limitHint =
    health.degraded || health.reason
      ? `The kernel refused a filesystem observer (${health.reason}). ` +
        'This is an inotify machine limit (too many watches/instances), not a logic assertion.'
      : 'Watchers were not created.';
  return (
    `${label}: expected ${expected} filesystem watcher(s), got ${actual}. ` +
    `${limitHint} ${describeInotifyLimits()}`
  );
}

export function requireSkillWatchers(
  registry: SkillRegistry,
  expected: number,
  label: string
): void {
  const actual = registry.getWatchHealth().watcherCount;
  if (actual === expected) return;
  throw new Error(formatWatchShortage(label, String(expected), actual, registry));
}

export function requireSkillWatchersAtLeast(
  registry: SkillRegistry,
  minimum: number,
  label: string
): void {
  const actual = registry.getWatchHealth().watcherCount;
  if (actual >= minimum) return;
  throw new Error(formatWatchShortage(label, `at least ${minimum}`, actual, registry));
}
