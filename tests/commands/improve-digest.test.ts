import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerError, readSources } = vi.hoisted(() => ({
  loggerError: vi.fn(),
  readSources: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: loggerError,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/agent/self-improvement/digest-sources.js', () => ({
  readImprovementDigestSources: readSources,
}));

import { registerImproveCommands } from '../../src/commands/cli/improve-command.js';

const tempDirs: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let previousExitCode: number | string | undefined;

function program(): Command {
  const command = new Command();
  command.exitOverride();
  command.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerImproveCommands(command);
  return command;
}

beforeEach(() => {
  previousExitCode = process.exitCode;
  process.exitCode = 0;
  loggerError.mockReset();
  readSources.mockReset();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  logSpy.mockRestore();
  process.exitCode = previousExitCode;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('buddy improve digest CLI', () => {
  it('prints honest Markdown when self-improvement has never run', async () => {
    readSources.mockResolvedValue({});

    await program().parseAsync(['node', 'buddy', 'improve', 'digest']);

    expect(logSpy).toHaveBeenCalledOnce();
    expect(String(logSpy.mock.calls[0]![0])).toContain('# Digest d’auto-amélioration');
    expect(String(logSpy.mock.calls[0]![0])).toContain('Rien à rapporter');
    expect(process.exitCode).toBe(0);
  });

  it('writes standalone HTML and returns its path in machine JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'improve-digest-cli-'));
    tempDirs.push(dir);
    const output = join(dir, 'weekly.html');
    readSources.mockResolvedValue({
      artifacts: [
        {
          name: 'imported-review',
          kind: 'imported-skill',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    await program().parseAsync([
      'node',
      'buddy',
      'improve',
      'digest',
      '--since',
      '7d',
      '--json',
      '--html',
      output,
    ]);

    const payload = JSON.parse(String(logSpy.mock.calls[0]![0])) as {
      kind: string;
      htmlPath: string;
      skills: { imported: { names: string[] } };
    };
    expect(payload.kind).toBe('self_improvement_digest');
    expect(payload.htmlPath).toBe(output);
    expect(payload.skills.imported.names).toEqual(['imported-review']);
    const html = await readFile(output, 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it('rejects an invalid --since value without reading or writing sources', async () => {
    await program().parseAsync(['node', 'buddy', 'improve', 'digest', '--since', 'later']);

    expect(process.exitCode).toBe(1);
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('Période invalide'));
    expect(readSources).not.toHaveBeenCalled();
  });
});
