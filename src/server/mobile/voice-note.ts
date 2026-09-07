/**
 * Mobile PWA voice notes: sniff audio bytes, transcribe via the existing STT
 * engines, optionally synthesize Lisa's reply. Injectables keep tests off the
 * real sherpa/ffmpeg/ElevenLabs stack.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from '../../utils/logger.js';

/** Conservative voice bitrate used when the container duration cannot be read. */
const VOICE_BITRATE_ESTIMATE_BPS = 64_000;

export const WS_MAX_VOICE_BYTES = 2 * 1024 * 1024;
export const WS_MAX_VOICE_MS = 120_000;

export type VoiceTranscribe = (input: {
  mimeType: string;
  bytes: Buffer;
}) => Promise<string>;

export type VoiceSynthesize = (text: string) => Promise<{
  mimeType: string;
  data: string;
  durationMs: number;
} | null>;

let testTranscribe: VoiceTranscribe | undefined;
let testSynthesize: VoiceSynthesize | undefined;

/** Test-only: replace STT/TTS. Pass `{}` to restore production. */
export function setMobileVoiceHooksForTests(hooks: {
  transcribe?: VoiceTranscribe;
  synthesize?: VoiceSynthesize;
} = {}): void {
  testTranscribe = hooks.transcribe;
  testSynthesize = hooks.synthesize;
}

export function sniffAudioMime(bytes: Buffer): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'audio/webm';
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'audio/ogg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'audio/wav';
  }
  return null;
}

export function isAudioMime(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

function readEbmlVint(bytes: Buffer, offset: number): { value: number; length: number } | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  if (first === undefined) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = first & (mask - 1);
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + (bytes[offset + i] ?? 0);
  }
  return { value, length };
}

