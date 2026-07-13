import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openVoiceboxAudioStream,
  probeVoicebox,
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
    expect(resolveVoiceboxBaseUrl({ CODEBUDDY_VOICEBOX_URL: 'ftp://darkstar/voice' }))
      .toBe('http://127.0.0.1:17493');
    expect(resolveVoiceboxBaseUrl({ CODEBUDDY_VOICEBOX_URL: 'http://user:pass@darkstar:17493' }))
      .toBe('http://127.0.0.1:17493');
    expect(resolveVoiceboxBaseUrl({ CODEBUDDY_VOICEBOX_URL: 'http://darkstar:17493/' }))
      .toBe('http://darkstar:17493');
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
    expect(voiceboxReachabilityHint('http://100.73.222.64:17493')).toContain(
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
        CODEBUDDY_VOICEBOX_URL: 'http://darkstar:17493',
        CODEBUDDY_VOICEBOX_PROFILE: 'lisa',
        CODEBUDDY_VOICEBOX_PERSONALITY: 'true',
        CODEBUDDY_VOICEBOX_ENGINE: 'qwen',
        CODEBUDDY_VOICEBOX_LANGUAGE: 'fr',
      },
      { fetchImpl }
    );
    expect(stream).not.toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe('http://darkstar:17493/generate/stream');
    expect(requests[1]?.body).toMatchObject({
      profile_id: 'lisa-id',
      text: 'Bonjour Patrice.',
      language: 'fr',
      engine: 'qwen',
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
      expect(statSync(first).mode & 0o077).toBe(0);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
        CODEBUDDY_VOICEBOX_URL: 'http://100.73.222.64:17493',
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
