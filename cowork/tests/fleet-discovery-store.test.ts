import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/renderer/store';

describe('Fleet discovery store', () => {
  beforeEach(() => {
    useAppStore.setState({ fleetDiscoveredPeers: [] });
  });

  it('merges discovered peers by URL without duplicating Mission Control refreshes', () => {
    const first = {
      label: 'claude-ministar',
      source: 'tailscale' as const,
      url: 'ws://100.64.0.10:3001/ws',
    };

    useAppStore.getState().setFleetDiscoveredPeers([first]);
    useAppStore.getState().setFleetDiscoveredPeers([
      first,
      {
        label: 'manual-lab',
        source: 'manual',
        url: 'ws://manual-lab:3001/ws',
      },
    ]);

    expect(useAppStore.getState().fleetDiscoveredPeers).toEqual([
      first,
      {
        label: 'manual-lab',
        source: 'manual',
        url: 'ws://manual-lab:3001/ws',
      },
    ]);
  });
});
