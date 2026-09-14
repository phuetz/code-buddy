// @vitest-environment happy-dom
/**
 * FleetRoutePreview must never present a route computed for other parameters
 * as the current one. The Command Center lets the operator edit the goal,
 * profile, privacy, parallelism, council and routable peers while a preview is
 * pending or shown; only what the router actually receives invalidates it, and
 * nothing is re-requested automatically. Freshness updates keep the route.
 */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import {
  FleetRoutePreview,
  type FleetRoutePreviewProps,
} from '../src/renderer/components/FleetRoutePreview';
import type { FleetPeer } from '../src/renderer/types';

type RouteAnswer = Record<string, unknown>;

const baseProps: FleetRoutePreviewProps = {
  goal: 'refactor the parser',
  dispatchProfile: 'code',
  privacyTag: 'public',
  parallelism: 1,
  council: false,
  targetPeerIds: ['hub', 'spoke'],
};

function routeVia(peerId: string): RouteAnswer {
  return { ok: true, rationale: `via ${peerId}`, primary: { peerId, model: 'qwen3:4b' } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function installRouter(routePreview: ReturnType<typeof vi.fn>) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: { routePreview } };
}

function renderPreview(props: Partial<FleetRoutePreviewProps> = {}) {
  const view = render(<FleetRoutePreview {...baseProps} {...props} />);
  return (next: Partial<FleetRoutePreviewProps>) =>
    view.rerender(<FleetRoutePreview {...baseProps} {...next} />);
}

function previewButton(): HTMLButtonElement {
  return screen.getByTestId('fleet-route-preview-button') as HTMLButtonElement;
}

async function clickPreview() {
  await act(async () => {
    previewButton().click();
  });
}

function shownRationale(): string | null {
  return screen.queryByTestId('fleet-route-preview-rationale')?.textContent ?? null;
}

async function settle(answer: { resolve: (value: RouteAnswer) => void }, value: RouteAnswer) {
  await act(async () => {
    answer.resolve(value);
  });
}

describe('FleetRoutePreview stale routes', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('drops the shown route when the goal changes, without asking the router by itself', async () => {
    const routePreview = vi.fn().mockResolvedValue(routeVia('hub'));
    installRouter(routePreview);
    const rerender = renderPreview();
    await clickPreview();
    expect(shownRationale()).toBe('via hub');

    rerender({ goal: 'summarize the incident logs' });

    expect(screen.queryByTestId('fleet-route-preview-result')).toBeNull();
    expect(routePreview).toHaveBeenCalledTimes(1);
    expect(previewButton().disabled).toBe(false);
  });

  it.each<[string, Partial<FleetRoutePreviewProps>]>([
    ['dispatch profile', { dispatchProfile: 'review' }],
    ['privacy tag', { privacyTag: 'sensitive' }],
    ['parallelism', { parallelism: 3 }],
    ['council mode', { council: true }],
    ['routable peers', { targetPeerIds: ['hub'] }],
  ])('drops the shown route when the %s changes', async (_label, change) => {
    installRouter(vi.fn().mockResolvedValue(routeVia('hub')));
    const rerender = renderPreview();
    await clickPreview();
    expect(shownRationale()).toBe('via hub');

    rerender(change);

    expect(screen.queryByTestId('fleet-route-preview-result')).toBeNull();
  });

  it('drops a previous error too once the parameters change', async () => {
    installRouter(
      vi.fn().mockResolvedValue({
        ok: false,
        error: 'No peer with known capabilities — refresh capabilities first.',
      })
    );
    const rerender = renderPreview();
    await clickPreview();
    expect(screen.getByTestId('fleet-route-preview-error')).toBeTruthy();

    rerender({ targetPeerIds: ['hub', 'spoke', 'relay'] });

    expect(screen.queryByTestId('fleet-route-preview-error')).toBeNull();
  });

  it('keeps the route when the router would receive exactly the same request', async () => {
    const routePreview = vi.fn().mockResolvedValue(routeVia('hub'));
    installRouter(routePreview);
    const rerender = renderPreview({ council: true, parallelism: 1 });
    await clickPreview();

    const heartbeat: FleetPeer = {
      id: 'hub',
      url: 'ws://203.0.113.10:3000/ws',
      addedAt: 1,
      status: 'authenticated',
      lastSeenAt: Date.now(),
    };
    rerender({
      goal: '  refactor the parser  ', // trimmed before sending
      council: true,
      parallelism: 2, // council already forces 2
      targetPeerIds: ['hub', 'spoke'], // new array, same peers
      peersById: { hub: heartbeat },
    });

    expect(shownRationale()).toBe('via hub');
    expect(routePreview).toHaveBeenCalledTimes(1);
  });

  it('never shows a late answer for the previous parameters as the current route', async () => {
    const answer = deferred<RouteAnswer>();
    installRouter(vi.fn(() => answer.promise));
    const rerender = renderPreview();
    await clickPreview();
    expect(previewButton().disabled).toBe(true);

    rerender({ goal: 'summarize the incident logs' });
    expect(previewButton().disabled).toBe(false);
    await settle(answer, routeVia('hub'));

    expect(screen.queryByTestId('fleet-route-preview-result')).toBeNull();
    expect(previewButton().disabled).toBe(false);
  });

  it('lets a new preview start while the old one is pending, and the old answer cannot replace it', async () => {
    const first = deferred<RouteAnswer>();
    const second = deferred<RouteAnswer>();
    const routePreview = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    installRouter(routePreview);
    const rerender = renderPreview();
    await clickPreview();

    rerender({ goal: 'summarize the incident logs' });
    await clickPreview();
    expect(routePreview).toHaveBeenCalledTimes(2);
    expect(routePreview.mock.calls[1][0]).toEqual({
      goal: 'summarize the incident logs',
      privacyTag: 'public',
      dispatchProfile: 'code',
      targetPeerIds: ['hub', 'spoke'],
    });

    await settle(second, routeVia('spoke'));
    expect(shownRationale()).toBe('via spoke');
    await settle(first, routeVia('hub'));
    expect(shownRationale()).toBe('via spoke');
    expect(previewButton().disabled).toBe(false);
  });

  it('keeps the route closed when a refresh answers after the operator closed it', async () => {
    const refresh = deferred<RouteAnswer>();
    const routePreview = vi
      .fn()
      .mockResolvedValueOnce(routeVia('hub'))
      .mockImplementationOnce(() => refresh.promise);
    installRouter(routePreview);
    renderPreview();
    await clickPreview();
    expect(shownRationale()).toBe('via hub');

    await clickPreview();
    await act(async () => {
      screen.getByTestId('fleet-route-preview-close').click();
    });
    await settle(refresh, routeVia('spoke'));

    expect(screen.queryByTestId('fleet-route-preview-result')).toBeNull();
    expect(previewButton().disabled).toBe(false);
    expect(routePreview).toHaveBeenCalledTimes(2);
  });
});
