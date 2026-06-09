/**
 * @vitest-environment happy-dom
 *
 * AutonomyPanel daemon-lifecycle + model-tier surfaces: status rendering,
 * start/stop/restart/install/tick wiring to the preload `autonomy.*` API.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutonomyPanel } from '../src/renderer/components/AutonomyPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const emptySnapshot = {
  ok: true,
  dir: '/home/u/.codebuddy/fleet',
  tasks: [],
  worklog: [],
  presence: {},
};

const tierReview = {
  ok: true,
  ladder: [
    { tier: 'local', model: 'qwen2.5:7b-instruct', baseUrl: 'http://localhost:11434/v1', paid: false, configured: true },
    { tier: 'escalated', model: '(not configured — never escalates to paid)', paid: true, configured: false },
  ],
  currentChoice: { model: 'qwen2.5:7b-instruct', tier: 'local', paid: false, reason: 'basic' },
};

function makeAutonomyApi(service: { installed: boolean; running: boolean }) {
  return {
    snapshot: vi.fn().mockResolvedValue(emptySnapshot),
    daemonStatus: vi.fn().mockResolvedValue({
      ok: true,
      serviceName: 'codebuddy-autonomy',
      service: { ...service, platform: 'linux' },
      queueDir: '/home/u/.codebuddy/fleet',
      manageCommand: 'systemctl --user status codebuddy-autonomy',
    }),
    serviceControl: vi.fn().mockResolvedValue({ ok: true, action: 'start', service: null }),
    serviceInstall: vi.fn().mockResolvedValue({ ok: true }),
    serviceUninstall: vi.fn().mockResolvedValue({ ok: true }),
    runTick: vi.fn().mockResolvedValue({ ok: true, ticks: 1, outcomes: { idle: 1 }, stoppedReason: 'maxTicks' }),
    modelTier: vi.fn().mockResolvedValue(tierReview),
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderPanel(api: ReturnType<typeof makeAutonomyApi>) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { autonomy: api };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AutonomyPanel isOpen onClose={() => {}} />);
  });
}

async function click(testId: string) {
  const el = container!.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  expect(el, `button ${testId} should be rendered`).not.toBeNull();
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

describe('AutonomyPanel daemon lifecycle', () => {
  it('shows a running service with stop/restart/uninstall controls', async () => {
    const api = makeAutonomyApi({ installed: true, running: true });
    await renderPanel(api);

    expect(container!.querySelector('[data-testid="autonomy-daemon-section"]')?.textContent).toContain(
      'Service running'
    );
    expect(container!.querySelector('[data-testid="autonomy-daemon-stop"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="autonomy-daemon-restart"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="autonomy-daemon-uninstall"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="autonomy-daemon-start"]')).toBeNull();
    expect(container!.querySelector('[data-testid="autonomy-daemon-install"]')).toBeNull();
  });

  it('starts a stopped service through the preload API', async () => {
    const api = makeAutonomyApi({ installed: true, running: false });
    await renderPanel(api);

    await click('autonomy-daemon-start');

    expect(api.serviceControl).toHaveBeenCalledWith('start');
    // The panel refreshes status after every action.
    expect(api.daemonStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('offers install when the service is missing and runs it', async () => {
    const api = makeAutonomyApi({ installed: false, running: false });
    await renderPanel(api);

    expect(container!.querySelector('[data-testid="autonomy-daemon-section"]')?.textContent).toContain(
      'Not installed'
    );
    await click('autonomy-daemon-install');
    expect(api.serviceInstall).toHaveBeenCalled();
  });

  it('runs a one-shot tick and shows the outcome summary', async () => {
    const api = makeAutonomyApi({ installed: true, running: true });
    await renderPanel(api);

    await click('autonomy-daemon-tick');

    expect(api.runTick).toHaveBeenCalled();
    expect(container!.querySelector('[data-testid="autonomy-daemon-tick-result"]')?.textContent).toContain('idle×1');
  });

  it('surfaces action errors inline', async () => {
    const api = makeAutonomyApi({ installed: true, running: true });
    api.serviceControl.mockResolvedValue({ ok: false, error: 'unit not loaded', action: 'stop', service: null });
    await renderPanel(api);

    await click('autonomy-daemon-stop');

    expect(container!.querySelector('[data-testid="autonomy-daemon-error"]')?.textContent).toContain(
      'unit not loaded'
    );
  });

  it('renders the free-first model ladder with the current $0 choice', async () => {
    const api = makeAutonomyApi({ installed: true, running: true });
    await renderPanel(api);

    const section = container!.querySelector('[data-testid="autonomy-model-tier-section"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('qwen2.5:7b-instruct');
    expect(section!.textContent).toContain('Next tick uses');
    expect(section!.textContent).toContain('$0');
  });
});
