/**
 * Half-duplex voice guard — "is the robot currently speaking?".
 *
 * Without acoustic echo cancellation, the companion's microphone (the ear) hears
 * the companion's OWN speaker output: it greets/answers aloud, the mic transcribes
 * that, and it answers itself in a loop — while also dropping the human's real
 * speech (busy). This module is the single shared signal that every spoken-output
 * path (greeting `sayNow`, voice reply, reminders) raises while it plays, and the
 * speech reaction checks before transcribing, so the robot ignores the mic while it
 * is talking (+ a short tail for the room/echo to settle).
 *
 * @module sensory/voice-activity
 */
let activePlays = 0;
let speakingUntilMs = 0;

/** Echo tail after playback ends, ms (room reverberation + buffered audio). */
export const DEFAULT_VOICE_ECHO_TAIL_MS = 1_200;
export const SENSORY_AEC_TRUST_ENV = 'CODEBUDDY_SENSORY_AEC_TRUST';
const configuredTailRaw = process.env.CODEBUDDY_SENSORY_ECHO_TAIL_MS?.trim();
const configuredTailMs = configuredTailRaw ? Number(configuredTailRaw) : Number.NaN;
const TAIL_MS = Number.isFinite(configuredTailMs) && configuredTailMs >= 0
  ? Math.min(5_000, configuredTailMs)
  : DEFAULT_VOICE_ECHO_TAIL_MS;
const MAX_PLAYBACK_INTERVALS = 8;
const MAX_SPOKEN_REFERENCES = 8;
const RESUME_WINDOW_MS = 5 * 60_000;
export const DEFAULT_OWN_ECHO_WINDOW_MS = 90_000;

interface VoicePlaybackInterval {
  startedAtMs: number;
  endedAtMs?: number;
  earReadyAtMs?: number;
  interrupted: boolean;
  tailBypassed: boolean;
}

interface SpokenReference {
  normalized: string;
  tokens: string[];
  recordedAtMs: number;
}

export type VoiceResumeKind = 'during_playback' | 'echo_tail' | 'after_playback';

export interface VoiceResumeTiming {
  kind: VoiceResumeKind;
  /** Human speech start relative to the assistant playback start. */
  afterPlaybackStartMs: number;
  /** Human speech start relative to playback end; absent for an unfinished playback. */
  resumeAfterPlaybackMs?: number;
  /** Remaining guard delay when speech started before the ear's nominal reopen edge. */
  earReadyInMs?: number;
  playbackInterrupted: boolean;
  tailBypassed: boolean;
}

export type VoiceEchoClassification = 'echo' | 'distinct' | 'unknown';

const playbackIntervals: VoicePlaybackInterval[] = [];
const spokenReferences: SpokenReference[] = [];
let currentPlayback: VoicePlaybackInterval | undefined;

