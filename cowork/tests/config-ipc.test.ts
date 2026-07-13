// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  };
});

const configMock = vi.hoisted(() => {
  const rawConfig = {
    provider: 'openai',
    apiKey: 'sk-main-secret',
    baseUrl: 'https://api.openai.com/v1',
    customProtocol: 'openai',
    model: 'gpt-old',
    enableThinking: false,
    thinkingLevel: 'medium',
    sandboxEnabled: false,
  };
  const redactedConfig = {
    ...rawConfig,
    apiKey: '',
    hasKey: true,
    keyTail: 'cret',
    profiles: {
      openai: {
        apiKey: '',
        hasKey: true,
        keyTail: 'cret',
        model: 'gpt-old',
      },
    },
    configSets: [],
  };
  return {
    rawConfig,
    redactedConfig,
    getPresets: vi.fn(() => [{ id: 'openai:gpt' }]),
    store: {
      getAll: vi.fn(() => rawConfig),
      getAllRedacted: vi.fn(() => redactedConfig),
      set: vi.fn(),
      hasAnyUsableCredentials: vi.fn(() => true),
      applyToEnv: vi.fn(),
      isConfigured: vi.fn(() => true),
      update: vi.fn(),
      createSet: vi.fn(),
      renameSet: vi.fn(),
      deleteSet: vi.fn(),
      switchSet: vi.fn(),
    },
  };
});

const serviceMock = vi.hoisted(() => ({
  runConfigApiTest: vi.fn(),
  resolveEngineRuntimeConfig: vi.fn(),
  listOllamaModels: vi.fn(),
  listLmStudioModels: vi.fn(),
  loadCoreModule: vi.fn(),
  runDiagnostics: vi.fn(),
  discoverLocalOllama: vi.fn(),
  discoverLocalLmStudio: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: electronMock.handle },
  dialog: {
    showSaveDialog: electronMock.showSaveDialog,
    showOpenDialog: electronMock.showOpenDialog,
  },
}));

vi.mock('../src/main/config/config-store', () => ({
  configStore: configMock.store,
  getPiAiModelPresets: configMock.getPresets,
}));

vi.mock('../src/main/config/config-test-routing', () => ({
  runConfigApiTest: serviceMock.runConfigApiTest,
}));

vi.mock('../src/main/config/engine-runtime-config', () => ({
  resolveEngineRuntimeConfig: serviceMock.resolveEngineRuntimeConfig,
}));

vi.mock('../src/main/config/ollama-api', () => ({
  listOllamaModels: serviceMock.listOllamaModels,
}));

vi.mock('../src/main/config/lmstudio-api', () => ({
  listLmStudioModels: serviceMock.listLmStudioModels,
}));

