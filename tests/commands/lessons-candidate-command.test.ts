/**
 * Tests for `buddy lessons candidate ...` CLI (Hermes parity TODO item 7).
 *
 * Unlike the main lessons command test, these exercise the real
 * LessonCandidateQueue + LessonsTracker against a temp workDir (process.cwd is
 * spied) so the "propose does not write lessons.md, approve does" guarantee is
 * verified end to end through the CLI wiring. os.homedir() is mocked so the
 * global ~/.codebuddy is never touched.
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createLessonsCommand } from '../../src/commands/lessons.js';
import { resetLessonCandidateQueues } from '../../src/agent/lesson-candidate-queue.js';

let _fakeHome = '/tmp/lessons-candidate-cli-home-placeholder';
jest.mock('os', () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: jest.fn(() => _fakeHome) };
});

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.addCommand(createLessonsCommand());
  return program;
}

function getLogOutput(spy: jest.SpyInstance): string {
  return (spy.mock.calls as unknown[][]).map((c) => c.join(' ')).join('\n');
}

describe('buddy lessons candidate', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-candidate-cli-'));
    _fakeHome = path.join(tmpDir, 'fake-home');
    resetLessonCandidateQueues();
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(
      (() => {}) as unknown as (code?: number | string | null) => never,
    );
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    processExitSpy.mockRestore();
    resetLessonCandidateQueues();
    await fs.remove(tmpDir);
  });

  const lessonsMd = () => path.join(tmpDir, '.codebuddy', 'lessons.md');

  it('registers a "candidate" subcommand', () => {
    const cmd = createLessonsCommand();
    expect(cmd.commands.map((c) => c.name())).toContain('candidate');
  });

  it('propose enqueues a pending candidate without writing lessons.md', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'buddy', 'lessons', 'candidate', 'propose',
      'Always flush the write chain before reading lessons.md.',
      '--category', 'RULE', '--context', 'testing',
    ]);

    expect(getLogOutput(consoleSpy)).toContain('Proposed candidate');
    expect(await fs.pathExists(lessonsMd())).toBe(false);
    expect(await fs.pathExists(path.join(tmpDir, '.codebuddy', 'lesson-candidates.json'))).toBe(true);
  });

  it('propose --json returns the pending candidate and review command', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'buddy', 'lessons', 'candidate', 'propose',
      'Keep lesson review queues scriptable.',
      '--category', 'INSIGHT',
      '--run', 'run-json-propose',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput(consoleSpy)) as {
      candidate: { content: string; id: string; provenance?: { runId?: string }; status: string };
      deduped: boolean;
      reviewCommand: string;
    };
    expect(output).toMatchObject({
      candidate: {
        content: 'Keep lesson review queues scriptable.',
        provenance: { runId: 'run-json-propose' },
        status: 'pending',
      },
      deduped: false,
    });
    expect(output.reviewCommand).toBe(`buddy lessons candidate approve ${output.candidate.id} --by <name>`);
    expect(await fs.pathExists(lessonsMd())).toBe(false);
  });

  it('list --json shows pending candidates', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'lessons', 'candidate', 'propose', 'a pending one']);
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'lessons', 'candidate', 'list', '--status', 'pending', '--json']);

    const parsed = JSON.parse(getLogOutput(consoleSpy));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe('pending');
  });

  it('approve requires a reviewer and then writes the lesson', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'buddy', 'lessons', 'candidate', 'propose', 'promote me', '--category', 'PATTERN',
    ]);
    const proposeOutput = getLogOutput(consoleSpy);
    const id = proposeOutput.match(/\[(lc-[a-z0-9]+)\]/)?.[1];
    expect(id).toBeTruthy();

    // Approve without --by must not write a lesson (commander rejects the
    // missing required option before the action runs).
    try {
      await program.parseAsync(['node', 'buddy', 'lessons', 'candidate', 'approve', id!]);
    } catch {
      // commander throws on the missing required option — that's expected.
    }
    expect(await fs.pathExists(lessonsMd())).toBe(false);

    consoleSpy.mockClear();
    await program.parseAsync([
      'node', 'buddy', 'lessons', 'candidate', 'approve', id!, '--by', 'Patrice',
    ]);

    expect(getLogOutput(consoleSpy)).toMatch(/Approved candidate .* → lesson/);
    const md = await fs.readFile(lessonsMd(), 'utf-8');
    expect(md).toContain('promote me');
  });

  it('discard marks a candidate discarded and never writes lessons.md', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'lessons', 'candidate', 'propose', 'noisy idea']);
    const id = getLogOutput(consoleSpy).match(/\[(lc-[a-z0-9]+)\]/)?.[1];
    expect(id).toBeTruthy();

    consoleSpy.mockClear();
    await program.parseAsync([
      'node', 'buddy', 'lessons', 'candidate', 'discard', id!, '--reason', 'not useful',
    ]);

    expect(getLogOutput(consoleSpy)).toContain('Discarded candidate');
    expect(await fs.pathExists(lessonsMd())).toBe(false);
  });
});
