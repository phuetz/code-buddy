/**
 * Loudness control shared by every local TTS path.
 *
 * Pocket TTS deliberately leaves generous headroom (the Estelle samples we
 * measured commonly peak around -8 to -11 dBFS).  A system sink at 100% cannot
 * recover that headroom, so assistant speech still sounds quiet.  This module
 * normalizes completed PCM16 WAV files and applies the equivalent bounded gain
 * to Pocket's low-latency stream.
 *
 * `CODEBUDDY_TTS_VOLUME` is an assistant-only 0..100 preference. Missing or
 * invalid values resolve to 100, while an explicit lower value is preserved.
 */
import { readFile, writeFile } from 'node:fs/promises';

export const DEFAULT_TTS_VOLUME_PERCENT = 100;
export const DEFAULT_STREAM_GAIN_DB = 8;

const TARGET_PEAK_DBFS = -1;
const MAX_NORMALIZE_GAIN_DB = 12;
const MAX_STREAM_GAIN_DB = 18;
const MIN_STREAM_GAIN_DB = 0;
const PCM16_MAX = 32767;
const TARGET_PEAK = Math.round(PCM16_MAX * 10 ** (TARGET_PEAK_DBFS / 20));

export function resolveTtsVolumePercent(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEBUDDY_TTS_VOLUME?.trim();
  if (!raw) return DEFAULT_TTS_VOLUME_PERCENT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TTS_VOLUME_PERCENT;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function resolveStreamGainDb(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEBUDDY_TTS_STREAM_GAIN_DB?.trim();
  if (!raw) return DEFAULT_STREAM_GAIN_DB;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STREAM_GAIN_DB;
  return Math.max(MIN_STREAM_GAIN_DB, Math.min(MAX_STREAM_GAIN_DB, parsed));
}

interface Pcm16WavLayout {
  dataOffset: number;
}

type LayoutProbe =
  | { status: 'ready'; layout: Pcm16WavLayout }
  | { status: 'incomplete' }
  | { status: 'unsupported' };

/** Locate PCM16 data without trusting the often-placeholder streaming RIFF sizes. */
function probePcm16Wav(buffer: Buffer): LayoutProbe {
  if (buffer.length < 12) return { status: 'incomplete' };
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { status: 'unsupported' };
  }

  let offset = 12;
  let pcm16 = false;
  while (offset <= 1024 * 1024) {
    if (buffer.length < offset + 8) return { status: 'incomplete' };
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    if (id === 'fmt ') {
      if (size < 16) return { status: 'unsupported' };
      if (buffer.length < payloadOffset + 16) return { status: 'incomplete' };
      const format = buffer.readUInt16LE(payloadOffset);
      const bitsPerSample = buffer.readUInt16LE(payloadOffset + 14);
      pcm16 = format === 1 && bitsPerSample === 16;
      if (!pcm16) return { status: 'unsupported' };
    } else if (id === 'data') {
      if (!pcm16) return { status: 'unsupported' };
      return { status: 'ready', layout: { dataOffset: payloadOffset } };
    }

    // Only the `data` chunk is allowed to advertise an unknown/placeholder
    // length. Other implausibly large chunks are malformed, not incomplete.
    if (size > 1024 * 1024) return { status: 'unsupported' };
    offset = payloadOffset + size + (size & 1);
  }
  return { status: 'unsupported' };
}

function softLimit(sample: number, limit = TARGET_PEAK): number {
  const sign = sample < 0 ? -1 : 1;
  const absolute = Math.abs(sample);
  const knee = limit * 0.85;
  if (absolute <= knee) return Math.round(sample);
  const shoulder = limit - knee;
  const limited = knee + shoulder * Math.tanh((absolute - knee) / shoulder);
  return Math.round(sign * Math.min(limit, limited));
}

function transformPcm16(payload: Buffer, factor: number): Buffer {
  const output = Buffer.allocUnsafe(payload.length);
  const pairedLength = payload.length - (payload.length & 1);
  for (let offset = 0; offset < pairedLength; offset += 2) {
    const sample = payload.readInt16LE(offset);
    output.writeInt16LE(softLimit(sample * factor), offset);
  }
  if (pairedLength < payload.length) output[pairedLength] = payload[pairedLength] ?? 0;
  return output;
}

/**
 * Return a normalized copy of a canonical PCM16 WAV. Unsupported/malformed
 * audio is returned byte-for-byte so volume handling can never make TTS fail.
 */
