/**
 * narration — local/ElevenLabs voiceover synthesis + clip muxing.
 *
 * Pure: voice resolution and media argv builders. I/O: synthesize with injected
 * spawn/fetch, proving the fail-open contract (provider errors → local fallback
 * or null, never throws).
 */
import { copyFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

import {
  resolvePiperVoice,
  buildPiperArgs,
  buildElevenLabsWavArgs,
  buildMuxNarrationArgs,
  synthesizeNarration,
  synthesizeLocalizedNarration,
} from '../../../src/tools/video/narration.js';
import { logger } from '../../../src/utils/logger.js';

function makeSpawn(
  opts: { piperCode?: number; probeDur?: string; seen?: string[][] } = {}
): typeof spawn {
  return ((cmd: string, args: string[]) => {
    opts.seen?.push([cmd, ...args]);
    const child = new EventEmitter() as unknown as ReturnType<typeof spawn> & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: () => void; end: () => void };
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => undefined, end: () => undefined };
    child.kill = () => undefined;
    const isProbe = cmd.includes('ffprobe');
    const isFfmpeg = cmd.includes('ffmpeg');
    if (isFfmpeg) {
      const input = args[args.indexOf('-i') + 1]!;
      copyFileSync(input, args[args.length - 1]!);
    }
    setImmediate(() => {
      if (isProbe) {
        child.stdout.emit('data', Buffer.from(`${opts.probeDur ?? '4.20'}\n`));
        child.emit('close', 0);
      } else {
        child.emit('close', opts.piperCode ?? 0);
      }
    });
    return child;
  }) as unknown as typeof spawn;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolvePiperVoice', () => {
  it('reads CODEBUDDY_TTS_VOICE then CODEBUDDY_TTS_PIPER_MODEL, else null', () => {
    expect(resolvePiperVoice({ CODEBUDDY_TTS_VOICE: '/v.onnx' } as NodeJS.ProcessEnv)).toBe(
      '/v.onnx'
    );
    expect(resolvePiperVoice({ CODEBUDDY_TTS_PIPER_MODEL: '/m.onnx' } as NodeJS.ProcessEnv)).toBe(
      '/m.onnx'
    );
    expect(resolvePiperVoice({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('pure argv builders', () => {
  it('buildPiperArgs', () => {
    expect(buildPiperArgs('/voice.onnx', '/out.wav')).toEqual([
      '--model',
      '/voice.onnx',
      '--output_file',
      '/out.wav',
    ]);
  });

  it('buildElevenLabsWavArgs converts MP3 to 48 kHz stereo WAV', () => {
    expect(buildElevenLabsWavArgs('/tmp/input.mp3', '/tmp/output.wav')).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      '/tmp/input.mp3',
      '-ar',
      '48000',
      '-ac',
      '2',
      '/tmp/output.wav',
    ]);
  });

  it('buildMuxNarrationArgs delays + trims narration and copies video', () => {
    const args = buildMuxNarrationArgs('/clip.mp4', '/nar.wav', '/out.mp4', 7.4, 0.5);
    const s = args.join(' ');
    expect(s).toContain('adelay=500:all=1');
    expect(s).toContain('atrim=0:7.4');
    expect(s).toContain('-c:v copy');
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v', '-map', '[a]']));
    expect(args[args.length - 1]).toBe('/out.mp4');
  });
});

describe('synthesizeNarration (injected)', () => {
  const env = { CODEBUDDY_TTS_VOICE: '/voice.onnx' } as NodeJS.ProcessEnv;

  it('returns the path + probed duration on success', async () => {
    const seen: string[][] = [];
    const r = await synthesizeNarration('Bonjour le monde', '/tmp/n.wav', {
      spawn: makeSpawn({ probeDur: '4.20', seen }),
      env,
    });
    expect(r).toEqual({ path: '/tmp/n.wav', duration: 4.2 });
    // Piper was invoked with the resolved voice + output file.
    expect(seen.some((a) => a.includes('--model') && a.includes('/voice.onnx'))).toBe(true);
  });

  it('fail-open: empty text → null (no spawn)', async () => {
    expect(await synthesizeNarration('   ', '/tmp/n.wav', { spawn: makeSpawn(), env })).toBeNull();
  });

  it('fail-open: no configured voice → null', async () => {
    expect(
      await synthesizeNarration('hello', '/tmp/n.wav', {
        spawn: makeSpawn(),
        env: {} as NodeJS.ProcessEnv,
      })
    ).toBeNull();
  });

  it('fail-open: Piper error → null', async () => {
    expect(
      await synthesizeNarration('hello', '/tmp/n.wav', { spawn: makeSpawn({ piperCode: 1 }), env })
    ).toBeNull();
  });

  it('never selects paid ElevenLabs in auto mode', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await synthesizeNarration('Reste en local', '/tmp/n.wav', {
      fetchImpl: fetchMock,
      spawn: makeSpawn(),
      env: {
        ELEVENLABS_API_KEY: 'available-but-paid',
        CODEBUDDY_TTS_VOICE: '/voice.onnx',
      } as NodeJS.ProcessEnv,
    });

    expect(result).toEqual({ path: '/tmp/n.wav', duration: 4.2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('synthesizes with explicitly selected ElevenLabs and converts to WAV', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'narration-elevenlabs-'));
    try {
      const outputPath = join(temporary, 'narration.wav');
      const seen: string[][] = [];
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(Buffer.from('fake elevenlabs mp3'), { status: 200 }),
      );

      const result = await synthesizeNarration('Bonjour depuis ElevenLabs', outputPath, {
        provider: 'elevenlabs',
        elevenLabsVoiceId: 'explicit-voice',
        fetchImpl: fetchMock,
        spawn: makeSpawn({ seen }),
        env: {
          ELEVENLABS_API_KEY: 'direct-api-key',
          CODEBUDDY_ELEVENLABS_VOICE: 'ignored-env-voice',
        } as NodeJS.ProcessEnv,
      });

      expect(result).toEqual({
        path: outputPath,
        duration: 4.2,
        provider: 'elevenlabs',
      });
      expect(await readFile(outputPath, 'utf8')).toBe('fake elevenlabs mp3');
      expect(seen.some(([command]) => command?.includes('ffmpeg'))).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        'https://api.elevenlabs.io/v1/text-to-speech/explicit-voice',
      );
      expect(init?.headers).toMatchObject({
        'xi-api-key': 'direct-api-key',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        text: 'Bonjour depuis ElevenLabs',
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
        },
      });
    } finally {
      await rm(temporary, { recursive: true });
    }
  });

  it('falls back without throwing when the ElevenLabs key is absent', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'narration-elevenlabs-no-key-'));
    try {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const fetchMock = vi.fn<typeof fetch>();
      const result = await synthesizeNarration('Fallback local', '/tmp/n.wav', {
        provider: 'elevenlabs',
        fetchImpl: fetchMock,
        mediaEnvPath: join(temporary, 'missing-media.env'),
        spawn: makeSpawn(),
        env: { CODEBUDDY_TTS_VOICE: '/voice.onnx' } as NodeJS.ProcessEnv,
      });

      expect(result).toEqual({ path: '/tmp/n.wav', duration: 4.2 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ELEVENLABS_API_KEY'));
    } finally {
      await rm(temporary, { recursive: true });
    }
  });

  it('falls back to Piper and warns on an ElevenLabs HTTP 401', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('unauthorized', { status: 401 }),
    );

    const result = await synthesizeNarration('Fallback après 401', '/tmp/n.wav', {
      provider: 'elevenlabs',
      fetchImpl: fetchMock,
      spawn: makeSpawn(),
      env: {
        ELEVENLABS_API_KEY: 'rejected-key',
        CODEBUDDY_TTS_VOICE: '/voice.onnx',
      } as NodeJS.ProcessEnv,
    });

    expect(result).toEqual({ path: '/tmp/n.wav', duration: 4.2 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
  });

  it('loads the exact ElevenLabs key from a BOM/space-padded media.env line', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'narration-elevenlabs-env-'));
    try {
      const mediaEnvPath = join(temporary, 'media.env');
      const outputPath = join(temporary, 'narration.mp3');
      await writeFile(
        mediaEnvPath,
        '\uFEFFELEVEN_VOICE_FR=wrong-prefix\n  ELEVENLABS_API_KEY = \uFEFFfile-api-key  \n',
      );
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(Buffer.from('mp3 from env key'), { status: 200 }),
      );

      const result = await synthesizeNarration('Clé depuis le fichier', outputPath, {
        fetchImpl: fetchMock,
        mediaEnvPath,
        spawn: makeSpawn({ probeDur: '1.25' }),
        env: {
          CODEBUDDY_TTS_ENGINE: 'elevenlabs',
          CODEBUDDY_ELEVENLABS_VOICE: 'env-voice',
        } as NodeJS.ProcessEnv,
      });

      expect(result).toEqual({
        path: outputPath,
        duration: 1.25,
        provider: 'elevenlabs',
      });
      expect(await readFile(outputPath, 'utf8')).toBe('mp3 from env key');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/env-voice',
        expect.objectContaining({
          headers: expect.objectContaining({ 'xi-api-key': 'file-api-key' }),
        }),
      );
    } finally {
      await rm(temporary, { recursive: true });
    }
  });
});

