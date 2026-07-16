import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  __test,
  normalizePcm16Wav,
  normalizeWavFile,
  Pcm16WavStreamGain,
  resolveStreamGainDb,
  resolveTtsVolumePercent,
} from '../../src/voice/tts-volume.js';

function chunk(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, payload.length & 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function pcm16Wav(samples: number[], withOddJunk = false): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(24_000, 4);
  fmt.writeUInt32LE(48_000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  const body = Buffer.concat([
    chunk('fmt ', fmt),
    ...(withOddJunk ? [chunk('JUNK', Buffer.from([1, 2, 3]))] : []),
    chunk('data', pcm),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 4, 'ascii');
  return Buffer.concat([header, body]);
}

function samplesFrom(wav: Buffer): number[] {
  const marker = wav.indexOf(Buffer.from('data'));
  const offset = marker + 8;
  const samples: number[] = [];
  for (let index = offset; index + 1 < wav.length; index += 2) {
    samples.push(wav.readInt16LE(index));
  }
  return samples;
}

describe('assistant TTS volume', () => {
  it('defaults to 100 and preserves an explicit bounded preference', () => {
    expect(resolveTtsVolumePercent({})).toBe(100);
    expect(resolveTtsVolumePercent({ CODEBUDDY_TTS_VOLUME: '35' })).toBe(35);
    expect(resolveTtsVolumePercent({ CODEBUDDY_TTS_VOLUME: '0' })).toBe(0);
    expect(resolveTtsVolumePercent({ CODEBUDDY_TTS_VOLUME: '140' })).toBe(100);
    expect(resolveTtsVolumePercent({ CODEBUDDY_TTS_VOLUME: 'invalid' })).toBe(100);
    expect(resolveStreamGainDb({})).toBe(0);
  });

  it('normalizes a quiet Pocket PCM16 WAV near -1 dBFS and is byte-idempotent', () => {
    const source = pcm16Wav([0, 4_000, -8_000, 12_000, -12_000], true);
    const once = normalizePcm16Wav(source, {});
    const twice = normalizePcm16Wav(once, {});
    const peak = Math.max(...samplesFrom(once).map(Math.abs));

    expect(peak).toBeGreaterThan(__test.targetPeak * 0.94);
    expect(peak).toBeLessThanOrEqual(__test.targetPeak);
    expect(twice.equals(once)).toBe(true);
    expect(once.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('honors a lower explicit assistant volume and mute', () => {
    const source = pcm16Wav([10_000, -10_000]);
    const half = normalizePcm16Wav(source, { CODEBUDDY_TTS_VOLUME: '50' });
    const muted = normalizePcm16Wav(source, { CODEBUDDY_TTS_VOLUME: '0' });
    const halfPeak = Math.max(...samplesFrom(half).map(Math.abs));

    expect(halfPeak).toBeGreaterThan(__test.targetPeak * 0.47);
    expect(halfPeak).toBeLessThanOrEqual(__test.targetPeak * 0.5);
    expect(samplesFrom(muted)).toEqual([0, 0]);
  });

  it('fails open without changing malformed or unsupported bytes', () => {
    const malformed = Buffer.from('not a wav');
    expect(normalizePcm16Wav(malformed).equals(malformed)).toBe(true);

    const unsupported = pcm16Wav([1, 2]);
    unsupported.writeUInt16LE(8, 34);
    expect(normalizePcm16Wav(unsupported).equals(unsupported)).toBe(true);
  });

  it('migrates a quiet legacy cache file once without rewriting it repeatedly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tts-volume-'));
    const file = join(dir, 'legacy.wav');
    try {
      writeFileSync(file, pcm16Wav([500, -5_000, 10_000]));
      expect(await normalizeWavFile(file, {})).toBe(true);
      const once = readFileSync(file);
      expect(await normalizeWavFile(file, {})).toBe(true);
      const twice = readFileSync(file);
      expect(twice.equals(once)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('amplifies streaming PCM across split headers and odd sample boundaries', () => {
    const source = pcm16Wav([1_000, -2_000, 20_000, -20_000], true);
    const processor = new Pcm16WavStreamGain({
      CODEBUDDY_TTS_VOLUME: '100',
      CODEBUDDY_TTS_STREAM_GAIN_DB: '8',
    });
    const pieces: Buffer[] = [];
    const splitSizes = [1, 11, 17, 20, 3, 5, 2, 99];
    let offset = 0;
    for (const size of splitSizes) {
      if (offset >= source.length) break;
      pieces.push(...processor.push(source.subarray(offset, Math.min(source.length, offset + size))));
      offset += size;
    }
    if (offset < source.length) pieces.push(...processor.push(source.subarray(offset)));
    pieces.push(...processor.flush());

    const output = Buffer.concat(pieces);
    const transformed = samplesFrom(output);
    expect(output.length).toBe(source.length);
    expect(output.subarray(0, output.indexOf(Buffer.from('data')) + 8))
      .toEqual(source.subarray(0, source.indexOf(Buffer.from('data')) + 8));
    expect(transformed[0]).toBeGreaterThan(2_400);
    expect(transformed[1]).toBeLessThan(-4_800);
    expect(Math.max(...transformed.map(Math.abs))).toBeLessThanOrEqual(__test.targetPeak);
  });

  it('leaves streaming PCM byte-for-byte unchanged at the default unit gain', () => {
    const source = pcm16Wav([1_000, -2_000, 20_000, -20_000], true);
    const processor = new Pcm16WavStreamGain({});
    const output = Buffer.concat([
      ...processor.push(source.subarray(0, 47)),
      ...processor.push(source.subarray(47)),
      ...processor.flush(),
    ]);

    expect(output.equals(source)).toBe(true);
  });

  it('streams unsupported input byte-for-byte', () => {
    const source = Buffer.from('plain audio bytes that are not RIFF');
    const processor = new Pcm16WavStreamGain({});
    const output = Buffer.concat([
      ...processor.push(source.subarray(0, 5)),
      ...processor.push(source.subarray(5)),
      ...processor.flush(),
    ]);
    expect(output.equals(source)).toBe(true);
  });
});
