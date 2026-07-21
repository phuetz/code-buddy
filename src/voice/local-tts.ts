/**
 * Local text-to-speech → Telegram-ready voice note, fully offline / $0.
 *
 * Pipeline: Pocket TTS (primary) writes a WAV, then ffmpeg transcodes it to
 * OGG/Opus (the format Telegram voice notes require). Piper remains the
 * compatibility fallback. Returns the .ogg path.
 *
 * Resolution mirrors local-whisper.ts: explicit env wins, else the ai-stack
 * install is auto-discovered, else we fall back to `piper` on PATH. Never
 * throws on a missing engine — callers should treat a null return / rejection
 * as "voice reply unavailable" and keep the text reply.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { logger } from '../utils/logger.js';
import { normalizePcm16Wav, normalizeWavFile } from './tts-volume.js';

export type LocalTtsEngine = 'pocket' | 'voicebox' | 'piper';

const DEFAULT_POCKET_SERVER_URL = 'http://127.0.0.1:8766';
const DEFAULT_POCKET_SERVER_START_TIMEOUT_MS = 120_000;
let pocketServerChild: ChildProcess | null = null;
let pocketServerKey: string | null = null;
let pocketServerStartPromise: Promise<boolean> | null = null;
let pocketCleanupRegistered = false;

/**
 * TTS engine selector. Pocket is the modern default (better voices, cloning,
 * resident low-latency server); Piper is retained only when explicitly chosen
 * or as a fail-open fallback.
 */
export function resolveTtsEngine(env: NodeJS.ProcessEnv = process.env): LocalTtsEngine {
  const configured = (env.CODEBUDDY_TTS_ENGINE ?? '').trim().toLowerCase();
  if (configured === 'piper' || configured === 'voicebox') return configured;
  return 'pocket';
}

/** Local Pocket server URL. Port 8766 avoids the common AudioReader port 8000. */
export function resolvePocketServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_POCKET_URL?.trim();
  return configured || DEFAULT_POCKET_SERVER_URL;
}

export interface PocketServerLauncher {
  command: string;
  argsPrefix: string[];
}

/** Build the persistent Pocket CLI server arguments. Pure and unit-testable. */
export function buildPocketServerArgs(
  launcher: PocketServerLauncher,
  serverUrl: string,
  language: string,
  quantize = false
): string[] {
  const url = new URL(serverUrl);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return [
    ...launcher.argsPrefix,
    'serve',
    '--host',
    url.hostname,
    '--port',
    String(port),
    '--language',
    language,
    ...(quantize ? ['--quantize'] : []),
  ];
}

function positiveMs(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

async function pocketServerHealthy(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/health', serverUrl), {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const body = await response.json() as { status?: string };
    // Do not mistake another service on the port (AudioReader returns "ok")
    // for Pocket's own FastAPI process.
    return body.status === 'healthy';
  } catch {
    return false;
  }
}

function stopPocketServer(): void {
  const child = pocketServerChild;
  pocketServerChild = null;
  pocketServerKey = null;
  if (!child) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already stopped */
  }
}

function registerPocketCleanup(): void {
  if (pocketCleanupRegistered) return;
  pocketCleanupRegistered = true;
  process.once('exit', stopPocketServer);
}