describe('synthesizeLocalizedNarration', () => {
  it('uses an explicit Piper profile instead of the global environment voice', async () => {
    const seen: string[][] = [];
    const result = await synthesizeLocalizedNarration(
      {
        text: 'Hello',
        outputPath: '/tmp/localized.wav',
        locale: 'en-us',
        voiceProfileId: 'lisa-en-v1',
        fallbackPolicy: 'none',
      },
      {
        spawn: makeSpawn({ seen }),
        env: { CODEBUDDY_TTS_VOICE: '/wrong-global.onnx' } as NodeJS.ProcessEnv,
        resolveVoiceProfile: async () => ({
          id: 'lisa-en-v1',
          locale: 'en-US',
          provider: 'piper',
          modelPath: '/approved/lisa-en.onnx',
          commercialUseApproved: true,
          provenanceRef: 'voice-rights/lisa-en-v1',
        }),
      },
    );
    expect(result).toMatchObject({
      locale: 'en-US',
      voiceProfileId: 'lisa-en-v1',
      provider: 'piper',
    });
    expect(seen.some((args) => args.includes('/approved/lisa-en.onnx'))).toBe(true);
    expect(seen.some((args) => args.includes('/wrong-global.onnx'))).toBe(false);
  });

  it('passes the approved voice and language to Pocket', async () => {
    const seen: unknown[] = [];
    const result = await synthesizeLocalizedNarration(
      {
        text: 'Bonjour',
        outputPath: '/tmp/pocket-localized.wav',
        locale: 'fr-FR',
        voiceProfileId: 'lisa-fr-v1',
        fallbackPolicy: 'none',
      },
      {
        spawn: makeSpawn(),
        resolveVoiceProfile: async () => ({
          id: 'lisa-fr-v1',
          locale: 'fr-FR',
          provider: 'pocket',
          voice: 'estelle',
          language: 'french',
          highQuality: true,
          commercialUseApproved: true,
          provenanceRef: 'voice-rights/lisa-fr-v1',
        }),
        pocketSynthesize: async (text, options) => {
          seen.push(text, options);
          return Buffer.from('fake wav');
        },
      },
    );
    expect(seen).toEqual([
      'Bonjour',
      { voice: 'estelle', language: 'french', highQuality: true },
    ]);
    expect(result).toMatchObject({ locale: 'fr-FR', provider: 'pocket' });
  });

  it('fails closed for mismatched locale, missing rights or missing profile', async () => {
    const request = {
      text: 'Hello',
      outputPath: '/tmp/no.wav',
      locale: 'en-US',
      voiceProfileId: 'voice-v1',
      fallbackPolicy: 'none' as const,
    };
    expect(
      await synthesizeLocalizedNarration(request, {
        resolveVoiceProfile: async () => ({
          id: 'voice-v1',
          locale: 'fr-FR',
          provider: 'piper',
          modelPath: '/voice.onnx',
          commercialUseApproved: true,
          provenanceRef: 'rights/voice-v1',
        }),
      }),
    ).toBeNull();
    expect(
      await synthesizeLocalizedNarration(request, {
        resolveVoiceProfile: async () => ({
          id: 'voice-v1',
          locale: 'en-US',
          provider: 'piper',
          modelPath: '/voice.onnx',
          commercialUseApproved: false,
          provenanceRef: '',
        }),
      }),
    ).toBeNull();
    expect(await synthesizeLocalizedNarration(request)).toBeNull();
  });
});
