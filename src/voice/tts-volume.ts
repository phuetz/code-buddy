/**
 * Loudness control shared by every local TTS path.
 *
 * Pocket TTS deliberately leaves generous headroom (the Estelle samples we
 * measured commonly peak around -8 to -11 dBFS).  A system sink at 100% cannot
 * recover that headroom, so assistant speech still sounds quiet.  This module
 * normalizes completed PCM16 WAV files and applies the same bounded RMS target
 * to Pocket's low-latency stream after a short look-ahead buffer.
 *
 * `CODEBUDDY_TTS_VOLUME` is an assistant-only 0..100 preference. Missing or
 * invalid values resolve to 100, while an explicit lower value is preserved.
 */
import { readFile, writeFile } from 'node:fs/promises';

export const DEFAULT_TTS_VOLUME_PERCENT = 100;
export const DEFAULT_STREAM_GAIN_DB = 0;
export const DEFAULT_TARGET_RMS_DBFS = -18;
export const DEFAULT_STREAM_HEAD_MS = 400;

const TARGET_PEAK_DBFS = -1;
const MAX_NORMALIZE_GAIN_DB = 12;
const MAX_SPEECH_NORMALIZE_GAIN_DB = 30;
const MIN_SPEECH_RMS_DBFS = -60;
const MAX_STREAM_GAIN_DB = 18;
const MIN_STREAM_GAIN_DB = 0;
const MIN_TARGET_RMS_DBFS = -40;
const MAX_TARGET_RMS_DBFS = -6;
const MIN_STREAM_HEAD_MS = 50;
const MAX_STREAM_HEAD_MS = 2_000;
const RMS_GATE_DBFS = -45;
const MAX_STREAM_HEAD_BYTES = 256 * 1024;
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

/** Look-ahead used to derive one stable streaming gain for a complete utterance. */
export function resolveStreamHeadMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEBUDDY_TTS_STREAM_HEAD_MS?.trim();
  if (!raw) return DEFAULT_STREAM_HEAD_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STREAM_HEAD_MS;
  return Math.max(MIN_STREAM_HEAD_MS, Math.min(MAX_STREAM_HEAD_MS, Math.round(parsed)));
}

/** Shared speech RMS target in dBFS. Invalid or unsafe values use -18 dBFS. */
export function resolveTargetRmsDbfs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEBUDDY_TTS_TARGET_RMS?.trim();
  if (!raw) return DEFAULT_TARGET_RMS_DBFS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TARGET_RMS_DBFS;
  return Math.max(MIN_TARGET_RMS_DBFS, Math.min(MAX_TARGET_RMS_DBFS, parsed));
}

export interface Pcm16WavLayout {
  dataOffset: number;
  byteRate: number;
  blockAlign: number;
  sampleRate: number;
}

export type Pcm16WavLayoutProbe =
  | { status: 'ready'; layout: Pcm16WavLayout }
  | { status: 'incomplete' }
  | { status: 'unsupported' };

/** Locate PCM16 data without trusting the often-placeholder streaming RIFF sizes. */
export function probePcm16Wav(buffer: Buffer): Pcm16WavLayoutProbe {
  if (buffer.length < 12) return { status: 'incomplete' };
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { status: 'unsupported' };
  }

  let offset = 12;
  let pcm16 = false;
  let byteRate = 0;
  let blockAlign = 0;
  let sampleRate = 0;
  while (offset <= 1024 * 1024) {
    if (buffer.length < offset + 8) return { status: 'incomplete' };
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    if (id === 'fmt ') {
      if (size < 16) return { status: 'unsupported' };
      if (buffer.length < payloadOffset + 16) return { status: 'incomplete' };
      const format = buffer.readUInt16LE(payloadOffset);
      const channels = buffer.readUInt16LE(payloadOffset + 2);
      sampleRate = buffer.readUInt32LE(payloadOffset + 4);
      byteRate = buffer.readUInt32LE(payloadOffset + 8);
      blockAlign = buffer.readUInt16LE(payloadOffset + 12);
      const bitsPerSample = buffer.readUInt16LE(payloadOffset + 14);
      pcm16 =
        format === 1 &&
        bitsPerSample === 16 &&
        channels > 0 &&
        sampleRate > 0 &&
        byteRate > 0 &&
        blockAlign >= channels * 2;
      if (!pcm16) return { status: 'unsupported' };
    } else if (id === 'data') {
      if (!pcm16) return { status: 'unsupported' };
      return {
        status: 'ready',
        layout: { dataOffset: payloadOffset, byteRate, blockAlign, sampleRate },
      };
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

function transformPcm16(payload: Buffer, factor: number, limit = TARGET_PEAK): Buffer {
  const output = Buffer.allocUnsafe(payload.length);
  const pairedLength = payload.length - (payload.length & 1);
  for (let offset = 0; offset < pairedLength; offset += 2) {
    const sample = payload.readInt16LE(offset);
    const transformed = sample * factor;
    output.writeInt16LE(softLimit(transformed, limit), offset);
  }
  if (pairedLength < payload.length) output[pairedLength] = payload[pairedLength] ?? 0;
  return output;
}

interface Pcm16Level {
  peak: number;
  rms: number;
  zeroCrossingRate: number;
}

function measurePcm16(payload: Buffer, gateDbfs?: number): Pcm16Level {
  const pairedLength = payload.length - (payload.length & 1);
  const gate = gateDbfs === undefined ? 0 : PCM16_MAX * 10 ** (gateDbfs / 20);
  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  let zeroCrossings = 0;
  let previousSign = 0;
  for (let offset = 0; offset < pairedLength; offset += 2) {
    const sample = payload.readInt16LE(offset);
    peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) < gate) continue;
    sumSquares += sample * sample;
    samples += 1;
    const sign = Math.sign(sample);
    if (sign !== 0) {
      if (previousSign !== 0 && sign !== previousSign) zeroCrossings += 1;
      previousSign = sign;
    }
  }
  return {
    peak,
    rms: samples > 0 ? Math.sqrt(sumSquares / samples) : 0,
    zeroCrossingRate: samples > 1 ? zeroCrossings / (samples - 1) : 0,
  };
}