function finiteClock(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Treat the capture-side AEC flag as a half-duplex bypass only after an explicit
 * operator opt-in. Merely advertising AEC is not evidence that loudspeaker echo
 * was removed from the actual microphone signal.
 */
export function isSensoryAecTrusted(
  aecActive: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return aecActive && env[SENSORY_AEC_TRUST_ENV]?.trim().toLowerCase() === 'true';
}

function normalizeSpokenText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rememberInterval(interval: VoicePlaybackInterval): void {
  if (!playbackIntervals.includes(interval)) playbackIntervals.push(interval);
  if (playbackIntervals.length > MAX_PLAYBACK_INTERVALS) {
    playbackIntervals.splice(0, playbackIntervals.length - MAX_PLAYBACK_INTERVALS);
  }
}

/** Mark the start of spoken output (call before a blocking play). */
export function beginSpeaking(now: number = Date.now()): void {
  if (activePlays === 0 && finiteClock(now)) {
    currentPlayback = {
      startedAtMs: now,
      interrupted: false,
      tailBypassed: false,
    };
    rememberInterval(currentPlayback);
  }
  activePlays += 1;
}

/** Mark the end of spoken output (call after play resolves); arms the echo tail. */
export function endSpeaking(now: number = Date.now()): void {
  const wasActive = activePlays > 0;
  activePlays = Math.max(0, activePlays - 1);
  if (wasActive && activePlays === 0) {
    speakingUntilMs = now + TAIL_MS;
    if (currentPlayback && finiteClock(now)) {
      currentPlayback.endedAtMs = now;
      currentPlayback.earReadyAtMs = speakingUntilMs;
      currentPlayback = undefined;
    }
  }
}

/** True while the robot is speaking or within the echo tail — the ear should be ignored. */
export function isSpeaking(now: number = Date.now()): boolean {
  return activePlays > 0 || now < speakingUntilMs;
}

/** Serializes the mouth: the tail of the last queued spoken output. */
let mouthChain: Promise<void> = Promise.resolve();

/**
 * Run a blocking play under the speaking guard, SERIALIZED against every other spoken output — so
 * concurrent callers (a reminder `sayNow`, an arrival greeting, a voice reply) queue instead of
 * playing OVER each other (the robot talking over itself). Each call waits its turn, then raises the
 * half-duplex guard for exactly its own playback. The guard's echo tail bridges the gap between
 * queued plays, so the ear stays muted across the whole spoken sequence.
 */
export async function withSpeakingGuard(play: () => Promise<void>): Promise<void> {
  const run = mouthChain.then(async () => {
    beginSpeaking();
    try {
      await play();
    } finally {
      endSpeaking();
    }
  });
  // Keep the chain alive even if this play throws, so one failure doesn't wedge the mouth; the
  // caller still sees the rejection via `run`.
  mouthChain = run.catch(() => {});
  return run;
}

/**
 * Keep a short, memory-only fingerprint of text sent to the loudspeaker TTS.
 * It is used solely to distinguish room echo from a genuinely new quick reply;
 * neither the original text nor the fingerprint is persisted by this module.
 */
export function noteSpokenText(text: string, now: number = Date.now()): void {
  const normalized = normalizeSpokenText(text);
  if (!normalized || !finiteClock(now)) return;
  const bounded = normalized.slice(0, 1_000);
  for (let index = spokenReferences.length - 1; index >= 0; index--) {
    if (now - spokenReferences[index]!.recordedAtMs > DEFAULT_OWN_ECHO_WINDOW_MS) {
      spokenReferences.splice(index, 1);
    }
  }
  spokenReferences.push({
    normalized: bounded,
    tokens: bounded.split(' ').filter(Boolean),
    recordedAtMs: now,
  });
  if (spokenReferences.length > MAX_SPOKEN_REFERENCES) {
    spokenReferences.splice(0, spokenReferences.length - MAX_SPOKEN_REFERENCES);
  }
}

/** Classify a transcript against only the recent in-memory loudspeaker fingerprints. */
export function classifyRecentVoiceEcho(
  transcript: string,
  atMs: number = Date.now(),
): VoiceEchoClassification {
  const normalized = normalizeSpokenText(transcript).slice(0, 1_000);
  if (!normalized || !finiteClock(atMs)) return 'unknown';
  const references = spokenReferences.filter(
    reference => atMs >= reference.recordedAtMs - 1_000
      && atMs - reference.recordedAtMs <= DEFAULT_OWN_ECHO_WINDOW_MS,
  );
  if (references.length === 0) return 'unknown';

  const transcriptTokens = new Set(normalized.split(' ').filter(Boolean));
  for (const reference of references) {
    if (
      reference.normalized.includes(normalized)
      || normalized.includes(reference.normalized)
    ) {
      return 'echo';
    }
    if (reference.tokens.length > 0) {
      const overlap = reference.tokens.filter(token => transcriptTokens.has(token)).length;
      if (overlap / reference.tokens.length >= 0.6) return 'echo';
    }
  }
  return 'distinct';
}

/**
 * Measure when the human started speaking relative to the most relevant recent
 * assistant playback. The result contains durations only, never transcript text.
 */
export function measureVoiceResumeTiming(humanStartedAtMs: number): VoiceResumeTiming | undefined {
  if (!finiteClock(humanStartedAtMs)) return undefined;
  const intervals = [...playbackIntervals].reverse();
  const overlapping = intervals.find(interval =>
    interval.startedAtMs <= humanStartedAtMs
      && (
        interval.endedAtMs === undefined
        || humanStartedAtMs < interval.endedAtMs
        || (interval.interrupted && humanStartedAtMs === interval.endedAtMs)
      ),
  );
  if (overlapping) {
    return {
      kind: 'during_playback',
      afterPlaybackStartMs: Math.max(0, humanStartedAtMs - overlapping.startedAtMs),
      ...(overlapping.endedAtMs !== undefined
        ? { resumeAfterPlaybackMs: humanStartedAtMs - overlapping.endedAtMs }
        : {}),
      playbackInterrupted: overlapping.interrupted,
      tailBypassed: overlapping.tailBypassed,
    };
  }

  const previous = intervals.find(interval =>
    interval.endedAtMs !== undefined
      && interval.endedAtMs <= humanStartedAtMs
      && humanStartedAtMs - interval.endedAtMs <= RESUME_WINDOW_MS,
  );
  if (!previous || previous.endedAtMs === undefined) return undefined;
  const earReadyAtMs = previous.earReadyAtMs ?? previous.endedAtMs;
  const resumeAfterPlaybackMs = humanStartedAtMs - previous.endedAtMs;
  const earReadyInMs = Math.max(0, earReadyAtMs - humanStartedAtMs);
  return {
    kind: earReadyInMs > 0 ? 'echo_tail' : 'after_playback',
    afterPlaybackStartMs: Math.max(0, humanStartedAtMs - previous.startedAtMs),
    resumeAfterPlaybackMs,
    ...(earReadyInMs > 0 ? { earReadyInMs } : {}),
    playbackInterrupted: previous.interrupted,
    tailBypassed: previous.tailBypassed,
  };
}

/**
 * Barge-in reset — hard-clear the guard when the current spoken turn is INTERRUPTED
 * (the human starts talking, or a programmatic `interrupt()`). Drops any active play
 * count, clears the echo tail, and resets the mouth chain so the ear re-opens
 * IMMEDIATELY (no tail) and no queued playback continues. Distinct from `endSpeaking`,
 * which arms the tail for a normal end-of-utterance. Idempotent, never-throws.
 */
export function interruptSpeaking(now: number = Date.now()): void {
  if (currentPlayback && finiteClock(now)) {
    currentPlayback.endedAtMs = now;
    currentPlayback.earReadyAtMs = now;
    currentPlayback.interrupted = true;
    currentPlayback.tailBypassed = true;
    currentPlayback = undefined;
  } else {
    const latest = playbackIntervals.at(-1);
    if (latest?.earReadyAtMs !== undefined && now < latest.earReadyAtMs) {
      latest.earReadyAtMs = now;
      latest.tailBypassed = true;
    }
  }
  activePlays = 0;
  speakingUntilMs = 0;
  mouthChain = Promise.resolve();
}

/** Test helper: reset the guard state. */
export function _resetVoiceActivityForTests(): void {
  activePlays = 0;
  speakingUntilMs = 0;
  mouthChain = Promise.resolve();
  currentPlayback = undefined;
  playbackIntervals.splice(0);
  spokenReferences.splice(0);
}