function parseWebmDurationMs(bytes: Buffer): number | null {
  const limit = Math.min(bytes.length, 256 * 1024);
  let offset = 0;
  let timecodeScale = 1_000_000;
  let duration: number | null = null;
  const visit = (start: number, end: number, depth: number): void => {
    let pos = start;
    while (pos < end && depth < 8) {
      const id = readEbmlVint(bytes, pos);
      if (!id) break;
      const size = readEbmlVint(bytes, pos + id.length);
      if (!size) break;
      const dataStart = pos + id.length + size.length;
      const dataEnd = Math.min(end, dataStart + size.value);
      if (dataStart > end) break;
      if (id.value === 0x2ad7b1 && size.value > 0 && size.value <= 8) {
        let scale = 0;
        for (let i = 0; i < size.value; i += 1) scale = scale * 256 + (bytes[dataStart + i] ?? 0);
        if (scale > 0) timecodeScale = scale;
      } else if (id.value === 0x4489 && (size.value === 4 || size.value === 8)) {
        duration = size.value === 4
          ? bytes.readFloatBE(dataStart)
          : bytes.readDoubleBE(dataStart);
      } else if (
        id.value === 0x18538067
        || id.value === 0x1549a966
        || id.value === 0x1a45dfa3
      ) {
        visit(dataStart, dataEnd, depth + 1);
      }
      pos = dataEnd;
      if (pos <= start) break;
    }
  };
  visit(0, limit, 0);
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return null;
  const ms = (duration * timecodeScale) / 1e6;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function parseOggDurationMs(bytes: Buffer): number | null {
  let offset = 0;
  let lastGranule = -1n;
  while (offset + 27 <= bytes.length) {
    if (bytes.toString('ascii', offset, offset + 4) !== 'OggS') {
      const next = bytes.indexOf('OggS', offset + 1);
      if (next < 0) break;
      offset = next;
      continue;
    }
    const nseg = bytes[offset + 26] ?? 0;
    if (offset + 27 + nseg > bytes.length) break;
    let payload = 0;
    for (let i = 0; i < nseg; i += 1) payload += bytes[offset + 27 + i] ?? 0;
    const granule = bytes.readBigInt64LE(offset + 6);
    if (granule > 0n) lastGranule = granule;
    const next = offset + 27 + nseg + payload;
    if (next <= offset) break;
    offset = next;
  }
  if (lastGranule <= 0n) return null;
  const ms = Number(lastGranule) / 48;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function parseAudioDurationMs(bytes: Buffer): number | null {
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') {
    return parseOggDurationMs(bytes);
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return parseWebmDurationMs(bytes);
  }
  return null;
}

export function estimateAudioDurationMs(bytes: Buffer): number {
  return (bytes.length * 8 * 1000) / VOICE_BITRATE_ESTIMATE_BPS;
}

export interface VoiceDurationDeps {
  probeDurationMs?: (bytes: Buffer) => Promise<number | null>;
}

async function ffprobeDurationMs(bytes: Buffer): Promise<number | null> {
  const root = process.env.HOME
    ? path.join(process.env.HOME, '.codebuddy', 'tmp')
    : path.join(tmpdir(), 'codebuddy-voice');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(path.join(root, 'vd-'));
  const src = path.join(dir, 'note.bin');
  try {
    await writeFile(src, bytes, { mode: 0o600 });
    const stdout = await new Promise<string>((resolve) => {
      const child = spawn(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', src],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let out = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve('');
      }, 3000);
      child.on('error', () => {
        clearTimeout(timer);
        resolve('');
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve(out);
      });
    });
    if (!stdout.trim()) return null;
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    const seconds = Number.parseFloat(parsed.format?.duration ?? '');
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return seconds * 1000;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function assertVoiceNoteDurationSync(
  bytes: Buffer,
  declaredMs?: number,
): { ok: true; parsedMs: number | null } | { ok: false; error: string } {
  if (typeof declaredMs === 'number' && Number.isFinite(declaredMs) && declaredMs > WS_MAX_VOICE_MS) {
    return { ok: false, error: 'Each voice note must be at most 120 s' };
  }
  const parsedMs = parseAudioDurationMs(bytes);
  if (parsedMs !== null && parsedMs > WS_MAX_VOICE_MS) {
    return { ok: false, error: 'Each voice note must be at most 120 s' };
  }
  return { ok: true, parsedMs };
}

export async function assertVoiceNoteDuration(
  bytes: Buffer,
  declaredMs?: number,
  deps: VoiceDurationDeps = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sync = assertVoiceNoteDurationSync(bytes, declaredMs);
  if (!sync.ok) return sync;
  if (sync.parsedMs !== null) return { ok: true };
  const probe = deps.probeDurationMs ?? ffprobeDurationMs;
  try {
    const probed = await probe(bytes);
    if (probed !== null && probed > WS_MAX_VOICE_MS) {
      return { ok: false, error: 'Each voice note must be at most 120 s' };
    }
    if (probed !== null) return { ok: true };
  } catch {
    /* fall through to bitrate */
  }
  if (estimateAudioDurationMs(bytes) > WS_MAX_VOICE_MS) {
    return { ok: false, error: 'Each voice note must be at most 120 s' };
  }
  return { ok: true };
}

async function ffmpegToWav(src: string, dest: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-i', src, '-ar', '16000', '-ac', '1', dest], {
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

export async function transcribeVoiceAttachment(
  attachment: { mimeType: string; data: string },
  deps: { transcribe?: VoiceTranscribe } = {},
): Promise<string> {
  const bytes = Buffer.from(attachment.data, 'base64');
  const transcribe = deps.transcribe ?? testTranscribe;
  if (transcribe) {
    return (await transcribe({ mimeType: attachment.mimeType, bytes })).trim();
  }
  const root = process.env.HOME
    ? path.join(process.env.HOME, '.codebuddy', 'tmp')
    : path.join(tmpdir(), 'codebuddy-voice');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(path.join(root, 'vn-'));
  const ext = attachment.mimeType.includes('wav')
    ? 'wav'
    : attachment.mimeType.includes('ogg')
      ? 'ogg'
      : 'webm';
  const src = path.join(dir, `note.${ext}`);
  const wav = path.join(dir, 'note.wav');
  try {
    await writeFile(src, bytes, { mode: 0o600 });
    if (ext === 'wav') {
      await writeFile(wav, bytes, { mode: 0o600 });
    } else {
      await ffmpegToWav(src, wav);
    }
    const { transcribeWavWithMetadata } = await import('../../sensory/speech-reaction.js');
    const outcome = await transcribeWavWithMetadata(wav);
    return (outcome.text || '').trim();
  } catch (err) {
    logger.warn('[mobile-voice] transcription failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function synthesizeMobileVoiceReply(
  text: string,
  deps: { synthesize?: VoiceSynthesize } = {},
): Promise<{ mimeType: string; data: string; durationMs: number } | null> {
  const clean = text.trim();
  if (!clean) return null;
  const synthesize = deps.synthesize ?? testSynthesize;
  if (synthesize) return synthesize(clean);
  try {
    const { synthesizeToOgg } = await import('../../voice/local-tts.js');
    const oggPath = await synthesizeToOgg(clean);
    if (!oggPath) return null;
    const buf = await readFile(oggPath);
    if (buf.length > WS_MAX_VOICE_BYTES) return null;
    return {
      mimeType: 'audio/ogg',
      data: buf.toString('base64'),
      durationMs: 0,
    };
  } catch (err) {
    logger.warn('[mobile-voice] TTS failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
