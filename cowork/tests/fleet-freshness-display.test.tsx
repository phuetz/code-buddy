// @vitest-environment happy-dom
/**
 * Fleet freshness as users see it: "last seen" keeps ageing without new
 * events, an authenticated peer is called silent after three missed
 * heartbeats (never "disconnected", never reconnected), a new receipt makes it
 * fresh again, and one shared timer serves every visible label — none when the
 * panels are hidden or unmounted.
 */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
        : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../src/renderer/components/FleetPeerSessionPanel', () => ({
  FleetPeerSessionPanel: () => null,
}));

import { FleetPanel } from '../src/renderer/components/FleetPanel';
import { PeerDetail, PeerRow } from '../src/renderer/components/fleet-peer-panel';
import { sharedClock } from '../src/renderer/hooks/use-shared-now';
import { useAppStore } from '../src/renderer/store';
import type { FleetPeer } from '../src/renderer/types';

const T0 = Date.UTC(2026, 8, 14, 8, 0, 0);

function peer(id: string, overrides: Partial<FleetPeer> = {}): FleetPeer {
  return {
    id,
    url: `ws://203.0.113.10:3000/ws#${id}`,
    label: id,
    addedAt: 1,
    status: 'authenticated',
    lastSeenAt: T0,
    ...overrides,
  };
}

function seen(peerId: string): HTMLElement {
  return screen.getByTestId(`fleet-peer-seen-${peerId}`);
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function installFleetApi() {
  const api = {
    // The panel re-reads the bridge snapshot on open; mirror the store.
    list: vi.fn(async () => Object.values(useAppStore.getState().fleetPeers)),
    addPeer: vi.fn(),
    removePeer: vi.fn().mockResolvedValue({ success: true }),
    reconnect: vi.fn().mockResolvedValue({ success: true }),
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: api };
  return api;
}

async function renderFleetPanel(peers: FleetPeer[]) {
  useAppStore.setState({
    showFleetPanel: true,
    fleetPeers: Object.fromEntries(peers.map((p) => [p.id, p])),
    fleetEvents: [],
    fleetDiscoveredPeers: [],
  });
  const api = installFleetApi();
  const view = render(<FleetPanel />);
  await act(async () => {
    await Promise.resolve();
  });
  return { api, view };
}

describe('Fleet freshness display', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useAppStore.setState({ showFleetPanel: false, fleetPeers: {} });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  describe('FleetPanel', () => {
    it('keeps "last seen" ageing while no new event arrives', async () => {
      await renderFleetPanel([peer('hub')]);
      expect(seen('hub').textContent).toBe('just now');

      await advance(25_000);
      expect(seen('hub').textContent).toBe('25s ago');

      await advance(50_000);
      expect(seen('hub').textContent).toBe('1m ago');
      expect(seen('hub').dataset.freshness).toBe('seen');
    });

    it('calls an authenticated peer silent after three missed heartbeats, without reconnecting it', async () => {
      const { api } = await renderFleetPanel([peer('hub')]);

      await advance(90_000);
      expect(seen('hub').dataset.freshness).toBe('seen');

      await advance(5_000);
      expect(seen('hub').dataset.freshness).toBe('silent');
      expect(seen('hub').textContent).toBe('silent · 1m ago');
      expect(seen('hub').getAttribute('title')).toContain('90 s');
      expect(screen.queryByText(/disconnected/i)).toBeNull();
      expect(useAppStore.getState().fleetPeers.hub.status).toBe('authenticated');
      expect(api.reconnect).not.toHaveBeenCalled();
    });

    it('makes a silent peer fresh again as soon as a new event is received', async () => {
      await renderFleetPanel([peer('hub')]);
      await advance(120_000);
      expect(seen('hub').dataset.freshness).toBe('silent');

      act(() => {
        useAppStore.getState().upsertFleetPeer(peer('hub', { lastSeenAt: Date.now() }));
      });

      expect(seen('hub').dataset.freshness).toBe('seen');
      expect(seen('hub').textContent).toBe('just now');
    });

    it('says a peer has sent no event yet, and never calls it silent', async () => {
      await renderFleetPanel([peer('hub', { lastSeenAt: undefined })]);

      await advance(600_000);

      expect(seen('hub').dataset.freshness).toBe('never');
      expect(seen('hub').textContent).toBe('no events yet');
    });

    it('does not trust a future or invalid last-seen time', async () => {
      await renderFleetPanel([
        peer('ahead', { lastSeenAt: T0 + 3_600_000 }),
        peer('broken', { lastSeenAt: Number.NaN }),
        peer('skewed', { lastSeenAt: T0 + 3_000 }),
      ]);

      await advance(300_000);

      expect(seen('ahead').dataset.freshness).toBe('invalid');
      expect(seen('ahead').textContent).toBe('unknown');
      expect(seen('broken').dataset.freshness).toBe('invalid');
      expect(seen('skewed').dataset.freshness).toBe('silent');
    });

    it('keeps the age of a disconnected peer without calling it silent', async () => {
      await renderFleetPanel([peer('spoke', { status: 'disconnected', lastSeenAt: T0 - 600_000 })]);

      expect(seen('spoke').dataset.freshness).toBe('seen');
      expect(seen('spoke').textContent).toBe('10m ago');
    });

    it('runs one timer for every visible peer and none once the panel is hidden or unmounted', async () => {
      const { view } = await renderFleetPanel([peer('a'), peer('b'), peer('c')]);
      expect(sharedClock.subscriberCount()).toBe(3);
      expect(vi.getTimerCount()).toBe(1);

      act(() => {
        useAppStore.setState({ showFleetPanel: false });
      });
      expect(sharedClock.subscriberCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);

      act(() => {
        useAppStore.setState({ showFleetPanel: true });
      });
      expect(vi.getTimerCount()).toBe(1);

      view.unmount();
      expect(sharedClock.subscriberCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('Fleet Command Center peer list and detail', () => {
    it('ages the row label and flags silence from the shared clock', async () => {
      const hub = peer('hub');
      render(
        <ul>
          <PeerRow peer={hub} selected={false} onSelect={() => {}} />
        </ul>
      );
      expect(seen('hub').textContent).toBe('just now');

      await advance(95_000);

      expect(seen('hub').dataset.freshness).toBe('silent');
      expect(seen('hub').textContent).toBe('silent · 1m ago');
    });

    it('explains the silence in the detail pane while the status stays authenticated', async () => {
      render(<PeerDetail peer={peer('hub')} onRefreshCapabilities={() => {}} refreshing={false} />);
      expect(screen.queryByTestId('fleet-peer-silence-hub')).toBeNull();

      await advance(95_000);

      expect(screen.getByTestId('fleet-peer-silence-hub').textContent).toContain('90 s');
      expect(screen.getByText('authenticated')).toBeTruthy();
      expect(seen('hub').textContent).toBe('silent · 1m ago');
    });

    it('releases the shared timer when the command center rows unmount', async () => {
      const view = render(
        <ul>
          <PeerRow peer={peer('hub')} selected={false} onSelect={() => {}} />
        </ul>
      );
      expect(vi.getTimerCount()).toBe(1);

      view.unmount();

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
