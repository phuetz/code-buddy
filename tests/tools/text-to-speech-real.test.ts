import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { TextToSpeechTool } from '../../src/tools/registry/multimodal-tools.js';
import type { TextToSpeechProvider } from '../../src/tools/text-to-speech-tool.js';
import { commandExists } from '../../src/utils/command-exists.js';

let tempWorkspace: string;

describe('Hermes text_to_speech real integration', () => {
  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-tts-real-'));
  });

  afterEach(async () => {
    await fs.rm(tempWorkspace, { recursive: true, force: true });
  });

  it('synthesizes a real local speech audio file when a provider is available', async () => {
    const provider = await pickRealProvider();
    if (!provider) {
      console.warn('No local TTS provider available; verified tool registration in the parity test.');
      return;
    }

    const outputPath = path.join(tempWorkspace, `hello.${provider.format}`);
    const tool = new TextToSpeechTool({
      rootDir: tempWorkspace,
      now: () => new Date('2026-05-30T21:00:00.000Z'),
      createId: () => 'tts-real',
    });

    const result = await tool.execute({
      text: 'Hello Code Buddy. This is a real Hermes text to speech test.',
      provider: provider.name,
      output_path: outputPath,
      format: provider.format,
      timeout_ms: 120000,
    }, { cwd: tempWorkspace });

    expect(result.success, result.error).toBe(true);
    const payload = JSON.parse(result.output ?? '{}') as {
      kind: string;
      ok: boolean;
      provider: string;
      outputPath: string;
      mediaPath: string;
      format: string;
      sizeBytes: number;
    };
    expect(payload).toMatchObject({
      kind: 'text_to_speech_result',
      ok: true,
      provider: provider.name,
      outputPath,
      mediaPath: `MEDIA:${outputPath}`,
      format: provider.format,
    });
    expect(payload.sizeBytes).toBeGreaterThan(44);

    const audio = await fs.readFile(outputPath);
    expect(audio.length).toBe(payload.sizeBytes);
    if (provider.format === 'wav') {
      expect(audio.toString('ascii', 0, 4)).toBe('RIFF');
      expect(audio.toString('ascii', 8, 12)).toBe('WAVE');
    } else if (provider.format === 'aiff') {
      expect(audio.toString('ascii', 0, 4)).toBe('FORM');
    } else {
      const header = audio.toString('latin1', 0, 3);
      expect(header === 'ID3' || audio[0] === 0xff).toBe(true);
    }
  });

  it('marks official Hermes text_to_speech as an exact local tool', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T21:00:00.000Z');
    expect(manifest.tools).toContainEqual(expect.objectContaining({
      name: 'text_to_speech',
      status: 'exact',
      detectedCodeBuddyTools: expect.arrayContaining(['text_to_speech']),
    }));
  });
});

async function pickRealProvider(): Promise<{ name: TextToSpeechProvider; format: 'wav' | 'mp3' | 'aiff' } | undefined> {
  if (process.platform === 'win32' && await commandExists('powershell.exe')) {
    return { name: 'system', format: 'wav' };
  }
  if (process.platform === 'darwin' && await commandExists('say')) {
    return { name: 'say', format: 'aiff' };
  }
  if (await commandExists('espeak')) {
    return { name: 'espeak', format: 'wav' };
  }
  if (await commandExists('edge-tts')) {
    return { name: 'edge-tts', format: 'mp3' };
  }
  return undefined;
}
