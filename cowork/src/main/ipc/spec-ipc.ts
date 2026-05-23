/**
 * Spec pipeline IPC (BMAD-inspired review-gated backlog, surfaced in Cowork).
 *
 * Wraps the core `getSpecStore(workDir)` singleton (`src/spec/spec-store.ts`).
 * Spec projects/epics/stories live under `<workDir>/.codebuddy/specs/` and are
 * SEPARATE from Cowork's own project list — a spec project is a unit of
 * planned work inside the active Cowork project's repo.
 *
 * The store enforces a small transition machine (`SpecTransitionError` on
 * illegal moves), and gates: approve needs a reviewer, complete needs evidence,
 * block needs a reason, `done` is terminal. Those errors flow back as
 * `{ ok:false, error }` so the renderer shows a readable message, never a crash.
 *
 * @module main/ipc/spec-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import { resolveWorkDir, errorMessage, type ProjectManagerSource } from './ipc-workdir';

export type SpecStoryStatus = 'draft' | 'approved' | 'in_progress' | 'done' | 'blocked';
export type SpecPhase = 'prd' | 'architecture' | 'sharding' | 'implementation';

export interface SpecStory {
  id: string;
  projectId: string;
  epicId?: string;
  title: string;
  status: SpecStoryStatus;
  narrative: string;
  acceptanceCriteria: string[];
  reviewedBy?: string;
  evidence?: string;
  blockedReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpecProject {
  id: string;
  title: string;
  phase: SpecPhase;
  createdAt: number;
  updatedAt: number;
}

export interface SpecEpic {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  createdAt: number;
}

interface AddStoryInput {
  title: string;
  epicId?: string;
  narrative?: string;
  acceptanceCriteria?: string[];
}

interface SprintStatus {
  projectId: string;
  title: string;
  phase: SpecPhase;
  total: number;
  byStatus: Record<SpecStoryStatus, number>;
  stories: Array<Pick<SpecStory, 'id' | 'title' | 'status' | 'epicId'>>;
}

interface SpecStoreLike {
  createProject(title: string, phase?: SpecPhase): SpecProject;
  listProjects(): SpecProject[];
  getProject(projectId: string): SpecProject | null;
  getActiveProjectId(): string | null;
  addEpic(projectId: string, input: { title: string; summary?: string }): SpecEpic;
  listEpics(projectId: string): SpecEpic[];
  addStory(projectId: string, input: AddStoryInput): SpecStory;
  getStory(projectId: string, storyId: string): SpecStory | null;
  listStories(projectId: string, status?: SpecStoryStatus): SpecStory[];
  approveStory(projectId: string, storyId: string, reviewedBy: string): SpecStory;
  startStory(projectId: string, storyId: string): SpecStory;
  completeStory(projectId: string, storyId: string, evidence: string): SpecStory;
  blockStory(projectId: string, storyId: string, reason: string): SpecStory;
  reopenStory(projectId: string, storyId: string): SpecStory;
  getSprintStatus(projectId: string): SprintStatus;
}

type SpecMod = {
  getSpecStore: (workDir?: string) => SpecStoreLike;
};

const NO_PROJECT = 'NO_ACTIVE_PROJECT';

async function getStore(
  source: ProjectManagerSource,
  projectId?: string,
): Promise<{ store: SpecStoreLike | null; reason?: string }> {
  const workDir = resolveWorkDir(source, projectId);
  if (!workDir) return { store: null, reason: NO_PROJECT };
  const mod = await loadCoreModule<SpecMod>('spec/spec-store.js');
  if (!mod?.getSpecStore) {
    return { store: null, reason: 'core spec-store module unavailable' };
  }
  return { store: mod.getSpecStore(workDir) };
}

/** Run a store operation behind the resolve + envelope boilerplate. */
async function withStore<T>(
  source: ProjectManagerSource,
  coworkProjectId: string | undefined,
  fn: (store: SpecStoreLike) => T,
  key: string,
): Promise<{ ok: true; value: T } | { ok: false; error?: string }> {
  const { store, reason } = await getStore(source, coworkProjectId);
  if (!store) return { ok: false as const, error: reason };
  try {
    return { ok: true as const, value: fn(store) };
  } catch (err) {
    logError(`[${key}] failed:`, err);
    return { ok: false as const, error: errorMessage(err) };
  }
}

