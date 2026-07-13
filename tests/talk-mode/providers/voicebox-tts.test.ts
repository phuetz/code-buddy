import { writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const voiceboxMocks = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  probe: vi.fn(),
  synthesize: vi.fn(),
}));

vi.mock('../../../src/voice/voicebox-tts.js', () => ({
  listVoiceboxProfiles: voiceboxMocks.listProfiles,
  probeVoicebox: voiceboxMocks.probe,
  synthesizeVoiceboxWav: voiceboxMocks.synthesize,
}));

import {
  __test,
  VoiceboxTTSProvider,
} from '../../../src/talk-mode/providers/voicebox-tts.js';

function wav(sampleRate = 24_000, samples = 240): Buffer {
  const audio = Buffer.alloc(44 + samples * 2);
  audio.write('RIFF', 0, 'ascii');
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVE', 8, 'ascii');
  audio.write('fmt ', 12, 'ascii');
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(sampleRate, 24);
  audio.writeUInt32LE(sampleRate * 2, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36, 'ascii');
  audio.writeUInt32LE(samples * 2, 40);
  return audio;
}

beforeEach(() => {
  vi.clearAllMocks();
  voiceboxMocks.probe.mockResolvedValue({
    available: true,
    baseUrl: 'http://darkstar:17493',
    configuredProfile: 'Lisa',
    profiles: [],
    engine: 'qwen',
  });
  voiceboxMocks.listProfiles.mockResolvedValue([
    { id: 'lisa-id', name: 'Lisa', language: 'fr' },
    { id: 'other-id', name: 'Narratrice', language: 'fr' },
  ]);
  voiceboxMocks.synthesize.mockImplementation(async (_text: string, path: string) => {
    writeFileSync(path, wav());
    return true;
  });
});

describe('Voicebox Talk Mode provider', () => {
  it('reports availability and exposes server profiles as voices', async () => {
    const provider = new VoiceboxTTSProvider();
    await provider.initialize({
      provider: 'voicebox',
      enabled: true,
      priority: 1,
      settings: { baseURL: 'http://darkstar:17493', profile: 'Lisa', language: 'fr' },
    });

    expect(await provider.isAvailable()).toBe(true);
    const voices = await provider.listVoices();
    expect(voices).toHaveLength(2);
    expect(voices[0]).toMatchObject({
      id: 'voicebox-lisa-id',
      provider: 'voicebox',
      providerId: 'lisa-id',
      isDefault: true,
    });
  });

  it('synthesizes a selected profile into a canonical Talk Mode result', async () => {
    const provider = new VoiceboxTTSProvider();
    await provider.initialize({
      provider: 'voicebox',
      enabled: true,
      priority: 1,
      settings: { profile: 'Lisa' },
    });

    const result = await provider.synthesize('Bonjour.', {
      voice: 'voicebox-lisa-id',
      language: 'fr',
    });

    expect(result).toMatchObject({
      format: 'wav',
      provider: 'voicebox',
      voice: 'lisa-id',
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      durationMs: 10,
    });
    expect(voiceboxMocks.synthesize).toHaveBeenCalledWith(
      'Bonjour.',
      expect.any(String),
      expect.objectContaining({
        CODEBUDDY_VOICEBOX_PROFILE: 'lisa-id',
        CODEBUDDY_VOICEBOX_LANGUAGE: 'fr',
      }),
      expect.any(Object)
    );
  });

  it('refuses synthesis without a configured or selected profile', async () => {
    const previous = process.env.CODEBUDDY_VOICEBOX_PROFILE;
    delete process.env.CODEBUDDY_VOICEBOX_PROFILE;
    try {
      const provider = new VoiceboxTTSProvider();
      await provider.initialize({ provider: 'voicebox', enabled: true, priority: 1 });
      await expect(provider.synthesize('Bonjour.')).rejects.toThrow(/profile is missing/i);
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_VOICEBOX_PROFILE;
      else process.env.CODEBUDDY_VOICEBOX_PROFILE = previous;
    }
  });

  it('parses Voicebox WAV timing metadata', () => {
    expect(__test.wavInfo(wav(24_000, 2_400))).toMatchObject({
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      durationMs: 100,
    });
  });
});
