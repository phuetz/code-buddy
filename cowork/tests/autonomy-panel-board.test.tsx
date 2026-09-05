/**
 * @vitest-environment happy-dom
 *
 * AutonomyPanel task-board surface (the kanban's write half): add-task form,
 * per-status claim/complete/release/block actions with inline text capture,
 * and the expired-claim sweep — all wired to the preload `autonomy.task*` API.
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutonomyPanel } from '../src/renderer/components/AutonomyPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const boardSnapshot = {
  ok: true,
  dir: '/home/u/.codebuddy/fleet',
  tasks: [
    { id: 't-open', title: 'Open task', status: 'open', priority: 'medium', claimedBy: null },
    { id: 't-prog', title: 'Running task', status: 'in_progress', priority: 'high', claimedBy: 'unit/cowork' },
    { id: 't-block', title: 'Stuck task', status: 'blocked', priority: 'low', blockedReason: 'needs creds' },
  ],
  worklog: [],
  presence: {},
};

function makeAutonomyApi() {
  return {
    snapshot: vi.fn().mockResolvedValue(boardSnapshot),
    daemonStatus: vi.fn().mockResolvedValue({
      ok: true,
      serviceName: 'codebuddy-autonomy',
      service: { installed: true, running: true, platform: 'linux' },
      queueDir: '/home/u/.codebuddy/fleet',
      manageCommand: 'systemctl --user status codebuddy-autonomy',
    }),
    serviceControl: vi.fn().mockResolvedValue({ ok: true, action: 'start', service: null }),
    serviceInstall: vi.fn().mockResolvedValue({ ok: true }),
    serviceUninstall: vi.fn().mockResolvedValue({ ok: true }),
    runTick: vi.fn().mockResolvedValue({ ok: true, ticks: 1 }),
    modelTier: vi.fn().mockResolvedValue({ ok: true, ladder: [] }),
    taskAdd: vi.fn().mockResolvedValue({ ok: true, task: { id: 't-new', title: 'New', status: 'open', priority: 'medium' } }),
    taskClaim: vi.fn().mockResolvedValue({ ok: true, task: { id: 't-open', title: 'Open task', status: 'in_progress', priority: 'medium' } }),
    taskComplete: vi.fn().mockResolvedValue({ ok: true, task: { id: 't-prog', title: 'Running task', status: 'completed', priority: 'high' } }),
    taskBlock: vi.fn().mockResolvedValue({ ok: true, task: { id: 't-open', title: 'Open task', status: 'blocked', priority: 'medium' } }),
    taskRelease: vi.fn().mockResolvedValue({ ok: true, task: { id: 't-prog', title: 'Running task', status: 'open', priority: 'high' } }),
    reclaimExpired: vi.fn().mockResolvedValue({ ok: true, reclaimed: [] }),
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

function query<T extends HTMLElement>(testId: string): T | null {
  return container!.querySelector(`[data-testid="${testId}"]`) as T | null;
}

async function click(testId: string) {
  const el = query<HTMLButtonElement>(testId);
  expect(el, `element ${testId} should be rendered`).not.toBeNull();
  await act(async () => {
    el!.click();
  });
}

async function type(testId: string, value: string) {
  const el = query<HTMLInputElement>(testId);
  expect(el, `input ${testId} should be rendered`).not.toBeNull();
  await act(async () => {
    el!.value = value;
    Simulate.change(el!);
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

describe('AutonomyPanel task board', () => {
  it('renders status-appropriate actions on each task card', async () => {
    await renderPanel(makeAutonomyApi());

    // open → claim + block, no complete/release
    expect(query('autonomy-task-claim-t-open')).not.toBeNull();
    expect(query('autonomy-task-block-t-open')).not.toBeNull();
    expect(query('autonomy-task-complete-t-open')).toBeNull();
    // in_progress → complete + release + block, no claim
    expect(query('autonomy-task-complete-t-prog')).not.toBeNull();
    expect(query('autonomy-task-release-t-prog')).not.toBeNull();
    expect(query('autonomy-task-block-t-prog')).not.toBeNull();
    expect(query('autonomy-task-claim-t-prog')).toBeNull();
    // blocked → reopen only, and the reason is visible
    expect(query('autonomy-task-release-t-block')).not.toBeNull();
    expect(query('autonomy-task-claim-t-block')).toBeNull();
    expect(container!.textContent).toContain('needs creds');
  });

  it('adds a task through the form and refreshes the snapshot', async () => {
    const api = makeAutonomyApi();
    await renderPanel(api);

    await click('autonomy-board-add-toggle');
    await type('autonomy-board-add-title', 'Ship the kanban write half');
    await click('autonomy-board-add-submit');

    expect(api.taskAdd).toHaveBeenCalledWith({ title: 'Ship the kanban write half', priority: 'medium' });
    // The panel refreshes the queue after every board action.
    expect(api.snapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The form closes after a successful add.
    expect(query('autonomy-board-add-form')).toBeNull();
  });

  it('keeps the add button disabled until a title is typed', async () => {
    await renderPanel(makeAutonomyApi());

    await click('autonomy-board-add-toggle');

    expect(query<HTMLButtonElement>('autonomy-board-add-submit')!.disabled).toBe(true);
    await type('autonomy-board-add-title', 'x');
    expect(query<HTMLButtonElement>('autonomy-board-add-submit')!.disabled).toBe(false);
  });

  it('claims an open task with one click', async () => {
    const api = makeAutonomyApi();
    await renderPanel(api);

    await click('autonomy-task-claim-t-open');

    expect(api.taskClaim).toHaveBeenCalledWith('t-open');
  });

  it('completes an in_progress task through the inline summary input', async () => {
    const api = makeAutonomyApi();
    await renderPanel(api);

    await click('autonomy-task-complete-t-prog');
    // Confirm is disabled until a summary is typed (the bridge would refuse it anyway).
    expect(query<HTMLButtonElement>('autonomy-task-input-confirm')!.disabled).toBe(true);
    await type('autonomy-task-input', 'shipped the board');
    await click('autonomy-task-input-confirm');

    expect(api.taskComplete).toHaveBeenCalledWith('t-prog', 'shipped the board');
    expect(query('autonomy-task-input')).toBeNull();
  });

  it('blocks an open task through the inline reason input', async () => {
    const api = makeAutonomyApi();
    await renderPanel(api);

    await click('autonomy-task-block-t-open');
    await type('autonomy-task-input', 'waiting on credentials');
    await click('autonomy-task-input-confirm');

    expect(api.taskBlock).toHaveBeenCalledWith('t-open', 'waiting on credentials');
  });

  it('releases an in_progress claim and reopens a blocked task via the same API', async () => {
    const api = makeAutonomyApi();
    await renderPanel(api);

    await click('autonomy-task-release-t-prog');
    expect(api.taskRelease).toHaveBeenCalledWith('t-prog');

    await click('autonomy-task-release-t-block');
    expect(api.taskRelease).toHaveBeenCalledWith('t-block');
  });

  it('sweeps expired claims from the board header', async () => {
    const api = makeAutonomyApi();
    await renderPanel(api);

    await click('autonomy-board-reclaim');

    expect(api.reclaimExpired).toHaveBeenCalled();
  });

  it('surfaces board errors inline, separately from daemon errors', async () => {
    const api = makeAutonomyApi();
    api.taskClaim.mockResolvedValue({ ok: false, error: "already claimed by 'gpuNode/repo'" });
    await renderPanel(api);

    await click('autonomy-task-claim-t-open');

    expect(query('autonomy-board-error')?.textContent).toContain('already claimed');
    expect(query('autonomy-daemon-error')).toBeNull();
  });
});
