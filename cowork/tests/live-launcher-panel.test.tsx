/**
 * @vitest-environment happy-dom
 *
 * LiveLauncherPanel — launch research/flow live: form wiring, model
 * prefill from the autonomy ladder, live log streaming, result render,
 * cancel, inline errors.
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveLauncherPanel } from '../src/renderer/components/LiveLauncherPanel';
import type { ServerEvent } from '../src/renderer/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../src/renderer/components/MessageMarkdown', () => ({
  MessageMarkdown: ({ normalizedText }: { normalizedText: string }) => (
    <div data-testid="mock-markdown">{normalizedText}</div>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EventListenerFn = (event: ServerEvent) => void;

function makeApi() {
  const listeners: EventListenerFn[] = [];
  return {
    listeners,
    api: {
      onEvent: vi.fn((cb: EventListenerFn) => {
        listeners.push(cb);
        return () => {
          const index = listeners.indexOf(cb);
          if (index >= 0) listeners.splice(index, 1);
        };
      }),
      autonomy: {
        modelTier: vi.fn().mockResolvedValue({
          ok: true,
          ladder: [],
          currentChoice: { model: 'qwen3.6:27b', tier: 'network', paid: false, reason: 'free' },
        }),
      },
      liveLauncher: {
        start: vi.fn().mockResolvedValue({ ok: true, runId: 'll_1', reportPath: '/tmp/r.md' }),
        cancel: vi.fn().mockResolvedValue({ ok: true }),
        status: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
      },
    },
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderPanel(api: ReturnType<typeof makeApi>['api']) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<LiveLauncherPanel isOpen onClose={() => {}} />);
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

async function setValue(testId: string, value: string) {
  const el = query(testId) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(el, `input ${testId} should be rendered`).not.toBeNull();
  await act(async () => {
    el!.value = value;
    Simulate.change(el!);
  });
}

async function pushEvent(harness: ReturnType<typeof makeApi>, event: ServerEvent) {
  await act(async () => {
    for (const listener of [...harness.listeners]) listener(event);
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

describe('LiveLauncherPanel', () => {
  it('prefills the model from the autonomy ladder ($0 choice) and disables launch without a prompt', async () => {
    const harness = makeApi();
    await renderPanel(harness.api);

    expect((query('live-launcher-model') as HTMLInputElement).value).toBe('qwen3.6:27b');
    expect((query('live-launcher-start') as HTMLButtonElement).disabled).toBe(true);
  });

  it('launches research pinned on local Ollama with the form intent', async () => {
    const harness = makeApi();
    await renderPanel(harness.api);

    await setValue('live-launcher-prompt', 'état de l art des agents locaux');
    await click('live-launcher-start');

    expect(harness.api.liveLauncher.start).toHaveBeenCalledWith({
      kind: 'research',
      prompt: 'état de l art des agents locaux',
      model: 'qwen3.6:27b',
      provider: 'ollama',
    });
    expect(query('live-launcher-status')?.textContent).toBe('running');
    expect(query('live-launcher-cancel')).not.toBeNull();
  });

  it('switches to flow mode and forwards it', async () => {
    const harness = makeApi();
    await renderPanel(harness.api);

    await click('live-launcher-mode-flow');
    await setValue('live-launcher-prompt', 'corrige le bug');
    await click('live-launcher-start');

    expect(harness.api.liveLauncher.start).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'flow', prompt: 'corrige le bug' }),
    );
  });

  it('streams log events for its run into the live output', async () => {
    const harness = makeApi();
    await renderPanel(harness.api);
    await setValue('live-launcher-prompt', 'topic');
    await click('live-launcher-start');

    await pushEvent(harness, {
      type: 'liveLauncher.event',
      payload: { runId: 'll_1', kind: 'log', stream: 'stdout', lines: ['📋 Subtopics (3):'] },
    } as ServerEvent);
    await pushEvent(harness, {
      type: 'liveLauncher.event',
      payload: { runId: 'll_OTHER', kind: 'log', stream: 'stdout', lines: ['bruit étranger'] },
    } as ServerEvent);

    const log = query('live-launcher-log');
    expect(log?.textContent).toContain('Subtopics');
    expect(log?.textContent).not.toContain('bruit étranger');
  });

  it('renders the final report on success', async () => {
    const harness = makeApi();
    await renderPanel(harness.api);
    await setValue('live-launcher-prompt', 'topic');
    await click('live-launcher-start');

    await pushEvent(harness, {
      type: 'liveLauncher.event',
      payload: {
        runId: 'll_1',
        kind: 'status',
        run: {
          runId: 'll_1',
          kind: 'research',
          prompt: 'topic',
          provider: 'ollama',
          status: 'succeeded',
          startedAt: 1,
          logTail: [],
          result: '# Rapport\n\nconclusions',
          reportPath: '/tmp/r.md',
        },
      },
    } as ServerEvent);

    expect(query('live-launcher-status')?.textContent).toBe('succeeded');
    expect(query('live-launcher-result')?.textContent).toContain('conclusions');
  });

  it('cancels the running launch', async () => {
    const harness = makeApi();
    await renderPanel(harness.api);
    await setValue('live-launcher-prompt', 'topic');
    await click('live-launcher-start');

    await click('live-launcher-cancel');

    expect(harness.api.liveLauncher.cancel).toHaveBeenCalledWith('ll_1');
  });

  it('surfaces launch errors inline', async () => {
    const harness = makeApi();
    harness.api.liveLauncher.start.mockResolvedValue({
      ok: false,
      error: 'Built Code Buddy CLI not found (run `npm run build` in the core repo first).',
    });
    await renderPanel(harness.api);
    await setValue('live-launcher-prompt', 'topic');
    await click('live-launcher-start');

    expect(query('live-launcher-error')?.textContent).toContain('npm run build');
  });
});
