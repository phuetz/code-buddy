/**
 * FleetBridge quit lifecycle.
 *
 * Main creates one FleetBridge at boot; this closes that instance when Cowork
 * quits. It never creates a bridge (no `getFleetBridge()` singleton), shuts a
 * given bridge down at most once whichever quit path asks first, and never
 * blocks or throws into the quit sequence: a hanging or failing shutdown is
 * logged and quit proceeds.
 *
 * `FleetBridge.shutdown()` marks the bridge stopped before its first await, so
 * recovery timers and in-flight connection attempts are disarmed immediately,
 * even when closing the sockets outlasts the budget.
 *
 * Success is deliberately not logged here: the dev quit path closes the log
 * file right after calling this, and a late write would reopen it.
 *
 * @module main/fleet/fleet-bridge-lifecycle
 */

import { logError } from '../utils/logger';
import type { FleetBridge } from './fleet-bridge';

/** Budget for closing peer sockets during quit; the OS reclaims anything left. */
export const FLEET_BRIDGE_QUIT_TIMEOUT_MS = 3_000;

export type FleetBridgeQuitOutcome = 'no-bridge' | 'closed' | 'failed' | 'timed-out';

type ClosableBridge = Pick<FleetBridge, 'shutdown'>;

const closing = new WeakMap<ClosableBridge, Promise<FleetBridgeQuitOutcome>>();

export function shutdownFleetBridgeForQuit(
  bridge: ClosableBridge | null,
  timeoutMs: number = FLEET_BRIDGE_QUIT_TIMEOUT_MS
): Promise<FleetBridgeQuitOutcome> {
  if (!bridge) return Promise.resolve('no-bridge');
  let outcome = closing.get(bridge);
  if (!outcome) {
    outcome = closeWithin(bridge, timeoutMs);
    closing.set(bridge, outcome);
  }
  return outcome;
}

async function closeWithin(
  bridge: ClosableBridge,
  timeoutMs: number
): Promise<FleetBridgeQuitOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), timeoutMs);
    timer.unref?.();
  });
  try {
    const closed = bridge.shutdown().then(() => 'closed' as const);
    const outcome = await Promise.race([closed, timedOut]);
    if (outcome === 'timed-out') {
      logError(`[FleetBridge] shutdown timed out after ${timeoutMs}ms; quitting anyway`);
    }
    return outcome;
  } catch (err) {
    logError('[FleetBridge] shutdown failed; quitting anyway:', err);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}
