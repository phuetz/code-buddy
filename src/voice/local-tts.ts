/**
 * Text-to-speech → Telegram-ready voice note. Pocket is the unchanged local
 * default; ElevenLabs is an explicit, budget-guarded opt-in.
 *
 * Pipeline: the selected provider writes a mono 24 kHz WAV, then ffmpeg
 * transcodes it to OGG/Opus (the format Telegram voice notes require).
 * Pocket/Piper remain fail-open fallbacks. Returns the .ogg path.
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
import { prepareSpeech } from '../sensory/speech-sanitizer.js';
import type { TtsCache } from '../sensory/tts-cache.js';
import { DEFAULT_ELEVENLABS_MODEL } from '../talk-mode/providers/elevenlabs-client.js';
import { normalizePcm16Wav, normalizeWavFile } from './tts-volume.js';
import {
  DEFAULT_ELEVENLABS_TIMEOUT_MS,
  openElevenLabsPcm24kStream,
  synthesizeElevenLabsPcm24k,
  type ElevenLabsVoiceSynthesisOptions,
  elevenLabsVoiceSettingsSignature,
} from './elevenlabs-voice.js';
import {
  openKyutaiPcm24kStream,
  resolveKyutaiLocalTimeoutMs,
  type KyutaiLocalVoiceOptions,
} from './kyutai-local-voice.js';

export type LocalTtsEngine = 'elevenlabs' | 'kyutai' | 'pocket' | 'voicebox' | 'piper';

const DEFAULT_POCKET_SERVER_URL = 'http://127.0.0.1:8766';
const DEFAULT_POCKET_SERVER_START_TIMEOUT_MS = 120_000;
let pocketServerChild: ChildProcess | null = null;
let pocketServerKey: string | null = null;
let pocketServerStartPromise: Promise<boolean> | null = null;
let pocketCleanupRegistered = false;

/**
 * TTS engine selector. `CODEBUDDY_TTS_VOICE=elevenlabs:<id>` is the sole cloud
 * opt-in; otherwise Pocket remains the default and Piper stays explicit/fallback.
 */
export function resolveTtsEngine(env: NodeJS.ProcessEnv = process.env): LocalTtsEngine {
  if (resolveElevenLabsVoiceId(env)) return 'elevenlabs';
  const configured = (env.CODEBUDDY_TTS_ENGINE ?? '').trim().toLowerCase();
  if (configured === 'piper' || configured === 'voicebox' || configured === 'kyutai') {
    return configured;
  }
  return 'pocket';
}

/** Voice id selected by CODEBUDDY_TTS_VOICE=elevenlabs:<voice_id>. */
export function resolveElevenLabsVoiceId(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const configured = env.CODEBUDDY_TTS_VOICE?.trim() ?? '';
  if (!configured.toLowerCase().startsWith('elevenlabs:')) return null;
  return configured.slice('elevenlabs:'.length).trim() || null;
}

/** Local engine used when the opt-in ElevenLabs route is unavailable. */
export function resolveElevenLabsFallbackEngine(
  env: NodeJS.ProcessEnv = process.env
): 'pocket' | 'piper' {
  return env.CODEBUDDY_TTS_ENGINE?.trim().toLowerCase() === 'piper'
    ? 'piper'
    : 'pocket';
}

