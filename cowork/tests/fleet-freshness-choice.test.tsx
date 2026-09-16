// @vitest-environment happy-dom
/**
 * Fleet freshness where a peer gets chosen: the Command Center online count
 * says how many of those peers are silent, the route preview flags a silent
 * recommended peer with a neutral note, and Mission Control badges quiet peers.
 * Silence is presentation only: statuses, online/busy/offline, routable peers
 * and the planned route never change, and nothing extra reaches the network.
 */
import React from 'react';
import { readFileSync } from 'fs';
import path from 'path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const i18nMock = vi.hoisted(() => {
  const t = (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
    typeof fallback === 'string'
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
      : key;
  return { t, i18n: { language: 'en', changeLanguage: () => Promise.resolve() } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => i18nMock,
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../src/renderer/components/FleetPeerSessionPanel', () => ({
  FleetPeerSessionPanel: () => null,
}));

import { FleetCommandCenter } from '../src/renderer/components/FleetCommandCenter';
import { FleetRoutePreview } from '../src/renderer/components/FleetRoutePreview';
import { MissionControlView } from '../src/renderer/components/os/MissionControlView';
import { useAppStore } from '../src/renderer/store';
import type { FleetPeer } from '../src/renderer/types';

const T0 = Date.UTC(2026, 8, 14, 8, 0, 0);

const capability: NonNullable<FleetPeer['capability']> = {
  egress: 'local',
  machineLabel: 'bench',
  models: [{ id: 'qwen3:4b', contextWindow: 32_000, strengths: ['code'], provider: 'ollama' }],
};

function peer(id: string, overrides: Partial<FleetPeer> = {}): FleetPeer {
  return {
    id,
    url: `ws://203.0.113.10:3000/ws#${id}`,
    label: id,
    addedAt: 1,
    status: 'authenticated',
    lastSeenAt: T0,
    capability,
    ...overrides,
  };
}

function byId(peers: FleetPeer[]): Record<string, FleetPeer> {
  return Object.fromEntries(peers.map((p) => [p.id, p]));
}

