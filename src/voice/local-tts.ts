/**
 * Local text-to-speech → Telegram-ready voice note, fully offline / $0.
 *
 * Pipeline: Piper (neural TTS) writes a WAV, then ffmpeg transcodes it to
 * OGG/Opus (the format Telegram voice notes require). Returns the .ogg path.
 *
 * Resolution mirrors local-whisper.ts: explicit env wins, else the ai-stack
 * install is auto-discovered, else we fall back to `piper` on PATH. Never
 * throws on a missing engine — callers should treat a null return / rejection
 * as "voice reply unavailable" and keep the text reply.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

function resolvePiperBin(): string {
  const candidates = [
    process.env.COWORK_PIPER_BIN,
    process.env.CODEBUDDY_PIPER_BIN,
    join(homedir(), 'DEV/ai-stack/voice/piper/piper/piper'),
    join(homedir(), 'ai-stack/voice/piper/piper/piper'),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'piper';
}

function resolvePiperVoice(): string | undefined {
  const candidates = [
    process.env.COWORK_PIPER_VOICE,
    process.env.CODEBUDDY_PIPER_VOICE,
    join(homedir(), 'DEV/ai-stack/voice/voices/fr_FR-siwis-medium.onnx'),
    join(homedir(), 'ai-stack/voice/voices/fr_FR-siwis-medium.onnx'),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

/** True when a real Piper binary (not just the bare `piper` fallback) is resolvable. */
export function localTtsAvailable(): boolean {
  return (
    resolvePiperBin() !== 'piper' ||
    Boolean(process.env.COWORK_PIPER_BIN) ||
    Boolean(process.env.CODEBUDDY_PIPER_BIN)
  );
}

function run(
  cmd: string,
  args: string[],
  opts: { stdin?: string; timeoutMs: number },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-200)}`));
    });
    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    }
  });
}

export interface LocalTtsOptions {
  /** ffmpeg binary (default: `ffmpeg` on PATH). */
  ffmpeg?: string;
  timeoutMs?: number;
}

/**
 * Synthesize `text` to an OGG/Opus file (Telegram voice-note format) and return
 * its path. Caller is responsible for deleting the file. Throws if Piper or
 * ffmpeg fail; callers should catch and fall back to a text-only reply.
 */
export async function synthesizeToOgg(text: string, options: LocalTtsOptions = {}): Promise<string> {
  const bin = resolvePiperBin();
  const voice = resolvePiperVoice();
  const ffmpeg = options.ffmpeg || 'ffmpeg';
  const timeoutMs = options.timeoutMs ?? 60_000;
  const stamp = `${process.pid}-${Date.now()}`;
  const wav = join(tmpdir(), `cb-tts-${stamp}.wav`);
  const ogg = join(tmpdir(), `cb-tts-${stamp}.ogg`);

  const piperArgs = ['--output_file', wav];
  if (voice) piperArgs.push('--model', voice);

  try {
    await run(bin, piperArgs, { stdin: text, timeoutMs });
    // Telegram voice notes want OGG/Opus mono. 32 kbps is plenty for speech.
    await run(
      ffmpeg,
      ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', ogg],
      { timeoutMs },
    );
    return ogg;
  } finally {
    await unlink(wav).catch(() => undefined);
  }
}
