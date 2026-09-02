import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { SkillRegistry } from '../../src/skills/registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registries: SkillRegistry[] = [];
const tempRoots: string[] = [];

const SKILL_CONTENT = `---
name: watcher-survivor
description: Skill loaded after a burst of transient directories
---

# Watcher survivor
`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSkill(registry: SkillRegistry, name: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!registry.get(name) && Date.now() < deadline) {
    await delay(20);
  }
}

function watcherCount(registry: SkillRegistry): number {
  return (registry as unknown as { watchers: Map<string, FSWatcher> }).watchers.size;
}

async function waitForWatcherCount(registry: SkillRegistry, count: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (watcherCount(registry) !== count && Date.now() < deadline) {
    await delay(20);
  }
}

async function waitForSkillRemoval(registry: SkillRegistry, name: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (registry.get(name) && Date.now() < deadline) {
    await delay(20);
  }
}

afterEach(async () => {
  for (const registry of registries.splice(0)) {
    registry.shutdown();
  }
  await delay(20);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

describe('SkillRegistry watcher directory races', () => {
  it('watches the root and each first-level directory with error handlers', async () => {
    const skillsRoot = mkdtempSync(path.join(repoRoot, '.r32-skills-watch-'));
    tempRoots.push(skillsRoot);
    mkdirSync(path.join(skillsRoot, 'existing-skill'));

    const registry = new SkillRegistry({
      workspacePath: skillsRoot,
      managedPath: '',
      bundledPath: '',
      watchEnabled: true,
    });
    registries.push(registry);

    await registry.load();

    const watchers = [
      ...(registry as unknown as { watchers: Map<string, FSWatcher> }).watchers.values(),
    ];
    expect(watchers).toHaveLength(2);
    for (const watcher of watchers) {
      expect(watcher.listenerCount('error')).toBeGreaterThan(0);
    }

    const missingDirectory = Object.assign(new Error('transient directory disappeared'), {
      code: 'ENOENT',
    });
    for (const watcher of watchers) {
      expect(() => watcher.emit('error', missingDirectory)).not.toThrow();
    }
  });

  it('survives transient first-level directories and still loads a later skill', async () => {
    const skillsRoot = mkdtempSync(path.join(repoRoot, '.r32-skills-watch-'));
    tempRoots.push(skillsRoot);

    const registry = new SkillRegistry({
      workspacePath: skillsRoot,
      managedPath: '',
      bundledPath: '',
      watchEnabled: true,
    });
    registries.push(registry);

    const uncaughtExceptions: unknown[] = [];
    const recordUncaughtException = (error: unknown): void => {
      uncaughtExceptions.push(error);
    };
    process.prependListener('uncaughtException', recordUncaughtException);

    try {
      await registry.load();

      for (let index = 0; index < 50; index += 1) {
        const transientDir = path.join(skillsRoot, `transient-${index}`);
        mkdirSync(transientDir);
        rmSync(transientDir, { recursive: true });
      }

      await delay(300);
      expect(uncaughtExceptions).toEqual([]);

      const survivingSkillDir = path.join(skillsRoot, 'watcher-survivor');
      mkdirSync(survivingSkillDir);
      writeFileSync(path.join(survivingSkillDir, 'SKILL.md'), SKILL_CONTENT);

      await waitForSkill(registry, 'watcher-survivor');
      expect(registry.get('watcher-survivor')).toBeDefined();
      await waitForWatcherCount(registry, 2);
      expect(watcherCount(registry)).toBe(2);
      expect(uncaughtExceptions).toEqual([]);

      rmSync(survivingSkillDir, { recursive: true });
      await waitForWatcherCount(registry, 1);
      await waitForSkillRemoval(registry, 'watcher-survivor');
      expect(watcherCount(registry)).toBe(1);
      expect(registry.get('watcher-survivor')).toBeUndefined();
      expect(uncaughtExceptions).toEqual([]);
    } finally {
      registry.shutdown();
      process.off('uncaughtException', recordUncaughtException);
    }
  });
});
