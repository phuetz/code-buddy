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

const coreLoaderMock = vi.hoisted(() => ({ loadCoreModule: vi.fn(), resolveCoreEntry: vi.fn() }));

vi.mock('electron', () => ({ ipcMain: { handle: electronMock.handle } }));
vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: coreLoaderMock.loadCoreModule,
  resolveCoreEntry: coreLoaderMock.resolveCoreEntry,
}));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

import { registerLessonCandidateIpcHandlers } from '../src/main/ipc/lessons-candidate-ipc';
import { registerUserModelIpcHandlers } from '../src/main/ipc/user-model-ipc';
import { registerCompanionIpcHandlers } from '../src/main/ipc/companion-ipc';
import { registerSpecIpcHandlers } from '../src/main/ipc/spec-ipc';
import { registerSpecNextIpcHandlers, buildSpecNextArgs } from '../src/main/ipc/spec-next-ipc';

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
  coreLoaderMock.resolveCoreEntry.mockReset();
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

describe('companion IPC', () => {
  it('loads companion status from the active project workspace', async () => {
    const getCompanionStatus = vi.fn(async () => ({ cwd: '/tmp/proj', model: 'gpt-5.5' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ getCompanionStatus });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.status');
    const res = (await handler?.({})) as { ok: boolean; status?: { model: string } };
    expect(res.ok).toBe(true);
    expect(res.status?.model).toBe('gpt-5.5');
    expect(getCompanionStatus).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('returns recent percepts from the active project journal', async () => {
    const readRecentCompanionPercepts = vi.fn(async () => [
      { id: 'p1', modality: 'vision', source: 'camera_snapshot' },
    ]);
    coreLoaderMock.loadCoreModule.mockResolvedValue({ readRecentCompanionPercepts });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.percepts.recent');
    const res = (await handler?.({}, { limit: 5, modality: 'vision' })) as { ok: boolean; items: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(readRecentCompanionPercepts).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      limit: 5,
      modality: 'vision',
    });
  });

  it('records companion self-state through the core module', async () => {
    const recordCompanionSelfState = vi.fn(async () => ({ id: 'self-1', modality: 'self' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ recordCompanionSelfState });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.self.record');
    const res = (await handler?.({})) as { ok: boolean; percept?: { id: string } };
    expect(res.ok).toBe(true);
    expect(res.percept?.id).toBe('self-1');
    expect(recordCompanionSelfState).toHaveBeenCalledWith({ cwd: '/tmp/proj' });
  });

  it('runs companion self-evaluation in the active workspace', async () => {
    const evaluateCompanionSelf = vi.fn(async () => ({ id: 'companion-eval-1', score: 80 }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ evaluateCompanionSelf });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.evaluate');
    const res = (await handler?.({}, { recordSuggestions: false })) as {
      ok: boolean;
      evaluation?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.evaluation?.id).toBe('companion-eval-1');
    expect(evaluateCompanionSelf).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      recordSuggestions: false,
    });
  });

  it('builds the companion competitive radar in the active workspace', async () => {
    const buildCompanionCompetitiveRadar = vi.fn(async () => ({ id: 'companion-radar-1', score: 70 }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ buildCompanionCompetitiveRadar });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.radar');
    const res = (await handler?.({}, { recordSuggestions: false })) as {
      ok: boolean;
      radar?: { id: string };
    };
    expect(res.ok).toBe(true);
    expect(res.radar?.id).toBe('companion-radar-1');
    expect(buildCompanionCompetitiveRadar).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      recordSuggestions: false,
    });
  });

  it('captures camera snapshots in the active workspace', async () => {
    const captureCameraSnapshot = vi.fn(async () => ({ success: true, path: '/tmp/proj/.codebuddy/camera/scene.png' }));
    coreLoaderMock.loadCoreModule.mockResolvedValue({ captureCameraSnapshot });
    registerCompanionIpcHandlers(projectSource('/tmp/proj'));

    const handler = electronMock.handlers.get('companion.camera.snapshot');
    const res = (await handler?.({}, { timeoutMs: 5000 })) as { ok: boolean; result?: { path: string } };
    expect(res.ok).toBe(true);
    expect(res.result?.path).toContain('scene.png');
    expect(captureCameraSnapshot).toHaveBeenCalledWith({
      cwd: '/tmp/proj',
      outputPath: undefined,
      device: undefined,
      timeoutMs: 5000,
    });
  });

  it('returns NO_ACTIVE_PROJECT before loading core modules', async () => {
    registerCompanionIpcHandlers(projectSource(null));
    const handler = electronMock.handlers.get('companion.percepts.stats');
    await expect(handler?.({})).resolves.toEqual({ ok: false, error: 'NO_ACTIVE_PROJECT' });
    expect(coreLoaderMock.loadCoreModule).not.toHaveBeenCalled();
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

describe('spec plan IPC (agentic planning)', () => {
  const config = { getAll: () => ({ apiKey: 'k', model: 'm' }) };

  /** Dispatch loadCoreModule by path so plan handlers see store + client + runner. */
  function mockCore(parts: {
    store?: unknown;
    startSpecPlan?: (...a: unknown[]) => unknown;
    advanceSpecPlan?: (...a: unknown[]) => unknown;
  }) {
    class FakeClient {
      async chat() {
        return { choices: [{ message: { content: 'x' } }] };
      }
    }
    coreLoaderMock.loadCoreModule.mockImplementation((p: string) => {
      if (p === 'spec/spec-store.js') return Promise.resolve({ getSpecStore: () => parts.store ?? {} });
      if (p === 'codebuddy/client.js') return Promise.resolve({ CodeBuddyClient: FakeClient });
      if (p === 'spec/spec-plan-runner.js') {
        return Promise.resolve({ startSpecPlan: parts.startSpecPlan, advanceSpecPlan: parts.advanceSpecPlan });
      }
      return Promise.resolve(null);
    });
  }

  it('planStart drafts the PRD through the core runner', async () => {
    const startSpecPlan = vi.fn(async () => ({ projectId: 'sp-9', title: 'Radar' }));
    mockCore({ startSpecPlan });
    registerSpecIpcHandlers(projectSource('/tmp/proj'), config);

    const handler = electronMock.handlers.get('spec.planStart');
    const res = (await handler?.({}, 'build a radar app')) as { ok: boolean; projectId?: string };
    expect(res.ok).toBe(true);
    expect(res.projectId).toBe('sp-9');
    expect(startSpecPlan).toHaveBeenCalledTimes(1);
  });

  it('planStart fails with a readable error when no API key is configured', async () => {
    const startSpecPlan = vi.fn();
    mockCore({ startSpecPlan });
    registerSpecIpcHandlers(projectSource('/tmp/proj')); // no config source

    const handler = electronMock.handlers.get('spec.planStart');
    const res = (await handler?.({}, 'goal')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No API key/);
    expect(startSpecPlan).not.toHaveBeenCalled();
  });

  it('planContinue refuses without a reviewer (no silent advance)', async () => {
    const advanceSpecPlan = vi.fn();
    mockCore({ advanceSpecPlan });
    registerSpecIpcHandlers(projectSource('/tmp/proj'), config);

    const handler = electronMock.handlers.get('spec.planContinue');
    const res = (await handler?.({}, 'sp-1', '   ')) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reviewer/);
    expect(advanceSpecPlan).not.toHaveBeenCalled();
  });

  it('planContinue advances one phase and returns the result', async () => {
    const advanceSpecPlan = vi.fn(async () => ({ phase: 'architecture', produced: 'architecture' }));
    mockCore({ advanceSpecPlan });
    registerSpecIpcHandlers(projectSource('/tmp/proj'), config);

    const handler = electronMock.handlers.get('spec.planContinue');
    const res = (await handler?.({}, 'sp-1', 'Patrice')) as {
      ok: boolean;
      result?: { phase: string; produced?: string };
    };
    expect(res.ok).toBe(true);
    expect(res.result?.phase).toBe('architecture');
    expect(advanceSpecPlan).toHaveBeenCalledWith(expect.anything(), expect.any(Function), 'sp-1', 'Patrice');
  });

  it('planStatus reports phase + artifact presence', async () => {
    const store = {
      getProject: () => ({ id: 'sp-1', phase: 'prd', planApprovals: { prd: { by: 'r', at: 1 } } }),
      readArtifact: (_id: string, name: string) => (name === 'prd' ? '# PRD' : null),
      listStories: () => [{ id: 'st-1' }],
    };
    mockCore({ store });
    registerSpecIpcHandlers(projectSource('/tmp/proj'), config);

    const handler = electronMock.handlers.get('spec.planStatus');
    const res = (await handler?.({}, 'sp-1')) as {
      ok: boolean;
      status?: { phase: string; prd: boolean; architecture: boolean; stories: number };
    };
    expect(res.ok).toBe(true);
    expect(res.status).toMatchObject({ phase: 'prd', prd: true, architecture: false, stories: 1 });
  });
});

describe('spec.next IPC (autonomous runner bridge)', () => {
  it('buildSpecNextArgs maps options to CLI flags', () => {
    expect(buildSpecNextArgs({ storyId: 'st-1' })).toEqual(['spec', 'next', '--story', 'st-1']);
    expect(buildSpecNextArgs({ dryRun: true })).toEqual(['spec', 'next', '--dry-run']);
    expect(
      buildSpecNextArgs({ storyId: 'st-2', fleet: 'read-only-help', allowedPaths: ['src', ' '], verify: ['npm test'], runVerification: true }),
    ).toEqual(['spec', 'next', '--story', 'st-2', '--fleet', 'read-only-help', '--allowed-path', 'src', '--verify', 'npm test', '--run-verification']);
    // 'none' fleet is omitted
    expect(buildSpecNextArgs({ fleet: 'none' })).toEqual(['spec', 'next']);
  });

  it('returns NO_ACTIVE_PROJECT when no project is selected (never spawns)', async () => {
    coreLoaderMock.resolveCoreEntry.mockReturnValue('/core/dist/index.js');
    registerSpecNextIpcHandlers(projectSource(null));
    const handler = electronMock.handlers.get('spec.next');
    await expect(handler?.({}, { storyId: 'st-1' })).resolves.toEqual({ ok: false, error: 'NO_ACTIVE_PROJECT' });
  });

  it('fails with a readable error when the core CLI is not built', async () => {
    coreLoaderMock.resolveCoreEntry.mockReturnValue(null);
    registerSpecNextIpcHandlers(projectSource('/tmp/proj'));
    const handler = electronMock.handlers.get('spec.next');
    const res = (await handler?.({}, { storyId: 'st-1' })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not built/i);
  });
});
