/**
 * Deterministic conversational cues that never call a model or a synthesizer.
 * The controller owns timing/cancellation; the injected player owns local WAV
 * playback. Missing media therefore fails silent instead of entering a TTS path.
 */

import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

export const BACKCHANNEL_START_DELAY_MS = 120;
export const BACKCHANNEL_GAIN_DB = -12;
export const REPAIR_PROMPT = 'Pardon, tu disais ?';
export const REPAIR_CONFIDENCE_THRESHOLD = 0.55;
export const REPAIR_SHORT_TRANSCRIPT_WORDS = 2;

export type BackchannelCue = 'mhm' | 'oui';

export interface BackchannelCueRequest {
  kind: 'backchannel';
  cue: BackchannelCue;
  turnId: string;
  text: string;
  assetPath: string;
  gainDb: number;
  signal: AbortSignal;
}

export interface RepairCueRequest {
  kind: 'repair';
  cue: 'repair';
  turnId: string;
  text: typeof REPAIR_PROMPT;
  assetPath: string;
  gainDb: 0;
  signal: AbortSignal;
}

export type ConversationCueRequest = BackchannelCueRequest | RepairCueRequest;

export type ConversationCuePlayer = (
  request: ConversationCueRequest,
) => boolean | void | Promise<boolean | void>;

export interface ConversationCueHandle {
  cancel(): void;
}

export interface ConversationCueController {
  armBackchannel(turnId: string): ConversationCueHandle | null;
  playRepair(turnId: string): Promise<boolean>;
  dispose(): void;
}

interface ConversationCueControllerOptions {
  env?: NodeJS.ProcessEnv;
  player?: ConversationCuePlayer;
  now?: () => number;
  delayMs?: number;
}

const BACKCHANNELS: ReadonlyArray<{
  cue: BackchannelCue;
  text: string;
  file: string;
}> = [
  { cue: 'mhm', text: 'Mhm.', file: 'mhm.wav' },
  { cue: 'oui', text: 'Oui.', file: 'oui.wav' },
];

function cueAssetPath(file: string): string {
  return fileURLToPath(new URL(`../../assets/voice/conversation/${file}`, import.meta.url));
}

/** Low-information finals are never safe prompts for a generative reply. */
export function shouldRepairTranscript(text: string, confidence?: number): boolean {
  const wordCount = text.trim().match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  if (wordCount === 0 || wordCount <= REPAIR_SHORT_TRANSCRIPT_WORDS) return true;
  return confidence !== undefined
    && Number.isFinite(confidence)
    && confidence < REPAIR_CONFIDENCE_THRESHOLD;
}

/**
 * Arm a cancellable cue for a turn accepted as explicitly addressed.
 * Every successful backchannel suppresses the next eligible turn, preventing
 * a mechanical acknowledgement on adjacent turns.
 */
export function createConversationCueController(
  options: ConversationCueControllerOptions = {},
): ConversationCueController {
  const env = options.env ?? process.env;
  const player = options.player;
  const now = options.now ?? (() => Date.now());
  const delayMs = options.delayMs ?? BACKCHANNEL_START_DELAY_MS;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const repairedTurns = new Set<string>();
  let disposed = false;
  let previousEligibleTurnPlayed = false;
  let nextCueIndex = 0;

  const armBackchannel = (turnId: string): ConversationCueHandle | null => {
    if (disposed || env.CODEBUDDY_SENSORY_BACKCHANNEL !== 'true' || !player) return null;
    if (previousEligibleTurnPlayed) {
      previousEligibleTurnPlayed = false;
      return null;
    }

    const controller = new AbortController();
    const armedAt = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = (): void => {
      controller.abort();
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(timer);
        timer = undefined;
      }
    };
    timer = setTimeout(() => {
      const activeTimer = timer;
      timer = undefined;
      if (activeTimer !== undefined) timers.delete(activeTimer);
      if (disposed || controller.signal.aborted) return;
      const selected = BACKCHANNELS[nextCueIndex % BACKCHANNELS.length]!;
      void Promise.resolve(player({
        kind: 'backchannel',
        cue: selected.cue,
        turnId,
        text: selected.text,
        assetPath: cueAssetPath(selected.file),
        gainDb: BACKCHANNEL_GAIN_DB,
        signal: controller.signal,
      }))
        .then((played) => {
          if (played === false || controller.signal.aborted) return;
          previousEligibleTurnPlayed = true;
          nextCueIndex = (nextCueIndex + 1) % BACKCHANNELS.length;
          logger.debug(`[speech] local backchannel started after ${Math.max(0, now() - armedAt)}ms`);
        })
        .catch((error) => {
          logger.debug('[speech] local backchannel unavailable', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, Math.max(0, delayMs));
    timers.add(timer);
    return { cancel };
  };

  const playRepair = async (turnId: string): Promise<boolean> => {
    if (disposed || env.CODEBUDDY_SENSORY_REPAIR !== 'true' || !player) return false;
    if (repairedTurns.has(turnId)) return false;
    repairedTurns.add(turnId);
    // Keep the once-per-turn guard bounded for long-running resident sessions.
    if (repairedTurns.size > 256) {
      const oldest = repairedTurns.values().next().value as string | undefined;
      if (oldest !== undefined) repairedTurns.delete(oldest);
    }
    const controller = new AbortController();
    try {
      const played = await player({
        kind: 'repair',
        cue: 'repair',
        turnId,
        text: REPAIR_PROMPT,
        assetPath: cueAssetPath('repair.wav'),
        gainDb: 0,
        signal: controller.signal,
      });
      return played !== false;
    } catch (error) {
      logger.debug('[speech] local repair cue unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  return {
    armBackchannel,
    playRepair,
    dispose: () => {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      repairedTurns.clear();
    },
  };
}
