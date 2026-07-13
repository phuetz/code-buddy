import { statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerAssistantCommand } from '../../src/commands/assistant.js';
import { readConversationPilotCorpus } from '../../src/conversation/conversation-pilot-corpus.js';

async function runAssistant(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerAssistantCommand(program);
  await program.parseAsync(['node', 'test', 'assistant', ...args]);
}

describe('buddy assistant pilot commands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('initializes the private annotated corpus from the CLI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assistant-pilot-cli-'));
    const path = join(directory, 'corpus.json');
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runAssistant(['corpus-init', '--path', path]);

    expect(output.mock.calls.flat().join('\n')).toContain('Corpus pilote créé');
    expect(readConversationPilotCorpus(path).scenarios.length).toBeGreaterThanOrEqual(6);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('fails before provider resolution when the requested corpus is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assistant-pilot-cli-'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runAssistant([
      'compare',
      '--models',
      'first-model,second-model',
      '--corpus',
      join(directory, 'missing.json'),
    ]);

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('corpus-init');
  });
});