export function normalizePcm16Wav(
  input: Uint8Array,
  env: NodeJS.ProcessEnv = process.env
): Buffer {
  const source = Buffer.from(input);
  const probe = probePcm16Wav(source);
  if (probe.status !== 'ready') return Buffer.from(source);

  const volume = resolveTtsVolumePercent(env);
  const dataOffset = probe.layout.dataOffset;
  const pairedEnd = source.length - ((source.length - dataOffset) & 1);
  if (pairedEnd <= dataOffset) return Buffer.from(source);

  let peak = 0;
  for (let offset = dataOffset; offset < pairedEnd; offset += 2) {
    peak = Math.max(peak, Math.abs(source.readInt16LE(offset)));
  }
  if (peak === 0) return Buffer.from(source);

  const volumeFactor = volume / 100;
  const desiredPeak = TARGET_PEAK * volumeFactor;
  // Normalization is deliberately byte-idempotent. Fresh Pocket files are
  // normalized during synthesis and may pass through a cache/playback migration
  // guard later; repeatedly feeding the soft knee would otherwise compress them.
  if (desiredPeak > 0 && peak >= desiredPeak * 0.94 && peak <= desiredPeak * 1.02) {
    return Buffer.from(source);
  }
  const maxGain = 10 ** (MAX_NORMALIZE_GAIN_DB / 20);
  const factor = desiredPeak / peak;
  // Near-silence is more likely padding/noise than speech. Do not partially
  // boost it on every pass: either reach the target safely in one pass or
  // leave it byte-for-byte unchanged.
  if (factor > maxGain) return Buffer.from(source);
  const output = Buffer.from(source);
  const transformed = transformPcm16(source.subarray(dataOffset, pairedEnd), factor);
  transformed.copy(output, dataOffset);
  return output;
}

/** Best-effort in-place normalization used for legacy cache entries and Piper. */
export async function normalizeWavFile(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  try {
    const source = await readFile(filePath);
    const normalized = normalizePcm16Wav(source, env);
    if (!normalized.equals(source)) await writeFile(filePath, normalized, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stateful gain processor for Pocket's chunked WAV response. It buffers only
 * the small RIFF header, handles samples split on odd chunk boundaries, and
 * fails open byte-for-byte for non-PCM16 input.
 */
export class Pcm16WavStreamGain {
  private prefix = Buffer.alloc(0);
  private pendingByte: number | null = null;
  private mode: 'probing' | 'gain' | 'passthrough' = 'probing';
  private readonly factor: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const volumeFactor = resolveTtsVolumePercent(env) / 100;
    this.factor = 10 ** (resolveStreamGainDb(env) / 20) * volumeFactor;
  }

  push(chunk: Uint8Array): Buffer[] {
    const input = Buffer.from(chunk);
    if (input.length === 0) return [];
    if (this.mode === 'passthrough') return [input];
    if (this.mode === 'gain') return this.transformPayload(input);

    this.prefix = Buffer.concat([this.prefix, input]);
    const probe = probePcm16Wav(this.prefix);
    if (probe.status === 'incomplete' && this.prefix.length <= 1024 * 1024) return [];
    if (probe.status !== 'ready') {
      this.mode = 'passthrough';
      const output = this.prefix;
      this.prefix = Buffer.alloc(0);
      return [output];
    }

    this.mode = 'gain';
    const header = this.prefix.subarray(0, probe.layout.dataOffset);
    const payload = this.prefix.subarray(probe.layout.dataOffset);
    this.prefix = Buffer.alloc(0);
    return [header, ...this.transformPayload(payload)].filter((part) => part.length > 0);
  }

  flush(): Buffer[] {
    if (this.mode === 'probing') {
      const output = this.prefix;
      this.prefix = Buffer.alloc(0);
      this.mode = 'passthrough';
      return output.length > 0 ? [output] : [];
    }
    if (this.mode === 'gain' && this.pendingByte !== null) {
      const output = Buffer.from([this.pendingByte]);
      this.pendingByte = null;
      return [output];
    }
    return [];
  }

  private transformPayload(input: Buffer): Buffer[] {
    let payload = input;
    if (this.pendingByte !== null) {
      payload = Buffer.concat([Buffer.from([this.pendingByte]), input]);
      this.pendingByte = null;
    }
    if (payload.length & 1) {
      this.pendingByte = payload[payload.length - 1] ?? null;
      payload = payload.subarray(0, payload.length - 1);
    }
    return payload.length > 0 ? [transformPcm16(payload, this.factor)] : [];
  }
}

export const __test = {
  probePcm16Wav,
  softLimit,
  targetPeak: TARGET_PEAK,
};