export function registerSpecIpcHandlers(projectManagerSource: ProjectManagerSource): void {
  // `coworkProjectId` (optional, last arg) selects the Cowork project whose repo
  // hosts `.codebuddy/specs/`. `specProjectId` is a spec project inside it.
  ipcMain.handle('spec.listProjects', async (_e, coworkProjectId?: string) => {
    const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.listProjects(), 'spec.listProjects');
    return r.ok ? { ok: true as const, projects: r.value } : { ...r, projects: [] as SpecProject[] };
  });

  ipcMain.handle('spec.createProject', async (_e, title: string, coworkProjectId?: string) => {
    const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.createProject(title), 'spec.createProject');
    return r.ok ? { ok: true as const, project: r.value } : r;
  });

  ipcMain.handle('spec.sprintStatus', async (_e, specProjectId?: string, coworkProjectId?: string) => {
    const r = await withStore(
      projectManagerSource,
      coworkProjectId,
      (s) => {
        const id = specProjectId ?? s.getActiveProjectId();
        return id ? s.getSprintStatus(id) : null;
      },
      'spec.sprintStatus',
    );
    return r.ok ? { ok: true as const, status: r.value } : r;
  });

  ipcMain.handle(
    'spec.listStories',
    async (_e, specProjectId: string, status?: SpecStoryStatus, coworkProjectId?: string) => {
      const r = await withStore(
        projectManagerSource,
        coworkProjectId,
        (s) => s.listStories(specProjectId, status),
        'spec.listStories',
      );
      return r.ok ? { ok: true as const, stories: r.value } : { ...r, stories: [] as SpecStory[] };
    },
  );

  ipcMain.handle('spec.getStory', async (_e, specProjectId: string, storyId: string, coworkProjectId?: string) => {
    const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.getStory(specProjectId, storyId), 'spec.getStory');
    return r.ok ? { ok: true as const, story: r.value } : r;
  });

  ipcMain.handle(
    'spec.addStory',
    async (_e, specProjectId: string, input: AddStoryInput, coworkProjectId?: string) => {
      const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.addStory(specProjectId, input), 'spec.addStory');
      return r.ok ? { ok: true as const, story: r.value } : r;
    },
  );

  ipcMain.handle(
    'spec.approveStory',
    async (_e, specProjectId: string, storyId: string, reviewedBy: string, coworkProjectId?: string) => {
      if (!reviewedBy?.trim()) return { ok: false as const, error: 'reviewedBy is required to approve a story.' };
      const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.approveStory(specProjectId, storyId, reviewedBy), 'spec.approveStory');
      return r.ok ? { ok: true as const, story: r.value } : r;
    },
  );

  ipcMain.handle('spec.startStory', async (_e, specProjectId: string, storyId: string, coworkProjectId?: string) => {
    const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.startStory(specProjectId, storyId), 'spec.startStory');
    return r.ok ? { ok: true as const, story: r.value } : r;
  });

  ipcMain.handle(
    'spec.completeStory',
    async (_e, specProjectId: string, storyId: string, evidence: string, coworkProjectId?: string) => {
      if (!evidence?.trim()) return { ok: false as const, error: 'evidence is required to complete a story.' };
      const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.completeStory(specProjectId, storyId, evidence), 'spec.completeStory');
      return r.ok ? { ok: true as const, story: r.value } : r;
    },
  );

  ipcMain.handle(
    'spec.blockStory',
    async (_e, specProjectId: string, storyId: string, reason: string, coworkProjectId?: string) => {
      if (!reason?.trim()) return { ok: false as const, error: 'a reason is required to block a story.' };
      const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.blockStory(specProjectId, storyId, reason), 'spec.blockStory');
      return r.ok ? { ok: true as const, story: r.value } : r;
    },
  );

  ipcMain.handle('spec.reopenStory', async (_e, specProjectId: string, storyId: string, coworkProjectId?: string) => {
    const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.reopenStory(specProjectId, storyId), 'spec.reopenStory');
    return r.ok ? { ok: true as const, story: r.value } : r;
  });

  ipcMain.handle('spec.listEpics', async (_e, specProjectId: string, coworkProjectId?: string) => {
    const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.listEpics(specProjectId), 'spec.listEpics');
    return r.ok ? { ok: true as const, epics: r.value } : { ...r, epics: [] as SpecEpic[] };
  });

  ipcMain.handle(
    'spec.addEpic',
    async (_e, specProjectId: string, input: { title: string; summary?: string }, coworkProjectId?: string) => {
      const r = await withStore(projectManagerSource, coworkProjectId, (s) => s.addEpic(specProjectId, input), 'spec.addEpic');
      return r.ok ? { ok: true as const, epic: r.value } : r;
    },
  );
}
