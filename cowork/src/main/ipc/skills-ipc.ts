import { ipcMain } from 'electron';
import * as path from 'path';
import { loadCoreModule } from '../utils/core-loader';
import { resolveWorkDir, type ProjectManagerSource } from './ipc-workdir';

interface HubConfig {
  registryUrl?: string;
  cacheDir?: string;
  skillsDir?: string;
  lockfilePath?: string;
  autoUpdate?: boolean;
  checkIntervalMs?: number;
}

type SkillsHubEntry = Record<string, unknown>;

interface SkillsHubModule {
  getSkillsHub(config?: Partial<HubConfig>): {
    list(): SkillsHubEntry[];
    listEnabled(): SkillsHubEntry[];
    setEnabled(
      name: string,
      enabled: boolean,
      options?: { path?: string; version?: string }
    ): unknown;
  };
}

export function registerSkillsHubIpcHandlers(projectManager: ProjectManagerSource) {
  function getHubConfig(projectId?: string) {
    const workDir = resolveWorkDir(projectManager, projectId);
    const config: Partial<HubConfig> = {};
    if (workDir) {
      config.lockfilePath = path.join(workDir, '.codebuddy', 'skills-lock.json');
      config.skillsDir = path.join(workDir, '.codebuddy', 'skills');
    }
    return config;
  }

  ipcMain.handle('skillsHub.list', async (_event, projectId?: string) => {
    try {
      const hubMod = await loadCoreModule<SkillsHubModule>('skills/hub.js');
      if (!hubMod) {
        throw new Error('Failed to load skills/hub.js');
      }
      const config = getHubConfig(projectId);
      return hubMod.getSkillsHub(config).list();
    } catch (err) {
      console.error('[skillsHub.list] Error loading SkillsHub:', err);
      return [];
    }
  });

  ipcMain.handle('skillsHub.listEnabled', async (_event, projectId?: string) => {
    try {
      const hubMod = await loadCoreModule<SkillsHubModule>('skills/hub.js');
      if (!hubMod) {
        throw new Error('Failed to load skills/hub.js');
      }
      const config = getHubConfig(projectId);
      return hubMod.getSkillsHub(config).listEnabled();
    } catch (err) {
      console.error('[skillsHub.listEnabled] Error loading SkillsHub:', err);
      return [];
    }
  });

  ipcMain.handle('skillsHub.setEnabled', async (_event, name: string, enabled: boolean, projectId?: string, filePath?: string) => {
    try {
      const hubMod = await loadCoreModule<SkillsHubModule>('skills/hub.js');
      if (!hubMod) {
        throw new Error('Failed to load skills/hub.js');
      }
      const config = getHubConfig(projectId);
      return hubMod.getSkillsHub(config).setEnabled(name, enabled, { path: filePath });
    } catch (err) {
      console.error('[skillsHub.setEnabled] Error loading SkillsHub:', err);
      return null;
    }
  });
}
