/**
 * peer_tool_invoke is not in the global alwaysInclude default.
 * It is force-included only when peers are registered, or for a fleet
 * inspection query (same surface as list_peers / peer_delegate).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_TOOL_SELECTION_CONFIG } from '../../src/agent/execution/tool-selection-strategy.js';
import {
  FLEET_SURFACE_TOOLS,
  connectedFleetSurfaceTools,
  runtimeInspectionTools,
} from '../../src/services/runtime-settings-context.js';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
} from '../../src/fleet/fleet-registry.js';

describe('peer_tool_invoke alwaysInclude gating', () => {
  beforeEach(() => {
    _resetFleetRegistryForTests();
  });

  afterEach(() => {
    _resetFleetRegistryForTests();
  });

  it('does not force-include fleet tools for every user by default', () => {
    expect(DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude).not.toContain('peer_tool_invoke');
    expect(DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude).not.toContain('list_peers');
    expect(DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude).not.toContain('peer_delegate');
    expect(connectedFleetSurfaceTools()).toEqual([]);
    expect(runtimeInspectionTools('read package.json and fix the tests')).not.toContain(
      'peer_tool_invoke',
    );
  });

  it('includes peer_tool_invoke for a fleet inspection query (existing opt-in)', () => {
    const tools = runtimeInspectionTools(
      "Y a-t-il d'autres Code Buddy actifs avec lesquels tu peux travailler ?",
    );
    expect(tools).toEqual([...FLEET_SURFACE_TOOLS]);
    expect(tools).toContain('peer_tool_invoke');
    expect(tools).toContain('list_peers');
    expect(tools).toContain('peer_delegate');
  });

  it('includes peer_tool_invoke when a peer is registered', () => {
    const entry = {
      id: 'B',
      url: 'ws://example/B',
      startedAt: new Date(),
      eventCount: 0,
      autoReconnect: false,
      maxAttempts: 5,
      listener: {
        disconnect: async () => undefined,
        getReconnectAttempts: () => 0,
        isReconnecting: () => false,
        request: async () => ({}),
        getLastSeen: () => ({ at: null, reason: null, ageMs: null }),
        isStale: () => false,
        getPeerCompactionState: () => ({
          active: false,
          startedAt: null,
          ageMs: null,
          lastResult: null,
        }),
        getEventHistory: () => [],
      },
    } as ActiveListenerEntry;
    getFleetRegistry().register(entry);
    expect(connectedFleetSurfaceTools()).toEqual([...FLEET_SURFACE_TOOLS]);
    expect(connectedFleetSurfaceTools()).toContain('peer_tool_invoke');
  });
});
