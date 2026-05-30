import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSkillsCommands } from '../../src/commands/skills-cli/index.js';
import { getSkillsHub, resetSkillsHub } from '../../src/skills/hub.js';

let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerSkillsCommands(program);
  return program;
}

function skillContent(name: string, version: string, body: string): string {
  return [
    '---',
    `name: ${name}`,
    `version: ${version}`,
    `description: ${name} command test skill`,
    '---',
    '',
    `# ${name}`,
    '',
    body,
  ].join('\n');
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
}

describe('buddy skills command with real SkillsHub state', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-skills-command-'));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    resetSkillsHub();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    resetSkillsHub();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('doctor reports missing and tampered SKILL.md packages without mutating the lockfile', async () => {
    const hub = getSkillsHub({
      cacheDir: path.join(tempHome, 'cache'),
      lockfilePath: path.join(tempHome, 'lock.json'),
      skillsDir: path.join(tempHome, 'skills'),
    });
    await hub.installFromContent(
      'healthy-helper',
      skillContent('healthy-helper', '1.0.0', 'Healthy package.'),
    );
    const missing = await hub.installFromContent(
      'missing-helper',
      skillContent('missing-helper', '1.0.0', 'Will be removed from disk.'),
    );
    const tampered = await hub.installFromContent(
      'tampered-helper',
      skillContent('tampered-helper', '1.0.0', 'Will be edited on disk.'),
    );
    await fs.rm(missing.path, { force: true });
    await fs.writeFile(tampered.path, 'manual edit', 'utf-8');

    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'skills', 'doctor', '--json']);

    const result = JSON.parse(getLogOutput()) as {
      healthyCount: number;
      issueCount: number;
      issues: Array<{ commands: string[]; issue: string; name: string }>;
      ok: boolean;
      total: number;
    };

    expect(result).toMatchObject({
      healthyCount: 1,
      issueCount: 2,
      ok: false,
      total: 3,
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commands: ['skill_manage action=delete name=missing-helper approved_by=<reviewer>'],
        issue: 'missing-file',
        name: 'missing-helper',
      }),
      expect.objectContaining({
        commands: [
          'skill_manage action=history name=tampered-helper',
          'skill_manage action=rollback name=tampered-helper approved_by=<reviewer>',
        ],
        issue: 'integrity-mismatch',
        name: 'tampered-helper',
      }),
    ]));
    expect(getSkillsHub().list()).toHaveLength(3);
  });
});
