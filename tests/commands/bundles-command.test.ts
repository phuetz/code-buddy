import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBundlesCommands } from '../../src/commands/cli/bundles-command.js';
import { getSkillsHub, resetSkillsHub } from '../../src/skills/hub.js';

let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function skillContent(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'version: 1.0.0',
    `description: ${name} bundle test skill`,
    '---',
    '',
    `# ${name}`,
    '',
    'Bundle command test skill body.',
  ].join('\n');
}

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerBundlesCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  await createProgram().parseAsync(['node', 'buddy', 'bundles', ...args]);
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
}

async function readStore(): Promise<{ version: number; bundles: Record<string, unknown> }> {
  const raw = await fs.readFile(path.join(tempHome, '.codebuddy', 'bundles.json'), 'utf8');
  return JSON.parse(raw);
}

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-bundles-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  // Isolate the SkillsHub singleton onto the tmpdir (DEFAULT_HUB_CONFIG
  // resolves homedir() at module-load, so HOME alone is not enough).
  resetSkillsHub();
  const hub = getSkillsHub({
    cacheDir: path.join(tempHome, '.codebuddy', 'hub', 'cache'),
    skillsDir: path.join(tempHome, '.codebuddy', 'skills', 'managed'),
    lockfilePath: path.join(tempHome, '.codebuddy', 'hub', 'lock.json'),
    tapsPath: path.join(tempHome, '.codebuddy', 'hub', 'taps.json'),
  });
  await hub.installFromContent('skill-a', skillContent('skill-a'));
  await hub.installFromContent('skill-b', skillContent('skill-b'));

  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
});

afterEach(async () => {
  resetSkillsHub();
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  exitSpy.mockRestore();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await fs.rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('buddy bundles', () => {
  it('lists nothing when no bundles are defined', async () => {
    await run(['list']);
    expect(getLogOutput()).toContain('No bundles defined');
  });

  it('runs the full create -> list -> show -> remove lifecycle', async () => {
    // create
    await run(['create', 'frontend', 'skill-a', 'skill-b']);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(getLogOutput()).toContain("Bundle 'frontend' saved with 2 skill(s)");
    const afterCreate = await readStore();
    expect(afterCreate.bundles.frontend).toMatchObject({
      name: 'frontend',
      skills: ['skill-a', 'skill-b'],
    });

    // list
    consoleLogSpy.mockClear();
    await run(['list']);
    expect(getLogOutput()).toContain('frontend');
    expect(getLogOutput()).toContain('skill-a, skill-b');

    // show
    consoleLogSpy.mockClear();
    await run(['show', 'frontend']);
    const shown = getLogOutput();
    expect(shown).toContain("Bundle 'frontend'");
    expect(shown).toContain('- skill-a');
    expect(shown).toContain('- skill-b');

    // remove
    consoleLogSpy.mockClear();
    await run(['remove', 'frontend']);
    expect(getLogOutput()).toContain("Bundle 'frontend' removed");
    expect((await readStore()).bundles.frontend).toBeUndefined();
  });

  it('emits JSON for create and show with --json', async () => {
    await run(['create', 'data', 'skill-a', '--json']);
    const created = JSON.parse(consoleLogSpy.mock.calls.at(-1)![0] as string);
    expect(created).toMatchObject({ created: true, bundle: { name: 'data', skills: ['skill-a'] } });

    consoleLogSpy.mockClear();
    await run(['show', 'data', '--json']);
    const shown = JSON.parse(consoleLogSpy.mock.calls.at(-1)![0] as string);
    expect(shown.bundle).toMatchObject({ name: 'data', skills: ['skill-a'] });
  });

  it('rejects bundles that reference unknown skills', async () => {
    await run(['create', 'broken', 'skill-a', 'does-not-exist']);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('does-not-exist');
    expect(exitSpy).toHaveBeenCalledWith(1);
    // Nothing persisted.
    await expect(readStore()).rejects.toBeTruthy();
  });

  it('errors when showing or removing a missing bundle', async () => {
    await run(['show', 'ghost']);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockClear();
    await run(['remove', 'ghost']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('upserts an existing bundle, preserving createdAt', async () => {
    await run(['create', 'mix', 'skill-a']);
    const first = await readStore();
    const createdAt = (first.bundles.mix as { createdAt: string }).createdAt;

    await run(['create', 'mix', 'skill-b']);
    const second = await readStore();
    expect((second.bundles.mix as { skills: string[] }).skills).toEqual(['skill-b']);
    expect((second.bundles.mix as { createdAt: string }).createdAt).toBe(createdAt);
  });
});
