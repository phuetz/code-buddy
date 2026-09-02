/**
 * @vitest-environment happy-dom
 *
 * FleetUtilizationStrip — per-actor load bars + fleet-wide utilization
 * rate, honest about unknown capacity (excluded from the aggregate).
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FleetUtilizationStrip,
  buildPeerLoadRows,
  fleetUtilization,
} from '../src/renderer/components/FleetUtilizationStrip';
import type { FleetPeer } from '../src/renderer/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
      (fallback ?? _key).replace('{{count}}', String(options?.count ?? '')),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function peer(id: string, capability?: Record<string, unknown>): FleetPeer {
  return {
    id,
    url: `wss://${id}`,
    addedAt: 0,
    status: 'authenticated',
    capability: capability as FleetPeer['capability'],
  } as FleetPeer;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function render(peers: FleetPeer[]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<FleetUtilizationStrip peers={peers} />);
  });
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

describe('fleetUtilization aggregate', () => {
  it('aggregates only over peers that declared a capacity', () => {
    const rows = buildPeerLoadRows([
      peer('gpuNode', { models: [], machineLabel: 'GPU_NODE', activeRequests: 3, maxConcurrency: 4 }),
      peer('ministar', { models: [], machineLabel: 'Ministar', activeRequests: 1, maxConcurrency: 4 }),
      peer('mystery', { models: [], machineLabel: 'Mystery', activeRequests: 9 }), // no capacity
    ]);

    // (3 + 1) / (4 + 4) — the capacity-less peer is excluded, not assumed.
    expect(fleetUtilization(rows)).toBe(0.5);
  });

  it('returns null when no peer declared a capacity', () => {
    const rows = buildPeerLoadRows([peer('a', { models: [], machineLabel: 'A', activeRequests: 2 })]);
    expect(fleetUtilization(rows)).toBeNull();
  });
});

describe('FleetUtilizationStrip', () => {
  it('renders the fleet rate and one load bar per actor', async () => {
    await render([
      peer('gpuNode', { models: [], machineLabel: 'GPU_NODE', activeRequests: 3, maxConcurrency: 4 }),
      peer('ministar', { models: [], machineLabel: 'Ministar', activeRequests: 0, maxConcurrency: 2 }),
    ]);

    expect(container!.querySelector('[data-testid="fleet-utilization-rate"]')?.textContent).toBe('50%');
    const rows = container!.querySelectorAll('[data-testid="fleet-utilization-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('GPU_NODE');
    expect(rows[0].textContent).toContain('3/4');
    expect(rows[1].textContent).toContain('0/2');
  });

  it('shows the capacity hint instead of a fake rate when nothing is declared', async () => {
    await render([peer('a', { models: [], machineLabel: 'A', activeRequests: 1 })]);

    expect(container!.querySelector('[data-testid="fleet-utilization-rate"]')).toBeNull();
    expect(
      container!.querySelector('[data-testid="fleet-utilization-unknown"]')?.textContent
    ).toContain('CODEBUDDY_FLEET_MAX_CONCURRENCY');
    expect(container!.textContent).toContain('1 active');
  });

  it('renders nothing without capability-bearing peers', async () => {
    await render([peer('a')]);

    expect(container!.querySelector('[data-testid="fleet-utilization-strip"]')).toBeNull();
  });
});
