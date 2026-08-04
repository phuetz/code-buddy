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
  resolveStreamHeadMs,
  resolveTargetRmsDbfs,
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

function rms(samples: number[]): number {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

function gatedRms(samples: number[]): number {
  const gate = 32_767 * 10 ** (__test.rmsGateDbfs / 20);
  return rms(samples.filter((sample) => Math.abs(sample) >= gate));
}

function pcmPayload(samples: number[]): Buffer {
  const payload = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => payload.writeInt16LE(sample, index * 2));
  return payload;
}

function levelDifferenceDb(left: number, right: number): number {
  return Math.abs(20 * Math.log10(left / right));
}

function streamWav(source: Buffer, env: NodeJS.ProcessEnv = {}): Buffer {
  const processor = new Pcm16WavStreamGain(env);
  const pieces: Buffer[] = [];
  const splitSizes = [1, 11, 17, 20, 3, 5, 2, 701, 997, 2_003];
  let offset = 0;
  for (const size of splitSizes) {
    if (offset >= source.length) break;
    pieces.push(...processor.push(source.subarray(offset, Math.min(source.length, offset + size))));
    offset += size;
  }
  if (offset < source.length) pieces.push(...processor.push(source.subarray(offset)));
  pieces.push(...processor.flush());
  return Buffer.concat(pieces);
}

