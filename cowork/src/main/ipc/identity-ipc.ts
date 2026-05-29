/**
 * Identity IPC (C3) — manage agent identity files (SOUL.md, USER.md, …) from
 * Cowork. Wraps the core `getIdentityManager()` (`src/identity/identity-manager.ts`),
 * scoped to the active project's workspace. Read + write of project `.codebuddy/`
 * markdown identity files. Registered with a getter (see command-ipc.ts) — the
 * project source resolves lazily.
 *
 * @module main/ipc/identity-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import { resolveWorkDir, errorMessage, type ProjectManagerSource } from './ipc-workdir';

export interface IdentityFileDTO {
  name: string;
  content: string;
  source: 'project' | 'global';
  path: string;
  lastModified: number;
}

interface IdentityFile {
  name: string;
  content: string;
  source: 'project' | 'global';
  path: string;
  lastModified: Date;
}

interface IdentityManagerLike {
  load(cwd: string): Promise<IdentityFile[]>;
  getAll(): IdentityFile[];
  get(name: string): IdentityFile | undefined;
  set(name: string, content: string): Promise<void>;
}

type IdentityMod = { getIdentityManager: () => IdentityManagerLike };

const NO_PROJECT = 'NO_ACTIVE_PROJECT';

function toDTO(f: IdentityFile): IdentityFileDTO {
  return {
    name: f.name,
    content: f.content,
    source: f.source,
    path: f.path,
    lastModified: f.lastModified instanceof Date ? f.lastModified.getTime() : Date.now(),
  };
}

async function loadManager(
  source: ProjectManagerSource,
  projectId?: string,
): Promise<{ mgr: IdentityManagerLike | null; reason?: string }> {
  const workDir = resolveWorkDir(source, projectId);
  if (!workDir) return { mgr: null, reason: NO_PROJECT };
  const mod = await loadCoreModule<IdentityMod>('identity/identity-manager.js');
  if (!mod?.getIdentityManager) return { mgr: null, reason: 'core identity module unavailable' };
  const mgr = mod.getIdentityManager();
  await mgr.load(workDir); // sets cwd + reads project/global files
  return { mgr };
}

export function registerIdentityIpcHandlers(projectManagerSource: ProjectManagerSource): void {
  ipcMain.handle('identityFiles.list', async (_e, projectId?: string) => {
    const { mgr, reason } = await loadManager(projectManagerSource, projectId);
    if (!mgr) return { ok: false as const, error: reason, items: [] as IdentityFileDTO[] };
    try {
      return { ok: true as const, items: mgr.getAll().map(toDTO) };
    } catch (err) {
      logError('[identity.list] failed:', err);
      return { ok: false as const, error: errorMessage(err), items: [] as IdentityFileDTO[] };
    }
  });

  ipcMain.handle('identityFiles.get', async (_e, name: string, projectId?: string) => {
    const { mgr, reason } = await loadManager(projectManagerSource, projectId);
    if (!mgr) return { ok: false as const, error: reason };
    const file = mgr.get(name);
    return { ok: true as const, file: file ? toDTO(file) : null };
  });

  // Writes to the project `.codebuddy/<name>`. Only the explicit identity file
  // names the manager knows are accepted (defends against path injection).
  ipcMain.handle('identityFiles.set', async (_e, name: string, content: string, projectId?: string) => {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+\.md$/.test(name)) {
      return { ok: false as const, error: 'Invalid identity file name (expected e.g. SOUL.md).' };
    }
    const { mgr, reason } = await loadManager(projectManagerSource, projectId);
    if (!mgr) return { ok: false as const, error: reason };
    try {
      await mgr.set(name, typeof content === 'string' ? content : '');
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
  });
}
