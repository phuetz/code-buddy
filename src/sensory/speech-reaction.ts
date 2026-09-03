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
  hasRecentSpokenReference,
  isRecentVoiceFragmentEcho,
  isSensoryAecTrusted,
  isSpeaking,
  measureVoiceResumeTiming,
} from './voice-activity.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';
import {
  resolveSpeechRecognitionEngine,
  resolveSpeechLanguage,
  resolveSpeechTranscriptionPlan,
  resolveParakeetModelDir,
  isFrenchParakeetModelAvailable,
  resolveSpeechSttThreads,
  expandSpeechPath,
  type SpeechRecognitionEngine,
  type SpeechTranscriptionPlan,
} from './speech-engine-config.js';
import { resolveUserName } from '../companion/user-name.js';
import {
  isLikelyIncompleteVoiceTurn,
  joinVoiceTurnFragments,
  resolveConversationalTurnEndSilenceMs,
  resolveIncompleteTurnHoldMs,
} from './voice-turn-taking.js';
import type { VoiceDeliveryProfile, VoiceTurnContext } from './voice-entrainment.js';
import { getVoiceTurnCoordinator } from './voice-turn-coordinator.js';
import { assessAudioScene, type AudioSceneAssessment } from './audio-scene.js';
import {
  createConversationCueController,
  shouldRepairTranscript,
  type ConversationCueHandle,
  type ConversationCuePlayer,
} from './conversation-cues.js';
import {
  resolveTurnDetectorDecision,
  type TurnDecisionProvider,
} from './turn-detector.js';

// Re-exported for back-compat: callers + tests import these from speech-reaction.
export { resolveSpeechRecognitionEngine };
export type { SpeechRecognitionEngine };

export type Transcriber = (wav: string) => Promise<string>;

export interface SpeechSttFailure {
  wav: string;
  cause: string;
  count: number;
  durationMs?: number;
  rms?: number;
}

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
  /** Local recovery for a real capture whose STT failed; return true only if audio was emitted. */
  onSpeechError?: (failure: SpeechSttFailure) => boolean | void | Promise<boolean | void>;
  debounceMs?: number;
  /** Maximum wait used only when a fast VAD final ends on an unfinished phrase. */
  incompleteTurnHoldMs?: number;
  cwd?: string;
  now?: () => number;
  /** Injectable environment for opt-in conversational policies and the speech-start barge-in gate. */
  env?: NodeJS.ProcessEnv;
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
  /** Local cached-cue player; never a TTS or model callback. */
  onConversationCue?: ConversationCuePlayer;
  /** Stateless name/address probe for empty-final repair; must not invoke an LLM. */
  isAddressed?: (text: string) => boolean | Promise<boolean>;
  /** Optional raw-free LiveKit v1-mini decision supplied by the local ear bridge. */
  turnDecisionProvider?: TurnDecisionProvider;
  /** Interrupt the active think/speak turn when an explicit barge-in transcript arrives. */
  onBargeIn?: (text: string, interruptedTurnId?: string) => void;
  /** Interrupt the active spoken turn directly from an acoustic speech_start event. */
  onBargeInStart?: (payload: Record<string, unknown>, interruptedTurnId?: string) => void;
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
export const DEFAULT_VOICE_BARGEIN_MIN_SPEECH_MS = 250;
export const DEFAULT_VOICE_BARGEIN_MARGIN_DB = 6;
export const VOICE_BARGEIN_LEAKAGE_REFERENCE_MS = 300;

export function voiceBargeInEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_SENSORY_BARGE_IN?.trim().toLowerCase() === 'true';
}

/** Speech-start has no transcript yet; a sustained acoustic segment is enough to cut. */
export function shouldTriggerVoiceBargeInOnSpeechStart(
  payload: Record<string, unknown>,
): boolean {
  return (capturedSpeechMs(payload) ?? 0) >= DEFAULT_VOICE_BARGEIN_MIN_SPEECH_MS;
}

export function resolveVoiceBargeInMarginDb(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_SENSORY_BARGE_IN_MARGIN_DB);
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_VOICE_BARGEIN_MARGIN_DB;
  return Math.min(60, configured);
}

/** True when the current microphone energy clears the adaptive leakage margin. */
export function exceedsVoiceLeakageMargin(
  rms: number,
  leakageRms: number,
  marginDb: number = DEFAULT_VOICE_BARGEIN_MARGIN_DB,
): boolean {
  if (!Number.isFinite(rms) || rms <= 0 || !Number.isFinite(leakageRms) || leakageRms <= 0) {
    return false;
  }
  return 20 * Math.log10(rms / leakageRms) >= marginDb;
}

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

const MIN_STT_RECOVERY_AUDIO_MS = 200;
const DEFAULT_SPEECH_NOISE_RMS = 0.02;
const STT_FAILURE_REPLY = "Pardon, je n'ai pas compris.";

interface PcmWavSignal {
  durationMs: number;
  rms: number;
}

