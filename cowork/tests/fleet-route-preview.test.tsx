/**
 * @vitest-environment happy-dom
 *
 * FleetRoutePreview — dry-run the router from the dispatch form: lanes
 * with scores, rationale, privacy lint outcome, errors, dismiss.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetRoutePreview } from '../src/renderer/components/FleetRoutePreview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const defaultProps = {
  goal: 'refactor the parser',
  dispatchProfile: 'code' as const,
  privacyTag: 'public' as const,
  parallelism: 1,
  council: false,
  targetPeerIds: ['darkstar/repo'],
};

async function renderPreview(routePreview: ReturnType<typeof vi.fn>, props = {}) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: { routePreview } };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<FleetRoutePreview {...defaultProps} {...props} />);
  });
}

function query(testId: string): HTMLElement | null {
  return container!.querySelector(`[data-testid="${testId}"]`);
}

async function click(testId: string) {
  const el = query(testId) as HTMLButtonElement | null;
  expect(el, `element ${testId} should be rendered`).not.toBeNull();
  await act(async () => {
    el!.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('FleetRoutePreview', () => {
  it('dry-runs the router with the form intent and renders lanes + rationale', async () => {
    const routePreview = vi.fn().mockResolvedValue({
      ok: true,
      privacyTag: 'public',
      rationale: 'best free local match',
      primary: { peerId: 'darkstar/repo', model: 'qwen3.6:27b', score: 0.91 },
      fallback: { peerId: 'ministar/repo', model: 'qwen2.5:7b', score: 0.6 },
    });
    await renderPreview(routePreview);

    await click('fleet-route-preview-button');

    expect(routePreview).toHaveBeenCalledWith({
      goal: 'refactor the parser',
      privacyTag: 'public',
      dispatchProfile: 'code',
      targetPeerIds: ['darkstar/repo'],
    });
    const lanes = container!.querySelectorAll('[data-testid="fleet-route-preview-lane"]');
    expect(lanes.length).toBe(2);
    expect(lanes[0].textContent).toContain('darkstar/repo');
    expect(lanes[0].textContent).toContain('91%');
    expect(query('fleet-route-preview-rationale')?.textContent).toContain('best free local match');
  });

  it('forces parallelism ≥2 for council previews, matching the dispatch path', async () => {
    const routePreview = vi.fn().mockResolvedValue({ ok: true, parallel: [] });
    await renderPreview(routePreview, { council: true, parallelism: 1 });

    await click('fleet-route-preview-button');

    expect(routePreview).toHaveBeenCalledWith(
      expect.objectContaining({ council: true, parallelism: 2 }),
    );
  });

  it('surfaces the privacy lint warning and errors, and can be dismissed', async () => {
    const routePreview = vi.fn().mockResolvedValue({
      ok: true,
      privacyTag: 'sensitive',
      lintWarning: 'would auto-bump to sensitive (1 match(es))',
      primary: { peerId: 'p', model: 'm' },
    });
    await renderPreview(routePreview);

    await click('fleet-route-preview-button');
    expect(query('fleet-route-preview-lint')?.textContent).toContain('sensitive');

    await click('fleet-route-preview-close');
    expect(query('fleet-route-preview-result')).toBeNull();
  });

  it('disables the button without a goal', async () => {
    const routePreview = vi.fn();
    await renderPreview(routePreview, { goal: '   ' });

    expect((query('fleet-route-preview-button') as HTMLButtonElement).disabled).toBe(true);
  });
});
