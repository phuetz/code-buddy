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
import { existsSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * TTS engine selector. `piper` (default) keeps the historical behavior;
 * `pocket` routes synthesis to Kyutai Pocket TTS (on-CPU, 26 voices + cloning),
 * with Lisa's chosen voice `estelle` (French → french_24l) by default.
 */
export function resolveTtsEngine(env: NodeJS.ProcessEnv = process.env): 'piper' | 'pocket' {
  return (env.CODEBUDDY_TTS_ENGINE ?? '').trim().toLowerCase() === 'pocket' ? 'pocket' : 'piper';
}

/**
 * Synthesize `text` to a WAV at `wavPath` via Pocket TTS. Returns true on
 * success, false on any failure (caller falls back to Piper). Voice/lang from
 * `CODEBUDDY_POCKET_VOICE` (default `estelle`) / `CODEBUDDY_POCKET_LANG`
 * (default `french`).
 */
export async function synthesizePocketWav(
  text: string,
  wavPath: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 180_000,
): Promise<boolean> {
  try {
    const { PocketTTSProvider } = await import('../talk-mode/providers/pocket-tts.js');
    const provider = new PocketTTSProvider();
    await provider.initialize({
      provider: 'pocket',
      enabled: true,
      priority: 1,
      settings: {
        voice: env.CODEBUDDY_POCKET_VOICE ?? 'estelle',
        language: env.CODEBUDDY_POCKET_LANG ?? 'french',
        timeoutMs,
      },
    });
    if (!(await provider.isAvailable())) return false;
    const res = await provider.synthesize(text);
    if (!res?.audio?.length) return false;
    writeFileSync(wavPath, res.audio);
    return true;
  } catch {
    return false;
  }
}

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
  // The Pocket engine auto-installs via `uvx pocket-tts`, so treat it as available.
  if (resolveTtsEngine() === 'pocket') return true;
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
 * Turn Markdown into clean prose for speech, so the TTS doesn't literally read
 * out "asterisk asterisk", backticks, hashes or bullet dashes — it should sound
 * like a person talking, not a screen reader narrating syntax.
 */
export function cleanForSpeech(text: string): string {
  let t = text;
  // Fenced code blocks: keep the inner text, drop the ``` fences/language tag.
  t = t.replace(/```[\w-]*\n?/g, '').replace(/```/g, '');
  // Inline code, bold, italic — keep the words, drop the markers.
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1').replace(/_([^_]+)_/g, '$1');
  // Links / images → spoken label only.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Line-start markers: headings, blockquotes, list bullets, ordered items.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/^\s*[-*+]\s+/gm, '');
  t = t.replace(/^\s*\d+[.)]\s+/gm, '');
  // Horizontal rules.
  t = t.replace(/^\s*([-*_])\1{2,}\s*$/gm, '');
  // Any leftover Markdown punctuation a voice would mispronounce.
  t = t.replace(/[*_`#>~]/g, '');
  // Newlines → sentence breaks; collapse and de-duplicate punctuation/space.
  t = t.replace(/\n{2,}/g, '. ').replace(/\n/g, '. ');
  t = t.replace(/\s{2,}/g, ' ');
  t = t.replace(/\s*\.(\s*\.)+\s*/g, '. ');
  return t.trim();
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
    // Active engine: Pocket TTS (Lisa's estelle) when selected, else Piper.
    // Pocket falls back to Piper on any failure so the voice note is never lost.
    const usedPocket =
      resolveTtsEngine() === 'pocket' &&
      (await synthesizePocketWav(cleanForSpeech(text), wav, process.env, timeoutMs));
    if (!usedPocket) {
      await run(bin, piperArgs, { stdin: cleanForSpeech(text), timeoutMs });
    }
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
