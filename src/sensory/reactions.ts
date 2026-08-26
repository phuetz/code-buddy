/**
 * Sensory reactions — subscribers that turn `sensory:perception` events from the
 * nervous-system daemon into Code Buddy behaviour. Phase 1 logs + exposes a hook;
 * Phase 2 will route (speech_end → STT → turn; motion → camera_analyze).
 *
 * @module sensory/reactions
 */

import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { getSensoryMemory } from './sensory-memory.js';
import type { BaseEvent } from '../events/types.js';

export interface Perception {
  modality?: string;
  kind?: string;
  salience?: number;
  /** Sense-relative timestamp (frame-relative for audio, unix-millis for vital). */
  tsMs?: number;
  /** Ingest wall-clock (one consistent clock across senses — used for dream windows). */
  receivedAt?: number;
  payload?: unknown;
}

/** Speech can initiate a real agent turn, so it must never be wired on an
 * unauthenticated sensory bridge. Keep this invariant pure and easy to test. */
export function shouldWireSpeechReaction(env: { speech?: string; token?: string }): boolean {
  return env.speech === 'true' && Boolean(env.token);
}

export function perceptionOf(evt: BaseEvent): Perception {
  const meta = (evt.metadata as Perception | undefined) ?? {};
  return { ...meta, receivedAt: evt.timestamp };
}

/**
 * Wire reactions to the sensory bus. Returns an unsubscribe fn. `onPerception`
 * is an injectable hook (tests + future routing).
 */
export function wireSensoryReactions(onPerception?: (p: Perception, evt: BaseEvent) => void): () => void {
  const bus = getGlobalEventBus();
  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    const message = `[sensory] ${p.modality}/${p.kind} (salience ${p.salience ?? 0})`;
    if ((p.salience ?? 0) < 128) logger.debug(message);
    else logger.info(message);
    getSensoryMemory().push(p); // short-term memory → consolidated by dreaming
    onPerception?.(p, evt);
  });
  return () => {
    bus.off(id);
  };
}