function looksLikeWeakSpeech(level: Pcm16Level): boolean {
  const minimumSpeechRms = PCM16_MAX * 10 ** (MIN_SPEECH_RMS_DBFS / 20);
  if (level.rms < minimumSpeechRms) return false;
  // Voiced speech has an energy envelope and comparatively sparse polarity
  // changes. Reject flat hum and high-frequency stationary noise.
  const crestFactor = level.peak / level.rms;
  return crestFactor >= 1.2 && level.zeroCrossingRate <= 0.35;
}

interface NormalizationPlan {
  factor: number;
  peakLimit: number;
}

function planNormalization(
  payload: Buffer,
  env: NodeJS.ProcessEnv,
  targetBoostDb = 0
): NormalizationPlan {
  const volumeFactor = resolveTtsVolumePercent(env) / 100;
  const targetBoost = 10 ** (targetBoostDb / 20);
  const peakLimit = Math.max(1, Math.min(PCM16_MAX, TARGET_PEAK * volumeFactor * targetBoost));
  if (volumeFactor === 0) return { factor: 0, peakLimit };

  const level = measurePcm16(payload, RMS_GATE_DBFS);
  if (level.rms === 0) return { factor: 1, peakLimit };
  const targetRms = PCM16_MAX * 10 ** (resolveTargetRmsDbfs(env) / 20) * volumeFactor * targetBoost;
  const factor = targetRms / level.rms;
  const maxGain = 10 ** (MAX_NORMALIZE_GAIN_DB / 20);
  if (factor > maxGain) {
    const maxSpeechGain = 10 ** (MAX_SPEECH_NORMALIZE_GAIN_DB / 20);
    if (factor > maxSpeechGain || !looksLikeWeakSpeech(measurePcm16(payload))) {
      return { factor: 1, peakLimit };
    }
  }
  // Avoid re-rounding already-normalized cache files on every playback.
  if (factor >= 0.98 && factor <= 1.02) return { factor: 1, peakLimit };
  return { factor, peakLimit };
}

/**
 * Return a normalized copy of a canonical PCM16 WAV. Unsupported/malformed
 * audio is returned byte-for-byte so volume handling can never make TTS fail.
 */
export function normalizePcm16Wav(
  input: Uint8Array,
  env: NodeJS.ProcessEnv = process.env,
  frozenFactor?: number,
): Buffer {
  const source = Buffer.from(input);
  const probe = probePcm16Wav(source);
  if (probe.status !== 'ready') return Buffer.from(source);

  const dataOffset = probe.layout.dataOffset;
  const pairedEnd = source.length - ((source.length - dataOffset) & 1);
  if (pairedEnd <= dataOffset) return Buffer.from(source);

  const plan = planNormalization(
    source.subarray(dataOffset, pairedEnd),
    env,
    frozenFactor === undefined ? 0 : resolveStreamGainDb(env),
  );
  const factor = frozenFactor === undefined ? plan.factor : frozenFactor;
  const { peakLimit } = plan;
  if (frozenFactor === undefined && factor === 1) return Buffer.from(source);
  const output = Buffer.from(source);
  const transformed = transformPcm16(
    source.subarray(dataOffset, pairedEnd),
    factor,
    peakLimit
  );
  transformed.copy(output, dataOffset);
  return output;
}

