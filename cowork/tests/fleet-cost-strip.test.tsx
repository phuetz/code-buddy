/**
 * @vitest-environment happy-dom
 *
 * FleetCostStrip — fleet spend observability: today vs daily cap,
 * 7-day total, per-peer/per-provider chips, $0 message, errors.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetCostStrip } from '../src/renderer/components/FleetCostStrip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderStrip(costSummary: ReturnType<typeof vi.fn>, refreshToken = 0) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: { costSummary } };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<FleetCostStrip refreshToken={refreshToken} />);
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

describe('FleetCostStrip', () => {
  it('renders today vs cap, the week total, and per-peer/provider chips', async () => {
    const costSummary = vi.fn().mockResolvedValue({
      ok: true,
      summary: {
        todayUsd: 0.42,
        todayByProvider: { grok: 0.3, openai: 0.12 },
        todayByPeer: { 'gpuNode/repo': 0.42 },
        weekUsd: 1.1,
      },
      budget: { maxDailyUsd: 5, maxSagaUsd: 1 },
    });
    await renderStrip(costSummary);

    expect(costSummary).toHaveBeenCalled();
    expect(container!.querySelector('[data-testid="fleet-cost-today"]')?.textContent).toContain('0.42$');
    expect(container!.querySelector('[data-testid="fleet-cost-today"]')?.textContent).toContain('5.00$');
    expect(container!.querySelector('[data-testid="fleet-cost-week"]')?.textContent).toContain('1.10$');
    expect(container!.querySelectorAll('[data-testid="fleet-cost-peer-chip"]').length).toBe(1);
    expect(container!.querySelectorAll('[data-testid="fleet-cost-provider-chip"]').length).toBe(2);
    expect(container!.querySelector('[data-testid="fleet-cost-bar"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="fleet-cost-zero"]')).toBeNull();
  });

  it('celebrates a $0 day (free local models)', async () => {
    const costSummary = vi.fn().mockResolvedValue({
      ok: true,
      summary: { todayUsd: 0, todayByProvider: {}, todayByPeer: {}, weekUsd: 0 },
      budget: { maxDailyUsd: 5, maxSagaUsd: 1 },
    });
    await renderStrip(costSummary);

    expect(container!.querySelector('[data-testid="fleet-cost-zero"]')?.textContent).toContain(
      'free local models'
    );
  });

  it('surfaces errors inline', async () => {
    const costSummary = vi.fn().mockResolvedValue({ ok: false, error: 'ledger unreadable' });
    await renderStrip(costSummary);

    expect(container!.querySelector('[data-testid="fleet-cost-error"]')?.textContent).toContain(
      'ledger unreadable'
    );
  });

  it('reloads when the refresh button is clicked', async () => {
    const costSummary = vi.fn().mockResolvedValue({
      ok: true,
      summary: { todayUsd: 0, todayByProvider: {}, todayByPeer: {}, weekUsd: 0 },
      budget: { maxDailyUsd: 5, maxSagaUsd: 1 },
    });
    await renderStrip(costSummary);
    const initialCalls = costSummary.mock.calls.length;

    const button = container!.querySelector(
      '[data-testid="fleet-cost-refresh"]'
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(costSummary.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