describe('assistant TTS volume', () => {
  it('defaults to 100 and preserves an explicit bounded preference', () => {
    expect(resolveTtsVolumePercent({})).toBe(100);
    expect(resolveTtsVolumePercent({ CODEBUDDY_TTS_VOLUME: '35' })).toBe(35);
    expect(resolveTtsVolumePercent({ CODEBUDDY_TTS_VOLUME: '0' })).toBe(0);
    expect(resolveTtsVolumePercent({ CODEBUDDY_TTS_VOLUME: '140' })).toBe(100);
    expect(resolveTtsVolumePercent({ CODEBUDDY_TTS_VOLUME: 'invalid' })).toBe(100);
    expect(resolveStreamGainDb({})).toBe(0);
    expect(resolveStreamHeadMs({})).toBe(400);
    expect(resolveStreamHeadMs({ CODEBUDDY_TTS_STREAM_HEAD_MS: '650' })).toBe(650);
    expect(resolveTargetRmsDbfs({})).toBe(-18);
    expect(resolveTargetRmsDbfs({ CODEBUDDY_TTS_TARGET_RMS: '-20' })).toBe(-20);
    expect(resolveTargetRmsDbfs({ CODEBUDDY_TTS_TARGET_RMS: 'invalid' })).toBe(-18);
  });

  it('normalizes a Pocket PCM16 WAV to the shared RMS target and is byte-idempotent', () => {
    const source = pcm16Wav([0, 4_000, -8_000, 12_000, -12_000], true);
    const once = normalizePcm16Wav(source, {});
    const twice = normalizePcm16Wav(once, {});
    const outputRms = gatedRms(samplesFrom(once));

    expect(levelDifferenceDb(outputRms, __test.targetRms)).toBeLessThan(0.1);
    expect(twice.equals(once)).toBe(true);
    expect(once.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('honors a lower explicit assistant volume and mute', () => {
    const source = pcm16Wav([10_000, -10_000]);
    const half = normalizePcm16Wav(source, { CODEBUDDY_TTS_VOLUME: '50' });
    const muted = normalizePcm16Wav(source, { CODEBUDDY_TTS_VOLUME: '0' });
    const halfRms = rms(samplesFrom(half));

    expect(levelDifferenceDb(halfRms, __test.targetRms * 0.5)).toBeLessThan(0.1);
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

  it('normalizes streaming PCM across split headers and odd sample boundaries', () => {
    const pattern = [1_000, -2_000, 5_000, -5_000];
    const source = pcm16Wav(
      Array.from({ length: 3_001 }, (_, index) => pattern[index % pattern.length]!),
      true,
    );
    const env = {
      CODEBUDDY_TTS_VOLUME: '100',
      CODEBUDDY_TTS_STREAM_GAIN_DB: '8',
    };
    const output = streamWav(source, env);
    const transformed = samplesFrom(output);
    expect(output.length).toBe(source.length);
    expect(output.subarray(0, output.indexOf(Buffer.from('data')) + 8))
      .toEqual(source.subarray(0, source.indexOf(Buffer.from('data')) + 8));
    expect(levelDifferenceDb(rms(transformed), __test.targetRms * 10 ** (8 / 20)))
      .toBeLessThan(0.2);
    expect(Math.max(...transformed.map(Math.abs))).toBeLessThanOrEqual(32_767);
  });

  it('aligns cache, streaming, and blocking PCM levels within one decibel', async () => {
    const pattern = [0, 1_000, -2_000, 3_000, -3_000];
    const samples = Array.from(
      { length: 3_000 },
      (_, index) => pattern[index % pattern.length]!,
    );
    const source = pcm16Wav(samples);
    const cache = normalizePcm16Wav(source, {});
    const streaming = streamWav(source);
    const dir = mkdtempSync(join(tmpdir(), 'tts-level-'));
    const blockingPath = join(dir, 'blocking.wav');
    writeFileSync(blockingPath, source);
    expect(await normalizeWavFile(blockingPath, {})).toBe(true);
    const blocking = readFileSync(blockingPath);
    rmSync(dir, { recursive: true, force: true });

    const levels = [cache, streaming, blocking].map((wav) => {
      const samples = samplesFrom(wav);
      return {
        peak: Math.max(...samples.map(Math.abs)),
        rms: rms(samples),
      };
    });
    expect(levelDifferenceDb(levels[0]!.rms, levels[1]!.rms)).toBeLessThan(1);
    expect(levelDifferenceDb(levels[0]!.rms, levels[2]!.rms)).toBeLessThan(1);
    expect(levelDifferenceDb(levels[0]!.peak, levels[1]!.peak)).toBeLessThan(1);
    expect(levelDifferenceDb(levels[0]!.peak, levels[2]!.peak)).toBeLessThan(1);
  });

  it('normalizes different native streaming levels without amplifying silence or noise', () => {
    const shape = [0, 1_000, -2_000, 3_000, -3_000];
    const quiet = pcm16Wav(Array.from({ length: 3_000 }, (_, index) => shape[index % 5]!));
    const loud = pcm16Wav(
      Array.from({ length: 3_000 }, (_, index) => shape[index % 5]! * 3),
    );
    const quietOutput = streamWav(quiet);
    const loudOutput = streamWav(loud);
    const silence = pcm16Wav(Array.from({ length: 3_000 }, () => 0));
    const noise = pcm16Wav(Array.from({ length: 3_000 }, (_, index) => index % 2 ? 1 : -1));

    expect(levelDifferenceDb(rms(samplesFrom(quietOutput)), rms(samplesFrom(loudOutput))))
      .toBeLessThan(1);
    expect(streamWav(silence).equals(silence)).toBe(true);
    expect(streamWav(noise).equals(noise)).toBe(true);
  });

  it('normalizes genuinely weak speech beyond 12 dB but leaves silence and noise alone', () => {
    const weakSpeechSamples = Array.from(
      { length: 3_000 },
      (_, index) => Math.round(250 * Math.sin((2 * Math.PI * index) / 120)),
    );
    const noiseSamples = Array.from(
      { length: 3_000 },
      (_, index) => index % 2 === 0 ? 200 : -200,
    );
    const weakSpeech = pcm16Wav(weakSpeechSamples);
    const noise = pcm16Wav(noiseSamples);
    const silence = pcm16Wav(Array.from({ length: 3_000 }, () => 0));
    const blockingSpeech = normalizePcm16Wav(weakSpeech);
    const streamingSpeech = streamWav(weakSpeech);

    const blockingRms = rms(samplesFrom(blockingSpeech));
    const streamingRms = rms(samplesFrom(streamingSpeech));
    expect(20 * Math.log10(blockingRms / rms(weakSpeechSamples))).toBeGreaterThan(12);
    expect(levelDifferenceDb(blockingRms, streamingRms)).toBeLessThan(0.2);
    expect(streamWav(noise).equals(noise)).toBe(true);
    expect(normalizePcm16Wav(noise).equals(noise)).toBe(true);
    expect(streamWav(silence).equals(silence)).toBe(true);
  });

  it('can release a partial streaming head without waiting for more network data', () => {
    const source = pcm16Wav([1_000, -2_000, 3_000, -3_000]);
    const processor = new Pcm16WavStreamGain({});
    const header = processor.push(source);
    const released = processor.releaseHead();
    const output = Buffer.concat([...header, ...released, ...processor.flush()]);

    expect(output.length).toBe(source.length);
    expect(processor.hasOutputAudio()).toBe(true);
    expect(levelDifferenceDb(rms(samplesFrom(output)), __test.targetRms)).toBeLessThan(0.1);
  });

  it('gates quasi-silence out of the normalization measurement', () => {
    const speech = [2_000, -4_000, 6_000, -6_000];
    const speechOnly = __test.planNormalization(pcmPayload(speech), {});
    const padded = __test.planNormalization(
      pcmPayload([...Array.from({ length: 2_000 }, () => 0), ...speech]),
      {},
    );

    expect(padded.factor).toBeCloseTo(speechOnly.factor, 8);
  });

  it('waits for a 400 ms head by default before freezing the stream factor', () => {
    const samples = Array.from({ length: 24_000 }, (_, index) => index % 2 ? 2_000 : -2_000);
    const source = pcm16Wav(samples);
    const processor = new Pcm16WavStreamGain({});
    const headerLength = source.indexOf(Buffer.from('data')) + 8;

    expect(processor.push(source.subarray(0, headerLength))).toHaveLength(1);
    expect(processor.push(source.subarray(headerLength, headerLength + 19_152))).toEqual([]);
    expect(processor.factor).toBeUndefined();
    expect(processor.push(source.subarray(headerLength + 19_152, headerLength + 19_200)).length)
      .toBeGreaterThan(0);
    expect(processor.factor).toBeTypeOf('number');
  });

  it('applies an externally frozen factor immediately without measuring another head', () => {
    const source = pcm16Wav(Array.from({ length: 500 }, (_, index) => index % 2 ? 4_000 : -4_000));
    const processor = new Pcm16WavStreamGain({}, 0.5);
    const output = Buffer.concat([...processor.push(source), ...processor.flush()]);

    expect(processor.factor).toBe(0.5);
    expect(Math.max(...samplesFrom(output).map(Math.abs))).toBeCloseTo(2_000, -1);
  });

  it('soft-limits residual peaks even when the factor does not amplify', () => {
    const transformed = __test.transformPcm16(pcmPayload([32_767, -32_768]), 1);

    expect(Math.abs(transformed.readInt16LE(0))).toBeLessThanOrEqual(__test.targetPeak);
    expect(Math.abs(transformed.readInt16LE(0))).toBeLessThan(32_767);
    expect(Math.abs(transformed.readInt16LE(2))).toBeLessThanOrEqual(__test.targetPeak);
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
