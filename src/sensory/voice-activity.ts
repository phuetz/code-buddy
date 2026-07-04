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
const TAIL_MS = Number(process.env.CODEBUDDY_SENSORY_ECHO_TAIL_MS) || 1200;

/** Mark the start of spoken output (call before a blocking play). */
export function beginSpeaking(): void {
  activePlays += 1;
}

/** Mark the end of spoken output (call after play resolves); arms the echo tail. */
export function endSpeaking(now: number = Date.now()): void {
  activePlays = Math.max(0, activePlays - 1);
  speakingUntilMs = now + TAIL_MS;
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
 * Barge-in reset — hard-clear the guard when the current spoken turn is INTERRUPTED
 * (the human starts talking, or a programmatic `interrupt()`). Drops any active play
 * count, clears the echo tail, and resets the mouth chain so the ear re-opens
 * IMMEDIATELY (no tail) and no queued playback continues. Distinct from `endSpeaking`,
 * which arms the tail for a normal end-of-utterance. Idempotent, never-throws.
 */
export function interruptSpeaking(): void {
  activePlays = 0;
  speakingUntilMs = 0;
  mouthChain = Promise.resolve();
}

/** Test helper: reset the guard state. */
export function _resetVoiceActivityForTests(): void {
  activePlays = 0;
  speakingUntilMs = 0;
  mouthChain = Promise.resolve();
}
