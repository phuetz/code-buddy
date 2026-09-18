/**
 * IPC for the Cowork folder-instructions panel. Resolves the working
 * directory (explicit cwd, else active project workspace) and delegates
 * to the kernel-backed inspector via `loadCoreModule`.
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import { errorMessage, resolveWorkDir, type ProjectManagerSource } from './ipc-workdir';
import {
  DEFAULT_STARTUP_INSTRUCTION_FILES,
  confineFolderInstructionCwd,
  inspectFolderInstructions,
  readFolderInstructionFile,
  writeFolderInstructionFile,
  type FolderInstructionKernel,
} from '../project/folder-instructions';

const NO_FOLDER = 'NO_WORKING_FOLDER';

interface ProjectContextMod {
  findProjectRoot: (cwd: string) => string | null;
  getAcceptedFileNames: (projectRoot?: string) => string[];
  resolveProjectContext: FolderInstructionKernel['resolveProjectContext'];
  STARTUP_PROJECT_CONTEXT_FILES?: readonly string[];
}

interface InstructionExcludesMod {
  clearContextConfigCache: () => void;
  clearExcludesCache: () => void;
}

async function loadKernel(): Promise<FolderInstructionKernel> {
  const context = await loadCoreModule<ProjectContextMod>('context/project-context.js');
  const excludes = await loadCoreModule<InstructionExcludesMod>('context/instruction-excludes.js');
  if (!context?.resolveProjectContext) {
    throw new Error('core project-context module unavailable');
  }
  return {
    findProjectRoot: context.findProjectRoot,
    getAcceptedFileNames: context.getAcceptedFileNames,
    resolveProjectContext: context.resolveProjectContext,
    startupFileNames: context.STARTUP_PROJECT_CONTEXT_FILES ?? DEFAULT_STARTUP_INSTRUCTION_FILES,
    clearCaches: () => {
      excludes?.clearContextConfigCache?.();
      excludes?.clearExcludesCache?.();
    },
  };
}

function resolveCwd(source: ProjectManagerSource, cwd?: string, projectId?: string): string | null {
  const workspacePath = resolveWorkDir(source, projectId);
  return confineFolderInstructionCwd(cwd, workspacePath);
}

export function registerFolderInstructionsIpcHandlers(projectManagerSource: ProjectManagerSource): void {
  ipcMain.handle(
    'folderInstructions.inspect',
    async (_e, input?: { cwd?: string; projectId?: string }) => {
      const cwd = resolveCwd(projectManagerSource, input?.cwd, input?.projectId);
      if (!cwd) return { ok: false as const, error: NO_FOLDER };
      try {
        const kernel = await loadKernel();
        return { ok: true as const, snapshot: inspectFolderInstructions({ cwd, kernel }) };
      } catch (err) {
        logError('[folderInstructions.inspect] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'folderInstructions.read',
    async (_e, input: { cwd?: string; projectId?: string; fileName: string }) => {
      const cwd = resolveCwd(projectManagerSource, input?.cwd, input?.projectId);
      if (!cwd) return { ok: false as const, error: NO_FOLDER };
      try {
        return { ok: true as const, file: readFolderInstructionFile(cwd, input.fileName) };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'folderInstructions.save',
    async (_e, input: { cwd?: string; projectId?: string; fileName: string; content: string }) => {
      const cwd = resolveCwd(projectManagerSource, input?.cwd, input?.projectId);
      if (!cwd) return { ok: false as const, error: NO_FOLDER };
      try {
        const file = writeFolderInstructionFile(
          cwd,
          input.fileName,
          typeof input.content === 'string' ? input.content : '',
        );
        const kernel = await loadKernel();
        const snapshot = inspectFolderInstructions({ cwd, kernel });
        return { ok: true as const, file, snapshot };
      } catch (err) {
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );
}
