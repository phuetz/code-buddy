/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvancedCommandCenter } from '../src/renderer/components/advanced/AdvancedCommandCenter';
import { useAppStore } from '../src/renderer/store';
import type { LiveLauncherRunView } from '../src/shared/live-launcher-types';
import type { ServerEvent } from '../src/renderer/types';

vi.mock('../src/renderer/components/MessageMarkdown', () => ({
  MessageMarkdown: ({ normalizedText }: { normalizedText: string }) => (
    <div data-testid="mock-markdown">{normalizedText}</div>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EventListener = (event: ServerEvent) => void;

const SUCCEEDED_RUN: LiveLauncherRunView = {
  runId: 'll_done',
  kind: 'research',
  researchMode: 'deep',
  prompt: 'Comparer les architectures multi-agents',
  model: 'qwen3.6:27b',
  provider: 'ollama',
  iterations: 2,
  perspectives: 4,
  status: 'succeeded',
  startedAt: 1_000,
  endedAt: 3_500,
  exitCode: 0,
  reportPath: '/tmp/report.md',
  logTail: ['plan', 'search', 'done'],
  result: '# Rapport\n\nConclusion vérifiée',
};

const RUNNING_RUN: LiveLauncherRunView = {
  runId: 'll_running',
  kind: 'flow',
  prompt: 'Corriger puis tester le module',
  model: 'qwen3.6:27b',
  provider: 'ollama',
  maxRetries: 1,
  status: 'running',
  startedAt: Date.now(),
  logTail: ['plan started'],
};

function makeHarness(initialRuns: LiveLauncherRunView[] = []) {
  const listeners: EventListener[] = [];
  const created: LiveLauncherRunView = {
    runId: 'll_new',
    kind: 'research',
    researchMode: 'direct',
    prompt: 'nouvelle recherche',
    model: 'qwen3.6:27b',
    provider: 'ollama',
    status: 'running',
    startedAt: Date.now(),
    logTail: [],
  };
  const api = {
    onEvent: vi.fn((listener: EventListener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    autonomy: {
      modelTier: vi.fn().mockResolvedValue({
        ok: true,
        ladder: [],
        currentChoice: {
          model: 'qwen3.6:27b',
          baseUrl: 'http://gpuNode:11434/v1',
          tier: 'network',
          paid: false,
          reason: 'free',
        },
      }),
    },
    liveLauncher: {
      list: vi.fn().mockResolvedValue(initialRuns),
      status: vi.fn(async (runId: string) =>
        runId === created.runId ? created : (initialRuns.find((run) => run.runId === runId) ?? null)
      ),
      start: vi.fn().mockResolvedValue({
        ok: true,
        runId: created.runId,
        reportPath: '/tmp/new.md',
      }),
      cancel: vi.fn().mockResolvedValue({ ok: true }),
    },
    gpuMedia: {
      capabilities: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        workerId: 'gpuNode-test',
        jobs: ['panoworld_reconstruct', 'avatar_video_render'],
        queueDepth: 0,
      }),
      submit: vi.fn(),
      status: vi.fn(),
      cancel: vi.fn(),
      download: vi.fn(),
    },
    selectFiles: vi.fn().mockResolvedValue([]),
    showItemInFolder: vi.fn().mockResolvedValue(true),
  };
  return { api, listeners, created };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderCenter(api: ReturnType<typeof makeHarness>['api']) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AdvancedCommandCenter />);
  });
}

function query(testId: string): HTMLElement | null {
  return container!.querySelector(`[data-testid="${testId}"]`);
}

async function click(testId: string): Promise<void> {
  const element = query(testId) as HTMLButtonElement | null;
  expect(element, `element ${testId} should exist`).not.toBeNull();
  await act(async () => {
    element!.click();
  });
}

async function setValue(testId: string, value: string): Promise<void> {
  const element = query(testId) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(element, `input ${testId} should exist`).not.toBeNull();
  await act(async () => {
    element!.value = value;
    Simulate.change(element!);
  });
}

async function pushEvent(
  harness: ReturnType<typeof makeHarness>,
  event: ServerEvent
): Promise<void> {
  await act(async () => {
    for (const listener of [...harness.listeners]) listener(event);
  });
}

const PANEL_FLAGS = {
  showSettings: false,
  settingsTab: null,
  showMemoryEditor: false,
  showSkillsManager: false,
  showCompanionPanel: false,
  showChannelsPanel: false,
  showAutonomyPanel: false,
  showTestRunner: false,
  showSessionInsights: false,
  showKnowledgePanel: false,
  showEvolutionPanel: false,
  showSciencePanel: false,
  showFleetCommandCenter: false,
  showMissionBoard: false,
  showWorkflowProPanel: false,
  showDevicePanel: false,
  showClawMigration: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState(PANEL_FLAGS);
  Object.defineProperty(window, 'confirm', {
    configurable: true,
    value: vi.fn().mockReturnValue(true),
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('AdvancedCommandCenter launcher', () => {
  it('loads runs, adopts the free local model and disables launch without a prompt', async () => {
    const harness = makeHarness([SUCCEEDED_RUN]);
    await renderCenter(harness.api);

    expect(harness.api.liveLauncher.list).toHaveBeenCalledOnce();
    expect((query('advanced-launcher-model') as HTMLInputElement).value).toBe('qwen3.6:27b');
    expect((query('advanced-launcher-start') as HTMLButtonElement).disabled).toBe(true);

    await click('advanced-tab-runs');
    expect(query('advanced-run-ll_done')).not.toBeNull();
    expect(query('advanced-run-result')?.textContent).toContain('Conclusion vérifiée');
  });

  it.each([
    ['research-direct', { kind: 'research' }],
    ['research-wide', { kind: 'research', wide: true, workers: 5 }],
    ['research-deep', { kind: 'research', deep: true, iterations: 2, perspectives: 4 }],
    ['flow', { kind: 'flow', maxRetries: 1 }],
  ] as const)('launches %s through the typed bridge', async (mode, expected) => {
    const harness = makeHarness();
    await renderCenter(harness.api);

    await click(`advanced-mode-${mode}`);
    await setValue('advanced-launcher-prompt', '  objectif précis  ');
    await click('advanced-launcher-start');

    expect(harness.api.liveLauncher.start).toHaveBeenCalledWith({
      ...expected,
      prompt: 'objectif précis',
      model: 'qwen3.6:27b',
      provider: 'ollama',
      ollamaUrl: 'http://gpuNode:11434/v1',
    });
    expect(query('advanced-run-detail')).not.toBeNull();
  });

  it('keeps the form intact and reports a rejected launch', async () => {
    const harness = makeHarness();
    harness.api.liveLauncher.start.mockResolvedValueOnce({
      ok: false,
      error: 'provider unavailable',
    });
    await renderCenter(harness.api);

    await setValue('advanced-launcher-prompt', 'ne pas perdre ce texte');
    await click('advanced-launcher-start');

    expect(query('advanced-command-error')?.textContent).toContain('provider unavailable');
    expect((query('advanced-launcher-prompt') as HTMLTextAreaElement).value).toBe(
      'ne pas perdre ce texte'
    );
  });

  it('requires an explicit cost confirmation before using inherited cloud credentials', async () => {
    const harness = makeHarness();
    const confirm = vi.mocked(window.confirm);
    await renderCenter(harness.api);

    await click('advanced-launcher-local');
    await setValue('advanced-launcher-prompt', 'recherche potentiellement payante');
    await click('advanced-launcher-start');

    expect(confirm).toHaveBeenCalledOnce();
    expect(harness.api.liveLauncher.start).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'inherit',
        confirmInheritedProvider: true,
      })
    );
  });
});

describe('AdvancedCommandCenter administration', () => {
  it('opens the GPU GPU node administration surface', async () => {
    const harness = makeHarness();
    await renderCenter(harness.api);

    await click('advanced-tab-gpu');

    expect(query('gpu-media-admin')).not.toBeNull();
    expect(harness.api.gpuMedia.capabilities).toHaveBeenCalledOnce();
  });

  it('keeps at most 20 renderer runs when status events accumulate', async () => {
    const harness = makeHarness();
    await renderCenter(harness.api);

    for (let index = 0; index < 25; index += 1) {
      await pushEvent(harness, {
        type: 'liveLauncher.event',
        payload: {
          runId: `ll_cap_${index}`,
          kind: 'status',
          run: {
            ...SUCCEEDED_RUN,
            runId: `ll_cap_${index}`,
            prompt: `Run ${index}`,
            startedAt: index + 1,
            endedAt: index + 2,
          },
        },
      } as ServerEvent);
    }

    await click('advanced-tab-runs');
    expect(container!.querySelectorAll('[data-testid^="advanced-run-ll_cap_"]')).toHaveLength(20);
    expect(query('advanced-run-ll_cap_0')).toBeNull();
    expect(query('advanced-run-ll_cap_24')).not.toBeNull();
  });

  it('streams all run events, cancels an active run and renders its terminal result', async () => {
    const harness = makeHarness([RUNNING_RUN]);
    await renderCenter(harness.api);
    await click('advanced-tab-runs');

    await click('advanced-run-cancel');
    expect(harness.api.liveLauncher.cancel).toHaveBeenCalledWith('ll_running');

    await pushEvent(harness, {
      type: 'liveLauncher.event',
      payload: {
        runId: 'll_running',
        kind: 'log',
        stream: 'stdout',
        lines: ['tests passed'],
      },
    } as ServerEvent);
    expect(query('advanced-run-log')?.textContent).toContain('tests passed');

    await pushEvent(harness, {
      type: 'liveLauncher.event',
      payload: {
        runId: 'll_running',
        kind: 'status',
        run: {
          ...RUNNING_RUN,
          status: 'succeeded',
          endedAt: Date.now(),
          exitCode: 0,
          logTail: ['plan started', 'tests passed'],
          result: 'Mission terminée',
        },
      },
    } as ServerEvent);

    expect(query('advanced-run-cancel')).toBeNull();
    expect(query('advanced-run-result')?.textContent).toContain('Mission terminée');
  });

  it('copies a result, reveals its report and restores rerun parameters', async () => {
    const harness = makeHarness([SUCCEEDED_RUN]);
    await renderCenter(harness.api);
    await click('advanced-tab-runs');

    await click('advanced-run-copy');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SUCCEEDED_RUN.result);

    await click('advanced-run-reveal');
    expect(harness.api.showItemInFolder).toHaveBeenCalledWith('/tmp/report.md');

    await click('advanced-run-rerun');
    expect((query('advanced-launcher-prompt') as HTMLTextAreaElement).value).toBe(
      SUCCEEDED_RUN.prompt
    );
    expect(query('advanced-launcher-iterations')).not.toBeNull();
  });

  it('opens every native administration panel from the allowlisted catalog', async () => {
    const harness = makeHarness();
    await renderCenter(harness.api);

    const cases = [
      ['settings', 'showSettings'],
      ['backups', 'showSettings'],
      ['memory', 'showMemoryEditor'],
      ['skills', 'showSkillsManager'],
      ['companion', 'showCompanionPanel'],
      ['channels', 'showChannelsPanel'],
      ['autonomy', 'showAutonomyPanel'],
      ['tests', 'showTestRunner'],
      ['insights', 'showSessionInsights'],
      ['knowledge', 'showKnowledgePanel'],
      ['evolution', 'showEvolutionPanel'],
      ['science', 'showSciencePanel'],
      ['fleet', 'showFleetCommandCenter'],
      ['missions', 'showMissionBoard'],
      ['workflows', 'showWorkflowProPanel'],
      ['devices', 'showDevicePanel'],
      ['migration', 'showClawMigration'],
    ] as const;

    for (const [feature, flag] of cases) {
      await click(`advanced-feature-${feature}`);
      expect(useAppStore.getState()[flag], `${flag} should be enabled`).toBe(true);
    }
    expect(useAppStore.getState().settingsTab).toBe('general');
  });
});
