import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/skills/hub.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/skills/hub.js')>();
  return {
    ...original,
    getSkillsHub: () => ({
      listWithIntegrity: () => [],
    }),
  };
});

import { countBundledSkillEntries, registerSkillsCommands } from '../../src/commands/skills-cli/index.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

describe('countBundledSkillEntries', () => {
  it('counts .skill.md files and SKILL.md directories', () => {
    const dir = makeTmpDir('bundled-skills-', join(process.cwd(), 'tmp'));
    writeFileSync(join(dir, 'weather.skill.md'), '# weather\n');
    mkdirSync(join(dir, 'pubcommander-control'));
    writeFileSync(join(dir, 'pubcommander-control', 'SKILL.md'), '# pub\n');
    writeFileSync(join(dir, 'README.md'), 'ignore');
    expect(countBundledSkillEntries(dir)).toBe(2);
    expect(countBundledSkillEntries(join(dir, 'missing'))).toBe(0);
    removeTmpDir(dir);
  });
});

describe('buddy skills list empty hub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the hub and bundled skills instead of claiming none are installed', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerSkillsCommands(program);
    await program.parseAsync(['node', 'test', 'skills', 'list']);

    const output = logs.join('\n');
    expect(output).not.toContain('No skills installed.');
    expect(output).toMatch(/No hub-installed skills/);
    expect(output).toMatch(/bundled skill/);
  });
});
