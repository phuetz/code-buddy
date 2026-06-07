/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MissionBoardPanel } from '../src/renderer/components/MissionBoardPanel';
import { useAppStore } from '../src/renderer/store';
import type { CompanionMission, MissionRuntime } from '../src/renderer/types';
import { MissionStatus, SubTaskStatus } from '../src/main/missions/mission-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) => value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template
      );
    },
  }),
}));

function mission(overrides: Partial<CompanionMission> = {}): CompanionMission {
  return {
    id: 'mission-1',
    title: 'Build autonomous mission tracking',
    dimension: 'autonomy',
    status: 'open',
    priority: 'P0',
    summary: 'Expose a mission board.',
    recommendation: 'Create a visible mission board for long-running work.',
    sourceGapId: 'gap-1',
    competitorRefs: ['Open Cowork'],
    command: '/mission build board',
    tags: ['roadmap'],
    createdAt: '2026-06-07T15:00:00.000Z',
    updatedAt: '2026-06-07T15:30:00.000Z',
    ...overrides,
  };
}

function board(items: CompanionMission[]) {
  return {
    schemaVersion: 1 as const,
    cwd: '/ws',
    storePath: '/ws/.codebuddy/companion-missions.json',
    updatedAt: '2026-06-07T15:30:00.000Z',
    missions: items,
  };
}

