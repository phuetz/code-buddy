/**
 * `buddy lessons show|rm|edit` — CLI wiring against the REAL tracker
 * (temp project dir, isolated fake home; no store mocks).
 */
import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let _fakeHome = '/tmp/lessons-manage-cli-home-placeholder';
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: vi.fn(() => _fakeHome) };
});

import { createLessonsCommand } from '../../src/commands/lessons.js';
import { getLessonsTracker } from '../../src/agent/lessons-tracker.js';

describe('buddy lessons show/rm/edit (real tracker)', () => {
  let tmpDir: string;
  let projectDir: string;
  let cwdBefore: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const run = async (...args: string[]): Promise<void> => {
    const program = new Command();
    program.exitOverride();
    program.addCommand(createLessonsCommand());
    await program.parseAsync(['node', 'buddy', 'lessons', ...args]);
  };

  const logged = (): string => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-cli-'));
    _fakeHome = path.join(tmpDir, 'fake-home');
    projectDir = path.join(tmpDir, 'project');
    await fs.ensureDir(projectDir);
    cwdBefore = process.cwd();
    process.chdir(projectDir);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(async () => {
    process.chdir(cwdBefore);
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    await fs.remove(tmpDir);
  });

  it('show <id> prints the lesson and its file; --json returns the full shape', async () => {
    const tracker = getLessonsTracker(process.cwd());
    const added = tracker.add('RULE', 'run the gate before commit', 'manual', 'ci');
    await tracker.save();

    await run('show', added.id);
    expect(logged()).toContain('run the gate before commit');
    expect(logged()).toContain('lessons.md');

    logSpy.mockClear();
    await run('show', added.id, '--json');
    const parsed = JSON.parse(logged());
    expect(parsed.id).toBe(added.id);
    expect(parsed.locations[0].scope).toBe('project');
  });

  it('show on a missing id exits 1', async () => {
    await expect(run('show', 'missing')).rejects.toThrow('process.exit(1)');
    expect(errSpy.mock.calls.join(' ')).toContain('not found');
  });

  it('rm <id> deletes and names the file it removed from', async () => {
    const tracker = getLessonsTracker(process.cwd());
    const added = tracker.add('INSIGHT', 'temporary note');
    await tracker.save();

    await run('rm', added.id);
    expect(logged()).toContain(`Removed [${added.id}]`);
    expect(logged()).toContain('lessons.md');

    const raw = await fs.readFile(path.join(projectDir, '.codebuddy', 'lessons.md'), 'utf-8');
    expect(raw).not.toContain(added.id);
  });

  it('edit <id> --content --category rewrites the lesson; edit with no flags exits 1', async () => {
    const tracker = getLessonsTracker(process.cwd());
    const added = tracker.add('INSIGHT', 'old wording');
    await tracker.save();

    await run('edit', added.id, '--content', 'new wording', '--category', 'rule');
    expect(logged()).toContain('new wording');
    const raw = await fs.readFile(path.join(projectDir, '.codebuddy', 'lessons.md'), 'utf-8');
    expect(raw).toContain('## RULE');
    expect(raw).toContain(`- [${added.id}] new wording`);

    await expect(run('edit', added.id)).rejects.toThrow('process.exit(1)');
  });

  it('edit rejects content that would corrupt the markdown format (exit 1)', async () => {
    const tracker = getLessonsTracker(process.cwd());
    const added = tracker.add('INSIGHT', 'fine');
    await tracker.save();

    await expect(run('edit', added.id, '--content', 'bad <!-- comment')).rejects.toThrow('process.exit(1)');
    expect(errSpy.mock.calls.join(' ')).toContain('single line');
  });
});