/** One peer per freshness case the choice screens must handle. */
function mixedFleet(): FleetPeer[] {
  return [
    peer('hub'), // recent
    peer('spoke', { lastSeenAt: T0 - 120_000 }), // silent
    peer('fresh', { lastSeenAt: undefined }), // no event yet
    peer('broken', { lastSeenAt: Number.NaN }), // invalid receipt time
    peer('relay', { status: 'connected', lastSeenAt: T0 - 600_000 }), // online, not authenticated
    peer('down', { status: 'disconnected', lastSeenAt: T0 - 600_000 }),
  ];
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

const previewProps = {
  goal: 'refactor the parser',
  dispatchProfile: 'code' as const,
  privacyTag: 'public' as const,
  parallelism: 1,
  council: false,
  targetPeerIds: ['hub', 'spoke'],
};

describe('Fleet freshness where a peer is chosen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useAppStore.setState({ fleetPeers: {} });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  describe('Fleet Command Center online count', () => {
    it('counts silent peers inside the online count, follows them over time, and keeps them routable', async () => {
      const routePreview = vi.fn().mockResolvedValue({
        ok: true,
        primary: { peerId: 'spoke', model: 'qwen3:4b' },
      });
      (window as unknown as { electronAPI?: unknown }).electronAPI = {
        fleet: {
          list: vi.fn(async () => Object.values(useAppStore.getState().fleetPeers)),
          routePreview,
        },
      };
      useAppStore.setState({ fleetPeers: byId(mixedFleet()) });

      render(<FleetCommandCenter isOpen onClose={() => {}} />);
      await settle();

      const count = screen.getByTestId('fleet-online-count');
      expect(count.textContent).toBe('5 online · incl. 1 silent');

      await advance(95_000);
      expect(count.textContent).toBe('5 online · incl. 2 silent');

      act(() => {
        useAppStore.getState().upsertFleetPeer(peer('spoke', { lastSeenAt: Date.now() }));
        useAppStore.getState().upsertFleetPeer(peer('hub', { lastSeenAt: Date.now() }));
      });
      expect(count.textContent).toBe('5 online');

      await advance(95_000);
      expect(count.textContent).toBe('5 online · incl. 2 silent');
      expect(useAppStore.getState().fleetPeers.spoke.status).toBe('authenticated');

      fireEvent.change(screen.getByTestId('fleet-command-goal-input'), {
        target: { value: 'refactor the parser' },
      });
      await act(async () => {
        screen.getByTestId('fleet-route-preview-button').click();
      });
      expect(routePreview).toHaveBeenCalledTimes(1);
      expect(routePreview.mock.calls[0][0].targetPeerIds).toEqual(
        expect.arrayContaining(['hub', 'spoke', 'fresh', 'broken', 'relay', 'down'])
      );
    });
  });

  describe('FleetRoutePreview', () => {
    function lane(index: number) {
      return screen.getAllByTestId('fleet-route-preview-lane')[index];
    }

    async function showPreview(peersById: Record<string, FleetPeer>) {
      const routePreview = vi.fn().mockResolvedValue({
        ok: true,
        parallel: ['spoke', 'hub', 'fresh', 'broken', 'gpuNode/repo'].map((peerId) => ({
          peerId,
          model: 'qwen3:4b',
        })),
      });
      (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: { routePreview } };
      const view = render(<FleetRoutePreview {...previewProps} peersById={peersById} />);
      await act(async () => {
        screen.getByTestId('fleet-route-preview-button').click();
      });
      return { routePreview, view };
    }

    it('flags only the silent recommended peers, with a neutral note, and leaves the route as planned', async () => {
      await showPreview(byId(mixedFleet()));

      expect(
        screen.getAllByTestId('fleet-route-preview-lane').map((item) => item.textContent)
      ).toEqual([
        expect.stringContaining('spoke'),
        expect.stringContaining('hub'),
        expect.stringContaining('fresh'),
        expect.stringContaining('broken'),
        expect.stringContaining('gpuNode/repo'),
      ]);
      expect(within(lane(0)).getByTestId('fleet-route-preview-silent').textContent).toBe('silent');
      for (const index of [1, 2, 3, 4]) {
        expect(within(lane(index)).queryByTestId('fleet-route-preview-silent')).toBeNull();
      }
      const note = screen.getByTestId('fleet-route-preview-silence');
      expect(note.textContent).toContain('spoke');
      expect(note.textContent).toContain('90 s');
      expect(note.textContent).toContain('route is unchanged');
      expect(note.textContent).not.toContain('hub');
    });

    it('updates the warning as peers fall silent or speak again, without asking the router twice', async () => {
      const peers = mixedFleet();
      const { routePreview, view } = await showPreview(byId(peers));
      expect(vi.getTimerCount()).toBe(1);

      await advance(95_000);
      expect(within(lane(1)).getByTestId('fleet-route-preview-silent')).toBeTruthy();
      expect(screen.getByTestId('fleet-route-preview-silence').textContent).toContain('hub');

      view.rerender(
        <FleetRoutePreview
          {...previewProps}
          peersById={byId([
            peer('hub', { lastSeenAt: Date.now() }),
            peer('spoke', { lastSeenAt: Date.now() }),
            ...peers.slice(2),
          ])}
        />
      );
      expect(screen.queryAllByTestId('fleet-route-preview-silent')).toHaveLength(0);
      expect(screen.queryByTestId('fleet-route-preview-silence')).toBeNull();
      expect(routePreview).toHaveBeenCalledTimes(1);

      act(() => {
        screen.getByTestId('fleet-route-preview-close').click();
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps a persisted peer id intact when it contains a line break', async () => {
      const peerId = 'legacy\npeer';
      const routePreview = vi.fn().mockResolvedValue({
        ok: true,
        primary: { peerId, model: 'qwen3:4b' },
      });
      (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: { routePreview } };
      render(
        <FleetRoutePreview
          {...previewProps}
          peersById={byId([peer(peerId, { lastSeenAt: T0 - 120_000 })])}
        />
      );
      await act(async () => {
        screen.getByTestId('fleet-route-preview-button').click();
      });
      expect(within(lane(0)).getByTestId('fleet-route-preview-silent')).toBeTruthy();
      expect(screen.getByTestId('fleet-route-preview-silence').textContent).toContain(peerId);
      expect(routePreview).toHaveBeenCalledTimes(1);
    });

    it('stays silent about freshness when the peers are unknown to the store', async () => {
      await showPreview({});

      expect(screen.getAllByTestId('fleet-route-preview-lane')).toHaveLength(5);
      expect(screen.queryAllByTestId('fleet-route-preview-silent')).toHaveLength(0);
      expect(screen.queryByTestId('fleet-route-preview-silence')).toBeNull();
    });
  });

  describe('translations', () => {
    it.each(['en', 'fr', 'zh'])(
      'carry the choice-screen freshness keys in the %s locale',
      (locale) => {
        // happy-dom rewrites import.meta.url; resolve from the Cowork root like i18n-french-support.
        const localePath = path.resolve(process.cwd(), `src/renderer/i18n/locales/${locale}.json`);
        const messages = JSON.parse(readFileSync(localePath, 'utf-8')) as {
          fleet?: { freshness?: Record<string, unknown> };
        };
        for (const key of ['silentCount', 'silentCountHint', 'routeSilent']) {
          expect(messages.fleet?.freshness?.[key], `${locale}: fleet.freshness.${key}`).toEqual(
            expect.stringContaining('{{')
          );
        }
      }
    );
  });

  describe('Mission Control', () => {
    it('badges quiet peers in the topology and the matrix without touching online/busy/offline', async () => {
      useAppStore.setState({ fleetPeers: byId(mixedFleet()) });

      render(<MissionControlView />);
      await settle();

      const quietBadges = screen.getAllByTestId('os-peer-quiet');
      expect(quietBadges.map((badge) => badge.dataset.peerId)).toEqual(['spoke', 'spoke']);
      expect(quietBadges[0].getAttribute('title')).toContain('90 s');

      const topologyCard = screen.getByTestId('os-topology-peer-spoke');
      expect(within(topologyCard).getByText('online')).toBeTruthy();
      expect(screen.getByTestId('os-topology-peer-down').textContent).toContain('offline');
      expect(screen.getByText('En ligne').parentElement?.textContent).toContain('5');

      await advance(95_000);
      expect(
        screen
          .getAllByTestId('os-peer-quiet')
          .map((badge) => badge.dataset.peerId)
          .sort()
      ).toEqual(['hub', 'hub', 'spoke', 'spoke']);

      act(() => {
        useAppStore.getState().upsertFleetPeer(peer('spoke', { lastSeenAt: Date.now() }));
      });
      expect(screen.getAllByTestId('os-peer-quiet').map((badge) => badge.dataset.peerId)).toEqual([
        'hub',
        'hub',
      ]);
    });
  });
});