/** Best-effort in-place normalization used for legacy cache entries and Piper. */
export async function normalizeWavFile(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
  frozenFactor?: number,
): Promise<boolean> {
  try {
    const source = await readFile(filePath);
    const normalized = normalizePcm16Wav(source, env, frozenFactor);
    if (!normalized.equals(source)) await writeFile(filePath, normalized, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stateful gain processor for a chunked PCM16 WAV response. It buffers the RIFF
 * header plus roughly 400 ms of audio, derives the same RMS normalization used
 * for files, handles samples split across chunks, and fails open for other data.
 */
export class Pcm16WavStreamGain {
  private prefix = Buffer.alloc(0);
  private head = Buffer.alloc(0);
  private headBytes = 0;
  private pendingByte: number | null = null;
  private mode: 'probing' | 'buffering' | 'gain' | 'passthrough' = 'probing';
  private normalizationFactor: number | undefined;
  private peakLimit = TARGET_PEAK;
  private outputAudio = false;
  private readonly env: NodeJS.ProcessEnv;
  private readonly frozenFactor: number | undefined;

  constructor(env: NodeJS.ProcessEnv = process.env, frozenFactor?: number) {
    this.env = env;
    this.frozenFactor = Number.isFinite(frozenFactor) ? frozenFactor : undefined;
    this.normalizationFactor = this.frozenFactor;
    if (this.frozenFactor !== undefined) {
      this.peakLimit = planNormalization(
        Buffer.alloc(0),
        env,
        resolveStreamGainDb(env),
      ).peakLimit;
    }
  }

  /** Gain derived from the first head, or the externally supplied turn gain. */
  get factor(): number | undefined {
    return this.normalizationFactor;
  }

  push(chunk: Uint8Array): Buffer[] {
    const input = Buffer.from(chunk);
    if (input.length === 0) return [];
    if (this.mode === 'passthrough') return [input];
    if (this.mode === 'gain') return this.transformPayload(input);
    if (this.mode === 'buffering') return this.bufferHead(input);

    this.prefix = Buffer.concat([this.prefix, input]);
    const probe = probePcm16Wav(this.prefix);
    if (probe.status === 'incomplete' && this.prefix.length <= 1024 * 1024) return [];
    if (probe.status !== 'ready') {
      this.mode = 'passthrough';
      const output = this.prefix;
      this.prefix = Buffer.alloc(0);
      this.outputAudio = output.length > 0;
      return [output];
    }

    const header = this.prefix.subarray(0, probe.layout.dataOffset);
    const payload = this.prefix.subarray(probe.layout.dataOffset);
    this.prefix = Buffer.alloc(0);
    if (this.frozenFactor !== undefined) {
      this.mode = 'gain';
      return [header, ...this.transformPayload(payload)].filter((part) => part.length > 0);
    }

    this.mode = 'buffering';
    this.headBytes = Math.max(
      probe.layout.blockAlign,
      Math.min(
        MAX_STREAM_HEAD_BYTES,
        Math.round(
          (probe.layout.byteRate * resolveStreamHeadMs(this.env)) /
          1000 /
          probe.layout.blockAlign
        ) * probe.layout.blockAlign
      )
    );
    return [header, ...this.bufferHead(payload)].filter((part) => part.length > 0);
  }

  flush(): Buffer[] {
    if (this.mode === 'probing') {
      const output = this.prefix;
      this.prefix = Buffer.alloc(0);
      this.mode = 'passthrough';
      return output.length > 0 ? [output] : [];
    }
    const output = this.mode === 'buffering' ? this.releaseHead() : [];
    if (this.mode === 'gain' && this.pendingByte !== null) {
      output.push(Buffer.from([this.pendingByte]));
      this.pendingByte = null;
    }
    return output;
  }

  /** Force-release a partial head buffer (used by the streaming timeout). */
  releaseHead(): Buffer[] {
    if (this.mode !== 'buffering') return [];
    const payload = this.head;
    this.head = Buffer.alloc(0);
    this.mode = 'gain';
    const pairedLength = payload.length - (payload.length & 1);
    if (pairedLength < payload.length) {
      this.pendingByte = payload[payload.length - 1] ?? null;
    }
    const paired = payload.subarray(0, pairedLength);
    const plan = planNormalization(paired, this.env, resolveStreamGainDb(this.env));
    this.normalizationFactor = plan.factor;
    this.peakLimit = plan.peakLimit;
    if (paired.length === 0) return [];
    this.outputAudio = true;
    return [transformPcm16(paired, this.normalizationFactor ?? 1, this.peakLimit)];
  }

  hasOutputAudio(): boolean {
    return this.outputAudio;
  }

  private bufferHead(input: Buffer): Buffer[] {
    if (input.length > 0) this.head = Buffer.concat([this.head, input]);
    if (this.head.length < this.headBytes) return [];
    const buffered = this.head;
    this.head = buffered.subarray(0, this.headBytes);
    const remainder = buffered.subarray(this.headBytes);
    const output = this.releaseHead();
    return remainder.length > 0 ? [...output, ...this.transformPayload(remainder)] : output;
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
    if (payload.length === 0) return [];
    this.outputAudio = true;
    return [transformPcm16(payload, this.normalizationFactor ?? 1, this.peakLimit)];
  }
}

export const __test = {
  probePcm16Wav,
  measurePcm16,
  looksLikeWeakSpeech,
  planNormalization,
  softLimit,
  transformPcm16,
  rmsGateDbfs: RMS_GATE_DBFS,
  targetPeak: TARGET_PEAK,
  targetRms: PCM16_MAX * 10 ** (DEFAULT_TARGET_RMS_DBFS / 20),
};