/** Read only the small PCM signal facts needed to avoid speaking on a fake/empty WAV. */
function readPcm16WavSignal(wav: string): PcmWavSignal | undefined {
  try {
    const source = readFileSync(expandSpeechPath(wav));
    if (
      source.length < 12
      || source.toString('ascii', 0, 4) !== 'RIFF'
      || source.toString('ascii', 8, 12) !== 'WAVE'
    ) return undefined;

    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = -1;
    let dataSize = 0;
    for (let offset = 12; offset + 8 <= source.length;) {
      const chunkSize = source.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = Math.min(source.length, chunkStart + chunkSize);
      const chunk = source.toString('ascii', offset, offset + 4);
      if (chunk === 'fmt ' && chunkEnd - chunkStart >= 16) {
        const format = source.readUInt16LE(chunkStart);
        channels = source.readUInt16LE(chunkStart + 2);
        sampleRate = source.readUInt32LE(chunkStart + 4);
        bitsPerSample = source.readUInt16LE(chunkStart + 14);
        if (format !== 1) return undefined;
      } else if (chunk === 'data') {
        dataOffset = chunkStart;
        dataSize = chunkEnd - chunkStart;
      }
      const nextOffset = chunkStart + chunkSize + (chunkSize % 2);
      if (nextOffset <= offset) break;
      offset = nextOffset;
    }
    if (channels < 1 || sampleRate < 1 || bitsPerSample !== 16 || dataOffset < 0 || dataSize < 2) {
      return undefined;
    }
    const sampleCount = Math.floor(dataSize / 2);
    let squareSum = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = source.readInt16LE(dataOffset + index * 2) / 32_768;
      squareSum += sample * sample;
    }
    return {
      durationMs: dataSize / (sampleRate * channels * 2) * 1_000,
      rms: Math.sqrt(squareSum / sampleCount),
    };
  } catch {
    return undefined;
  }
}

function realSpeechCapture(
  wav: string,
  payload: Record<string, unknown>,
): { durationMs: number; rms: number } | undefined {
  if (!existsSync(expandSpeechPath(wav))) return undefined;
  const measured = readPcm16WavSignal(wav);
  if (!measured) return undefined;
  const durationMs = measured.durationMs;
  const rms = measured.rms;
  const threshold = finiteTimestamp(payload.rmsOn) ?? DEFAULT_SPEECH_NOISE_RMS;
  if (durationMs < MIN_STT_RECOVERY_AUDIO_MS || rms < threshold) return undefined;
  return { durationMs, rms };
}

/** Explicit wake/stop always works; explicitly trusted AEC permits sustained natural speech. */
export function shouldTriggerVoiceBargeIn(
  text: string,
  payload: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isBargeInTranscript(text)) return true;
  if (!isSensoryAecTrusted(payload.aecActive === true, env)) return false;
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
  reject: (error: Error) => void;
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

class SpeechWorkerRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechWorkerRequestError';
  }
}

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
  const language = resolveSpeechLanguage();
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

function settlePending(worker: FasterWhisperWorker, error: Error): void {
  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  worker.pending.clear();
}

function disposeFasterWhisperWorker(worker: FasterWhisperWorker): void {
  if (fasterWhisperWorker === worker) fasterWhisperWorker = null;
  settlePending(worker, new SpeechWorkerRequestError('faster-whisper worker disposed'));
  worker.rl.close();
  worker.proc.stdin.destroy();
  worker.proc.kill();
}

