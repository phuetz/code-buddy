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

    async synthesize(): Promise<{ audio: Buffer; format: 'wav' }> {
      return { audio: Buffer.from('fake-wav-data'), format: 'wav' };
    }

    async shutdown(): Promise<void> {}
  },
}));

import { registerSpeakCommand } from '../../src/commands/cli/speak-command.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('speak CLI command', () => {
  it('writes the synthesized WAV to --out without playing or deleting it', async () => {
    const directory = fs.mkdtempSync(path.join(process.cwd(), '.r13-speak-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'answer.wav');
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    registerSpeakCommand(program);
    await program.parseAsync([
      'node',
      'test',
      'speak',
      '--out',
      outputPath,
      'bonjour',
    ]);

    expect(fs.readFileSync(outputPath, 'utf8')).toBe('fake-wav-data');
  });
});
