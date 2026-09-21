/**
 * Always-on companion loops that do not need the sensory daemon.
 * Armed automatically when HeartbeatEngine.start() runs.
 */

import { logger } from '../utils/logger.js';
import { wireImpulseDelivery } from './impulse-delivery.js';

let teardown: (() => void) | null = null;

function flagOn(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = (env[name] ?? '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'on';
}

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

  if (flagOn(env, 'CODEBUDDY_COMPANION_PRESENCE')) {
    void import('./presence-loop.js')
      .then(({ wirePresenceLoop }) => {
        stops.push(wirePresenceLoop());
      })
      .catch((err) => {
        logger.warn('[companion-loops] presence not armed', { error: String(err) });
      });
  }

  if (flagOn(env, 'CODEBUDDY_COMPANION_PROACTIVE')) {
    void import('./proactive-engine.js')
      .then(({ wireProactiveLoop }) => {
        stops.push(wireProactiveLoop());
      })
      .catch((err) => {
        logger.warn('[companion-loops] proactive not armed', { error: String(err) });
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
