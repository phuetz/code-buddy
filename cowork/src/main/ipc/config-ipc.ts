/**
 * Main configuration IPC surface.
 *
 * Runtime-owned services are injected as accessors because they are assigned
 * after IPC registration during Electron boot. Raw configuration is used only
 * inside the main process; every configuration object returned or pushed to
 * the renderer comes from `getAllRedacted()`.
 */
import { dialog, ipcMain } from 'electron';
import type {
  ApiTestInput,
  ApiTestResult,
  DiagnosticInput,
  ProviderModelInfo,
  ServerEvent,
} from '../../renderer/types';
import type {
  ConfigExportBundle,
  ConfigExportService,
} from '../config/config-export-service';
import {
  configStore,
  getPiAiModelPresets,
  type AppConfig,
  type CreateConfigSetPayload,
} from '../config/config-store';
import { runConfigApiTest } from '../config/config-test-routing';
import { resolveEngineRuntimeConfig } from '../config/engine-runtime-config';
import { listLmStudioModels } from '../config/lmstudio-api';
import { listOllamaModels } from '../config/ollama-api';
import type { EngineAdapterLike, SessionManager } from '../session/session-manager';
import { loadCoreModule } from '../utils/core-loader';
import { log, logError } from '../utils/logger';

export interface ConfigIpcDeps {
  getEngineAdapter: () => EngineAdapterLike | null | undefined;
  getSessionManager: () => SessionManager | null;
  getCurrentWorkingDir: () => string | null;
  getConfigExportService: () => ConfigExportService | null;
  sendToRenderer: (event: ServerEvent) => void;
}

const buildAgentRuntimeSignature = (config: AppConfig): string =>
  JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    enableThinking: config.enableThinking,
  });

