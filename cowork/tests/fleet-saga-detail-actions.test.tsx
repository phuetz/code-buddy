/**
 * @vitest-environment happy-dom
 *
 * SagaDetail operator actions: cancel an active saga, replay a terminal
 * one as a new saga (selecting it via onReplayed), and inline errors.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SagaDetail } from '../src/renderer/components/fleet-saga-detail';
import type { SagaSummary } from '../src/renderer/components/fleet-command-center-helpers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  // A transitive import (i18n/config.ts) initializes i18next with this plugin.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSaga(status: SagaSummary['status']): SagaSummary {
  return {
    id: 'saga_ui_1',
    goal: 'Investigate the flaky deploy',
    status,
    steps: [
      { peerId: 'peer-a', model: 'm1', lane: 'primary', status: status === 'running' ? 'running' : 'completed' },
    ],
    createdAt: Date.now() - 60_000,
  } as unknown as SagaSummary;
}

function makeFleetApi() {
  return {
    cancelSaga: vi.fn().mockResolvedValue({ ok: true, status: 'cancelled' }),
    replaySaga: vi.fn().mockResolvedValue({ ok: true, sagaId: 'saga_new_99' }),
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderDetail(
  saga: SagaSummary,
  api: ReturnType<typeof makeFleetApi>,
  onReplayed?: (id: string) => void,
) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: api };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SagaDetail saga={saga} peersById={{}} onReplayed={onReplayed} />);
  });
}

function query(testId: string): HTMLButtonElement | null {
  return container!.querySelector(`[data-testid="${testId}"]`);
}

async function click(testId: string) {
  const el = query(testId);
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

describe('SagaDetail operator actions', () => {
  it('offers cancel (not replay) on an active saga and wires it to fleet.cancelSaga', async () => {
    const api = makeFleetApi();
    await renderDetail(makeSaga('running'), api);

    expect(query('fleet-saga-cancel')).not.toBeNull();
    expect(query('fleet-saga-replay')).toBeNull();

    await click('fleet-saga-cancel');

    expect(api.cancelSaga).toHaveBeenCalledWith('saga_ui_1');
  });

  it('offers replay (not cancel) on a terminal saga and selects the new saga', async () => {
    const api = makeFleetApi();
    const onReplayed = vi.fn();
    await renderDetail(makeSaga('failed'), api, onReplayed);

    expect(query('fleet-saga-replay')).not.toBeNull();
    expect(query('fleet-saga-cancel')).toBeNull();

    await click('fleet-saga-replay');

    expect(api.replaySaga).toHaveBeenCalledWith('saga_ui_1');
    expect(onReplayed).toHaveBeenCalledWith('saga_new_99');
  });

  it('also offers replay on a cancelled saga', async () => {
    const api = makeFleetApi();
    await renderDetail(makeSaga('cancelled'), api);

    expect(query('fleet-saga-replay')).not.toBeNull();
  });

  it('surfaces action errors inline', async () => {
    const api = makeFleetApi();
    api.cancelSaga.mockResolvedValue({ ok: false, error: "Saga is already terminal ('completed')" });
    await renderDetail(makeSaga('running'), api);

    await click('fleet-saga-cancel');

    expect(
      container!.querySelector('[data-testid="fleet-saga-action-error"]')?.textContent,
    ).toContain('already terminal');
  });
});
