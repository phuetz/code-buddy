import fs from 'fs';
import { spawnSync } from 'child_process';
import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerSkillsCommands } from '../../src/commands/skills-cli/index.js';
import { getSkillsHub, resetSkillsHub } from '../../src/skills/hub.js';
import { resetSkillRegistry } from '../../src/skills/registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const tempDirs: string[] = [];

afterEach(() => {
  resetSkillRegistry();
  resetSkillsHub();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
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

      expect(process.getActiveResourcesInfo()).not.toContain('FSWatcher');
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