/** Complete acoustic identity used by every ElevenLabs cache caller. */
export function resolveElevenLabsCacheVoice(
  env: NodeJS.ProcessEnv = process.env
): string {
  const selectedVoice = env.CODEBUDDY_TTS_VOICE?.trim() || 'elevenlabs:missing';
  const model = env.CODEBUDDY_ELEVENLABS_MODEL?.trim() || DEFAULT_ELEVENLABS_MODEL;
  const settings = elevenLabsVoiceSettingsSignature(env);
  return `${selectedVoice}:model=${model}:format=pcm_24000${settings ? `:settings=${settings}` : ''}`;
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
/**
 * Report why the native stream is gone, then hand back `null`.
 *
 * Losing this stream is not cosmetic: the caller falls back to synthesizing one
 * sentence at a time and the listener hears choppy, gap-ridden speech. The cause
 * used to be logged at debug level — invisible in production — so a degraded
 * voice arrived at the operator as an unexplained defect. It is rare and always
 * consequential, so it warns.
 */
function pocketStreamUnavailable(reason: string): null {
  logger.warn(
    `[pocket-tts] native stream unavailable (${reason}) — falling back to per-sentence synthesis`
  );
  return null;
}

export async function openPocketAudioStream(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ReadableStream<Uint8Array> | null> {
  try {
    // A deliberate opt-out is a choice, not a degradation — stay quiet for it.
    if (env.CODEBUDDY_POCKET_SERVER === 'false') return null;
    const serverUrl = resolvePocketServerUrl(env);
    if (!(await ensurePocketServer(env))) {
      return pocketStreamUnavailable(`resident server unreachable at ${serverUrl}`);
    }
    const response = await fetch(new URL('/tts', serverUrl), {
      method: 'POST',
      body: buildPocketRequestBody(text, env),
      signal: pocketRequestSignal(options.timeoutMs ?? 180_000, options.signal),
    });
    if (!response.ok) return pocketStreamUnavailable(`HTTP ${response.status}`);
    if (!response.body) return pocketStreamUnavailable('response carried no body');
    return response.body;
  } catch (err) {
    // A barge-in aborts on purpose: that is the user interrupting, not a failure.
    if (options.signal?.aborted) return null;
    return pocketStreamUnavailable(err instanceof Error ? err.message : String(err));
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

/** Wrap signed 16-bit little-endian mono PCM in a standard 24 kHz WAV. */
export function pcm16Mono24kToWav(pcm: Buffer): Buffer {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  wav.write('fmt ', 12, 4, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 4, 'ascii');
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

/**
 * 44-byte RIFF/WAVE header for a mono 16-bit 24 kHz PCM stream of UNKNOWN
 * length. RIFF and `data` sizes are 0xFFFFFFFF, the streaming convention that
 * `probePcm16Wav` accepts and `aplay` plays until EOF — the same open-ended
 * shape `Pcm16WavStreamEdges` rewrites onto Pocket's streamed header.
 */
export function pcm16Mono24kStreamWavHeader(): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(0xffff_ffff, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(0xffff_ffff, 40);
  return header;
}

/** Keep at most ~5 minutes of 24 kHz PCM for the cache writeback (a voice sentence is seconds). */
const MAX_STREAM_CAPTURE_BYTES = 5 * 60 * 48_000;

/**
 * Prepend the streaming WAV header to a RAW PCM16/24k body (ElevenLabs
 * `pcm_24000` carries no container) so the existing WAV-expecting chain —
 * `Pcm16WavStreamGain`, `Pcm16WavStreamEdges`, `aplay -q -` — accepts it.
 *
 * `onComplete` fires with the FULL concatenated PCM only when the source body
 * finished cleanly (never on cancel/error/oversize), so a barge-in-truncated
 * clip can never be cached as the complete phrase.
 */
export function wrapPcm16Mono24kStreamAsWav(
  source: ReadableStream<Uint8Array>,
  onComplete?: (pcm: Buffer) => void,
  maxCaptureBytes: number = MAX_STREAM_CAPTURE_BYTES,
): ReadableStream<Uint8Array> {
  let headerSent = false;
  const captured: Buffer[] = [];
  let capturedBytes = 0;
  let overflow = false;
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(pcm16Mono24kStreamWavHeader());
        }
        if (chunk.byteLength === 0) return;
        if (!overflow && onComplete) {
          capturedBytes += chunk.byteLength;
          if (capturedBytes > maxCaptureBytes) {
            overflow = true;
            captured.length = 0;
          } else {
            captured.push(Buffer.from(chunk));
          }
        }
        controller.enqueue(chunk);
      },
      flush: () => {
        if (overflow || capturedBytes === 0 || !onComplete) return;
        try {
          onComplete(Buffer.concat(captured));
        } catch {
          /* cache writeback is best-effort — playback already succeeded */
        }
      },
    })
  );
}

