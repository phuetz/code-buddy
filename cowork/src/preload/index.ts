import { contextBridge, ipcRenderer } from 'electron';
import type {
  ClientEvent,
  ServerEvent,
  AppConfig,
  CreateSetPayload,
  ProviderPresets,
  Skill,
  ApiTestInput,
  ApiTestResult,
  PluginCatalogItemV2,
  InstalledPlugin,
  PluginInstallResultV2,
  PluginToggleResult,
  PluginComponentKind,
  ScheduleTask,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ProviderModelInfo,
  LocalLmStudioDiscoveryResult,
  LocalOllamaDiscoveryResult,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
} from '../renderer/types';
import type { DiagnosticInput, DiagnosticResult } from '../renderer/types';
import type {
  McpServerConfig,
  McpTool,
  McpServerStatus,
  McpPresetsMap,
  RemoteConfig,
  GatewayConfig,
  FeishuChannelConfig,
  PairedUser,
  PairingRequest,
  RemoteSessionMapping,
} from '../shared/ipc-types';

// Track registered callbacks to prevent duplicate listeners
let registeredCallback: ((event: ServerEvent) => void) | null = null;
let ipcListener: ((event: Electron.IpcRendererEvent, data: ServerEvent) => void) | null = null;

// Allowlist of valid ClientEvent types to prevent spoofing arbitrary IPC channels
const ALLOWED_CLIENT_EVENTS: ReadonlySet<string> = new Set<ClientEvent['type']>([
  'session.start',
  'session.continue',
  'session.stop',
  'session.delete',
  'session.batchDelete',
  'session.list',
  'session.getMessages',
  'session.getTraceSteps',
  'permission.response',
  'sudo.password.response',
  'settings.update',
  'folder.select',
  'workdir.get',
  'workdir.set',
  'workdir.select',
]);

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Send events to main process
  send: (event: ClientEvent) => {
    if (!ALLOWED_CLIENT_EVENTS.has(event.type)) {
      console.warn('[Preload] Blocked unauthorized event type:', event.type);
      return;
    }
    console.log('[Preload] Sending event:', event.type);
    ipcRenderer.send('client-event', event);
  },

  // Receive events from main process - ensures only ONE listener
  on: (callback: (event: ServerEvent) => void) => {
    // Remove previous listener if exists
    if (ipcListener) {
      console.log('[Preload] Removing previous listener');
      ipcRenderer.removeListener('server-event', ipcListener);
    }

    registeredCallback = callback;
    ipcListener = (_: Electron.IpcRendererEvent, data: ServerEvent) => {
      console.log('[Preload] Received event:', data.type);
      if (registeredCallback) {
        registeredCallback(data);
      }
    };

    console.log('[Preload] Registering new listener');
    ipcRenderer.on('server-event', ipcListener);

    // Return cleanup function
    return () => {
      console.log('[Preload] Cleanup called');
      if (ipcListener) {
        ipcRenderer.removeListener('server-event', ipcListener);
        ipcListener = null;
        registeredCallback = null;
      }
    };
  },

  // Invoke and wait for response
  invoke: async <T>(event: ClientEvent): Promise<T> => {
    if (!ALLOWED_CLIENT_EVENTS.has(event.type)) {
      console.warn('[Preload] Blocked unauthorized invoke type:', event.type);
      throw new Error(`Unauthorized event type: ${event.type}`);
    }
    console.log('[Preload] Invoking:', event.type);
    return ipcRenderer.invoke('client-invoke', event);
  },

  // Platform info
  platform: process.platform,

  // System theme
  getSystemTheme: () => ipcRenderer.invoke('system.getTheme'),

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Open links in default browser
  openExternal: (url: string) => {
    // Sanitize mailto: URLs to strip dangerous query params that could attach files
    let safeUrl = url;
    if (/^mailto:/i.test(url)) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete('attach');
        parsed.searchParams.delete('attachment');
        safeUrl = parsed.toString();
      } catch {
        // If URL parsing fails, block the call
        return Promise.resolve(false);
      }
    }
    return ipcRenderer.invoke('shell.openExternal', safeUrl);
  },
  showItemInFolder: (filePath: string, cwd?: string) =>
    ipcRenderer.invoke('shell.showItemInFolder', filePath, cwd),

  // Select files using native dialog
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog.selectFiles'),

  artifacts: {
    listRecentFiles: (
      cwd: string,
      sinceMs: number,
      limit = 50
    ): Promise<Array<{ path: string; modifiedAt: number; size: number }>> =>
      ipcRenderer.invoke('artifacts.listRecentFiles', cwd, sinceMs, Math.min(limit, 500)),
  },

  // Presence (face memory) — see cowork/src/main/presence/.
  // Renderer-side capture + detection talks to main-side encode + match
  // + persist via these channels. The renderer never touches ONNX or
  // the on-disk store directly.
  presence: {
    enroll: (payload: {
      name: string;
      aliases?: string[];
      embedding: number[];
      snapshotPath?: string;
    }): Promise<unknown> => ipcRenderer.invoke('presence:enroll', payload),
    addSample: (payload: {
      personId: string;
      embedding: number[];
      snapshotPath?: string;
    }): Promise<unknown> => ipcRenderer.invoke('presence:add-sample', payload),
    encode: (payload: { rgbBytes: number[] }): Promise<number[]> =>
      ipcRenderer.invoke('presence:encode', payload),
    match: (payload: {
      embedding: number[];
      threshold?: number;
    }): Promise<unknown> => ipcRenderer.invoke('presence:match', payload),
    list: (): Promise<unknown[]> => ipcRenderer.invoke('presence:list'),
    remove: (payload: { personId: string }): Promise<boolean> =>
      ipcRenderer.invoke('presence:remove', payload),
    hasModel: (): Promise<{ installed: boolean; path: string }> =>
      ipcRenderer.invoke('presence:has-model'),
    selectModelFile: (): Promise<string | null> =>
      ipcRenderer.invoke('presence:select-model-file'),
    installModelFromPath: (
      payload: { sourcePath: string },
    ): Promise<{ ok: boolean; error?: string; installedPath?: string }> =>
      ipcRenderer.invoke('presence:install-model-from-path', payload),
    downloadModel: (
      payload: { url: string },
    ): Promise<{ ok: boolean; error?: string; installedPath?: string }> =>
      ipcRenderer.invoke('presence:download-model', payload),
    onDownloadProgress: (
      listener: (progress: { bytes: number; total: number | null }) => void,
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        progress: { bytes: number; total: number | null },
      ) => listener(progress);
      ipcRenderer.on('presence:download-progress', wrapped);
      return () => {
        ipcRenderer.removeListener('presence:download-progress', wrapped);
      };
    },
    // Live presence events forwarded by the main process whenever the
    // bridge sees a face come in / go out / get enrolled. Returns an
    // unsubscribe function — callers MUST call it on teardown.
    onEvent: (
      listener: (event: {
        type: 'detected' | 'unknown' | 'left' | 'enrolled';
        match?: {
          personId: string;
          name: string;
          aliases: string[];
          confidence: number;
          matchedAt: number;
        };
        timestamp: number;
      }) => void,
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        payload: Parameters<typeof listener>[0],
      ) => listener(payload);
      ipcRenderer.on('presence:event', wrapped);
      return () => {
        ipcRenderer.removeListener('presence:event', wrapped);
      };
    },
  },

  // Code Buddy backend toggles that need a live IPC round-trip (the
  // settings file is the source of truth, but some flags benefit from
  // hot-apply without restarting the app).
  codebuddy: {
    setGeminiGrounding: (
      payload: { enabled: boolean },
    ): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('codebuddy:set-gemini-grounding', payload),
  },

  // Config methods
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config.get'),
    getPresets: (): Promise<ProviderPresets> => ipcRenderer.invoke('config.getPresets'),
    save: (config: Partial<AppConfig>): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.save', config),
    createSet: (payload: CreateSetPayload): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.createSet', payload),
    renameSet: (payload: {
      id: string;
      name: string;
    }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.renameSet', payload),
    deleteSet: (payload: { id: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.deleteSet', payload),
    switchSet: (payload: { id: string }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke('config.switchSet', payload),
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('config.isConfigured'),
    test: (config: ApiTestInput): Promise<ApiTestResult> =>
      ipcRenderer.invoke('config.test', config),
    listModels: (payload: {
      provider: AppConfig['provider'];
      apiKey: string;
      baseUrl?: string;
    }): Promise<ProviderModelInfo[]> => ipcRenderer.invoke('config.listModels', payload),
    diagnose: (input: DiagnosticInput): Promise<DiagnosticResult> =>
      ipcRenderer.invoke('config.diagnose', input),
    discoverLocal: (payload?: { baseUrl?: string }): Promise<LocalOllamaDiscoveryResult> =>
      ipcRenderer.invoke('config.discover-local', payload),
    discoverLocalLmStudio: (payload?: { baseUrl?: string }): Promise<LocalLmStudioDiscoveryResult> =>
      ipcRenderer.invoke('config.discover-lmstudio-local', payload),
  },

  // Window control methods
  window: {
    minimize: () => ipcRenderer.send('window.minimize'),
    maximize: () => ipcRenderer.send('window.maximize'),
    close: () => ipcRenderer.send('window.close'),
  },

  // MCP methods
  mcp: {
    getServers: (): Promise<McpServerConfig[]> => ipcRenderer.invoke('mcp.getServers'),
    getServer: (serverId: string): Promise<McpServerConfig | undefined> =>
      ipcRenderer.invoke('mcp.getServer', serverId),
    saveServer: (config: McpServerConfig): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('mcp.saveServer', config),
    deleteServer: (serverId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mcp.deleteServer', serverId),
    getTools: (): Promise<McpTool[]> => ipcRenderer.invoke('mcp.getTools'),
    getServerStatus: (): Promise<McpServerStatus[]> => ipcRenderer.invoke('mcp.getServerStatus'),
    getPresets: (): Promise<McpPresetsMap> => ipcRenderer.invoke('mcp.getPresets'),
    // Marketplace (Claude Cowork parity Phase 2)
    registry: (): Promise<Array<Record<string, unknown>>> => ipcRenderer.invoke('mcp.registry'),
    registrySearch: (query: string): Promise<Array<Record<string, unknown>>> =>
      ipcRenderer.invoke('mcp.registrySearch', query),
    registryGet: (id: string): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke('mcp.registryGet', id),
    registryInstall: (
      id: string,
      envOverrides?: Record<string, string>
    ): Promise<{ success: boolean; serverId?: string; error?: string }> =>
      ipcRenderer.invoke('mcp.registryInstall', id, envOverrides),
    registryUninstall: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('mcp.registryUninstall', id),
    registrySetEnabled: (
      id: string,
      enabled: boolean
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('mcp.registrySetEnabled', id, enabled),
    registryTools: (
      id: string
    ): Promise<
      Array<{ name: string; description?: string; serverId: string; serverName: string }>
    > => ipcRenderer.invoke('mcp.registryTools', id),
    // Phase 3 step 7: MCP playground
    listAllTools: (): Promise<
      Array<{
        name: string;
        description?: string;
        serverId: string;
        serverName: string;
        inputSchema?: unknown;
      }>
    > => ipcRenderer.invoke('mcp.listAllTools'),
    invokeTool: (
      toolName: string,
      args: Record<string, unknown>
    ): Promise<{
      success: boolean;
      durationMs: number;
      result?: unknown;
      error?: string;
    }> => ipcRenderer.invoke('mcp.invokeTool', toolName, args),
  },

  // Skills methods
  skills: {
    getAll: (): Promise<Skill[]> => ipcRenderer.invoke('skills.getAll'),
    install: (skillPath: string): Promise<{ success: boolean; skill: Skill }> =>
      ipcRenderer.invoke('skills.install', skillPath),
    delete: (skillId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills.delete', skillId),
    setEnabled: (skillId: string, enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills.setEnabled', skillId, enabled),
    validate: (skillPath: string): Promise<{ valid: boolean; errors: string[] }> =>
      ipcRenderer.invoke('skills.validate', skillPath),
    getStoragePath: (): Promise<string> => ipcRenderer.invoke('skills.getStoragePath'),
    setStoragePath: (
      targetPath: string,
      migrate = true
    ): Promise<{
      success: boolean;
      path: string;
      migratedCount: number;
      skippedCount: number;
      error?: string;
    }> => ipcRenderer.invoke('skills.setStoragePath', targetPath, migrate),
    openStoragePath: (): Promise<{ success: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke('skills.openStoragePath'),
  },

  plugins: {
    listCatalog: (options?: { installableOnly?: boolean }): Promise<PluginCatalogItemV2[]> =>
      ipcRenderer.invoke('plugins.listCatalog', options),
    listInstalled: (): Promise<InstalledPlugin[]> => ipcRenderer.invoke('plugins.listInstalled'),
    install: (pluginName: string): Promise<PluginInstallResultV2> =>
      ipcRenderer.invoke('plugins.install', pluginName),
    setEnabled: (pluginId: string, enabled: boolean): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setEnabled', pluginId, enabled),
    setComponentEnabled: (
      pluginId: string,
      component: PluginComponentKind,
      enabled: boolean
    ): Promise<PluginToggleResult> =>
      ipcRenderer.invoke('plugins.setComponentEnabled', pluginId, component, enabled),
    uninstall: (pluginId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('plugins.uninstall', pluginId),
  },

  // Sandbox methods
  sandbox: {
    getStatus: (): Promise<{
      platform: string;
      mode: string;
      initialized: boolean;
      wsl?: {
        available: boolean;
        distro?: string;
        nodeAvailable?: boolean;
        version?: string;
        pythonAvailable?: boolean;
        pythonVersion?: string;
        pipAvailable?: boolean;
        claudeCodeAvailable?: boolean;
      };
      lima?: {
        available: boolean;
        instanceExists?: boolean;
        instanceRunning?: boolean;
        instanceName?: string;
        nodeAvailable?: boolean;
        version?: string;
        pythonAvailable?: boolean;
        pythonVersion?: string;
        pipAvailable?: boolean;
        claudeCodeAvailable?: boolean;
      };
      error?: string;
    }> => ipcRenderer.invoke('sandbox.getStatus'),
    checkWSL: (): Promise<{
      available: boolean;
      distro?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      claudeCodeAvailable?: boolean;
    }> => ipcRenderer.invoke('sandbox.checkWSL'),
    checkLima: (): Promise<{
      available: boolean;
      instanceExists?: boolean;
      instanceRunning?: boolean;
      instanceName?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      claudeCodeAvailable?: boolean;
    }> => ipcRenderer.invoke('sandbox.checkLima'),
    installNodeInWSL: (distro: string): Promise<boolean> =>
      ipcRenderer.invoke('sandbox.installNodeInWSL', distro),
    installPythonInWSL: (distro: string): Promise<boolean> =>
      ipcRenderer.invoke('sandbox.installPythonInWSL', distro),
    installNodeInLima: (): Promise<boolean> => ipcRenderer.invoke('sandbox.installNodeInLima'),
    installPythonInLima: (): Promise<boolean> => ipcRenderer.invoke('sandbox.installPythonInLima'),
    startLimaInstance: (): Promise<boolean> => ipcRenderer.invoke('sandbox.startLimaInstance'),
    stopLimaInstance: (): Promise<boolean> => ipcRenderer.invoke('sandbox.stopLimaInstance'),
    retrySetup: (): Promise<{ success: boolean; error?: string; result?: unknown }> =>
      ipcRenderer.invoke('sandbox.retrySetup'),
    retryLimaSetup: (): Promise<{ success: boolean; error?: string; result?: unknown }> =>
      ipcRenderer.invoke('sandbox.retryLimaSetup'),
  },

  // Logs methods
  logs: {
    getPath: (): Promise<string | null> => ipcRenderer.invoke('logs.getPath'),
    getDirectory: (): Promise<string> => ipcRenderer.invoke('logs.getDirectory'),
    getAll: (): Promise<Array<{ name: string; path: string; size: number; mtime: Date }>> =>
      ipcRenderer.invoke('logs.getAll'),
    export: (): Promise<{ success: boolean; path?: string; size?: number; error?: string }> =>
      ipcRenderer.invoke('logs.export'),
    open: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('logs.open'),
    clear: (): Promise<{ success: boolean; deletedCount?: number; error?: string }> =>
      ipcRenderer.invoke('logs.clear'),
    setEnabled: (
      enabled: boolean
    ): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.setEnabled', enabled),
    isEnabled: (): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.isEnabled'),
    write: (
      level: 'info' | 'warn' | 'error',
      ...args: unknown[]
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('logs.write', level, ...args),
  },

  // Remote control methods
  remote: {
    getConfig: (): Promise<RemoteConfig> => ipcRenderer.invoke('remote.getConfig'),
    getStatus: (): Promise<{
      running: boolean;
      port?: number;
      publicUrl?: string;
      channels: Array<{ type: string; connected: boolean; error?: string }>;
      activeSessions: number;
      pendingPairings: number;
    }> => ipcRenderer.invoke('remote.getStatus'),
    setEnabled: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.setEnabled', enabled),
    updateGatewayConfig: (
      config: Partial<GatewayConfig>
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateGatewayConfig', config),
    updateFeishuConfig: (
      config: FeishuChannelConfig
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateFeishuConfig', config),
    getPairedUsers: (): Promise<PairedUser[]> => ipcRenderer.invoke('remote.getPairedUsers'),
    getPendingPairings: (): Promise<PairingRequest[]> =>
      ipcRenderer.invoke('remote.getPendingPairings'),
    approvePairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.approvePairing', channelType, userId),
    revokePairing: (
      channelType: string,
      userId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.revokePairing', channelType, userId),
    getRemoteSessions: (): Promise<RemoteSessionMapping[]> =>
      ipcRenderer.invoke('remote.getRemoteSessions'),
    clearRemoteSession: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.clearRemoteSession', sessionId),
    getTunnelStatus: (): Promise<{
      connected: boolean;
      url: string | null;
      provider: string;
      error?: string;
    }> => ipcRenderer.invoke('remote.getTunnelStatus'),
    getWebhookUrl: (): Promise<string | null> => ipcRenderer.invoke('remote.getWebhookUrl'),
    restart: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.restart'),
  },

  schedule: {
    list: (): Promise<ScheduleTask[]> => ipcRenderer.invoke('schedule.list'),
    create: (payload: ScheduleCreateInput): Promise<ScheduleTask> =>
      ipcRenderer.invoke('schedule.create', payload),
    update: (id: string, updates: ScheduleUpdateInput): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.update', id, updates),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('schedule.delete', id),
    toggle: (id: string, enabled: boolean): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.toggle', id, enabled),
    runNow: (id: string): Promise<ScheduleTask | null> => ipcRenderer.invoke('schedule.runNow', id),
  },

  // Checkpoint operations
  checkpoint: {
    list: () => ipcRenderer.invoke('checkpoint.list'),
    undo: () => ipcRenderer.invoke('checkpoint.undo'),
    redo: () => ipcRenderer.invoke('checkpoint.redo'),
    restore: (snapshotId: string) => ipcRenderer.invoke('checkpoint.restore', snapshotId),
    compare: (
      cwd: string,
      fromCommit: string,
      toCommit: string
    ): Promise<
      Array<{
        path: string;
        action: 'create' | 'modify' | 'delete' | 'rename';
        linesAdded: number;
        linesRemoved: number;
        excerpt: string;
      }>
    > => ipcRenderer.invoke('checkpoint.compare', cwd, fromCommit, toCommit),
  },

  // Workspace operations
  workspace: {
    readDir: (dirPath: string) => ipcRenderer.invoke('workspace.readDir', dirPath),
  },

  // Permission mode
  permission: {
    setMode: (mode: string) => ipcRenderer.invoke('permission.setMode', mode),
    respondBridge: (id: string, response: string) =>
      ipcRenderer.send('permission.bridge.response', { id, response }),
  },

  // Model switching
  model: {
    switch: (model: string) => ipcRenderer.invoke('config.switchModel', model),
    // Phase 3 step 3: capability lookup (vision, reasoning, context window)
    capabilities: (
      model: string
    ): Promise<{
      model: string;
      supportsVision: boolean;
      supportsReasoning: boolean;
      supportsToolCalls: boolean;
      contextWindow: number;
      maxOutputTokens: number;
    }> => ipcRenderer.invoke('model.capabilities', model),
  },

  // Session export, background sessions, settings update
  session: {
    export: (sessionId: string, format: 'md' | 'json') =>
      ipcRenderer.invoke('session.export', sessionId, format),
    // Phase 2 step 16: enhanced export
    exportFull: (
      sessionId: string,
      options: {
        format: 'markdown' | 'json' | 'html';
        redactSecrets?: boolean;
        includeCheckpoints?: boolean;
      }
    ): Promise<{ success: boolean; content: string; filename: string; error?: string }> =>
      ipcRenderer.invoke('session.exportFull', sessionId, options),
    exportToFile: (
      sessionId: string,
      options: {
        format: 'markdown' | 'json' | 'html';
        redactSecrets?: boolean;
        includeCheckpoints?: boolean;
      }
    ): Promise<{ success: boolean; error?: string; path?: string }> =>
      ipcRenderer.invoke('session.exportToFile', sessionId, options),
    startBackground: (payload: {
      title: string;
      prompt: string;
      cwd?: string;
      projectId?: string;
    }) => ipcRenderer.invoke('session.startBackground', payload),
    updateSettings: (
      sessionId: string,
      updates: {
        projectId?: string | null;
        executionMode?: 'chat' | 'task';
        isBackground?: boolean;
        title?: string;
      }
    ) => ipcRenderer.invoke('session.updateSettings', sessionId, updates),
    // Branching (Claude Cowork parity Phase 2)
    branches: (
      sessionId: string
    ): Promise<
      Array<{
        id: string;
        name: string;
        parentId?: string;
        parentMessageIndex?: number;
        createdAt: number;
        updatedAt: number;
        messageCount: number;
        isCurrent: boolean;
      }>
    > => ipcRenderer.invoke('session.branches', sessionId),
    fork: (
      sessionId: string,
      name: string,
      fromMessageIndex?: number
    ): Promise<{ success: boolean; branch?: Record<string, unknown>; error?: string }> =>
      ipcRenderer.invoke('session.fork', sessionId, name, fromMessageIndex),
    checkout: (
      sessionId: string,
      branchId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('session.checkout', sessionId, branchId),
    mergeBranch: (
      sessionId: string,
      sourceBranchId: string,
      strategy?: 'append' | 'replace'
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('session.mergeBranch', sessionId, sourceBranchId, strategy),
    deleteBranch: (
      sessionId: string,
      branchId: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('session.deleteBranch', sessionId, branchId),
    renameBranch: (
      sessionId: string,
      branchId: string,
      newName: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('session.renameBranch', sessionId, branchId, newName),
  },

  // Auto-update
  update: {
    check: () => ipcRenderer.invoke('update.check'),
    download: () => ipcRenderer.invoke('update.download'),
    install: () => ipcRenderer.invoke('update.install'),
  },

  // Projects (Claude Cowork parity)
  project: {
    list: (): Promise<{ projects: Project[] }> => ipcRenderer.invoke('project.list'),
    get: (id: string): Promise<Project | null> => ipcRenderer.invoke('project.get', id),
    create: (input: ProjectCreateInput): Promise<Project> =>
      ipcRenderer.invoke('project.create', input),
    update: (id: string, updates: ProjectUpdateInput): Promise<Project | null> =>
      ipcRenderer.invoke('project.update', id, updates),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('project.delete', id),
    setActive: (id: string | null): Promise<Project | null> =>
      ipcRenderer.invoke('project.setActive', id),
    getActive: (): Promise<Project | null> => ipcRenderer.invoke('project.getActive'),
  },

  // Sub-agents (Claude Cowork parity)
  subAgent: {
    list: (): Promise<Array<Record<string, unknown>>> => ipcRenderer.invoke('subagent.list'),
    spawn: (options: {
      sessionId: string;
      prompt: string;
      role?: string;
      forkContext?: boolean;
      parentId?: string;
    }): Promise<Record<string, unknown>> => ipcRenderer.invoke('subagent.spawn', options),
    sendInput: (agentId: string, message: string, interrupt?: boolean): Promise<boolean> =>
      ipcRenderer.invoke('subagent.sendInput', agentId, message, interrupt),
    close: (agentId: string): Promise<boolean> => ipcRenderer.invoke('subagent.close', agentId),
    resume: (agentId: string, prompt?: string): Promise<boolean> =>
      ipcRenderer.invoke('subagent.resume', agentId, prompt),
    wait: (agentIds: string[], timeoutMs?: number): Promise<Array<Record<string, unknown>>> =>
      ipcRenderer.invoke('subagent.wait', agentIds, timeoutMs),
  },

  // Orchestrator
  orchestrator: {
    run: (
      sessionId: string,
      goal: string,
      options?: Record<string, unknown>
    ): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('orchestrator.run', sessionId, goal, options),
    isComplex: (goal: string): Promise<boolean> =>
      ipcRenderer.invoke('orchestrator.isComplex', goal),
  },

  // @mention processing
  mention: {
    process: (
      text: string,
      cwd?: string
    ): Promise<{
      cleanedText: string;
      contextBlocks: Array<{ type: string; content: string; source: string }>;
    }> => ipcRenderer.invoke('mention.process', text, cwd),
    autocomplete: (
      prefix: string,
      cwd?: string,
      limit?: number
    ): Promise<Array<{ label: string; value: string; description?: string; category: string }>> =>
      ipcRenderer.invoke('mention.autocomplete', prefix, cwd, limit),
  },

  // Permission rules editor (Claude Cowork parity Phase 2)
  rules: {
    list: (projectId?: string): Promise<{ allow: string[]; deny: string[] }> =>
      ipcRenderer.invoke('rules.list', projectId),
    add: (
      bucket: 'allow' | 'deny',
      rule: string,
      projectId?: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('rules.add', bucket, rule, projectId),
    remove: (
      bucket: 'allow' | 'deny',
      rule: string,
      projectId?: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('rules.remove', bucket, rule, projectId),
    update: (
      bucket: 'allow' | 'deny',
      oldRule: string,
      newRule: string,
      projectId?: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('rules.update', bucket, oldRule, newRule, projectId),
    test: (
      toolName: string,
      toolArgs: Record<string, unknown>,
      projectId?: string
    ): Promise<{ decision: 'allow' | 'ask' | 'deny'; matchedRule?: string }> =>
      ipcRenderer.invoke('rules.test', toolName, toolArgs, projectId),
  },

  // Cost dashboard (Claude Cowork parity Phase 2)
  cost: {
    summary: (): Promise<{
      sessionCost: number;
      dailyCost: number;
      weeklyCost: number;
      monthlyCost: number;
      totalCost: number;
      sessionTokens: { input: number; output: number };
      modelBreakdown: Record<string, { cost: number; calls: number }>;
      budgetLimit?: number;
      dailyLimit?: number;
    }> => ipcRenderer.invoke('cost.summary'),
    history: (
      days?: number
    ): Promise<
      Array<{
        date: string;
        cost: number;
        inputTokens: number;
        outputTokens: number;
        calls: number;
      }>
    > => ipcRenderer.invoke('cost.history', days),
    modelBreakdown: (
      days?: number
    ): Promise<
      Array<{
        model: string;
        cost: number;
        calls: number;
        inputTokens: number;
        outputTokens: number;
      }>
    > => ipcRenderer.invoke('cost.modelBreakdown', days),
    setBudget: (monthlyLimit: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('cost.setBudget', monthlyLimit),
    setDailyLimit: (limit: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('cost.setDailyLimit', limit),
    record: (
      inputTokens: number,
      outputTokens: number,
      model: string,
      cost?: number
    ): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('cost.record', inputTokens, outputTokens, model, cost),
  },

  // SKILL.md skills (Claude Cowork parity Phase 2)
  skillMd: {
    list: (): Promise<
      Array<{
        name: string;
        description: string;
        tier: string;
        filePath?: string;
        tags?: string[];
        requires?: string[];
      }>
    > => ipcRenderer.invoke('skillMd.list'),
    search: (
      query: string,
      limit?: number
    ): Promise<
      Array<{
        skill: {
          name: string;
          description: string;
          tier: string;
          filePath?: string;
          tags?: string[];
        };
        score: number;
      }>
    > => ipcRenderer.invoke('skillMd.search', query, limit),
    findBest: (
      request: string
    ): Promise<{
      skill: {
        name: string;
        description: string;
        tier: string;
        filePath?: string;
        tags?: string[];
      };
      confidence: number;
      matchedTriggers?: string[];
    } | null> => ipcRenderer.invoke('skillMd.findBest', request),
    execute: (
      skillName: string,
      context: { userInput?: string; workspaceRoot?: string; sessionId?: string }
    ): Promise<{ success: boolean; output?: string; error?: string; duration?: number }> =>
      ipcRenderer.invoke('skillMd.execute', skillName, context),
  },

  // Global search Cmd+K palette (Claude Cowork parity Phase 2 step 8)
  search: {
    global: (
      query: string,
      limit?: number
    ): Promise<{
      hits: Array<{
        source: 'session' | 'message' | 'memory' | 'knowledge' | 'file';
        id: string;
        title: string;
        snippet: string;
        score: number;
        context: {
          sessionId?: string;
          projectId?: string;
          messageIndex?: number;
          path?: string;
        };
      }>;
      totalByCategory: Record<'session' | 'message' | 'memory' | 'knowledge' | 'file', number>;
    }> => ipcRenderer.invoke('search.global', query, limit),
  },

  // Config export/import (Claude Cowork parity Phase 2 step 19)
  configSync: {
    exportBundle: (): Promise<{
      success: boolean;
      bundle?: Record<string, unknown>;
      error?: string;
    }> => ipcRenderer.invoke('config.export'),
    exportToFile: (): Promise<{
      success: boolean;
      error?: string;
      bundle?: Record<string, unknown>;
    }> => ipcRenderer.invoke('config.exportToFile'),
    importFromFile: (): Promise<{
      success: boolean;
      error?: string;
      preview?: {
        bundle: Record<string, unknown>;
        conflicts: Array<{
          type: string;
          identifier: string;
          current?: unknown;
          incoming: unknown;
        }>;
        newProjects: number;
        newMcpServers: number;
      };
    }> => ipcRenderer.invoke('config.importFromFile'),
    applyImport: (
      bundle: Record<string, unknown>,
      strategy: 'skip' | 'overwrite'
    ): Promise<{
      success: boolean;
      imported: { projects: number; mcpServers: number; apiUpdated: boolean };
      errors: string[];
    }> => ipcRenderer.invoke('config.applyImport', bundle, strategy),
  },

  // Activity feed (Claude Cowork parity Phase 2 step 18)
  activity: {
    recent: (
      limit?: number,
      projectId?: string
    ): Promise<
      Array<{
        id: number;
        type: string;
        title: string;
        description?: string;
        sessionId?: string;
        projectId?: string;
        metadata?: Record<string, unknown>;
        timestamp: number;
      }>
    > => ipcRenderer.invoke('activity.recent', limit, projectId),
    clear: (): Promise<{ success: boolean }> => ipcRenderer.invoke('activity.clear'),
  },

  sessionInsights: {
    list: (
      limit = 100
    ): Promise<
      Array<{
        sessionId: string;
        title: string;
        status: 'idle' | 'running' | 'completed' | 'error';
        model?: string;
        cwd?: string;
        createdAt: number;
        updatedAt: number;
        messageCount: number;
        userMessageCount: number;
        assistantMessageCount: number;
        toolCallCount: number;
        tokenInput: number;
        tokenOutput: number;
        totalTokens: number;
        totalExecutionTimeMs: number;
        transcriptPreview: string;
      }>
    > => ipcRenderer.invoke('sessionInsights.list', limit),
    search: (
      query: string,
      limit = 50
    ): Promise<
      Array<{
        sessionId: string;
        title: string;
        status: 'idle' | 'running' | 'completed' | 'error';
        model?: string;
        cwd?: string;
        createdAt: number;
        updatedAt: number;
        messageCount: number;
        userMessageCount: number;
        assistantMessageCount: number;
        toolCallCount: number;
        tokenInput: number;
        tokenOutput: number;
        totalTokens: number;
        totalExecutionTimeMs: number;
        transcriptPreview: string;
      }>
    > => ipcRenderer.invoke('sessionInsights.search', query, limit),
    detail: (
      sessionId: string
    ): Promise<{
      summary: {
        sessionId: string;
        title: string;
        status: 'idle' | 'running' | 'completed' | 'error';
        model?: string;
        cwd?: string;
        createdAt: number;
        updatedAt: number;
        messageCount: number;
        userMessageCount: number;
        assistantMessageCount: number;
        toolCallCount: number;
        tokenInput: number;
        tokenOutput: number;
        totalTokens: number;
        totalExecutionTimeMs: number;
        transcriptPreview: string;
      };
      messages: import('../renderer/types').Message[];
      traceSteps: import('../renderer/types').TraceStep[];
    } | null> => ipcRenderer.invoke('sessionInsights.detail', sessionId),
    audit: (
      sessionId: string
    ): Promise<{
      sessionId: string;
      issueCount: number;
      orphanToolResults: number;
      missingToolResults: number;
      emptyMessages: number;
      issues: Array<{
        kind: 'orphan_tool_result' | 'missing_tool_result' | 'empty_message';
        messageId?: string;
        toolUseId?: string;
        detail: string;
      }>;
    } | null> => ipcRenderer.invoke('sessionInsights.audit', sessionId),
    repair: (
      sessionId: string
    ): Promise<{
      sessionId: string;
      changed: boolean;
      removedOrphanToolResults: number;
      injectedSyntheticToolResults: number;
      removedEmptyMessages: number;
      messages: import('../renderer/types').Message[];
      audit: {
        sessionId: string;
        issueCount: number;
        orphanToolResults: number;
        missingToolResults: number;
        emptyMessages: number;
        issues: Array<{
          kind: 'orphan_tool_result' | 'missing_tool_result' | 'empty_message';
          messageId?: string;
          toolUseId?: string;
          detail: string;
        }>;
      };
    } | null> => ipcRenderer.invoke('sessionInsights.repair', sessionId),
  },

  // Workflow visual editor (Claude Cowork parity Phase 2 step 15)
  workflow: {
    list: (): Promise<
      Array<{
        id: string;
        name: string;
        description?: string;
        nodes: Array<{
          id: string;
          type: 'tool' | 'condition' | 'parallel' | 'approval' | 'start' | 'end';
          name: string;
          position: { x: number; y: number };
          config?: Record<string, unknown>;
        }>;
        edges: Array<{ id: string; source: string; target: string; label?: string }>;
        createdAt: number;
        updatedAt: number;
      }>
    > => ipcRenderer.invoke('workflow.list'),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('workflow.get', id),
    create: (input: {
      name: string;
      description?: string;
      nodes: Array<unknown>;
      edges: Array<unknown>;
    }): Promise<unknown> => ipcRenderer.invoke('workflow.create', input),
    update: (id: string, patch: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke('workflow.update', id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('workflow.delete', id),
    run: (
      id: string,
      initialContext?: Record<string, unknown>
    ): Promise<{
      success: boolean;
      status: string;
      duration: number;
      completedSteps: number;
      totalSteps: number;
      error?: string;
    }> => ipcRenderer.invoke('workflow.run', id, initialContext),
    approve: (stepId: string, approved: boolean): Promise<boolean> =>
      ipcRenderer.invoke('workflow.approve', stepId, approved),
  },

  // Project templates (Claude Cowork parity Phase 2 step 12)
  template: {
    list: (): Promise<
      Array<{
        name: string;
        description: string;
        tier: string;
        tags: string[];
        language?: string;
        filePath?: string;
      }>
    > => ipcRenderer.invoke('template.list'),
    preview: (name: string): Promise<{ content: string; filePath?: string } | null> =>
      ipcRenderer.invoke('template.preview', name),
    create: (
      name: string,
      workspaceRoot: string
    ): Promise<{ success: boolean; output?: string; error?: string }> =>
      ipcRenderer.invoke('template.create', name, workspaceRoot),
  },

  // File preview pane (Claude Cowork parity Phase 2 step 9)
  preview: {
    get: (
      filePath: string
    ): Promise<{
      kind: 'text' | 'image' | 'pdf' | 'binary' | 'error';
      path: string;
      name: string;
      size: number;
      mime: string;
      text?: string;
      lineCount?: number;
      language?: string;
      dataUri?: string;
      dimensions?: { width: number; height: number };
      pdfText?: string;
      pdfPages?: number;
      error?: string;
    }> => ipcRenderer.invoke('preview.get', filePath),
  },

  // Workspace presets (Claude Cowork parity Phase 3 step 9)
  workspacePresets: {
    list: (): Promise<
      Array<{
        id: string;
        name: string;
        description?: string;
        workspacePath?: string;
        model?: string;
        permissionMode?: string;
        memoryScope?: 'project' | 'global' | 'none';
        createdAt: number;
        updatedAt: number;
      }>
    > => ipcRenderer.invoke('workspacePresets.list'),
    save: (preset: {
      id?: string;
      name: string;
      description?: string;
      workspacePath?: string;
      model?: string;
      permissionMode?: string;
      memoryScope?: 'project' | 'global' | 'none';
    }): Promise<{
      success: boolean;
      preset?: {
        id: string;
        name: string;
        description?: string;
        workspacePath?: string;
        model?: string;
        permissionMode?: string;
        memoryScope?: 'project' | 'global' | 'none';
        createdAt: number;
        updatedAt: number;
      };
      error?: string;
    }> => ipcRenderer.invoke('workspacePresets.save', preset),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('workspacePresets.delete', id),
  },

  // A2A remote agent registry (Claude Cowork parity Phase 3 step 19)
  a2a: {
    list: (): Promise<
      Array<{
        id: string;
        url: string;
        addedAt: number;
        lastPingAt?: number;
        lastStatus?: 'ok' | 'error' | 'unknown';
        lastError?: string;
        card: {
          name: string;
          description: string;
          url: string;
          version: string;
          skills: Array<{ id: string; name: string; description?: string }>;
        };
      }>
    > => ipcRenderer.invoke('a2a.list'),
    discover: (
      url: string
    ): Promise<{
      success: boolean;
      card?: unknown;
      error?: string;
    }> => ipcRenderer.invoke('a2a.discover', url),
    add: (
      url: string
    ): Promise<{
      success: boolean;
      agent?: unknown;
      error?: string;
    }> => ipcRenderer.invoke('a2a.add', url),
    remove: (id: string): Promise<{ success: boolean }> => ipcRenderer.invoke('a2a.remove', id),
    ping: (
      id: string
    ): Promise<{
      success: boolean;
      status?: string;
      error?: string;
    }> => ipcRenderer.invoke('a2a.ping', id),
    invoke: (
      id: string,
      message: string
    ): Promise<{
      success: boolean;
      taskId?: string;
      result?: string;
      error?: string;
    }> => ipcRenderer.invoke('a2a.invoke', { id, message }),
    cancelTask: (id: string, taskId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('a2a.cancelTask', { id, taskId }),
    listTasks: (): Promise<
      Array<{
        taskId: string;
        agentId: string;
        agentName?: string;
        status: string;
        startedAt: number;
        updatedAt: number;
        result?: string;
        error?: string;
      }>
    > => ipcRenderer.invoke('a2a.listTasks'),
  },

  // Team — Agent Teams (Phase 4 layer 9)
  team: {
    getStatus: (): Promise<unknown> => ipcRenderer.invoke('team.getStatus'),
    start: (goal?: string): Promise<{ success: boolean; leadId?: string; message: string }> =>
      ipcRenderer.invoke('team.start', goal),
    stop: (): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('team.stop'),
    addMember: (
      role: string,
      label?: string
    ): Promise<{ success: boolean; memberId?: string; message: string }> =>
      ipcRenderer.invoke('team.addMember', { role, label }),
    removeMember: (memberId: string): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('team.removeMember', memberId),
    addTask: (input: {
      title: string;
      description: string;
      priority?: string;
      assignedRole?: string;
      dependencies?: string[];
    }): Promise<unknown> => ipcRenderer.invoke('team.addTask', input),
    updateTask: (
      taskId: string,
      updates: { status?: string; assignedTo?: string; result?: string; error?: string }
    ): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('team.updateTask', { taskId, updates }),
    assignTask: (
      taskId: string,
      memberId: string
    ): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('team.assignTask', { taskId, memberId }),
    sendMessage: (from: string, to: string, content: string): Promise<unknown> =>
      ipcRenderer.invoke('team.sendMessage', { from, to, content }),
    getInbox: (memberId: string, limit?: number): Promise<unknown[]> =>
      ipcRenderer.invoke('team.getInbox', { memberId, limit }),
  },

  // Fleet — multi-host Code Buddy listener (GAP 3)
  fleet: {
    list: (): Promise<
      Array<{
        id: string;
        url: string;
        label?: string;
        addedAt: number;
        status: string;
        lastError?: string;
        lastSeenAt?: number;
        lastEventType?: string;
      }>
    > => ipcRenderer.invoke('fleet.list'),
    addPeer: (input: {
      url: string;
      apiKey?: string;
      jwt?: string;
      label?: string;
    }): Promise<{ success: boolean; peer?: unknown; error?: string }> =>
      ipcRenderer.invoke('fleet.addPeer', input),
    removePeer: (peerId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('fleet.removePeer', peerId),
    reconnect: (peerId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fleet.reconnect', peerId),
    getEvents: (
      peerId?: string,
      limit?: number
    ): Promise<
      Array<{
        peerId: string;
        type: string;
        payload: Record<string, unknown>;
        receivedAt: number;
        hostname?: string;
        agentId?: string;
      }>
    > => ipcRenderer.invoke('fleet.events', peerId, limit),
  },

  // Reasoning trace viewer (Claude Cowork parity Phase 3 step 17)
  reasoning: {
    listTraces: (): Promise<
      Array<{
        toolUseId: string;
        sessionId: string;
        problem: string;
        mode: string;
        startedAt: number;
        endedAt?: number;
        iterations?: number;
      }>
    > => ipcRenderer.invoke('reasoning.listTraces'),
    getTrace: (toolUseId: string): Promise<unknown | null> =>
      ipcRenderer.invoke('reasoning.getTrace', toolUseId),
    clear: (): Promise<{ success: boolean }> => ipcRenderer.invoke('reasoning.clear'),
  },

  // Hooks editor (Claude Cowork parity Phase 3 step 13)
  hooks: {
    list: (): Promise<
      Array<{
        id: string;
        event: string;
        index: number;
        handler: {
          type: string;
          command?: string;
          url?: string;
          prompt?: string;
          if?: string;
          timeout?: number;
        };
      }>
    > => ipcRenderer.invoke('hooks.list'),
    upsert: (params: {
      event: string;
      handler: Record<string, unknown>;
      index?: number;
    }): Promise<{ success: boolean; entry?: unknown; error?: string }> =>
      ipcRenderer.invoke('hooks.upsert', params),
    remove: (params: {
      event: string;
      index: number;
    }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('hooks.remove', params),
    test: (
      handler: Record<string, unknown>
    ): Promise<{
      success: boolean;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      durationMs: number;
      error?: string;
    }> => ipcRenderer.invoke('hooks.test', handler),
  },

  // Test runner (Claude Cowork parity Phase 3 step 12)
  test: {
    detect: (): Promise<string | null> => ipcRenderer.invoke('test.detect'),
    run: (files?: string[]): Promise<unknown> => ipcRenderer.invoke('test.run', files),
    runFailing: (): Promise<unknown> => ipcRenderer.invoke('test.runFailing'),
    cancel: (): Promise<{ success: boolean }> => ipcRenderer.invoke('test.cancel'),
    getState: (): Promise<{
      framework: string | null;
      lastResult: unknown | null;
      isRunning: boolean;
    } | null> => ipcRenderer.invoke('test.getState'),
  },

  // Persona switcher (Claude Cowork parity Phase 3 step 11)
  identity: {
    list: (): Promise<
      Array<{
        id: string;
        name: string;
        description?: string;
        filePath: string;
        source: 'workspace' | 'global';
        kind: 'identity' | 'persona';
        mtime: number;
        size: number;
        active: boolean;
      }>
    > => ipcRenderer.invoke('identity.list'),
    getDetail: (
      id: string
    ): Promise<{
      id: string;
      name: string;
      description?: string;
      filePath: string;
      source: 'workspace' | 'global';
      kind: 'identity' | 'persona';
      mtime: number;
      size: number;
      active: boolean;
      content: string;
    } | null> => ipcRenderer.invoke('identity.getDetail', id),
    activate: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('identity.activate', id),
    deactivate: (): Promise<{ success: boolean }> => ipcRenderer.invoke('identity.deactivate'),
    getActive: (): Promise<unknown | null> => ipcRenderer.invoke('identity.getActive'),
  },

  // Audit log (Claude Cowork parity Phase 3 step 10)
  audit: {
    listRuns: (filter?: {
      limit?: number;
      status?: 'running' | 'completed' | 'failed' | 'cancelled';
      sessionId?: string;
      sinceTs?: number;
      untilTs?: number;
    }): Promise<
      Array<{
        runId: string;
        objective: string;
        status: 'running' | 'completed' | 'failed' | 'cancelled';
        startedAt: number;
        endedAt?: number;
        durationMs?: number;
        eventCount: number;
        artifactCount: number;
        channel?: string;
        sessionId?: string;
        userId?: string;
        tags?: string[];
        totalCost?: number;
        totalTokens?: number;
        toolCallCount?: number;
      }>
    > => ipcRenderer.invoke('audit.listRuns', filter),
    getRunDetail: (runId: string): Promise<unknown | null> =>
      ipcRenderer.invoke('audit.getRunDetail', runId),
    exportCsv: (filter?: Record<string, unknown>): Promise<string> =>
      ipcRenderer.invoke('audit.exportCsv', filter),
  },

  // Custom slash commands editor (Claude Cowork parity Phase 3 step 6)
  customCommands: {
    list: (): Promise<
      Array<{
        name: string;
        description: string;
        prompt: string;
        category?: string;
        isBuiltin: boolean;
      }>
    > => ipcRenderer.invoke('customCommands.list'),
    save: (cmd: {
      name: string;
      description: string;
      body: string;
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('customCommands.save', cmd),
    delete: (name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('customCommands.delete', name),
  },

  // Snippets / prompt library (Claude Cowork parity Phase 3 step 5)
  snippets: {
    list: (): Promise<
      Array<{
        id: string;
        name: string;
        description?: string;
        tags: string[];
        body: string;
        updatedAt: number;
      }>
    > => ipcRenderer.invoke('snippets.list'),
    get: (
      id: string
    ): Promise<{
      id: string;
      name: string;
      description?: string;
      tags: string[];
      body: string;
      updatedAt: number;
    } | null> => ipcRenderer.invoke('snippets.get', id),
    save: (snippet: {
      id?: string;
      name: string;
      description?: string;
      tags?: string[];
      body: string;
    }): Promise<{ success: boolean; id?: string; error?: string }> =>
      ipcRenderer.invoke('snippets.save', snippet),
    delete: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('snippets.delete', id),
  },

  // Starred/bookmarked messages (Claude Cowork parity Phase 3 step 4)
  bookmarks: {
    toggle: (entry: {
      sessionId: string;
      projectId?: string | null;
      messageId: string;
      preview: string;
      role?: string;
    }): Promise<{ bookmarked: boolean }> => ipcRenderer.invoke('bookmarks.toggle', entry),
    list: (
      projectId?: string | null,
      limit?: number
    ): Promise<
      Array<{
        id: number;
        sessionId: string;
        projectId?: string | null;
        messageId: string;
        preview: string;
        note?: string | null;
        role?: string | null;
        createdAt: number;
      }>
    > => ipcRenderer.invoke('bookmarks.list', projectId, limit),
    forSession: (sessionId: string): Promise<string[]> =>
      ipcRenderer.invoke('bookmarks.forSession', sessionId),
    updateNote: (id: number, note: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('bookmarks.updateNote', id, note),
    remove: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('bookmarks.remove', id),
  },

  // Git panel + commit composer (Claude Cowork parity Phase 3 step 2)
  git: {
    status: (
      cwd: string
    ): Promise<{
      isRepo: boolean;
      branch: string | null;
      upstream: string | null;
      ahead: number;
      behind: number;
      files: Array<{
        path: string;
        oldPath?: string;
        indexStatus: string;
        workingStatus: string;
        staged: boolean;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('git.status', cwd),
    stage: (cwd: string, files: string[]): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git.stage', cwd, files),
    unstage: (cwd: string, files: string[]): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git.unstage', cwd, files),
    diff: (cwd: string, file: string, staged: boolean): Promise<string> =>
      ipcRenderer.invoke('git.diff', cwd, file, staged),
    commit: (
      cwd: string,
      message: string,
      amend?: boolean
    ): Promise<{ success: boolean; error?: string; hash?: string }> =>
      ipcRenderer.invoke('git.commit', cwd, message, amend),
    suggestMessage: (cwd: string): Promise<{ message: string }> =>
      ipcRenderer.invoke('git.suggestMessage', cwd),
    branches: (cwd: string): Promise<string[]> => ipcRenderer.invoke('git.branches', cwd),
    worktrees: (
      cwd: string
    ): Promise<
      Array<{
        path: string;
        branch: string;
        head: string;
        bare: boolean;
        detached: boolean;
        locked: boolean;
        prunable: boolean;
      }>
    > => ipcRenderer.invoke('git.worktrees', cwd),
    addWorktree: (
      cwd: string,
      targetPath: string,
      branch?: string
    ): Promise<{ success: boolean; error?: string; path?: string; branch?: string }> =>
      ipcRenderer.invoke('git.worktreeAdd', cwd, targetPath, branch),
    removeWorktree: (
      cwd: string,
      targetPath: string,
      force?: boolean
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git.worktreeRemove', cwd, targetPath, force),
    pruneWorktrees: (cwd: string): Promise<{ success: boolean; output?: string; error?: string }> =>
      ipcRenderer.invoke('git.worktreePrune', cwd),
  },

  // Hunk-level diff accept/reject (Claude Cowork parity Phase 3 step 1)
  diff: {
    parseHunks: (
      excerpt: string
    ): Promise<{
      hunks: Array<{
        index: number;
        header: string;
        oldStart: number;
        oldCount: number;
        newStart: number;
        newCount: number;
        lines: string[];
        body: string;
      }>;
      preamble: string;
    }> => ipcRenderer.invoke('diff.parseHunks', excerpt),
    revertHunks: (
      filePath: string,
      hunks: Array<{
        index: number;
        header: string;
        oldStart: number;
        oldCount: number;
        newStart: number;
        newCount: number;
        lines: string[];
        body: string;
      }>
    ): Promise<{ success: boolean; method: 'git' | 'manual' | 'none'; error?: string }> =>
      ipcRenderer.invoke('diff.revertHunks', filePath, hunks),
  },

  // Slash commands (Claude Cowork parity Phase 2)
  command: {
    list: (): Promise<
      Array<{
        name: string;
        description: string;
        prompt: string;
        category?: string;
        isBuiltin: boolean;
        arguments?: Array<{
          name: string;
          description: string;
          required: boolean;
          default?: string;
        }>;
      }>
    > => ipcRenderer.invoke('command.list'),
    autocomplete: (
      prefix: string,
      limit?: number
    ): Promise<
      Array<{
        name: string;
        description: string;
        prompt: string;
        category?: string;
        isBuiltin: boolean;
      }>
    > => ipcRenderer.invoke('command.autocomplete', prefix, limit),
    execute: (
      name: string,
      args: string[],
      sessionId?: string
    ): Promise<{
      success: boolean;
      prompt?: string;
      message?: string;
      error?: string;
      handled?: boolean;
      action?: {
        type: 'open_schedule' | 'create_schedule';
        draft?: {
          prompt: string;
          cwd?: string;
          scheduleMode: 'once' | 'daily' | 'weekly';
          runAt?: string;
          selectedTimes?: string[];
          selectedWeekdays?: number[];
          enabled?: boolean;
        };
        createInput?: {
          prompt: string;
          cwd?: string;
          runAt: number;
          nextRunAt: number;
          scheduleConfig:
            | {
                kind: 'daily';
                times: string[];
              }
            | {
                kind: 'weekly';
                weekdays: number[];
                times: string[];
              }
            | null;
          enabled: boolean;
        };
      };
    }> => ipcRenderer.invoke('command.execute', name, args, sessionId),
  },

  // Project memory entries (Claude Cowork parity)
  memory: {
    list: (
      projectId?: string
    ): Promise<
      Array<{ category: string; content: string; sourceSessionId?: string; timestamp: number }>
    > => ipcRenderer.invoke('memory.list', projectId),
    // Phase 2 step 17: inline memory editor
    add: (
      category: 'preference' | 'pattern' | 'context' | 'decision',
      content: string,
      projectId?: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('memory.add', category, content, projectId),
    update: (
      entryIndex: number,
      newContent: string,
      newCategory?: 'preference' | 'pattern' | 'context' | 'decision',
      projectId?: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('memory.update', entryIndex, newContent, newCategory, projectId),
    delete: (
      entryIndex: number,
      projectId?: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('memory.delete', entryIndex, projectId),
  },

  // Knowledge base (Claude Cowork parity)
  knowledge: {
    list: (projectId?: string): Promise<Array<Record<string, unknown>>> =>
      ipcRenderer.invoke('knowledge.list', projectId),
    get: (id: string, projectId?: string): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke('knowledge.get', id, projectId),
    create: (
      input: {
        title: string;
        content: string;
        tags?: string[];
        scope?: string[];
        priority?: number;
      },
      projectId?: string
    ): Promise<Record<string, unknown>> => ipcRenderer.invoke('knowledge.create', input, projectId),
    update: (
      id: string,
      updates: Record<string, unknown>,
      projectId?: string
    ): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke('knowledge.update', id, updates, projectId),
    delete: (id: string, projectId?: string): Promise<boolean> =>
      ipcRenderer.invoke('knowledge.delete', id, projectId),
    search: (
      query: string,
      projectId?: string,
      limit?: number
    ): Promise<Array<Record<string, unknown>>> =>
      ipcRenderer.invoke('knowledge.search', query, projectId, limit),
  },
});

// Type declaration for the renderer process
declare global {
  interface Window {
    electronAPI: {
      send: (event: ClientEvent) => void;
      on: (callback: (event: ServerEvent) => void) => () => void;
      invoke: <T>(event: ClientEvent) => Promise<T>;
      platform: NodeJS.Platform;
      getSystemTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
      getVersion: () => Promise<string>;
      openExternal: (url: string) => Promise<boolean>;
      showItemInFolder: (filePath: string, cwd?: string) => Promise<boolean>;
      selectFiles: () => Promise<string[]>;
      artifacts: {
        listRecentFiles: (
          cwd: string,
          sinceMs: number,
          limit?: number
        ) => Promise<Array<{ path: string; modifiedAt: number; size: number }>>;
      };
      presence: {
        enroll: (payload: {
          name: string;
          aliases?: string[];
          embedding: number[];
          snapshotPath?: string;
        }) => Promise<unknown>;
        addSample: (payload: {
          personId: string;
          embedding: number[];
          snapshotPath?: string;
        }) => Promise<unknown>;
        encode: (payload: { rgbBytes: number[] }) => Promise<number[]>;
        match: (payload: {
          embedding: number[];
          threshold?: number;
        }) => Promise<unknown>;
        list: () => Promise<unknown[]>;
        remove: (payload: { personId: string }) => Promise<boolean>;
        hasModel: () => Promise<{ installed: boolean; path: string }>;
        selectModelFile: () => Promise<string | null>;
        installModelFromPath: (
          payload: { sourcePath: string },
        ) => Promise<{ ok: boolean; error?: string; installedPath?: string }>;
        downloadModel: (
          payload: { url: string },
        ) => Promise<{ ok: boolean; error?: string; installedPath?: string }>;
        onDownloadProgress: (
          listener: (progress: { bytes: number; total: number | null }) => void,
        ) => () => void;
        onEvent: (
          listener: (event: {
            type: 'detected' | 'unknown' | 'left' | 'enrolled';
            match?: {
              personId: string;
              name: string;
              aliases: string[];
              confidence: number;
              matchedAt: number;
            };
            timestamp: number;
          }) => void,
        ) => () => void;
      };
      codebuddy: {
        setGeminiGrounding: (
          payload: { enabled: boolean },
        ) => Promise<{ ok: boolean; reason?: string }>;
      };
      config: {
        get: () => Promise<AppConfig>;
        getPresets: () => Promise<ProviderPresets>;
        save: (config: Partial<AppConfig>) => Promise<{ success: boolean; config: AppConfig }>;
        createSet: (payload: CreateSetPayload) => Promise<{ success: boolean; config: AppConfig }>;
        renameSet: (payload: {
          id: string;
          name: string;
        }) => Promise<{ success: boolean; config: AppConfig }>;
        deleteSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
        switchSet: (payload: { id: string }) => Promise<{ success: boolean; config: AppConfig }>;
        isConfigured: () => Promise<boolean>;
        test: (config: ApiTestInput) => Promise<ApiTestResult>;
        listModels: (payload: {
          provider: AppConfig['provider'];
          apiKey: string;
          baseUrl?: string;
        }) => Promise<ProviderModelInfo[]>;
        diagnose: (input: DiagnosticInput) => Promise<DiagnosticResult>;
        discoverLocal: (payload?: { baseUrl?: string }) => Promise<LocalOllamaDiscoveryResult>;
        discoverLocalLmStudio: (payload?: { baseUrl?: string }) => Promise<LocalLmStudioDiscoveryResult>;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
      mcp: {
        getServers: () => Promise<McpServerConfig[]>;
        getServer: (serverId: string) => Promise<McpServerConfig | undefined>;
        saveServer: (config: McpServerConfig) => Promise<{ success: boolean; error?: string }>;
        deleteServer: (serverId: string) => Promise<{ success: boolean }>;
        getTools: () => Promise<McpTool[]>;
        getServerStatus: () => Promise<McpServerStatus[]>;
        getPresets: () => Promise<McpPresetsMap>;
        registry: () => Promise<Array<Record<string, unknown>>>;
        registrySearch: (query: string) => Promise<Array<Record<string, unknown>>>;
        registryGet: (id: string) => Promise<Record<string, unknown> | null>;
        registryInstall: (
          id: string,
          envOverrides?: Record<string, string>
        ) => Promise<{ success: boolean; serverId?: string; error?: string }>;
        registryUninstall: (id: string) => Promise<{ success: boolean; error?: string }>;
        registrySetEnabled: (
          id: string,
          enabled: boolean
        ) => Promise<{ success: boolean; error?: string }>;
        registryTools: (
          id: string
        ) => Promise<
          Array<{ name: string; description?: string; serverId: string; serverName: string }>
        >;
        listAllTools: () => Promise<
          Array<{
            name: string;
            description?: string;
            serverId: string;
            serverName: string;
            inputSchema?: unknown;
          }>
        >;
        invokeTool: (
          toolName: string,
          args: Record<string, unknown>
        ) => Promise<{
          success: boolean;
          durationMs: number;
          result?: unknown;
          error?: string;
        }>;
      };
      skills: {
        getAll: () => Promise<Skill[]>;
        install: (skillPath: string) => Promise<{ success: boolean; skill: Skill }>;
        delete: (skillId: string) => Promise<{ success: boolean }>;
        setEnabled: (skillId: string, enabled: boolean) => Promise<{ success: boolean }>;
        validate: (skillPath: string) => Promise<{ valid: boolean; errors: string[] }>;
        getStoragePath: () => Promise<string>;
        setStoragePath: (
          targetPath: string,
          migrate?: boolean
        ) => Promise<{
          success: boolean;
          path: string;
          migratedCount: number;
          skippedCount: number;
          error?: string;
        }>;
        openStoragePath: () => Promise<{ success: boolean; path: string; error?: string }>;
      };
      plugins: {
        listCatalog: (options?: { installableOnly?: boolean }) => Promise<PluginCatalogItemV2[]>;
        listInstalled: () => Promise<InstalledPlugin[]>;
        install: (pluginName: string) => Promise<PluginInstallResultV2>;
        setEnabled: (pluginId: string, enabled: boolean) => Promise<PluginToggleResult>;
        setComponentEnabled: (
          pluginId: string,
          component: PluginComponentKind,
          enabled: boolean
        ) => Promise<PluginToggleResult>;
        uninstall: (pluginId: string) => Promise<{ success: boolean }>;
      };
      sandbox: {
        getStatus: () => Promise<{
          platform: string;
          mode: string;
          initialized: boolean;
          wsl?: {
            available: boolean;
            distro?: string;
            nodeAvailable?: boolean;
            version?: string;
            pythonAvailable?: boolean;
            pythonVersion?: string;
            pipAvailable?: boolean;
            claudeCodeAvailable?: boolean;
          };
          lima?: {
            available: boolean;
            instanceExists?: boolean;
            instanceRunning?: boolean;
            instanceName?: string;
            nodeAvailable?: boolean;
            version?: string;
            pythonAvailable?: boolean;
            pythonVersion?: string;
            pipAvailable?: boolean;
            claudeCodeAvailable?: boolean;
          };
          error?: string;
        }>;
        checkWSL: () => Promise<{
          available: boolean;
          distro?: string;
          nodeAvailable?: boolean;
          version?: string;
          pythonAvailable?: boolean;
          pythonVersion?: string;
          pipAvailable?: boolean;
          claudeCodeAvailable?: boolean;
        }>;
        checkLima: () => Promise<{
          available: boolean;
          instanceExists?: boolean;
          instanceRunning?: boolean;
          instanceName?: string;
          nodeAvailable?: boolean;
          version?: string;
          pythonAvailable?: boolean;
          pythonVersion?: string;
          pipAvailable?: boolean;
          claudeCodeAvailable?: boolean;
        }>;
        installNodeInWSL: (distro: string) => Promise<boolean>;
        installPythonInWSL: (distro: string) => Promise<boolean>;
        installNodeInLima: () => Promise<boolean>;
        installPythonInLima: () => Promise<boolean>;
        startLimaInstance: () => Promise<boolean>;
        stopLimaInstance: () => Promise<boolean>;
        retrySetup: () => Promise<{ success: boolean; error?: string; result?: unknown }>;
        retryLimaSetup: () => Promise<{ success: boolean; error?: string; result?: unknown }>;
      };
      logs: {
        getPath: () => Promise<string | null>;
        getDirectory: () => Promise<string>;
        getAll: () => Promise<Array<{ name: string; path: string; size: number; mtime: Date }>>;
        export: () => Promise<{ success: boolean; path?: string; size?: number; error?: string }>;
        open: () => Promise<{ success: boolean; error?: string }>;
        clear: () => Promise<{ success: boolean; deletedCount?: number; error?: string }>;
        setEnabled: (
          enabled: boolean
        ) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
        isEnabled: () => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
        write: (
          level: 'info' | 'warn' | 'error',
          ...args: unknown[]
        ) => Promise<{ success: boolean; error?: string }>;
      };
      remote: {
        getConfig: () => Promise<RemoteConfig>;
        getStatus: () => Promise<{
          running: boolean;
          port?: number;
          publicUrl?: string;
          channels: Array<{ type: string; connected: boolean; error?: string }>;
          activeSessions: number;
          pendingPairings: number;
        }>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
        updateGatewayConfig: (
          config: Partial<GatewayConfig>
        ) => Promise<{ success: boolean; error?: string }>;
        updateFeishuConfig: (
          config: FeishuChannelConfig
        ) => Promise<{ success: boolean; error?: string }>;
        getPairedUsers: () => Promise<PairedUser[]>;
        getPendingPairings: () => Promise<PairingRequest[]>;
        approvePairing: (
          channelType: string,
          userId: string
        ) => Promise<{ success: boolean; error?: string }>;
        revokePairing: (
          channelType: string,
          userId: string
        ) => Promise<{ success: boolean; error?: string }>;
        getRemoteSessions: () => Promise<RemoteSessionMapping[]>;
        clearRemoteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        getTunnelStatus: () => Promise<{
          connected: boolean;
          url: string | null;
          provider: string;
          error?: string;
        }>;
        getWebhookUrl: () => Promise<string | null>;
        restart: () => Promise<{ success: boolean; error?: string }>;
      };
      schedule: {
        list: () => Promise<ScheduleTask[]>;
        create: (payload: ScheduleCreateInput) => Promise<ScheduleTask>;
        update: (id: string, updates: ScheduleUpdateInput) => Promise<ScheduleTask | null>;
        delete: (id: string) => Promise<{ success: boolean }>;
        toggle: (id: string, enabled: boolean) => Promise<ScheduleTask | null>;
        runNow: (id: string) => Promise<ScheduleTask | null>;
      };
      checkpoint: {
        list: () => Promise<unknown>;
        undo: () => Promise<unknown>;
        redo: () => Promise<unknown>;
        restore: (snapshotId: string) => Promise<unknown>;
        compare: (
          cwd: string,
          fromCommit: string,
          toCommit: string
        ) => Promise<
          Array<{
            path: string;
            action: 'create' | 'modify' | 'delete' | 'rename';
            linesAdded: number;
            linesRemoved: number;
            excerpt: string;
          }>
        >;
      };
      workspace: {
        readDir: (
          dirPath: string
        ) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
      };
      permission: {
        setMode: (mode: string) => Promise<void>;
        respondBridge: (id: string, response: string) => void;
      };
      model: {
        switch: (model: string) => Promise<boolean>;
        capabilities: (model: string) => Promise<{
          model: string;
          supportsVision: boolean;
          supportsReasoning: boolean;
          supportsToolCalls: boolean;
          contextWindow: number;
          maxOutputTokens: number;
        }>;
      };
      session: {
        export: (sessionId: string, format: 'md' | 'json') => Promise<unknown>;
        exportFull: (
          sessionId: string,
          options: {
            format: 'markdown' | 'json' | 'html';
            redactSecrets?: boolean;
            includeCheckpoints?: boolean;
          }
        ) => Promise<{ success: boolean; content: string; filename: string; error?: string }>;
        exportToFile: (
          sessionId: string,
          options: {
            format: 'markdown' | 'json' | 'html';
            redactSecrets?: boolean;
            includeCheckpoints?: boolean;
          }
        ) => Promise<{ success: boolean; error?: string; path?: string }>;
        startBackground: (payload: {
          title: string;
          prompt: string;
          cwd?: string;
          projectId?: string;
        }) => Promise<unknown>;
        updateSettings: (
          sessionId: string,
          updates: {
            projectId?: string | null;
            executionMode?: 'chat' | 'task';
            isBackground?: boolean;
            title?: string;
          }
        ) => Promise<boolean>;
        branches: (sessionId: string) => Promise<
          Array<{
            id: string;
            name: string;
            parentId?: string;
            parentMessageIndex?: number;
            createdAt: number;
            updatedAt: number;
            messageCount: number;
            isCurrent: boolean;
          }>
        >;
        fork: (
          sessionId: string,
          name: string,
          fromMessageIndex?: number
        ) => Promise<{ success: boolean; branch?: Record<string, unknown>; error?: string }>;
        checkout: (
          sessionId: string,
          branchId: string
        ) => Promise<{ success: boolean; error?: string }>;
        mergeBranch: (
          sessionId: string,
          sourceBranchId: string,
          strategy?: 'append' | 'replace'
        ) => Promise<{ success: boolean; error?: string }>;
        deleteBranch: (
          sessionId: string,
          branchId: string
        ) => Promise<{ success: boolean; error?: string }>;
        renameBranch: (
          sessionId: string,
          branchId: string,
          newName: string
        ) => Promise<{ success: boolean; error?: string }>;
      };
      update: {
        check: () => Promise<unknown>;
        download: () => Promise<void>;
        install: () => void;
      };
      project: {
        list: () => Promise<{ projects: Project[] }>;
        get: (id: string) => Promise<Project | null>;
        create: (input: ProjectCreateInput) => Promise<Project>;
        update: (id: string, updates: ProjectUpdateInput) => Promise<Project | null>;
        delete: (id: string) => Promise<boolean>;
        setActive: (id: string | null) => Promise<Project | null>;
        getActive: () => Promise<Project | null>;
      };
      subAgent: {
        list: () => Promise<Array<Record<string, unknown>>>;
        spawn: (options: {
          sessionId: string;
          prompt: string;
          role?: string;
          forkContext?: boolean;
          parentId?: string;
        }) => Promise<Record<string, unknown>>;
        sendInput: (agentId: string, message: string, interrupt?: boolean) => Promise<boolean>;
        close: (agentId: string) => Promise<boolean>;
        resume: (agentId: string, prompt?: string) => Promise<boolean>;
        wait: (agentIds: string[], timeoutMs?: number) => Promise<Array<Record<string, unknown>>>;
      };
      orchestrator: {
        run: (
          sessionId: string,
          goal: string,
          options?: Record<string, unknown>
        ) => Promise<Record<string, unknown>>;
        isComplex: (goal: string) => Promise<boolean>;
      };
      mention: {
        process: (
          text: string,
          cwd?: string
        ) => Promise<{
          cleanedText: string;
          contextBlocks: Array<{ type: string; content: string; source: string }>;
        }>;
        autocomplete: (
          prefix: string,
          cwd?: string,
          limit?: number
        ) => Promise<
          Array<{ label: string; value: string; description?: string; category: string }>
        >;
      };
      rules: {
        list: (projectId?: string) => Promise<{ allow: string[]; deny: string[] }>;
        add: (
          bucket: 'allow' | 'deny',
          rule: string,
          projectId?: string
        ) => Promise<{ success: boolean; error?: string }>;
        remove: (
          bucket: 'allow' | 'deny',
          rule: string,
          projectId?: string
        ) => Promise<{ success: boolean; error?: string }>;
        update: (
          bucket: 'allow' | 'deny',
          oldRule: string,
          newRule: string,
          projectId?: string
        ) => Promise<{ success: boolean; error?: string }>;
        test: (
          toolName: string,
          toolArgs: Record<string, unknown>,
          projectId?: string
        ) => Promise<{ decision: 'allow' | 'ask' | 'deny'; matchedRule?: string }>;
      };
      cost: {
        summary: () => Promise<{
          sessionCost: number;
          dailyCost: number;
          weeklyCost: number;
          monthlyCost: number;
          totalCost: number;
          sessionTokens: { input: number; output: number };
          modelBreakdown: Record<string, { cost: number; calls: number }>;
          budgetLimit?: number;
          dailyLimit?: number;
        }>;
        history: (days?: number) => Promise<
          Array<{
            date: string;
            cost: number;
            inputTokens: number;
            outputTokens: number;
            calls: number;
          }>
        >;
        modelBreakdown: (days?: number) => Promise<
          Array<{
            model: string;
            cost: number;
            calls: number;
            inputTokens: number;
            outputTokens: number;
          }>
        >;
        setBudget: (monthlyLimit: number) => Promise<{ success: boolean }>;
        setDailyLimit: (limit: number) => Promise<{ success: boolean }>;
        record: (
          inputTokens: number,
          outputTokens: number,
          model: string,
          cost?: number
        ) => Promise<{ success: boolean }>;
      };
      skillMd: {
        list: () => Promise<
          Array<{
            name: string;
            description: string;
            tier: string;
            filePath?: string;
            tags?: string[];
            requires?: string[];
          }>
        >;
        search: (
          query: string,
          limit?: number
        ) => Promise<
          Array<{
            skill: {
              name: string;
              description: string;
              tier: string;
              filePath?: string;
              tags?: string[];
            };
            score: number;
          }>
        >;
        findBest: (request: string) => Promise<{
          skill: {
            name: string;
            description: string;
            tier: string;
            filePath?: string;
            tags?: string[];
          };
          confidence: number;
          matchedTriggers?: string[];
        } | null>;
        execute: (
          skillName: string,
          context: { userInput?: string; workspaceRoot?: string; sessionId?: string }
        ) => Promise<{ success: boolean; output?: string; error?: string; duration?: number }>;
      };
      search: {
        global: (
          query: string,
          limit?: number
        ) => Promise<{
          hits: Array<{
            source: 'session' | 'message' | 'memory' | 'knowledge' | 'file';
            id: string;
            title: string;
            snippet: string;
            score: number;
            context: {
              sessionId?: string;
              projectId?: string;
              messageIndex?: number;
              path?: string;
            };
          }>;
          totalByCategory: Record<'session' | 'message' | 'memory' | 'knowledge' | 'file', number>;
        }>;
      };
      configSync: {
        exportBundle: () => Promise<{
          success: boolean;
          bundle?: Record<string, unknown>;
          error?: string;
        }>;
        exportToFile: () => Promise<{
          success: boolean;
          error?: string;
          bundle?: Record<string, unknown>;
        }>;
        importFromFile: () => Promise<{
          success: boolean;
          error?: string;
          preview?: {
            bundle: Record<string, unknown>;
            conflicts: Array<{
              type: string;
              identifier: string;
              current?: unknown;
              incoming: unknown;
            }>;
            newProjects: number;
            newMcpServers: number;
          };
        }>;
        applyImport: (
          bundle: Record<string, unknown>,
          strategy: 'skip' | 'overwrite'
        ) => Promise<{
          success: boolean;
          imported: { projects: number; mcpServers: number; apiUpdated: boolean };
          errors: string[];
        }>;
      };
      activity: {
        recent: (
          limit?: number,
          projectId?: string
        ) => Promise<
          Array<{
            id: number;
            type: string;
            title: string;
            description?: string;
            sessionId?: string;
            projectId?: string;
            metadata?: Record<string, unknown>;
            timestamp: number;
          }>
        >;
        clear: () => Promise<{ success: boolean }>;
      };
      sessionInsights: {
        list: (limit?: number) => Promise<
          Array<{
            sessionId: string;
            title: string;
            status: 'idle' | 'running' | 'completed' | 'error';
            model?: string;
            cwd?: string;
            createdAt: number;
            updatedAt: number;
            messageCount: number;
            userMessageCount: number;
            assistantMessageCount: number;
            toolCallCount: number;
            tokenInput: number;
            tokenOutput: number;
            totalTokens: number;
            totalExecutionTimeMs: number;
            transcriptPreview: string;
          }>
        >;
        search: (
          query: string,
          limit?: number
        ) => Promise<
          Array<{
            sessionId: string;
            title: string;
            status: 'idle' | 'running' | 'completed' | 'error';
            model?: string;
            cwd?: string;
            createdAt: number;
            updatedAt: number;
            messageCount: number;
            userMessageCount: number;
            assistantMessageCount: number;
            toolCallCount: number;
            tokenInput: number;
            tokenOutput: number;
            totalTokens: number;
            totalExecutionTimeMs: number;
            transcriptPreview: string;
          }>
        >;
        detail: (sessionId: string) => Promise<{
          summary: {
            sessionId: string;
            title: string;
            status: 'idle' | 'running' | 'completed' | 'error';
            model?: string;
            cwd?: string;
            createdAt: number;
            updatedAt: number;
            messageCount: number;
            userMessageCount: number;
            assistantMessageCount: number;
            toolCallCount: number;
            tokenInput: number;
            tokenOutput: number;
            totalTokens: number;
            totalExecutionTimeMs: number;
            transcriptPreview: string;
          };
          messages: import('../renderer/types').Message[];
          traceSteps: import('../renderer/types').TraceStep[];
        } | null>;
        audit: (sessionId: string) => Promise<{
          sessionId: string;
          issueCount: number;
          orphanToolResults: number;
          missingToolResults: number;
          emptyMessages: number;
          issues: Array<{
            kind: 'orphan_tool_result' | 'missing_tool_result' | 'empty_message';
            messageId?: string;
            toolUseId?: string;
            detail: string;
          }>;
        } | null>;
        repair: (sessionId: string) => Promise<{
          sessionId: string;
          changed: boolean;
          removedOrphanToolResults: number;
          injectedSyntheticToolResults: number;
          removedEmptyMessages: number;
          messages: import('../renderer/types').Message[];
          audit: {
            sessionId: string;
            issueCount: number;
            orphanToolResults: number;
            missingToolResults: number;
            emptyMessages: number;
            issues: Array<{
              kind: 'orphan_tool_result' | 'missing_tool_result' | 'empty_message';
              messageId?: string;
              toolUseId?: string;
              detail: string;
            }>;
          };
        } | null>;
      };
      workflow: {
        list: () => Promise<
          Array<{
            id: string;
            name: string;
            description?: string;
            nodes: Array<{
              id: string;
              type: 'tool' | 'condition' | 'parallel' | 'approval' | 'start' | 'end';
              name: string;
              position: { x: number; y: number };
              config?: Record<string, unknown>;
            }>;
            edges: Array<{ id: string; source: string; target: string; label?: string }>;
            createdAt: number;
            updatedAt: number;
          }>
        >;
        get: (id: string) => Promise<unknown>;
        create: (input: {
          name: string;
          description?: string;
          nodes: Array<unknown>;
          edges: Array<unknown>;
        }) => Promise<unknown>;
        update: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
        delete: (id: string) => Promise<boolean>;
        run: (
          id: string,
          initialContext?: Record<string, unknown>
        ) => Promise<{
          success: boolean;
          status: string;
          duration: number;
          completedSteps: number;
          totalSteps: number;
          error?: string;
        }>;
        approve: (stepId: string, approved: boolean) => Promise<boolean>;
      };
      template: {
        list: () => Promise<
          Array<{
            name: string;
            description: string;
            tier: string;
            tags: string[];
            language?: string;
            filePath?: string;
          }>
        >;
        preview: (name: string) => Promise<{ content: string; filePath?: string } | null>;
        create: (
          name: string,
          workspaceRoot: string
        ) => Promise<{ success: boolean; output?: string; error?: string }>;
      };
      preview: {
        get: (filePath: string) => Promise<{
          kind: 'text' | 'image' | 'pdf' | 'binary' | 'error';
          path: string;
          name: string;
          size: number;
          mime: string;
          text?: string;
          lineCount?: number;
          language?: string;
          dataUri?: string;
          dimensions?: { width: number; height: number };
          pdfText?: string;
          pdfPages?: number;
          error?: string;
        }>;
      };
      workspacePresets: {
        list: () => Promise<
          Array<{
            id: string;
            name: string;
            description?: string;
            workspacePath?: string;
            model?: string;
            permissionMode?: string;
            memoryScope?: 'project' | 'global' | 'none';
            createdAt: number;
            updatedAt: number;
          }>
        >;
        save: (preset: {
          id?: string;
          name: string;
          description?: string;
          workspacePath?: string;
          model?: string;
          permissionMode?: string;
          memoryScope?: 'project' | 'global' | 'none';
        }) => Promise<{
          success: boolean;
          preset?: {
            id: string;
            name: string;
            description?: string;
            workspacePath?: string;
            model?: string;
            permissionMode?: string;
            memoryScope?: 'project' | 'global' | 'none';
            createdAt: number;
            updatedAt: number;
          };
          error?: string;
        }>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      a2a: {
        list: () => Promise<
          Array<{
            id: string;
            url: string;
            addedAt: number;
            lastPingAt?: number;
            lastStatus?: 'ok' | 'error' | 'unknown';
            lastError?: string;
            card: {
              name: string;
              description: string;
              url: string;
              version: string;
              skills: Array<{ id: string; name: string; description?: string }>;
            };
          }>
        >;
        discover: (url: string) => Promise<{
          success: boolean;
          card?: unknown;
          error?: string;
        }>;
        add: (url: string) => Promise<{
          success: boolean;
          agent?: unknown;
          error?: string;
        }>;
        remove: (id: string) => Promise<{ success: boolean }>;
        ping: (id: string) => Promise<{
          success: boolean;
          status?: string;
          error?: string;
        }>;
        invoke: (
          id: string,
          message: string
        ) => Promise<{
          success: boolean;
          taskId?: string;
          status?: string;
          result?: string;
          error?: string;
        }>;
        cancelTask: (
          id: string,
          taskId: string
        ) => Promise<{ success: boolean; error?: string }>;
        listTasks: () => Promise<
          Array<{
            taskId: string;
            agentId: string;
            agentName?: string;
            status: string;
            startedAt: number;
            updatedAt: number;
            result?: string;
            error?: string;
          }>
        >;
      };
      fleet: {
        list: () => Promise<
          Array<{
            id: string;
            url: string;
            label?: string;
            addedAt: number;
            status: string;
            lastError?: string;
            lastSeenAt?: number;
            lastEventType?: string;
          }>
        >;
        addPeer: (input: {
          url: string;
          apiKey?: string;
          jwt?: string;
          label?: string;
        }) => Promise<{ success: boolean; peer?: unknown; error?: string }>;
        removePeer: (peerId: string) => Promise<{ success: boolean }>;
        reconnect: (peerId: string) => Promise<{ success: boolean; error?: string }>;
        getEvents: (
          peerId?: string,
          limit?: number
        ) => Promise<
          Array<{
            peerId: string;
            type: string;
            payload: Record<string, unknown>;
            receivedAt: number;
            hostname?: string;
            agentId?: string;
          }>
        >;
      };
      team: {
        getStatus: () => Promise<unknown>;
        start: (
          goal?: string
        ) => Promise<{ success: boolean; leadId?: string; message: string }>;
        stop: () => Promise<{ success: boolean; message: string }>;
        addMember: (
          role: string,
          label?: string
        ) => Promise<{ success: boolean; memberId?: string; message: string }>;
        removeMember: (memberId: string) => Promise<{ success: boolean; message: string }>;
        addTask: (input: {
          title: string;
          description: string;
          priority?: string;
          assignedRole?: string;
          dependencies?: string[];
        }) => Promise<unknown>;
        updateTask: (
          taskId: string,
          updates: { status?: string; assignedTo?: string; result?: string; error?: string }
        ) => Promise<{ success: boolean; message: string }>;
        assignTask: (
          taskId: string,
          memberId: string
        ) => Promise<{ success: boolean; message: string }>;
        sendMessage: (from: string, to: string, content: string) => Promise<unknown>;
        getInbox: (memberId: string, limit?: number) => Promise<unknown[]>;
      };
      reasoning: {
        listTraces: () => Promise<
          Array<{
            toolUseId: string;
            sessionId: string;
            problem: string;
            mode: string;
            startedAt: number;
            endedAt?: number;
            iterations?: number;
          }>
        >;
        getTrace: (toolUseId: string) => Promise<unknown | null>;
        clear: () => Promise<{ success: boolean }>;
      };
      hooks: {
        list: () => Promise<
          Array<{
            id: string;
            event: string;
            index: number;
            handler: {
              type: string;
              command?: string;
              url?: string;
              prompt?: string;
              if?: string;
              timeout?: number;
            };
          }>
        >;
        upsert: (params: {
          event: string;
          handler: Record<string, unknown>;
          index?: number;
        }) => Promise<{ success: boolean; entry?: unknown; error?: string }>;
        remove: (params: {
          event: string;
          index: number;
        }) => Promise<{ success: boolean; error?: string }>;
        test: (handler: Record<string, unknown>) => Promise<{
          success: boolean;
          exitCode: number | null;
          stdout: string;
          stderr: string;
          durationMs: number;
          error?: string;
        }>;
      };
      test: {
        detect: () => Promise<string | null>;
        run: (files?: string[]) => Promise<unknown>;
        runFailing: () => Promise<unknown>;
        cancel: () => Promise<{ success: boolean }>;
        getState: () => Promise<{
          framework: string | null;
          lastResult: unknown | null;
          isRunning: boolean;
        } | null>;
      };
      identity: {
        list: () => Promise<
          Array<{
            id: string;
            name: string;
            description?: string;
            filePath: string;
            source: 'workspace' | 'global';
            kind: 'identity' | 'persona';
            mtime: number;
            size: number;
            active: boolean;
          }>
        >;
        getDetail: (id: string) => Promise<{
          id: string;
          name: string;
          description?: string;
          filePath: string;
          source: 'workspace' | 'global';
          kind: 'identity' | 'persona';
          mtime: number;
          size: number;
          active: boolean;
          content: string;
        } | null>;
        activate: (id: string) => Promise<{ success: boolean; error?: string }>;
        deactivate: () => Promise<{ success: boolean }>;
        getActive: () => Promise<unknown | null>;
      };
      audit: {
        listRuns: (filter?: {
          limit?: number;
          status?: 'running' | 'completed' | 'failed' | 'cancelled';
          sessionId?: string;
          sinceTs?: number;
          untilTs?: number;
        }) => Promise<
          Array<{
            runId: string;
            objective: string;
            status: 'running' | 'completed' | 'failed' | 'cancelled';
            startedAt: number;
            endedAt?: number;
            durationMs?: number;
            eventCount: number;
            artifactCount: number;
            channel?: string;
            sessionId?: string;
            userId?: string;
            tags?: string[];
            totalCost?: number;
            totalTokens?: number;
            toolCallCount?: number;
          }>
        >;
        getRunDetail: (runId: string) => Promise<unknown | null>;
        exportCsv: (filter?: Record<string, unknown>) => Promise<string>;
      };
      customCommands: {
        list: () => Promise<
          Array<{
            name: string;
            description: string;
            prompt: string;
            category?: string;
            isBuiltin: boolean;
          }>
        >;
        save: (cmd: {
          name: string;
          description: string;
          body: string;
        }) => Promise<{ success: boolean; error?: string }>;
        delete: (name: string) => Promise<{ success: boolean; error?: string }>;
      };
      snippets: {
        list: () => Promise<
          Array<{
            id: string;
            name: string;
            description?: string;
            tags: string[];
            body: string;
            updatedAt: number;
          }>
        >;
        get: (id: string) => Promise<{
          id: string;
          name: string;
          description?: string;
          tags: string[];
          body: string;
          updatedAt: number;
        } | null>;
        save: (snippet: {
          id?: string;
          name: string;
          description?: string;
          tags?: string[];
          body: string;
        }) => Promise<{ success: boolean; id?: string; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean; error?: string }>;
      };
      bookmarks: {
        toggle: (entry: {
          sessionId: string;
          projectId?: string | null;
          messageId: string;
          preview: string;
          role?: string;
        }) => Promise<{ bookmarked: boolean }>;
        list: (
          projectId?: string | null,
          limit?: number
        ) => Promise<
          Array<{
            id: number;
            sessionId: string;
            projectId?: string | null;
            messageId: string;
            preview: string;
            note?: string | null;
            role?: string | null;
            createdAt: number;
          }>
        >;
        forSession: (sessionId: string) => Promise<string[]>;
        updateNote: (id: number, note: string) => Promise<{ success: boolean }>;
        remove: (id: number) => Promise<{ success: boolean }>;
      };
      git: {
        status: (cwd: string) => Promise<{
          isRepo: boolean;
          branch: string | null;
          upstream: string | null;
          ahead: number;
          behind: number;
          files: Array<{
            path: string;
            oldPath?: string;
            indexStatus: string;
            workingStatus: string;
            staged: boolean;
          }>;
          error?: string;
        }>;
        stage: (cwd: string, files: string[]) => Promise<{ success: boolean; error?: string }>;
        unstage: (cwd: string, files: string[]) => Promise<{ success: boolean; error?: string }>;
        diff: (cwd: string, file: string, staged: boolean) => Promise<string>;
        commit: (
          cwd: string,
          message: string,
          amend?: boolean
        ) => Promise<{ success: boolean; error?: string; hash?: string }>;
        suggestMessage: (cwd: string) => Promise<{ message: string }>;
        branches: (cwd: string) => Promise<string[]>;
        worktrees: (cwd: string) => Promise<
          Array<{
            path: string;
            branch: string;
            head: string;
            bare: boolean;
            detached: boolean;
            locked: boolean;
            prunable: boolean;
          }>
        >;
        addWorktree: (
          cwd: string,
          targetPath: string,
          branch?: string
        ) => Promise<{ success: boolean; error?: string; path?: string; branch?: string }>;
        removeWorktree: (
          cwd: string,
          targetPath: string,
          force?: boolean
        ) => Promise<{ success: boolean; error?: string }>;
        pruneWorktrees: (
          cwd: string
        ) => Promise<{ success: boolean; output?: string; error?: string }>;
      };
      diff: {
        parseHunks: (excerpt: string) => Promise<{
          hunks: Array<{
            index: number;
            header: string;
            oldStart: number;
            oldCount: number;
            newStart: number;
            newCount: number;
            lines: string[];
            body: string;
          }>;
          preamble: string;
        }>;
        revertHunks: (
          filePath: string,
          hunks: Array<{
            index: number;
            header: string;
            oldStart: number;
            oldCount: number;
            newStart: number;
            newCount: number;
            lines: string[];
            body: string;
          }>
        ) => Promise<{ success: boolean; method: 'git' | 'manual' | 'none'; error?: string }>;
      };
      command: {
        list: () => Promise<
          Array<{
            name: string;
            description: string;
            prompt: string;
            category?: string;
            isBuiltin: boolean;
            arguments?: Array<{
              name: string;
              description: string;
              required: boolean;
              default?: string;
            }>;
          }>
        >;
        autocomplete: (
          prefix: string,
          limit?: number
        ) => Promise<
          Array<{
            name: string;
            description: string;
            prompt: string;
            category?: string;
            isBuiltin: boolean;
          }>
        >;
        execute: (
          name: string,
          args: string[],
          sessionId?: string
        ) => Promise<{
          success: boolean;
          prompt?: string;
          message?: string;
          error?: string;
          handled?: boolean;
          action?: {
            type: 'open_schedule' | 'create_schedule';
            draft?: {
              prompt: string;
              cwd?: string;
              scheduleMode: 'once' | 'daily' | 'weekly';
              runAt?: string;
              selectedTimes?: string[];
              selectedWeekdays?: number[];
              enabled?: boolean;
            };
            createInput?: {
              prompt: string;
              cwd?: string;
              runAt: number;
              nextRunAt: number;
              scheduleConfig:
                | {
                    kind: 'daily';
                    times: string[];
                  }
                | {
                    kind: 'weekly';
                    weekdays: number[];
                    times: string[];
                  }
                | null;
              enabled: boolean;
            };
          };
        }>;
      };
      memory: {
        list: (
          projectId?: string
        ) => Promise<
          Array<{ category: string; content: string; sourceSessionId?: string; timestamp: number }>
        >;
        add: (
          category: 'preference' | 'pattern' | 'context' | 'decision',
          content: string,
          projectId?: string
        ) => Promise<{ success: boolean; error?: string }>;
        update: (
          entryIndex: number,
          newContent: string,
          newCategory?: 'preference' | 'pattern' | 'context' | 'decision',
          projectId?: string
        ) => Promise<{ success: boolean; error?: string }>;
        delete: (
          entryIndex: number,
          projectId?: string
        ) => Promise<{ success: boolean; error?: string }>;
      };
      knowledge: {
        list: (projectId?: string) => Promise<Array<Record<string, unknown>>>;
        get: (id: string, projectId?: string) => Promise<Record<string, unknown> | null>;
        create: (
          input: {
            title: string;
            content: string;
            tags?: string[];
            scope?: string[];
            priority?: number;
          },
          projectId?: string
        ) => Promise<Record<string, unknown>>;
        update: (
          id: string,
          updates: Record<string, unknown>,
          projectId?: string
        ) => Promise<Record<string, unknown> | null>;
        delete: (id: string, projectId?: string) => Promise<boolean>;
        search: (
          query: string,
          projectId?: string,
          limit?: number
        ) => Promise<Array<Record<string, unknown>>>;
      };
    };
  }
}
