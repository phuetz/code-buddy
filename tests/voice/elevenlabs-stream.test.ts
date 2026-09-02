/**
 * Native ElevenLabs audio streaming — the fluidity path for Lisa's resident voice.
 *
 * Covers the three layers added for it:
 *   1. `requestElevenLabsSpeechStream` — the `/stream` HTTP request shape;
 *   2. `openElevenLabsPcm24kStream` — the monthly-character-budget contract
 *      around the stream (reserve → commit on 200 / release on failure);
 *   3. `wrapPcm16Mono24kStreamAsWav` — the streaming WAV header that makes the
 *      raw `pcm_24000` body acceptable to the WAV-only playback chain, plus the
 *      complete-PCM writeback hook used to cache the paid clip.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestElevenLabsSpeechStream } from '../../src/talk-mode/providers/elevenlabs-client.js';
import {
  openElevenLabsPcm24kStream,
  resetElevenLabsVoiceState,
} from '../../src/voice/elevenlabs-voice.js';
import {
  pcm16Mono24kStreamWavHeader,
  wrapPcm16Mono24kStreamAsWav,
} from '../../src/voice/local-tts.js';
import { probePcm16Wav } from '../../src/voice/tts-volume.js';

function pcmChunks(): Buffer[] {
  const first = Buffer.alloc(120);
  const second = Buffer.alloc(200);
  for (let offset = 0; offset < first.length; offset += 2) first.writeInt16LE(1_500, offset);
  for (let offset = 0; offset < second.length; offset += 2) second.writeInt16LE(-900, offset);
  return [first, second];
}

function bodyOf(...chunks: Buffer[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const parts: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

describe('requestElevenLabsSpeechStream', () => {
  it('POSTs to the /stream endpoint with the requested output format and returns the body', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(bodyOf(...pcmChunks()), { status: 200 })
    );
    const result = await requestElevenLabsSpeechStream({
      apiKey: 'test-key',
      voiceId: 'voice-1',
      text: 'Bonjour Patrice.',
      modelId: 'eleven_flash_v2_5',
      outputFormat: 'pcm_24000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain('/v1/text-to-speech/voice-1/stream');
    expect(url).toContain('output_format=pcm_24000');
    const total = await readAll(result.body);
    expect(total.length).toBe(320);
  });

  it('throws on a non-2xx status without exposing the response body', async () => {
    const fetchImpl = vi.fn(async () => new Response('secret detail', { status: 429 }));
    await expect(
      requestElevenLabsSpeechStream({
        apiKey: 'test-key',
        voiceId: 'voice-1',
        text: 'Bonjour.',
        modelId: 'eleven_flash_v2_5',
        outputFormat: 'pcm_24000',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/HTTP 429/);
  });
});

describe('openElevenLabsPcm24kStream — budget contract', () => {
  let home: string;
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    ELEVENLABS_API_KEY: 'test-key',
    CODEBUDDY_HOME: home,
    ...extra,
  });
  const usagePath = (): string => join(home, 'elevenlabs-voice-usage.json');

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cb-eleven-stream-'));
    resetElevenLabsVoiceState();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    resetElevenLabsVoiceState();
  });

  it('returns null without a key and never touches the network', async () => {
    const fetchImpl = vi.fn();
    const stream = await openElevenLabsPcm24kStream(
      'Bonjour.',
      'voice-1',
      { CODEBUDDY_HOME: home },
      undefined,
      { fetchImpl: fetchImpl as unknown as typeof fetch, usagePath: usagePath() }
    );
    expect(stream).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('commits the character count once the request is accepted', async () => {
    const fetchImpl = vi.fn(async () => new Response(bodyOf(...pcmChunks()), { status: 200 }));
    const text = 'Bonjour Patrice, il fait beau.';
    const stream = await openElevenLabsPcm24kStream(
      text,
      'voice-1',
      env(),
      undefined,
      { fetchImpl: fetchImpl as unknown as typeof fetch, usagePath: usagePath() }
    );
    expect(stream).not.toBeNull();
    const { readFileSync } = await import('node:fs');
    const usage = JSON.parse(readFileSync(usagePath(), 'utf8')) as { characters: number };
    expect(usage.characters).toBe(text.length);
  });

  it('releases the reservation on an HTTP failure — nothing is charged locally', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const stream = await openElevenLabsPcm24kStream(
      'Bonjour.',
      'voice-1',
      env(),
      undefined,
      { fetchImpl: fetchImpl as unknown as typeof fetch, usagePath: usagePath() }
    );
    expect(stream).toBeNull();
    const { readFileSync } = await import('node:fs');
    const usage = JSON.parse(readFileSync(usagePath(), 'utf8')) as { characters: number };
    expect(usage.characters).toBe(0);
  });

  it('refuses to open a stream that would exceed the monthly cap', async () => {
    const fetchImpl = vi.fn();
    const stream = await openElevenLabsPcm24kStream(
      'Une phrase assez longue pour dépasser le petit plafond.',
      'voice-1',
      env({ CODEBUDDY_ELEVENLABS_MONTHLY_CAP: '10' }),
      undefined,
      { fetchImpl: fetchImpl as unknown as typeof fetch, usagePath: usagePath() }
    );
    expect(stream).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('wrapPcm16Mono24kStreamAsWav — streaming WAV header + writeback', () => {
  it('produces a header the playback chain probes as ready PCM16 mono 24 kHz', () => {
    const header = pcm16Mono24kStreamWavHeader();
    const probe = probePcm16Wav(header);
    expect(probe.status).toBe('ready');
    if (probe.status === 'ready') {
      expect(probe.layout.dataOffset).toBe(44);
      expect(probe.layout.sampleRate).toBe(24_000);
      expect(probe.layout.blockAlign).toBe(2);
    }
  });

  it('prepends exactly one header and hands the FULL PCM to onComplete on clean end', async () => {
    const chunks = pcmChunks();
    const onComplete = vi.fn();
    const wrapped = wrapPcm16Mono24kStreamAsWav(bodyOf(...chunks), onComplete);
    const total = await readAll(wrapped);

    expect(total.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(total.length).toBe(44 + 320);
    expect(total.indexOf('RIFF', 4)).toBe(-1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![0]).toEqual(Buffer.concat(chunks));
  });

  it('never calls onComplete when the consumer cancels mid-stream (barge-in)', async () => {
    const onComplete = vi.fn();
    let pushed = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pushed += 1;
        controller.enqueue(new Uint8Array(64));
        if (pushed > 10) controller.close();
      },
    });
    const wrapped = wrapPcm16Mono24kStreamAsWav(endless, onComplete);
    const reader = wrapped.getReader();
    await reader.read();
    await reader.cancel();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('skips the writeback (but keeps streaming) when the clip exceeds the capture bound', async () => {
    const onComplete = vi.fn();
    const big = Buffer.alloc(512);
    const wrapped = wrapPcm16Mono24kStreamAsWav(bodyOf(big, big), onComplete, 600);
    const total = await readAll(wrapped);
    expect(total.length).toBe(44 + 1024);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
