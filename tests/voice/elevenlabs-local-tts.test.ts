import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cacheHarness = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  lookup: vi.fn((text: string, voice: string) =>
    cacheHarness.entries.get(`${text}\u0000${voice}`) ?? null
  ),
  store: vi.fn((text: string, voice: string, wav: string) => {
    cacheHarness.entries.set(`${text}\u0000${voice}`, wav);
  }),
}));

vi.mock('../../src/sensory/tts-cache.js', () => ({
  getTtsCache: () => ({
    lookup: cacheHarness.lookup,
    store: cacheHarness.store,
  }),
}));

import { logger } from '../../src/utils/logger.js';
import {
  resetPocketServer,
  resolveTtsEngine,
  synthesizeElevenLabsWav,
  synthesizeElevenLabsWithFallbackWav,
} from '../../src/voice/local-tts.js';
import {
  resetElevenLabsVoiceState,
} from '../../src/voice/elevenlabs-voice.js';
import { __voiceAudioPlayerTest } from '../../src/sensory/voice-loop.js';

const ENV_KEYS = [
  'CODEBUDDY_HOME',
  'CODEBUDDY_TTS_CACHE',
  'CODEBUDDY_TTS_ENGINE',
  'CODEBUDDY_TTS_VOICE',
  'CODEBUDDY_POCKET_SERVER',
  'CODEBUDDY_POCKET_URL',
  'CODEBUDDY_ELEVENLABS_MODEL',
  'CODEBUDDY_ELEVENLABS_MONTHLY_CAP',
  'ELEVENLABS_API_KEY',
] as const;

function pocketWav(): Buffer {
  const samples = Buffer.alloc(240);
  for (let offset = 0; offset < samples.length; offset += 2) {
    samples.writeInt16LE(offset % 8 === 0 ? 2_000 : -1_000, offset);
  }
  const wav = Buffer.alloc(44 + samples.length);
  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  wav.write('fmt ', 12, 4, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 4, 'ascii');
  wav.writeUInt32LE(samples.length, 40);
  samples.copy(wav, 44);
  return wav;
}

function pcm24k(): Buffer {
  const pcm = Buffer.alloc(240);
  for (let offset = 0; offset < pcm.length; offset += 2) {
    pcm.writeInt16LE(offset % 8 === 0 ? 1_500 : -750, offset);
  }
  return pcm;
}

function usageFile(home: string): string {
  return join(home, 'elevenlabs-voice-usage.json');
}

function readUsage(home: string): {
  month: string;
  characters: number;
  warned: boolean;
} {
  return JSON.parse(readFileSync(usageFile(home), 'utf8')) as {
    month: string;
    characters: number;
    warned: boolean;
  };
}

