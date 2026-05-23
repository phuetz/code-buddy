import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capturing ipcMain.handle (mirrors tests/fleet-ipc.test.ts).
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

const coreLoaderMock = vi.hoisted(() => ({ loadCoreModule: vi.fn() }));

vi.mock('electron', () => ({ ipcMain: { handle: electronMock.handle } }));
vi.mock('../src/main/utils/core-loader', () => ({ loadCoreModule: coreLoaderMock.loadCoreModule }));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

import { registerLessonCandidateIpcHandlers } from '../src/main/ipc/lessons-candidate-ipc';
import { registerUserModelIpcHandlers } from '../src/main/ipc/user-model-ipc';
import { registerSpecIpcHandlers } from '../src/main/ipc/spec-ipc';

// Project manager source: active project resolves to a workspace path; pass
// `null` to simulate "no active project" (empty-state path).
function projectSource(workspacePath: string | null) {
  if (workspacePath === null) return () => null;
  return () => ({
    getActiveId: () => 'p1',
    getActive: () => ({ id: 'p1', workspacePath }),
    get: (_id: string) => ({ id: 'p1', workspacePath }),
  }) as never;
}

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.handle.mockClear();
  coreLoaderMock.loadCoreModule.mockReset();
});

describe('lesson-candidate IPC', () => {
  it('lists candidates from the active project queue', async () => {
    const list = vi.fn(() => [{ id: 'lc-1', category: 'RULE', content: 'Run tsc', status: 'pending' }]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getLessonCandidateQueue: () => ({ list }) });
    registerLessonCandidateIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('lessonCandidate.list');
    const res = (await handler?.({}, 'pending')) as { ok: boolean; items: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(list).toHaveBeenCalledWith('pending');
  });

  it('returns NO_ACTIVE_PROJECT empty-state when no project is selected', async () => {
    registerLessonCandidateIpcHandlers(projectSource(null));
    const handler = electronMock.handlers.get('lessonCandidate.list');
    await expect(handler?.({})).resolves.toEqual({ ok: false, error: 'NO_ACTIVE_PROJECT', items: [] });
    // Core module is never even loaded without a workDir.
    expect(coreLoaderMock.loadCoreModule).not.toHaveBeenCalled();
  });

  it('refuses to approve without a reviewer (no silent write)', async () => {
    const approve = vi.fn();
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getLessonCandidateQueue: () => ({ approve }) });
    registerLessonCandidateIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('lessonCandidate.approve');
    const res = (await handler?.({}, 'lc-1', { reviewedBy: '   ' })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewedBy is required/);
    expect(approve).not.toHaveBeenCalled();
  });

  it('approves through the queue and returns the written lesson id', async () => {
    const approve = vi.fn(async () => ({ candidate: { id: 'lc-1', status: 'approved' }, lesson: { id: 'lesson-9' } }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getLessonCandidateQueue: () => ({ approve }) });
    registerLessonCandidateIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('lessonCandidate.approve');
    const res = (await handler?.({}, 'lc-1', { reviewedBy: 'Patrice', content: 'edited' })) as {
      ok: boolean;
      lessonId?: string;
    };
    expect(res.ok).toBe(true);
    expect(res.lessonId).toBe('lesson-9');
    expect(approve).toHaveBeenCalledWith('lc-1', { reviewedBy: 'Patrice', content: 'edited' });
  });
});

describe('user-model IPC', () => {
  it('refuses to accept without a reviewer', async () => {
    const accept = vi.fn();
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getUserModel: () => ({ accept }) });
    registerUserModelIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('userModel.accept');
    const res = (await handler?.({}, 'um-1', {})) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewedBy is required/);
    expect(accept).not.toHaveBeenCalled();
  });

  it('surfaces a privacy refusal as a clean error, not a crash', async () => {
    const accept = vi.fn(() => {
      throw new Error('refused: "salary" is outside the user-model privacy scope (working preferences only)');
    });
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getUserModel: () => ({ accept }) });
    registerUserModelIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('userModel.accept');
    const res = (await handler?.({}, 'um-1', { reviewedBy: 'Patrice' })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/outside the user-model privacy scope/);
  });

  it('lists observations for the active project', async () => {
    const list = vi.fn(() => [{ id: 'um-1', kind: 'preference', content: 'async/await', status: 'pending' }]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getUserModel: () => ({ list }) });
    registerUserModelIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('userModel.list');
    const res = (await handler?.({}, 'pending')) as { ok: boolean; items: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
  });
});

describe('spec IPC', () => {
  it('lists spec projects', async () => {
    const listProjects = vi.fn(() => [{ id: 'sp-1', title: 'Q2', phase: 'sharding' }]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getSpecStore: () => ({ listProjects }) });
    registerSpecIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('spec.listProjects');
    const res = (await handler?.({})) as { ok: boolean; projects: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.projects).toHaveLength(1);
  });

  it('refuses to approve a story without a reviewer', async () => {
    const approveStory = vi.fn();
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getSpecStore: () => ({ approveStory }) });
    registerSpecIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('spec.approveStory');
    const res = (await handler?.({}, 'sp-1', 'st-1', '  ')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewedBy is required/);
    expect(approveStory).not.toHaveBeenCalled();
  });

  it('surfaces an illegal transition error from the store', async () => {
    const completeStory = vi.fn(() => {
      throw new Error('Illegal transition draft → done for story st-1. Legal next states: approved, blocked.');
    });
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getSpecStore: () => ({ completeStory }) });
    registerSpecIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('spec.completeStory');
    const res = (await handler?.({}, 'sp-1', 'st-1', 'tests pass')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Illegal transition/);
  });

  it('returns NO_ACTIVE_PROJECT empty-state for stories when no project', async () => {
    registerSpecIpcHandlers(projectSource(null));
    const handler = electronMock.handlers.get('spec.listStories');
    await expect(handler?.({}, 'sp-1')).resolves.toEqual({ ok: false, error: 'NO_ACTIVE_PROJECT', stories: [] });
  });
});
