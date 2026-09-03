import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerImproveCommands } from '../../src/commands/cli/improve-command.js';
import { resetSkillRegistry } from '../../src/skills/registry.js';

function program(): Command {
  const command = new Command();
  command.exitOverride();
  registerImproveCommands(command);
  return command;
}

function writeAuthored(root: string, name: string, body: string): string {
  const dir = path.join(root, '.codebuddy', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(
    file,
    `---\nname: ${name}\ndescription: "${name}"\nversion: 1.0.0\n---\n\n${body}\n`,
    'utf-8',
  );
  return file;
}

let tmp: string;
let previousCwd: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cb-improve-skills-${randomUUID().slice(0, 8)}-`));
  previousCwd = process.cwd();
  process.chdir(tmp);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  process.chdir(previousCwd);
  resetSkillRegistry();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('buddy improve skills-archive', () => {
  it('archives an authored skill into .archive and leaves it restorable', async () => {
    writeAuthored(tmp, 'authored-safe-delete', '# Safe Delete\nbackup dry run confirm');

    await program().parseAsync(['node', 'buddy', 'improve', 'skills-archive', 'authored-safe-delete', '--json']);

    expect(fs.existsSync(path.join(tmp, '.codebuddy', 'skills', 'authored-safe-delete', 'SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.codebuddy', 'skills', '.archive', 'authored-safe-delete', 'SKILL.md'))).toBe(true);
    const payload = JSON.parse(logSpy.mock.calls.map((c) => c.join(' ')).join('\n')) as { ok: boolean; name: string };
    expect(payload).toMatchObject({ kind: 'skill_archive', name: 'authored-safe-delete', ok: true });

    logSpy.mockClear();
    await program().parseAsync(['node', 'buddy', 'improve', 'skills-restore', 'authored-safe-delete', '--json']);
    expect(fs.existsSync(path.join(tmp, '.codebuddy', 'skills', 'authored-safe-delete', 'SKILL.md'))).toBe(true);
    const restored = JSON.parse(logSpy.mock.calls.map((c) => c.join(' ')).join('\n')) as { ok: boolean };
    expect(restored.ok).toBe(true);
  });

  it('refuses to archive a pinned authored skill', async () => {
    writeAuthored(tmp, 'authored-git-bisect', '# Git Bisect\ngit bisect good bad');
    await program().parseAsync(['node', 'buddy', 'improve', 'skills-pin', 'authored-git-bisect', '--json']);
    logSpy.mockClear();

    await program().parseAsync(['node', 'buddy', 'improve', 'skills-archive', 'authored-git-bisect', '--json']);

    expect(fs.existsSync(path.join(tmp, '.codebuddy', 'skills', 'authored-git-bisect', 'SKILL.md'))).toBe(true);
    const payload = JSON.parse(logSpy.mock.calls.map((c) => c.join(' ')).join('\n')) as { ok: boolean };
    expect(payload.ok).toBe(false);
  });
});
