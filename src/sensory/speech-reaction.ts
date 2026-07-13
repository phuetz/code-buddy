/**
 * Speech reaction — closes the perception→cognition loop. Two input paths feed the
 * SAME cognition (respond gate → `hearing` percept → optional `onHeard` action):
 *   - batch: a `speech_end` event carrying the source WAV (the daemon tags it) →
 *     transcribe the utterance here (STT);
 *   - live: an `audio/transcript_final` event from buddy-sense's `live-audio` sense
 *     whose payload ALREADY carries the decoded text → no WAV, no STT on this side.
 * DEBOUNCED (one transcription per utterance — the energy VAD over-segments), opt-in
 * (`CODEBUDDY_SENSORY_SPEECH=true`), injectable transcriber, never-throws.
 *
 * @module sensory/speech-reaction
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { delimiter, dirname, join } from 'path';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { Interface as ReadlineInterface } from 'readline';
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { isSpeaking } from './voice-activity.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';
import {
  resolveSpeechRecognitionEngine,
  resolveParakeetModelDir,
  expandSpeechPath,
  type SpeechRecognitionEngine,
} from './speech-engine-config.js';
import { resolveUserName } from '../companion/user-name.js';

// Re-exported for back-compat: callers + tests import these from speech-reaction.
export { resolveSpeechRecognitionEngine };
export type { SpeechRecognitionEngine };

export type Transcriber = (wav: string) => Promise<string>;

export interface SpeechReactionOptions {
  /** Injectable STT (tests / custom). Default: faster-whisper via python ($0). */
  transcriber?: Transcriber;
  debounceMs?: number;
  cwd?: string;
  now?: () => number;
  /** Action hook for the transcript (e.g. trigger an agent turn). */
  onHeard?: (text: string) => void | Promise<void>;
  /**
   * Human-like response gate. The percept is ALWAYS recorded (observation/memory stay
   * continuous); `onHeard` only fires when this returns `respond: true`. Omit → respond to
   * everything (today's behavior). See `respond-decider.ts`.
   */
  shouldRespond?: (text: string) => Promise<{ respond: boolean; reason: string }>;
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
  const debounceMs = options.debounceMs ?? Number(process.env.CODEBUDDY_SPEECH_DEBOUNCE_MS ?? 4000);
  const now = options.now ?? (() => Date.now());
  const transcribe = options.transcriber ?? transcribeWavRaw;
  let lastAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;
  let activeWav: string | undefined;
  let disposed = false;
  let liveSeq = 0; // unique dedup key for live-mic finals (there's no WAV to key on)
  let pendingSpeech: {
    p: ReturnType<typeof perceptionOf>;
    wav: string;
    presetText?: string;
  } | null = null;

  const startSpeechJob = (
    job: { p: ReturnType<typeof perceptionOf>; wav: string; presetText?: string },
    bypassDebounce = false
  ): void => {
    const t = now();
    if (isSpeaking(t)) return; // half-duplex: ignore the mic while the robot is speaking (+ echo tail)
    if (!bypassDebounce && t - lastAt < debounceMs) return; // one transcription per utterance
    lastAt = t;
    inFlight = true;
    activeWav = job.wav;

    void (async () => {
      const payload = (job.p.payload as Record<string, unknown> | undefined) ?? {};
      const eventTimestamp = finiteTimestamp(job.p.receivedAt);
      const captureStartedAtMs = finiteTimestamp(payload.startedAtMs);
      const captureEndedAtMs = finiteTimestamp(payload.endedAtMs) ?? finiteTimestamp(job.p.tsMs);
      const transcribeStartMs = now();
      let sttMs = 0;
      let decisionMs = 0;
      let actionMs = 0;
      let decisionReason: string | undefined;
      let spoke = false; // did the robot actually emit audio this turn? gates the echo re-stamp
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
          writeMs: payload.writeMs,
          vadHangMs: payload.vadHangMs,
          endedReason: payload.endedReason,
          sampleRate: payload.sampleRate,
          rmsOn: payload.rmsOn,
          rmsOff: payload.rmsOff,
        };
        if (!text) {
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
        logger.info(`[speech] heard (${sttMs}ms STT) → ${text}`);

        let responded = Boolean(options.onHeard);
        // Human-like gate: observed + remembered above; only SPEAK if warranted.
        if (options.shouldRespond) {
          const decisionStartMs = now();
          const decision = await options.shouldRespond(text);
          decisionMs = elapsedSince(decisionStartMs, now);
          decisionReason = decision.reason;
          if (!decision.respond) {
            logger.info(`[speech] silent (${decision.reason}, decision ${decisionMs}ms)`);
            responded = false;
          } else {
            responded = Boolean(options.onHeard);
            logger.info(`[speech] responding (${decision.reason}, decision ${decisionMs}ms)`);
          }
        }

        if (responded) {
          const actionStartMs = now();
          await options.onHeard?.(text);
          actionMs = elapsedSince(actionStartMs, now);
          spoke = true; // the reply (voice-loop) played — its echo tail must be debounced
        }
        const totalMs = elapsedSince(transcribeStartMs, now);
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
              },
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
              (decisionReason ? ` reason=${decisionReason}` : '')
          );
        }
      } catch (err) {
        logger.warn(
          `[speech] reaction failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        // Re-stamp AFTER the full hear→think→speak cycle so the debounce window restarts from
        // end-of-playback — but ONLY when the robot actually spoke (that's the echo tail we must
        // not re-hear). After a silent turn (empty/filtered transcript, or the gate vetoed a
        // reply) there is no echo, so keep the job-start debounce anchor (set at startSpeechJob):
        // pushing lastAt out by the STT/decision duration would swallow a real address arriving
        // in the (debounceMs, debounceMs+sttMs] window after a silent turn.
        if (spoke) lastAt = now();
        inFlight = false;
        activeWav = undefined;
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

    // Live-mic path (buddy-sense `live-audio`): the transcript is ALREADY decoded
    // and carried in the payload — drive the same cognition with the text directly,
    // no WAV / no STT. Keyed on a synthetic id since there's no file to dedup on.
    if (p.kind === 'transcript_final') {
      const text = (p.payload as { text?: string } | undefined)?.text?.trim();
      if (!text) return;
      const key = `live:${liveSeq++}`;
      if (inFlight) {
        if (key !== activeWav) pendingSpeech = { p, wav: key, presetText: text };
        return;
      }
      startSpeechJob({ p, wav: key, presetText: text });
      return;
    }

    if (p.kind !== 'speech_end') return;
    const wav = (p.payload as { wav?: string } | undefined)?.wav;
    if (!wav) return; // no audio to transcribe (the batch path needs a WAV)

    if (inFlight) {
      if (wav !== activeWav) {
        pendingSpeech = { p, wav };
      }
      return;
    }

    startSpeechJob({ p, wav });
  });

  return () => {
    disposed = true;
    pendingSpeech = null;
    bus.off(id);
  };
}
