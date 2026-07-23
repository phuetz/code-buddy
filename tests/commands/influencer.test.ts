import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { createInfluencerCommand } from '../../src/commands/influencer.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('influencer command', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    logSpy.mockClear();
  });

  it('lists Python scripts with their first docstring line', async () => {
    const program = new Command().exitOverride();
    program.addCommand(createInfluencerCommand());

    await program.parseAsync(['node', 'buddy', 'influencer', 'list']);

    const output = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toContain(
      'broll-batch.py — Banque B-roll premium (Veo 3.1 Quality, audio natif)'
    );
    expect(output).toContain("make-influencer-batch.py — Engine 'influenceuse présente un sujet'");
    expect(output).toContain('lisa-clip-batch.py — Banque de clips Lisa premium via Flow');
  });

  it('is registered lazily in the CLI entry point', async () => {
    const indexSource = await readFile(resolve(REPO_ROOT, 'src/index.ts'), 'utf8');

    expect(indexSource).toMatch(
      /addLazyCommand\(\s*program,\s*'influencer',\s*'Influencer & book-trailer media pipeline \(scripts\/influencer\)'/
    );
    expect(indexSource).toContain("import('./commands/influencer.js')");
  });
});
