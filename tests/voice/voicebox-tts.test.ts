import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createVoiceboxClone,
  createVoiceboxPresetProfile,
  deleteVoiceboxProfile,
  manageVoiceboxModel,
  openVoiceboxAudioStream,
  probeVoicebox,
  probeVoiceboxStudio,
  resetVoiceboxProfileCache,
  resolveVoiceboxBaseUrl,
  resolveVoiceboxConfig,
  synthesizeVoiceboxWav,
  voiceboxReachabilityHint,
} from '../../src/voice/voicebox-tts.js';

function pcm16Wav(): Buffer {
  const wav = Buffer.alloc(48);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(40, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(4, 40);
  wav.writeInt16LE(1000, 44);
  wav.writeInt16LE(-1000, 46);
  return wav;
}

afterEach(() => resetVoiceboxProfileCache());

describe('Voicebox config', () => {
  it('uses safe defaults and rejects credential-bearing endpoint URLs', () => {
    expect(resolveVoiceboxBaseUrl({ CODEBUDDY_VOICEBOX_URL: 'ftp://gpuNode/voice' }))
      .toBe('http://127.0.0.1:17493');
    expect(resolveVoiceboxBaseUrl({ CODEBUDDY_VOICEBOX_URL: 'http://user:pass@gpuNode:17493' }))
      .toBe('http://127.0.0.1:17493');
    expect(resolveVoiceboxBaseUrl({ CODEBUDDY_VOICEBOX_URL: 'http://gpuNode:17493/' }))
      .toBe('http://gpuNode:17493');
  });

  it('bounds delivery instructions and validates renderer enums', () => {
    const config = resolveVoiceboxConfig({
      CODEBUDDY_VOICEBOX_PROFILE: 'Lisa',
      CODEBUDDY_VOICEBOX_ENGINE: 'unknown',
      CODEBUDDY_VOICEBOX_MODEL_SIZE: 'huge',
      CODEBUDDY_VOICEBOX_INSTRUCT: 'x'.repeat(800),
    });
    expect(config.profile).toBe('Lisa');
    expect(config.engine).toBe('qwen');
    expect(config.modelSize).toBe('1.7B');
    expect(config.instruct).toHaveLength(500);
  });

  it('explains the loopback-only default only for remote endpoints', () => {
    expect(voiceboxReachabilityHint('http://127.0.0.1:17493')).toBeUndefined();
    expect(voiceboxReachabilityHint('http://192.0.2.42:17493')).toContain(
      'tailscale serve --bg --tcp=17493'
    );
  });
});

describe('Voicebox synthesis', () => {
  it('resolves a profile by name and never enables Voicebox personality rewriting', async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/profiles')) {
        requests.push({ url });
        return new Response(JSON.stringify([{ id: 'lisa-id', name: 'Lisa', language: 'fr' }]), {
          headers: { 'content-type': 'application/json' },
        });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      return new Response(pcm16Wav(), { headers: { 'content-type': 'audio/wav' } });
    });
    const stream = await openVoiceboxAudioStream(
      'Bonjour Patrice.',
      {
        CODEBUDDY_VOICEBOX_URL: 'http://gpuNode:17493',
        CODEBUDDY_VOICEBOX_PROFILE: 'lisa',
        CODEBUDDY_VOICEBOX_PERSONALITY: 'true',
        CODEBUDDY_VOICEBOX_ENGINE: 'qwen',
        CODEBUDDY_VOICEBOX_LANGUAGE: 'fr',
        CODEBUDDY_VOICEBOX_INSTRUCT: 'Keep the established warm tone.',
      },
      { fetchImpl, instruct: 'Speak at about 118 words per minute.' }
    );
    expect(stream).not.toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe('http://gpuNode:17493/generate/stream');
    expect(requests[1]?.body).toMatchObject({
      profile_id: 'lisa-id',
      text: 'Bonjour Patrice.',
      language: 'fr',
      engine: 'qwen',
      instruct: 'Speak at about 118 words per minute. Keep the established warm tone.',
      personality: false,
      normalize: true,
    });
  });

  it('writes a bounded private WAV and reuses the cached profile lookup', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/profiles')) {
        return new Response(JSON.stringify([{ id: 'p1', name: 'Lisa' }]), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(pcm16Wav(), { headers: { 'content-type': 'audio/wav' } });
    });
    const dir = mkdtempSync(join(tmpdir(), 'voicebox-test-'));
    const env = { CODEBUDDY_VOICEBOX_PROFILE: 'Lisa' };
    try {
      const first = join(dir, 'first.wav');
      const second = join(dir, 'second.wav');
      expect(await synthesizeVoiceboxWav('Première phrase.', first, env, { fetchImpl })).toBe(true);
      expect(await synthesizeVoiceboxWav('Deuxième phrase.', second, env, { fetchImpl })).toBe(true);
      expect(readFileSync(first).subarray(0, 4).toString('ascii')).toBe('RIFF');
      // POSIX mode bits only: Windows reports 0o666 whatever the chmod.
      if (process.platform !== 'win32') {
        expect(statSync(first).mode & 0o077).toBe(0);
      }
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('fails closed before generation when the configured profile does not exist', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ id: 'p1', name: 'Alice' }]), {
      headers: { 'content-type': 'application/json' },
    }));
    const stream = await openVoiceboxAudioStream(
      'Bonjour.',
      { CODEBUDDY_VOICEBOX_PROFILE: 'Lisa' },
      { fetchImpl }
    );
    expect(stream).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports endpoint reachability separately from profile selection', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { id: 'p1', name: 'Lisa', language: 'fr' },
      { id: 'p2', name: 'Narratrice', language: 'fr' },
    ]), { headers: { 'content-type': 'application/json' } }));
    const report = await probeVoicebox(
      { CODEBUDDY_VOICEBOX_PROFILE: 'Lisa' },
      { fetchImpl }
    );
    expect(report.available).toBe(true);
    expect(report.resolvedProfile?.id).toBe('p1');
    expect(report.profiles).toHaveLength(2);
  });

  it('returns an actionable remote binding hint when the endpoint is unreachable', async () => {
    const report = await probeVoicebox(
      {
        CODEBUDDY_VOICEBOX_URL: 'http://192.0.2.42:17493',
        CODEBUDDY_VOICEBOX_PROFILE: 'Lisa',
      },
      { fetchImpl: vi.fn(async () => { throw new Error('connect timeout'); }) }
    );
    expect(report).toMatchObject({
      available: false,
      error: 'connect timeout',
      hint: expect.stringContaining('127.0.0.1:17493/health'),
    });
  });
});