function disposeParakeetWorker(worker: FasterWhisperWorker): void {
  if (parakeetWorker === worker) parakeetWorker = null;
  settlePending(worker, new SpeechWorkerRequestError('Parakeet worker disposed'));
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
      pending.reject(new SpeechWorkerRequestError(message.error.slice(0, 300)));
      return;
    }
    pending.resolve(message.text?.trim() || '');
  });
  proc.on('close', (code) => {
    if (fasterWhisperWorker === worker) fasterWhisperWorker = null;
    settlePending(
      worker,
      new SpeechWorkerRequestError(`faster-whisper worker closed (code=${code})`),
    );
    if (!worker.readySettled) {
      rejectReady(new Error(`faster-whisper worker exited before ready (code=${code})`));
    }
    if (stderr.trim()) {
      logger.warn(`[speech] STT worker closed (code=${code}): ${stderr.trim().slice(0, 300)}`);
    }
  });
  proc.on('error', (err) => {
    if (fasterWhisperWorker === worker) fasterWhisperWorker = null;
    settlePending(
      worker,
      worker.readySettled ? new SpeechWorkerRequestError(err.message) : err,
    );
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
      pending.reject(new SpeechWorkerRequestError(message.error.slice(0, 300)));
      return;
    }
    pending.resolve(message.text?.trim() || '');
  });
  proc.on('close', (code) => {
    if (parakeetWorker === worker) parakeetWorker = null;
    settlePending(worker, new SpeechWorkerRequestError(`Parakeet worker closed (code=${code})`));
    if (!worker.readySettled) {
      rejectReady(new Error(`Parakeet worker exited before ready (code=${code})`));
    }
    if (stderr.trim()) {
      logger.warn(`[speech] Parakeet worker closed (code=${code}): ${stderr.trim().slice(0, 300)}`);
    }
  });
  proc.on('error', (err) => {
    if (parakeetWorker === worker) parakeetWorker = null;
    settlePending(worker, worker.readySettled ? new SpeechWorkerRequestError(err.message) : err);
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
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.pending.delete(id);
      const error = new SpeechWorkerRequestError(
        `faster-whisper worker request timed out after ${timeoutMs}ms`,
      );
      logger.warn(`[speech] STT worker request timed out after ${timeoutMs}ms`);
      disposeFasterWhisperWorker(worker);
      reject(error);
    }, timeoutMs);
    worker.pending.set(id, { resolve, reject, timeout });
    try {
      worker.proc.stdin.write(`${JSON.stringify({ id, wav })}\n`);
    } catch (err) {
      worker.pending.delete(id);
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error(String(err)));
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
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.pending.delete(id);
      const error = new SpeechWorkerRequestError(
        `Parakeet worker request timed out after ${timeoutMs}ms`,
      );
      logger.warn(`[speech] Parakeet worker request timed out after ${timeoutMs}ms`);
      disposeParakeetWorker(worker);
      reject(error);
    }, timeoutMs);
    worker.pending.set(id, { resolve, reject, timeout });
    try {
      worker.proc.stdin.write(`${JSON.stringify({ id, wav })}\n`);
    } catch (err) {
      worker.pending.delete(id);
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error(String(err)));
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
  return new Promise<string>((resolve, reject) => {
    // Capture stderr (was ignored) so an STT failure is LOUD in the journal, not silent.
    const proc = spawn(python, ['-c', py, wav], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('close', (code) => {
      if (code !== 0) {
        const cause = err.trim().slice(0, 300) || `process exited with code ${code}`;
        logger.warn(
          `[speech] STT failed (python='${python}', exit=${code}): ${cause}`
        );
        reject(new Error(`faster-whisper STT failed: ${cause}`));
        return;
      }
      resolve(out.trim());
    });
    proc.on('error', (e) => {
      logger.warn(
        `[speech] STT spawn failed (python='${python}'): ${e instanceof Error ? e.message : String(e)}`
      );
      reject(e instanceof Error ? e : new Error(String(e)));
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
  return new Promise<string>((resolve, reject) => {
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
      if (code !== 0) {
        const cause = err.trim().slice(0, 300) || `process exited with code ${code}`;
        logger.warn(
          `[speech] Parakeet STT failed (python='${python}', exit=${code}): ${cause}`
        );
        reject(new Error(`Parakeet STT failed: ${cause}`));
        return;
      }
      resolve(text.trim());
    });
    proc.on('error', (e) => {
      logger.warn(
        `[speech] Parakeet STT spawn failed (python='${python}'): ${e instanceof Error ? e.message : String(e)}`
      );
      reject(e instanceof Error ? e : new Error(String(e)));
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
      if (err instanceof SpeechWorkerRequestError) throw err;
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
      if (err instanceof SpeechWorkerRequestError) throw err;
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
  settlePending(worker, new SpeechWorkerRequestError('sherpa-rs worker disposed'));
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
      pending.reject(new SpeechWorkerRequestError(message.error.slice(0, 300)));
      return;
    }
    pending.resolve(message.text?.trim() || '');
  });
  proc.on('close', (code) => {
    if (sherpaRustWorker === worker) sherpaRustWorker = null;
    settlePending(worker, new SpeechWorkerRequestError(`sherpa-rs worker closed (code=${code})`));
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
    settlePending(worker, worker.readySettled ? new SpeechWorkerRequestError(err.message) : err);
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
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.pending.delete(id);
      const error = new SpeechWorkerRequestError(
        `sherpa-rs worker request timed out after ${timeoutMs}ms`,
      );
      logger.warn(`[speech] sherpa-rs worker request timed out after ${timeoutMs}ms`);
      disposeSherpaRustWorker(worker);
      reject(error);
    }, timeoutMs);
    worker.pending.set(id, { resolve, reject, timeout });
    try {
      worker.proc.stdin.write(`${JSON.stringify({ id, wav })}\n`);
    } catch (err) {
      worker.pending.delete(id);
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error(String(err)));
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
    resolveSpeechSttThreads()
  );
}

const warnedSpeechFallbacks = new Set<string>();

function warnAutoFallbackOnce(reason: string): void {
  const key = `auto:${reason}`;
  if (warnedSpeechFallbacks.has(key)) return;
  warnedSpeechFallbacks.add(key);
  logger.warn(`[speech] auto STT fallback activated: effective=faster-whisper reason=${reason}`);
}

/** Log one configuration-level STT fallback once for the lifetime of this process. */
export function warnSpeechFallbackOnce(
  plan: SpeechTranscriptionPlan,
  engine: SpeechRecognitionEngine,
  hotwordCount: number,
): void {
  if (!plan.fallbackReason) return;
  const key = plan.fallbackReason;
  if (warnedSpeechFallbacks.has(key)) return;
  warnedSpeechFallbacks.add(key);
  logger.warn(
    `[speech] STT fallback activated: requested=${plan.requestedEngine} effective=${engine} `
    + `language=${plan.language} reason=${plan.fallbackReason} hotwords=${hotwordCount}`,
  );
}

async function transcribeWavRaw(
  wav: string,
  engineOverride?: SpeechRecognitionEngine
): Promise<string> {
  // `engineOverride` lets ONE call path (e.g. long/video transcription) prefer a faster
  // engine WITHOUT touching the global `CODEBUDDY_SPEECH_ENGINE` default that the
  // companion/sensory hot paths read. Unset → the env-driven resolution (unchanged).
  const requestedEngine = engineOverride ?? resolveSpeechRecognitionEngine();
  const plan = resolveSpeechTranscriptionPlan(requestedEngine);
  const engine = plan.effectiveEngine;
  if (plan.blockingReason) {
    const message =
      `requested=${plan.requestedEngine} language=${plan.language} reason=${plan.blockingReason}`;
    logger.error(`[speech] STT unavailable: ${message}`);
    throw new Error(`STT unavailable: ${message}`);
  }
  if (plan.fallbackReason) {
    const hotwordCount = splitSpeechPhrases(defaultSpeechHotwords()).length;
    warnSpeechFallbackOnce(plan, engine, hotwordCount);
  }
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

  // Auto mode: prefer the in-process Rust engine only when both its binary and a
  // complete locally evidenced French model are present. A bare directory or a
  // stale binary must never silently select the sherpa path.
  const sherpaBin = resolveSherpaRustBin();
  const modelDir = resolveParakeetModelDir();
  const binaryAvailable = Boolean(sherpaBin && existsSync(sherpaBin));
  const frenchModelAvailable = isFrenchParakeetModelAvailable(modelDir);
  if (binaryAvailable && frenchModelAvailable) {
    try {
      return await transcribeWavWithSherpaRustRaw(wav);
    } catch (err) {
      warnAutoFallbackOnce('sherpa-rs-runtime-unavailable');
      logger.warn(
        `[speech] auto STT: sherpa-rs unavailable; trying Parakeet/faster-whisper: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    warnAutoFallbackOnce(
      !binaryAvailable
        ? 'sherpa-rs-binary-missing'
        : 'french-parakeet-model-missing-or-incomplete',
    );
  }
  if (frenchModelAvailable) {
    try {
      return await transcribeWavWithParakeetRaw(wav);
    } catch (err) {
      warnAutoFallbackOnce('parakeet-runtime-unavailable');
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
  const env = options.env ?? process.env;
  const debounceMs = options.debounceMs ?? resolveSpeechDebounceMs(env);
  const incompleteTurnHoldMs = options.incompleteTurnHoldMs ?? resolveIncompleteTurnHoldMs(env);
  const now = options.now ?? (() => Date.now());
  const transcribe = options.transcriber ?? transcribeWavRaw;
  const turnCoordinator = getVoiceTurnCoordinator();
  const sensoryBackchannelEnabled =
    env.CODEBUDDY_SENSORY_BACKCHANNEL === 'true' && Boolean(options.onConversationCue);
  const conversationCues = createConversationCueController({
    env,
    ...(options.onConversationCue ? { player: options.onConversationCue } : {}),
  });
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastSttFailureReplyAt = Number.NEGATIVE_INFINITY;
  let sttFailureCount = 0;
  const sttFailureReplyWindowMs = Math.max(debounceMs, DEFAULT_SPEECH_DEBOUNCE_MS);
  let inFlight = false;
  let activeWav: string | undefined;
  let activeTurnId: string | undefined;
  let disposed = false;
  let liveSeq = 0; // unique dedup key for live-mic finals (there's no WAV to key on)
  let turnSeq = 0;
  let pendingSpeechStartedAtMs: number | undefined;
  let pendingSpeechTurnId: string | undefined;
  let pendingSpeechPartialText: string | undefined;
  let bargedSpeechTurnId: string | undefined;
  let suspectedOwnPlaybackTurnId: string | undefined;
  let leakagePlaybackStartedAtMs: number | undefined;
  let leakageSamples: number[] = [];

  const resetLeakageReference = (playbackStartedAtMs?: number): void => {
    leakagePlaybackStartedAtMs = playbackStartedAtMs;
    leakageSamples = [];
  };

  const payloadRms = (payload: Record<string, unknown>): number | undefined => {
    for (const key of ['avgRms', 'rms', 'peakRms']) {
      const value = payload[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    }
    return undefined;
  };

  const payloadNoiseFloorRms = (payload: Record<string, unknown>): number | undefined => {
    const value = payload.noiseFloorRms;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  };

  /**
   * Measure the playback leakage reference from the first 300 ms of reported mic energy.
   * A missing reference fails closed; the independent 250 ms duration path remains available.
   */
  const shouldTriggerAcousticBargeIn = (
    payload: Record<string, unknown>,
    speechStartedAtMs: number | undefined,
  ): boolean => {
    if (!voiceBargeInEnabled(env) || speechStartedAtMs === undefined) return false;
    const timing = measureVoiceResumeTiming(speechStartedAtMs);
    if (timing?.kind !== 'during_playback') {
      resetLeakageReference();
      return false;
    }
    const playbackStartedAtMs = speechStartedAtMs - timing.afterPlaybackStartMs;
    if (leakagePlaybackStartedAtMs !== playbackStartedAtMs) {
      resetLeakageReference(playbackStartedAtMs);
    }
    const durationReady = (capturedSpeechMs(payload) ?? 0) >= DEFAULT_VOICE_BARGEIN_MIN_SPEECH_MS;
    const rms = payloadRms(payload);
    const noiseFloorRms = payloadNoiseFloorRms(payload);
    const referenceSample = noiseFloorRms ?? rms;
    // The VAD's calibrated floor is already a leakage measurement. Use it at once when the
    // speech-start sample clears the margin; otherwise collect the first 300 ms before deciding.
    if (rms !== undefined && noiseFloorRms !== undefined
      && exceedsVoiceLeakageMargin(rms, noiseFloorRms, resolveVoiceBargeInMarginDb(env))) {
      return true;
    }
    if (timing.afterPlaybackStartMs <= VOICE_BARGEIN_LEAKAGE_REFERENCE_MS) {
      if (referenceSample !== undefined) leakageSamples.push(referenceSample);
      return durationReady;
    }
    if (durationReady) return true;
    const leakageRms = leakageSamples.length > 0
      ? leakageSamples.reduce((sum, sample) => sum + sample, 0) / leakageSamples.length
      : noiseFloorRms;
    if (rms === undefined || leakageRms === undefined) return false;
    return exceedsVoiceLeakageMargin(rms, leakageRms, resolveVoiceBargeInMarginDb(env));
  };
  type SpeechJob = {
    p: ReturnType<typeof perceptionOf>;
    wav: string;
    presetText?: string;
    speechStartedAtMs?: number;
    turnId?: string;
    repairAddressHint?: string;
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

  const speakSttFailure = async (failure: SpeechSttFailure): Promise<boolean> => {
    if (options.onSpeechError) {
      return (await options.onSpeechError(failure)) === true;
    }
    // The ordinary `onHeard` path may invoke an LLM. STT failures must use only the
    // existing local speech path, and only when this wire is actually configured to speak.
    if (!options.onHeard) return false;
    try {
      const { sayNow } = await import('./voice-loop.js');
      return await sayNow(STT_FAILURE_REPLY, { phoneDelivery: 'never' });
    } catch (error) {
      logger.warn(
        `[speech] local STT failure recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  };

  const heardHandler = options.onHeard as
    | (NonNullable<SpeechReactionOptions['onHeard']> & { lastTiming?: { spoke?: boolean } })
    | undefined;

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
    const aecActive = (job.p.payload as Record<string, unknown> | undefined)?.aecActive === true;
    const aecTrusted = isSensoryAecTrusted(aecActive);
    // A turn that already barged in (CONV2) has stopped the playback: hear it. Otherwise the
    // half-duplex guard only opens for an explicitly trusted AEC (SENSE1) — never on aecActive alone.
    const bargedIn = job.turnId !== undefined && bargedSpeechTurnId === job.turnId;
    if (isSpeaking(t) && !aecTrusted && !bargedIn) {
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
        let rawText = '';
        let sttFailure: Error | undefined;
        try {
          rawText = job.presetText !== undefined ? job.presetText : await transcribe(job.wav);
        } catch (error) {
          sttFailure = error instanceof Error ? error : new Error(String(error));
        }
        const normalizedText: NormalizedSpeechTranscript = sttFailure
          ? { text: '' }
          : normalizeSpeechTranscript(rawText);
        const text = normalizedText.text;
        const ingestMs = elapsedSince(transcribeStartMs, now);
        // On live `transcript_final`, the real decode happened upstream in
        // buddy-sense. Report its payload timing instead of the near-zero cost of
        // copying preset text into the brain.
        sttMs = job.presetText !== undefined && decodeMs !== undefined ? decodeMs : ingestMs;
        const perceptModule = import('../companion/percepts.js');
        const latencyPayload = {
          ...(captureStartedAtMs !== undefined ? { captureStartedAtMs } : {}),
          ...(captureEndedAtMs !== undefined ? { captureEndedAtMs } : {}),
          ...(eventTimestamp !== undefined ? { eventReceivedAtMs: eventTimestamp } : {}),
          transcribeStartMs,
          sttMs,
          ...(job.presetText !== undefined ? { ingestMs } : {}),
          ...(endpointMs !== undefined ? { endpointMs } : {}),
          ...(decodeMs !== undefined ? { decodeMs } : {}),
          ...(turnDetectionMs !== undefined ? { turnDetectionMs } : {}),
          ...(endpointMs !== undefined || decodeMs !== undefined || turnDetectionMs !== undefined
            ? {
                inputReadyMs:
                  (endpointMs ?? 0)
                  + (turnDetectionMs ?? 0)
                  + (job.presetText !== undefined ? sttMs : (decodeMs ?? 0) + sttMs),
              }
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
        if (sttFailure) {
          sttFailureCount += 1;
          const cause = sttFailure.message.slice(0, 300) || sttFailure.name;
          const signal = job.presetText === undefined
            ? realSpeechCapture(job.wav, payload)
            : undefined;
          let recoverySpoke = false;
          if (
            signal
            && now() - lastSttFailureReplyAt >= sttFailureReplyWindowMs
          ) {
            lastSttFailureReplyAt = now();
            try {
              recoverySpoke = await speakSttFailure({
                wav: job.wav,
                cause,
                count: sttFailureCount,
                durationMs: signal.durationMs,
                rms: signal.rms,
              });
            } catch (error) {
              logger.warn(
                `[speech] STT failure recovery threw: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          spoke = recoverySpoke;
          turnCoordinator.transition(turnId, 'failed', {
            errorCategory: 'stt',
            sttMs,
            spoke: recoverySpoke,
          });
          logger.warn(
            `[speech] STT failed (#${sttFailureCount}): ${cause}`
            + (signal ? `; local recovery spoke=${recoverySpoke}` : '; no real speech capture for local recovery'),
          );
          await (await perceptModule).recordCompanionPercept(
            {
              modality: 'hearing',
              source: 'sensory_speech_reaction',
              summary: 'Speech captured; STT failed',
              confidence: 0.35,
              payload: {
                text: '',
                wav: job.wav,
                responded: recoverySpoke,
                sttFailure: true,
                sttEmpty: true,
                sttEmptyReason: 'error',
                sttFailureCause: cause,
                sttFailureCount,
                ...(recoverySpoke ? { sttFailureRecovery: STT_FAILURE_REPLY } : {}),
                latency: latencyPayload,
                capture: capturePayload,
              },
              tags: ['speech', 'stt', 'latency', 'error'],
            },
            options.cwd ? { cwd: options.cwd } : {},
          );
          return;
        }
        if (!text) {
          let repairAddressed = false;
          if (env.CODEBUDDY_SENSORY_REPAIR === 'true' && options.onConversationCue) {
            if (job.repairAddressHint && options.isAddressed) {
              try {
                repairAddressed = await options.isAddressed(job.repairAddressHint);
              } catch {
                repairAddressed = false;
              }
            }
            const attention = options.getAttentionSnapshot?.();
            repairAddressed ||= attention?.engaged === true && attention.source === 'addressed';
          }
          const repairStartedAt = now();
          const repairSpoke = repairAddressed
            ? await conversationCues.playRepair(turnId)
            : false;
          actionMs = repairAddressed ? elapsedSince(repairStartedAt, now) : 0;
          spoke = repairSpoke;
          turnCoordinator.transition(turnId, repairSpoke ? 'completed' : 'suppressed', {
            suppressionReason: repairAddressed
              ? repairSpoke ? undefined : 'repair-cue-unavailable'
              : normalizedText.filteredReason ?? 'stt-empty',
            sttMs,
            spoke: repairSpoke,
          });
          const emptyReason = normalizedText.filteredReason ?? 'empty';
          logger.info(`[speech] empty transcript (${sttMs}ms STT, ${emptyReason})`);
          await (await perceptModule).recordCompanionPercept(
            {
              modality: 'hearing',
              source: 'sensory_speech_reaction',
              summary: 'Speech captured; STT returned no text',
              confidence: 0.25,
              payload: {
                text: '',
                ...(job.presetText !== undefined ? { live: true } : { wav: job.wav }),
                responded: repairSpoke,
                sttEmpty: true,
                sttEmptyReason: emptyReason,
                ...(repairAddressed ? { repairTriggered: true, repairSpoke } : {}),
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
        const echoClassification = classifyRecentVoiceEcho(
          text,
          captureStartedAtMs ?? transcribeStartMs,
        );
        const explicitBargeIn = playbackCaptureKind
          ? shouldTriggerVoiceBargeIn(text, payload)
            // A turn that already cut the playback acoustically (CONV2 speech_start barge-in)
            // counts as an explicit interruption: the robot is no longer speaking over it.
            || (job.turnId !== undefined && bargedSpeechTurnId === job.turnId)
          : false;
        const ownEcho = echoClassification === 'echo';
        const suppressPlaybackCapture = ownEcho || (
          playbackCaptureKind !== undefined && echoClassification !== 'unknown'
            ? shouldSuppressPlaybackCapture(
                playbackCaptureKind,
                echoClassification,
                explicitBargeIn,
                isSensoryAecTrusted(payload.aecActive === true),
              )
            : false
        );
        if (suppressPlaybackCapture) {
          const suppressionReason = ownEcho && playbackCaptureKind === undefined
            ? 'own_echo'
            : playbackCaptureKind === 'during_playback'
              ? ownEcho
                ? 'during_playback_echo'
                : 'during_playback_non_explicit'
              : `echo_tail_${echoClassification}`;
          if (ownEcho) {
            logger.info('[speech] dropped own echo');
          } else {
            logger.info(
              `[speech] suppressed playback capture reason=${suppressionReason}`,
            );
          }
          turnCoordinator.transition(turnId, 'suppressed', {
            suppressionReason,
            sttMs,
            scene: playbackCaptureKind ? 'assistant_playback' : 'assistant_echo',
            sceneConfidence: echoClassification === 'echo' ? 0.98 : 0.8,
          });
          await (await perceptModule).recordCompanionPercept(
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
                ...(voiceResume ? { turnTaking: voiceResume } : {}),
                latency: latencyPayload,
                capture: capturePayload,
              },
              tags: ['speech', 'echo', 'playback-capture', 'turn-taking'],
            },
            options.cwd ? { cwd: options.cwd } : {},
          );
          return;
        }
        const configuredPlan = resolveSpeechTranscriptionPlan();
        const sttEngine = typeof payload.sttEngine === 'string'
          ? payload.sttEngine
          : job.presetText !== undefined
            ? 'sherpa-rs'
            : configuredPlan.effectiveEngine;
        const sttLanguage = typeof payload.sttLanguage === 'string'
          ? payload.sttLanguage
          : configuredPlan.language;
        const sttModel = typeof payload.sttModel === 'string'
          ? payload.sttModel
          : sttEngine === 'faster-whisper'
            ? process.env.CODEBUDDY_SPEECH_MODEL?.trim() || 'base'
            : resolveParakeetModelDir();
        const hotwordsState = payload.hotwordsApplied === false
          ? 'ignored'
          : sttEngine === 'faster-whisper' && defaultSpeechHotwords()
            ? 'applied'
            : 'none';
        logger.info(
          `[speech] heard (${sttMs}ms STT, engine=${sttEngine}, model=${sttModel}, language=${sttLanguage}, hotwords=${hotwordsState}) → ${text}`
        );

        let backchannel: ConversationCueHandle | null = null;
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
          ...(sensoryBackchannelEnabled
            ? { onResponseAudioStart: () => backchannel?.cancel() }
            : {}),
        };
        let acceptedForSemanticIngress = true;
        let responded = Boolean(options.onHeard);
        let repaired = false;
        let repairReason: 'short' | 'low-confidence' | undefined;
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

        const confidence = finiteTimestamp(payload.confidence);
        if (
          acceptedForSemanticIngress
          && decisionReason === 'addressed'
          && env.CODEBUDDY_SENSORY_REPAIR === 'true'
          && options.onConversationCue
          && shouldRepairTranscript(text, confidence)
        ) {
          repairReason = (text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) <= 2
            ? 'short'
            : 'low-confidence';
          const repairStartedAt = now();
          spoke = await conversationCues.playRepair(turnId);
          actionMs = elapsedSince(repairStartedAt, now);
          repaired = true;
          responded = spoke;
          acceptedForSemanticIngress = false;
        }

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

        if (repaired) {
          turnCoordinator.transition(turnId, spoke ? 'completed' : 'suppressed', {
            decisionReason,
            suppressionReason: spoke ? undefined : 'repair-cue-unavailable',
            spoke,
            totalMs: elapsedSince(transcribeStartMs, now),
          });
        } else if (responded) {
          if (sensoryBackchannelEnabled && decisionReason === 'addressed') {
            backchannel = conversationCues.armBackchannel(turnId);
          }
          turnCoordinator.transition(turnId, 'thinking', {
            decisionReason,
            decisionMs,
          });
          const actionStartMs = now();
          try {
            await options.onHeard?.(text, turnContext);
          } finally {
            backchannel?.cancel();
          }
          actionMs = elapsedSince(actionStartMs, now);
          responseTiming = options.getResponseTiming?.();
          // The voice handler publishes the same fact through getResponseTiming or its
          // lastTiming property. An uninstrumented/no-op hook is not evidence of audio.
          spoke = responseTiming?.spoke ?? heardHandler?.lastTiming?.spoke ?? false;
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
          (endpointMs ?? 0)
          + (turnDetectionMs ?? 0)
          + (job.presetText !== undefined ? sttMs : (decodeMs ?? 0) + sttMs);
        const perceivedResponseMs =
          responseTiming?.firstAudioMs !== undefined
            ? inputReadyMs + decisionMs + responseTiming.firstAudioMs
            : undefined;
        const perceivedContentResponseMs =
          responseTiming?.firstContentAudioMs !== undefined
            ? inputReadyMs + decisionMs + responseTiming.firstContentAudioMs
            : undefined;
        await (await perceptModule).recordCompanionPercept(
          {
            modality: 'hearing',
            source: 'sensory_speech_reaction',
            summary: `Heard: ${text}`,
            confidence: 0.8,
            payload: {
              text,
              ...(job.presetText !== undefined ? { live: true } : { wav: job.wav }),
              responded,
              stt: {
                requestedEngine:
                  typeof payload.sttRequestedEngine === 'string'
                    ? payload.sttRequestedEngine
                    : configuredPlan.requestedEngine,
                engine: sttEngine,
                model: sttModel,
                language: sttLanguage,
                hotwords: hotwordsState,
                ...(typeof payload.sttFallbackReason === 'string'
                  ? { fallbackReason: payload.sttFallbackReason }
                  : {}),
              },
              ...(decisionReason ? { decisionReason } : {}),
              ...(repaired ? { repairTriggered: true, repairReason } : {}),
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
      pendingSpeechPartialText = undefined;
      bargedSpeechTurnId = undefined;
      turnCoordinator.transition(pendingSpeechTurnId, 'listening', {
        aecActive: payload.aecActive === true,
      });
      const speechStartedAtMs = pendingSpeechStartedAtMs ?? now();
      const playbackActive = measureVoiceResumeTiming(speechStartedAtMs)?.kind === 'during_playback';
      const suspectedOwnPlayback = playbackActive
        && payload.aecActive !== true
        && (env.CODEBUDDY_SENSORY_REPAIR === 'true' || sensoryBackchannelEnabled)
        && hasRecentSpokenReference(speechStartedAtMs);
      suspectedOwnPlaybackTurnId = suspectedOwnPlayback ? pendingSpeechTurnId : undefined;
      if (
        inFlight
        && playbackActive
        && !suspectedOwnPlayback
        && voiceBargeInEnabled(env)
        && (
          shouldTriggerVoiceBargeInOnSpeechStart(payload)
          || shouldTriggerAcousticBargeIn(payload, speechStartedAtMs)
        )
        && (pendingSpeechTurnId === undefined || bargedSpeechTurnId !== pendingSpeechTurnId)
      ) {
        bargedSpeechTurnId = pendingSpeechTurnId;
        try {
          if (options.onBargeInStart) {
            options.onBargeInStart(payload, activeTurnId);
          } else {
            options.onBargeIn?.('', activeTurnId);
          }
        } catch {
          /* interruption is best-effort */
        }
      }
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
      pendingSpeechPartialText = text;
      const acousticBargeIn = shouldTriggerAcousticBargeIn(payload, pendingSpeechStartedAtMs);
      if (
        inFlight &&
        (options.onBargeIn || options.onBargeInStart) &&
        (shouldTriggerVoiceBargeIn(text, payload, env) || acousticBargeIn) &&
        (pendingSpeechTurnId === undefined || bargedSpeechTurnId !== pendingSpeechTurnId)
      ) {
        if (pendingSpeechTurnId !== undefined) bargedSpeechTurnId = pendingSpeechTurnId;
        try {
          if (acousticBargeIn && options.onBargeInStart) {
            options.onBargeInStart(payload, activeTurnId);
          } else {
            options.onBargeIn?.(text, activeTurnId);
          }
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
      const livePayload = p.payload as {
        text?: string;
        turnDetector?: string;
        endpointWaitMs?: number;
      } | undefined;
      let speechStartedAtMs = finiteTimestamp(
        (p.payload as Record<string, unknown> | undefined)?.startedAtMs,
      ) ?? pendingSpeechStartedAtMs;
      let turnId = pendingSpeechTurnId;
      const suspectedOwnPlayback = turnId !== undefined
        && suspectedOwnPlaybackTurnId === turnId;
      const repairAddressHint = pendingSpeechPartialText;
      pendingSpeechStartedAtMs = undefined;
      pendingSpeechTurnId = undefined;
      pendingSpeechPartialText = undefined;
      let text = livePayload?.text?.trim() ?? '';
      if (suspectedOwnPlayback) suspectedOwnPlaybackTurnId = undefined;
      if (suspectedOwnPlayback && isRecentVoiceFragmentEcho(text, speechStartedAtMs ?? now())) {
        if (turnId) {
          turnCoordinator.transition(turnId, 'suppressed', {
            suppressionReason: 'own_playback_fragment',
            scene: 'assistant_playback',
            sceneConfidence: 0.98,
          });
        }
        logger.info('[speech] dropped own playback fragment');
        return;
      }
      if (!text && env.CODEBUDDY_SENSORY_REPAIR !== 'true') return;
      const key = `live:${liveSeq++}`;
      if (heldLiveTurn) {
        clearTimeout(heldLiveTurn.timer);
        text = joinVoiceTurnFragments(heldLiveTurn.text, text);
        speechStartedAtMs = heldLiveTurn.speechStartedAtMs ?? speechStartedAtMs;
        turnId = heldLiveTurn.turnId ?? turnId;
        heldLiveTurn = null;
      }
      let turnDecision: ReturnType<typeof resolveTurnDetectorDecision>;
      try {
        turnDecision = resolveTurnDetectorDecision(
          { text, payload: (p.payload as Record<string, unknown> | undefined) ?? {} },
          options.turnDecisionProvider,
        );
      } catch (error) {
        logger.warn(
          `[speech] LiveKit turn decision unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // Smart Turn has already considered prosody and the complete audio. The
      // text heuristic is only a fail-open fallback for VAD-only sources.
      const conversationalEndSilenceMs = resolveConversationalTurnEndSilenceMs(text, env);
      const endpointWaitMs = finiteTimestamp(livePayload?.endpointWaitMs) ?? 0;
      const remainingIncompleteHoldMs = conversationalEndSilenceMs === null
        ? incompleteTurnHoldMs
        : Math.max(0, conversationalEndSilenceMs - endpointWaitMs);
      if (
        // CONV1 shortened the hold (conversational end-silence minus the endpoint already waited);
        // PILE-C lets an opt-in turn detector decide before the text heuristic (fail-open).
        remainingIncompleteHoldMs > 0 &&
        (turnDecision?.endOfTurn === false || (
          turnDecision?.endOfTurn !== true &&
          !livePayload?.turnDetector &&
          isLikelyIncompleteVoiceTurn(text)
        ))
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
            ...(repairAddressHint ? { repairAddressHint } : {}),
          };
          if (inFlight) queuePendingSpeech(job);
          else startSpeechJob(job);
        }, remainingIncompleteHoldMs);
        heldLiveTurn = {
          p,
          text,
          key,
          timer,
          ...(speechStartedAtMs !== undefined ? { speechStartedAtMs } : {}),
          ...(turnId ? { turnId } : {}),
        };
        logger.debug(
          `[speech] holding likely incomplete turn for ${remainingIncompleteHoldMs}ms → ${text}`,
        );
        return;
      }
      if (inFlight) {
        const payload = (p.payload as Record<string, unknown> | undefined) ?? {};
        const acousticBargeIn = shouldTriggerAcousticBargeIn(payload, speechStartedAtMs);
        if (
          (options.onBargeIn || options.onBargeInStart) &&
          (shouldTriggerVoiceBargeIn(text, payload, env) || acousticBargeIn) &&
          (turnId === undefined || bargedSpeechTurnId !== turnId)
        ) {
          if (turnId !== undefined) bargedSpeechTurnId = turnId;
          logger.info(`[speech] barge-in → ${text}`);
          try {
            if (acousticBargeIn && options.onBargeInStart) {
              options.onBargeInStart(payload, activeTurnId);
            } else {
              options.onBargeIn?.(text, activeTurnId);
            }
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
            ...(repairAddressHint ? { repairAddressHint } : {}),
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
        ...(repairAddressHint ? { repairAddressHint } : {}),
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
    if (turnId !== undefined && suspectedOwnPlaybackTurnId === turnId) {
      suspectedOwnPlaybackTurnId = undefined;
      return;
    }
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
    conversationCues.dispose();
    if (heldLiveTurn) clearTimeout(heldLiveTurn.timer);
    heldLiveTurn = null;
    const abandonedSpeech = pendingSpeech;
    pendingSpeech = null;
    if (abandonedSpeech) void cleanupSpeechJob(abandonedSpeech);
    bus.off(id);
  };
}
