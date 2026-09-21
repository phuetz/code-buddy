/**
 * Always-on companion loops that do not need the sensory daemon.
 */

import { logger } from '../utils/logger.js';
import { wireImpulseDelivery } from './impulse-delivery.js';

let teardown: (() => void) | null = null;

export function isCompanionAlwaysOnLoopsRunning(): boolean {
  return teardown !== null;
}

export function startCompanionAlwaysOnLoops(env: NodeJS.ProcessEnv = process.env): () => void {
  if (teardown) return teardown;
  const stops: Array<() => void> = [];
  try {
    stops.push(wireImpulseDelivery({ env }));
  } catch (err) {
    logger.warn('[companion-loops] impulse delivery not armed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  teardown = () => {
    for (const stop of stops) stop();
    teardown = null;
  };
  return teardown;
}

export function stopCompanionAlwaysOnLoops(): void {
  teardown?.();
}