/** Kyutai counterpart of openElevenLabsAudioStream: raw PCM → streaming WAV. */
export async function openKyutaiAudioStream(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  options: KyutaiLocalVoiceOptions & {
    signal?: AbortSignal;
    onPcmComplete?: (pcm: Buffer) => void;
  } = {},
): Promise<ReadableStream<Uint8Array> | null> {
  const stream = await openKyutaiPcm24kStream(
    text,
    env,
    options.signal,
    {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    },
  );
  return stream
    ? wrapPcm16Mono24kStreamAsWav(stream, options.onPcmComplete)
    : null;
}

/** Buffer a complete Kyutai stream into the existing normalized WAV contract. */
export async function synthesizeKyutaiWav(
  text: string,
  wavPath: string,
  env: NodeJS.ProcessEnv = process.env,
  options: KyutaiLocalVoiceOptions & {
    signal?: AbortSignal;
    frozenFactor?: number;
  } = {},
): Promise<boolean> {
  try {
    const stream = await openKyutaiPcm24kStream(
      text,
      env,
      options.signal,
      {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      },
    );
    if (!stream || options.signal?.aborted) return false;
    const reader = stream.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      total += chunk.length;
    }
    if (total === 0 || total % 2 !== 0 || options.signal?.aborted) return false;
    const wav = pcm16Mono24kToWav(Buffer.concat(chunks, total));
    writeFileSync(wavPath, normalizePcm16Wav(wav, env, options.frozenFactor), { mode: 0o600 });
    return true;
  } catch (error) {
    if (!options.signal?.aborted) {
      logger.warn(
        `[kyutai-voice] synthèse interrompue (${error instanceof Error ? error.message : String(error)}); repli ElevenLabs`,
      );
    }
    return false;
  }
}

/**
 * Same visibility contract as `pocketStreamUnavailable`: losing the native
 * ElevenLabs stream means per-sentence blocking synthesis (choppy speech) or a
 * local-voice fallback, so the cause must reach the operator, not debug logs.
 */
function elevenLabsStreamUnavailable(reason: string): null {
  logger.warn(
    `[elevenlabs-voice] native stream unavailable (${reason}) — falling back to per-sentence synthesis`
  );
  return null;
}

/**
 * Open the ElevenLabs native chunked audio stream wrapped as a playable WAV
 * stream — the exact ElevenLabs counterpart of `openPocketAudioStream`. The
 * monthly character budget is enforced inside `openElevenLabsPcm24kStream`
 * BEFORE any network request. Returns `null` on every failure so the caller
 * falls back to the blocking synth path (which itself falls back Pocket/Piper).
 */
