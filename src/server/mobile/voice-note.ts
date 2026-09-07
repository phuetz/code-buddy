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
