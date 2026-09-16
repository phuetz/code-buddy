import fs from 'fs';
import { spawnSync } from 'child_process';
import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerSkillsCommands } from '../../src/commands/skills-cli/index.js';
import { getSkillsHub, resetSkillsHub } from '../../src/skills/hub.js';
import {
  awaitSkillRegistryWatchersClosed,
  getSkillRegistry,
  resetSkillRegistry,
} from '../../src/skills/registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  resetSkillRegistry();
  resetSkillsHub();
  // Windows only releases a watched directory once libuv closed its handle.
  // A synchronous rmSync blocks the loop, so its own retries can never win
  // that race: wait for the handles, then remove asynchronously.
  await awaitSkillRegistryWatchersClosed();
  for (const dir of tempDirs.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('skills import CLI lifecycle', () => {
  it('returns after applying an import instead of leaving registry watchers alive', () => {
    const testRoot = fs.mkdtempSync(path.join(repoRoot, '.r16-import-cli-'));
    tempDirs.push(testRoot);
    const home = path.join(testRoot, 'home');
    const source = path.join(testRoot, 'source');
    const skillDir = path.join(source, 'local-helper');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: local-helper',
      'description: Local helper for lifecycle tests.',
      'version: 1.0.0',
      '---',
      '',
      '# Local helper',
      '',
      'Read-only test content.',
      '',
    ].join('\n'), 'utf-8');

    const startedAt = performance.now();
    const result = spawnSync(process.execPath, [
      tsxCli,
      path.join(repoRoot, 'src', 'index.ts'),
      'skills',
      'import',
      '--dir',
      source,
      '--apply',
      '--json',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        HOME: home,
        NO_COLOR: '1',
        USERPROFILE: home,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 4500,
      windowsHide: true,
    });
    const durationMs = performance.now() - startedAt;

    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(durationMs).toBeLessThan(5000);
    expect(JSON.parse(result.stdout) as { report: { imported: Array<{ name: string }> } }).toMatchObject({
      report: { imported: [{ name: 'imported-local-helper' }] },
    });
  });

  it('has no filesystem watchers in active resources when the command returns', async () => {
    const testRoot = fs.mkdtempSync(path.join(repoRoot, '.r16-import-probe-'));
    tempDirs.push(testRoot);
    const home = path.join(testRoot, 'home');
    const source = path.join(testRoot, 'source');
    const skillDir = path.join(source, 'probe-helper');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: probe-helper',
      'description: Probe helper for lifecycle tests.',
      'version: 1.0.0',
      '---',
      '',
      '# Probe helper',
      '',
    ].join('\n'), 'utf-8');

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    resetSkillRegistry();
    try {
      const program = new Command();
      program.exitOverride();
      registerSkillsCommands(program);
      await program.parseAsync(['node', 'buddy', 'skills', 'import', '--dir', source, '--apply', '--json']);

      // Node reports native fs.watch handles as FSEventWrap. Await their close
      // callbacks rather than assuming that one event-loop turn is sufficient.
      await vi.waitFor(() => {
        const resources = process.getActiveResourcesInfo();
        expect(resources).not.toContain('FSWatcher');
        expect(resources).not.toContain('FSEventWrap');
      });
      expect(logSpy.mock.calls.join('\n')).toContain('imported-probe-helper');
    } finally {
      logSpy.mockRestore();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
    }
  });

  it('registers an imported skill for list and delete round-trips', async () => {
    const testRoot = fs.mkdtempSync(path.join(repoRoot, '.r16-import-roundtrip-'));
    tempDirs.push(testRoot);
    const home = path.join(testRoot, 'home');
    const source = path.join(testRoot, 'source');
    const skillDir = path.join(source, 'roundtrip-helper');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: roundtrip-helper',
      'description: Round-trip helper for lifecycle tests.',
      'version: 1.0.0',
      '---',
      '',
      '# Round-trip helper',
      '',
    ].join('\n'), 'utf-8');

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    resetSkillsHub();
    getSkillsHub({
      cacheDir: path.join(home, '.codebuddy', 'hub', 'cache'),
      lockfilePath: path.join(home, '.codebuddy', 'hub', 'lock.json'),
      skillsDir: path.join(home, '.codebuddy', 'skills', 'managed'),
    });
    try {
      const program = new Command();
      program.exitOverride();
      registerSkillsCommands(program);

      await program.parseAsync(['node', 'buddy', 'skills', 'import', '--dir', source, '--apply', '--json']);
      const registry = getSkillRegistry();
      const stop = vi.spyOn(registry, 'stopWatching');
      const realRm = fs.promises.rm;
      const remove = vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, options) => {
        expect(stop).toHaveBeenCalled();
        expect(options).toMatchObject({ recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        await realRm(target, options);
      });
      logSpy.mockClear();
      await program.parseAsync(['node', 'buddy', 'skills', 'list', '--json']);
      const listed = JSON.parse(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')) as {
        skills: Array<{ name: string }>;
      };
      expect(listed.skills.map((skill) => skill.name)).toContain('imported-roundtrip-helper');

      logSpy.mockClear();
      await program.parseAsync([
        'node',
        'buddy',
        'skills',
        'delete',
        'imported-roundtrip-helper',
        '--approved-by',
        'R16',
        '--json',
      ]);
      const deleted = JSON.parse(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')) as {
        removed: boolean;
      };
      expect(deleted.removed).toBe(true);
      expect(remove).toHaveBeenCalled();
      remove.mockRestore();
      stop.mockRestore();
      expect(fs.existsSync(path.join(home, '.codebuddy', 'skills', 'imported-roundtrip-helper'))).toBe(false);
      expect(getSkillsHub().list().some((skill) => skill.name === 'imported-roundtrip-helper')).toBe(false);
    } finally {
      logSpy.mockRestore();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
    }
  });

  it.each([false, true])('closes real watcher handles before removal and restores them (failure=%s)', async (fail) => {
    const testRoot = fs.mkdtempSync(path.join(repoRoot, '.r16-uninstall-watch-'));
    tempDirs.push(testRoot);
    const skillDir = path.join(testRoot, 'skills', 'watched-helper');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillFile, '---\nname: watched-helper\ndescription: Local watcher probe.\n---\n# Helper\n');
    resetSkillsHub();
    const hub = getSkillsHub({ cacheDir: path.join(testRoot, 'cache'), lockfilePath: path.join(testRoot, 'lock.json'), skillsDir: path.dirname(skillDir) });
    hub.registerLocalSkillFile('watched-helper', skillFile);
    resetSkillRegistry();
    const registry = getSkillRegistry({ workspacePath: path.dirname(skillDir), managedPath: '', bundledPath: '', watchEnabled: true });
    await registry.load();
    const watchers = (registry as unknown as { watchers: Map<string, fs.FSWatcher> }).watchers;
    const originalHandles = [...watchers.values()];
    const releasedHandles = new Set<fs.FSWatcher>();
    for (const handle of originalHandles) {
      vi.spyOn(handle, 'close');
      handle.once('close', () => releasedHandles.add(handle));
    }
    expect(originalHandles.length).toBeGreaterThan(0);
    const releaseOuterPause = fail ? registry.pauseWatching() : undefined;
    const realRm = fs.promises.rm;
    const failure = Object.assign(new Error('locked'), { code: 'EPERM' });
    vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, options) => {
      for (const handle of originalHandles) expect(handle.close).toHaveBeenCalled();
      // close() only starts the release: Windows keeps the directory locked
      // until the handle is actually gone, so the removal must wait for it.
      for (const handle of originalHandles) expect(releasedHandles.has(handle)).toBe(true);
      expect(options).toMatchObject({ maxRetries: 10, retryDelay: 100 });
      if (fail) throw failure;
      await realRm(target, options);
    });
    if (fail) {
      await expect(hub.uninstall('watched-helper')).rejects.toBe(failure);
      expect(hub.list().some((skill) => skill.name === 'watched-helper')).toBe(true);
      expect(fs.existsSync(skillFile)).toBe(true);
    } else {
      await expect(hub.uninstall('watched-helper')).resolves.toBe(true);
      expect(fs.existsSync(skillDir)).toBe(false);
      expect(registry.get('watched-helper')).toBeUndefined();
    }
    if (releaseOuterPause) {
      expect(watchers.size).toBe(0);
      releaseOuterPause();
      releaseOuterPause(); // Resuming a pause twice must not underflow the counter.
    }
    for (const handle of originalHandles) expect(handle.close).toHaveBeenCalled();
    expect(watchers.size).toBeGreaterThan(0);
    for (const handle of watchers.values()) expect(originalHandles).not.toContain(handle);
    registry.stopWatching();
  });

  it('returns exit 1 when hub uninstall cannot find a skill', () => {
    const testRoot = fs.mkdtempSync(path.join(repoRoot, '.r16-uninstall-missing-'));
    tempDirs.push(testRoot);
    const home = path.join(testRoot, 'home');
    const result = spawnSync(process.execPath, [
      tsxCli,
      path.join(repoRoot, 'src', 'index.ts'),
      'hub',
      'uninstall',
      'missing-r16-skill',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        HOME: home,
        NO_COLOR: '1',
        USERPROFILE: home,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 4500,
      windowsHide: true,
    });

    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('Skill not found: missing-r16-skill');
  });
});
