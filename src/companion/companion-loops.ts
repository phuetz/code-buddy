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

  const arm = (label: string, fn: () => () => void): void => {
    try {
      stops.push(fn());
    } catch (err) {
      logger.warn(`[companion-loops] ${label} not armed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  arm('impulse-delivery', () => wireImpulseDelivery({ env }));

  if (flagOn(env, 'CODEBUDDY_COMPANION_PRESENCE')) {
    arm('presence', () => {
      const { wirePresenceLoop } = require('./presence-loop.js') as {
        wirePresenceLoop: () => () => void;
      };
      return wirePresenceLoop();
    });
  }

  if (flagOn(env, 'CODEBUDDY_COMPANION_PROACTIVE')) {
    arm('proactive', () => {
      const { wireProactiveLoop } = require('./proactive-engine.js') as {
        wireProactiveLoop: () => () => void;
      };
      return wireProactiveLoop();
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