describe('Voicebox studio administration', () => {
  it('creates a consented clone with one sample and preserves renderer ownership of personality', async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body });
      if (method === 'POST' && url.endsWith('/profiles')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          name: 'Lisa',
          language: 'fr',
          voice_type: 'cloned',
          default_engine: 'qwen',
        });
        expect(body).not.toHaveProperty('personality');
        return new Response(JSON.stringify({ id: 'lisa-id', name: 'Lisa', language: 'fr' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'POST' && url.endsWith('/profiles/lisa-id/samples')) {
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.get('reference_text')).toBe('Bonjour, je suis Lisa.');
        expect((form.get('file') as File).name).toBe('lisa.webm');
        return new Response(JSON.stringify({
          id: 'sample-id',
          profile_id: 'lisa-id',
          audio_path: '/profiles/lisa-id/lisa.webm',
          reference_text: 'Bonjour, je suis Lisa.',
        }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    await expect(createVoiceboxClone({
      name: ' Lisa ',
      language: 'fr',
      referenceText: ' Bonjour, je suis Lisa. ',
      filename: 'lisa.webm',
      audio: new Uint8Array([1, 2, 3]),
      consent: true,
    }, {}, { fetchImpl })).resolves.toMatchObject({
      profile: { id: 'lisa-id' },
      sample: { id: 'sample-id' },
    });
    expect(requests).toHaveLength(2);
  });

  it('requires explicit authorization and rolls back a half-created profile', async () => {
    await expect(createVoiceboxClone({
      name: 'Lisa',
      language: 'fr',
      referenceText: 'Bonjour.',
      filename: 'lisa.wav',
      audio: new Uint8Array([1]),
      consent: false,
    })).rejects.toThrow('Explicit authorization');

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/profiles')) {
        return new Response(JSON.stringify({ id: 'orphan', name: 'Lisa' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ detail: 'sample rejected' }), { status: 400 });
      }
      if (init?.method === 'DELETE') return new Response('{}');
      throw new Error('unexpected request');
    });
    await expect(createVoiceboxClone({
      name: 'Lisa',
      language: 'fr',
      referenceText: 'Bonjour.',
      filename: 'lisa.wav',
      audio: new Uint8Array([1]),
      consent: true,
    }, {}, { fetchImpl })).rejects.toThrow('sample rejected');
    expect(fetchImpl).toHaveBeenLastCalledWith(
      new URL('http://127.0.0.1:17493/profiles/orphan'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('inventories health, profiles, models, and all advertised languages in parallel', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/profiles')) return new Response(JSON.stringify([
        { id: 'lisa', name: 'Lisa', language: 'fr', sample_count: 2 },
      ]));
      if (url.endsWith('/health')) return new Response(JSON.stringify({
        status: 'healthy', model_loaded: true, gpu_available: true, gpu_type: 'CUDA',
      }));
      if (url.endsWith('/models/status')) return new Response(JSON.stringify({ models: [
        { model_name: 'qwen-1.7b', display_name: 'Qwen 1.7B', downloaded: true, loaded: true },
      ] }));
      if (url.endsWith('/profiles/presets/kokoro')) return new Response(JSON.stringify({ voices: [
        { voice_id: 'ff_siwis', name: 'Siwis', gender: 'female', language: 'fr' },
      ] }));
      if (url.endsWith('/profiles/presets/qwen_custom_voice')) return new Response(JSON.stringify({ voices: [
        { voice_id: 'Serena', name: 'Serena', gender: 'female', language: 'zh' },
      ] }));
      throw new Error('unexpected request');
    });
    const report = await probeVoiceboxStudio(
      { CODEBUDDY_VOICEBOX_PROFILE: 'Lisa' },
      { fetchImpl }
    );
    expect(report.available).toBe(true);
    expect(report.health?.gpu_type).toBe('CUDA');
    expect(report.models[0]?.loaded).toBe(true);
    expect(report.presetVoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ voice_id: 'ff_siwis', engine: 'kokoro' }),
    ]));
    expect(report.languages).toHaveLength(23);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('requires confirmation before destructive profile deletion', async () => {
    await expect(deleteVoiceboxProfile('lisa', false)).rejects.toThrow('explicit confirmation');
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await deleteVoiceboxProfile('lisa', true, {}, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:17493/profiles/lisa'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('creates a functional preset voice without a sample or personality rewrite', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        name: 'Lisa Siwis',
        language: 'fr',
        voice_type: 'preset',
        default_engine: 'kokoro',
        preset_engine: 'kokoro',
        preset_voice_id: 'ff_siwis',
      });
      expect(body).not.toHaveProperty('personality');
      return new Response(JSON.stringify({
        id: 'preset-lisa',
        name: 'Lisa Siwis',
        voice_type: 'preset',
        language: 'fr',
      }), { headers: { 'content-type': 'application/json' } });
    });

    await expect(createVoiceboxPresetProfile({
      name: ' Lisa Siwis ',
      language: 'fr',
      engine: 'kokoro',
      voiceId: 'ff_siwis',
    }, {}, { fetchImpl })).resolves.toMatchObject({ id: 'preset-lisa' });
  });

  it('administers model lifecycle with confirmation on deletion', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'ok' }), {
      headers: { 'content-type': 'application/json' },
    }));
    await manageVoiceboxModel('qwen-tts-1.7B', 'download', false, {}, { fetchImpl });
    expect(fetchImpl).toHaveBeenLastCalledWith(
      new URL('http://127.0.0.1:17493/models/download'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model_name: 'qwen-tts-1.7B' }),
      })
    );
    await manageVoiceboxModel('qwen-tts-1.7B', 'unload', false, {}, { fetchImpl });
    expect(fetchImpl).toHaveBeenLastCalledWith(
      new URL('http://127.0.0.1:17493/models/qwen-tts-1.7B/unload'),
      expect.objectContaining({ method: 'POST' })
    );
    await expect(manageVoiceboxModel('qwen-tts-1.7B', 'delete')).rejects.toThrow(
      'explicit confirmation'
    );
  });
});
