import { describe, expect, it } from 'vitest';
import {
  applyEdgeFades,
  conditionPcm16Wav,
  makeInterSentenceSilence,
  trimSilence,
} from '../../src/voice/pcm-edges.js';

function pcm16(samples: number[]): Buffer {
  const output = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => output.writeInt16LE(sample, index * 2));
  return output;
}

function samplesFrom(payload: Buffer): number[] {
  const samples: number[] = [];
  for (let offset = 0; offset + 1 < payload.length; offset += 2) {
    samples.push(payload.readInt16LE(offset));
  }
  return samples;
}

function wav(samples: number[], sampleRate = 1_000): Buffer {
  const payload = pcm16(samples);
  const output = Buffer.alloc(44 + payload.length);
  output.write('RIFF', 0, 4, 'ascii');
  output.writeUInt32LE(output.length - 8, 4);
  output.write('WAVE', 8, 4, 'ascii');
  output.write('fmt ', 12, 4, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36, 4, 'ascii');
  output.writeUInt32LE(payload.length, 40);
  payload.copy(output, 44);
  return output;
}

describe('PCM16 edge conditioning', () => {
  it('trims quasi-silent head and tail while retaining 20 ms margins', () => {
    const source = pcm16([
      ...Array.from({ length: 50 }, () => 0),
      ...Array.from({ length: 100 }, () => 2_000),
      ...Array.from({ length: 50 }, () => 0),
    ]);
    const trimmed = samplesFrom(trimSilence(source, 1_000));

    expect(trimmed).toHaveLength(140);
    expect(trimmed.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => 0));
    expect(trimmed.slice(-20)).toEqual(Array.from({ length: 20 }, () => 0));
    expect(trimSilence(pcm16(Array.from({ length: 100 }, () => 0)), 1_000)).toHaveLength(0);
  });

  it('applies five-millisecond linear fades without mutating the source', () => {
    const source = pcm16(Array.from({ length: 12 }, () => 1_000));
    const faded = samplesFrom(applyEdgeFades(source, 1_000));

    expect(faded.slice(0, 5)).toEqual([0, 200, 400, 600, 800]);
    expect(faded.slice(-5)).toEqual([800, 600, 400, 200, 0]);
    expect(samplesFrom(source)).toEqual(Array.from({ length: 12 }, () => 1_000));
  });

  it('creates an exact 280 ms PCM16 silence buffer', () => {
    const silence = makeInterSentenceSilence(24_000);

    expect(silence).toHaveLength(13_440);
    expect(silence.every((sample) => sample === 0)).toBe(true);
  });

  it('conditions WAV frames and updates RIFF/data sizes', () => {
    const source = wav([
      ...Array.from({ length: 30 }, () => 0),
      ...Array.from({ length: 20 }, () => 2_000),
      ...Array.from({ length: 30 }, () => 0),
    ]);
    const conditioned = conditionPcm16Wav(source, { prependSilenceMs: 280 });

    expect(conditioned.readUInt32LE(4)).toBe(conditioned.length - 8);
    expect(conditioned.readUInt32LE(40)).toBe(conditioned.length - 44);
    expect(samplesFrom(conditioned.subarray(44)).slice(0, 280))
      .toEqual(Array.from({ length: 280 }, () => 0));
  });
});
