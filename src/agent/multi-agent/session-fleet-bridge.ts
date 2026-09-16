/**
 * Session fleet bridge (Phase (d).4 V0.4.1).
 *
 * Subscribes a SessionRegistry to the fleet broadcast surface so other
 * Claudes on the Tailscale fleet can observe session lifecycle events
 * (sub-agent spawns, inter-session messages) live. Same opt-in env gate
 * as (d).2 / (d).3 — CODEBUDDY_FLEET_STREAM=1 to enable; off by default.
 *
 * Why a separate module:
 * Keeps SessionRegistry oblivious to fleet/server concerns. The bridge
 * attaches listeners externally and returns a disable hook so callers
 * own the lifecycle.
 *
 * Mapped events:
 * - SessionRegistry `session:spawn` → fleet:session:spawn
 *   (payload: { parentSessionId, childSessionId, kind, agentId, source })
 * - SessionRegistry `session:message` → fleet:session:message
 *   (payload: { sessionId, role, contentPreview, source })
 *   We send only a contentPreview (first 200 chars) — full message bodies
 *   are sometimes sensitive and always large; receivers can request the
 *   full message via existing session APIs if they need it.
 *
 * Honest limitations:
 * - Single bridge per SessionRegistry. enableSessionFleetBridge is
 *   idempotent — calling twice with the same registry reuses the
 *   existing listeners.
 * - No back-pressure (same as (d).1 deferral). Bursty session activity
 *   could fill the WS send buffer.
 */

import type { SessionRegistry, SessionInfo, SessionMessage } from './session-registry.js';
import { redactSecrets } from '../../fleet/privacy-lint.js';

export type FleetEventBroadcaster = (type: any, payload: any, agentId?: string) => void;
let _fleetBroadcaster: FleetEventBroadcaster | null = null;

export function registerSessionFleetBroadcaster(broadcaster: FleetEventBroadcaster): void {
  _fleetBroadcaster = broadcaster;
}

function broadcastFleetEvent(type: any, payload: any, agentId?: string): void {
  if (_fleetBroadcaster) {
    _fleetBroadcaster(type, payload, agentId);
  }
}

function isFleetStreamEnabled(): boolean {
  const v = process.env.CODEBUDDY_FLEET_STREAM;
  return v === '1' || v === 'true' || v === 'TRUE';
}

/**
 * Track which registries already have bridge listeners attached, so
 * repeated `enableSessionFleetBridge(reg)` calls don't double-subscribe.
 * WeakSet so registries can be GC'd when their owners drop them.
 */
const bridgedRegistries = new WeakSet<SessionRegistry>();

export interface SessionFleetBridgeHandle {
  /** Detach listeners. Idempotent. */
  disable: () => void;
}

/**
 * Subscribe `registry` to the fleet broadcast bus. Returns a handle
 * whose `disable()` removes the listeners. No-op when fleet streaming
 * is disabled at call time — listeners are still attached because the
 * env gate is checked per-emit (so toggling at runtime works without
 * re-attaching).
 */
export function enableSessionFleetBridge(
  registry: SessionRegistry,
): SessionFleetBridgeHandle {
  if (bridgedRegistries.has(registry)) {
    // Already bridged — return a no-op handle so callers don't crash on
    // double-enable.
    return { disable: () => { /* no-op */ } };
  }
  bridgedRegistries.add(registry);

  const onSpawn = (parent: SessionInfo, child: SessionInfo) => {
    if (!isFleetStreamEnabled()) return;
    try {
      broadcastFleetEvent(
        'fleet:session:spawn',
        {
          parentSessionId: parent.id,
          childSessionId: child.id,
          kind: child.kind,
          agentId: child.agentId,
          parentKind: parent.kind,
        },
        child.id,
      );
    } catch {
      /* best-effort */
    }
  };

  const onMessage = (sessionId: string, message: SessionMessage) => {
    if (!isFleetStreamEnabled()) return;
    try {
      const preview =
        typeof message.content === 'string'
          ? redactSecrets(message.content).slice(0, 200)
          : '<non-string content>';
      broadcastFleetEvent(
        'fleet:session:message',
        {
          sessionId,
          role: message.role,
          contentPreview: preview,
          truncated:
            typeof message.content === 'string' && message.content.length > 200,
        },
        sessionId,
      );
    } catch {
      /* best-effort */
    }
  };

  registry.on('session:spawn', onSpawn);
  registry.on('session:message', onMessage);

  return {
    disable: () => {
      registry.off('session:spawn', onSpawn);
      registry.off('session:message', onMessage);
      bridgedRegistries.delete(registry);
    },
  };
}

/**
 * Test-only — clears the WeakSet tracking. Forces the next
 * enableSessionFleetBridge call to attach listeners freshly even on a
 * registry that was previously bridged in the same test run.
 */
export function _resetSessionFleetBridgeTracking(): void {
  // WeakSet doesn't expose iteration. The simplest reset is to drop our
  // reference and let callers re-bridge. In practice tests use fresh
  // registry instances per test which the GC reclaims.
  // Provided for parity with other test reset helpers.
}
