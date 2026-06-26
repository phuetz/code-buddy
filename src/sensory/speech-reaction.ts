/**
 * Speech reaction — closes the perception→cognition loop. On a `speech_end` event
 * that carries the source WAV (the daemon tags it), transcribe the utterance (STT)
 * and record what was heard as a `hearing` percept; an optional `onHeard` hook can
 * drive further action (a turn, a command). DEBOUNCED (one transcription per
 * utterance — the energy VAD over-segments), opt-in (`CODEBUDDY_SENSORY_SPEECH=true`),
 * injectable transcriber, never-throws.
 *
 * @module sensory/speech-reaction
 */

import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';

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

/** Default transcriber: local faster-whisper (base), best-effort, $0. Exported so the
 *  push-to-talk CLI path (`buddy voice`) transcribes through the exact same STT as the daemon. */
export async function transcribeWav(wav: string): Promise<string> {
  const { spawn } = await import('child_process');
  const model = process.env.CODEBUDDY_SPEECH_MODEL ?? 'base';
  const py = [
    'import sys',
    'from faster_whisper import WhisperModel',
    `m = WhisperModel(${JSON.stringify(model)}, device='cpu', compute_type='int8')`,
    'segs, _ = m.transcribe(sys.argv[1])',
    "print(' '.join(s.text for s in segs).strip())",
  ].join('\n');
  return new Promise<string>((resolve) => {
    const proc = spawn('python3', ['-c', py, wav], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.on('close', () => resolve(out.trim()));
    proc.on('error', () => resolve(''));
  });
}

export function wireSpeechReaction(options: SpeechReactionOptions = {}): () => void {
  const bus = getGlobalEventBus();
  const debounceMs = options.debounceMs ?? Number(process.env.CODEBUDDY_SPEECH_DEBOUNCE_MS ?? 4000);
  const now = options.now ?? (() => Date.now());
  const transcribe = options.transcriber ?? transcribeWav;
  let lastAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    if (p.modality !== 'audio' || p.kind !== 'speech_end') return;
    const wav = (p.payload as { wav?: string } | undefined)?.wav;
    if (!wav) return; // no audio to transcribe (e.g. a live-mic path not yet wired)

    const t = now();
    if (t - lastAt < debounceMs) return; // one transcription per utterance
    if (inFlight) return; // a prior STT (faster-whisper, seconds) is still running
    lastAt = t;
    inFlight = true;

    void (async () => {
      try {
        const text = await transcribe(wav);
        if (!text) return;
        const { recordCompanionPercept } = await import('../companion/percepts.js');
        await recordCompanionPercept(
          {
            modality: 'hearing',
            source: 'sensory_speech_reaction',
            summary: `Heard: ${text}`,
            confidence: 0.8,
            payload: { text, wav },
            tags: ['speech', 'stt'],
          },
          options.cwd ? { cwd: options.cwd } : {},
        );
        logger.info(`[speech] heard → ${text}`);
        // Human-like gate: observed + remembered above; only SPEAK if warranted.
        if (options.shouldRespond) {
          const decision = await options.shouldRespond(text);
          if (!decision.respond) {
            logger.info(`[speech] silent (${decision.reason})`);
            return;
          }
          logger.info(`[speech] responding (${decision.reason})`);
        }
        await options.onHeard?.(text);
      } catch (err) {
        logger.warn(`[speech] reaction failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        // Re-stamp AFTER the full hear→think→speak cycle so the debounce window
        // restarts from end-of-playback. When onHeard speaks (voice-loop), this
        // suppresses the robot re-hearing the tail of its own voice (echo guard).
        lastAt = now();
        inFlight = false;
      }
    })();
  });

  return () => {
    bus.off(id);
  };
}
