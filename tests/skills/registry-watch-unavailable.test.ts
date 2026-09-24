import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { PathLike, WatchOptions, WatchListener } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillRegistry } from '../../src/skills/registry.js';
import { logger } from '../../src/utils/logger.js';
import { tmpdir as osTmpdirForTests } from 'node:os';
import { realpathSync as fsRealpathForTmp } from 'node:fs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registries: SkillRegistry[] = [];
const tempRoots: string[] = [];

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function refuseWatch(code: 'ENOSPC' | 'EMFILE') {
  return ((directory: PathLike, _options?: WatchOptions | WatchListener, _listener?: WatchListener) => {
    throw Object.assign(
      new Error(`${code}: System limit for number of file watchers reached, watch '${String(directory)}'`),
      { code }
    );
  }) as typeof import('fs').watch;
}

function writeSkill(root: string, name: string): void {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: On-demand fallback skill\n---\n\n# ${name}\n`
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const registry of registries.splice(0)) {
    registry.shutdown();
  }
  await delay(20);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

describe('SkillRegistry when the kernel refuses observers', () => {
  it.each(['ENOSPC', 'EMFILE'] as const)(
    'does not crash on %s, warns once, and rereads skills on demand',
    async code => {
      const skillsRoot = fsRealpathForTmp(mkdtempSync(path.join(osTmpdirForTests(), 'r32-skills-nowatch-')));
      tempRoots.push(skillsRoot);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const registry = new SkillRegistry({
        workspacePath: skillsRoot,
        managedPath: '',
        bundledPath: '',
        watchEnabled: true,
        watchFn: refuseWatch(code),
      });
      registries.push(registry);

      await expect(registry.load()).resolves.toBeUndefined();

      const health = registry.getWatchHealth();
      expect(health.watcherCount).toBe(0);
      expect(health.degraded).toBe(true);
      expect(health.reason).toMatch(new RegExp(`${code}:`));
      if (process.platform === 'linux') {
        expect(health.reason).toMatch(/inotify/);
        expect(health.reason).toMatch(/max_user_watches/);
      }

      const watchWarnings = warnSpy.mock.calls.filter(call =>
        String(call[0]).includes('falling back to on-demand rescan')
      );
      expect(watchWarnings.length).toBe(1);
      expect(watchWarnings[0]?.[1]).toMatchObject({ code, directory: skillsRoot });

      writeSkill(skillsRoot, 'fallback-skill');
      expect(registry.get('fallback-skill')).toBeDefined();
      expect(registry.list().map(skill => skill.metadata.name)).toContain('fallback-skill');

      rmSync(path.join(skillsRoot, 'fallback-skill'), { recursive: true, force: true });
      await delay(220);
      expect(registry.get('fallback-skill')).toBeUndefined();
      expect(registry.getWatchHealth().watcherCount).toBe(0);
    }
  );

  it('loads a skill that already existed when the child observer is refused', async () => {
    const skillsRoot = fsRealpathForTmp(mkdtempSync(path.join(osTmpdirForTests(), 'r32-skills-nowatch-')));
    tempRoots.push(skillsRoot);
    writeSkill(skillsRoot, 'preexisting-skill');
    vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const registry = new SkillRegistry({
      workspacePath: skillsRoot,
      managedPath: '',
      bundledPath: '',
      watchEnabled: true,
      watchFn: refuseWatch('ENOSPC'),
    });
    registries.push(registry);

    await registry.load();
    expect(registry.get('preexisting-skill')).toBeDefined();
    expect(registry.getWatchHealth().degraded).toBe(true);
  });
});
