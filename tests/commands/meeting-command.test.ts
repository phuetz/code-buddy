import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMeetingCommand,
} from '../../src/commands/meeting.js';
import {
  resolveMeetingOutputTargets,
  writeMeetingOutputReports,
  type MeetingNotesResult,
} from '../../src/meeting/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  return program;
}

function fixtureResult(): MeetingNotesResult {
  const notes = {
    schemaVersion: 1 as const,
    generatedAt: '2026-07-12T08:00:00.000Z',
    language: 'fr',
    analysisMode: 'deterministic' as const,
    source: { kind: 'text' as const, name: 'input.txt' },
    title: 'Point équipe',
    summary: 'Résumé.',
    keyPoints: [],
    participants: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    transcript: [],
  };
  return { notes, markdown: '# Point équipe\n', json: JSON.stringify(notes, null, 2) };
}

describe('meeting CLI', () => {
  it('registers the required notes options', () => {
    const command = createMeetingCommand();
    const notes = command.commands.find((candidate) => candidate.name() === 'notes');
    expect(notes).toBeDefined();
    expect(notes!.options.map((option) => option.long)).toEqual(expect.arrayContaining([
      '--output', '--json', '--language', '--ai', '--no-ai', '--force',
    ]));
  });

  it('passes --no-ai and language to the core and emits JSON', async () => {
    const generate = vi.fn(async () => fixtureResult());
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const program = createProgram();
    program.addCommand(createMeetingCommand({ generate }));

    await program.parseAsync(['node', 'test', 'meeting', 'notes', '/tmp/input.txt', '--no-ai', '--language', 'en', '--json']);

    expect(generate).toHaveBeenCalledWith(
      { kind: 'file', path: '/tmp/input.txt' },
      { language: 'en', useAI: false },
    );
    expect(write.mock.calls.map((call) => String(call[0])).join('')).toContain('"schemaVersion": 1');
  });

  it('is local by default and requires --ai for transcript egress', async () => {
    const generate = vi.fn(async () => fixtureResult());
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const localProgram = createProgram();
    localProgram.addCommand(createMeetingCommand({ generate }));
    await localProgram.parseAsync(['node', 'test', 'meeting', 'notes', '/tmp/input.txt']);
    expect(generate).toHaveBeenLastCalledWith(
      { kind: 'file', path: '/tmp/input.txt' },
      { language: 'fr', useAI: false },
    );

    const aiProgram = createProgram();
    aiProgram.addCommand(createMeetingCommand({ generate }));
    await aiProgram.parseAsync(['node', 'test', 'meeting', 'notes', '/tmp/input.txt', '--ai']);
    expect(generate).toHaveBeenLastCalledWith(
      { kind: 'file', path: '/tmp/input.txt' },
      { language: 'fr', useAI: true },
    );
  });

  it('writes Markdown and JSON companions for an output prefix', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meeting-command-'));
    tempDirs.push(dir);
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const program = createProgram();
    program.addCommand(createMeetingCommand({ generate: async () => fixtureResult() }));
    const prefix = join(dir, 'reports', 'weekly');

    await program.parseAsync(['node', 'test', 'meeting', 'notes', '/tmp/input.txt', '--no-ai', '--output', prefix]);

    expect(await readFile(`${prefix}.md`, 'utf8')).toBe('# Point équipe\n');
    expect(JSON.parse(await readFile(`${prefix}.json`, 'utf8'))).toMatchObject({ title: 'Point équipe' });
    if (process.platform !== 'win32') {
      expect((await stat(`${prefix}.md`)).mode & 0o777).toBe(0o600);
      expect((await stat(`${prefix}.json`)).mode & 0o777).toBe(0o600);
    }
  });

  it('preserves existing reports unless --force explicitly replaces the pair', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meeting-command-force-'));
    tempDirs.push(dir);
    const prefix = join(dir, 'weekly');
    await writeFile(`${prefix}.md`, 'old markdown', 'utf8');
    await writeFile(`${prefix}.json`, '{"old":true}\n', 'utf8');
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);

    const protectedProgram = createProgram();
    protectedProgram.addCommand(createMeetingCommand({ generate: async () => fixtureResult() }));
    await expect(
      protectedProgram.parseAsync([
        'node', 'test', 'meeting', 'notes', '/tmp/input.txt', '--output', prefix,
      ]),
    ).rejects.toThrow(/already exists/);
    expect(await readFile(`${prefix}.md`, 'utf8')).toBe('old markdown');
    expect(await readFile(`${prefix}.json`, 'utf8')).toBe('{"old":true}\n');

    const forceProgram = createProgram();
    forceProgram.addCommand(createMeetingCommand({ generate: async () => fixtureResult() }));
    await forceProgram.parseAsync([
      'node', 'test', 'meeting', 'notes', '/tmp/input.txt', '--output', prefix, '--force',
    ]);
    expect(await readFile(`${prefix}.md`, 'utf8')).toBe('# Point équipe\n');
    expect(JSON.parse(await readFile(`${prefix}.json`, 'utf8'))).toMatchObject({ title: 'Point équipe' });
  });

  it('does not replace either member when the forced pair cannot be prepared', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meeting-command-rollback-'));
    tempDirs.push(dir);
    const prefix = join(dir, 'blocked');
    await writeFile(`${prefix}.md`, 'old markdown', 'utf8');
    await mkdir(`${prefix}.json`);

    await expect(
      writeMeetingOutputReports(prefix, fixtureResult(), { overwrite: true }),
    ).rejects.toThrow(/directory/);
    expect(await readFile(`${prefix}.md`, 'utf8')).toBe('old markdown');
    expect((await stat(`${prefix}.json`)).isDirectory()).toBe(true);
  });

  it('derives a safe report name inside an existing output directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meeting-target-'));
    tempDirs.push(dir);
    const targets = await resolveMeetingOutputTargets(dir, fixtureResult());
    expect(targets.markdown).toBe(join(dir, 'point-equipe.md'));
    expect(targets.json).toBe(join(dir, 'point-equipe.json'));
  });
});
