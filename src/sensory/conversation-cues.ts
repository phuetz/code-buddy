/**
 * Deterministic conversational cues that never call a model or a synthesizer.
 * The controller owns timing/cancellation; the injected player owns local WAV
 * playback. Missing media therefore fails silent instead of entering a TTS path.
 */

import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

export const BACKCHANNEL_START_DELAY_MS = 120;
export const BACKCHANNEL_GAIN_DB = -12;

export type BackchannelCue = 'mhm' | 'oui';

export interface ConversationCueRequest {
  kind: 'backchannel';
  cue: BackchannelCue;
  turnId: string;
  text: string;
  assetPath: string;
  gainDb: number;
  signal: AbortSignal;
}

export type ConversationCuePlayer = (
  request: ConversationCueRequest,
) => boolean | void | Promise<boolean | void>;

export interface ConversationCueHandle {
  cancel(): void;
}

export interface ConversationCueController {
  armBackchannel(turnId: string): ConversationCueHandle | null;
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

  return {
    armBackchannel,
    dispose: () => {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