vi.mock('../src/main/config/api-diagnostics', () => ({
  runDiagnostics: serviceMock.runDiagnostics,
  discoverLocalOllama: serviceMock.discoverLocalOllama,
  discoverLocalLmStudio: serviceMock.discoverLocalLmStudio,
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: serviceMock.loadCoreModule,
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { registerConfigIpcHandlers } from '../src/main/ipc/config-ipc';

const fakeEvent = {} as unknown;

function handler(channel: string): (...args: unknown[]) => unknown {
  const registered = electronMock.handlers.get(channel);
  if (!registered) throw new Error(`No handler registered for ${channel}`);
  return registered;
}

function registerHandlers() {
  const state: {
    engineAdapter: Record<string, unknown> | null;
    sessionManager: Record<string, unknown> | null;
    currentWorkingDir: string | null;
    configExportService: Record<string, unknown> | null;
  } = {
    engineAdapter: null,
    sessionManager: null,
    currentWorkingDir: null,
    configExportService: null,
  };
  const sendToRenderer = vi.fn();

  registerConfigIpcHandlers({
    getEngineAdapter: () => state.engineAdapter as never,
    getSessionManager: () => state.sessionManager as never,
    getCurrentWorkingDir: () => state.currentWorkingDir,
    getConfigExportService: () => state.configExportService as never,
    sendToRenderer,
  });

  return { state, sendToRenderer };
}

beforeEach(() => {
  electronMock.handlers.clear();
  vi.clearAllMocks();
  configMock.store.getAll.mockImplementation(() => configMock.rawConfig);
  configMock.store.getAllRedacted.mockImplementation(() => configMock.redactedConfig);
  configMock.store.hasAnyUsableCredentials.mockReturnValue(true);
  configMock.store.isConfigured.mockReturnValue(true);
  configMock.getPresets.mockReturnValue([{ id: 'openai:gpt' }]);
  serviceMock.runConfigApiTest.mockResolvedValue({ ok: true, latencyMs: 12 });
  serviceMock.resolveEngineRuntimeConfig.mockReturnValue({
    apiKey: 'sk-runtime-secret',
    baseURL: 'https://runtime.example/v1',
    model: 'gpt-new',
  });
  serviceMock.listOllamaModels.mockResolvedValue([{ id: 'ollama-model', name: 'Ollama' }]);
  serviceMock.listLmStudioModels.mockResolvedValue([{ id: 'lm-model', name: 'LM Studio' }]);
  serviceMock.loadCoreModule.mockResolvedValue(null);
  serviceMock.runDiagnostics.mockResolvedValue({ ok: true });
  serviceMock.discoverLocalOllama.mockResolvedValue([{ baseUrl: 'http://localhost:11434/v1' }]);
  serviceMock.discoverLocalLmStudio.mockResolvedValue({
    available: true,
    baseUrl: 'http://localhost:1234/v1',
    status: 'available',
  });
  electronMock.showSaveDialog.mockResolvedValue({ canceled: true });
  electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
});

describe('config IPC handlers', () => {
  it('registers the complete principal and sync configuration surface', () => {
    registerHandlers();

    expect([...electronMock.handlers.keys()].sort()).toEqual(
      [
        'config.applyImport',
        'config.createSet',
        'config.deleteSet',
        'config.diagnose',
        'config.discover-lmstudio-local',
        'config.discover-local',
        'config.export',
        'config.exportToFile',
        'config.get',
        'config.getPresets',
        'config.importFromFile',
        'config.isConfigured',
        'config.listModels',
        'config.model-inventory',
        'config.renameSet',
        'config.save',
        'config.switchSet',
        'config.test',
      ].sort()
    );
  });

  it('returns only the redacted projection from config.get', () => {
    registerHandlers();

    const result = handler('config.get')(fakeEvent);

    expect(result).toBe(configMock.redactedConfig);
    expect(configMock.store.getAllRedacted).toHaveBeenCalledTimes(1);
    expect(configMock.store.getAll).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('sk-main-secret');
  });

  it('keeps every config-set mutation response and status event redacted', async () => {
    const { sendToRenderer } = registerHandlers();
    const cases = [
      ['config.save', configMock.store.update, { model: 'gpt-new' }],
      ['config.createSet', configMock.store.createSet, { name: 'New set', mode: 'blank' }],
      ['config.renameSet', configMock.store.renameSet, { id: 'set-1', name: 'Renamed' }],
      ['config.deleteSet', configMock.store.deleteSet, { id: 'set-1' }],
      ['config.switchSet', configMock.store.switchSet, { id: 'set-2' }],
    ] as const;

    for (const [channel, mutation, payload] of cases) {
      const result = await handler(channel)(fakeEvent, payload);
      expect(mutation).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ success: true, config: configMock.redactedConfig });
      expect(JSON.stringify(result)).not.toContain('sk-main-secret');
    }

    expect(sendToRenderer).toHaveBeenCalledTimes(cases.length);
    for (const [event] of sendToRenderer.mock.calls) {
      expect(event).toMatchObject({
        type: 'config.status',
        payload: { isConfigured: true, config: configMock.redactedConfig },
      });
      expect(JSON.stringify(event)).not.toContain('sk-main-secret');
    }
  });

  it('reads mutable runtime dependencies lazily when synchronizing a save', async () => {
    const { state } = registerHandlers();
    const previousConfig = { ...configMock.rawConfig };
    const updatedConfig = {
      ...configMock.rawConfig,
      model: 'gpt-new',
      thinkingLevel: 'high',
      sandboxEnabled: true,
    };
    const engineAdapter = {
      updateConfig: vi.fn(),
      setThinkingLevel: vi.fn(async () => undefined),
    };
    const sessionManager = {
      reloadConfig: vi.fn(),
      reloadSandbox: vi.fn(async () => undefined),
    };

    state.engineAdapter = engineAdapter;
    state.sessionManager = sessionManager;
    state.currentWorkingDir = '/workspace/current';
    configMock.store.getAll
      .mockReturnValueOnce(previousConfig)
      .mockReturnValueOnce(updatedConfig);

    const result = await handler('config.save')(fakeEvent, { model: 'gpt-new' });

    expect(engineAdapter.updateConfig).toHaveBeenCalledWith({
      apiKey: 'sk-runtime-secret',
      baseURL: 'https://runtime.example/v1',
      model: 'gpt-new',
      workingDirectory: '/workspace/current',
    });
    expect(engineAdapter.setThinkingLevel).toHaveBeenCalledWith('high');
    expect(sessionManager.reloadConfig).toHaveBeenCalledTimes(1);
    expect(sessionManager.reloadSandbox).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, config: configMock.redactedConfig });
  });

  it('uses raw stored credentials only inside main-process probes', async () => {
    registerHandlers();
    const payload = { provider: 'openai', model: 'gpt-old' };

    const result = await handler('config.test')(fakeEvent, payload);

    expect(serviceMock.runConfigApiTest).toHaveBeenCalledWith(payload, configMock.rawConfig);
    expect(result).toEqual({ ok: true, latencyMs: 12 });
  });

  it('routes model listing and diagnostics without returning the stored config', async () => {
    registerHandlers();
    const ollamaInput = { provider: 'ollama', baseUrl: 'http://localhost:11434/v1' };
    const lmStudioInput = { provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1' };

    await expect(handler('config.listModels')(fakeEvent, ollamaInput)).resolves.toEqual([
      { id: 'ollama-model', name: 'Ollama' },
    ]);
    await expect(handler('config.listModels')(fakeEvent, lmStudioInput)).resolves.toEqual([
      { id: 'lm-model', name: 'LM Studio' },
    ]);
    await expect(
      handler('config.diagnose')(fakeEvent, { provider: 'openai', apiKey: '' })
    ).resolves.toEqual({ ok: true });

    expect(serviceMock.runDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-main-secret' })
    );
  });

  it('resolves the export service lazily and preserves unavailable defaults', async () => {
    const { state } = registerHandlers();

    await expect(handler('config.export')(fakeEvent)).resolves.toEqual({
      success: false,
      error: 'Export service unavailable',
    });

    const bundle = {
      version: 1,
      exportedAt: '2026-07-13T00:00:00.000Z',
      source: 'test',
      app: { api: { apiKey: '[REDACTED]' } },
      projects: [],
      mcpServers: [],
    };
    const exportBundle = vi.fn(() => bundle);
    state.configExportService = { exportBundle };

    await expect(handler('config.export')(fakeEvent)).resolves.toEqual({
      success: true,
      bundle,
    });
    expect(exportBundle).toHaveBeenCalledTimes(1);
  });
});
