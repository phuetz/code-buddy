// @vitest-environment happy-dom
/**
 * FleetPanel — connection feedback: a manual reconnect shows that it is in
 * progress, cannot be fired twice, and surfaces why it failed; a failed peer
 * listing is explained instead of leaving an empty panel.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetPanel } from '../src/renderer/components/FleetPanel';
import { useAppStore } from '../src/renderer/store';
import type { FleetPeer } from '../src/renderer/types';

const hub: FleetPeer = {
  id: 'hub',
  url: 'ws://203.0.113.10:3000/ws',
  label: 'Hub Linux',
  addedAt: 1,
  status: 'disconnected',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function installFleetApi(overrides: Record<string, unknown> = {}) {
  const api = {
    list: vi.fn().mockResolvedValue([hub]),
    addPeer: vi.fn(),
    removePeer: vi.fn().mockResolvedValue({ success: true }),
    reconnect: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: api };
  return api;
}

describe('FleetPanel connection feedback', () => {
  beforeEach(() => {
    useAppStore.setState({
      showFleetPanel: true,
      fleetPeers: { hub },
      fleetEvents: [],
      fleetDiscoveredPeers: [],
    });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ showFleetPanel: false, fleetPeers: {} });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('disables reconnect while the attempt runs, then shows why it failed', async () => {
    const attempt = deferred<{ success: boolean; error?: string }>();
    const api = installFleetApi({ reconnect: vi.fn(() => attempt.promise) });
    render(<FleetPanel />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());

    const button = screen.getByTestId('fleet-peer-reconnect-hub');
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    fireEvent.click(button);
    expect(api.reconnect).toHaveBeenCalledTimes(1);

    attempt.resolve({ success: false, error: 'connect ECONNREFUSED 203.0.113.10:3000' });

    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(screen.getByTestId('fleet-peer-error-hub').textContent).toContain('ECONNREFUSED');
  });

  it('shows a reconnect IPC failure instead of an unhandled rejection', async () => {
    installFleetApi({
      reconnect: vi.fn().mockRejectedValue(new Error('FleetBridge not initialized')),
    });
    render(<FleetPanel />);

    fireEvent.click(screen.getByTestId('fleet-peer-reconnect-hub'));

    await waitFor(() =>
      expect(screen.getByTestId('fleet-peer-error-hub').textContent).toContain(
        'FleetBridge not initialized'
      )
    );
  });

  it('does not repeat the cause already reported by the peer', async () => {
    const cause = 'Invalid credentials';
    useAppStore.setState({ fleetPeers: { hub: { ...hub, status: 'error', lastError: cause } } });
    installFleetApi({
      list: vi.fn().mockResolvedValue([{ ...hub, status: 'error', lastError: cause }]),
      reconnect: vi.fn().mockResolvedValue({ success: false, error: cause }),
    });
    render(<FleetPanel />);

    fireEvent.click(screen.getByTestId('fleet-peer-reconnect-hub'));

    await waitFor(() =>
      expect(screen.getByTestId('fleet-peer-reconnect-hub').hasAttribute('disabled')).toBe(false)
    );
    expect(screen.getAllByText(cause)).toHaveLength(1);
  });

  it('explains a failed peer listing', async () => {
    installFleetApi({ list: vi.fn().mockRejectedValue(new Error('IPC channel closed')) });
    render(<FleetPanel />);

    await waitFor(() =>
      expect(screen.getByTestId('fleet-list-error').textContent).toContain('IPC channel closed')
    );
  });

  describe('obsolete reconnect errors', () => {
    const refused = 'connect ECONNREFUSED 203.0.113.10:3000';

    /** Renders the panel and lets its initial `fleet.list()` snapshot land in the store. */
    async function renderSettled(api: ReturnType<typeof installFleetApi>) {
      render(<FleetPanel />);
      await waitFor(() => expect(api.list).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
    }

    /** What the bridge pushes through `fleet.peer.update`. */
    function pushPeer(peer: FleetPeer) {
      act(() => {
        useAppStore.getState().upsertFleetPeer(peer);
      });
    }

    async function failReconnect() {
      const button = screen.getByTestId('fleet-peer-reconnect-hub');
      fireEvent.click(button);
      await waitFor(() =>
        expect(screen.getByTestId('fleet-peer-error-hub').textContent).toContain(refused)
      );
      await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    }

    it('clears a manual reconnect error once the bridge recovery authenticates the peer', async () => {
      const api = installFleetApi({
        reconnect: vi.fn().mockResolvedValue({ success: false, error: refused }),
      });
      await renderSettled(api);
      await failReconnect();

      pushPeer({ ...hub, status: 'authenticated' });
      expect(screen.queryByTestId('fleet-peer-error-hub')).toBeNull();

      // A later, unrelated drop must show its own cause, not resurrect the old one.
      pushPeer({ ...hub, status: 'error', lastError: 'socket hang up' });
      expect(screen.getByTestId('fleet-peer-error-hub').textContent).toBe('socket hang up');
    });

    it('drops a reconnect failure that settles after the peer already authenticated', async () => {
      const attempt = deferred<{ success: boolean; error?: string }>();
      const api = installFleetApi({ reconnect: vi.fn(() => attempt.promise) });
      await renderSettled(api);
      const button = screen.getByTestId('fleet-peer-reconnect-hub');
      fireEvent.click(button);
      await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));

      pushPeer({ ...hub, status: 'authenticated' });
      await act(async () => {
        attempt.resolve({ success: false, error: refused });
      });

      await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
      pushPeer({ ...hub, status: 'disconnected' });
      expect(screen.queryByTestId('fleet-peer-error-hub')).toBeNull();
    });

    it('forgets the reconnect error of a removed peer when a peer with the same id is added back', async () => {
      const api = installFleetApi({
        reconnect: vi.fn().mockResolvedValue({ success: false, error: refused }),
      });
      await renderSettled(api);
      await failReconnect();

      fireEvent.click(screen.getByTitle('Remove peer'));
      await waitFor(() => expect(screen.queryByTestId('fleet-peer-reconnect-hub')).toBeNull());
      pushPeer({ ...hub, addedAt: 2 });

      expect(screen.getByTestId('fleet-peer-reconnect-hub')).toBeTruthy();
      expect(screen.queryByTestId('fleet-peer-error-hub')).toBeNull();
    });

    it('does not pin a late failure on a peer re-added while the attempt was running', async () => {
      const attempt = deferred<{ success: boolean; error?: string }>();
      const api = installFleetApi({ reconnect: vi.fn(() => attempt.promise) });
      await renderSettled(api);
      fireEvent.click(screen.getByTestId('fleet-peer-reconnect-hub'));

      // Same id, new registration (e.g. removed from another view and paired again).
      act(() => {
        useAppStore.getState().setFleetPeers([{ ...hub, addedAt: 2 }]);
      });
      await act(async () => {
        attempt.resolve({ success: false, error: refused });
      });

      await waitFor(() =>
        expect(screen.getByTestId('fleet-peer-reconnect-hub').hasAttribute('disabled')).toBe(false)
      );
      expect(screen.queryByTestId('fleet-peer-error-hub')).toBeNull();
    });
  });
});
