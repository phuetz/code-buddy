/**
 * Sensory reactions — subscribers that turn `sensory:perception` events from the
 * nervous-system daemon into Code Buddy behaviour. Phase 1 logs + exposes a hook;
 * Phase 2 will route (speech_end → STT → turn; motion → camera_analyze).
 *
 * @module sensory/reactions
 */

import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';

export interface Perception {
  modality?: string;
  kind?: string;
  salience?: number;
  tsMs?: number;
  payload?: unknown;
}

export function perceptionOf(evt: BaseEvent): Perception {
  return (evt.metadata as Perception | undefined) ?? {};
}

/**
 * Wire reactions to the sensory bus. Returns an unsubscribe fn. `onPerception`
 * is an injectable hook (tests + future routing).
 */
export function wireSensoryReactions(onPerception?: (p: Perception, evt: BaseEvent) => void): () => void {
  const bus = getGlobalEventBus();
  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    logger.info(`[sensory] ${p.modality}/${p.kind} (salience ${p.salience ?? 0})`);
    onPerception?.(p, evt);
  });
  return () => {
    bus.off(id);
  };
}
