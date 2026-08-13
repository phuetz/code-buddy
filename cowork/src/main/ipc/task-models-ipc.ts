/**
 * `taskModels.*` IPC — editable `[task_models]` settings backed directly by
 * the root core. No HTTP bridge is involved; the core module owns validation,
 * model discovery, compatibility with `[model_pairs]`, and atomic persistence.
 * Every handler is never-throw for Electron main-process safety.
 */

import { ipcMain } from 'electron';
import type {
  TaskModelSaveMappings,
  TaskModelSettingsResult,
  TaskModelSettingsView,
} from '../../shared/task-models-types';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';

interface TaskModelsCoreModule {
  readTaskModelSettings: (configPath?: string) => TaskModelSettingsView;
  saveTaskModelSettings: (
    mappings: unknown,
    configPath?: string,
  ) => TaskModelSettingsView;
}

async function loadTaskModelsCore(): Promise<TaskModelsCoreModule | null> {
  return loadCoreModule<TaskModelsCoreModule>('config/task-models.js');
}

function failure(error: unknown): TaskModelSettingsResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    settings: null,
  };
}

export function registerTaskModelsIpcHandlers(): void {
  ipcMain.handle(
    'taskModels.get',
    async (_event, opts?: { configPath?: string }): Promise<TaskModelSettingsResult> => {
      try {
        const core = await loadTaskModelsCore();
        if (!core) return failure('task model core unavailable');
        return { ok: true, settings: core.readTaskModelSettings(opts?.configPath) };
      } catch (error) {
        logError('[taskModels.get] failed:', error);
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    'taskModels.save',
    async (
      _event,
      mappings: TaskModelSaveMappings,
      opts?: { configPath?: string },
    ): Promise<TaskModelSettingsResult> => {
      try {
        const core = await loadTaskModelsCore();
        if (!core) return failure('task model core unavailable');
        return {
          ok: true,
          settings: core.saveTaskModelSettings(mappings, opts?.configPath),
        };
      } catch (error) {
        logError('[taskModels.save] failed:', error);
        return failure(error);
      }
    },
  );
}
