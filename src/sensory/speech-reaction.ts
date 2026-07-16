/**
 * Speech reaction — closes the perception→cognition loop. Two input paths feed the
 * SAME cognition (respond gate → `hearing` percept → optional `onHeard` action):
 *   - batch: a `speech_end` event carrying the source WAV (the daemon tags it) →
 *     transcribe the utterance here (STT);
 *   - live: an `audio/transcript_final` event from buddy-sense's `live-audio` sense
 *     whose payload ALREADY carries the decoded text → no WAV, no STT on this side.
 * DEBOUNCED (one transcription per utterance — the energy VAD over-segments), opt-in
 * (`CODEBUDDY_SENSORY_SPEECH=true`), injectable transcriber, never-throws.
 * Processed fallback WAVs are ephemeral and removed after the job settles. Set
 * `CODEBUDDY_SENSORY_KEEP_WAV=true` to retain them for audio/STT debugging.
 *
 * @module sensory/speech-reaction
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { basename, delimiter, dirname, join, resolve } from 'path';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { Interface as ReadlineInterface } from 'readline';
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import {
  classifyRecentVoiceEcho,
  isSpeaking,
  measureVoiceResumeTiming,
} from './voice-activity.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';
import {
  resolveSpeechRecognitionEngine,
  resolveParakeetModelDir,
  expandSpeechPath,
  type SpeechRecognitionEngine,
} from './speech-engine-config.js';
import { resolveUserName } from '../companion/user-name.js';
import {
  isLikelyIncompleteVoiceTurn,
  joinVoiceTurnFragments,
  resolveIncompleteTurnHoldMs,
} from './voice-turn-taking.js';
import type { VoiceDeliveryProfile, VoiceTurnContext } from './voice-entrainment.js';
import { getVoiceTurnCoordinator } from './voice-turn-coordinator.js';
import { assessAudioScene, type AudioSceneAssessment } from './audio-scene.js';

// Re-exported for back-compat: callers + tests import these from speech-reaction.
export { resolveSpeechRecognitionEngine };
export type { SpeechRecognitionEngine };

export type Transcriber = (wav: string) => Promise<string>;

export interface RecognizedVoiceTurn {
  turnId: string;
  text: string;
  context: VoiceTurnContext;
}

export interface PartialVoiceTranscript {
  text: string;
  audioMs?: number;
  decodeMs?: number;
}

export interface SpeechReactionOptions {
  /** Injectable STT (tests / custom). Default: faster-whisper via python ($0). */
  transcriber?: Transcriber;
  debounceMs?: number;
  /** Maximum wait used only when a fast VAD final ends on an unfinished phrase. */
  incompleteTurnHoldMs?: number;
  cwd?: string;
  now?: () => number;
  /** Action hook for the transcript (e.g. trigger an agent turn). */
  onHeard?: (text: string, context?: VoiceTurnContext) => void | Promise<void>;
  /**
   * Fire-and-forget semantic ingress for memory and background specialists.
   * It starts after the response gate accepts the turn, but before LLM/TTS, and
   * never owns the mouth lock. Raw rejected hearing remains in the percept log.
   */
  onRecognizedTurn?: (turn: RecognizedVoiceTurn) => void | Promise<void>;
  /**
   * Acoustic turn-open hook, fired immediately when the Rust VAD opens — before
   * endpointing and STT. Intended only for idempotent preparation (imports,
   * prompt/MCP warmup); it must never be interpreted as permission to reply.
   */
  onSpeechStart?: (payload: Record<string, unknown>) => void | Promise<void>;
  /**
   * Unstable local transcript used only to retarget predictive preparation.
   * It must never trigger a reply, tool, memory write, or response decision.
   */
  onSpeechPartial?: (partial: PartialVoiceTranscript) => void | Promise<void>;
  /** Interrupt the active think/speak turn when an explicit barge-in transcript arrives. */
  onBargeIn?: (text: string, interruptedTurnId?: string) => void;
  /**
   * Human-like response gate. The percept is ALWAYS recorded (observation/memory stay
   * continuous); `onHeard` only fires when this returns `respond: true`. Omit → respond to
   * everything (today's behavior). See `respond-decider.ts`.
   */
  shouldRespond?: (text: string) => Promise<{ respond: boolean; reason: string }>;
  /** Raw-free state of the shared conversational attention window. */
  getAttentionSnapshot?: () => {
    engaged: boolean;
    source?: 'addressed' | 'greeting' | 'arrival';
    remainingMs: number;
    dialogueAgeMs: number;
    closeReason?: string;
  };
  /** Optional timing handoff from the response handler (e.g. `makeVoiceReply`). */
  getResponseTiming?: () =>
    | {
        mode: string;
        promptReadyMs?: number;
        providerFirstDeltaMs?: number;
        generationCompleteMs?: number;
        semanticReviewCompleteMs?: number;
        spokenPrefix?: {
          outcome: string;
          causes: string[];
          promptReadyMs?: number;
          providerFirstDeltaMs?: number;
          generationCompleteMs?: number;
          semanticReviewCompleteMs?: number;
        };
        continuation?: {
          promptReadyMs?: number;
          providerFirstDeltaMs?: number;
          generationCompleteMs?: number;
          semanticReviewCompleteMs?: number;
        };
        firstSafeReleaseMs?: number;
        firstTextMs?: number;
        firstSegmentMs?: number;
        firstAudioMs?: number;
        firstContentAudioMs?: number;
        streamFallbackSegments?: number;
        totalMs: number;
        spoke: boolean;
        delivery?: VoiceDeliveryProfile;
      }
    | undefined;
}

/**
 * Safe half-duplex barge-in gate. Requiring the assistant name or an explicit
 * stop phrase avoids treating its own loudspeaker echo as a human interruption.
 */
export function isBargeInTranscript(
  text: string,
  robotName: string = process.env.CODEBUDDY_ROBOT_NAME || 'Lisa'
): boolean {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  const name = robotName
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (name && new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(normalized)) {
    return true;
  }
  return /^(stop|arrete|tais toi|attends|une seconde|laisse moi parler)(\s|$)/.test(normalized);
}

export const DEFAULT_VOICE_BARGEIN_MIN_MS = 500;

export function resolveVoiceBargeInMinMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_VOICE_BARGEIN_MIN_MS);
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_VOICE_BARGEIN_MIN_MS;
  return Math.min(10_000, Math.floor(configured));
}

function capturedSpeechMs(payload: Record<string, unknown>): number | undefined {
  const durations = [
    finiteTimestamp(payload.audioMs),
    finiteTimestamp(payload.ms),
    finiteTimestamp(payload.durationMs),
  ].filter((value): value is number => value !== undefined && value >= 0);
  const startedAtMs = finiteTimestamp(payload.startedAtMs);
  const endedAtMs = finiteTimestamp(payload.endedAtMs);
  if (startedAtMs !== undefined && endedAtMs !== undefined && endedAtMs >= startedAtMs) {
    durations.push(endedAtMs - startedAtMs);
  }
  return durations.length > 0 ? Math.max(...durations) : undefined;
}

/** Explicit wake/stop always works; AEC additionally permits sustained natural speech. */
export function shouldTriggerVoiceBargeIn(
  text: string,
  payload: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isBargeInTranscript(text)) return true;
  if (payload.aecActive !== true) return false;
  return (capturedSpeechMs(payload) ?? 0) >= resolveVoiceBargeInMinMs(env);
}

/**
 * Deduplicate repeated `speech_end` events without imposing a multi-second pause between
 * human turns. Playback echo is already covered independently by `voice-activity`'s
 * speaking guard + echo tail, so this only needs to absorb duplicate capture events.
 */
export const DEFAULT_SPEECH_DEBOUNCE_MS = 800;

/**
 * Decide whether a transcript captured around loudspeaker playback is safe to
 * treat as a human turn. During playback we deliberately fail closed: without
 * acoustic echo cancellation, only an explicit barge-in (Lisa/stop/attends…)
 * may pass. With AEC, sustained speech is trusted as human input even while
 * playback is active. In the short acoustic tail, the existing similarity
 * classifier remains authoritative.
 */
export function shouldSuppressPlaybackCapture(
  kind: 'during_playback' | 'echo_tail',
  classification: 'echo' | 'distinct' | 'unknown',
  explicitBargeIn: boolean,
  aecActive = false,
): boolean {
  if (kind === 'during_playback') {
    if (aecActive && explicitBargeIn) return false;
    return classification === 'echo' || !explicitBargeIn;
  }
  return classification !== 'distinct';
}

/** Debug kill switch: keep fallback utterance WAVs instead of deleting them. */
export const SPEECH_KEEP_WAV_ENV = 'CODEBUDDY_SENSORY_KEEP_WAV';

