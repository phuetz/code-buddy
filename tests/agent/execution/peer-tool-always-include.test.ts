/**
 * peer_tool_invoke is not in the global alwaysInclude default.
 * It is force-included only when peers are registered, or for a fleet
 * inspection query (same surface as list_peers / peer_delegate).
 * When force-included, fleet tools are prepended onto the default
 * guaranteed list — they must not replace create_file / apply_patch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_TOOL_SELECTION_CONFIG,
  ToolSelectionStrategy,
  mergeAlwaysInclude,
} from '../../../src/agent/execution/tool-selection-strategy.js';
import {
  FLEET_SURFACE_TOOLS,
  connectedFleetSurfaceTools,
  runtimeInspectionTools,
} from '../../../src/services/runtime-settings-context.js';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
} from '../../../src/fleet/fleet-registry.js';

function registerPeer(id = 'B'): void {
  getFleetRegistry().register({
    id,
    url: `ws://example/${id}`,
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
  } as ActiveListenerEntry);
}

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
    registerPeer();
    expect(connectedFleetSurfaceTools()).toEqual([...FLEET_SURFACE_TOOLS]);
    expect(connectedFleetSurfaceTools()).toContain('peer_tool_invoke');
  });

  it('leaves the default guaranteed list unchanged when no peer is registered', () => {
    expect(connectedFleetSurfaceTools()).toEqual([]);
    expect(mergeAlwaysInclude(undefined, connectedFleetSurfaceTools())).toBeUndefined();
    expect(DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude).toContain('create_file');
    expect(DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude).toContain('apply_patch');
    expect(DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude).not.toContain('peer_tool_invoke');
    expect(DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude).not.toContain('list_peers');
  });

  it('adds fleet tools to the default guaranteed list when a peer is registered', async () => {
    registerPeer();
    const alwaysInclude = mergeAlwaysInclude(undefined, connectedFleetSurfaceTools());
    expect(alwaysInclude?.slice(0, FLEET_SURFACE_TOOLS.length)).toEqual([...FLEET_SURFACE_TOOLS]);
    expect(alwaysInclude).toContain('create_file');
    expect(alwaysInclude).toContain('apply_patch');
    expect(alwaysInclude).toContain('peer_tool_invoke');
    expect(alwaysInclude).toContain('list_peers');
    for (const name of DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude) {
      expect(alwaysInclude).toContain(name);
    }

    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('read package.json and fix the tests', {
      alwaysInclude,
    });
    const names = result.tools.map((tool) => tool.function.name);
    expect(names).toContain('create_file');
    expect(names).toContain('apply_patch');
    expect(names).toContain('peer_tool_invoke');
    expect(names).toContain('list_peers');
  });

  it('does not drop a compact alwaysInclude override when prepending fleet tools', () => {
    const compact = ['view_file', 'bash', 'search'];
    const merged = mergeAlwaysInclude(compact, [...FLEET_SURFACE_TOOLS]);
    expect(merged?.slice(0, FLEET_SURFACE_TOOLS.length)).toEqual([...FLEET_SURFACE_TOOLS]);
    expect(merged).toEqual([...FLEET_SURFACE_TOOLS, ...compact]);
  });
});