function runtimeMission(overrides: Partial<MissionRuntime> = {}): MissionRuntime {
  return {
    id: 'runtime-1',
    title: 'Execute real mission runtime',
    description: 'MissionBridge execution is streamed into the renderer store.',
    status: MissionStatus.Running,
    subTasks: [
      {
        id: 'research',
        title: 'Research',
        status: SubTaskStatus.Completed,
        progress: 100,
      },
      {
        id: 'wire-ui',
        title: 'Wire UI',
        status: SubTaskStatus.Running,
        progress: 40,
        dependsOn: ['research'],
      },
    ],
    progress: 50,
    createdAt: '2026-06-07T16:00:00.000Z',
    updatedAt: '2026-06-07T16:10:00.000Z',
    events: [],
    costUsd: 0,
    tokens: 0,
    ...overrides,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('MissionBoardPanel', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  beforeEach(() => {
    useAppStore.setState({
      workingDir: '/ws',
      activeSessionId: null,
      sessions: [],
      missionRuntime: {},
      missionRuntimeEvents: {},
      missionRuntimeHeartbeats: {},
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('lists companion missions and prepares the next mission as a dry run', async () => {
    const item = mission();
    const listMissions = vi.fn().mockResolvedValue({ ok: true, board: board([item]), items: [item] });
    const runNextMission = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        success: true,
        dryRun: true,
        message: 'Prepared next mission brief.',
        mission: item,
        board: board([item]),
      },
    });
    const syncMissions = vi.fn();
    const updateMission = vi.fn();

    (
      window as unknown as {
        electronAPI?: {
          companion: {
            listMissions: typeof listMissions;
            runNextMission: typeof runNextMission;
            syncMissions: typeof syncMissions;
            updateMission: typeof updateMission;
          };
        };
      }
    ).electronAPI = {
      companion: { listMissions, runNextMission, syncMissions, updateMission },
    };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(MissionBoardPanel, { onClose: () => {} }));
      await flush();
    });

    expect(listMissions).toHaveBeenCalledTimes(1);
    expect(target.querySelector('[data-testid="mission-card-mission-1"]')?.textContent).toContain(
      'Build autonomous mission tracking'
    );

    const prepare = target.querySelector('[data-testid="mission-board-prepare-next"]') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(prepare);
      await flush();
    });

    expect(runNextMission).toHaveBeenCalledWith({ dryRun: true });
    expect(target.querySelector('[data-testid="mission-board-run-result"]')?.textContent).toContain(
      'Prepared next mission brief.'
    );
  });

  it('updates mission status through the companion bridge', async () => {
    const item = mission();
    const listMissions = vi.fn().mockResolvedValue({ ok: true, board: board([item]), items: [item] });
    const updateMission = vi.fn().mockResolvedValue({
      ok: true,
      mission: mission({ status: 'in_progress' }),
    });
    const syncMissions = vi.fn();
    const runNextMission = vi.fn();

    (
      window as unknown as {
        electronAPI?: {
          companion: {
            listMissions: typeof listMissions;
            runNextMission: typeof runNextMission;
            syncMissions: typeof syncMissions;
            updateMission: typeof updateMission;
          };
        };
      }
    ).electronAPI = {
      companion: { listMissions, runNextMission, syncMissions, updateMission },
    };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(MissionBoardPanel, { onClose: () => {} }));
      await flush();
    });

    const start = target.querySelector('[data-testid="mission-start-mission-1"]') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(start);
      await flush();
    });

    expect(updateMission).toHaveBeenCalledWith({
      missionId: 'mission-1',
      status: 'in_progress',
    });
  });

  it('shows live MissionBridge runtime missions from the renderer store', async () => {
    const liveMission = runtimeMission();
    const runtimeEvents = [
      {
        ts: '2026-06-07T16:11:00.000Z',
        type: 'created',
        message: 'Runtime mission created.',
      },
      {
        ts: '2026-06-07T16:12:00.000Z',
        type: 'progress',
        message: 'UI wire complete.',
      },
    ];
    const listMissions = vi.fn().mockResolvedValue({ ok: true, board: board([]), items: [] });
    const updateMission = vi.fn();
    const syncMissions = vi.fn();
    const runNextMission = vi.fn();

    (
      window as unknown as {
        electronAPI?: {
          companion: {
            listMissions: typeof listMissions;
            runNextMission: typeof runNextMission;
            syncMissions: typeof syncMissions;
            updateMission: typeof updateMission;
          };
        };
      }
    ).electronAPI = {
      companion: { listMissions, runNextMission, syncMissions, updateMission },
    };

    useAppStore.setState({
      missionRuntime: { [liveMission.id]: liveMission },
      missionRuntimeEvents: { [liveMission.id]: runtimeEvents },
      missionRuntimeHeartbeats: { [liveMission.id]: 'heartbeat-at' },
    });

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(MissionBoardPanel, { onClose: () => {} }));
      await flush();
    });

    const runtimeSection = target.querySelector('[data-testid="mission-runtime-section"]');
    const runtimeCard = target.querySelector('[data-testid="mission-runtime-card-runtime-1"]');

    expect(runtimeSection?.textContent).toContain('Live runtime');
    expect(runtimeCard?.textContent).toContain('Execute real mission runtime');
    expect(runtimeCard?.textContent).toContain(MissionStatus.Running);
    expect(runtimeCard?.textContent).toContain('50%');
    expect(runtimeCard?.textContent).toContain('1/2 tasks');
    expect(runtimeCard?.textContent).toContain('heartbeat heartbeat-at');
    expect(target.querySelector('[data-testid="mission-runtime-events-runtime-1"]')?.textContent).toContain(
      'progress UI wire complete.'
    );
    expect(listMissions).toHaveBeenCalledTimes(1);
  });

  it('hydrates MissionBridge runtime missions through the refresh bridge', async () => {
    const liveMission = runtimeMission({
      id: 'runtime-refresh',
      title: 'Loaded from mission IPC',
    });
    const listMissions = vi.fn().mockResolvedValue({ ok: true, board: board([]), items: [] });
    const listRuntimeMissions = vi.fn().mockResolvedValue({ ok: true, missions: [liveMission] });
    const updateMission = vi.fn();
    const syncMissions = vi.fn();
    const runNextMission = vi.fn();

    (
      window as unknown as {
        electronAPI?: {
          companion: {
            listMissions: typeof listMissions;
            runNextMission: typeof runNextMission;
            syncMissions: typeof syncMissions;
            updateMission: typeof updateMission;
          };
          missions: {
            list: typeof listRuntimeMissions;
          };
        };
      }
    ).electronAPI = {
      companion: { listMissions, runNextMission, syncMissions, updateMission },
      missions: { list: listRuntimeMissions },
    };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(MissionBoardPanel, { onClose: () => {} }));
      await flush();
    });

    expect(listMissions).toHaveBeenCalledTimes(1);
    expect(listRuntimeMissions).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().missionRuntime['runtime-refresh']).toMatchObject({
      id: 'runtime-refresh',
      title: 'Loaded from mission IPC',
    });
    expect(target.querySelector('[data-testid="mission-runtime-card-runtime-refresh"]')?.textContent).toContain(
      'Loaded from mission IPC'
    );
  });

  it('creates a MissionBridge runtime mission from the board', async () => {
    const createdMission = runtimeMission({
      id: 'runtime-created',
      title: 'Draft a runtime mission',
      description: 'Created through the Mission Board.',
      status: MissionStatus.Planning,
      subTasks: [],
      progress: 0,
    });
    const listMissions = vi.fn().mockResolvedValue({ ok: true, board: board([]), items: [] });
    const listRuntimeMissions = vi.fn().mockResolvedValue({ ok: true, missions: [] });
    const createRuntimeMission = vi.fn().mockResolvedValue({ ok: true, mission: createdMission });
    const updateMission = vi.fn();
    const syncMissions = vi.fn();
    const runNextMission = vi.fn();

    (
      window as unknown as {
        electronAPI?: {
          companion: {
            listMissions: typeof listMissions;
            runNextMission: typeof runNextMission;
            syncMissions: typeof syncMissions;
            updateMission: typeof updateMission;
          };
          missions: {
            list: typeof listRuntimeMissions;
            create: typeof createRuntimeMission;
          };
        };
      }
    ).electronAPI = {
      companion: { listMissions, runNextMission, syncMissions, updateMission },
      missions: { list: listRuntimeMissions, create: createRuntimeMission },
    };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(MissionBoardPanel, { onClose: () => {} }));
      await flush();
    });

    const title = target.querySelector('[data-testid="mission-runtime-create-title"]') as HTMLInputElement;
    const description = target.querySelector(
      '[data-testid="mission-runtime-create-description"]'
    ) as HTMLInputElement;
    const submit = target.querySelector('[data-testid="mission-runtime-create-submit"]') as HTMLButtonElement;

    await act(async () => {
      title.value = 'Draft a runtime mission';
      description.value = 'Created through the Mission Board.';
      Simulate.change(title);
      Simulate.change(description);
      await flush();
    });
    await act(async () => {
      Simulate.click(submit);
      await flush();
    });

    expect(createRuntimeMission).toHaveBeenCalledWith({
      title: 'Draft a runtime mission',
      description: 'Created through the Mission Board.',
    });
    expect(useAppStore.getState().missionRuntime['runtime-created']).toMatchObject({
      id: 'runtime-created',
      title: 'Draft a runtime mission',
    });
    expect(target.querySelector('[data-testid="mission-runtime-card-runtime-created"]')?.textContent).toContain(
      'Draft a runtime mission'
    );
  });

  it('inspects ready runtime sub-tasks through the MissionBridge IPC', async () => {
    const liveMission = runtimeMission();
    const readyTask = {
      ...liveMission.subTasks[1],
      status: SubTaskStatus.Pending,
      progress: 0,
    };
    const listMissions = vi.fn().mockResolvedValue({ ok: true, board: board([]), items: [] });
    const listRuntimeMissions = vi.fn().mockResolvedValue({ ok: true, missions: [] });
    const readySubTasks = vi.fn().mockResolvedValue({ ok: true, subTasks: [readyTask] });
    const updateMission = vi.fn();
    const syncMissions = vi.fn();
    const runNextMission = vi.fn();

    (
      window as unknown as {
        electronAPI?: {
          companion: {
            listMissions: typeof listMissions;
            runNextMission: typeof runNextMission;
            syncMissions: typeof syncMissions;
            updateMission: typeof updateMission;
          };
          missions: {
            list: typeof listRuntimeMissions;
            readySubTasks: typeof readySubTasks;
          };
        };
      }
    ).electronAPI = {
      companion: { listMissions, runNextMission, syncMissions, updateMission },
      missions: { list: listRuntimeMissions, readySubTasks },
    };

    useAppStore.setState({
      missionRuntime: { [liveMission.id]: liveMission },
    });

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(MissionBoardPanel, { onClose: () => {} }));
      await flush();
    });

    const readyButton = target.querySelector('[data-testid="mission-runtime-ready-runtime-1"]') as HTMLButtonElement;
    await act(async () => {
      Simulate.click(readyButton);
      await flush();
    });

    expect(readySubTasks).toHaveBeenCalledWith('runtime-1');
    expect(target.querySelector('[data-testid="mission-runtime-ready-list-runtime-1"]')?.textContent).toContain(
      'pending Wire UI'
    );
  });
});
