import { probePcm16Wav } from './tts-volume.js';

const PCM16_MAX = 32_767;
const EDGE_MARGIN_MS = 20;

function paired(buffer: Uint8Array): Buffer {
  const source = Buffer.from(buffer);
  return source.subarray(0, source.length - (source.length & 1));
}

function thresholdAmplitude(thresholdDbfs: number): number {
  return PCM16_MAX * 10 ** (thresholdDbfs / 20);
}

/** Trim quasi-silent PCM16 head/tail while retaining 20 ms of natural margin. */
export function trimSilence(
  pcm16: Uint8Array,
  sampleRate: number,
  thresholdDbfs = -50,
): Buffer {
  const source = paired(pcm16);
  if (source.length === 0 || sampleRate <= 0) return Buffer.alloc(0);
  const threshold = thresholdAmplitude(thresholdDbfs);
  const sampleCount = source.length / 2;
  let first = -1;
  let last = -1;
  for (let index = 0; index < sampleCount; index++) {
    if (Math.abs(source.readInt16LE(index * 2)) >= threshold) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0 || last < 0) return Buffer.alloc(0);
  const margin = Math.max(0, Math.round(sampleRate * EDGE_MARGIN_MS / 1_000));
  const start = Math.max(0, first - margin);
  const end = Math.min(sampleCount, last + 1 + margin);
  return Buffer.from(source.subarray(start * 2, end * 2));
}

/** Apply symmetric linear PCM16 fades without mutating the input buffer. */
export function applyEdgeFades(
  pcm16: Uint8Array,
  sampleRate: number,
  fadeMs = 5,
): Buffer {
  const output = Buffer.from(paired(pcm16));
  const sampleCount = output.length / 2;
  const fadeSamples = Math.min(
    Math.floor(sampleCount / 2),
    Math.max(0, Math.round(sampleRate * fadeMs / 1_000)),
  );
  for (let index = 0; index < fadeSamples; index++) {
    const factor = index / fadeSamples;
    const endIndex = sampleCount - 1 - index;
    output.writeInt16LE(Math.round(output.readInt16LE(index * 2) * factor), index * 2);
    output.writeInt16LE(
      Math.round(output.readInt16LE(endIndex * 2) * factor),
      endIndex * 2,
    );
  }
  return output;
}

/** Produce deterministic mono PCM16 silence for the gap between two sentences. */
export function makeInterSentenceSilence(sampleRate: number, ms = 280): Buffer {
  if (sampleRate <= 0 || ms <= 0) return Buffer.alloc(0);
  return Buffer.alloc(Math.max(0, Math.round(sampleRate * ms / 1_000)) * 2);
}

/** Condition a complete PCM16 WAV, optionally inserting a fixed leading sentence gap. */
export function conditionPcm16Wav(
  input: Uint8Array,
  options: { prependSilenceMs?: number; thresholdDbfs?: number; fadeMs?: number } = {},
): Buffer {
  const source = Buffer.from(input);
  const probe = probePcm16Wav(source);
  if (probe.status !== 'ready') return Buffer.from(source);
  const { dataOffset, sampleRate } = probe.layout;
  const trimmed = trimSilence(
    source.subarray(dataOffset),
    sampleRate,
    options.thresholdDbfs,
  );
  const faded = applyEdgeFades(trimmed, sampleRate, options.fadeMs);
  const silence = makeInterSentenceSilence(sampleRate, options.prependSilenceMs ?? 0);
  const payload = Buffer.concat([silence, faded]);
  const header = Buffer.from(source.subarray(0, dataOffset));
  if (dataOffset >= 8) header.writeUInt32LE(payload.length, dataOffset - 4);
  if (header.length >= 8) header.writeUInt32LE(header.length + payload.length - 8, 4);
  return Buffer.concat([header, payload]);
}

/**
 * Progressive counterpart of `conditionPcm16Wav`. It releases the spoken body
 * as chunks arrive while retaining only the leading silence and a small tail
 * needed for trimming/fade-out.
 */
export class Pcm16WavStreamEdges {
  private mode: 'probing' | 'pcm' | 'passthrough' = 'probing';
  private prefix = Buffer.alloc(0);
  private leading = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private sampleRate = 0;
  private started = false;
  private outputAudio = false;
  private readonly thresholdDbfs: number;
  private readonly fadeMs: number;
  private readonly prependSilenceMs: number;

  constructor(options: {
    prependSilenceMs?: number;
    thresholdDbfs?: number;
    fadeMs?: number;
  } = {}) {
    this.thresholdDbfs = options.thresholdDbfs ?? -50;
    this.fadeMs = options.fadeMs ?? 5;
    this.prependSilenceMs = options.prependSilenceMs ?? 0;
  }