function fallbackFetch(
  mode: 'http' | 'network' | 'timeout' | 'unused'
): ReturnType<typeof vi.fn> {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('api.elevenlabs.io')) {
      if (mode === 'network') return Promise.reject(new Error('offline'));
      if (mode === 'http') return Promise.resolve(new Response(null, { status: 429 }));
      if (mode === 'timeout') {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = (): void => reject(signal?.reason ?? new Error('aborted'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
      }
      throw new Error('ElevenLabs should not have been called');
    }
    if (url.endsWith('/health')) {
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'healthy' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }
    if (url.endsWith('/tts')) {
      return Promise.resolve(
        new Response(pocketWav(), {
          status: 200,
          headers: { 'content-type': 'audio/wav' },
        })
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

describe('voix locale ElevenLabs', () => {
  const originalEnv = new Map<string, string | undefined>();
  const temporaryPaths: string[] = [];

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    cacheHarness.entries.clear();
    cacheHarness.lookup.mockClear();
    cacheHarness.store.mockClear();
    resetElevenLabsVoiceState();
    resetPocketServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetPocketServer();
    resetElevenLabsVoiceState();
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalEnv.clear();
    for (const path of temporaryPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  function temporaryDir(prefix: string): string {
    const path = mkdtempSync(join(tmpdir(), prefix));
    temporaryPaths.push(path);
    return path;
  }

  it('ne change pas le fournisseur par défaut sans CODEBUDDY_TTS_VOICE', () => {
    expect(resolveTtsEngine({})).toBe('pocket');
    expect(resolveTtsEngine({ CODEBUDDY_TTS_ENGINE: 'piper' })).toBe('piper');
    expect(
      resolveTtsEngine({
        CODEBUDDY_TTS_VOICE: 'elevenlabs:3fxbs2pB9bs8S6Z1N38A',
      })
    ).toBe('elevenlabs');
  });

  it('produit un WAV mono 24 kHz et incrémente le compteur du texte synthétisé', async () => {
    const home = temporaryDir('elevenlabs-success-');
    const output = join(home, 'speech.wav');
    const text = 'Bonjour Patrice';
    const fetchImpl = vi.fn(async () =>
      new Response(pcm24k(), {
        status: 200,
        headers: {
          'content-type': 'audio/pcm',
          'character-cost': String(text.length),
        },
      })
    );

    const ok = await synthesizeElevenLabsWav(
      text,
      output,
      {
        CODEBUDDY_HOME: home,
        CODEBUDDY_TTS_VOICE: 'elevenlabs:3fxbs2pB9bs8S6Z1N38A',
        ELEVENLABS_API_KEY: 'test-key',
      },
      100,
      undefined,
      undefined,
      { fetchImpl }
    );

    expect(ok).toBe(true);
    const wav = readFileSync(output);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(readUsage(home).characters).toBe(text.length);
    const requestUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('output_format=pcm_24000');
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      text,
      model_id: 'eleven_flash_v2_5',
    });
  });

  it('ne recompte pas une phrase servie par le cache avant tout appel réseau', async () => {
    const home = temporaryDir('elevenlabs-cache-');
    process.env.CODEBUDDY_HOME = home;
    process.env.CODEBUDDY_TTS_VOICE = 'elevenlabs:3fxbs2pB9bs8S6Z1N38A';
    process.env.ELEVENLABS_API_KEY = 'test-key';
    const fetchImpl = vi.fn(async () => new Response(pcm24k(), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    const synth = __voiceAudioPlayerTest.makeDefaultSynth(undefined, undefined, 'elevenlabs');
    const text =
      'Une phrase ElevenLabs assez longue pour dépasser le seuil historique du cache local.';

    const first = await synth(text);
    expect(readUsage(home).characters).toBe(text.length);
    const second = await synth(text);

    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cacheHarness.lookup).toHaveBeenCalledTimes(2);
    expect(cacheHarness.store).toHaveBeenCalledTimes(1);
    expect(readUsage(home).characters).toBe(text.length);
    unlinkSync(first);
  });

  it('au plafond, se replie sur Pocket et avertit une seule fois dans le mois', async () => {
    const home = temporaryDir('elevenlabs-cap-');
    const output1 = join(home, 'fallback-1.wav');
    const output2 = join(home, 'fallback-2.wav');
    const fetchImpl = fallbackFetch('unused');
    vi.stubGlobal('fetch', fetchImpl);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const env = {
      CODEBUDDY_HOME: home,
      CODEBUDDY_TTS_VOICE: 'elevenlabs:3fxbs2pB9bs8S6Z1N38A',
      CODEBUDDY_ELEVENLABS_MONTHLY_CAP: '0',
      CODEBUDDY_POCKET_SERVER: 'true',
      CODEBUDDY_POCKET_URL: 'http://127.0.0.1:8766',
      ELEVENLABS_API_KEY: 'test-key',
    };

    await expect(
      synthesizeElevenLabsWithFallbackWav('Bonjour', output1, env, 20, 100)
    ).resolves.toBe(true);
    await expect(
      synthesizeElevenLabsWithFallbackWav('Encore', output2, env, 20, 100)
    ).resolves.toBe(true);

    expect(readFileSync(output1).toString('ascii', 0, 4)).toBe('RIFF');
    expect(readUsage(home)).toMatchObject({ characters: 0, warned: true });
    expect(
      warn.mock.calls.filter(([message]) => String(message).includes('plafond mensuel'))
    ).toHaveLength(1);
    expect(
      fetchImpl.mock.calls.some(([input]) => String(input).includes('api.elevenlabs.io'))
    ).toBe(false);
  });

  it.each([
    { label: 'une erreur réseau', mode: 'network' as const, apiKey: 'test-key', timeout: 50 },
    { label: 'une erreur HTTP', mode: 'http' as const, apiKey: 'test-key', timeout: 50 },
    { label: 'un délai dépassé', mode: 'timeout' as const, apiKey: 'test-key', timeout: 5 },
    { label: 'une clé absente', mode: 'unused' as const, apiKey: undefined, timeout: 50 },
  ])('se replie sans exception après $label', async ({ mode, apiKey, timeout }) => {
    const home = temporaryDir('elevenlabs-failure-');
    const output = join(home, 'fallback.wav');
    const fetchImpl = fallbackFetch(mode);
    vi.stubGlobal('fetch', fetchImpl);
    const env: NodeJS.ProcessEnv = {
      CODEBUDDY_HOME: home,
      CODEBUDDY_TTS_VOICE: 'elevenlabs:3fxbs2pB9bs8S6Z1N38A',
      CODEBUDDY_POCKET_SERVER: 'true',
      CODEBUDDY_POCKET_URL: 'http://127.0.0.1:8766',
      ...(apiKey ? { ELEVENLABS_API_KEY: apiKey } : {}),
    };

    await expect(
      synthesizeElevenLabsWithFallbackWav('Lisa continue de parler.', output, env, timeout, 100)
    ).resolves.toBe(true);
    expect(readFileSync(output).toString('ascii', 0, 4)).toBe('RIFF');
  });

  it('remet le compteur à zéro au changement de mois', async () => {
    const home = temporaryDir('elevenlabs-month-');
    mkdirSync(home, { recursive: true });
    writeFileSync(
      usageFile(home),
      JSON.stringify({
        version: 1,
        month: '2026-06',
        characters: 199_999,
        warned: true,
        updatedAt: '2026-06-30T23:59:00.000Z',
      })
    );
    const output = join(home, 'july.wav');
    const text = 'Nouveau mois';

    const ok = await synthesizeElevenLabsWav(
      text,
      output,
      {
        CODEBUDDY_HOME: home,
        CODEBUDDY_TTS_VOICE: 'elevenlabs:3fxbs2pB9bs8S6Z1N38A',
        CODEBUDDY_ELEVENLABS_MONTHLY_CAP: '200000',
        ELEVENLABS_API_KEY: 'test-key',
      },
      100,
      undefined,
      undefined,
      {
        now: () => new Date('2026-07-01T00:00:00.000Z'),
        fetchImpl: vi.fn(async () => new Response(pcm24k(), { status: 200 })),
      }
    );

    expect(ok).toBe(true);
    expect(readUsage(home)).toMatchObject({
      month: '2026-07',
      characters: text.length,
      warned: false,
    });
  });
});