export function registerConfigIpcHandlers(deps: ConfigIpcDeps): void {
  const {
    getEngineAdapter,
    getSessionManager,
    getCurrentWorkingDir,
    getConfigExportService,
    sendToRenderer,
  } = deps;

  const syncConfigAfterMutation = async (previousConfig: AppConfig): Promise<AppConfig> => {
    configStore.set('isConfigured', configStore.hasAnyUsableCredentials());
    configStore.applyToEnv();

    const updatedConfig = configStore.getAll();
    const shouldReloadRunner =
      buildAgentRuntimeSignature(previousConfig) !== buildAgentRuntimeSignature(updatedConfig);
    const shouldReloadSandbox = previousConfig.sandboxEnabled !== updatedConfig.sandboxEnabled;
    const engineAdapter = getEngineAdapter();

    if (shouldReloadRunner && engineAdapter?.updateConfig) {
      const runtimeConfig = resolveEngineRuntimeConfig(updatedConfig);
      engineAdapter.updateConfig({
        apiKey: runtimeConfig.apiKey || process.env.GROK_API_KEY || '',
        baseURL: runtimeConfig.baseURL || process.env.GROK_BASE_URL,
        model: runtimeConfig.model,
        workingDirectory: getCurrentWorkingDir() || process.cwd(),
      });
    }

    if (
      previousConfig.thinkingLevel !== updatedConfig.thinkingLevel &&
      engineAdapter?.setThinkingLevel
    ) {
      await engineAdapter
        .setThinkingLevel(updatedConfig.thinkingLevel)
        .catch((error) => logError('[Config] thinkingLevel hot-swap failed:', error));
    }

    const sessionManager = getSessionManager();
    if (sessionManager) {
      if (shouldReloadRunner) {
        sessionManager.reloadConfig();
      }
      if (shouldReloadSandbox) {
        await sessionManager
          .reloadSandbox()
          .catch((error) => logError('[Config] Sandbox reload failed:', error));
      }
      if (shouldReloadRunner || shouldReloadSandbox) {
        log(
          '[Config] Session manager config synced:',
          JSON.stringify({
            runnerReloaded: shouldReloadRunner,
            sandboxReloaded: shouldReloadSandbox,
          })
        );
      }
    }

    const isConfigured = configStore.isConfigured();
    const redactedConfig = configStore.getAllRedacted();
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: redactedConfig,
      },
    });
    log('[Config] Notified renderer of config update, isConfigured:', isConfigured);
    return redactedConfig;
  };

  ipcMain.handle('config.get', () => {
    try {
      return configStore.getAllRedacted();
    } catch (error) {
      logError('[Config] Error getting config:', error);
      return {};
    }
  });

  ipcMain.handle('config.getPresets', () => {
    try {
      return getPiAiModelPresets();
    } catch (error) {
      logError('[Config] Error getting presets:', error);
      return [];
    }
  });

  ipcMain.handle('config.save', async (_event, newConfig: Partial<AppConfig>) => {
    log('[Config] Saving config fields:', Object.keys(newConfig));
    const previousConfig = configStore.getAll();
    configStore.update(newConfig);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.createSet', async (_event, payload: CreateConfigSetPayload) => {
    log('[Config] Creating config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.createSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.renameSet', async (_event, payload: { id: string; name: string }) => {
    log('[Config] Renaming config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.renameSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.deleteSet', async (_event, payload: { id: string }) => {
    log('[Config] Deleting config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.deleteSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.switchSet', async (_event, payload: { id: string }) => {
    log('[Config] Switching config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.switchSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.isConfigured', () => {
    try {
      return configStore.isConfigured();
    } catch (error) {
      logError('[Config] Error checking configured status:', error);
      return false;
    }
  });

  ipcMain.handle('config.test', async (_event, payload: ApiTestInput): Promise<ApiTestResult> => {
    try {
      return await runConfigApiTest(payload, configStore.getAll());
    } catch (error) {
      logError('[Config] API test failed:', error);
      return {
        ok: false,
        errorType: 'unknown',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    'config.listModels',
    async (
      _event,
      payload: { provider: AppConfig['provider']; apiKey?: string; baseUrl?: string }
    ): Promise<ProviderModelInfo[]> => {
      if (payload.provider === 'ollama') {
        return listOllamaModels(payload);
      }
      if (payload.provider === 'lmstudio') {
        return listLmStudioModels(payload);
      }
      return [];
    }
  );

  ipcMain.handle('config.diagnose', async (_event, payload: DiagnosticInput) => {
    try {
      const { runDiagnostics } = await import('../config/api-diagnostics');
      const storedConfig = configStore.getAll();
      return await runDiagnostics({
        ...payload,
        apiKey: payload.apiKey?.trim() || storedConfig.apiKey,
      });
    } catch (error) {
      logError('[Config] Error running diagnostics:', error);
      throw error;
    }
  });

  ipcMain.handle('config.discover-local', async (_event, payload?: { baseUrl?: string }) => {
    try {
      const { discoverLocalOllama } = await import('../config/api-diagnostics');
      return await discoverLocalOllama(payload);
    } catch (error) {
      logError('[Config] Error discovering local services:', error);
      return [];
    }
  });

  ipcMain.handle(
    'config.discover-lmstudio-local',
    async (_event, payload?: { baseUrl?: string }) => {
      try {
        const { discoverLocalLmStudio } = await import('../config/api-diagnostics');
        return await discoverLocalLmStudio(payload);
      } catch (error) {
        logError('[Config] Error discovering local LM Studio:', error);
        return {
          available: false,
          baseUrl: payload?.baseUrl || 'http://localhost:1234/v1',
          status: 'unavailable',
        };
      }
    }
  );

  ipcMain.handle(
    'config.model-inventory',
    async (_event, payload?: { includeTailnetPeers?: boolean }) => {
      try {
        const mod = await loadCoreModule<
          typeof import('@codebuddy/fleet/model-inventory.js')
        >('fleet/model-inventory.js');
        if (!mod) {
          return { updatedAt: new Date().toISOString(), machineLabel: '', entries: [] };
        }
        return await mod.buildModelInventory({
          includeTailnetPeers: payload?.includeTailnetPeers ?? true,
          forceCapabilityRefresh: true,
        });
      } catch (error) {
        logError('[Config] Error building model inventory:', error);
        return {
          updatedAt: new Date().toISOString(),
          machineLabel: '',
          entries: [],
        };
      }
    }
  );

  ipcMain.handle('config.export', async () => {
    const configExportService = getConfigExportService();
    if (!configExportService) {
      return { success: false, error: 'Export service unavailable' };
    }
    try {
      const bundle = configExportService.exportBundle();
      return { success: true, bundle };
    } catch (error) {
      logError('[config.export] failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('config.exportToFile', async () => {
    const configExportService = getConfigExportService();
    if (!configExportService) {
      return { success: false, error: 'Export service unavailable' };
    }
    const dialogResult = await dialog.showSaveDialog({
      title: 'Export settings',
      defaultPath: `cowork-settings-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, error: 'Cancelled' };
    }
    return configExportService.saveToFile(dialogResult.filePath);
  });

  ipcMain.handle('config.importFromFile', async () => {
    const configExportService = getConfigExportService();
    if (!configExportService) {
      return { success: false, error: 'Export service unavailable' };
    }
    const dialogResult = await dialog.showOpenDialog({
      title: 'Import settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
      return { success: false, error: 'Cancelled' };
    }
    const loaded = configExportService.loadFromFile(dialogResult.filePaths[0]);
    if (!loaded.success || !loaded.bundle) {
      return { success: false, error: loaded.error };
    }
    const preview = configExportService.diffBundle(loaded.bundle);
    return { success: true, preview };
  });

  ipcMain.handle(
    'config.applyImport',
    async (_event, bundle: Record<string, unknown>, strategy: 'skip' | 'overwrite') => {
      const configExportService = getConfigExportService();
      if (!configExportService) {
        return {
          success: false,
          imported: { projects: 0, mcpServers: 0, apiUpdated: false },
          errors: ['Export service unavailable'],
        };
      }
      return configExportService.importBundle(bundle as unknown as ConfigExportBundle, strategy);
    }
  );
}