  push(chunk: Uint8Array): Buffer[] {
    const input = Buffer.from(chunk);
    if (input.length === 0) return [];
    if (this.mode === 'passthrough') return [input];
    if (this.mode === 'pcm') return this.processPayload(input);

    this.prefix = Buffer.concat([this.prefix, input]);
    const probe = probePcm16Wav(this.prefix);
    if (probe.status === 'incomplete' && this.prefix.length <= 1024 * 1024) return [];
    if (probe.status !== 'ready') {
      this.mode = 'passthrough';
      const output = this.prefix;
      this.prefix = Buffer.alloc(0);
      return [output];
    }

    this.mode = 'pcm';
    this.sampleRate = probe.layout.sampleRate;
    const header = Buffer.from(this.prefix.subarray(0, probe.layout.dataOffset));
    // Streaming bodies may be trimmed or prefixed, so advertise an open-ended
    // data chunk and let EOF terminate playback.
    header.writeUInt32LE(0xffff_ffff, probe.layout.dataOffset - 4);
    header.writeUInt32LE(0xffff_ffff, 4);
    const payload = this.prefix.subarray(probe.layout.dataOffset);
    this.prefix = Buffer.alloc(0);
    const silence = makeInterSentenceSilence(this.sampleRate, this.prependSilenceMs);
    return [header, silence, ...this.processPayload(payload)].filter((part) => part.length > 0);
  }

  flush(): Buffer[] {
    if (this.mode === 'probing') {
      const output = this.prefix;
      this.prefix = Buffer.alloc(0);
      this.mode = 'passthrough';
      return output.length > 0 ? [output] : [];
    }
    if (this.mode !== 'pcm' || !this.started) return [];
    const trimmedTail = trimSilence(this.tail, this.sampleRate, this.thresholdDbfs);
    this.tail = Buffer.alloc(0);
    if (trimmedTail.length === 0) return [];
    const fadedTail = this.fadeOut(trimmedTail);
    this.outputAudio = true;
    return [fadedTail];
  }

  hasOutputAudio(): boolean {
    return this.outputAudio;
  }

  private processPayload(input: Buffer): Buffer[] {
    let payload = paired(input);
    if (payload.length === 0) return [];
    if (!this.started) {
      this.leading = Buffer.concat([this.leading, payload]);
      const first = this.firstLoudSample(this.leading);
      if (first < 0) return [];
      const margin = Math.round(this.sampleRate * EDGE_MARGIN_MS / 1_000);
      payload = Buffer.from(this.leading.subarray(Math.max(0, first - margin) * 2));
      this.leading = Buffer.alloc(0);
      this.started = true;
      payload = this.fadeIn(payload);
    }
    return this.bufferTail(payload);
  }

  private bufferTail(payload: Buffer): Buffer[] {
    const combined = Buffer.concat([this.tail, payload]);
    const last = this.lastLoudSample(combined);
    if (last < 0) {
      this.tail = combined;
      return [];
    }
    const fadeSamples = Math.max(1, Math.round(this.sampleRate * this.fadeMs / 1_000));
    const emitSamples = Math.max(0, last - fadeSamples);
    const output = Buffer.from(combined.subarray(0, emitSamples * 2));
    this.tail = Buffer.from(combined.subarray(emitSamples * 2));
    if (output.length === 0) return [];
    this.outputAudio = true;
    return [output];
  }

  private firstLoudSample(buffer: Buffer): number {
    const threshold = thresholdAmplitude(this.thresholdDbfs);
    for (let index = 0; index < buffer.length / 2; index++) {
      if (Math.abs(buffer.readInt16LE(index * 2)) >= threshold) return index;
    }
    return -1;
  }

  private lastLoudSample(buffer: Buffer): number {
    const threshold = thresholdAmplitude(this.thresholdDbfs);
    for (let index = buffer.length / 2 - 1; index >= 0; index--) {
      if (Math.abs(buffer.readInt16LE(index * 2)) >= threshold) return index;
    }
    return -1;
  }

  private fadeIn(buffer: Buffer): Buffer {
    const output = Buffer.from(buffer);
    const samples = Math.min(
      output.length / 2,
      Math.max(0, Math.round(this.sampleRate * this.fadeMs / 1_000)),
    );
    for (let index = 0; index < samples; index++) {
      output.writeInt16LE(
        Math.round(output.readInt16LE(index * 2) * index / samples),
        index * 2,
      );
    }
    return output;
  }

  private fadeOut(buffer: Buffer): Buffer {
    const output = Buffer.from(buffer);
    const sampleCount = output.length / 2;
    const samples = Math.min(
      sampleCount,
      Math.max(0, Math.round(this.sampleRate * this.fadeMs / 1_000)),
    );
    for (let index = 0; index < samples; index++) {
      const sampleIndex = sampleCount - 1 - index;
      output.writeInt16LE(
        Math.round(output.readInt16LE(sampleIndex * 2) * index / samples),
        sampleIndex * 2,
      );
    }
    return output;
  }
}
