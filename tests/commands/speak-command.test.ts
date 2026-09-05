import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/talk-mode/providers/audioreader-tts.js', () => ({
  AudioReaderTTSProvider: class {
    async initialize(): Promise<void> {}
    async isAvailable(): Promise<boolean> {
      return true;
    }
    async listVoices(): Promise<never[]> {
      return [];
    }
    async synthesize(
      _text: string,
      options?: { format?: string },
    ): Promise<{ audio: Buffer; format: string }> {
      const format = options?.format === 'mp3' || options?.format === 'ogg'
        ? options.format
        : 'wav';
      return { audio: Buffer.from(`fake-${format}-data`), format };
    }
    async shutdown(): Promise<void> {}
  },
}));

import { registerSpeakCommand } from '../../src/commands/cli/speak-command.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    removeTmpDir(directory);
  }
});

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerSpeakCommand(program);
  return program;
}

describe('speak CLI command', () => {
  it('writes the synthesized WAV to --out without playing or deleting it', async () => {
    const directory = makeTmpDir('r13-speak-', path.join(process.cwd(), 'tmp'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'answer.wav');

    await createProgram().parseAsync(['node', 'test', 'speak', '--out', outputPath, 'bonjour']);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('fake-wav-data');
  });

  it('creates the parent directory and writes --out', async () => {
    const directory = makeTmpDir('r30-speak-', path.join(process.cwd(), 'tmp'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'nested', 'out', 'answer.wav');

    await createProgram().parseAsync(['node', 'test', 'speak', '--out', outputPath, 'bonjour']);

    expect(fs.readFileSync(outputPath, 'utf8')).toBe('fake-wav-data');
  });

  it('honors --format ogg on --out', async () => {
    const directory = makeTmpDir('r30-speak-ogg-', path.join(process.cwd(), 'tmp'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'nested', 'answer.ogg');

    await createProgram().parseAsync([
      'node',
      'test',
      'speak',
      '--format',
      'ogg',
      '--out',
      outputPath,
      'bonjour',
    ]);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('fake-ogg-data');
  });

  it('refuses an unsupported --format', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        createProgram().parseAsync(['node', 'test', 'speak', '--format', 'flac', 'bonjour']),
      ).rejects.toThrow(/exit:1/);
      expect(errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain(
        "Unsupported --format 'flac'",
      );
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
