import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/talk-mode/providers/audioreader-tts.js', () => ({
  AudioReaderTTSProvider: class {
    async initialize(): Promise<void> {}
    async isAvailable(): Promise<boolean> {
      return false;
    }
    async listVoices(): Promise<never[]> {
      return [];
    }
    async synthesize(): Promise<{ audio: Buffer; format: string }> {
      throw new Error('synthesize should not run when AudioReader is unavailable');
    }
    async shutdown(): Promise<void> {}
  },
}));

import { registerSpeakCommand } from '../../src/commands/cli/speak-command.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

describe('speak AudioReader missing-service hint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not name a personal checkout path', async () => {
    const directory = makeTmpDir('speak-hint-', join(process.cwd(), 'tmp'));
    const err: string[] = [];
    const program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: (s) => {
        err.push(String(s));
      },
    });
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      err.push(args.map(String).join(' '));
    });
    registerSpeakCommand(program);

    await expect(
      program.parseAsync(['node', 'test', 'speak', '--out', join(directory, 'out.wav'), 'bonjour']),
    ).rejects.toThrow(/process.exit:1/);

    const text = err.join('\n');
    expect(text).toMatch(/AudioReader is not running/i);
    expect(text).not.toMatch(/claude\/AudioReader/);
    expect(text).not.toMatch(/~\/claude/);
    expect(text).toMatch(/--engine pocket/);
    removeTmpDir(directory);
  });

  it('text-to-speech availability hint does not name a personal checkout path', () => {
    const src = readFileSync(join(process.cwd(), 'src/input/text-to-speech.ts'), 'utf8');
    expect(src).not.toMatch(/claude\/AudioReader/);
    expect(src).not.toMatch(/~\/claude/);
  });
});