export async function openElevenLabsAudioStream(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Full clean PCM writeback hook (used to store the paid clip in the TTS cache). */
    onPcmComplete?: (pcm: Buffer) => void;
  } = {}
): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const voiceId = resolveElevenLabsVoiceId(env);
    if (!voiceId) return null;
    if (options.signal?.aborted) return null;
    const pcmStream = await openElevenLabsPcm24kStream(
      text,
      voiceId,
      env,
      options.signal,
      options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}
    );
    if (!pcmStream) {
      // A barge-in aborts on purpose: the user interrupting is not a failure.
      if (options.signal?.aborted) return null;
      return elevenLabsStreamUnavailable('budget, clé ou réseau indisponible');
    }
    return wrapPcm16Mono24kStreamAsWav(pcmStream, options.onPcmComplete);
  } catch (err) {
    if (options.signal?.aborted) return null;
    return elevenLabsStreamUnavailable(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Synthesize Lisa through ElevenLabs into the WAV contract used by the existing
 * player. Never throws: false tells the caller to use Pocket/Piper immediately.
 */
export async function synthesizeElevenLabsWav(
  text: string,
  wavPath: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = DEFAULT_ELEVENLABS_TIMEOUT_MS,
  signal?: AbortSignal,
  frozenFactor?: number,
  options: ElevenLabsVoiceSynthesisOptions = {}
): Promise<boolean> {
  try {
    const voiceId = resolveElevenLabsVoiceId(env);
    if (!voiceId || signal?.aborted) return false;
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const pcm = await synthesizeElevenLabsPcm24k(
      text,
      voiceId,
      env,
      requestSignal,
      options
    );
    if (!pcm || pcm.length === 0 || pcm.length % 2 !== 0 || signal?.aborted) return false;
    const wav = pcm16Mono24kToWav(pcm);
    writeFileSync(wavPath, normalizePcm16Wav(wav, env, frozenFactor), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export interface KyutaiFallbackWavOptions {
  signal?: AbortSignal;
  frozenFactor?: number;
  kyutai?: KyutaiLocalVoiceOptions;
  elevenLabs?: ElevenLabsVoiceSynthesisOptions;
  pocketTimeoutMs?: number;
}

/**
 * Preserve the phrase across the complete DARK3 degradation chain:
 * Kyutai → ElevenLabs → Pocket. A failed provider never changes or truncates
 * the text handed to the next one.
 */
export async function synthesizeKyutaiWithFallbackWav(
  text: string,
  wavPath: string,
  env: NodeJS.ProcessEnv = process.env,
  options: KyutaiFallbackWavOptions = {},
): Promise<boolean> {
  const signal = options.signal;
  if (signal?.aborted) return false;
  if (await synthesizeKyutaiWav(text, wavPath, env, {
    ...(options.kyutai ?? {}),
    timeoutMs: options.kyutai?.timeoutMs ?? resolveKyutaiLocalTimeoutMs(env),
    ...(signal ? { signal } : {}),
    ...(options.frozenFactor !== undefined ? { frozenFactor: options.frozenFactor } : {}),
  })) {
    return true;
  }
  if (signal?.aborted) return false;

  if (resolveElevenLabsVoiceId(env)) {
    logger.warn('[voice] Kyutai synthesis failed — falling back to ElevenLabs for this phrase');
    if (await synthesizeElevenLabsWav(
      text,
      wavPath,
      env,
      DEFAULT_ELEVENLABS_TIMEOUT_MS,
      signal,
      options.frozenFactor,
      options.elevenLabs,
    )) {
      return true;
    }
  }
  if (signal?.aborted) return false;

  logger.warn('[voice] Kyutai/ElevenLabs synthesis failed — falling back to Pocket for this phrase');
  return synthesizePocketWav(
    text,
    wavPath,
    env,
    options.pocketTimeoutMs ?? 180_000,
    signal,
    options.frozenFactor,
  );
}

/**
 * ElevenLabs route with its fail-open local policy. Pocket is attempted after
 * every cloud failure unless Piper was explicitly selected as the fallback.
 */
export async function synthesizeElevenLabsWithFallbackWav(
  text: string,
  wavPath: string,
  env: NodeJS.ProcessEnv = process.env,
  cloudTimeoutMs = DEFAULT_ELEVENLABS_TIMEOUT_MS,
  localTimeoutMs = 180_000,
  signal?: AbortSignal,
  frozenFactor?: number,
  options: ElevenLabsVoiceSynthesisOptions = {}
): Promise<boolean> {
  try {
    if (await synthesizeElevenLabsWav(
      text,
      wavPath,
      env,
      cloudTimeoutMs,
      signal,
      frozenFactor,
      options
    )) {
      return true;
    }
    if (signal?.aborted || resolveElevenLabsFallbackEngine(env) === 'piper') return false;
    return await synthesizePocketWav(
      text,
      wavPath,
      env,
      localTimeoutMs,
      signal,
      frozenFactor
    );
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
  const engine = resolveTtsEngine();
  if (engine === 'elevenlabs') {
    // ElevenLabs is fail-open: Pocket/Piper remains the availability contract.
    return true;
  }
  if (engine === 'voicebox') {
    // A live health/profile check is exposed by `buddy assistant voicebox`;
    // this synchronous compatibility API only reports whether it is configured.
    return Boolean(process.env.CODEBUDDY_VOICEBOX_PROFILE?.trim());
  }
  if (engine === 'kyutai') return true;
  // Pocket auto-resolves through `uvx pocket-tts` and keeps its model resident.
  if (engine === 'pocket') return true;
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

/** Build the Telegram transcode arguments with the shared speech loudness target. */
export function buildTelegramFfmpegArgs(
  wav: string,
  ogg: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const loudnorm = env.CODEBUDDY_TTS_TELEGRAM_LOUDNORM !== 'false'
    ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
    : [];
  return [
    '-y',
    '-loglevel',
    'error',
    '-i',
    wav,
    ...loudnorm,
    '-ac',
    '1',
    '-c:a',
    'libopus',
    '-b:a',
    '32k',
    ogg,
  ];
}

/**
 * Turn Markdown into clean prose for speech, so the TTS doesn't literally read
 * out "asterisk asterisk", backticks, hashes or bullet dashes — it should sound
 * like a person talking, not a screen reader narrating syntax.
 */
export function cleanForSpeech(text: string): string {
  return prepareSpeech(text) ?? '';
}

/**
 * Synthesize `text` to an OGG/Opus file (Telegram voice-note format) and return
 * its path. Caller is responsible for deleting the file. Throws only when all
 * speech fallbacks or ffmpeg fail; callers then use a text-only reply.
 */
export async function synthesizeToOgg(text: string, options: LocalTtsOptions = {}): Promise<string> {
  const bin = resolvePiperBin();
  const voice = resolvePiperVoice();
  const ffmpeg = options.ffmpeg || 'ffmpeg';
  const timeoutMs = options.timeoutMs ?? 60_000;
  const stamp = `${process.pid}-${Date.now()}`;
  let wav = join(tmpdir(), `cb-tts-${stamp}.wav`);
  const ogg = join(tmpdir(), `cb-tts-${stamp}.ogg`);

  const piperArgs = ['--output_file', wav];
  if (voice) piperArgs.push('--model', voice);

  try {
    // The same renderer is used for local speech and Telegram voice notes, so a
    // conversation keeps Lisa's voice when it moves between channels.
    const engine = resolveTtsEngine();
    const clean = cleanForSpeech(text);
    if (!clean) throw new Error('TTS text is empty after speech sanitization');
    let rendered = false;
    let fallbackEngine: LocalTtsEngine = engine;
    let elevenLabsRendered = false;
    let elevenLabsCache: TtsCache | undefined;
    if (engine === 'elevenlabs') {
      if (process.env.CODEBUDDY_TTS_CACHE !== 'false') {
        try {
          const { getTtsCache } = await import('../sensory/tts-cache.js');
          elevenLabsCache = getTtsCache();
          const hit = elevenLabsCache.lookup(clean, resolveElevenLabsCacheVoice());
          if (hit) {
            wav = hit;
            rendered = true;
          }
        } catch {
          /* cache failures never delay or break speech */
        }
      }
      if (!rendered) {
        elevenLabsRendered = await synthesizeElevenLabsWav(
          clean,
          wav,
          process.env,
          Math.min(timeoutMs, DEFAULT_ELEVENLABS_TIMEOUT_MS),
          options.signal
        );
        rendered = elevenLabsRendered;
      }
      if (elevenLabsRendered && elevenLabsCache) {
        try {
          elevenLabsCache.store(clean, resolveElevenLabsCacheVoice(), wav);
        } catch {
          /* best-effort cache */
        }
      }
      fallbackEngine = resolveElevenLabsFallbackEngine();
    }
    if (!rendered && fallbackEngine === 'voicebox') {
      const { synthesizeVoiceboxWav } = await import('./voicebox-tts.js');
      rendered = await synthesizeVoiceboxWav(clean, wav, process.env, {
        timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      // Voicebox is expressive but may be running on another machine. Pocket
      // keeps voice notes available when GPU node is offline or still loading.
      if (!rendered && !options.signal?.aborted) {
        rendered = await synthesizePocketWav(clean, wav, process.env, timeoutMs, options.signal);
      }
    } else if (!rendered && fallbackEngine === 'pocket') {
      rendered = await synthesizePocketWav(clean, wav, process.env, timeoutMs, options.signal);
    }
    if (!rendered) {
      if (options.signal?.aborted) throw new Error('TTS synthesis was interrupted');
      await run(bin, piperArgs, { stdin: clean, timeoutMs });
      // Piper voices vary substantially in level too. Apply the same assistant
      // volume contract before encoding the Telegram voice note.
      await normalizeWavFile(wav, process.env);
    }
    // Telegram voice notes want OGG/Opus mono. 32 kbps is plenty for speech.
    await run(
      ffmpeg,
      buildTelegramFfmpegArgs(wav, ogg),
      { timeoutMs },
    );
    return ogg;
  } finally {
    await unlink(wav).catch(() => undefined);
  }
}