export function resolveSpeechDebounceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEBUDDY_SPEECH_DEBOUNCE_MS?.trim();
  if (!raw) return DEFAULT_SPEECH_DEBOUNCE_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SPEECH_DEBOUNCE_MS;
}

function companionAudioDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = [
    env.BUDDY_EAR_WAV_DIR?.trim(),
    env.CODEBUDDY_COMPANION_AUDIO_DIR?.trim(),
  ].filter((value): value is string => Boolean(value));
  return [...new Set([
    resolve(join(homedir(), '.codebuddy', 'companion')),
    ...configured.map(value => resolve(expandSpeechPath(value))),
  ])];
}

/**
 * Remove only producer-owned fallback audio. An event payload is untrusted: a
 * path outside the configured companion directory, a symlink, or any filename
 * other than `utt-<digits>.wav` is never removed.
 */
async function removeProcessedCompanionWav(wav: string): Promise<void> {
  if (truthyEnv(SPEECH_KEEP_WAV_ENV, false)) return;
  if (!/^utt-\d+\.wav$/.test(basename(wav))) return;

  const candidate = resolve(expandSpeechPath(wav));
  const candidateParent = dirname(candidate);
  const allowedDirectory = companionAudioDirectories().find(dir => dir === candidateParent);
  if (!allowedDirectory) return;

  try {
    const { lstat, realpath, unlink } = await import('node:fs/promises');
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) return;
    const [realParent, realAllowedDirectory] = await Promise.all([
      realpath(candidateParent),
      realpath(allowedDirectory),
    ]);
    if (realParent !== realAllowedDirectory) return;
    await unlink(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.debug('[speech] fallback WAV cleanup skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function resolveSpeechPython(): string {
  const configured =
    process.env.CODEBUDDY_SPEECH_PYTHON ||
    process.env.CODEBUDDY_VOICE_PYTHON ||
    process.env.COWORK_VOICE_PYTHON ||
    process.env.CODEBUDDY_PYTHON_BIN;
  if (configured?.trim()) return configured.trim();

  const candidates = [
    join(homedir(), '.codebuddy/voice/.venv/bin/python'),
    join(homedir(), 'DEV/ai-stack/voice/.venv/bin/python'),
    join(homedir(), 'ai-stack/voice/.venv/bin/python'),
    join(homedir(), 'vision_tests/venv/bin/python'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || 'python3';
}

function truthyEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function numericEnv(name: string, defaultValue: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

export interface FasterWhisperTranscribeOptions {
  language?: string;
  beamSize: number;
  vadFilter: boolean;
  conditionOnPreviousText: boolean;
  initialPrompt?: string;
  hotwords?: string;
}

export interface NormalizedSpeechTranscript {
  text: string;
  filteredReason?:
    | 'subtitle_hallucination'
    | 'prompt_leakage'
    | 'non_speech'
    | 'repetitive_noise'
    | 'filler_noise';
}

interface FasterWhisperWorkerMessage {
  ready?: boolean;
  id?: string;
  text?: string;
  error?: string;
}

interface PendingWorkerRequest {
  resolve: (text: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface FasterWhisperWorker {
  key: string;
  proc: ChildProcessWithoutNullStreams;
  rl: ReadlineInterface;
  ready: Promise<void>;
  readySettled: boolean;
  pending: Map<string, PendingWorkerRequest>;
}

let fasterWhisperWorker: FasterWhisperWorker | null = null;
let fasterWhisperWorkerSeq = 0;
let parakeetWorker: FasterWhisperWorker | null = null;
let parakeetWorkerSeq = 0;
// In-process Rust STT (`buddy-sense stt`) — same persistent-worker protocol as the
// python workers above, but the recognizer runs in-process (sherpa-onnx) so there is
// no python on the hot path. The python whisper/parakeet workers stay as fallback.
let sherpaRustWorker: FasterWhisperWorker | null = null;
let sherpaRustWorkerSeq = 0;

function defaultSpeechInitialPrompt(): string {
  return 'Transcription en français. Ne complète pas les silences.';
}

function splitSpeechPhrases(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parakeetFallbackEnabled(): boolean {
  return process.env.CODEBUDDY_SPEECH_FALLBACK?.trim().toLowerCase() !== 'false';
}

/**
 * Locate the `buddy-sense` binary built with `--features stt`. Explicit override via
 * CODEBUDDY_SPEECH_STT_BIN, else the conventional cargo output under the repo's
 * `buddy-sense/target/{release,debug}/` (resolved from both cwd and this module's
 * location, so it works under tsx-src and dist alike). Returns the first existing
 * candidate, or '' when none is found (caller falls back to python STT).
 */
function resolveSherpaRustBin(): string {
  const explicit = process.env.CODEBUDDY_SPEECH_STT_BIN?.trim();
  if (explicit) return expandSpeechPath(explicit);
  const roots = new Set<string>();
  roots.add(process.cwd());
  try {
    // …/src/sensory/ or …/dist/sensory/ → repo root is two levels up.
    roots.add(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  } catch {
    // import.meta.url unavailable (some test transforms) — cwd candidate suffices.
  }
  for (const root of roots) {
    for (const profile of ['release', 'debug']) {
      const candidate = join(root, 'buddy-sense', 'target', profile, 'buddy-sense');
      if (existsSync(candidate)) return candidate;
    }
  }
  return '';
}

function sherpaRustThreads(): number {
  return numericEnv('CODEBUDDY_SPEECH_STT_THREADS', numericEnv('CODEBUDDY_SPEECH_THREADS', 4));
}

function readSpeechHotwordsFile(filePath: string): string[] {
  try {
    return splitSpeechPhrases(readFileSync(expandSpeechPath(filePath), 'utf8'));
  } catch (err) {
    logger.warn(
      `[speech] could not read CODEBUDDY_SPEECH_HOTWORDS_FILE '${filePath}': ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

function defaultSpeechHotwords(): string {
  const phrases = [
    process.env.CODEBUDDY_ROBOT_NAME?.trim(),
    'Lisa',
    'Buddy',
    'Code Buddy',
    resolveUserName(),
    ...splitSpeechPhrases(process.env.CODEBUDDY_SPEECH_HOTWORDS ?? ''),
    ...(process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE?.trim()
      ? readSpeechHotwordsFile(process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE.trim())
      : []),
  ].filter(Boolean) as string[];
  return [...new Set(phrases)].slice(0, 80).join(', ');
}

export function resolveFasterWhisperOptions(): FasterWhisperTranscribeOptions {
  const language =
    process.env.CODEBUDDY_SPEECH_LANG?.trim() ||
    process.env.CODEBUDDY_COMPANION_LANGUAGE?.trim() ||
    'fr';
  const initialPrompt =
    process.env.CODEBUDDY_SPEECH_INITIAL_PROMPT?.trim() || defaultSpeechInitialPrompt();
  const hotwords = defaultSpeechHotwords();
  return {
    language,
    beamSize: numericEnv('CODEBUDDY_SPEECH_BEAM_SIZE', 1),
    vadFilter: truthyEnv('CODEBUDDY_SPEECH_VAD_FILTER', true),
    conditionOnPreviousText: truthyEnv('CODEBUDDY_SPEECH_CONDITION_PREVIOUS_TEXT', false),
    initialPrompt,
    ...(hotwords ? { hotwords } : {}),
  };
}

const SUBTITLE_HALLUCINATION_PATTERNS = [
  /\bsous[-\s]?titres?\b.*\b(amara|communaut[eé]|r[ée]alis[ée]s?)\b/i,
  /\bsous[-\s]?titrage\b.*\b(soci[ée]t[ée]\s+radio[-\s]?canada|radio[-\s]?canada)\b/i,
  /\bamara\.org\b/i,
  /\bmerci d['’]avoir regard[ée]\b/i,
  /\bn['’]h[ée]sitez pas [àa] vous abonner\b/i,
  /\bthank you for watching\b/i,
  /\bsubtitles? by\b/i,
  /\bcaptions? by\b/i,
  /\btranscribed by\b/i,
];

const PROMPT_LEAKAGE_PATTERNS = [
  /\b(transcription|conversation|conservation|fascination)\s+en\s+fran[çc]ais\b/i,
  /\bconserve\s+les\s+noms\s+propres\b/i,
];

function looksLikeRepetitiveNoise(text: string): boolean {
  const compact = text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]/gu, '');
  if (compact.length < 6) return false;
  const unique = new Set([...compact]);
  if (unique.size === 1) return true;
  return /^(.{1,3})\1{3,}$/.test(compact);
}

function looksLikeFillerNoise(text: string): boolean {
  const compact = text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}]/gu, '');
  return /^(m+|hm+|hmm+|mmh+|euh+|heu+|hum+)$/.test(compact);
}

export function normalizeSpeechTranscript(raw: string): NormalizedSpeechTranscript {
  const text = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text) return { text: '' };
  if (!/[\p{L}\p{N}]/u.test(text)) {
    return { text: '', filteredReason: 'non_speech' };
  }
  if (SUBTITLE_HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { text: '', filteredReason: 'subtitle_hallucination' };
  }
  if (PROMPT_LEAKAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { text: '', filteredReason: 'prompt_leakage' };
  }
  if (looksLikeRepetitiveNoise(text)) {
    return { text: '', filteredReason: 'repetitive_noise' };
  }
  if (looksLikeFillerNoise(text)) {
    return { text: '', filteredReason: 'filler_noise' };
  }
  return { text };
}

function elapsedSince(startMs: number, now: () => number): number {
  return Math.max(0, now() - startMs);
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function speechWorkerEnabled(): boolean {
  if (process.env.CODEBUDDY_SPEECH_WORKER?.trim()) {
    return truthyEnv('CODEBUDDY_SPEECH_WORKER', true);
  }
  return truthyEnv('CODEBUDDY_SENSORY_SPEECH', false);
}

function buildPythonTranscribeKwargs(options: FasterWhisperTranscribeOptions): string {
  return [
    options.language ? `"language": ${JSON.stringify(options.language)}` : '',
    `"beam_size": ${options.beamSize}`,
    `"vad_filter": ${options.vadFilter ? 'True' : 'False'}`,
    `"condition_on_previous_text": ${options.conditionOnPreviousText ? 'True' : 'False'}`,
    options.initialPrompt ? `"initial_prompt": ${JSON.stringify(options.initialPrompt)}` : '',
    options.hotwords ? `"hotwords": ${JSON.stringify(options.hotwords)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function buildFasterWhisperWorkerScript(
  model: string,
  options: FasterWhisperTranscribeOptions
): string {
  const transcribeKwargs = buildPythonTranscribeKwargs(options);
  return [
    'import inspect, json, sys, traceback',
    'from faster_whisper import WhisperModel',
    `m = WhisperModel(${JSON.stringify(model)}, device='cpu', compute_type='int8')`,
    `kwargs = {${transcribeKwargs}}`,
    'supported_kwargs = set(inspect.signature(m.transcribe).parameters.keys())',
    'kwargs = {k: v for k, v in kwargs.items() if k in supported_kwargs}',
    "print(json.dumps({'ready': True}), flush=True)",
    'for line in sys.stdin:',
    '    line = line.strip()',
    '    if not line:',
    '        continue',
    '    try:',
    '        req = json.loads(line)',
    "        req_id = req.get('id')",
    "        wav = req.get('wav')",
    '        segs, _ = m.transcribe(wav, **kwargs)',
    "        text = ' '.join(s.text for s in segs).strip()",
    "        print(json.dumps({'id': req_id, 'text': text}), flush=True)",
    '    except Exception as exc:',
    "        print(json.dumps({'id': locals().get('req_id'), 'error': str(exc)}), flush=True)",
    '        traceback.print_exc(file=sys.stderr)',
  ].join('\n');
}

function buildParakeetWorkerScript(modelDir: string, numThreads: number): string {
  return [
    'import json, sys, traceback, wave',
    'import numpy as np',
    'import sherpa_onnx',
    `model_dir = ${JSON.stringify(modelDir)}`,
    'rec = sherpa_onnx.OfflineRecognizer.from_transducer(',
    "    encoder=f'{model_dir}/encoder.int8.onnx',",
    "    decoder=f'{model_dir}/decoder.int8.onnx',",
    "    joiner=f'{model_dir}/joiner.int8.onnx',",
    "    tokens=f'{model_dir}/tokens.txt',",
    `    num_threads=${numThreads},`,
    "    decoding_method='greedy_search',",
    "    model_type='nemo_transducer',",
    ')',
    'def transcribe(wav):',
    "    with wave.open(wav, 'rb') as wf:",
    '        sr = wf.getframerate()',
    '        channels = wf.getnchannels()',
    '        width = wf.getsampwidth()',
    '        raw = wf.readframes(wf.getnframes())',
    '    if width != 2:',
    "        raise RuntimeError(f'expected 16-bit PCM WAV, got sample width {width}')",
    '    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0',
    '    if channels > 1:',
    '        audio = audio.reshape(-1, channels)[:, 0]',
    '    stream = rec.create_stream()',
    '    stream.accept_waveform(sr, audio)',
    '    rec.decode_stream(stream)',
    "    return getattr(stream.result, 'text', str(stream.result)).strip()",
    "print(json.dumps({'ready': True}), flush=True)",
    'for line in sys.stdin:',
    '    line = line.strip()',
    '    if not line:',
    '        continue',
    '    try:',
    '        req = json.loads(line)',
    "        req_id = req.get('id')",
    "        wav = req.get('wav')",
    "        print(json.dumps({'id': req_id, 'text': transcribe(wav)}), flush=True)",
    '    except Exception as exc:',
    "        print(json.dumps({'id': locals().get('req_id'), 'error': str(exc)}), flush=True)",
    '        traceback.print_exc(file=sys.stderr)',
  ].join('\n');
}

function fasterWhisperWorkerKey(
  python: string,
  model: string,
  options: FasterWhisperTranscribeOptions
): string {
  return JSON.stringify({ python, model, options });
}

function parakeetWorkerKey(python: string, modelDir: string, numThreads: number): string {
  return JSON.stringify({ python, modelDir, numThreads });
}

function settlePending(worker: FasterWhisperWorker, text: string): void {
  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timeout);
    pending.resolve(text);
  }
  worker.pending.clear();
}

function disposeFasterWhisperWorker(worker: FasterWhisperWorker): void {
  if (fasterWhisperWorker === worker) fasterWhisperWorker = null;
  settlePending(worker, '');
  worker.rl.close();
  worker.proc.stdin.destroy();
  worker.proc.kill();
}

function disposeParakeetWorker(worker: FasterWhisperWorker): void {
  if (parakeetWorker === worker) parakeetWorker = null;
  settlePending(worker, '');
  worker.rl.close();
  worker.proc.stdin.destroy();
  worker.proc.kill();
}

async function createFasterWhisperWorker(
  python: string,
  model: string,
  options: FasterWhisperTranscribeOptions
): Promise<FasterWhisperWorker> {
  const { spawn } = await import('child_process');
  const { createInterface } = await import('readline');
  const key = fasterWhisperWorkerKey(python, model, options);
  const proc = spawn(python, ['-u', '-c', buildFasterWhisperWorkerScript(model, options)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let resolveReady: () => void = () => {};
  let rejectReady: (err: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const worker: FasterWhisperWorker = {
    key,
    proc,
    rl: createInterface({ input: proc.stdout }),
    ready,
    readySettled: false,
    pending: new Map(),
  };

  let stderr = '';
  proc.stderr.on('data', (data) => {
    stderr = `${stderr}${String(data)}`.slice(-2_000);
  });
  worker.rl.on('line', (line) => {
    let message: FasterWhisperWorkerMessage;
    try {
      message = JSON.parse(line) as FasterWhisperWorkerMessage;
    } catch {
      logger.warn(`[speech] STT worker emitted invalid JSON: ${line.slice(0, 160)}`);
      return;
    }
    if (message.ready) {
      worker.readySettled = true;
      resolveReady();
      return;
    }
    const id = message.id;
    if (!id) return;
    const pending = worker.pending.get(id);
    if (!pending) return;
    worker.pending.delete(id);
    clearTimeout(pending.timeout);
    if (message.error) {
      logger.warn(`[speech] STT worker request failed: ${message.error.slice(0, 300)}`);
      pending.resolve('');
      return;
    }
    pending.resolve(message.text?.trim() || '');
  });
  proc.on('close', (code) => {
    if (fasterWhisperWorker === worker) fasterWhisperWorker = null;
    settlePending(worker, '');
    if (!worker.readySettled) {
      rejectReady(new Error(`faster-whisper worker exited before ready (code=${code})`));
    }
    if (stderr.trim()) {
      logger.warn(`[speech] STT worker closed (code=${code}): ${stderr.trim().slice(0, 300)}`);
    }
  });
  proc.on('error', (err) => {
    if (fasterWhisperWorker === worker) fasterWhisperWorker = null;
    settlePending(worker, '');
    if (!worker.readySettled) rejectReady(err);
  });
  fasterWhisperWorker = worker;
  return worker;
}

async function createParakeetWorker(
  python: string,
  modelDir: string,
  numThreads: number
): Promise<FasterWhisperWorker> {
  const { spawn } = await import('child_process');
  const { createInterface } = await import('readline');
  const key = parakeetWorkerKey(python, modelDir, numThreads);
  const proc = spawn(python, ['-u', '-c', buildParakeetWorkerScript(modelDir, numThreads)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let resolveReady: () => void = () => {};
  let rejectReady: (err: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const worker: FasterWhisperWorker = {
    key,
    proc,
    rl: createInterface({ input: proc.stdout }),
    ready,
    readySettled: false,
    pending: new Map(),
  };

  let stderr = '';
  proc.stderr.on('data', (data) => {
    stderr = `${stderr}${String(data)}`.slice(-2_000);
  });
  worker.rl.on('line', (line) => {
    let message: FasterWhisperWorkerMessage;
    try {
      message = JSON.parse(line) as FasterWhisperWorkerMessage;
    } catch {
      logger.warn(`[speech] Parakeet worker emitted invalid JSON: ${line.slice(0, 160)}`);
      return;
    }
    if (message.ready) {
      worker.readySettled = true;
      resolveReady();
      return;
    }
    const id = message.id;
    if (!id) return;
    const pending = worker.pending.get(id);
    if (!pending) return;
    worker.pending.delete(id);
    clearTimeout(pending.timeout);
    if (message.error) {
      logger.warn(`[speech] Parakeet request failed: ${message.error.slice(0, 300)}`);
      pending.resolve('');
      return;
    }
    pending.resolve(message.text?.trim() || '');
  });
  proc.on('close', (code) => {
    if (parakeetWorker === worker) parakeetWorker = null;
    settlePending(worker, '');
    if (!worker.readySettled) {
      rejectReady(new Error(`Parakeet worker exited before ready (code=${code})`));
    }
    if (stderr.trim()) {
      logger.warn(`[speech] Parakeet worker closed (code=${code}): ${stderr.trim().slice(0, 300)}`);
    }
  });
  proc.on('error', (err) => {
    if (parakeetWorker === worker) parakeetWorker = null;
    settlePending(worker, '');
    if (!worker.readySettled) rejectReady(err);
  });
  parakeetWorker = worker;
  return worker;
}

async function getFasterWhisperWorker(
  python: string,
  model: string,
  options: FasterWhisperTranscribeOptions
): Promise<FasterWhisperWorker> {
  const key = fasterWhisperWorkerKey(python, model, options);
  if (fasterWhisperWorker?.key === key) return fasterWhisperWorker;
  if (fasterWhisperWorker) disposeFasterWhisperWorker(fasterWhisperWorker);
  return createFasterWhisperWorker(python, model, options);
}

async function getParakeetWorker(
  python: string,
  modelDir: string,
  numThreads: number
): Promise<FasterWhisperWorker> {
  const key = parakeetWorkerKey(python, modelDir, numThreads);
  if (parakeetWorker?.key === key) return parakeetWorker;
  if (parakeetWorker) disposeParakeetWorker(parakeetWorker);
  return createParakeetWorker(python, modelDir, numThreads);
}

async function waitForWorkerReady(worker: FasterWhisperWorker, timeoutMs?: number): Promise<void> {
  timeoutMs ??= numericEnv('CODEBUDDY_SPEECH_WORKER_READY_TIMEOUT_MS', 30_000);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      worker.ready,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`faster-whisper worker did not become ready within ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function transcribeWavWithWorker(
  wav: string,
  python: string,
  model: string,
  options: FasterWhisperTranscribeOptions
): Promise<string> {
  const worker = await getFasterWhisperWorker(python, model, options);
  await waitForWorkerReady(worker);
  const timeoutMs = numericEnv('CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS', 20_000);
  const id = `speech-${Date.now()}-${++fasterWhisperWorkerSeq}`;
  return new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      worker.pending.delete(id);
      logger.warn(`[speech] STT worker request timed out after ${timeoutMs}ms`);
      disposeFasterWhisperWorker(worker);
      resolve('');
    }, timeoutMs);
    worker.pending.set(id, { resolve, timeout });
    try {
      worker.proc.stdin.write(`${JSON.stringify({ id, wav })}\n`);
    } catch (err) {
      worker.pending.delete(id);
      clearTimeout(timeout);
      throw err;
    }
  });
}

async function transcribeWavWithParakeetWorker(
  wav: string,
  python: string,
  modelDir: string,
  numThreads: number
): Promise<string> {
  const worker = await getParakeetWorker(python, modelDir, numThreads);
  await waitForWorkerReady(worker);
  const timeoutMs = numericEnv('CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS', 20_000);
  const id = `parakeet-${Date.now()}-${++parakeetWorkerSeq}`;
  return new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      worker.pending.delete(id);
      logger.warn(`[speech] Parakeet worker request timed out after ${timeoutMs}ms`);
      disposeParakeetWorker(worker);
      resolve('');
    }, timeoutMs);
    worker.pending.set(id, { resolve, timeout });
    try {
      worker.proc.stdin.write(`${JSON.stringify({ id, wav })}\n`);
    } catch (err) {
      worker.pending.delete(id);
      clearTimeout(timeout);
      throw err;
    }
  });
}

async function transcribeWavOneShot(
  wav: string,
  python: string,
  model: string,
  options: FasterWhisperTranscribeOptions
): Promise<string> {
  const { spawn } = await import('child_process');
  const transcribeKwargs = buildPythonTranscribeKwargs(options);
  const py = [
    'import inspect, sys',
    'from faster_whisper import WhisperModel',
    `m = WhisperModel(${JSON.stringify(model)}, device='cpu', compute_type='int8')`,
    `kwargs = {${transcribeKwargs}}`,
    'supported_kwargs = set(inspect.signature(m.transcribe).parameters.keys())',
    'kwargs = {k: v for k, v in kwargs.items() if k in supported_kwargs}',
    'segs, _ = m.transcribe(sys.argv[1], **kwargs)',
    "print(' '.join(s.text for s in segs).strip())",
  ].join('\n');
  return new Promise<string>((resolve) => {
    // Capture stderr (was ignored) so an STT failure is LOUD in the journal, not silent.
    const proc = spawn(python, ['-c', py, wav], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('close', (code) => {
      if ((code !== 0 || !out.trim()) && err.trim()) {
        logger.warn(
          `[speech] STT failed (python='${python}', exit=${code}): ${err.trim().slice(0, 300)}`
        );
      }
      resolve(out.trim());
    });
    proc.on('error', (e) => {
      logger.warn(
        `[speech] STT spawn failed (python='${python}'): ${e instanceof Error ? e.message : String(e)}`
      );
      resolve('');
    });
  });
}

async function transcribeWavParakeetOneShot(
  wav: string,
  python: string,
  modelDir: string,
  numThreads: number
): Promise<string> {
  const { spawn } = await import('child_process');
  const py = [
    'import sys',
    buildParakeetWorkerScript(modelDir, numThreads),
    'print(transcribe(sys.argv[1]))',
  ].join('\n');
  return new Promise<string>((resolve) => {
    const proc = spawn(python, ['-c', py, wav], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('close', (code) => {
      const lines = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const text = lines.filter((line) => !line.startsWith('{')).at(-1) || '';
      if ((code !== 0 || !text) && err.trim()) {
        logger.warn(
          `[speech] Parakeet STT failed (python='${python}', exit=${code}): ${err.trim().slice(0, 300)}`
        );
      }
      resolve(text.trim());
    });
    proc.on('error', (e) => {
      logger.warn(
        `[speech] Parakeet STT spawn failed (python='${python}'): ${e instanceof Error ? e.message : String(e)}`
      );
      resolve('');
    });
  });
}

async function transcribeWavWithFasterWhisperRaw(wav: string): Promise<string> {
  const model = process.env.CODEBUDDY_SPEECH_MODEL ?? 'base';
  const options = resolveFasterWhisperOptions();
  // Resolve the Python interpreter from env so STT works when faster-whisper lives
  // OUTSIDE the service PATH's python3 (e.g. a conda/miniforge env). Without this a
  // systemd service whose python3 is /usr/bin/python3 (no faster_whisper) fails STT
  // SILENTLY → no transcription, no spoken reply. Set CODEBUDDY_SPEECH_PYTHON to the
  // interpreter that has faster-whisper.
  const python = resolveSpeechPython();
  if (speechWorkerEnabled()) {
    try {
      return await transcribeWavWithWorker(wav, python, model, options);
    } catch (err) {
      logger.warn(
        `[speech] STT worker unavailable, falling back to one-shot: ${err instanceof Error ? err.message : String(err)}`
      );
      if (fasterWhisperWorker) disposeFasterWhisperWorker(fasterWhisperWorker);
    }
  }
  return transcribeWavOneShot(wav, python, model, options);
}

async function transcribeWavWithParakeetRaw(wav: string): Promise<string> {
  const python = resolveSpeechPython();
  const modelDir = resolveParakeetModelDir();
  const numThreads = numericEnv(
    'CODEBUDDY_PARAKEET_THREADS',
    numericEnv('CODEBUDDY_SPEECH_THREADS', 12)
  );
  if (speechWorkerEnabled()) {
    try {
      return await transcribeWavWithParakeetWorker(wav, python, modelDir, numThreads);
    } catch (err) {
      logger.warn(
        `[speech] Parakeet worker unavailable, falling back to one-shot: ${err instanceof Error ? err.message : String(err)}`
      );
      if (parakeetWorker) disposeParakeetWorker(parakeetWorker);
    }
  }
  return transcribeWavParakeetOneShot(wav, python, modelDir, numThreads);
}

function sherpaRustWorkerKey(bin: string, modelDir: string, numThreads: number): string {
  return JSON.stringify({ bin, modelDir, numThreads });
}

function disposeSherpaRustWorker(worker: FasterWhisperWorker): void {
  if (sherpaRustWorker === worker) sherpaRustWorker = null;
  settlePending(worker, '');
  worker.rl.close();
  worker.proc.stdin.destroy();
  worker.proc.kill();
}

async function createSherpaRustWorker(
  bin: string,
  modelDir: string,
  numThreads: number
): Promise<FasterWhisperWorker> {
  const { spawn } = await import('child_process');
  const { createInterface } = await import('readline');
  const key = sherpaRustWorkerKey(bin, modelDir, numThreads);
  // The prebuilt sherpa-onnx + onnxruntime .so live next to the binary (cargo copies
  // them into target/<profile>/); point the loader at that directory.
  const libDir = dirname(bin);
  const proc = spawn(bin, ['stt'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${libDir}${delimiter}${process.env.LD_LIBRARY_PATH ?? ''}`,
      BUDDY_SENSE_STT_MODEL_DIR: modelDir,
      BUDDY_SENSE_STT_THREADS: String(numThreads),
    },
  });
  let resolveReady: () => void = () => {};
  let rejectReady: (err: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const worker: FasterWhisperWorker = {
    key,
    proc,
    rl: createInterface({ input: proc.stdout }),
    ready,
    readySettled: false,
    pending: new Map(),
  };

  let stderr = '';
  proc.stderr.on('data', (data) => {
    stderr = `${stderr}${String(data)}`.slice(-2_000);
  });
  worker.rl.on('line', (line) => {
    let message: FasterWhisperWorkerMessage;
    try {
      message = JSON.parse(line) as FasterWhisperWorkerMessage;
    } catch {
      logger.warn(`[speech] sherpa-rs worker emitted invalid JSON: ${line.slice(0, 160)}`);
      return;
    }
    if (message.ready) {
      worker.readySettled = true;
      resolveReady();
      return;
    }
    const id = message.id;
    if (!id) return;
    const pending = worker.pending.get(id);
    if (!pending) return;
    worker.pending.delete(id);
    clearTimeout(pending.timeout);
    if (message.error) {
      logger.warn(`[speech] sherpa-rs request failed: ${message.error.slice(0, 300)}`);
      pending.resolve('');
      return;
    }
    pending.resolve(message.text?.trim() || '');
  });
  proc.on('close', (code) => {
    if (sherpaRustWorker === worker) sherpaRustWorker = null;
    settlePending(worker, '');
    if (!worker.readySettled) {
      rejectReady(new Error(`sherpa-rs worker exited before ready (code=${code})`));
    }
    if (stderr.trim()) {
      logger.warn(
        `[speech] sherpa-rs worker closed (code=${code}): ${stderr.trim().slice(0, 300)}`
      );
    }
  });
  proc.on('error', (err) => {
    if (sherpaRustWorker === worker) sherpaRustWorker = null;
    settlePending(worker, '');
    if (!worker.readySettled) rejectReady(err);
  });
  sherpaRustWorker = worker;
  return worker;
}

async function getSherpaRustWorker(
  bin: string,
  modelDir: string,
  numThreads: number
): Promise<FasterWhisperWorker> {
  const key = sherpaRustWorkerKey(bin, modelDir, numThreads);
  if (sherpaRustWorker?.key === key) return sherpaRustWorker;
  if (sherpaRustWorker) disposeSherpaRustWorker(sherpaRustWorker);
  return createSherpaRustWorker(bin, modelDir, numThreads);
}

async function transcribeWavWithSherpaRustWorker(
  wav: string,
  bin: string,
  modelDir: string,
  numThreads: number
): Promise<string> {
  const worker = await getSherpaRustWorker(bin, modelDir, numThreads);
  // The Rust recognizer loads in ~1.8 s, so a tight ready-timeout fails fast on a
  // broken/featureless binary instead of stalling 30 s per utterance (a stale binary
  // built without `--features stt` ignores the `stt` arg and runs the daemon).
  await waitForWorkerReady(worker, numericEnv('CODEBUDDY_SPEECH_STT_READY_TIMEOUT_MS', 8_000));
  const timeoutMs = numericEnv('CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS', 20_000);
  const id = `sherpa-rs-${Date.now()}-${++sherpaRustWorkerSeq}`;
  return new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      worker.pending.delete(id);
      logger.warn(`[speech] sherpa-rs worker request timed out after ${timeoutMs}ms`);
      disposeSherpaRustWorker(worker);
      resolve('');
    }, timeoutMs);
    worker.pending.set(id, { resolve, timeout });
    try {
      worker.proc.stdin.write(`${JSON.stringify({ id, wav })}\n`);
    } catch (err) {
      worker.pending.delete(id);
      clearTimeout(timeout);
      throw err;
    }
  });
}

/** In-process Rust STT. Throws when the binary isn't built/resolvable, so callers can
 *  fall back to python STT (mirrors the parakeet fallback). No one-shot path: the
 *  recognizer's value is the loaded-once persistent worker. */
async function transcribeWavWithSherpaRustRaw(wav: string): Promise<string> {
  const bin = resolveSherpaRustBin();
  if (!bin)
    throw new Error(
      'buddy-sense stt binary not found (build with --features stt or set CODEBUDDY_SPEECH_STT_BIN)'
    );
  return transcribeWavWithSherpaRustWorker(
    wav,
    bin,
    resolveParakeetModelDir(),
    sherpaRustThreads()
  );
}

async function transcribeWavRaw(
  wav: string,
  engineOverride?: SpeechRecognitionEngine
): Promise<string> {
  // `engineOverride` lets ONE call path (e.g. long/video transcription) prefer a faster
  // engine WITHOUT touching the global `CODEBUDDY_SPEECH_ENGINE` default that the
  // companion/sensory hot paths read. Unset → the env-driven resolution (unchanged).
  const engine = engineOverride ?? resolveSpeechRecognitionEngine();
  if (engine === 'faster-whisper') {
    return transcribeWavWithFasterWhisperRaw(wav);
  }

  if (engine === 'sherpa-rs') {
    try {
      const text = await transcribeWavWithSherpaRustRaw(wav);
      if (text || !parakeetFallbackEnabled()) return text;
      logger.warn(
        '[speech] sherpa-rs returned an empty transcript; falling back to faster-whisper'
      );
    } catch (err) {
      if (!parakeetFallbackEnabled()) throw err;
      logger.warn(
        `[speech] sherpa-rs failed; falling back to faster-whisper: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return transcribeWavWithFasterWhisperRaw(wav);
  }

  if (engine === 'parakeet') {
    try {
      const text = await transcribeWavWithParakeetRaw(wav);
      if (text || !parakeetFallbackEnabled()) return text;
      logger.warn('[speech] Parakeet returned an empty transcript; falling back to faster-whisper');
    } catch (err) {
      if (!parakeetFallbackEnabled()) throw err;
      logger.warn(
        `[speech] Parakeet failed; falling back to faster-whisper: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return transcribeWavWithFasterWhisperRaw(wav);
  }

  // Auto mode: prefer the in-process Rust engine (fastest, same model) when its
  // binary is built, then python Parakeet when its model dir exists, else faster-whisper.
  if (resolveSherpaRustBin() && existsSync(resolveParakeetModelDir())) {
    try {
      return await transcribeWavWithSherpaRustRaw(wav);
    } catch (err) {
      logger.warn(
        `[speech] auto STT: sherpa-rs unavailable; trying Parakeet/faster-whisper: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (existsSync(resolveParakeetModelDir())) {
    try {
      return await transcribeWavWithParakeetRaw(wav);
    } catch (err) {
      logger.warn(
        `[speech] auto STT: Parakeet unavailable; trying faster-whisper: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return transcribeWavWithFasterWhisperRaw(wav);
}

/** Default transcriber: local faster-whisper (base), best-effort, $0. Exported so the
 *  push-to-talk CLI path (`buddy voice`) transcribes through the exact same STT as the daemon.
 *  `engineOverride` (additive, back-compat with the `Transcriber` type) lets a specific caller
 *  pin/prefer an engine for its call only — e.g. the long/video path passes `auto` to lean on
 *  the in-process Rust sherpa-rs engine — without changing the global STT default. */
export async function transcribeWav(
  wav: string,
  engineOverride?: SpeechRecognitionEngine
): Promise<string> {
  return normalizeSpeechTranscript(await transcribeWavRaw(wav, engineOverride)).text;
}

export function wireSpeechReaction(options: SpeechReactionOptions = {}): () => void {
  const bus = getGlobalEventBus();
  const debounceMs = options.debounceMs ?? resolveSpeechDebounceMs();
  const incompleteTurnHoldMs = options.incompleteTurnHoldMs ?? resolveIncompleteTurnHoldMs();
  const now = options.now ?? (() => Date.now());
  const transcribe = options.transcriber ?? transcribeWavRaw;
  const turnCoordinator = getVoiceTurnCoordinator();
  let lastAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;
  let activeWav: string | undefined;
  let activeTurnId: string | undefined;
  let disposed = false;
  let liveSeq = 0; // unique dedup key for live-mic finals (there's no WAV to key on)
  let turnSeq = 0;
  let pendingSpeechStartedAtMs: number | undefined;
  let pendingSpeechTurnId: string | undefined;
  let bargedSpeechTurnId: string | undefined;
  type SpeechJob = {
    p: ReturnType<typeof perceptionOf>;
    wav: string;
    presetText?: string;
    speechStartedAtMs?: number;
    turnId?: string;
  };
  let pendingSpeech: SpeechJob | null = null;
  let heldLiveTurn: {
    p: ReturnType<typeof perceptionOf>;
    text: string;
    key: string;
    timer: ReturnType<typeof setTimeout>;
    speechStartedAtMs?: number;
    turnId?: string;
  } | null = null;

  const cleanupSpeechJob = async (job: SpeechJob): Promise<void> => {
    // `presetText` identifies buddy-sense's WAV-free live path. Only the
    // Python fallback's batch jobs own a disposable source file.
    if (job.presetText === undefined) await removeProcessedCompanionWav(job.wav);
  };

  const queuePendingSpeech = (job: SpeechJob): void => {
    const superseded = pendingSpeech;
    pendingSpeech = job;
    if (superseded && superseded.wav !== job.wav) {
      void cleanupSpeechJob(superseded);
    }
  };

  const startSpeechJob = (
    job: SpeechJob,
    bypassDebounce = false
  ): void => {
    const t = now();
    const voiceResume = job.speechStartedAtMs !== undefined
      ? measureVoiceResumeTiming(job.speechStartedAtMs)
      : undefined;
    const quickPostPlaybackResume = voiceResume?.kind === 'echo_tail';
    const aecActive = (job.p.payload as Record<string, unknown> | undefined)?.aecActive === true;
    if (isSpeaking(t) && !quickPostPlaybackResume && !aecActive) {
      void cleanupSpeechJob(job);
      return; // half-duplex: ignore the mic while the robot is speaking (+ echo tail)
    }
    if (!bypassDebounce && t - lastAt < debounceMs) {
      void cleanupSpeechJob(job);
      return; // one transcription per utterance
    }
    lastAt = t;
    inFlight = true;
    activeWav = job.wav;
    const turnId = job.turnId ?? `voice_${t}_${++turnSeq}`;
    if (!job.turnId) {
      turnCoordinator.transition(turnId, 'listening', {
        aecActive: (job.p.payload as Record<string, unknown> | undefined)?.aecActive === true,
      });
    }
    turnCoordinator.transition(turnId, 'transcribing');
    activeTurnId = turnId;

    void (async () => {
      const payload = (job.p.payload as Record<string, unknown> | undefined) ?? {};
      const eventTimestamp = finiteTimestamp(job.p.receivedAt);
      const captureStartedAtMs = job.speechStartedAtMs ?? finiteTimestamp(payload.startedAtMs);
      const captureEndedAtMs = finiteTimestamp(payload.endedAtMs) ?? finiteTimestamp(job.p.tsMs);
      const endpointMs = finiteTimestamp(payload.endpointMs);
      const decodeMs = finiteTimestamp(payload.decodeMs);
      const turnDetectionMs = finiteTimestamp(payload.turnDetectionMs);
      const transcribeStartMs = now();
      let sttMs = 0;
      let decisionMs = 0;
      let actionMs = 0;
      let decisionReason: string | undefined;
      let spoke = false; // did the robot actually emit audio this turn? gates the echo re-stamp
      let responseTiming: ReturnType<NonNullable<SpeechReactionOptions['getResponseTiming']>>;
      let audioScene: AudioSceneAssessment | undefined;
      try {
        // Live-mic path (buddy-sense `live-audio`): the daemon already decoded the
        // utterance in-process, so the transcript rides in the event payload — no
        // WAV, no STT here. Everything downstream (respond gate, onHeard, percept,
        // debounce/echo guard) is shared with the WAV path.
        const rawText = job.presetText !== undefined ? job.presetText : await transcribe(job.wav);
        const normalizedText = normalizeSpeechTranscript(rawText);
        const text = normalizedText.text;
        sttMs = elapsedSince(transcribeStartMs, now);
        const { recordCompanionPercept } = await import('../companion/percepts.js');
        const latencyPayload = {
          ...(captureStartedAtMs !== undefined ? { captureStartedAtMs } : {}),
          ...(captureEndedAtMs !== undefined ? { captureEndedAtMs } : {}),
          ...(eventTimestamp !== undefined ? { eventReceivedAtMs: eventTimestamp } : {}),
          transcribeStartMs,
          sttMs,
          ...(endpointMs !== undefined ? { endpointMs } : {}),
          ...(decodeMs !== undefined ? { decodeMs } : {}),
          ...(turnDetectionMs !== undefined ? { turnDetectionMs } : {}),
          ...(endpointMs !== undefined || decodeMs !== undefined || turnDetectionMs !== undefined
            ? { inputReadyMs: (endpointMs ?? 0) + (turnDetectionMs ?? 0) + (decodeMs ?? 0) + sttMs }
            : {}),
          decisionMs,
          actionMs,
          totalMs: sttMs,
          ...(eventTimestamp !== undefined
            ? { eventToSttStartMs: Math.max(0, transcribeStartMs - eventTimestamp) }
            : {}),
        };
        const capturePayload = {
          device: payload.device,
          rms: payload.rms,
          peakRms: payload.peakRms ?? payload.rms,
          avgRms: payload.avgRms,
          ms: payload.ms,
          audioMs: payload.audioMs,
          endpointMs: payload.endpointMs,
          decodeMs: payload.decodeMs,
          turnDetector: payload.turnDetector,
          turnProbability: payload.turnProbability,
          turnDetectionMs: payload.turnDetectionMs,
          turnForcedAfterHold: payload.turnForcedAfterHold,
          writeMs: payload.writeMs,
          vadHangMs: payload.vadHangMs,
          endedReason: payload.endedReason,
          sampleRate: payload.sampleRate,
          rmsOn: payload.rmsOn,
          rmsOff: payload.rmsOff,
          aecActive: payload.aecActive === true,
          captureSourceClass: payload.captureSourceClass,
        };
        if (!text) {
          turnCoordinator.transition(turnId, 'suppressed', {
            suppressionReason: normalizedText.filteredReason ?? 'stt-empty',
            sttMs,
          });
          const emptyReason = normalizedText.filteredReason ?? 'empty';
          logger.info(`[speech] empty transcript (${sttMs}ms STT, ${emptyReason})`);
          await recordCompanionPercept(
            {
              modality: 'hearing',
              source: 'sensory_speech_reaction',
              summary: 'Speech captured; STT returned no text',
              confidence: 0.25,
              payload: {
                text: '',
                wav: job.wav,
                responded: false,
                sttEmpty: true,
                sttEmptyReason: emptyReason,
                ...(normalizedText.filteredReason ? { rawText: rawText.trim().slice(0, 240) } : {}),
                latency: latencyPayload,
                capture: capturePayload,
              },
              tags: ['speech', 'stt', 'latency', 'empty'],
            },
            options.cwd ? { cwd: options.cwd } : {}
          );
          return;
        }
        const playbackCaptureKind = voiceResume?.kind === 'during_playback'
          || voiceResume?.kind === 'echo_tail'
          ? voiceResume.kind
          : undefined;
        const echoClassification = playbackCaptureKind
          ? classifyRecentVoiceEcho(text, captureStartedAtMs ?? transcribeStartMs)
          : undefined;
        const explicitBargeIn = playbackCaptureKind
          ? shouldTriggerVoiceBargeIn(text, payload)
          : false;
        const suppressPlaybackCapture = playbackCaptureKind && echoClassification
          ? shouldSuppressPlaybackCapture(
              playbackCaptureKind,
              echoClassification,
              explicitBargeIn,
              payload.aecActive === true,
            )
          : false;
        if (suppressPlaybackCapture && playbackCaptureKind && echoClassification) {
          const suppressionReason = playbackCaptureKind === 'during_playback'
            ? echoClassification === 'echo'
              ? 'during_playback_echo'
              : 'during_playback_non_explicit'
            : `echo_tail_${echoClassification}`;
          logger.info(
            `[speech] suppressed playback capture reason=${suppressionReason}`,
          );
          turnCoordinator.transition(turnId, 'suppressed', {
            suppressionReason,
            sttMs,
            scene: 'assistant_playback',
            sceneConfidence: echoClassification === 'echo' ? 0.98 : 0.8,
          });
          await recordCompanionPercept(
            {
              modality: 'hearing',
              source: 'sensory_speech_reaction',
              summary: playbackCaptureKind === 'during_playback'
                ? 'Speech captured during loudspeaker playback suppressed'
                : 'Likely loudspeaker echo suppressed',
              confidence: echoClassification === 'echo' ? 0.95 : 0.75,
              payload: {
                responded: false,
                playbackEcho: echoClassification === 'echo',
                playbackCaptureSuppressed: true,
                suppressionReason,
                echoClassification,
                turnTaking: voiceResume,
                latency: latencyPayload,
                capture: capturePayload,
              },
              tags: ['speech', 'echo', 'playback-capture', 'turn-taking'],
            },
            options.cwd ? { cwd: options.cwd } : {},
          );
          return;
        }
        logger.info(`[speech] heard (${sttMs}ms STT) → ${text}`);

        const turnContext: VoiceTurnContext = {
          turnId,
          ...(finiteTimestamp(payload.audioMs) !== undefined
            ? { audioMs: finiteTimestamp(payload.audioMs) }
            : {}),
          ...(finiteTimestamp(payload.ms) !== undefined
            ? { captureMs: finiteTimestamp(payload.ms) }
            : {}),
          ...(captureStartedAtMs !== undefined ? { speechStartedAtMs: captureStartedAtMs } : {}),
          ...(captureEndedAtMs !== undefined ? { speechEndedAtMs: captureEndedAtMs } : {}),
        };
        let acceptedForSemanticIngress = true;
        let responded = Boolean(options.onHeard);
        turnCoordinator.transition(turnId, 'deciding', {
          sttMs,
          wordCount: text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0,
        });
        // Human-like gate: raw observation remains continuous; semantic dialogue and
        // speech proceed only when this turn was accepted as addressed/warranted.
        if (options.shouldRespond) {
          const decisionStartMs = now();
          const decision = await options.shouldRespond(text);
          decisionMs = elapsedSince(decisionStartMs, now);
          decisionReason = decision.reason;
          turnCoordinator.transition(turnId, 'deciding', {
            decisionReason,
            decisionMs,
            sttMs,
          });
          acceptedForSemanticIngress = decision.respond;
          if (!decision.respond) {
            logger.info(`[speech] silent (${decision.reason}, decision ${decisionMs}ms)`);
            responded = false;
          } else {
            responded = Boolean(options.onHeard);
            logger.info(`[speech] responding (${decision.reason}, decision ${decisionMs}ms)`);
          }
          const attention = options.getAttentionSnapshot?.();
          if (attention) turnCoordinator.updateAttention(attention);
        }

        audioScene = assessAudioScene({
          transcript: text,
          ...(decisionReason ? { decisionReason } : {}),
          ...(playbackCaptureKind ? { playbackCaptureKind } : {}),
          ...(echoClassification ? { echoClassification } : {}),
          rms: finiteTimestamp(payload.rms),
          rmsOn: finiteTimestamp(payload.rmsOn),
          audioMs: finiteTimestamp(payload.audioMs),
          turnDetector: typeof payload.turnDetector === 'string' ? payload.turnDetector : undefined,
          speakerCount: finiteTimestamp(payload.speakerCount),
          aecActive: payload.aecActive === true,
        });
        turnCoordinator.transition(turnId, 'deciding', {
          ...(decisionReason ? { decisionReason } : {}),
          scene: audioScene.scene,
          sceneConfidence: audioScene.confidence,
          decisionMs,
          sttMs,
        });

        if (acceptedForSemanticIngress && options.onRecognizedTurn) {
          try {
            const ingress = options.onRecognizedTurn({ turnId, text, context: turnContext });
            void Promise.resolve(ingress).catch((error) => {
              logger.warn(
                `[speech] background turn ingress failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            });
          } catch (error) {
            logger.warn(
              `[speech] background turn ingress failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }

        if (responded) {
          turnCoordinator.transition(turnId, 'thinking', {
            decisionReason,
            decisionMs,
          });
          const actionStartMs = now();
          await options.onHeard?.(text, turnContext);
          actionMs = elapsedSince(actionStartMs, now);
          responseTiming = options.getResponseTiming?.();
          // Plain hooks historically imply speech; instrumented voice handlers report whether
          // audio really started (empty/muted/failed replies must not arm a fake echo debounce).
          spoke = responseTiming?.spoke ?? true;
          if (!responseTiming) {
            turnCoordinator.transition(turnId, 'completed', {
              decisionReason,
              spoke,
              totalMs: elapsedSince(transcribeStartMs, now),
            });
          }
        } else {
          turnCoordinator.transition(turnId, 'suppressed', {
            suppressionReason: decisionReason ?? 'no-response-handler',
            decisionMs,
            sttMs,
          });
        }
        const totalMs = elapsedSince(transcribeStartMs, now);
        const inputReadyMs =
          (endpointMs ?? 0) + (turnDetectionMs ?? 0) + (decodeMs ?? 0) + sttMs;
        const perceivedResponseMs =
          responseTiming?.firstAudioMs !== undefined
            ? inputReadyMs + decisionMs + responseTiming.firstAudioMs
            : undefined;
        const perceivedContentResponseMs =
          responseTiming?.firstContentAudioMs !== undefined
            ? inputReadyMs + decisionMs + responseTiming.firstContentAudioMs
            : undefined;
        await recordCompanionPercept(
          {
            modality: 'hearing',
            source: 'sensory_speech_reaction',
            summary: `Heard: ${text}`,
            confidence: 0.8,
            payload: {
              text,
              ...(job.presetText !== undefined ? { live: true } : { wav: job.wav }),
              responded,
              ...(decisionReason ? { decisionReason } : {}),
              latency: {
                ...latencyPayload,
                decisionMs,
                actionMs,
                totalMs,
                ...(responseTiming?.promptReadyMs !== undefined
                  ? { promptReadyMs: responseTiming.promptReadyMs }
                  : {}),
                ...(responseTiming?.providerFirstDeltaMs !== undefined
                  ? { providerFirstDeltaMs: responseTiming.providerFirstDeltaMs }
                  : {}),
                ...(responseTiming?.generationCompleteMs !== undefined
                  ? { generationCompleteMs: responseTiming.generationCompleteMs }
                  : {}),
                ...(responseTiming?.semanticReviewCompleteMs !== undefined
                  ? { semanticReviewCompleteMs: responseTiming.semanticReviewCompleteMs }
                  : {}),
                ...(responseTiming?.spokenPrefix
                  ? { spokenPrefix: responseTiming.spokenPrefix }
                  : {}),
                ...(responseTiming?.continuation
                  ? { continuation: responseTiming.continuation }
                  : {}),
                ...(responseTiming?.firstSafeReleaseMs !== undefined
                  ? { firstSafeReleaseMs: responseTiming.firstSafeReleaseMs }
                  : {}),
                ...(responseTiming?.firstTextMs !== undefined
                  ? { firstTextMs: responseTiming.firstTextMs }
                  : {}),
                ...(responseTiming?.firstSegmentMs !== undefined
                  ? { firstSegmentMs: responseTiming.firstSegmentMs }
                  : {}),
                ...(responseTiming?.firstAudioMs !== undefined
                  ? {
                      firstAudioMs: responseTiming.firstAudioMs,
                      perceivedResponseMs,
                    }
                  : {}),
                ...(responseTiming?.firstContentAudioMs !== undefined
                  ? {
                      firstContentAudioMs: responseTiming.firstContentAudioMs,
                      perceivedContentResponseMs,
                    }
                  : {}),
                ...(responseTiming?.streamFallbackSegments !== undefined
                  ? { streamFallbackSegments: responseTiming.streamFallbackSegments }
                  : {}),
                ...(responseTiming ? { voiceTotalMs: responseTiming.totalMs } : {}),
              },
              ...(responseTiming ? { responseMode: responseTiming.mode, spoke } : {}),
              ...(responseTiming?.delivery ? { delivery: responseTiming.delivery } : {}),
              ...(audioScene ? { audioScene } : {}),
              ...(voiceResume ? { turnTaking: voiceResume } : {}),
              capture: {
                ...capturePayload,
              },
            },
            tags: ['speech', 'stt', 'latency'],
          },
          options.cwd ? { cwd: options.cwd } : {}
        );
        if (actionMs > 0 || decisionMs > 0) {
          logger.info(
            `[speech] loop timings: stt=${sttMs}ms decision=${decisionMs}ms action=${actionMs}ms total=${totalMs}ms` +
              (perceivedResponseMs !== undefined
                ? ` perceived=${perceivedResponseMs}ms`
                : '') +
              (perceivedContentResponseMs !== undefined
                ? ` perceivedContent=${perceivedContentResponseMs}ms`
                : '') +
              (decisionReason ? ` reason=${decisionReason}` : '')
          );
        }
      } catch (err) {
        turnCoordinator.transition(turnId, 'failed', { errorCategory: 'unknown' });
        logger.warn(
          `[speech] reaction failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        // The Python ear writes one source WAV per utterance. Delete it on every
        // terminal path (success, empty STT, error, or teardown during a job).
        // The helper fails closed for arbitrary paths and honours the debug
        // retention switch documented at the top of this module.
        await cleanupSpeechJob(job);
        // Re-stamp AFTER the full hear→think→speak cycle so the debounce window restarts from
        // end-of-playback — but ONLY when the robot actually spoke (that's the echo tail we must
        // not re-hear). After a silent turn (empty/filtered transcript, or the gate vetoed a
        // reply) there is no echo, so keep the job-start debounce anchor (set at startSpeechJob):
        // pushing lastAt out by the STT/decision duration would swallow a real address arriving
        // in the (debounceMs, debounceMs+sttMs] window after a silent turn.
        if (spoke) lastAt = now();
        inFlight = false;
        activeWav = undefined;
        if (activeTurnId === turnId) activeTurnId = undefined;
        const nextSpeech = pendingSpeech;
        pendingSpeech = null;
        if (nextSpeech && !disposed) {
          startSpeechJob(nextSpeech, true);
        }
      }
    })();
  };

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    if (p.modality !== 'audio') return;

    // Rust live-audio publishes this on the exact VAD closed→open edge. Use the
    // human's speaking time for preparation, but keep the response decision on
    // `transcript_final`: television/noise can warm a standby, never make it talk.
    if (p.kind === 'speech_start') {
      const payload = (p.payload as Record<string, unknown> | undefined) ?? {};
      pendingSpeechStartedAtMs = finiteTimestamp(payload.startedAtMs)
        ?? finiteTimestamp(p.receivedAt)
        ?? now();
      pendingSpeechTurnId = `voice_${pendingSpeechStartedAtMs}_${++turnSeq}`;
      bargedSpeechTurnId = undefined;
      turnCoordinator.transition(pendingSpeechTurnId, 'listening', {
        aecActive: payload.aecActive === true,
      });
      if (options.onSpeechStart) {
        void Promise.resolve().then(() => options.onSpeechStart!(payload)).catch((error) => {
          logger.debug('[speech] predictive warmup skipped', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      return;
    }

    if (p.kind === 'transcript_partial') {
      const payload = (p.payload as Record<string, unknown> | undefined) ?? {};
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text) return;
      if (
        inFlight &&
        options.onBargeIn &&
        shouldTriggerVoiceBargeIn(text, payload) &&
        (pendingSpeechTurnId === undefined || bargedSpeechTurnId !== pendingSpeechTurnId)
      ) {
        if (pendingSpeechTurnId !== undefined) bargedSpeechTurnId = pendingSpeechTurnId;
        try {
          options.onBargeIn(text, activeTurnId);
        } catch {
          /* interruption is best-effort */
        }
      }
      if (!options.onSpeechPartial) return;
      const audioMs = finiteTimestamp(payload.audioMs);
      const decodeMs = finiteTimestamp(payload.decodeMs);
      void Promise.resolve()
        .then(() => options.onSpeechPartial!({
          text,
          ...(audioMs !== undefined ? { audioMs } : {}),
          ...(decodeMs !== undefined ? { decodeMs } : {}),
        }))
        .catch((error) => {
          logger.debug('[speech] partial transcript prewarm skipped', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    // Live-mic path (buddy-sense `live-audio`): the transcript is ALREADY decoded
    // and carried in the payload — drive the same cognition with the text directly,
    // no WAV / no STT. Keyed on a synthetic id since there's no file to dedup on.
    if (p.kind === 'transcript_final') {
      const livePayload = p.payload as { text?: string; turnDetector?: string } | undefined;
      let speechStartedAtMs = finiteTimestamp(
        (p.payload as Record<string, unknown> | undefined)?.startedAtMs,
      ) ?? pendingSpeechStartedAtMs;
      let turnId = pendingSpeechTurnId;
      pendingSpeechStartedAtMs = undefined;
      pendingSpeechTurnId = undefined;
      let text = livePayload?.text?.trim();
      if (!text) return;
      const key = `live:${liveSeq++}`;
      if (heldLiveTurn) {
        clearTimeout(heldLiveTurn.timer);
        text = joinVoiceTurnFragments(heldLiveTurn.text, text);
        speechStartedAtMs = heldLiveTurn.speechStartedAtMs ?? speechStartedAtMs;
        turnId = heldLiveTurn.turnId ?? turnId;
        heldLiveTurn = null;
      }
      // Smart Turn has already considered prosody and the complete audio. The
      // text heuristic is only a fail-open fallback for VAD-only sources.
      if (
        !livePayload?.turnDetector &&
        incompleteTurnHoldMs > 0 &&
        isLikelyIncompleteVoiceTurn(text)
      ) {
        const timer = setTimeout(() => {
          const held = heldLiveTurn;
          if (!held || held.key !== key || disposed) return;
          heldLiveTurn = null;
          const job = {
            p: held.p,
            wav: held.key,
            presetText: held.text,
            ...(held.speechStartedAtMs !== undefined
              ? { speechStartedAtMs: held.speechStartedAtMs }
              : {}),
            ...(held.turnId ? { turnId: held.turnId } : {}),
          };
          if (inFlight) queuePendingSpeech(job);
          else startSpeechJob(job);
        }, incompleteTurnHoldMs);
        heldLiveTurn = {
          p,
          text,
          key,
          timer,
          ...(speechStartedAtMs !== undefined ? { speechStartedAtMs } : {}),
          ...(turnId ? { turnId } : {}),
        };
        logger.debug(`[speech] holding likely incomplete turn for ${incompleteTurnHoldMs}ms → ${text}`);
        return;
      }
      if (inFlight) {
        const payload = (p.payload as Record<string, unknown> | undefined) ?? {};
        if (
          options.onBargeIn &&
          shouldTriggerVoiceBargeIn(text, payload) &&
          (turnId === undefined || bargedSpeechTurnId !== turnId)
        ) {
          if (turnId !== undefined) bargedSpeechTurnId = turnId;
          logger.info(`[speech] barge-in → ${text}`);
          try {
            options.onBargeIn(text, activeTurnId);
          } catch {
            /* interruption is best-effort; still queue the new utterance */
          }
        }
        if (key !== activeWav) {
          queuePendingSpeech({
            p,
            wav: key,
            presetText: text,
            ...(speechStartedAtMs !== undefined ? { speechStartedAtMs } : {}),
            ...(turnId ? { turnId } : {}),
          });
        }
        return;
      }
      startSpeechJob({
        p,
        wav: key,
        presetText: text,
        ...(speechStartedAtMs !== undefined ? { speechStartedAtMs } : {}),
        ...(turnId ? { turnId } : {}),
      });
      return;
    }

    if (p.kind !== 'speech_end') return;
    const wav = (p.payload as { wav?: string } | undefined)?.wav;
    const speechStartedAtMs = finiteTimestamp(
      (p.payload as Record<string, unknown> | undefined)?.startedAtMs,
    ) ?? pendingSpeechStartedAtMs;
    const turnId = pendingSpeechTurnId;
    pendingSpeechStartedAtMs = undefined;
    pendingSpeechTurnId = undefined;
    if (!wav) return; // no audio to transcribe (the batch path needs a WAV)

    if (inFlight) {
      if (wav !== activeWav) {
        queuePendingSpeech({
          p,
          wav,
          ...(speechStartedAtMs !== undefined ? { speechStartedAtMs } : {}),
          ...(turnId ? { turnId } : {}),
        });
      }
      return;
    }

    startSpeechJob({
      p,
      wav,
      ...(speechStartedAtMs !== undefined ? { speechStartedAtMs } : {}),
      ...(turnId ? { turnId } : {}),
    });
  });

  return () => {
    disposed = true;
    if (heldLiveTurn) clearTimeout(heldLiveTurn.timer);
    heldLiveTurn = null;
    const abandonedSpeech = pendingSpeech;
    pendingSpeech = null;
    if (abandonedSpeech) void cleanupSpeechJob(abandonedSpeech);
    bus.off(id);
  };
}
