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

function armLater(label: string, loader: () => Promise<() => void>, stops: Array<() => void>): void {
  void loader()
    .then((stop) => {
      stops.push(stop);
    })
    .catch((err) => {
      logger.warn(`[companion-loops] ${label} not armed`, { error: String(err) });
    });
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
    armLater('presence', async () => (await import('./presence-loop.js')).wirePresenceLoop(), stops);
  }
  if (flagOn(env, 'CODEBUDDY_COMPANION_PROACTIVE')) {
    armLater('proactive', async () => (await import('./proactive-engine.js')).wireProactiveLoop(), stops);
  }
  if (flagOn(env, 'CODEBUDDY_COMPANION_IDLE')) {
    armLater('idle', async () => (await import('./idle-loop.js')).wireIdleLoop(), stops);
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