async function launchPocketServer(env: NodeJS.ProcessEnv): Promise<boolean> {
  const serverUrl = resolvePocketServerUrl(env);
  if (await pocketServerHealthy(serverUrl)) return true;
  if (env.CODEBUDDY_POCKET_SERVER === 'false') return false;

  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return false;
  }
  // Auto-start is deliberately local-only. A configured remote URL may be
  // consumed, but Code Buddy never binds a server to a non-loopback interface.
  if (!isLoopbackHost(parsed.hostname)) return false;

  const { pocketLauncherCandidates, resolvePocketLanguage } =
    await import('../talk-mode/providers/pocket-tts.js');
  const language = resolvePocketLanguage(env.CODEBUDDY_POCKET_LANG ?? 'french');
  const key = `${serverUrl}|${language}|${env.CODEBUDDY_POCKET_QUANTIZE === 'true'}`;
  if (pocketServerChild && pocketServerKey !== key) stopPocketServer();
  if (pocketServerChild && pocketServerKey === key && await pocketServerHealthy(serverUrl)) {
    return true;
  }

  const timeoutMs = positiveMs(
    env.CODEBUDDY_POCKET_SERVER_START_TIMEOUT_MS,
    DEFAULT_POCKET_SERVER_START_TIMEOUT_MS
  );
  for (const launcher of pocketLauncherCandidates(undefined, env)) {
    const args = buildPocketServerArgs(
      launcher,
      serverUrl,
      language,
      env.CODEBUDDY_POCKET_QUANTIZE === 'true'
    );
    let stopped = false;
    let child: ChildProcess;
    try {
      child = spawn(launcher.command, args, { stdio: 'ignore' });
    } catch {
      continue;
    }
    child.once('error', () => { stopped = true; });
    child.once('exit', () => { stopped = true; });

    const deadline = Date.now() + timeoutMs;
    while (!stopped && Date.now() < deadline) {
      if (await pocketServerHealthy(serverUrl)) {
        pocketServerChild = child;
        pocketServerKey = key;
        registerPocketCleanup();
        child.once('exit', () => {
          if (pocketServerChild === child) {
            pocketServerChild = null;
            pocketServerKey = null;
          }
        });
        logger.info(`[pocket-tts] resident server ready at ${serverUrl} (${language})`);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    try {
      child.kill('SIGTERM');
    } catch {
      /* already stopped */
    }
  }
  return false;
}

async function ensurePocketServer(env: NodeJS.ProcessEnv): Promise<boolean> {
  if (pocketServerStartPromise) return pocketServerStartPromise;
  const pending = launchPocketServer(env);
  pocketServerStartPromise = pending;
  try {
    return await pending;
  } finally {
    if (pocketServerStartPromise === pending) pocketServerStartPromise = null;
  }
}

function buildPocketRequestBody(text: string, env: NodeJS.ProcessEnv): FormData {
  const voice = (env.CODEBUDDY_POCKET_VOICE ?? 'estelle').trim();
  const form = new FormData();
  form.set('text', text);
  if (voice && existsSync(voice)) {
    const bytes = new Uint8Array(readFileSync(voice));
    form.set('voice_wav', new Blob([bytes]), basename(voice));
  } else if (voice) {
    form.set('voice_url', voice);
  }
  return form;
}

function pocketRequestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Open Pocket's native chunked WAV response without buffering it. The official
 * server emits the WAV header and PCM frames as `generate_audio_stream()` makes
 * them available; callers can pipe this body straight to a player and hear the
 * first audio chunk while synthesis is still running.
 */
export async function openPocketAudioStream(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ReadableStream<Uint8Array> | null> {
  try {
    if (env.CODEBUDDY_POCKET_SERVER === 'false') return null;
    const serverUrl = resolvePocketServerUrl(env);
    if (!(await ensurePocketServer(env))) return null;
    const response = await fetch(new URL('/tts', serverUrl), {
      method: 'POST',
      body: buildPocketRequestBody(text, env),
      signal: pocketRequestSignal(options.timeoutMs ?? 180_000, options.signal),
    });
    if (!response.ok || !response.body) return null;
    return response.body;
  } catch (err) {
    if (!options.signal?.aborted) {
      logger.debug(
        `[pocket-tts] resident stream failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return null;
  }
}

async function synthesizePocketServerWav(
  text: string,
  wavPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
  frozenFactor?: number,
): Promise<boolean> {
  try {
    const stream = await openPocketAudioStream(text, env, { timeoutMs, signal });
    if (!stream) return false;
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const audio = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    if (audio.length <= 44) return false;
    writeFileSync(wavPath, normalizePcm16Wav(audio, env, frozenFactor), { mode: 0o600 });
    return true;
  } catch (err) {
    logger.debug(
      `[pocket-tts] resident synthesis failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
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
  signal?: AbortSignal,
  frozenFactor?: number,
): Promise<boolean> {
  try {
    if (signal?.aborted) return false;
    if (
      env.CODEBUDDY_POCKET_SERVER !== 'false' &&
      await synthesizePocketServerWav(text, wavPath, env, timeoutMs, signal, frozenFactor)
    ) {
      return true;
    }
    if (signal?.aborted) return false;
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
    if (signal?.aborted) return false;
    if (!res?.audio?.length) return false;
    writeFileSync(wavPath, normalizePcm16Wav(res.audio, env, frozenFactor), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Test/process teardown seam. */
export function resetPocketServer(): void {
  stopPocketServer();
  pocketServerStartPromise = null;
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

/** True when the selected local TTS path is resolvable or can be started. */
export function localTtsAvailable(): boolean {
  if (resolveTtsEngine() === 'voicebox') {
    // A live health/profile check is exposed by `buddy assistant voicebox`;
    // this synchronous compatibility API only reports whether it is configured.
    return Boolean(process.env.CODEBUDDY_VOICEBOX_PROFILE?.trim());
  }
  // Pocket auto-resolves through `uvx pocket-tts` and keeps its model resident.
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
  signal?: AbortSignal;
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
    // The same renderer is used for local speech and Telegram voice notes, so a
    // conversation keeps Lisa's voice when it moves between channels.
    const engine = resolveTtsEngine();
    const clean = cleanForSpeech(text);
    let rendered = false;
    if (engine === 'voicebox') {
      const { synthesizeVoiceboxWav } = await import('./voicebox-tts.js');
      rendered = await synthesizeVoiceboxWav(clean, wav, process.env, {
        timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      // Voicebox is expressive but may be running on another machine. Pocket
      // keeps voice notes available when Darkstar is offline or still loading.
      if (!rendered && !options.signal?.aborted) {
        rendered = await synthesizePocketWav(clean, wav, process.env, timeoutMs, options.signal);
      }
    } else if (engine === 'pocket') {
      rendered = await synthesizePocketWav(clean, wav, process.env, timeoutMs, options.signal);
    }
    if (!rendered) {
      if (options.signal?.aborted) throw new Error('TTS synthesis was interrupted');
      await run(bin, piperArgs, { stdin: cleanForSpeech(text), timeoutMs });
      // Piper voices vary substantially in level too. Apply the same assistant
      // volume contract before encoding the Telegram voice note.
      await normalizeWavFile(wav, process.env);
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
