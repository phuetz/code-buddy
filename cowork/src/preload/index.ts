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
  ModelInventorySnapshot,
  LocalLmStudioDiscoveryResult,
  LocalOllamaDiscoveryResult,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  CompanionPercept,
  CompanionPerceptModality,
  CompanionPerceptStats,
  CompanionStatus,
  CompanionSelfEvaluation,
  CompanionCompetitiveRadar,
  CompanionCheckInCue,
  CompanionImpulseBrief,
  CompanionMission,
  CompanionMissionBoard,
  CompanionMissionBoardSyncResult,
  CompanionImprovementCycle,
  CompanionMissionRunResult,
  CompanionMissionStatus,
  CompanionSafetyEvent,
  CompanionSafetyEventKind,
  CompanionSafetyEventRisk,
  CompanionSafetyLedgerStats,
  CompanionSetupResponse,
  CompanionCard,
  CompanionCardKind,
  CompanionCardStatus,
  CompanionCardStore,
  CompanionGatewayMode,
  CompanionGatewayAdminExecutionResult,
  CompanionGatewayExecutableAdminAction,
  CompanionGatewayAdminPlan,
  CompanionGatewayInbox,
  CompanionGatewayInboxDraft,
  CompanionGatewayFleetDraft,
  CompanionGatewayLifecycleReport,
  CompanionGatewayOutboundReplyDraft,
  CompanionGatewayOutboundReplySendResult,
  CompanionGatewayProfile,
  OpenClawBridgeActionResult,
  OpenClawBridgeStatusResult,
  CompanionSkillCandidate,
  CompanionSkillCandidateStore,
  CompanionSkillCuratorResult,
  CompanionSkillPromotionResult,
  CompanionPrivacyExportResult,
  CompanionPrivacyKind,
  CompanionPrivacyPurgeResult,
  CompanionPrivacyReport,
  CameraSnapshotInspectionResult,
  CameraSnapshotResult,
  DesktopSnapshotCaptureOptions,
  DesktopSnapshotCaptureResult,
  DesktopSnapshotMethod,
  MissionRuntime,
  VoiceConversationEvent,
  VoiceConversationSnapshot,
} from '../renderer/types';
import type { DiagnosticInput, DiagnosticResult } from '../renderer/types';
import type {
  MissionCreateInput,
  MissionFilter,
  MissionStatus,
  SubTask,
} from '../main/missions/mission-types';
import type {
  McpServerConfig,
  McpTool,
  McpServerStatus,
  McpPresetsMap,
  RemoteConfig,
  GatewayConfig,
  FeishuChannelConfig,
  SlackChannelConfig,
  PairedUser,
  PairingRequest,
  RemoteSessionMapping,
} from '../shared/ipc-types';
import type { LessonCandidateApi, UserModelApi, SpecApi } from '../renderer/types/hermes';
import type {
  HermesPortalReviewPayload,
  HermesTrajectoriesReviewPayload,
  HermesDoctorReviewPayload,
  HermesMemoryProbeResponse,
  ClawMigrationReportPayload,
  ClawMigrationRunOptionsPayload,
  ClawMigrationRunResponse,
  HermesKanbanApi,
} from '../renderer/types/hermes';

type AssistantSettingGroup = 'voice' | 'speech' | 'behavior' | 'companion';
type AssistantSettingType = 'toggle' | 'enum' | 'text' | 'voice';
type AssistantEnvFile = 'vision' | 'lisa' | 'both';

interface AssistantSetting {
  key: string;
  label: string;
  group: AssistantSettingGroup;
  type: AssistantSettingType;
  options?: string[];
  default: string;
  envFile: AssistantEnvFile;
  help: string;
}

interface AssistantErrorResponse {
  ok: false;
  error: string;
}

interface AssistantConfigSuccessResponse {
  settings: AssistantSetting[];
  values: Record<string, string>;
  voices: string[];
}

interface AssistantConfigErrorResponse extends AssistantErrorResponse {
  settings: AssistantSetting[];
  values: Record<string, string>;
  voices: string[];
}

type AssistantConfigResponse = AssistantConfigSuccessResponse | AssistantConfigErrorResponse;

interface AssistantSaveSuccessResponse {
  vision: string[];
  lisa: string[];
}

type AssistantSaveResponse = AssistantSaveSuccessResponse | AssistantErrorResponse;
type AssistantPreviewResponse = string | null | AssistantErrorResponse;
type AssistantRestartResponse =
  | Array<{ service: string; ok: boolean; error?: string }>
  | AssistantErrorResponse;
type AssistantVolumeResponse = { volume: number | null } | AssistantErrorResponse;
type AssistantSetVolumeResponse = { ok: true; volume: number } | AssistantErrorResponse;

// Track registered callbacks to prevent duplicate listeners
let registeredCallback: ((event: ServerEvent) => void) | null = null;
let ipcListener: ((event: Electron.IpcRendererEvent, data: ServerEvent) => void) | null = null;

// Allowlist of valid ClientEvent types to prevent spoofing arbitrary IPC channels
const ALLOWED_CLIENT_EVENTS: ReadonlySet<string> = new Set<ClientEvent['type']>([
  'session.start',
  'session.continue',
  'session.steer',
  'session.stop',
  'session.delete',
  'session.batchDelete',
  'session.duplicate',
  'session.updateSettings',
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

// ── Threat Model: IPC Validation ──────────────────────────────────────────────
// While this preload exposes ~150 specific invoke wrappers, the actual validation
// of payloads, path traversals, and privileges is explicitly deferred to the
// Main process (`ipcMain.handle` listeners). This design ensures that the renderer
// cannot bypass security checks, as the ultimate source of truth and execution
// rights resides in the trusted Main process.
// ──────────────────────────────────────────────────────────────────────────────

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Send events to main process
  send: (event: ClientEvent) => {
    if (!ALLOWED_CLIENT_EVENTS.has(event.type)) {
      console.warn('[Preload] Blocked unauthorized event type:', event.type);
      return;
    }
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

  // Additional event subscription for panels that need their own live feed
  // without replacing the app-wide store listener registered through `on`.
  onEvent: (callback: (event: ServerEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: ServerEvent) => {
      callback(data);
    };
    ipcRenderer.on('server-event', listener);
    return () => {
      ipcRenderer.removeListener('server-event', listener);
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
  sessionPrune: {
    preview: (filter: { olderThanDays?: number; titleMatch?: string; excludeId?: string }) =>
      ipcRenderer.invoke('session.prunePreview', filter),
    apply: (ids: string[]) => ipcRenderer.invoke('session.pruneApply', { ids }),
  },

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
    match: (payload: { embedding: number[]; threshold?: number }): Promise<unknown> =>
      ipcRenderer.invoke('presence:match', payload),
    list: (): Promise<unknown[]> => ipcRenderer.invoke('presence:list'),
    remove: (payload: { personId: string }): Promise<boolean> =>
      ipcRenderer.invoke('presence:remove', payload),
    hasModel: (): Promise<{ installed: boolean; path: string }> =>
      ipcRenderer.invoke('presence:has-model'),
    selectModelFile: (): Promise<string | null> => ipcRenderer.invoke('presence:select-model-file'),
    installModelFromPath: (payload: {
      sourcePath: string;
    }): Promise<{ ok: boolean; error?: string; installedPath?: string }> =>
      ipcRenderer.invoke('presence:install-model-from-path', payload),
    downloadModel: (payload: {
      url: string;
    }): Promise<{ ok: boolean; error?: string; installedPath?: string }> =>
      ipcRenderer.invoke('presence:download-model', payload),
    onDownloadProgress: (
      listener: (progress: { bytes: number; total: number | null }) => void
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        progress: { bytes: number; total: number | null }
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
      }) => void
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        payload: Parameters<typeof listener>[0]
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
    listModels: (payload: { endpoint: string; apiKey?: string }): Promise<ProviderModelInfo[]> =>
      ipcRenderer.invoke('codebuddy:list-models', payload),
    probeConnection: (payload: {
      endpoint: string;
      apiKey?: string;
    }): Promise<{ version: string; models: string[]; tools: number }> =>
      ipcRenderer.invoke('codebuddy:probe-connection', payload),
    setGeminiGrounding: (payload: {
      enabled: boolean;
    }): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('codebuddy:set-gemini-grounding', payload),
    setVisionGrounding: (payload: {
      enabled: boolean;
      model?: string;
    }): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('codebuddy:set-vision-grounding', payload),
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
    discoverLocalLmStudio: (payload?: {
      baseUrl?: string;
    }): Promise<LocalLmStudioDiscoveryResult> =>
      ipcRenderer.invoke('config.discover-lmstudio-local', payload),
    modelInventory: (payload?: {
      includeTailnetPeers?: boolean;
    }): Promise<ModelInventorySnapshot> => ipcRenderer.invoke('config.model-inventory', payload),
  },

  // Workflow Builder Pro API
  workflowBuilder: {
    start: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workflow.start'),
    stop: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('workflow.stop'),
    status: (): Promise<{ running: boolean; port: number }> =>
      ipcRenderer.invoke('workflow.status'),
    logs: (limit?: number): Promise<{ lines: string[] }> =>
      ipcRenderer.invoke('workflow.logs', limit),
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
    clearOAuthTokens: (serverId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('mcp.clearOAuthTokens', serverId),
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
    reload: (): Promise<{ success: boolean; count: number; skills: Skill[] }> =>
      ipcRenderer.invoke('skills.reload'),
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
    updateSlackConfig: (
      config: SlackChannelConfig
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote.updateSlackConfig', config),
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
  automations: {
    list: (): Promise<{
      ok: boolean;
      error?: string;
      reminders: Array<Record<string, unknown>>;
      rules: Array<Record<string, unknown>>;
      runs: Array<Record<string, unknown>>;
    }> => ipcRenderer.invoke('automations.list'),
    toggle: (
      kind: 'rule' | 'reminder',
      id: string,
      enabled: boolean
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('automations.toggle', kind, id, enabled),
    remove: (kind: 'rule' | 'reminder', id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('automations.remove', kind, id),
    reminderDone: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('automations.reminderDone', id),
  },

  // Evolution: list the code variants (versions) the recursive self-improvement loop generated.
  evolve: {
    listVariants: (cwd?: string) => ipcRenderer.invoke('evolve.listVariants', cwd),
  },

  // CKG (Collective Knowledge Graph): read-only discoveries/stats + research-topic admin. Namespaced
  // `ckg` to avoid the existing per-project `knowledge` (KnowledgeBase browser) API.
  ckg: {
    stats: () => ipcRenderer.invoke('ckg.stats'),
    list: (opts?: { limit?: number; type?: string }) => ipcRenderer.invoke('ckg.list', opts),
    topicsList: () => ipcRenderer.invoke('ckg.topicsList'),
    topicsAdd: (topic: string) => ipcRenderer.invoke('ckg.topicsAdd', topic),
    topicsRemove: (topic: string) => ipcRenderer.invoke('ckg.topicsRemove', topic),
  },

  // AI-Scientist: READ-ONLY tracking of the `buddy science` experiment variant store. Only
  // `listVariants`/`status` are exposed — there is no run/execute channel (launching an
  // experiment stays CLI-only for safety).
  science: {
    listVariants: (cwd?: string) => ipcRenderer.invoke('science.listVariants', cwd),
    status: (cwd?: string) => ipcRenderer.invoke('science.status', cwd),
  },

  // Media generation — delegates to the core image_generate tool via
  // src/main/media/media-gen-ipc.ts.
  media: {
    generateImage: (request: {
      prompt: string;
      aspect?: string;
      provider?: string;
      model?: string;
    }): Promise<{ ok: boolean; outputPath?: string; url?: string; error?: string }> =>
      ipcRenderer.invoke('media.generateImage', request),
    list: (): Promise<
      Array<{
        path: string;
        kind: 'image' | 'video' | 'audio';
        size: number;
        mtimeMs: number;
        root: string;
        prompt?: string;
        model?: string;
        provider?: string;
        sessionId?: string;
      }>
    > => ipcRenderer.invoke('media.list'),
    export: (
      sourcePath: string
    ): Promise<{ ok: boolean; savedTo?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('media.export', { sourcePath }),
    exportMany: (
      paths: string[]
    ): Promise<{
      ok: boolean;
      copied?: number;
      destDir?: string;
      canceled?: boolean;
      error?: string;
    }> => ipcRenderer.invoke('media.exportMany', { paths }),
    copyToClipboard: (
      sourcePath: string
    ): Promise<{ ok: boolean; mode?: 'image' | 'path'; error?: string }> =>
      ipcRenderer.invoke('media.copyToClipboard', { sourcePath }),
  },

  // Video Studio — prompt → premium narrated video (src/main/film/film-ipc.ts).
  film: {
    produce: (request: {
      pitch: string;
      scenes?: number;
      resolution?: string;
      noMusic?: boolean;
      subtitles?: boolean;
      lang?: string;
      style?: 'short' | 'standard';
    }): Promise<{
      ok: boolean;
      filmPath?: string;
      url?: string;
      sceneCount?: number;
      duration?: number;
      qualityPass?: boolean;
      warnings?: string[];
      error?: string;
    }> => ipcRenderer.invoke('film.produce', request),
    onProgress: (
      cb: (p: { phase: string; scene?: number; total?: number; message?: string }) => void
    ): (() => void) => {
      const wrapped = (
        _e: unknown,
        data: { phase: string; scene?: number; total?: number; message?: string }
      ): void => cb(data);
      ipcRenderer.on('film.progress', wrapped);
      return () => ipcRenderer.removeListener('film.progress', wrapped);
    },
  },

  // Assistant — voice assistant config + daemon lifecycle.
  assistant: {
    get: (): Promise<AssistantConfigResponse> => ipcRenderer.invoke('assistant.get'),
    save: (updates: Record<string, string>): Promise<AssistantSaveResponse> =>
      ipcRenderer.invoke('assistant.save', updates),
    preview: (name: string, text?: string): Promise<AssistantPreviewResponse> =>
      ipcRenderer.invoke('assistant.preview', name, text),
    restart: (): Promise<AssistantRestartResponse> => ipcRenderer.invoke('assistant.restart'),
    getVolume: (): Promise<AssistantVolumeResponse> => ipcRenderer.invoke('assistant.getVolume'),
    setVolume: (percent: number): Promise<AssistantSetVolumeResponse> =>
      ipcRenderer.invoke('assistant.setVolume', percent),
  },

  widgets: {
    render: (data: unknown): Promise<string | null> => ipcRenderer.invoke('widgets.render', data),
  },

  // App Studio (bolt.diy-style file tree + editor + terminal + live preview).
  // Channels mirror the main-process register*Ipc handlers under
  // src/main/studio/*. Note: the file listing handler is `studio.files.tree`.
  studio: {
    exportZip: (
      root: string
    ): Promise<{ ok: boolean; savedTo?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('studio.exportZip', { root }),
    devServer: {
      start: (request: { cwd: string; command: string; url: string; timeoutMs?: number }) =>
        ipcRenderer.invoke('studio.dev.start', request),
      stop: (pid: number) => ipcRenderer.invoke('studio.dev.stop', pid),
      status: () => ipcRenderer.invoke('studio.dev.status'),
      logs: (pid: number, lines?: number) => ipcRenderer.invoke('studio.dev.logs', pid, lines),
      onLog: (listener: (payload: { pid: number; lines: string[] }) => void): (() => void) => {
        const wrapped = (
          _event: Electron.IpcRendererEvent,
          payload: { pid: number; lines: string[] }
        ) => listener(payload);
        ipcRenderer.on('studio.dev.log', wrapped);
        return () => {
          ipcRenderer.removeListener('studio.dev.log', wrapped);
        };
      },
    },
    files: {
      read: (root: string, relPath: string) =>
        ipcRenderer.invoke('studio.files.read', root, relPath),
      write: (root: string, relPath: string, content: string) =>
        ipcRenderer.invoke('studio.files.write', root, relPath, content),
      list: (root: string) => ipcRenderer.invoke('studio.files.tree', root),
      create: (root: string, relPath: string) =>
        ipcRenderer.invoke('studio.files.create', root, relPath),
      rename: (root: string, from: string, to: string) =>
        ipcRenderer.invoke('studio.files.rename', root, from, to),
      delete: (root: string, relPath: string) =>
        ipcRenderer.invoke('studio.files.delete', root, relPath),
    },
    commands: {
      run: (request: { cwd: string; command: string; id: string }) =>
        ipcRenderer.invoke('studio.cmd.run', request),
      kill: (id: string) => ipcRenderer.invoke('studio.cmd.kill', id),
      onOutput: (
        listener: (event: {
          id: string;
          stream: 'stdout' | 'stderr' | 'system';
          line: string;
          timestamp: string;
        }) => void
      ): (() => void) => {
        const wrapped = (
          _event: Electron.IpcRendererEvent,
          payload: Parameters<typeof listener>[0]
        ) => listener(payload);
        ipcRenderer.on('studio.cmd.output', wrapped);
        return () => {
          ipcRenderer.removeListener('studio.cmd.output', wrapped);
        };
      },
    },
    scaffold: {
      list: () => ipcRenderer.invoke('studio.scaffold.list'),
      generate: (request: {
        template: string;
        targetDir: string;
        vars?: Record<string, string | boolean>;
        designSystem?: string;
      }) => ipcRenderer.invoke('studio.scaffold.generate', request),
    },
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
    respondBridge: (id: string, response: string, reason?: string) =>
      ipcRenderer.send('permission.bridge.response', { id, response, reason }),
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
    exportPdf: (
      sessionId: string,
      options?: { redactSecrets?: boolean }
    ): Promise<{ success: boolean; savedTo?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('session.exportPdf', sessionId, options),
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
        pinned?: boolean;
        archived?: boolean;
        tags?: string[];
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
    /**
     * Cross-session message search — used by GlobalSearchDialog "Messages" tab.
     */
    searchContent: (
      query: string,
      limit?: number
    ): Promise<
      Array<{
        messageId: string;
        sessionId: string;
        sessionTitle: string;
        role: string;
        snippet: string;
        matchOffset: number;
        timestamp: number;
        projectId: string | null;
      }>
    > => ipcRenderer.invoke('sessions.searchContent', query, limit),
  },

  /**
   * Runner status (Phase 3 of the cowork-on-core migration).
   * Tells the renderer whether the embedded Code Buddy core engine
   * is active or whether we fell back to pi-coding-agent.
   */
  runner: {
    status: (): Promise<{
      runner: 'engine' | 'pi';
      engineReady: boolean;
      bootError: string | null;
    }> => ipcRenderer.invoke('runner.status'),
  },

  /**
   * Clipboard summariser (Lisa-derived). The renderer subscribes to
   * `clipboard.summary` ServerEvents pushed via the regular
   * server-event channel — these IPC methods are for explicit
   * actions only.
   */
  clipboard: {
    summarizeNow: (): Promise<{
      ok: boolean;
      payload?: {
        hash: string;
        sourceLength: number;
        sourcePreview: string;
        summary: string | null;
        at: string;
      };
      error?: string;
    }> => ipcRenderer.invoke('clipboard.summarizeNow'),
    setMonitoring: (enabled: boolean): Promise<{ ok: boolean; running?: boolean }> =>
      ipcRenderer.invoke('clipboard.setMonitoring', enabled),
    status: (): Promise<{ running: boolean; monitoringEnabled: boolean }> =>
      ipcRenderer.invoke('clipboard.status'),
  },

  // Phase 8 — voice input. The renderer captures audio via MediaRecorder
  // and ships the resulting Blob (as ArrayBuffer) to the main process for
  // transcription via faster-whisper.
  voice: {
    transcribe: (
      audio: ArrayBuffer,
      options?: { language?: string }
    ): Promise<{ ok: boolean; text?: string; durationMs?: number; error?: string }> =>
      ipcRenderer.invoke('voice.transcribe', { audio, language: options?.language }),
    status: (): Promise<{ available: boolean; bootError: string | null }> =>
      ipcRenderer.invoke('voice.status'),
    diagnostics: (): Promise<{
      ok: boolean;
      checkedAt: string;
      stt: {
        provider: string;
        available: boolean;
        fallbackProvider: string;
        fallbackAvailable: boolean;
        bootError: string | null;
      };
      tts: {
        provider: string;
        available: boolean;
        fallbackProvider: string;
        fallbackAvailable: boolean;
        bootError: string | null;
      };
      kyutai: {
        sttEnabled: boolean;
        ttsEnabled: boolean;
        baseUrl: string;
        apiKeyConfigured: boolean;
        ffmpegBinary: string;
        ffmpegFound: boolean;
        ttsVoice: string;
        sttProbe?: {
          ok: boolean;
          endpoint: string;
          durationMs: number;
          error?: string;
        };
        ttsProbe?: {
          ok: boolean;
          endpoint: string;
          durationMs: number;
          error?: string;
        };
      } | null;
    }> => ipcRenderer.invoke('voice.diagnostics'),
    /**
     * Synthesise `text` to French speech via Piper. Returns a WAV
     * ArrayBuffer the renderer can wrap in a Blob and play through an
     * `<audio>` element.
     */
    speak: (
      text: string,
      options?: { lengthScale?: number }
    ): Promise<{
      ok: boolean;
      audio?: ArrayBuffer;
      sampleRate?: number;
      durationMs?: number;
      error?: string;
    }> => ipcRenderer.invoke('voice.speak', { text, lengthScale: options?.lengthScale }),
    ttsStatus: (): Promise<{ available: boolean; bootError: string | null }> =>
      ipcRenderer.invoke('voice.ttsStatus'),
    recordInterruption: (payload: {
      reason: 'barge_in' | 'manual' | 'new_speech' | 'stop';
      hadPlayback: boolean;
      timestamp: number;
    }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('voice.interrupted', payload),
    conversationStatus: (): Promise<VoiceConversationSnapshot> =>
      ipcRenderer.invoke('voice.conversationStatus'),
    recordConversationEvent: (
      payload: VoiceConversationEvent
    ): Promise<{ ok: boolean; snapshot?: VoiceConversationSnapshot; error?: string }> =>
      ipcRenderer.invoke('voice.conversationEvent', payload),
  },

  companion: {
    setup: (input?: {
      projectId?: string;
      forceIdentity?: boolean;
      configureVoice?: boolean;
      configureModel?: boolean;
      language?: string;
      sttProvider?: string;
      ttsProvider?: string;
      ttsVoice?: string;
      model?: string;
      recordSelf?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionSetupResponse; error?: string }> =>
      ipcRenderer.invoke('companion.setup', input),
    status: (
      projectId?: string
    ): Promise<{ ok: boolean; status?: CompanionStatus; error?: string }> =>
      ipcRenderer.invoke('companion.status', projectId),
    recentPercepts: (input?: {
      limit?: number;
      modality?: CompanionPerceptModality;
      projectId?: string;
    }): Promise<{ ok: boolean; items: CompanionPercept[]; error?: string }> =>
      ipcRenderer.invoke('companion.percepts.recent', input),
    perceptStats: (
      projectId?: string
    ): Promise<{ ok: boolean; stats?: CompanionPerceptStats; error?: string }> =>
      ipcRenderer.invoke('companion.percepts.stats', projectId),
    recordSelf: (
      projectId?: string
    ): Promise<{ ok: boolean; percept?: CompanionPercept; error?: string }> =>
      ipcRenderer.invoke('companion.self.record', projectId),
    evaluate: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; evaluation?: CompanionSelfEvaluation; error?: string }> =>
      ipcRenderer.invoke('companion.evaluate', input),
    radar: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; radar?: CompanionCompetitiveRadar; error?: string }> =>
      ipcRenderer.invoke('companion.radar', input),
    improve: (input?: {
      projectId?: string;
      dryRun?: boolean;
      recordSuggestions?: boolean;
      runMission?: boolean;
    }): Promise<{ ok: boolean; cycle?: CompanionImprovementCycle; error?: string }> =>
      ipcRenderer.invoke('companion.improve', input),
    impulses: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; brief?: CompanionImpulseBrief; error?: string }> =>
      ipcRenderer.invoke('companion.impulses', input),
    checkIn: (input?: {
      projectId?: string;
      userText?: string;
      recordPercept?: boolean;
      createCard?: boolean;
      recordSafety?: boolean;
    }): Promise<{ ok: boolean; cue?: CompanionCheckInCue; error?: string }> =>
      ipcRenderer.invoke('companion.checkIn', input),
    syncMissions: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionMissionBoardSyncResult; error?: string }> =>
      ipcRenderer.invoke('companion.missions.sync', input),
    listMissions: (input?: {
      projectId?: string;
      status?: CompanionMissionStatus;
    }): Promise<{
      ok: boolean;
      board?: CompanionMissionBoard;
      items: CompanionMission[];
      error?: string;
    }> => ipcRenderer.invoke('companion.missions.list', input),
    runNextMission: (input?: {
      projectId?: string;
      dryRun?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionMissionRunResult; error?: string }> =>
      ipcRenderer.invoke('companion.missions.runNext', input),
    updateMission: (input: {
      projectId?: string;
      missionId: string;
      status: CompanionMissionStatus;
    }): Promise<{ ok: boolean; mission?: CompanionMission; error?: string }> =>
      ipcRenderer.invoke('companion.missions.update', input),
    recentSafetyEvents: (input?: {
      projectId?: string;
      limit?: number;
      kind?: CompanionSafetyEventKind;
      risk?: CompanionSafetyEventRisk;
    }): Promise<{ ok: boolean; items: CompanionSafetyEvent[]; error?: string }> =>
      ipcRenderer.invoke('companion.safety.recent', input),
    safetyStats: (
      projectId?: string
    ): Promise<{ ok: boolean; stats?: CompanionSafetyLedgerStats; error?: string }> =>
      ipcRenderer.invoke('companion.safety.stats', projectId),
    listCards: (input?: {
      projectId?: string;
      status?: CompanionCardStatus;
      kind?: CompanionCardKind;
      limit?: number;
    }): Promise<{
      ok: boolean;
      store?: CompanionCardStore;
      items: CompanionCard[];
      error?: string;
    }> => ipcRenderer.invoke('companion.cards.list', input),
    updateCard: (input: {
      projectId?: string;
      cardId: string;
      status: CompanionCardStatus;
    }): Promise<{ ok: boolean; card?: CompanionCard; error?: string }> =>
      ipcRenderer.invoke('companion.cards.update', input),
    gatewayProfile: (
      projectId?: string
    ): Promise<{ ok: boolean; profile?: CompanionGatewayProfile; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.profile', projectId),
    gatewayLifecycle: (
      projectId?: string
    ): Promise<{ ok: boolean; report?: CompanionGatewayLifecycleReport; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.lifecycle', projectId),
    gatewayAdminPlan: (
      projectId?: string
    ): Promise<{ ok: boolean; plan?: CompanionGatewayAdminPlan; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.adminPlan', projectId),
    executeGatewayAdminAction: (input: {
      projectId?: string;
      action: CompanionGatewayExecutableAdminAction;
      channel: string;
      approvedBy: string;
      liveAdminConfirmed: boolean;
    }): Promise<{ ok: boolean; result?: CompanionGatewayAdminExecutionResult; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.executeAdminAction', input),
    gatewayInbox: (
      projectId?: string
    ): Promise<{ ok: boolean; inbox?: CompanionGatewayInbox; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.inbox', projectId),
    draftGatewayInboxItem: (input: {
      projectId?: string;
      itemId: string;
    }): Promise<{
      ok: boolean;
      draft?: CompanionGatewayInboxDraft;
      inbox?: CompanionGatewayInbox;
      error?: string;
    }> => ipcRenderer.invoke('companion.gateway.draft', input),
    routeGatewayDraftToFleet: (input: {
      projectId?: string;
      itemId: string;
    }): Promise<{
      ok: boolean;
      fleetDraft?: CompanionGatewayFleetDraft;
      inbox?: CompanionGatewayInbox;
      error?: string;
    }> => ipcRenderer.invoke('companion.gateway.fleetDraft', input),
    draftGatewayOutboundReply: (input: {
      projectId?: string;
      itemId: string;
      text: string;
      reviewedBy: string;
    }): Promise<{
      ok: boolean;
      replyDraft?: CompanionGatewayOutboundReplyDraft;
      inbox?: CompanionGatewayInbox;
      error?: string;
    }> => ipcRenderer.invoke('companion.gateway.outboundReplyDraft', input),
    sendGatewayOutboundReply: (input: {
      projectId?: string;
      itemId: string;
      text: string;
      approvedBy: string;
      dryRun?: boolean;
      liveDeliveryConfirmed?: boolean;
    }): Promise<{
      ok: boolean;
      result?: CompanionGatewayOutboundReplySendResult;
      inbox?: CompanionGatewayInbox;
      error?: string;
    }> => ipcRenderer.invoke('companion.gateway.sendOutboundReply', input),
    updateGatewayChannel: (input: {
      projectId?: string;
      channel: string;
      enabled?: boolean;
      mode?: CompanionGatewayMode;
      allowOutbound?: boolean;
      requireApprovalForTools?: boolean;
      recordPercepts?: boolean;
      tags?: string[];
    }): Promise<{ ok: boolean; profile?: CompanionGatewayProfile; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.update', input),
    openClawBridgeStatus: (input?: {
      projectId?: string;
      source?: string;
    }): Promise<OpenClawBridgeStatusResult> =>
      ipcRenderer.invoke('companion.openclaw.status', input),
    previewOpenClawBridgeAttach: (input?: {
      projectId?: string;
      source?: string;
      endpointPath?: string;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.attachPreview', input),
    attachOpenClawBridge: (input: {
      projectId?: string;
      source?: string;
      endpointPath?: string;
      approvedBy: string;
      liveAttachConfirmed: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.attach', input),
    listOpenClawBridgePendingNodes: (input?: {
      projectId?: string;
      source?: string;
      approvedBy?: string;
      liveCallConfirmed?: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.nodesPending', input),
    approveOpenClawBridgePendingNode: (input: {
      projectId?: string;
      source?: string;
      nodeId?: string;
      code?: string;
      approvedBy: string;
      liveCallConfirmed: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.nodeApprove', input),
    rejectOpenClawBridgePendingNode: (input: {
      projectId?: string;
      source?: string;
      nodeId?: string;
      code?: string;
      reason?: string;
      approvedBy: string;
      liveCallConfirmed: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.nodeReject', input),
    draftOpenClawBridgeHandoff: (input: {
      projectId?: string;
      messageId: string;
      channel: string;
      threadId?: string;
      senderId: string;
      senderName?: string;
      text: string;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.draft', input),
    previewOpenClawBridgeSend: (input: {
      projectId?: string;
      source?: string;
      endpointPath?: string;
      messageId: string;
      channel: string;
      threadId?: string;
      text: string;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.sendPreview', input),
    sendOpenClawBridgeResponse: (input: {
      projectId?: string;
      source?: string;
      endpointPath?: string;
      messageId: string;
      channel: string;
      threadId?: string;
      text: string;
      approvedBy: string;
      liveSendConfirmed: boolean;
    }): Promise<OpenClawBridgeActionResult> => ipcRenderer.invoke('companion.openclaw.send', input),
    listSkillCandidates: (
      projectId?: string
    ): Promise<{
      ok: boolean;
      store?: CompanionSkillCandidateStore;
      items: CompanionSkillCandidate[];
      error?: string;
    }> => ipcRenderer.invoke('companion.skills.list', projectId),
    curateSkills: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionSkillCuratorResult; error?: string }> =>
      ipcRenderer.invoke('companion.skills.curate', input),
    promoteSkillCandidate: (input: {
      projectId?: string;
      candidateId: string;
    }): Promise<{ ok: boolean; result?: CompanionSkillPromotionResult; error?: string }> =>
      ipcRenderer.invoke('companion.skills.promote', input),
    dismissSkillCandidate: (input: {
      projectId?: string;
      candidateId: string;
    }): Promise<{ ok: boolean; candidate?: CompanionSkillCandidate; error?: string }> =>
      ipcRenderer.invoke('companion.skills.dismiss', input),
    privacyReport: (
      projectId?: string
    ): Promise<{ ok: boolean; report?: CompanionPrivacyReport; error?: string }> =>
      ipcRenderer.invoke('companion.privacy.report', projectId),
    exportPrivacy: (input?: {
      projectId?: string;
      kinds?: CompanionPrivacyKind[];
    }): Promise<{ ok: boolean; result?: CompanionPrivacyExportResult; error?: string }> =>
      ipcRenderer.invoke('companion.privacy.export', input),
    purgePrivacy: (input?: {
      projectId?: string;
      kinds?: CompanionPrivacyKind[];
      backup?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionPrivacyPurgeResult; error?: string }> =>
      ipcRenderer.invoke('companion.privacy.purge', input),
    cameraStatus: (): Promise<{ ok: boolean; status?: Record<string, unknown>; error?: string }> =>
      ipcRenderer.invoke('companion.camera.status'),
    cameraSnapshot: (input?: {
      outputPath?: string;
      device?: string;
      timeoutMs?: number;
      projectId?: string;
    }): Promise<{ ok: boolean; result?: CameraSnapshotResult; error?: string }> =>
      ipcRenderer.invoke('companion.camera.snapshot', input),
    cameraRendererSnapshot: (input: {
      dataUrl?: string;
      base64?: string;
      mediaType?: string;
      width?: number;
      height?: number;
      mediaPipe?: unknown;
      outputPath?: string;
      projectId?: string;
    }): Promise<{ ok: boolean; result?: CameraSnapshotResult; error?: string }> =>
      ipcRenderer.invoke('companion.camera.rendererSnapshot', input),
    cameraInspect: (input?: {
      imagePath?: string;
      outputPath?: string;
      device?: string;
      timeoutMs?: number;
      projectId?: string;
      includeOcr?: boolean;
      ocrLanguage?: string;
    }): Promise<{ ok: boolean; result?: CameraSnapshotInspectionResult; error?: string }> =>
      ipcRenderer.invoke('companion.camera.inspect', input),
  },

  desktopSnapshot: {
    status: (): Promise<{
      ok: boolean;
      platform: string;
      methods?: DesktopSnapshotMethod[];
      error?: string;
    }> => ipcRenderer.invoke('desktopSnapshot.status'),
    capture: (input?: DesktopSnapshotCaptureOptions): Promise<DesktopSnapshotCaptureResult> =>
      ipcRenderer.invoke('desktopSnapshot.capture', input),
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

  missions: {
    list: (
      filter?: MissionFilter
    ): Promise<{ ok: boolean; missions: MissionRuntime[]; error?: string }> =>
      ipcRenderer.invoke('mission.list', filter),
    get: (
      missionId: string
    ): Promise<{ ok: boolean; mission: MissionRuntime | null; error?: string }> =>
      ipcRenderer.invoke('mission.get', missionId),
    create: (
      input: MissionCreateInput
    ): Promise<{ ok: boolean; mission: MissionRuntime | null; error?: string }> =>
      ipcRenderer.invoke('mission.create', input),
    updateStatus: (
      missionId: string,
      status: MissionStatus
    ): Promise<{ ok: boolean; mission: MissionRuntime | null; error?: string }> =>
      ipcRenderer.invoke('mission.updateStatus', { missionId, status }),
    cancel: (
      missionId: string
    ): Promise<{ ok: boolean; mission: MissionRuntime | null; error?: string }> =>
      ipcRenderer.invoke('mission.cancel', missionId),
    readySubTasks: (
      missionId: string
    ): Promise<{ ok: boolean; subTasks: SubTask[]; error?: string }> =>
      ipcRenderer.invoke('mission.readySubTasks', missionId),
    tickHeartbeat: (
      now?: string
    ): Promise<{ ok: boolean; missions: MissionRuntime[]; error?: string }> =>
      ipcRenderer.invoke('mission.tickHeartbeat', now),
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
          messageId?: string;
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
      turnJournal?: {
        sessionId: string;
        path: string;
        exists: boolean;
        totalEventCount: number;
        malformedLineCount: number;
        pendingTurnCount: number;
        events: Array<{
          schemaVersion: 1;
          type: string;
          sessionId: string;
          ts: number;
          eventId?: string;
          runId?: string;
          seq?: number;
          turnId?: string;
          data?: Record<string, unknown>;
        }>;
        turns: Array<{
          turnId: string;
          startedAt: number;
          updatedAt: number;
          latestType: string;
          status: 'running' | 'completed' | 'failed' | 'cancelled';
          eventCount: number;
          messageCount: number;
          traceStepCount: number;
        }>;
        replay: {
          sessionId: string;
          path: string;
          exists: boolean;
          totalEventCount: number;
          malformedLineCount: number;
          pendingTurnCount: number;
          runCount: number;
          runs: Array<{
            runId: string;
            turnId?: string;
            startedAt: number;
            updatedAt: number;
            latestType: string;
            status: 'running' | 'completed' | 'failed' | 'cancelled';
            eventCount: number;
            anchorCount: number;
            terminalEvent?: {
              schemaVersion: 1;
              type: string;
              sessionId: string;
              ts: number;
              eventId?: string;
              runId?: string;
              seq?: number;
              turnId?: string;
              data?: Record<string, unknown>;
            };
            anchors: Array<{
              eventId: string;
              runId: string;
              seq: number;
              type: string;
              ts: number;
              turnId?: string;
            }>;
            events: Array<{
              schemaVersion: 1;
              type: string;
              sessionId: string;
              ts: number;
              eventId?: string;
              runId?: string;
              seq?: number;
              turnId?: string;
              data?: Record<string, unknown>;
            }>;
          }>;
        };
        memoryPreview?: {
          sessionId: string;
          projectId?: string | null;
          memoryStrategy: 'auto' | 'manual' | 'rolling';
          automatedMemoryEnabled: boolean;
          projectMemoryAvailable: boolean;
          projectMemoryPath?: string;
          projectContextAvailable: boolean;
          icmAvailable: boolean;
          recallEnabled: boolean;
          candidateCount: number;
          candidates: Array<{
            category: 'preference' | 'pattern' | 'context' | 'decision';
            content: string;
            sourceSessionId?: string;
            sourceKind: 'user' | 'assistant';
            evidence: string;
          }>;
        };
      };
    } | null> => ipcRenderer.invoke('sessionInsights.detail', sessionId),
    recallPrefill: (
      prompt: string,
      options?: {
        currentSessionId?: string;
        cwd?: string;
        limit?: number;
        maxChars?: number;
        perSessionMaxChars?: number;
      }
    ): Promise<{
      prompt: string;
      text: string;
      entries: Array<{
        sessionId: string;
        title: string;
        cwd?: string;
        updatedAt: number;
        score: number;
        snippet: string;
        messageIds: string[];
      }>;
      totalCandidateCount: number;
      maxChars: number;
      truncated: boolean;
    } | null> => ipcRenderer.invoke('sessionInsights.recallPrefill', prompt, options),
    audit: (
      sessionId: string
    ): Promise<{
      sessionId: string;
      issueCount: number;
      orphanToolResults: number;
      missingToolResults: number;
      emptyMessages: number;
      pendingJournalTurns: number;
      missingJournalUserMessages: number;
      unrecoverableJournalSubmissions: number;
      malformedJournalEvents: number;
      issues: Array<{
        kind:
          | 'orphan_tool_result'
          | 'missing_tool_result'
          | 'empty_message'
          | 'turn_journal_pending_turn'
          | 'turn_journal_missing_user_message'
          | 'turn_journal_unrecoverable_submission'
          | 'turn_journal_malformed_event';
        messageId?: string;
        toolUseId?: string;
        turnId?: string;
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
      injectedJournalUserMessages: number;
      injectedJournalInterruptionMarkers: number;
      removedEmptyMessages: number;
      messages: import('../renderer/types').Message[];
      audit: {
        sessionId: string;
        issueCount: number;
        orphanToolResults: number;
        missingToolResults: number;
        emptyMessages: number;
        pendingJournalTurns: number;
        missingJournalUserMessages: number;
        unrecoverableJournalSubmissions: number;
        malformedJournalEvents: number;
        issues: Array<{
          kind:
            | 'orphan_tool_result'
            | 'missing_tool_result'
            | 'empty_message'
            | 'turn_journal_pending_turn'
            | 'turn_journal_missing_user_message'
            | 'turn_journal_unrecoverable_submission'
            | 'turn_journal_malformed_event';
          messageId?: string;
          toolUseId?: string;
          turnId?: string;
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

  /**
   * Tool registry catalogue — used by WorkflowEditor's NodeConfigTool
   * to render a dropdown of available tools.
   */
  tools: {
    list: (): Promise<Array<{ name: string; description: string; category: string }>> =>
      ipcRenderer.invoke('tools.list'),
    getOverrides: (): Promise<Record<string, 'allow' | 'deny' | 'confirm'>> =>
      ipcRenderer.invoke('tools.getOverrides'),
    setOverride: (
      name: string,
      action: 'allow' | 'deny' | null
    ): Promise<{ ok: boolean; overrides?: Record<string, string> }> =>
      ipcRenderer.invoke('tools.setOverride', { name, action }),
    hermesCatalog: {
      get: (): Promise<{
        generatedAt: string;
        inspectedCommit: string;
        localToolCount: number;
        source: string;
        summary: {
          exact: number;
          gaps: number;
          nativeEquivalent: number;
          partial: number;
          total: number;
        };
        topWork: Array<{
          category: string;
          name: string;
          nextWork?: string;
          status: 'exact' | 'native-equivalent' | 'partial' | 'gap';
          toolset: string;
        }>;
      } | null> => ipcRenderer.invoke('tools.hermesCatalog.get'),
    },
    hermesFeatureParity: {
      get: (): Promise<{
        auditDocument: string;
        command: string;
        deferredWork: Array<{
          area: string;
          id: string;
          nextWork?: string;
          officialSurface: string;
          status: 'covered' | 'covered-partial' | 'partial' | 'gap';
          verificationCommands: string[];
        }>;
        generatedAt: string;
        inspectedCommit: string;
        latestTagObserved: string;
        source: string;
        summary: {
          covered: number;
          coveredPartial: number;
          gaps: number;
          partial: number;
          total: number;
        };
        topWork: Array<{
          area: string;
          id: string;
          nextWork?: string;
          officialSurface: string;
          status: 'covered' | 'covered-partial' | 'partial' | 'gap';
          verificationCommands: string[];
        }>;
        todoCommand: string;
        todoSummary: {
          activeTodoCount: number;
          deferredCount: number;
          hiddenTodoCount: number;
          includedDeferred: boolean;
          selectedTodoCount: number;
          shownTodoCount: number;
          todoLimit: number;
        };
      } | null> => ipcRenderer.invoke('tools.hermesFeatureParity.get'),
    },
    hermesToolsets: {
      get: (options?: {
        profile?: string;
      }): Promise<{
        activeProfile: 'balanced' | 'research' | 'code' | 'review' | 'safe';
        activeToolset: {
          allowedTools: string[];
          confirmTools: string[];
          deniedTools: string[];
          summary: string;
          toolsetId: string;
        };
        command: string;
        generatedAt: string;
        kind: 'hermes_toolsets_catalog';
        previewTools: string[];
        requestedProfile: string;
        schemaVersion: 1;
        summary: {
          profiles: Array<'balanced' | 'research' | 'code' | 'review' | 'safe'>;
          totalToolsets: number;
        };
        toolsets: Array<{
          allowedTools: string[];
          confirmTools: string[];
          deniedTools: string[];
          intent: string;
          profile: 'balanced' | 'research' | 'code' | 'review' | 'safe';
          summary: string;
          toolsetId: string;
        }>;
      } | null> => ipcRenderer.invoke('tools.hermesToolsets.get', options),
    },
    hermesProviderReadiness: {
      get: (): Promise<{
        command: string;
        ok: boolean;
        activeModel: {
          contextWindow: number | null;
          maxOutputTokens: number | null;
          model: string;
          provider: string;
          source: string;
          supportsReasoning: boolean;
          supportsToolCalls: boolean;
          supportsVision: boolean;
        };
        activeProvider: {
          baseUrl: string | null;
          configured: boolean;
          credentialSources: string[];
          label: string;
          local: boolean;
        };
        configuredProviderCount: number;
        issues: string[];
        portal: {
          credentialPresent: boolean;
          credentialSources: string[];
          directFallbackCount: number;
          managedByNousCount: number;
          toolGatewayConfigured: boolean;
        };
        providerCount: number;
        recommendations: string[];
      } | null> => ipcRenderer.invoke('tools.hermesProviderReadiness.get'),
    },
    hermesPortal: {
      get: (): Promise<HermesPortalReviewPayload | null> =>
        ipcRenderer.invoke('tools.hermesPortal.get'),
    },
    hermesTrajectories: {
      get: (): Promise<HermesTrajectoriesReviewPayload | null> =>
        ipcRenderer.invoke('tools.hermesTrajectories.get'),
      export: (options?: {
        includeArtifactContent?: boolean;
        limit?: number;
        maxArtifactBytes?: number;
        maxCompressedBytes?: number;
        maxEventValueBytes?: number;
        query?: string;
        runIds?: string[];
        sources?: string[];
      }): Promise<{ success: boolean; path?: string; error?: string }> =>
        ipcRenderer.invoke('tools.hermesTrajectories.export', options),
    },
    hermesDoctor: {
      get: (): Promise<HermesDoctorReviewPayload | null> =>
        ipcRenderer.invoke('tools.hermesDoctor.get'),
    },
    hermesClaw: {
      status: (options?: {
        preset?: 'full' | 'user-data';
        source?: string;
      }): Promise<ClawMigrationReportPayload | null> =>
        ipcRenderer.invoke('tools.hermesClaw.status', options),
      run: (options: ClawMigrationRunOptionsPayload): Promise<ClawMigrationRunResponse> =>
        ipcRenderer.invoke('tools.hermesClaw.run', options),
    },
    hermesKanban: {
      list: (options) => ipcRenderer.invoke('hermes.kanban.list', options),
      create: (options) => ipcRenderer.invoke('hermes.kanban.create', options),
      complete: (options) => ipcRenderer.invoke('hermes.kanban.complete', options),
      block: (options) => ipcRenderer.invoke('hermes.kanban.block', options),
      unblock: (options) => ipcRenderer.invoke('hermes.kanban.unblock', options),
      comment: (options) => ipcRenderer.invoke('hermes.kanban.comment', options),
      link: (options) => ipcRenderer.invoke('hermes.kanban.link', options),
      unlink: (options) => ipcRenderer.invoke('hermes.kanban.unlink', options),
      assign: (options) => ipcRenderer.invoke('hermes.kanban.assign', options),
      archive: (options) => ipcRenderer.invoke('hermes.kanban.archive', options),
      boards: {
        list: (options) => ipcRenderer.invoke('hermes.kanban.boards.list', options),
        create: (options) => ipcRenderer.invoke('hermes.kanban.boards.create', options),
        switch: (options) => ipcRenderer.invoke('hermes.kanban.boards.switch', options),
      },
    } satisfies HermesKanbanApi,
    hermesMemoryProviders: {
      get: (): Promise<{
        activeProviderId: string;
        command: string;
        configuredRemoteCount: number;
        fallbackCount: number;
        generatedAt: string;
        issues: string[];
        missingOfficialCount: number;
        ok: boolean;
        providers: Array<{
          active: boolean;
          baseUrlSources: string[];
          configured: boolean;
          credentialSources: string[];
          id: string;
          label: string;
          local: boolean;
          notes: string[];
          officialSurface: string;
          registered: boolean;
          remediation: string[];
          status: 'available' | 'configured' | 'fallback' | 'missing';
        }>;
        recommendations: string[];
        registeredCount: number;
      } | null> => ipcRenderer.invoke('tools.hermesMemoryProviders.get'),
      probe: (options: { providerId?: string }): Promise<HermesMemoryProbeResponse> =>
        ipcRenderer.invoke('tools.hermesMemoryProviders.probe', options),
    },
    hermesRuntimeBackends: {
      get: (): Promise<{
        arch: string;
        availableCount: number;
        backends: Array<{
          command: string | null;
          configured: boolean;
          credentialSources: string[];
          id: string;
          installed: boolean;
          label: string;
          notes: string[];
          officialSurface: string;
          remediation: string[];
          runnable: boolean;
          smokeCommand: string | null;
          status: 'available' | 'configured' | 'missing' | 'unsupported';
          version: string | null;
        }>;
        command: string;
        configuredRemoteCount: number;
        generatedAt: string;
        issues: string[];
        ok: boolean;
        platform: string;
        recommendations: string[];
        runnableCount: number;
      } | null> => ipcRenderer.invoke('tools.hermesRuntimeBackends.get'),
      smoke: (options: {
        allowDockerSmoke?: boolean;
        allowRemoteSmoke?: boolean;
        backendId: string;
      }): Promise<{
        error?: string;
        ok: boolean;
        result?: {
          args: string[];
          backendId: string;
          command: string | null;
          durationMs: number;
          exitCode: number | null;
          finishedAt: string;
          label: string | null;
          ok: boolean;
          output: string;
          signal: string | null;
          startedAt: string;
          status: 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';
          stderr: string;
          stdout: string;
        };
      }> => ipcRenderer.invoke('tools.hermesRuntimeBackends.smoke', options),
    },
    hermesBrowserBackends: {
      get: (): Promise<{
        backends: Array<{
          command: string | null;
          configured: boolean;
          credentialSources: string[];
          id: string;
          installed: boolean;
          label: string;
          notes: string[];
          officialSurface: string;
          remediation: string[];
          runnable: boolean;
          smokeCommand: string | null;
          status: 'available' | 'configured' | 'missing' | 'unsupported';
          version: string | null;
        }>;
        command: string;
        generatedAt: string;
        issues: string[];
        localRunnableCount: number;
        managedConfiguredCount: number;
        ok: boolean;
        platform: string;
        recommendations: string[];
      } | null> => ipcRenderer.invoke('tools.hermesBrowserBackends.get'),
      smoke: (options: {
        backendId: string;
      }): Promise<{
        error?: string;
        ok: boolean;
        result?: {
          backendId: string;
          command: string | null;
          durationMs: number;
          finishedAt: string;
          label: string | null;
          ok: boolean;
          output: string;
          startedAt: string;
          status: 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';
          stderr: string;
          stdout: string;
        };
      }> => ipcRenderer.invoke('tools.hermesBrowserBackends.smoke', options),
    },
    hermesProtocolGateways: {
      get: (): Promise<{
        capabilities: Array<{
          commands: string[];
          endpoints: string[];
          evidence: string[];
          id: string;
          label: string;
          notes: string[];
          officialSurface: string;
          status: 'available' | 'partial' | 'missing';
        }>;
        generatedAt: string;
        kind: 'hermes_protocol_gateway_readiness';
        officialSurface: string;
        ok: boolean;
        recommendations: string[];
        schemaVersion: 1;
        smokeCommand: string;
        summary: {
          availableCount: number;
          missingCount: number;
          partialCount: number;
          total: number;
        };
      } | null> => ipcRenderer.invoke('tools.hermesProtocolGateways.get'),
      smoke: (): Promise<{
        error?: string;
        ok: boolean;
        result?: {
          durationMs: number;
          generatedAt: string;
          httpRoutes: {
            a2aAgentName?: string;
            acpSessionCount?: number;
            baseUrl?: string;
            error?: string;
            ok: boolean;
            routes: Array<{
              ok: boolean;
              path: string;
              status: number;
            }>;
          };
          kind: 'hermes_protocol_gateway_smoke';
          mcpStdio: {
            echoText?: string;
            error?: string;
            ok: boolean;
            serverName: string;
            toolCount: number;
            transport?: string;
          };
          ok: boolean;
          schemaVersion: 1;
        };
      }> => ipcRenderer.invoke('tools.hermesProtocolGateways.smoke'),
    },
    hermesLocalSmoke: {
      run: (): Promise<{
        error?: string;
        ok: boolean;
        result?: unknown;
      }> => ipcRenderer.invoke('tools.hermesLocalSmoke.run'),
    },
    hermesMobileSupervision: {
      get: (options?: {
        query?: string;
      }): Promise<{
        approvalQueue: {
          autoDispatch: boolean;
          counts: {
            blocked: number;
            pending: number;
            ready: number;
            total: number;
          };
          localOnly: boolean;
          remoteExecutionDisabled: boolean;
        };
        auth: {
          scheme: 'bearer_or_pairing_code';
          scopes: string[];
          ttlSeconds: number;
        };
        blockedOperations: Array<{
          action: string;
          reason: string;
        }>;
        command: string;
        endpoints: Array<{
          action: string;
          id: string;
          localApprovalRequired: boolean;
          method: 'GET' | 'POST';
          path: string;
          sideEffects: 'none' | 'draft_only';
        }>;
        generatedAt: string;
        ok: boolean;
        pairing: {
          deviceLabel: string;
          scopes: string[];
          status: 'preview_only';
          tokenIssued: boolean;
          ttlSeconds: number;
        };
        query: string;
        recommendations: string[];
        routeMount: {
          basePath: string;
          module: string;
          mountedBy: string;
          serverCommand: string;
          status: 'implemented_not_probed';
        };
        summary: {
          blockedOperations: number;
          blockedQueueItems: number;
          draftOnlyEndpoints: number;
          pendingLocalApproval: number;
          readOnlyEndpoints: number;
          readyReadOnly: number;
          totalQueueItems: number;
        };
        transport: {
          exposure: 'local_first';
          offDeviceTlsRequired: boolean;
          remoteExecution: 'disabled';
        };
      } | null> => ipcRenderer.invoke('tools.hermesMobileSupervision.get', options ?? {}),
    },
    hermesLearningLoop: {
      get: (options?: {
        cwd?: string;
        limit?: number;
      }): Promise<{
        autoRetrospective: {
          enabled: boolean;
          envVar: 'CODEBUDDY_LEARNING_AGENT';
          mode: 'auto' | 'disabled';
        };
        commands: {
          candidateReview: string;
          lessonCandidates: string;
          retrospective: string;
          runDoctor: string;
          skillUsage: string;
          userModel: string;
        };
        generatedAt: string;
        kind: 'hermes_learning_loop_status';
        ok: boolean;
        nextRetrospectiveRun?: {
          artifactCount: number;
          channel?: string;
          command: string;
          eventCount: number;
          runId: string;
          status: string;
          tags: string[];
        };
        recommendations: string[];
        reviewGates: {
          lessonWritesRequireApproval: boolean;
          skillCandidatesRequireReview: boolean;
          skillLifecycleRequiresApproval: boolean;
          userModelWritesRequireApproval: boolean;
        };
        state: {
          recentRuns: Array<{
            artifactCount: number;
            channel?: string;
            eventCount: number;
            hasLearningRetrospective: boolean;
            runId: string;
            status: string;
            tags: string[];
          }>;
          patterns: {
            deprecatedCount: number;
            observedCount: number;
            reinforcedCount: number;
            total: number;
          };
          skillCandidates: {
            eligibleCandidateCount?: number;
            ineligibleCandidateCount?: number;
            learningCandidateCount: number;
            root: string;
            samples?: Array<{
              candidateId: string;
              eligible: boolean;
              installCommand?: string;
              inspectCommand: string;
              promotion?: {
                reason: string;
                status: string;
                successfulRunCount: number;
                threshold: number;
              };
              skillName: string;
            }>;
          };
          skillUsage: {
            count: number;
            deprecatedCount: number;
            reinforcedCount: number;
            top: Array<{
              invocationCount: number;
              recommendation: string;
              score: number;
              skillName: string;
            }>;
          };
        };
        summary: {
          acceptedUserObservationCount: number;
          deprecatedSkillCount: number;
          inspectedRunLimit: number;
          lessonCandidateCount: number;
          patternCount: number;
          pendingLessonCandidateCount: number;
          pendingReviewCount: number;
          pendingUserObservationCount: number;
          recentRunCount: number;
          retrospectiveCoveragePercent: number;
          retrospectiveEligibleRunCount: number;
          reinforcedSkillCount: number;
          retrospectiveArtifactCount: number;
          runningRunCount: number;
          skillUsageCount: number;
          staleRunningRunCount: number;
        };
        workDir: string;
      } | null> => ipcRenderer.invoke('tools.hermesLearningLoop.get', options ?? {}),
      runDoctor: (options?: {
        cwd?: string;
        limit?: number;
        staleAfterMinutes?: number;
      }): Promise<{
        error?: string;
        ok: boolean;
        result?: {
          command: string;
          filters: {
            limit: number;
            staleAfterMinutes: number;
          };
          generatedAt: string;
          recommendations: string[];
          runs: Array<{
            artifactCount: number;
            eventCount: number;
            runId: string;
            runningForMinutes?: number;
            source?: string;
            staleRunning?: boolean;
            startedAt: string;
            status: string;
          }>;
          schemaVersion: 1;
          summary: {
            cancelledRunCount: number;
            completedRunCount: number;
            failedRunCount: number;
            inspectedRunCount: number;
            runningRunCount: number;
            staleRunningRunCount: number;
          };
          workDir: string;
        };
      }> => ipcRenderer.invoke('tools.hermesLearningLoop.runDoctor', options ?? {}),
      runRetrospective: (options: {
        cwd?: string;
        force?: boolean;
        runId: string;
      }): Promise<{
        error?: string;
        ok: boolean;
        result?: {
          command: string;
          lessonCandidateCount: number;
          ok: boolean;
          patternLibraryPath?: string;
          retrospectiveArtifact?: string;
          runId: string;
          skillCandidateCount: number;
          skillUsageCount: number;
          skipped: boolean;
          skippedReason?: string;
          summary?: string;
          toolSequence: string[];
        };
      }> => ipcRenderer.invoke('tools.hermesLearningLoop.retrospective', options),
    },
    skillPackage: {
      list: (options?: {
        cwd?: string;
        limit?: number;
      }): Promise<{
        cacheDir: string;
        disabledCount: number;
        enabledCount: number;
        installedCount: number;
        lockfilePath: string;
        packages: Array<{
          averageDurationMs?: number;
          contentPreview?: string;
          contentPreviewTruncated?: boolean;
          enabled: boolean;
          exists: boolean;
          failureCount?: number;
          installedAt: number;
          integrityOk: boolean;
          invocationCount?: number;
          lastError?: string;
          lastLifecycleReason?: string;
          lastLifecycleReviewer?: string;
          lastUsedAt?: number;
          name: string;
          path: string;
          rollbackableCount: number;
          sizeBytes?: number;
          source: 'hub' | 'local' | 'git';
          status: 'active' | 'disabled' | 'deprecated';
          successCount?: number;
          version: string;
        }>;
        reviewCommands: string[];
        rollbackableCount: number;
        skillRoot: string;
      } | null> => ipcRenderer.invoke('tools.skillPackage.list', options ?? {}),
      lifecycle: (options: {
        action: 'enable' | 'disable' | 'deprecate';
        approvedBy: string;
        cwd?: string;
        name: string;
        reason?: string;
      }): Promise<{
        error?: string;
        ok: boolean;
        package?: {
          averageDurationMs?: number;
          contentPreview?: string;
          contentPreviewTruncated?: boolean;
          enabled: boolean;
          exists: boolean;
          failureCount?: number;
          installedAt: number;
          integrityOk: boolean;
          invocationCount?: number;
          lastError?: string;
          lastLifecycleReason?: string;
          lastLifecycleReviewer?: string;
          lastUsedAt?: number;
          name: string;
          path: string;
          rollbackableCount: number;
          sizeBytes?: number;
          source: 'hub' | 'local' | 'git';
          status: 'active' | 'disabled' | 'deprecated';
          successCount?: number;
          version: string;
        };
      }> => ipcRenderer.invoke('tools.skillPackage.lifecycle', options),
      rollback: (options: {
        approvedBy: string;
        cwd?: string;
        name: string;
        reason?: string;
        snapshotId?: string;
      }): Promise<{
        error?: string;
        ok: boolean;
        package?: {
          averageDurationMs?: number;
          contentPreview?: string;
          contentPreviewTruncated?: boolean;
          enabled: boolean;
          exists: boolean;
          failureCount?: number;
          installedAt: number;
          integrityOk: boolean;
          invocationCount?: number;
          lastError?: string;
          lastLifecycleReason?: string;
          lastLifecycleReviewer?: string;
          lastUsedAt?: number;
          name: string;
          path: string;
          rollbackableCount: number;
          sizeBytes?: number;
          source: 'hub' | 'local' | 'git';
          status: 'active' | 'disabled' | 'deprecated';
          successCount?: number;
          version: string;
        };
      }> => ipcRenderer.invoke('tools.skillPackage.rollback', options),
      delete: (options: {
        approvedBy: string;
        cwd?: string;
        name: string;
        reason?: string;
      }): Promise<{
        deletedName?: string;
        error?: string;
        ok: boolean;
      }> => ipcRenderer.invoke('tools.skillPackage.delete', options),
      update: (options: {
        approvedBy: string;
        cwd?: string;
        force?: boolean;
        name: string;
        reason?: string;
        version?: string;
      }): Promise<{
        error?: string;
        ok: boolean;
        package?: {
          averageDurationMs?: number;
          contentPreview?: string;
          contentPreviewTruncated?: boolean;
          enabled: boolean;
          exists: boolean;
          failureCount?: number;
          installedAt: number;
          integrityOk: boolean;
          invocationCount?: number;
          lastError?: string;
          lastLifecycleReason?: string;
          lastLifecycleReviewer?: string;
          lastUsedAt?: number;
          name: string;
          path: string;
          rollbackableCount: number;
          sizeBytes?: number;
          source: 'hub' | 'local' | 'git';
          status: 'active' | 'disabled' | 'deprecated';
          successCount?: number;
          version: string;
        };
      }> => ipcRenderer.invoke('tools.skillPackage.update', options),
      reset: (options: {
        approvedBy: string;
        cwd?: string;
        name: string;
        reason?: string;
        version?: string;
      }): Promise<{
        error?: string;
        ok: boolean;
        package?: {
          averageDurationMs?: number;
          contentPreview?: string;
          contentPreviewTruncated?: boolean;
          enabled: boolean;
          exists: boolean;
          failureCount?: number;
          installedAt: number;
          integrityOk: boolean;
          invocationCount?: number;
          lastError?: string;
          lastLifecycleReason?: string;
          lastLifecycleReviewer?: string;
          lastUsedAt?: number;
          name: string;
          path: string;
          rollbackableCount: number;
          sizeBytes?: number;
          source: 'hub' | 'local' | 'git';
          status: 'active' | 'disabled' | 'deprecated';
          successCount?: number;
          version: string;
        };
      }> => ipcRenderer.invoke('tools.skillPackage.reset', options),
      patch: (options: {
        approvedBy: string;
        cwd?: string;
        expectedReplacements?: number;
        name: string;
        newText: string;
        oldText: string;
        reason?: string;
      }): Promise<{
        error?: string;
        ok: boolean;
        package?: {
          averageDurationMs?: number;
          contentPreview?: string;
          contentPreviewTruncated?: boolean;
          enabled: boolean;
          exists: boolean;
          failureCount?: number;
          installedAt: number;
          integrityOk: boolean;
          invocationCount?: number;
          lastError?: string;
          lastLifecycleReason?: string;
          lastLifecycleReviewer?: string;
          lastUsedAt?: number;
          name: string;
          path: string;
          rollbackableCount: number;
          sizeBytes?: number;
          source: 'hub' | 'local' | 'git';
          status: 'active' | 'disabled' | 'deprecated';
          successCount?: number;
          version: string;
        };
      }> => ipcRenderer.invoke('tools.skillPackage.patch', options),
    },
    learningUsage: {
      list: (options?: {
        cwd?: string;
        limit?: number;
      }): Promise<
        Array<{
          averageDurationMs?: number;
          deprecated: boolean;
          failureCount: number;
          invocationCount: number;
          lastDurationMs?: number;
          lastError?: string;
          lastRunId?: string;
          lastUsedAt: string;
          nextAction: string;
          recommendation: 'observe' | 'reinforce' | 'improve' | 'deprecate';
          reinforced: boolean;
          score: number;
          scoreReason: string;
          skillName: string;
          successCount: number;
        }>
      > => ipcRenderer.invoke('tools.learningUsage.list', options ?? {}),
    },
    skillCandidate: {
      list: (options?: {
        cwd?: string;
        eligibleOnly?: boolean;
        limit?: number;
        skillRoot?: string;
      }): Promise<
        Array<{
          candidateChecksum?: string;
          candidateDiffPreview?: {
            addedLines: number;
            preview: string;
            removedLines: number;
            summary: string;
            truncated: boolean;
          };
          eligible: boolean;
          id: string;
          installState?:
            | 'not-installed'
            | 'installed-current'
            | 'installed-different'
            | 'installed-missing';
          installedChecksum?: string;
          installedIntegrityOk?: boolean;
          installedPath?: string;
          installedVersion?: string;
          kind: string;
          reason: string;
          reviewCommands?: string[];
          skillName: string;
          skillPath: string;
          sourceJobId: string;
          sourceRunId?: string;
          successfulRunCount: number;
          title: string;
          toolSequence?: string[];
        }>
      > => ipcRenderer.invoke('tools.skillCandidate.list', options ?? {}),
      install: (options: {
        approvedBy: string;
        candidatePath: string;
        cwd?: string;
        overwrite?: boolean;
        workspaceSkillRoot?: string;
      }): Promise<{
        candidate?: {
          candidateChecksum?: string;
          candidateDiffPreview?: {
            addedLines: number;
            preview: string;
            removedLines: number;
            summary: string;
            truncated: boolean;
          };
          eligible: boolean;
          id: string;
          installState?:
            | 'not-installed'
            | 'installed-current'
            | 'installed-different'
            | 'installed-missing';
          installedChecksum?: string;
          installedIntegrityOk?: boolean;
          installedPath?: string;
          installedVersion?: string;
          kind: string;
          reason: string;
          reviewCommands?: string[];
          skillName: string;
          skillPath: string;
          sourceJobId: string;
          sourceRunId?: string;
          successfulRunCount: number;
          title: string;
          toolSequence?: string[];
        };
        error?: string;
        installed?: {
          absoluteInstalledPath: string;
          approvedAt: string;
          approvedBy: string;
          candidateId: string;
          installedPath: string;
          skillName: string;
          sourceCandidatePath: string;
        };
        ok: boolean;
      }> => ipcRenderer.invoke('tools.skillCandidate.install', options),
    },
    lessonsVault: {
      preview: (options?: {
        category?: string;
        concept?: string;
        cwd?: string;
        includeKeywords?: boolean;
        limit?: number;
        query?: string;
        vaultDir?: string;
      }): Promise<{
        commands: {
          exportVault: string;
          graphJson: string;
          graphMarkdown: string;
        };
        concepts: Array<{
          id: string;
          label: string;
          lessonCount: number;
          path: string;
          sources: string[];
        }>;
        counts: {
          concepts: number;
          files: number;
          lessons: number;
          relations: number;
        };
        generatedAt: string;
        kind: 'lessons_vault_preview';
        rootDir: string;
        schemaVersion: 1;
        vaultDir: string;
      } | null> => ipcRenderer.invoke('tools.lessonsVault.preview', options ?? {}),
      getConceptDetails: (options: {
        conceptName: string;
        cwd?: string;
      }): Promise<{
        concept: { id: string; label: string; weight: number };
        lessons: Array<{
          id: string;
          category: string;
          content: string;
          context?: string;
          createdBy?: {
            runId?: string;
            outcomeId?: string;
            sagaId?: string;
            note?: string;
            at: number;
          };
          usedBy?: Array<{ runId: string; at: number }>;
        }>;
        backlinks: string[];
      } | null> => ipcRenderer.invoke('tools.lessonsVault.getConceptDetails', options),
    },
  },

  /**
   * Code Buddy HTTP server (core `src/server/index.ts`) lifecycle —
   * exposes start/stop/status so the Cowork UI can boot the server
   * (default port 3000, WS gateway 3001) from a button in the titlebar.
   */
  server: {
    status: (): Promise<{
      running: boolean;
      port: number | null;
      host: string | null;
      startedAt: number | null;
      websocket: boolean;
      error?: string | null;
    }> => ipcRenderer.invoke('server.status'),
    start: (cfg?: {
      port?: number;
      host?: string;
      websocketEnabled?: boolean;
    }): Promise<{
      running: boolean;
      port: number | null;
      host: string | null;
      startedAt: number | null;
      websocket: boolean;
      error?: string | null;
    }> => ipcRenderer.invoke('server.start', cfg ?? {}),
    stop: (): Promise<{
      running: boolean;
      port: number | null;
      host: string | null;
      startedAt: number | null;
      websocket: boolean;
      error?: string | null;
    }> => ipcRenderer.invoke('server.stop'),
    dashboard: (): Promise<{
      recent: Array<{
        timestamp: number;
        method: string;
        path: string;
        statusCode: number;
        responseTimeMs: number;
        ip: string;
      }>;
      stats: {
        total: number;
        errors: number;
        averageLatency: number;
        uptime: number;
        byStatus: Record<string, number>;
      } | null;
    }> => ipcRenderer.invoke('server.dashboard'),
  },

  /**
   * Remote backend (Phase B2) — connect this desktop to a REMOTE Code Buddy
   * backend's `/desktop` WebSocket. The socket lives entirely in the main
   * process (avoids renderer CSP/CORS); the token never leaves main. Note
   * this is distinct from the `remote` namespace above, which is the inbound
   * gateway / channels feature.
   */
  remoteBackend: {
    connect: (url: string, token: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('remote-backend.connect', { url, token }),
    disconnect: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('remote-backend.disconnect'),
    status: (): Promise<{
      status: 'disconnected' | 'connecting' | 'connected' | 'error';
      host?: string;
      error?: string;
    }> => ipcRenderer.invoke('remote-backend.status'),
    getConfig: (): Promise<{ url: string; autoConnect: boolean; hasToken: boolean }> =>
      ipcRenderer.invoke('remote-backend.getConfig'),
    /** Subscribe to live status pushes. Returns an unsubscribe function. */
    onStatus: (
      callback: (status: {
        status: 'disconnected' | 'connecting' | 'connected' | 'error';
        host?: string;
        error?: string;
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          status: 'disconnected' | 'connecting' | 'connected' | 'error';
          host?: string;
          error?: string;
        }
      ) => callback(data);
      ipcRenderer.on('remote-backend:status', listener);
      return () => {
        ipcRenderer.removeListener('remote-backend:status', listener);
      };
    },
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
      kind: 'text' | 'image' | 'pdf' | 'document' | 'binary' | 'error';
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
      documentText?: string;
      documentType?: string;
      documentStats?: {
        wordCount?: number;
        embeddedImageCount?: number;
        sheetCount?: number;
        slideCount?: number;
      };
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
    stop: (): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke('team.stop'),
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

  // Mission Control OS — real council ledgers (read-only)
  os: {
    /** Latest council run (DHI + per-model verdicts) + DHI history, from ~/.codebuddy JSONL ledgers. */
    councilHealth: (
      historyLimit?: number
    ): Promise<{
      session: {
        id: string;
        title: string;
        dhi: number;
        verdicts: Array<{
          agentId: string;
          model: string;
          label: string;
          score: number;
          stance: 'approve' | 'revise' | 'reject';
        }>;
      } | null;
      history: Array<{ at: string; taskType: string; dhi: number }>;
    }> => ipcRenderer.invoke('os.councilHealth', historyLimit),
    /** Current Collective Knowledge Graph (folded from the append-only ledger). */
    knowledgeGraph: (
      maxNodes?: number
    ): Promise<{
      nodes: Array<{
        id: string;
        type: 'lesson' | 'decision' | 'fact' | 'discovery';
        label: string;
        confidence?: number;
      }>;
      edges: Array<{ from: string; to: string; kind: string }>;
      truncated: boolean;
    }> => ipcRenderer.invoke('os.knowledgeGraph', maxNodes),
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
        peerChatProvider?: unknown;
        capability?: unknown;
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
    refreshCapabilities: (
      peerId?: string
    ): Promise<{ success: boolean; peer?: unknown; peers?: unknown[]; error?: string }> =>
      ipcRenderer.invoke('fleet.refreshCapabilities', peerId),
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
    /**
     * Fleet P5 — dispatch a goal across the fleet via the task router.
     * Returns the saga id once the dispatch is queued; sagas are
     * polled separately via `listSagas`.
     */
    dispatch: (input: {
      goal: string;
      parallelism?: number;
      privacyTag?: 'public' | 'sensitive';
      dispatchProfile?: 'balanced' | 'research' | 'code' | 'review' | 'safe';
      maxCostUsd?: number;
      targetPeerIds?: string[];
      deliveryChannel?: string;
      sourceSessionId?: string;
    }): Promise<{
      ok: boolean;
      sagaId?: string;
      error?: string;
      privacyTag?: 'public' | 'sensitive';
      dispatchProfile?: 'balanced' | 'research' | 'code' | 'review' | 'safe';
      lintWarning?: string;
    }> => ipcRenderer.invoke('fleet.dispatch', input),
    /** List currently-tracked sagas (active + recent). */
    listSagas: (): Promise<
      Array<{
        id: string;
        goal: string;
        status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
        steps: Array<{
          peerId: string;
          model: string;
          lane: 'primary' | 'fallback' | 'parallel';
          status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
          toolPolicy?: {
            profile?: string;
            policyProfile?: string;
            defaultAction?: string;
            summary?: string;
          };
        }>;
        finalResult?: string;
        createdAt: number;
      }>
    > => ipcRenderer.invoke('fleet.listSagas'),
    /**
     * Operator cancel — stops the saga orchestration. An LLM call already
     * in flight on a remote peer finishes there; its result is discarded.
     */
    cancelSaga: (sagaId: string): Promise<{ ok: boolean; error?: string; status?: string }> =>
      ipcRenderer.invoke('fleet.cancelSaga', sagaId),
    /** Re-dispatch a terminal saga as a new saga with the same goal + routing intent. */
    replaySaga: (
      sagaId: string
    ): Promise<{
      ok: boolean;
      sagaId?: string;
      error?: string;
      privacyTag?: 'public' | 'sensitive';
      dispatchProfile?: 'balanced' | 'research' | 'code' | 'review' | 'safe';
      lintWarning?: string;
    }> => ipcRenderer.invoke('fleet.replaySaga', sagaId),
    /** Interactive peer chat sessions (peer.chat-session.*). Transcript stays on the peer. */
    peerSessionStart: (
      peerId: string,
      options?: { model?: string; dispatchProfile?: string; systemPrompt?: string }
    ): Promise<{
      ok: boolean;
      error?: string;
      sessionId?: string;
      expiresAt?: number;
      dispatchProfile?: string;
    }> => ipcRenderer.invoke('fleet.peerSessionStart', peerId, options),
    peerSessionSay: (
      peerId: string,
      sessionId: string,
      prompt: string
    ): Promise<{ ok: boolean; error?: string; text?: string; finishReason?: string | null }> =>
      ipcRenderer.invoke('fleet.peerSessionSay', peerId, sessionId, prompt),
    peerSessionEnd: (
      peerId: string,
      sessionId: string
    ): Promise<{ ok: boolean; error?: string; closed?: boolean }> =>
      ipcRenderer.invoke('fleet.peerSessionEnd', peerId, sessionId),
    peerSessionList: (
      peerId: string
    ): Promise<{
      ok: boolean;
      error?: string;
      count?: number;
      sessions: Array<{
        sessionId: string;
        turnCount: number;
        model?: string;
        dispatchProfile?: string;
        ageMs?: number;
        idleMs?: number;
        expiresInMs?: number;
      }>;
    }> => ipcRenderer.invoke('fleet.peerSessionList', peerId),
    /** Dry-run the router on a goal (no saga created): lanes + scores + rationale. */
    routePreview: (input: {
      goal: string;
      parallelism?: number;
      privacyTag?: 'public' | 'sensitive';
      dispatchProfile?: 'balanced' | 'research' | 'code' | 'review' | 'safe';
      council?: boolean;
      chainRoles?: string[];
      targetPeerIds?: string[];
      maxCostUsd?: number;
    }): Promise<{
      ok: boolean;
      error?: string;
      privacyTag?: 'public' | 'sensitive';
      lintWarning?: string;
      rationale?: string;
      primary?: { peerId: string; model: string; score?: number; role?: string };
      fallback?: { peerId: string; model: string; score?: number; role?: string };
      parallel?: Array<{ peerId: string; model: string; score?: number; role?: string }>;
      chain?: Array<{ peerId: string; model: string; score?: number; role?: string }>;
    }> => ipcRenderer.invoke('fleet.routePreview', input),
    /** Today's fleet spend vs caps (per provider / per peer) + 7-day total. */
    costSummary: (): Promise<{
      ok: boolean;
      error?: string;
      summary?: {
        todayUsd: number;
        todayByProvider: Record<string, number>;
        todayByPeer: Record<string, number>;
        weekUsd: number;
      };
      budget?: { maxDailyUsd: number; maxSagaUsd: number };
    }> => ipcRenderer.invoke('fleet.costSummary'),
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
    catalog: (): Promise<unknown[]> => ipcRenderer.invoke('test.catalog'),
    runCatalogItem: (id: string): Promise<unknown> => ipcRenderer.invoke('test.runCatalogItem', id),
    runFailing: (): Promise<unknown> => ipcRenderer.invoke('test.runFailing'),
    cancel: (): Promise<{ success: boolean }> => ipcRenderer.invoke('test.cancel'),
    getState: (): Promise<{
      framework: string | null;
      lastResult: unknown | null;
      isRunning: boolean;
      catalog?: unknown[];
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
      sources?: string[];
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
        source?: string;
        platform?: string;
        origin?: string;
        userId?: string;
        tags?: string[];
        totalCost?: number;
        totalTokens?: number;
        toolCallCount?: number;
      }>
    > => ipcRenderer.invoke('audit.listRuns', filter),
    getRunDetail: (runId: string): Promise<unknown | null> =>
      ipcRenderer.invoke('audit.getRunDetail', runId),
    searchRuns: (filter?: {
      query?: string;
      limit?: number;
      sources?: string[];
    }): Promise<{
      schemaVersion: 1;
      generatedAt: string;
      query: string;
      filters: { limit: number; sources: string[] };
      count: number;
      results: Array<{
        runId: string;
        objective: string;
        status: 'running' | 'completed' | 'failed' | 'cancelled';
        startedAt: number;
        matched: 'artifact' | 'event' | 'summary';
        score: number;
        snippet: string;
        artifact?: string;
        eventType?: string;
        source?: string;
      }>;
    }> => ipcRenderer.invoke('audit.searchRuns', filter),
    getArtifactIndexDoctorStatus: (): Promise<{
      schemaVersion: 1;
      generatedAt: string;
      kind: 'artifact_index_doctor_status';
      status: 'healthy' | 'attention' | 'unavailable';
      unavailable: boolean;
      totalRows: number;
      healthyRows: number;
      staleRows: number;
      orphanedRows: number;
      rows: Array<{
        runId: string;
        artifact: string;
        reason: 'missing_run' | 'missing_artifact';
      }>;
      recommendations: string[];
      repairCommands: {
        staleOnly: string;
        includeOrphans: string;
      };
    }> => ipcRenderer.invoke('audit.getArtifactIndexDoctorStatus'),
    buildRecallPack: (filter?: {
      cwd?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      query?: string;
      limit?: number;
      maxMemories?: number;
      maxMatchesPerRun?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    }): Promise<{
      schemaVersion: 1;
      generatedAt: string;
      query: string;
      filters: {
        limit: number;
        maxMemories: number;
        maxMatchesPerRun: number;
        maxLessons: number;
        maxSessions: number;
        sources: string[];
      };
      count: number;
      lessonCount: number;
      lessons: Array<{
        category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
        content: string;
        context?: string;
        createdAt: number;
        id: string;
        source: 'user_correction' | 'self_observed' | 'manual';
      }>;
      memories: Array<{
        category?: string;
        content: string;
        file: string;
        key?: string;
        line: number;
        scope: 'project' | 'project-memory' | 'user' | 'custom';
        score: number;
        sourceSessionId?: string;
      }>;
      memoryCount: number;
      runCount: number;
      results: Array<{
        runId: string;
        objective: string;
        status: 'running' | 'completed' | 'failed' | 'cancelled';
        startedAt: number;
        matched: 'artifact' | 'event' | 'summary';
        score: number;
        snippet: string;
        artifact?: string;
        eventType?: string;
        source?: string;
      }>;
      runs: Array<{
        artifactCount: number;
        channel?: string;
        eventCount: number;
        matches: Array<{
          artifact?: string;
          eventType?: string;
          matched: 'artifact' | 'event' | 'summary';
          score: number;
          snippet: string;
        }>;
        objective: string;
        runId: string;
        source?: string;
        startedAt: number;
        status: 'running' | 'completed' | 'failed' | 'cancelled';
        tags: string[];
      }>;
      sessionCount: number;
      sessions: Array<{
        id: string;
        lastAccessedAt: string;
        messageId?: number;
        name: string;
        parentSessionId?: string;
        role?: string;
        score?: number;
        snippet?: string;
        workingDirectory: string;
      }>;
      promptContext: string;
    }> => ipcRenderer.invoke('audit.buildRecallPack', filter),
    buildTrajectoryExport: (filter?: {
      includeArtifactContent?: boolean;
      maxArtifactBytes?: number;
      maxEventValueBytes?: number;
      runId?: string;
    }): Promise<unknown | null> => ipcRenderer.invoke('audit.buildTrajectoryExport', filter),
    buildPolicyEvalReport: (filter?: {
      maxArtifactBytes?: number;
      policyIds?: string[];
      runId?: string;
    }): Promise<unknown | null> => ipcRenderer.invoke('audit.buildPolicyEvalReport', filter),
    buildGoldenWorkflowEvalReport: (filter?: {
      fixtureIds?: string[];
      maxArtifactBytes?: number;
      runId?: string;
    }): Promise<unknown | null> =>
      ipcRenderer.invoke('audit.buildGoldenWorkflowEvalReport', filter),
    buildMobileSnapshot: (filter?: {
      cwd?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      query?: string;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    }): Promise<unknown> => ipcRenderer.invoke('audit.buildMobileSnapshot', filter),
    buildMobileGatewayContract: (filter?: {
      cwd?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      includeSnapshot?: boolean;
      query?: string;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    }): Promise<unknown> => ipcRenderer.invoke('audit.buildMobileGatewayContract', filter),
    buildMobileGatewayReviewDraft: (filter?: {
      action?: string;
      cwd?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      includeSnapshot?: boolean;
      localOperator?: boolean;
      method?: 'GET' | 'POST' | string;
      path?: string;
      query?: string;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    }): Promise<unknown> => ipcRenderer.invoke('audit.buildMobileGatewayReviewDraft', filter),
    buildMobileGatewayListenerShell: (filter?: {
      cwd?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      query?: string;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    }): Promise<unknown> => ipcRenderer.invoke('audit.buildMobileGatewayListenerShell', filter),
    buildMobilePairingState: (filter?: {
      cwd?: string;
      deviceLabel?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      query?: string;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
      ttlSeconds?: number;
    }): Promise<unknown> => ipcRenderer.invoke('audit.buildMobilePairingState', filter),
    buildMobilePairingAcceptancePlan: (filter?: {
      cwd?: string;
      deviceLabel?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      localOperatorLabel?: string;
      query?: string;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
      ttlSeconds?: number;
    }): Promise<unknown> => ipcRenderer.invoke('audit.buildMobilePairingAcceptancePlan', filter),
    buildMobileApprovalQueue: (filter?: {
      cwd?: string;
      deviceLabel?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      query?: string;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
      ttlSeconds?: number;
    }): Promise<unknown> => ipcRenderer.invoke('audit.buildMobileApprovalQueue', filter),
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
      output?: string;
      error?: string;
      handled?: boolean;
      action?: {
        type: 'open_schedule' | 'create_schedule' | 'ui_effect';
        uiEffect?:
          | 'open_model_picker'
          | 'run_orchestrator'
          | 'open_orchestrator_launcher'
          | 'open_fleet'
          | 'set_plan_mode'
          | 'open_lessons'
          | 'open_team'
          | 'open_companion'
          | 'open_spec'
          | 'open_settings'
          | 'open_panel'
          | 'engine_action';
        args?: string[];
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

  // Autonomy: read-only snapshot of the fleet colab queue for the Autonomy panel.
  autonomy: {
    snapshot: (
      dir?: string
    ): Promise<{
      ok: boolean;
      error?: string;
      dir: string | null;
      tasks: Array<{
        id: string;
        title: string;
        description?: string;
        status: string;
        priority: string;
        claimedBy?: string | null;
        claimedAt?: string | null;
        dependsOn?: string[];
      }>;
      worklog: Array<{
        id?: string;
        date?: string;
        agent?: string;
        taskId?: string | null;
        summary?: string;
      }>;
      presence: Record<
        string,
        { host?: string; status?: string; currentTask?: string | null; lastSeen?: string }
      >;
    }> => ipcRenderer.invoke('autonomy.snapshot', dir),
    // Daemon lifecycle — pilot the always-on `codebuddy-autonomy` service.
    daemonStatus: (): Promise<{
      ok: boolean;
      error?: string;
      serviceName: string;
      service: { installed: boolean; running: boolean; platform: string } | null;
      queueDir: string;
      manageCommand: string;
    }> => ipcRenderer.invoke('autonomy.daemonStatus'),
    serviceControl: (
      action: 'start' | 'stop' | 'restart'
    ): Promise<{
      ok: boolean;
      error?: string;
      action: 'start' | 'stop' | 'restart';
      service: { installed: boolean; running: boolean; platform: string } | null;
    }> => ipcRenderer.invoke('autonomy.serviceControl', action),
    serviceInstall: (options?: {
      dir?: string;
      model?: string;
      ollamaUrl?: string;
      intervalMs?: number;
      executor?: 'artifact' | 'agent';
      workspace?: string;
    }): Promise<{
      ok: boolean;
      error?: string;
      servicePath?: string;
      platform?: string;
      instructions?: string;
      queueDir?: string;
      model?: string;
      executor?: 'artifact' | 'agent';
    }> => ipcRenderer.invoke('autonomy.serviceInstall', options),
    serviceUninstall: (): Promise<{
      ok: boolean;
      error?: string;
      servicePath?: string;
      platform?: string;
    }> => ipcRenderer.invoke('autonomy.serviceUninstall'),
    // One-shot tick through the real CLI (`autonomy run --json`).
    runTick: (
      dir?: string
    ): Promise<{
      ok: boolean;
      error?: string;
      ticks?: number;
      outcomes?: Record<string, number>;
      stoppedReason?: string;
      output?: string;
    }> => ipcRenderer.invoke('autonomy.runTick', dir),
    // Free-first model ladder (local → network → paid) + current choice.
    modelTier: (): Promise<{
      ok: boolean;
      error?: string;
      ladder: Array<{
        tier: 'local' | 'network' | 'escalated';
        model: string;
        baseUrl?: string;
        paid: boolean;
        configured: boolean;
      }>;
      currentChoice?: { model: string; tier: string; paid: boolean; reason: string };
    }> => ipcRenderer.invoke('autonomy.modelTier'),
    // Tail the always-on service's logs (Linux journalctl; other
    // platforms return the inspection command in `error`).
    serviceLogs: (
      lines?: number
    ): Promise<{ ok: boolean; error?: string; source?: string; lines?: string[] }> =>
      ipcRenderer.invoke('autonomy.serviceLogs', lines),
    // Colab board mutations — the kanban's write half (add/claim/complete/
    // block/release + expired-claim sweep), via the core FleetColabStore.
    taskAdd: (input: {
      title: string;
      description?: string;
      priority?: 'critical' | 'high' | 'medium' | 'low';
      dependsOn?: string[];
      verifyCommand?: string;
      acceptanceCriteria?: string[];
      dir?: string;
    }): Promise<{
      ok: boolean;
      error?: string;
      task?: {
        id: string;
        title: string;
        description?: string;
        status: string;
        priority: string;
        claimedBy?: string | null;
        blockedReason?: string;
        dependsOn?: string[];
      };
      dir?: string;
    }> => ipcRenderer.invoke('autonomy.taskAdd', input),
    taskClaim: (
      taskId: string,
      dir?: string
    ): Promise<{
      ok: boolean;
      error?: string;
      task?: {
        id: string;
        title: string;
        status: string;
        priority: string;
        claimedBy?: string | null;
      };
      dir?: string;
    }> => ipcRenderer.invoke('autonomy.taskClaim', taskId, dir),
    taskComplete: (
      taskId: string,
      summary: string,
      dir?: string
    ): Promise<{
      ok: boolean;
      error?: string;
      task?: {
        id: string;
        title: string;
        status: string;
        priority: string;
        claimedBy?: string | null;
      };
      dir?: string;
    }> => ipcRenderer.invoke('autonomy.taskComplete', taskId, summary, dir),
    taskBlock: (
      taskId: string,
      reason: string,
      dir?: string
    ): Promise<{
      ok: boolean;
      error?: string;
      task?: {
        id: string;
        title: string;
        status: string;
        priority: string;
        blockedReason?: string;
      };
      dir?: string;
    }> => ipcRenderer.invoke('autonomy.taskBlock', taskId, reason, dir),
    taskRelease: (
      taskId: string,
      dir?: string
    ): Promise<{
      ok: boolean;
      error?: string;
      task?: {
        id: string;
        title: string;
        status: string;
        priority: string;
        claimedBy?: string | null;
      };
      dir?: string;
    }> => ipcRenderer.invoke('autonomy.taskRelease', taskId, dir),
    reclaimExpired: (
      dir?: string
    ): Promise<{ ok: boolean; error?: string; reclaimed: string[]; dir?: string }> =>
      ipcRenderer.invoke('autonomy.reclaimExpired', dir),
  },

  lessons: {
    add: (
      category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT',
      content: string,
      projectId?: string
    ): Promise<{ success: boolean; error?: string; lessonId?: string }> =>
      ipcRenderer.invoke('lessons.add', category, content, projectId),
  },

  // `.codebuddy/` backups — same core handler as `buddy backup`.
  backup: {
    list: (): Promise<{ ok: boolean; error?: string; output?: string }> =>
      ipcRenderer.invoke('backup.list'),
    create: (options?: {
      onlyConfig?: boolean;
    }): Promise<{ ok: boolean; error?: string; output?: string }> =>
      ipcRenderer.invoke('backup.create', options),
    verify: (file: string): Promise<{ ok: boolean; error?: string; output?: string }> =>
      ipcRenderer.invoke('backup.verify', file),
    restore: (file: string): Promise<{ ok: boolean; error?: string; output?: string }> =>
      ipcRenderer.invoke('backup.restore', file),
  },

  // Research / Flow live launcher — runs the real core CLI headless;
  // progress streams as `liveLauncher.event` ServerEvents (onEvent).
  liveLauncher: {
    start: (input: {
      kind: 'research' | 'flow';
      prompt: string;
      model?: string;
      provider?: 'ollama' | 'inherit';
      ollamaUrl?: string;
      wide?: boolean;
      workers?: number;
      maxRetries?: number;
      timeoutMs?: number;
    }): Promise<{ ok: boolean; error?: string; runId?: string; reportPath?: string }> =>
      ipcRenderer.invoke('liveLauncher.start', input),
    cancel: (runId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('liveLauncher.cancel', runId),
    status: (
      runId: string
    ): Promise<{
      runId: string;
      kind: 'research' | 'flow';
      prompt: string;
      model?: string;
      provider: 'ollama' | 'inherit';
      status: 'running' | 'succeeded' | 'failed' | 'cancelled';
      startedAt: number;
      endedAt?: number;
      exitCode?: number;
      reportPath?: string;
      logTail: string[];
      result?: string;
      error?: string;
    } | null> => ipcRenderer.invoke('liveLauncher.status', runId),
    list: (): Promise<
      Array<{
        runId: string;
        kind: 'research' | 'flow';
        prompt: string;
        status: 'running' | 'succeeded' | 'failed' | 'cancelled';
        startedAt: number;
        endedAt?: number;
        reportPath?: string;
      }>
    > => ipcRenderer.invoke('liveLauncher.list'),
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

  // ── Hermes review-gated surfaces (CLI parity → Cowork) ──────────────
  lessonCandidate: {
    list: (status?: 'pending' | 'approved' | 'discarded', projectId?: string) =>
      ipcRenderer.invoke('lessonCandidate.list', status, projectId),
    stats: (projectId?: string) => ipcRenderer.invoke('lessonCandidate.stats', projectId),
    get: (id: string, projectId?: string) =>
      ipcRenderer.invoke('lessonCandidate.get', id, projectId),
    approve: (
      id: string,
      input: {
        reviewedBy: string;
        content?: string;
        category?: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
        context?: string;
        reviewNote?: string;
      },
      projectId?: string
    ) => ipcRenderer.invoke('lessonCandidate.approve', id, input, projectId),
    discard: (id: string, input: { reviewedBy?: string; reason?: string }, projectId?: string) =>
      ipcRenderer.invoke('lessonCandidate.discard', id, input, projectId),
    proposeFromSession: (
      chatHistory: Array<{ type: string; content: string }>,
      projectId?: string
    ) => ipcRenderer.invoke('lessonCandidate.proposeFromSession', chatHistory, projectId),
  },

  userModel: {
    list: (status?: 'pending' | 'accepted' | 'discarded', projectId?: string) =>
      ipcRenderer.invoke('userModel.list', status, projectId),
    stats: (projectId?: string) => ipcRenderer.invoke('userModel.stats', projectId),
    summarize: (projectId?: string) => ipcRenderer.invoke('userModel.summarize', projectId),
    get: (id: string, projectId?: string) => ipcRenderer.invoke('userModel.get', id, projectId),
    accept: (
      id: string,
      input: {
        reviewedBy: string;
        content?: string;
        kind?: 'preference' | 'trait' | 'expertise' | 'working-style';
        reviewNote?: string;
      },
      projectId?: string
    ) => ipcRenderer.invoke('userModel.accept', id, input, projectId),
    discard: (id: string, input: { reviewedBy?: string; reason?: string }, projectId?: string) =>
      ipcRenderer.invoke('userModel.discard', id, input, projectId),
    runInference: (chatHistory: Array<{ type: string; content: string }>, projectId?: string) =>
      ipcRenderer.invoke('userModel.runInference', chatHistory, projectId),
  },

  // C3: agent identity files (SOUL.md, USER.md, …). Named `identityFiles` to
  // avoid colliding with the existing persona-activation `identity` API.
  identityFiles: {
    list: (projectId?: string) => ipcRenderer.invoke('identityFiles.list', projectId),
    get: (name: string, projectId?: string) =>
      ipcRenderer.invoke('identityFiles.get', name, projectId),
    set: (name: string, content: string, projectId?: string) =>
      ipcRenderer.invoke('identityFiles.set', name, content, projectId),
  },

  // C3: read-only view of paired device nodes (pairing stays on the CLI)
  deviceNodes: {
    list: () => ipcRenderer.invoke('deviceNodes.list'),
  },

  // A1: isolated Code Buddy config profiles ([profiles.<name>] in the user toml)
  profiles: {
    list: () => ipcRenderer.invoke('profiles.list'),
    active: () => ipcRenderer.invoke('profiles.active'),
    create: (name: string) => ipcRenderer.invoke('profiles.create', name),
    switch: (name: string | null) => ipcRenderer.invoke('profiles.switch', name),
  },

  // Per-channel connection status (read-only) + Phase-5 config surface. Secrets
  // are write-only: `setSecret` never echoes the token and `listConfig` reports
  // `hasSecret` only — the value never crosses back to the renderer.
  channels: {
    status: () => ipcRenderer.invoke('channels.status'),
    listConfig: (opts?: { configPath?: string }) => ipcRenderer.invoke('channels.listConfig', opts),
    setConfig: (
      type: string,
      patch: {
        enabled?: boolean;
        webhookUrl?: string;
        allowedUsers?: string[];
        allowedChannels?: string[];
      },
      opts?: { configPath?: string }
    ) => ipcRenderer.invoke('channels.setConfig', type, patch, opts),
    setEnabled: (type: string, enabled: boolean, opts?: { configPath?: string }) =>
      ipcRenderer.invoke('channels.setEnabled', type, enabled, opts),
    setSecret: (type: string, token: string) =>
      ipcRenderer.invoke('channels.setSecret', type, token),
    deleteSecret: (type: string) => ipcRenderer.invoke('channels.deleteSecret', type),
    removeChannel: (type: string, opts?: { configPath?: string }) =>
      ipcRenderer.invoke('channels.removeChannel', type, opts),
  },

  // DM pairing / allowlist — "who is allowed to DM the agent" (core dm-pairing.ts).
  pairing: {
    status: () => ipcRenderer.invoke('pairing.status'),
    list: () => ipcRenderer.invoke('pairing.list'),
    pending: () => ipcRenderer.invoke('pairing.pending'),
    approve: (channelType: string, code: string, approvedBy?: string) =>
      ipcRenderer.invoke('pairing.approve', channelType, code, approvedBy),
    approveDirect: (
      channelType: string,
      senderId: string,
      approvedBy?: string,
      displayName?: string
    ) =>
      ipcRenderer.invoke('pairing.approveDirect', channelType, senderId, approvedBy, displayName),
    revoke: (channelType: string, senderId: string) =>
      ipcRenderer.invoke('pairing.revoke', channelType, senderId),
  },

  // S6: supervision-only mobile gateway management (loopback to embedded server)
  mobileSupervision: {
    status: () => ipcRenderer.invoke('mobileSupervision.status'),
    approve: (id: string, reviewer?: string) =>
      ipcRenderer.invoke('mobileSupervision.approve', id, reviewer),
    cancel: (id: string) => ipcRenderer.invoke('mobileSupervision.cancel', id),
    rotateCode: () => ipcRenderer.invoke('mobileSupervision.rotateCode'),
  },

  spec: {
    planStart: (goal: string, title?: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.planStart', goal, title, coworkProjectId),
    planContinue: (specProjectId: string, by: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.planContinue', specProjectId, by, coworkProjectId),
    planStatus: (specProjectId: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.planStatus', specProjectId, coworkProjectId),
    next: (
      input: {
        storyId?: string;
        dryRun?: boolean;
        fleet?: 'none' | 'read-only-help' | 'delegated-slices';
        allowedPaths?: string[];
        verify?: string[];
        runVerification?: boolean;
      },
      coworkProjectId?: string
    ) => ipcRenderer.invoke('spec.next', input, coworkProjectId),
    listProjects: (coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.listProjects', coworkProjectId),
    createProject: (title: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.createProject', title, coworkProjectId),
    sprintStatus: (specProjectId?: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.sprintStatus', specProjectId, coworkProjectId),
    listStories: (
      specProjectId: string,
      status?: 'draft' | 'approved' | 'in_progress' | 'done' | 'blocked',
      coworkProjectId?: string
    ) => ipcRenderer.invoke('spec.listStories', specProjectId, status, coworkProjectId),
    getStory: (specProjectId: string, storyId: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.getStory', specProjectId, storyId, coworkProjectId),
    addStory: (
      specProjectId: string,
      input: { title: string; epicId?: string; narrative?: string; acceptanceCriteria?: string[] },
      coworkProjectId?: string
    ) => ipcRenderer.invoke('spec.addStory', specProjectId, input, coworkProjectId),
    approveStory: (
      specProjectId: string,
      storyId: string,
      reviewedBy: string,
      coworkProjectId?: string
    ) =>
      ipcRenderer.invoke('spec.approveStory', specProjectId, storyId, reviewedBy, coworkProjectId),
    startStory: (specProjectId: string, storyId: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.startStory', specProjectId, storyId, coworkProjectId),
    completeStory: (
      specProjectId: string,
      storyId: string,
      evidence: string,
      coworkProjectId?: string
    ) =>
      ipcRenderer.invoke('spec.completeStory', specProjectId, storyId, evidence, coworkProjectId),
    blockStory: (
      specProjectId: string,
      storyId: string,
      reason: string,
      coworkProjectId?: string
    ) => ipcRenderer.invoke('spec.blockStory', specProjectId, storyId, reason, coworkProjectId),
    reopenStory: (specProjectId: string, storyId: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.reopenStory', specProjectId, storyId, coworkProjectId),
    listEpics: (specProjectId: string, coworkProjectId?: string) =>
      ipcRenderer.invoke('spec.listEpics', specProjectId, coworkProjectId),
    addEpic: (
      specProjectId: string,
      input: { title: string; summary?: string },
      coworkProjectId?: string
    ) => ipcRenderer.invoke('spec.addEpic', specProjectId, input, coworkProjectId),
  },
  skillsHub: {
    list: (projectId?: string) => ipcRenderer.invoke('skillsHub.list', projectId),
    listEnabled: (projectId?: string) => ipcRenderer.invoke('skillsHub.listEnabled', projectId),
    setEnabled: (name: string, enabled: boolean, projectId?: string, filePath?: string) =>
      ipcRenderer.invoke('skillsHub.setEnabled', name, enabled, projectId, filePath),
  },
  memoryProvider: {
    list: () => ipcRenderer.invoke('memoryProvider.list'),
    getActive: () => ipcRenderer.invoke('memoryProvider.getActive'),
    setActive: (id: string) => ipcRenderer.invoke('memoryProvider.setActive', id),
  },
});

// Type declaration for the renderer process
declare global {
  interface Window {
    electronAPI: {
      send: (event: ClientEvent) => void;
      on: (callback: (event: ServerEvent) => void) => () => void;
      onEvent: (callback: (event: ServerEvent) => void) => () => void;
      invoke: <T>(event: ClientEvent) => Promise<T>;
      platform: NodeJS.Platform;
      getSystemTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
      getVersion: () => Promise<string>;
      openExternal: (url: string) => Promise<boolean>;
      showItemInFolder: (filePath: string, cwd?: string) => Promise<boolean>;
      sessionPrune: {
        preview: (filter: {
          olderThanDays?: number;
          titleMatch?: string;
          excludeId?: string;
        }) => Promise<{
          matches: Array<{ id: string; title: string; updatedAt: number }>;
          ageSpan: { oldest: number; newest: number } | null;
        }>;
        apply: (ids: string[]) => Promise<{ ok: boolean; archived: number }>;
      };
      media: {
        list: () => Promise<
          Array<{
            path: string;
            kind: 'image' | 'video' | 'audio';
            size: number;
            mtimeMs: number;
            root: string;
            prompt?: string;
            model?: string;
            provider?: string;
            sessionId?: string;
          }>
        >;
        export: (
          sourcePath: string
        ) => Promise<{ ok: boolean; savedTo?: string; canceled?: boolean; error?: string }>;
        exportMany: (paths: string[]) => Promise<{
          ok: boolean;
          copied?: number;
          destDir?: string;
          canceled?: boolean;
          error?: string;
        }>;
        copyToClipboard: (
          sourcePath: string
        ) => Promise<{ ok: boolean; mode?: 'image' | 'path'; error?: string }>;
      };
      film: {
        produce: (request: {
          pitch: string;
          scenes?: number;
          resolution?: string;
          noMusic?: boolean;
          subtitles?: boolean;
          lang?: string;
          style?: 'short' | 'standard';
        }) => Promise<{
          ok: boolean;
          filmPath?: string;
          url?: string;
          sceneCount?: number;
          duration?: number;
          qualityPass?: boolean;
          warnings?: string[];
          error?: string;
        }>;
        onProgress: (
          cb: (p: { phase: string; scene?: number; total?: number; message?: string }) => void
        ) => () => void;
      };
      assistant: {
        get: () => Promise<AssistantConfigResponse>;
        save: (updates: Record<string, string>) => Promise<AssistantSaveResponse>;
        preview: (name: string, text?: string) => Promise<AssistantPreviewResponse>;
        restart: () => Promise<AssistantRestartResponse>;
        getVolume: () => Promise<AssistantVolumeResponse>;
        setVolume: (percent: number) => Promise<AssistantSetVolumeResponse>;
      };
      widgets: {
        render: (data: unknown) => Promise<string | null>;
      };
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
        match: (payload: { embedding: number[]; threshold?: number }) => Promise<unknown>;
        list: () => Promise<unknown[]>;
        remove: (payload: { personId: string }) => Promise<boolean>;
        hasModel: () => Promise<{ installed: boolean; path: string }>;
        selectModelFile: () => Promise<string | null>;
        installModelFromPath: (payload: {
          sourcePath: string;
        }) => Promise<{ ok: boolean; error?: string; installedPath?: string }>;
        downloadModel: (payload: {
          url: string;
        }) => Promise<{ ok: boolean; error?: string; installedPath?: string }>;
        onDownloadProgress: (
          listener: (progress: { bytes: number; total: number | null }) => void
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
          }) => void
        ) => () => void;
      };
      codebuddy: {
        listModels: (payload: {
          endpoint: string;
          apiKey?: string;
        }) => Promise<ProviderModelInfo[]>;
        probeConnection: (payload: {
          endpoint: string;
          apiKey?: string;
        }) => Promise<{ version: string; models: string[]; tools: number }>;
        setGeminiGrounding: (payload: {
          enabled: boolean;
        }) => Promise<{ ok: boolean; reason?: string }>;
        setVisionGrounding: (payload: {
          enabled: boolean;
          model?: string;
        }) => Promise<{ ok: boolean; reason?: string }>;
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
        discoverLocalLmStudio: (payload?: {
          baseUrl?: string;
        }) => Promise<LocalLmStudioDiscoveryResult>;
        modelInventory: (payload?: {
          includeTailnetPeers?: boolean;
        }) => Promise<ModelInventorySnapshot>;
      };
      workflowBuilder: {
        start: () => Promise<{ success: boolean; error?: string }>;
        stop: () => Promise<{ success: boolean; error?: string }>;
        status: () => Promise<{ running: boolean; port: number }>;
        logs: (limit?: number) => Promise<{ lines: string[] }>;
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
        clearOAuthTokens: (serverId: string) => Promise<{ success: boolean; error?: string }>;
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
        reload: () => Promise<{ success: boolean; count: number; skills: Skill[] }>;
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
        updateSlackConfig: (
          config: SlackChannelConfig
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
      automations: {
        list: () => Promise<{
          ok: boolean;
          error?: string;
          reminders: Array<Record<string, unknown>>;
          rules: Array<Record<string, unknown>>;
          runs: Array<Record<string, unknown>>;
        }>;
        toggle: (
          kind: 'rule' | 'reminder',
          id: string,
          enabled: boolean
        ) => Promise<{ ok: boolean; error?: string }>;
        remove: (kind: 'rule' | 'reminder', id: string) => Promise<{ ok: boolean; error?: string }>;
        reminderDone: (id: string) => Promise<{ ok: boolean; error?: string }>;
      };
      evolve: {
        listVariants: (cwd?: string) => Promise<unknown>;
      };
      ckg: {
        stats: () => Promise<{
          entities: number;
          superseded: number;
          relations: number;
          ledgerPath: string;
        } | null>;
        list: (opts?: { limit?: number; type?: string }) => Promise<
          Array<{
            id: string;
            name: string;
            type: string;
            source?: string;
            confidence: number;
            mentions: number;
            contributors: number;
            createdAt: string;
          }>
        >;
        topicsList: () => Promise<string[]>;
        topicsAdd: (topic: string) => Promise<string[]>;
        topicsRemove: (topic: string) => Promise<string[]>;
      };
      science: {
        listVariants: (cwd?: string) => Promise<unknown>;
        status: (cwd?: string) => Promise<unknown>;
      };
      studio: {
        exportZip: (
          root: string
        ) => Promise<{ ok: boolean; savedTo?: string; canceled?: boolean; error?: string }>;
        devServer: {
          start: (request: {
            cwd: string;
            command: string;
            url: string;
            timeoutMs?: number;
          }) => Promise<unknown>;
          stop: (pid: number) => Promise<unknown>;
          status: () => Promise<unknown>;
          logs: (pid: number, lines?: number) => Promise<unknown>;
          onLog: (listener: (payload: { pid: number; lines: string[] }) => void) => () => void;
        };
        files: {
          read: (root: string, relPath: string) => Promise<unknown>;
          write: (root: string, relPath: string, content: string) => Promise<unknown>;
          list: (root: string) => Promise<unknown>;
          create: (root: string, relPath: string) => Promise<unknown>;
          rename: (root: string, from: string, to: string) => Promise<unknown>;
          delete: (root: string, relPath: string) => Promise<unknown>;
        };
        commands: {
          run: (request: { cwd: string; command: string; id: string }) => Promise<unknown>;
          kill: (id: string) => Promise<unknown>;
          onOutput: (
            listener: (event: {
              id: string;
              stream: 'stdout' | 'stderr' | 'system';
              line: string;
              timestamp: string;
            }) => void
          ) => () => void;
        };
        scaffold: {
          list: () => Promise<unknown>;
          generate: (request: {
            template: string;
            targetDir: string;
            vars?: Record<string, string | boolean>;
          }) => Promise<unknown>;
        };
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
        respondBridge: (id: string, response: string, reason?: string) => void;
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
        exportPdf: (
          sessionId: string,
          options?: { redactSecrets?: boolean }
        ) => Promise<{ success: boolean; savedTo?: string; canceled?: boolean; error?: string }>;
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
            pinned?: boolean;
            archived?: boolean;
            tags?: string[];
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
        searchContent: (
          query: string,
          limit?: number
        ) => Promise<
          Array<{
            messageId: string;
            sessionId: string;
            sessionTitle: string;
            role: string;
            snippet: string;
            matchOffset: number;
            timestamp: number;
            projectId: string | null;
          }>
        >;
      };
      runner: {
        status: () => Promise<{
          runner: 'engine' | 'pi';
          engineReady: boolean;
          bootError: string | null;
        }>;
      };
      clipboard: {
        summarizeNow: () => Promise<{
          ok: boolean;
          payload?: {
            hash: string;
            sourceLength: number;
            sourcePreview: string;
            summary: string | null;
            at: string;
          };
          error?: string;
        }>;
        setMonitoring: (enabled: boolean) => Promise<{ ok: boolean; running?: boolean }>;
        status: () => Promise<{ running: boolean; monitoringEnabled: boolean }>;
      };
      voice: {
        transcribe: (
          audio: ArrayBuffer,
          options?: { language?: string }
        ) => Promise<{ ok: boolean; text?: string; durationMs?: number; error?: string }>;
        status: () => Promise<{ available: boolean; bootError: string | null }>;
        diagnostics: () => Promise<{
          ok: boolean;
          checkedAt: string;
          stt: {
            provider: string;
            available: boolean;
            fallbackProvider: string;
            fallbackAvailable: boolean;
            bootError: string | null;
          };
          tts: {
            provider: string;
            available: boolean;
            fallbackProvider: string;
            fallbackAvailable: boolean;
            bootError: string | null;
          };
          kyutai: {
            sttEnabled: boolean;
            ttsEnabled: boolean;
            baseUrl: string;
            apiKeyConfigured: boolean;
            ffmpegBinary: string;
            ffmpegFound: boolean;
            ttsVoice: string;
            sttProbe?: {
              ok: boolean;
              endpoint: string;
              durationMs: number;
              error?: string;
            };
            ttsProbe?: {
              ok: boolean;
              endpoint: string;
              durationMs: number;
              error?: string;
            };
          } | null;
        }>;
        speak: (
          text: string,
          options?: { lengthScale?: number }
        ) => Promise<{
          ok: boolean;
          audio?: ArrayBuffer;
          sampleRate?: number;
          durationMs?: number;
          error?: string;
        }>;
        ttsStatus: () => Promise<{ available: boolean; bootError: string | null }>;
        recordInterruption: (payload: {
          reason: 'barge_in' | 'manual' | 'new_speech' | 'stop';
          hadPlayback: boolean;
          timestamp: number;
        }) => Promise<{ ok: boolean; error?: string }>;
        conversationStatus: () => Promise<VoiceConversationSnapshot>;
        recordConversationEvent: (
          payload: VoiceConversationEvent
        ) => Promise<{ ok: boolean; snapshot?: VoiceConversationSnapshot; error?: string }>;
      };
      companion: {
        setup: (input?: {
          projectId?: string;
          forceIdentity?: boolean;
          configureVoice?: boolean;
          configureModel?: boolean;
          language?: string;
          sttProvider?: string;
          ttsProvider?: string;
          ttsVoice?: string;
          model?: string;
          recordSelf?: boolean;
        }) => Promise<{ ok: boolean; result?: CompanionSetupResponse; error?: string }>;
        status: (
          projectId?: string
        ) => Promise<{ ok: boolean; status?: CompanionStatus; error?: string }>;
        recentPercepts: (input?: {
          limit?: number;
          modality?: CompanionPerceptModality;
          projectId?: string;
        }) => Promise<{ ok: boolean; items: CompanionPercept[]; error?: string }>;
        perceptStats: (
          projectId?: string
        ) => Promise<{ ok: boolean; stats?: CompanionPerceptStats; error?: string }>;
        recordSelf: (
          projectId?: string
        ) => Promise<{ ok: boolean; percept?: CompanionPercept; error?: string }>;
        evaluate: (input?: {
          projectId?: string;
          recordSuggestions?: boolean;
        }) => Promise<{ ok: boolean; evaluation?: CompanionSelfEvaluation; error?: string }>;
        radar: (input?: {
          projectId?: string;
          recordSuggestions?: boolean;
        }) => Promise<{ ok: boolean; radar?: CompanionCompetitiveRadar; error?: string }>;
        improve: (input?: {
          projectId?: string;
          dryRun?: boolean;
          recordSuggestions?: boolean;
          runMission?: boolean;
        }) => Promise<{ ok: boolean; cycle?: CompanionImprovementCycle; error?: string }>;
        impulses: (input?: {
          projectId?: string;
          recordSuggestions?: boolean;
        }) => Promise<{ ok: boolean; brief?: CompanionImpulseBrief; error?: string }>;
        checkIn: (input?: {
          projectId?: string;
          userText?: string;
          recordPercept?: boolean;
          createCard?: boolean;
          recordSafety?: boolean;
        }) => Promise<{ ok: boolean; cue?: CompanionCheckInCue; error?: string }>;
        syncMissions: (input?: {
          projectId?: string;
          recordSuggestions?: boolean;
        }) => Promise<{ ok: boolean; result?: CompanionMissionBoardSyncResult; error?: string }>;
        listMissions: (input?: { projectId?: string; status?: CompanionMissionStatus }) => Promise<{
          ok: boolean;
          board?: CompanionMissionBoard;
          items: CompanionMission[];
          error?: string;
        }>;
        runNextMission: (input?: {
          projectId?: string;
          dryRun?: boolean;
        }) => Promise<{ ok: boolean; result?: CompanionMissionRunResult; error?: string }>;
        updateMission: (input: {
          projectId?: string;
          missionId: string;
          status: CompanionMissionStatus;
        }) => Promise<{ ok: boolean; mission?: CompanionMission; error?: string }>;
        recentSafetyEvents: (input?: {
          projectId?: string;
          limit?: number;
          kind?: CompanionSafetyEventKind;
          risk?: CompanionSafetyEventRisk;
        }) => Promise<{ ok: boolean; items: CompanionSafetyEvent[]; error?: string }>;
        safetyStats: (
          projectId?: string
        ) => Promise<{ ok: boolean; stats?: CompanionSafetyLedgerStats; error?: string }>;
        listCards: (input?: {
          projectId?: string;
          status?: CompanionCardStatus;
          kind?: CompanionCardKind;
          limit?: number;
        }) => Promise<{
          ok: boolean;
          store?: CompanionCardStore;
          items: CompanionCard[];
          error?: string;
        }>;
        updateCard: (input: {
          projectId?: string;
          cardId: string;
          status: CompanionCardStatus;
        }) => Promise<{ ok: boolean; card?: CompanionCard; error?: string }>;
        gatewayProfile: (
          projectId?: string
        ) => Promise<{ ok: boolean; profile?: CompanionGatewayProfile; error?: string }>;
        gatewayLifecycle: (
          projectId?: string
        ) => Promise<{ ok: boolean; report?: CompanionGatewayLifecycleReport; error?: string }>;
        gatewayAdminPlan: (
          projectId?: string
        ) => Promise<{ ok: boolean; plan?: CompanionGatewayAdminPlan; error?: string }>;
        executeGatewayAdminAction: (input: {
          projectId?: string;
          action: CompanionGatewayExecutableAdminAction;
          channel: string;
          approvedBy: string;
          liveAdminConfirmed: boolean;
        }) => Promise<{
          ok: boolean;
          result?: CompanionGatewayAdminExecutionResult;
          error?: string;
        }>;
        gatewayInbox: (
          projectId?: string
        ) => Promise<{ ok: boolean; inbox?: CompanionGatewayInbox; error?: string }>;
        draftGatewayInboxItem: (input: { projectId?: string; itemId: string }) => Promise<{
          ok: boolean;
          draft?: CompanionGatewayInboxDraft;
          inbox?: CompanionGatewayInbox;
          error?: string;
        }>;
        routeGatewayDraftToFleet: (input: { projectId?: string; itemId: string }) => Promise<{
          ok: boolean;
          fleetDraft?: CompanionGatewayFleetDraft;
          inbox?: CompanionGatewayInbox;
          error?: string;
        }>;
        draftGatewayOutboundReply: (input: {
          projectId?: string;
          itemId: string;
          text: string;
          reviewedBy: string;
        }) => Promise<{
          ok: boolean;
          replyDraft?: CompanionGatewayOutboundReplyDraft;
          inbox?: CompanionGatewayInbox;
          error?: string;
        }>;
        sendGatewayOutboundReply: (input: {
          projectId?: string;
          itemId: string;
          text: string;
          approvedBy: string;
          dryRun?: boolean;
          liveDeliveryConfirmed?: boolean;
        }) => Promise<{
          ok: boolean;
          result?: CompanionGatewayOutboundReplySendResult;
          inbox?: CompanionGatewayInbox;
          error?: string;
        }>;
        updateGatewayChannel: (input: {
          projectId?: string;
          channel: string;
          enabled?: boolean;
          mode?: CompanionGatewayMode;
          allowOutbound?: boolean;
          requireApprovalForTools?: boolean;
          recordPercepts?: boolean;
          tags?: string[];
        }) => Promise<{ ok: boolean; profile?: CompanionGatewayProfile; error?: string }>;
        openClawBridgeStatus: (input?: {
          projectId?: string;
          source?: string;
        }) => Promise<OpenClawBridgeStatusResult>;
        previewOpenClawBridgeAttach: (input?: {
          projectId?: string;
          source?: string;
          endpointPath?: string;
        }) => Promise<OpenClawBridgeActionResult>;
        attachOpenClawBridge: (input: {
          projectId?: string;
          source?: string;
          endpointPath?: string;
          approvedBy: string;
          liveAttachConfirmed: boolean;
        }) => Promise<OpenClawBridgeActionResult>;
        listOpenClawBridgePendingNodes: (input?: {
          projectId?: string;
          source?: string;
          approvedBy?: string;
          liveCallConfirmed?: boolean;
        }) => Promise<OpenClawBridgeActionResult>;
        approveOpenClawBridgePendingNode: (input: {
          projectId?: string;
          source?: string;
          nodeId?: string;
          code?: string;
          approvedBy: string;
          liveCallConfirmed: boolean;
        }) => Promise<OpenClawBridgeActionResult>;
        rejectOpenClawBridgePendingNode: (input: {
          projectId?: string;
          source?: string;
          nodeId?: string;
          code?: string;
          reason?: string;
          approvedBy: string;
          liveCallConfirmed: boolean;
        }) => Promise<OpenClawBridgeActionResult>;
        draftOpenClawBridgeHandoff: (input: {
          projectId?: string;
          messageId: string;
          channel: string;
          threadId?: string;
          senderId: string;
          senderName?: string;
          text: string;
        }) => Promise<OpenClawBridgeActionResult>;
        previewOpenClawBridgeSend: (input: {
          projectId?: string;
          source?: string;
          endpointPath?: string;
          messageId: string;
          channel: string;
          threadId?: string;
          text: string;
        }) => Promise<OpenClawBridgeActionResult>;
        sendOpenClawBridgeResponse: (input: {
          projectId?: string;
          source?: string;
          endpointPath?: string;
          messageId: string;
          channel: string;
          threadId?: string;
          text: string;
          approvedBy: string;
          liveSendConfirmed: boolean;
        }) => Promise<OpenClawBridgeActionResult>;
        listSkillCandidates: (projectId?: string) => Promise<{
          ok: boolean;
          store?: CompanionSkillCandidateStore;
          items: CompanionSkillCandidate[];
          error?: string;
        }>;
        curateSkills: (input?: {
          projectId?: string;
          recordSuggestions?: boolean;
        }) => Promise<{ ok: boolean; result?: CompanionSkillCuratorResult; error?: string }>;
        promoteSkillCandidate: (input: {
          projectId?: string;
          candidateId: string;
        }) => Promise<{ ok: boolean; result?: CompanionSkillPromotionResult; error?: string }>;
        dismissSkillCandidate: (input: {
          projectId?: string;
          candidateId: string;
        }) => Promise<{ ok: boolean; candidate?: CompanionSkillCandidate; error?: string }>;
        privacyReport: (
          projectId?: string
        ) => Promise<{ ok: boolean; report?: CompanionPrivacyReport; error?: string }>;
        exportPrivacy: (input?: {
          projectId?: string;
          kinds?: CompanionPrivacyKind[];
        }) => Promise<{ ok: boolean; result?: CompanionPrivacyExportResult; error?: string }>;
        purgePrivacy: (input?: {
          projectId?: string;
          kinds?: CompanionPrivacyKind[];
          backup?: boolean;
        }) => Promise<{ ok: boolean; result?: CompanionPrivacyPurgeResult; error?: string }>;
        cameraStatus: () => Promise<{
          ok: boolean;
          status?: Record<string, unknown>;
          error?: string;
        }>;
        cameraSnapshot: (input?: {
          outputPath?: string;
          device?: string;
          timeoutMs?: number;
          projectId?: string;
        }) => Promise<{ ok: boolean; result?: CameraSnapshotResult; error?: string }>;
        cameraRendererSnapshot: (input: {
          dataUrl?: string;
          base64?: string;
          mediaType?: string;
          width?: number;
          height?: number;
          mediaPipe?: unknown;
          outputPath?: string;
          projectId?: string;
        }) => Promise<{ ok: boolean; result?: CameraSnapshotResult; error?: string }>;
        cameraInspect: (input?: {
          imagePath?: string;
          outputPath?: string;
          device?: string;
          timeoutMs?: number;
          projectId?: string;
          includeOcr?: boolean;
          ocrLanguage?: string;
        }) => Promise<{ ok: boolean; result?: CameraSnapshotInspectionResult; error?: string }>;
      };
      desktopSnapshot: {
        status: () => Promise<{
          ok: boolean;
          platform: string;
          methods?: DesktopSnapshotMethod[];
          error?: string;
        }>;
        capture: (input?: DesktopSnapshotCaptureOptions) => Promise<DesktopSnapshotCaptureResult>;
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
      missions: {
        list: (filter?: MissionFilter) => Promise<{
          ok: boolean;
          missions: MissionRuntime[];
          error?: string;
        }>;
        get: (missionId: string) => Promise<{
          ok: boolean;
          mission: MissionRuntime | null;
          error?: string;
        }>;
        create: (input: MissionCreateInput) => Promise<{
          ok: boolean;
          mission: MissionRuntime | null;
          error?: string;
        }>;
        updateStatus: (
          missionId: string,
          status: MissionStatus
        ) => Promise<{ ok: boolean; mission: MissionRuntime | null; error?: string }>;
        cancel: (
          missionId: string
        ) => Promise<{ ok: boolean; mission: MissionRuntime | null; error?: string }>;
        readySubTasks: (
          missionId: string
        ) => Promise<{ ok: boolean; subTasks: SubTask[]; error?: string }>;
        tickHeartbeat: (
          now?: string
        ) => Promise<{ ok: boolean; missions: MissionRuntime[]; error?: string }>;
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
              messageId?: string;
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
          turnJournal?: {
            sessionId: string;
            path: string;
            exists: boolean;
            totalEventCount: number;
            malformedLineCount: number;
            pendingTurnCount: number;
            events: Array<{
              schemaVersion: 1;
              type: string;
              sessionId: string;
              ts: number;
              eventId?: string;
              runId?: string;
              seq?: number;
              turnId?: string;
              data?: Record<string, unknown>;
            }>;
            turns: Array<{
              turnId: string;
              startedAt: number;
              updatedAt: number;
              latestType: string;
              status: 'running' | 'completed' | 'failed' | 'cancelled';
              eventCount: number;
              messageCount: number;
              traceStepCount: number;
            }>;
            replay: {
              sessionId: string;
              path: string;
              exists: boolean;
              totalEventCount: number;
              malformedLineCount: number;
              pendingTurnCount: number;
              runCount: number;
              runs: Array<{
                runId: string;
                turnId?: string;
                startedAt: number;
                updatedAt: number;
                latestType: string;
                status: 'running' | 'completed' | 'failed' | 'cancelled';
                eventCount: number;
                anchorCount: number;
                terminalEvent?: {
                  schemaVersion: 1;
                  type: string;
                  sessionId: string;
                  ts: number;
                  eventId?: string;
                  runId?: string;
                  seq?: number;
                  turnId?: string;
                  data?: Record<string, unknown>;
                };
                anchors: Array<{
                  eventId: string;
                  runId: string;
                  seq: number;
                  type: string;
                  ts: number;
                  turnId?: string;
                }>;
                events: Array<{
                  schemaVersion: 1;
                  type: string;
                  sessionId: string;
                  ts: number;
                  eventId?: string;
                  runId?: string;
                  seq?: number;
                  turnId?: string;
                  data?: Record<string, unknown>;
                }>;
              }>;
            };
          };
          memoryPreview?: {
            sessionId: string;
            projectId?: string | null;
            memoryStrategy: 'auto' | 'manual' | 'rolling';
            automatedMemoryEnabled: boolean;
            projectMemoryAvailable: boolean;
            projectMemoryPath?: string;
            projectContextAvailable: boolean;
            icmAvailable: boolean;
            recallEnabled: boolean;
            candidateCount: number;
            candidates: Array<{
              category: 'preference' | 'pattern' | 'context' | 'decision';
              content: string;
              sourceSessionId?: string;
              sourceKind: 'user' | 'assistant';
              evidence: string;
            }>;
          };
        } | null>;
        recallPrefill: (
          prompt: string,
          options?: {
            currentSessionId?: string;
            cwd?: string;
            limit?: number;
            maxChars?: number;
            perSessionMaxChars?: number;
          }
        ) => Promise<{
          prompt: string;
          text: string;
          entries: Array<{
            sessionId: string;
            title: string;
            cwd?: string;
            updatedAt: number;
            score: number;
            snippet: string;
            messageIds: string[];
          }>;
          totalCandidateCount: number;
          maxChars: number;
          truncated: boolean;
        } | null>;
        audit: (sessionId: string) => Promise<{
          sessionId: string;
          issueCount: number;
          orphanToolResults: number;
          missingToolResults: number;
          emptyMessages: number;
          pendingJournalTurns: number;
          missingJournalUserMessages: number;
          unrecoverableJournalSubmissions: number;
          malformedJournalEvents: number;
          issues: Array<{
            kind:
              | 'orphan_tool_result'
              | 'missing_tool_result'
              | 'empty_message'
              | 'turn_journal_pending_turn'
              | 'turn_journal_missing_user_message'
              | 'turn_journal_unrecoverable_submission'
              | 'turn_journal_malformed_event';
            messageId?: string;
            toolUseId?: string;
            turnId?: string;
            detail: string;
          }>;
        } | null>;
        repair: (sessionId: string) => Promise<{
          sessionId: string;
          changed: boolean;
          removedOrphanToolResults: number;
          injectedSyntheticToolResults: number;
          injectedJournalUserMessages: number;
          injectedJournalInterruptionMarkers: number;
          removedEmptyMessages: number;
          messages: import('../renderer/types').Message[];
          audit: {
            sessionId: string;
            issueCount: number;
            orphanToolResults: number;
            missingToolResults: number;
            emptyMessages: number;
            pendingJournalTurns: number;
            missingJournalUserMessages: number;
            unrecoverableJournalSubmissions: number;
            malformedJournalEvents: number;
            issues: Array<{
              kind:
                | 'orphan_tool_result'
                | 'missing_tool_result'
                | 'empty_message'
                | 'turn_journal_pending_turn'
                | 'turn_journal_missing_user_message'
                | 'turn_journal_unrecoverable_submission'
                | 'turn_journal_malformed_event';
              messageId?: string;
              toolUseId?: string;
              turnId?: string;
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
      tools: {
        list: () => Promise<Array<{ name: string; description: string; category: string }>>;
        getOverrides: () => Promise<Record<string, 'allow' | 'deny' | 'confirm'>>;
        setOverride: (
          name: string,
          action: 'allow' | 'deny' | null
        ) => Promise<{ ok: boolean; overrides?: Record<string, string> }>;
        hermesCatalog: {
          get: () => Promise<{
            generatedAt: string;
            inspectedCommit: string;
            localToolCount: number;
            source: string;
            summary: {
              exact: number;
              gaps: number;
              nativeEquivalent: number;
              partial: number;
              total: number;
            };
            topWork: Array<{
              category: string;
              name: string;
              nextWork?: string;
              status: 'exact' | 'native-equivalent' | 'partial' | 'gap';
              toolset: string;
            }>;
          } | null>;
        };
        hermesFeatureParity: {
          get: () => Promise<{
            auditDocument: string;
            command: string;
            deferredWork: Array<{
              area: string;
              id: string;
              nextWork?: string;
              officialSurface: string;
              status: 'covered' | 'covered-partial' | 'partial' | 'gap';
              verificationCommands: string[];
            }>;
            generatedAt: string;
            inspectedCommit: string;
            latestTagObserved: string;
            source: string;
            summary: {
              covered: number;
              coveredPartial: number;
              gaps: number;
              partial: number;
              total: number;
            };
            topWork: Array<{
              area: string;
              id: string;
              nextWork?: string;
              officialSurface: string;
              status: 'covered' | 'covered-partial' | 'partial' | 'gap';
              verificationCommands: string[];
            }>;
            todoCommand: string;
            todoSummary: {
              activeTodoCount: number;
              deferredCount: number;
              hiddenTodoCount: number;
              includedDeferred: boolean;
              selectedTodoCount: number;
              shownTodoCount: number;
              todoLimit: number;
            };
          } | null>;
        };
        hermesToolsets: {
          get: (options?: { profile?: string }) => Promise<{
            activeProfile: 'balanced' | 'research' | 'code' | 'review' | 'safe';
            activeToolset: {
              allowedTools: string[];
              confirmTools: string[];
              deniedTools: string[];
              summary: string;
              toolsetId: string;
            };
            command: string;
            generatedAt: string;
            kind: 'hermes_toolsets_catalog';
            previewTools: string[];
            requestedProfile: string;
            schemaVersion: 1;
            summary: {
              profiles: Array<'balanced' | 'research' | 'code' | 'review' | 'safe'>;
              totalToolsets: number;
            };
            toolsets: Array<{
              allowedTools: string[];
              confirmTools: string[];
              deniedTools: string[];
              intent: string;
              profile: 'balanced' | 'research' | 'code' | 'review' | 'safe';
              summary: string;
              toolsetId: string;
            }>;
          } | null>;
        };
        hermesProviderReadiness: {
          get: () => Promise<{
            command: string;
            ok: boolean;
            activeModel: {
              contextWindow: number | null;
              maxOutputTokens: number | null;
              model: string;
              provider: string;
              source: string;
              supportsReasoning: boolean;
              supportsToolCalls: boolean;
              supportsVision: boolean;
            };
            activeProvider: {
              baseUrl: string | null;
              configured: boolean;
              credentialSources: string[];
              label: string;
              local: boolean;
            };
            configuredProviderCount: number;
            issues: string[];
            portal: {
              credentialPresent: boolean;
              credentialSources: string[];
              directFallbackCount: number;
              managedByNousCount: number;
              toolGatewayConfigured: boolean;
            };
            providerCount: number;
            recommendations: string[];
          } | null>;
        };
        hermesPortal: {
          get: () => Promise<HermesPortalReviewPayload | null>;
        };
        hermesTrajectories: {
          get: () => Promise<HermesTrajectoriesReviewPayload | null>;
          export: (options?: {
            includeArtifactContent?: boolean;
            limit?: number;
            maxArtifactBytes?: number;
            maxCompressedBytes?: number;
            maxEventValueBytes?: number;
            query?: string;
            runIds?: string[];
            sources?: string[];
          }) => Promise<{ success: boolean; path?: string; error?: string }>;
        };
        hermesDoctor: {
          get: () => Promise<HermesDoctorReviewPayload | null>;
        };
        hermesClaw: {
          status: (options?: {
            preset?: 'full' | 'user-data';
            source?: string;
          }) => Promise<ClawMigrationReportPayload | null>;
          run: (options: ClawMigrationRunOptionsPayload) => Promise<ClawMigrationRunResponse>;
        };
        hermesKanban: HermesKanbanApi;
        hermesMemoryProviders: {
          get: () => Promise<{
            activeProviderId: string;
            command: string;
            configuredRemoteCount: number;
            fallbackCount: number;
            generatedAt: string;
            issues: string[];
            missingOfficialCount: number;
            ok: boolean;
            providers: Array<{
              active: boolean;
              baseUrlSources: string[];
              configured: boolean;
              credentialSources: string[];
              id: string;
              label: string;
              local: boolean;
              notes: string[];
              officialSurface: string;
              registered: boolean;
              remediation: string[];
              status: 'available' | 'configured' | 'fallback' | 'missing';
            }>;
            recommendations: string[];
            registeredCount: number;
          } | null>;
          probe: (options: { providerId?: string }) => Promise<HermesMemoryProbeResponse>;
        };
        hermesRuntimeBackends: {
          get: () => Promise<{
            arch: string;
            availableCount: number;
            backends: Array<{
              command: string | null;
              configured: boolean;
              credentialSources: string[];
              id: string;
              installed: boolean;
              label: string;
              notes: string[];
              officialSurface: string;
              remediation: string[];
              runnable: boolean;
              smokeCommand: string | null;
              status: 'available' | 'configured' | 'missing' | 'unsupported';
              version: string | null;
            }>;
            command: string;
            configuredRemoteCount: number;
            generatedAt: string;
            issues: string[];
            ok: boolean;
            platform: string;
            recommendations: string[];
            runnableCount: number;
          } | null>;
          smoke: (options: {
            allowDockerSmoke?: boolean;
            allowRemoteSmoke?: boolean;
            backendId: string;
          }) => Promise<{
            error?: string;
            ok: boolean;
            result?: {
              args: string[];
              backendId: string;
              command: string | null;
              durationMs: number;
              exitCode: number | null;
              finishedAt: string;
              label: string | null;
              ok: boolean;
              output: string;
              signal: string | null;
              startedAt: string;
              status: 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';
              stderr: string;
              stdout: string;
            };
          }>;
        };
        hermesBrowserBackends: {
          get: () => Promise<{
            backends: Array<{
              command: string | null;
              configured: boolean;
              credentialSources: string[];
              id: string;
              installed: boolean;
              label: string;
              notes: string[];
              officialSurface: string;
              remediation: string[];
              runnable: boolean;
              smokeCommand: string | null;
              status: 'available' | 'configured' | 'missing' | 'unsupported';
              version: string | null;
            }>;
            command: string;
            generatedAt: string;
            issues: string[];
            localRunnableCount: number;
            managedConfiguredCount: number;
            ok: boolean;
            platform: string;
            recommendations: string[];
          } | null>;
          smoke: (options: { backendId: string }) => Promise<{
            error?: string;
            ok: boolean;
            result?: {
              backendId: string;
              command: string | null;
              durationMs: number;
              finishedAt: string;
              label: string | null;
              ok: boolean;
              output: string;
              startedAt: string;
              status: 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';
              stderr: string;
              stdout: string;
            };
          }>;
        };
        hermesProtocolGateways: {
          get: () => Promise<{
            capabilities: Array<{
              commands: string[];
              endpoints: string[];
              evidence: string[];
              id: string;
              label: string;
              notes: string[];
              officialSurface: string;
              status: 'available' | 'partial' | 'missing';
            }>;
            generatedAt: string;
            kind: 'hermes_protocol_gateway_readiness';
            officialSurface: string;
            ok: boolean;
            recommendations: string[];
            schemaVersion: 1;
            smokeCommand: string;
            summary: {
              availableCount: number;
              missingCount: number;
              partialCount: number;
              total: number;
            };
          } | null>;
          smoke: () => Promise<{
            error?: string;
            ok: boolean;
            result?: {
              durationMs: number;
              generatedAt: string;
              httpRoutes: {
                a2aAgentName?: string;
                acpSessionCount?: number;
                baseUrl?: string;
                error?: string;
                ok: boolean;
                routes: Array<{
                  ok: boolean;
                  path: string;
                  status: number;
                }>;
              };
              kind: 'hermes_protocol_gateway_smoke';
              mcpStdio: {
                echoText?: string;
                error?: string;
                ok: boolean;
                serverName: string;
                toolCount: number;
                transport?: string;
              };
              ok: boolean;
              schemaVersion: 1;
            };
          }>;
        };
        hermesLocalSmoke: {
          run: () => Promise<{
            error?: string;
            ok: boolean;
            result?: unknown;
          }>;
        };
        hermesMobileSupervision: {
          get: (options?: { query?: string }) => Promise<{
            approvalQueue: {
              autoDispatch: boolean;
              counts: {
                blocked: number;
                pending: number;
                ready: number;
                total: number;
              };
              localOnly: boolean;
              remoteExecutionDisabled: boolean;
            };
            auth: {
              scheme: 'bearer_or_pairing_code';
              scopes: string[];
              ttlSeconds: number;
            };
            blockedOperations: Array<{
              action: string;
              reason: string;
            }>;
            command: string;
            endpoints: Array<{
              action: string;
              id: string;
              localApprovalRequired: boolean;
              method: 'GET' | 'POST';
              path: string;
              sideEffects: 'none' | 'draft_only';
            }>;
            generatedAt: string;
            ok: boolean;
            pairing: {
              deviceLabel: string;
              scopes: string[];
              status: 'preview_only';
              tokenIssued: boolean;
              ttlSeconds: number;
            };
            query: string;
            recommendations: string[];
            routeMount: {
              basePath: string;
              module: string;
              mountedBy: string;
              serverCommand: string;
              status: 'implemented_not_probed';
            };
            summary: {
              blockedOperations: number;
              blockedQueueItems: number;
              draftOnlyEndpoints: number;
              pendingLocalApproval: number;
              readOnlyEndpoints: number;
              readyReadOnly: number;
              totalQueueItems: number;
            };
            transport: {
              exposure: 'local_first';
              offDeviceTlsRequired: boolean;
              remoteExecution: 'disabled';
            };
          } | null>;
        };
        hermesLearningLoop: {
          get: (options?: { cwd?: string; limit?: number }) => Promise<{
            autoRetrospective: {
              enabled: boolean;
              envVar: 'CODEBUDDY_LEARNING_AGENT';
              mode: 'auto' | 'disabled';
            };
            commands: {
              candidateReview: string;
              lessonCandidates: string;
              retrospective: string;
              runDoctor: string;
              skillUsage: string;
              userModel: string;
            };
            generatedAt: string;
            kind: 'hermes_learning_loop_status';
            ok: boolean;
            nextRetrospectiveRun?: {
              artifactCount: number;
              channel?: string;
              command: string;
              eventCount: number;
              runId: string;
              status: string;
              tags: string[];
            };
            recommendations: string[];
            reviewGates: {
              lessonWritesRequireApproval: boolean;
              skillCandidatesRequireReview: boolean;
              skillLifecycleRequiresApproval: boolean;
              userModelWritesRequireApproval: boolean;
            };
            state: {
              recentRuns: Array<{
                artifactCount: number;
                channel?: string;
                eventCount: number;
                hasLearningRetrospective: boolean;
                runId: string;
                status: string;
                tags: string[];
              }>;
              patterns: {
                deprecatedCount: number;
                observedCount: number;
                reinforcedCount: number;
                total: number;
              };
              skillCandidates: {
                eligibleCandidateCount?: number;
                ineligibleCandidateCount?: number;
                learningCandidateCount: number;
                root: string;
                samples?: Array<{
                  candidateId: string;
                  eligible: boolean;
                  installCommand?: string;
                  inspectCommand: string;
                  promotion?: {
                    reason: string;
                    status: string;
                    successfulRunCount: number;
                    threshold: number;
                  };
                  skillName: string;
                }>;
              };
              skillUsage: {
                count: number;
                deprecatedCount: number;
                reinforcedCount: number;
                top: Array<{
                  invocationCount: number;
                  recommendation: string;
                  score: number;
                  skillName: string;
                }>;
              };
            };
            summary: {
              acceptedUserObservationCount: number;
              deprecatedSkillCount: number;
              inspectedRunLimit: number;
              lessonCandidateCount: number;
              patternCount: number;
              pendingLessonCandidateCount: number;
              pendingReviewCount: number;
              pendingUserObservationCount: number;
              recentRunCount: number;
              retrospectiveCoveragePercent: number;
              retrospectiveEligibleRunCount: number;
              reinforcedSkillCount: number;
              retrospectiveArtifactCount: number;
              runningRunCount: number;
              skillUsageCount: number;
              staleRunningRunCount: number;
            };
            workDir: string;
          } | null>;
          runDoctor: (options?: {
            cwd?: string;
            limit?: number;
            staleAfterMinutes?: number;
          }) => Promise<{
            error?: string;
            ok: boolean;
            result?: {
              command: string;
              filters: {
                limit: number;
                staleAfterMinutes: number;
              };
              generatedAt: string;
              recommendations: string[];
              runs: Array<{
                artifactCount: number;
                eventCount: number;
                runId: string;
                runningForMinutes?: number;
                source?: string;
                staleRunning?: boolean;
                startedAt: string;
                status: string;
              }>;
              schemaVersion: 1;
              summary: {
                cancelledRunCount: number;
                completedRunCount: number;
                failedRunCount: number;
                inspectedRunCount: number;
                runningRunCount: number;
                staleRunningRunCount: number;
              };
              workDir: string;
            };
          }>;
          runRetrospective: (options: { cwd?: string; force?: boolean; runId: string }) => Promise<{
            error?: string;
            ok: boolean;
            result?: {
              command: string;
              lessonCandidateCount: number;
              ok: boolean;
              patternLibraryPath?: string;
              retrospectiveArtifact?: string;
              runId: string;
              skillCandidateCount: number;
              skillUsageCount: number;
              skipped: boolean;
              skippedReason?: string;
              summary?: string;
              toolSequence: string[];
            };
          }>;
        };
        skillPackage: {
          list: (options?: { cwd?: string; limit?: number }) => Promise<{
            cacheDir: string;
            disabledCount: number;
            enabledCount: number;
            installedCount: number;
            lockfilePath: string;
            packages: Array<{
              averageDurationMs?: number;
              contentPreview?: string;
              contentPreviewTruncated?: boolean;
              enabled: boolean;
              exists: boolean;
              failureCount?: number;
              installedAt: number;
              integrityOk: boolean;
              invocationCount?: number;
              lastError?: string;
              lastLifecycleReason?: string;
              lastLifecycleReviewer?: string;
              lastUsedAt?: number;
              name: string;
              path: string;
              rollbackableCount: number;
              sizeBytes?: number;
              source: 'hub' | 'local' | 'git';
              status: 'active' | 'disabled' | 'deprecated';
              successCount?: number;
              version: string;
            }>;
            reviewCommands: string[];
            rollbackableCount: number;
            skillRoot: string;
          } | null>;
          lifecycle: (options: {
            action: 'enable' | 'disable' | 'deprecate';
            approvedBy: string;
            cwd?: string;
            name: string;
            reason?: string;
          }) => Promise<{
            error?: string;
            ok: boolean;
            package?: {
              averageDurationMs?: number;
              contentPreview?: string;
              contentPreviewTruncated?: boolean;
              enabled: boolean;
              exists: boolean;
              failureCount?: number;
              installedAt: number;
              integrityOk: boolean;
              invocationCount?: number;
              lastError?: string;
              lastLifecycleReason?: string;
              lastLifecycleReviewer?: string;
              lastUsedAt?: number;
              name: string;
              path: string;
              rollbackableCount: number;
              sizeBytes?: number;
              source: 'hub' | 'local' | 'git';
              status: 'active' | 'disabled' | 'deprecated';
              successCount?: number;
              version: string;
            };
          }>;
          rollback: (options: {
            approvedBy: string;
            cwd?: string;
            name: string;
            reason?: string;
            snapshotId?: string;
          }) => Promise<{
            error?: string;
            ok: boolean;
            package?: {
              averageDurationMs?: number;
              contentPreview?: string;
              contentPreviewTruncated?: boolean;
              enabled: boolean;
              exists: boolean;
              failureCount?: number;
              installedAt: number;
              integrityOk: boolean;
              invocationCount?: number;
              lastError?: string;
              lastLifecycleReason?: string;
              lastLifecycleReviewer?: string;
              lastUsedAt?: number;
              name: string;
              path: string;
              rollbackableCount: number;
              sizeBytes?: number;
              source: 'hub' | 'local' | 'git';
              status: 'active' | 'disabled' | 'deprecated';
              successCount?: number;
              version: string;
            };
          }>;
          delete: (options: {
            approvedBy: string;
            cwd?: string;
            name: string;
            reason?: string;
          }) => Promise<{
            deletedName?: string;
            error?: string;
            ok: boolean;
          }>;
          update: (options: {
            approvedBy: string;
            cwd?: string;
            force?: boolean;
            name: string;
            reason?: string;
            version?: string;
          }) => Promise<{
            error?: string;
            ok: boolean;
            package?: {
              averageDurationMs?: number;
              contentPreview?: string;
              contentPreviewTruncated?: boolean;
              enabled: boolean;
              exists: boolean;
              failureCount?: number;
              installedAt: number;
              integrityOk: boolean;
              invocationCount?: number;
              lastError?: string;
              lastLifecycleReason?: string;
              lastLifecycleReviewer?: string;
              lastUsedAt?: number;
              name: string;
              path: string;
              rollbackableCount: number;
              sizeBytes?: number;
              source: 'hub' | 'local' | 'git';
              status: 'active' | 'disabled' | 'deprecated';
              successCount?: number;
              version: string;
            };
          }>;
          reset: (options: {
            approvedBy: string;
            cwd?: string;
            name: string;
            reason?: string;
            version?: string;
          }) => Promise<{
            error?: string;
            ok: boolean;
            package?: {
              averageDurationMs?: number;
              contentPreview?: string;
              contentPreviewTruncated?: boolean;
              enabled: boolean;
              exists: boolean;
              failureCount?: number;
              installedAt: number;
              integrityOk: boolean;
              invocationCount?: number;
              lastError?: string;
              lastLifecycleReason?: string;
              lastLifecycleReviewer?: string;
              lastUsedAt?: number;
              name: string;
              path: string;
              rollbackableCount: number;
              sizeBytes?: number;
              source: 'hub' | 'local' | 'git';
              status: 'active' | 'disabled' | 'deprecated';
              successCount?: number;
              version: string;
            };
          }>;
          patch: (options: {
            approvedBy: string;
            cwd?: string;
            expectedReplacements?: number;
            name: string;
            newText: string;
            oldText: string;
            reason?: string;
          }) => Promise<{
            error?: string;
            ok: boolean;
            package?: {
              averageDurationMs?: number;
              contentPreview?: string;
              contentPreviewTruncated?: boolean;
              enabled: boolean;
              exists: boolean;
              failureCount?: number;
              installedAt: number;
              integrityOk: boolean;
              invocationCount?: number;
              lastError?: string;
              lastLifecycleReason?: string;
              lastLifecycleReviewer?: string;
              lastUsedAt?: number;
              name: string;
              path: string;
              rollbackableCount: number;
              sizeBytes?: number;
              source: 'hub' | 'local' | 'git';
              status: 'active' | 'disabled' | 'deprecated';
              successCount?: number;
              version: string;
            };
          }>;
        };
        learningUsage: {
          list: (options?: { cwd?: string; limit?: number }) => Promise<
            Array<{
              averageDurationMs?: number;
              deprecated: boolean;
              failureCount: number;
              invocationCount: number;
              lastDurationMs?: number;
              lastError?: string;
              lastRunId?: string;
              lastUsedAt: string;
              nextAction: string;
              recommendation: 'observe' | 'reinforce' | 'improve' | 'deprecate';
              reinforced: boolean;
              score: number;
              scoreReason: string;
              skillName: string;
              successCount: number;
            }>
          >;
        };
        skillCandidate: {
          list: (options?: {
            cwd?: string;
            eligibleOnly?: boolean;
            limit?: number;
            skillRoot?: string;
          }) => Promise<
            Array<{
              candidateChecksum?: string;
              candidateDiffPreview?: {
                addedLines: number;
                preview: string;
                removedLines: number;
                summary: string;
                truncated: boolean;
              };
              eligible: boolean;
              id: string;
              installState?:
                | 'not-installed'
                | 'installed-current'
                | 'installed-different'
                | 'installed-missing';
              installedChecksum?: string;
              installedIntegrityOk?: boolean;
              installedPath?: string;
              installedVersion?: string;
              kind: string;
              reason: string;
              reviewCommands?: string[];
              skillName: string;
              skillPath: string;
              sourceJobId: string;
              sourceRunId?: string;
              successfulRunCount: number;
              title: string;
              toolSequence?: string[];
            }>
          >;
          install: (options: {
            approvedBy: string;
            candidatePath: string;
            cwd?: string;
            overwrite?: boolean;
            workspaceSkillRoot?: string;
          }) => Promise<{
            candidate?: {
              candidateChecksum?: string;
              candidateDiffPreview?: {
                addedLines: number;
                preview: string;
                removedLines: number;
                summary: string;
                truncated: boolean;
              };
              eligible: boolean;
              id: string;
              installState?:
                | 'not-installed'
                | 'installed-current'
                | 'installed-different'
                | 'installed-missing';
              installedChecksum?: string;
              installedIntegrityOk?: boolean;
              installedPath?: string;
              installedVersion?: string;
              kind: string;
              reason: string;
              reviewCommands?: string[];
              skillName: string;
              skillPath: string;
              sourceJobId: string;
              sourceRunId?: string;
              successfulRunCount: number;
              title: string;
              toolSequence?: string[];
            };
            error?: string;
            installed?: {
              absoluteInstalledPath: string;
              approvedAt: string;
              approvedBy: string;
              candidateId: string;
              installedPath: string;
              skillName: string;
              sourceCandidatePath: string;
            };
            ok: boolean;
          }>;
        };
        lessonsVault: {
          preview: (options?: {
            category?: string;
            concept?: string;
            cwd?: string;
            includeKeywords?: boolean;
            limit?: number;
            query?: string;
            vaultDir?: string;
          }) => Promise<{
            commands: {
              exportVault: string;
              graphJson: string;
              graphMarkdown: string;
            };
            concepts: Array<{
              id: string;
              label: string;
              lessonCount: number;
              path: string;
              sources: string[];
            }>;
            counts: {
              concepts: number;
              files: number;
              lessons: number;
              relations: number;
            };
            generatedAt: string;
            kind: 'lessons_vault_preview';
            rootDir: string;
            schemaVersion: 1;
            vaultDir: string;
          } | null>;
          getConceptDetails: (options: { conceptName: string; cwd?: string }) => Promise<{
            concept: { id: string; label: string; weight: number };
            lessons: Array<{
              id: string;
              category: string;
              content: string;
              context?: string;
              createdBy?: {
                runId?: string;
                outcomeId?: string;
                sagaId?: string;
                note?: string;
                at: number;
              };
              usedBy?: Array<{ runId: string; at: number }>;
            }>;
            backlinks: string[];
          } | null>;
        };
      };
      server: {
        status: () => Promise<{
          running: boolean;
          port: number | null;
          host: string | null;
          startedAt: number | null;
          websocket: boolean;
          error?: string | null;
        }>;
        start: (cfg?: { port?: number; host?: string; websocketEnabled?: boolean }) => Promise<{
          running: boolean;
          port: number | null;
          host: string | null;
          startedAt: number | null;
          websocket: boolean;
          error?: string | null;
        }>;
        stop: () => Promise<{
          running: boolean;
          port: number | null;
          host: string | null;
          startedAt: number | null;
          websocket: boolean;
          error?: string | null;
        }>;
        dashboard: () => Promise<{
          recent: Array<{
            timestamp: number;
            method: string;
            path: string;
            statusCode: number;
            responseTimeMs: number;
            ip: string;
          }>;
          stats: {
            total: number;
            errors: number;
            averageLatency: number;
            uptime: number;
            byStatus: Record<string, number>;
          } | null;
        }>;
      };
      remoteBackend: {
        connect: (url: string, token: string) => Promise<{ success: boolean; error?: string }>;
        disconnect: () => Promise<{ success: boolean }>;
        status: () => Promise<{
          status: 'disconnected' | 'connecting' | 'connected' | 'error';
          host?: string;
          error?: string;
        }>;
        getConfig: () => Promise<{ url: string; autoConnect: boolean; hasToken: boolean }>;
        onStatus: (
          callback: (status: {
            status: 'disconnected' | 'connecting' | 'connected' | 'error';
            host?: string;
            error?: string;
          }) => void
        ) => () => void;
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
          kind: 'text' | 'image' | 'pdf' | 'document' | 'binary' | 'error';
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
          documentText?: string;
          documentType?: string;
          documentStats?: {
            wordCount?: number;
            embeddedImageCount?: number;
            sheetCount?: number;
            slideCount?: number;
          };
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
        cancelTask: (id: string, taskId: string) => Promise<{ success: boolean; error?: string }>;
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
      os: {
        councilHealth: (historyLimit?: number) => Promise<{
          session: {
            id: string;
            title: string;
            dhi: number;
            verdicts: Array<{
              agentId: string;
              model: string;
              label: string;
              score: number;
              stance: 'approve' | 'revise' | 'reject';
            }>;
          } | null;
          history: Array<{ at: string; taskType: string; dhi: number }>;
        }>;
        knowledgeGraph: (maxNodes?: number) => Promise<{
          nodes: Array<{
            id: string;
            type: 'lesson' | 'decision' | 'fact' | 'discovery';
            label: string;
            confidence?: number;
          }>;
          edges: Array<{ from: string; to: string; kind: string }>;
          truncated: boolean;
        }>;
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
            peerChatProvider?: unknown;
            capability?: unknown;
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
        refreshCapabilities: (
          peerId?: string
        ) => Promise<{ success: boolean; peer?: unknown; peers?: unknown[]; error?: string }>;
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
        dispatch: (input: {
          goal: string;
          parallelism?: number;
          privacyTag?: 'public' | 'sensitive';
          dispatchProfile?: 'balanced' | 'research' | 'code' | 'review' | 'safe';
          maxCostUsd?: number;
          targetPeerIds?: string[];
          deliveryChannel?: string;
          sourceSessionId?: string;
        }) => Promise<{
          ok: boolean;
          sagaId?: string;
          error?: string;
          privacyTag?: 'public' | 'sensitive';
          dispatchProfile?: 'balanced' | 'research' | 'code' | 'review' | 'safe';
          lintWarning?: string;
        }>;
        listSagas: () => Promise<
          Array<{
            id: string;
            goal: string;
            status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
            steps: Array<{
              peerId: string;
              model: string;
              lane: 'primary' | 'fallback' | 'parallel';
              status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
            }>;
            finalResult?: string;
            createdAt: number;
          }>
        >;
        cancelSaga: (sagaId: string) => Promise<{ ok: boolean; error?: string; status?: string }>;
        replaySaga: (sagaId: string) => Promise<{
          ok: boolean;
          sagaId?: string;
          error?: string;
          privacyTag?: 'public' | 'sensitive';
          dispatchProfile?: 'balanced' | 'research' | 'code' | 'review' | 'safe';
          lintWarning?: string;
        }>;
        costSummary: () => Promise<{
          ok: boolean;
          error?: string;
          summary?: {
            todayUsd: number;
            todayByProvider: Record<string, number>;
            todayByPeer: Record<string, number>;
            weekUsd: number;
          };
          budget?: { maxDailyUsd: number; maxSagaUsd: number };
        }>;
        routePreview: (input: {
          goal: string;
          parallelism?: number;
          privacyTag?: 'public' | 'sensitive';
          dispatchProfile?: 'balanced' | 'research' | 'code' | 'review' | 'safe';
          council?: boolean;
          chainRoles?: string[];
          targetPeerIds?: string[];
          maxCostUsd?: number;
        }) => Promise<{
          ok: boolean;
          error?: string;
          privacyTag?: 'public' | 'sensitive';
          lintWarning?: string;
          rationale?: string;
          primary?: { peerId: string; model: string; score?: number; role?: string };
          fallback?: { peerId: string; model: string; score?: number; role?: string };
          parallel?: Array<{ peerId: string; model: string; score?: number; role?: string }>;
          chain?: Array<{ peerId: string; model: string; score?: number; role?: string }>;
        }>;
        peerSessionStart: (
          peerId: string,
          options?: { model?: string; dispatchProfile?: string; systemPrompt?: string }
        ) => Promise<{
          ok: boolean;
          error?: string;
          sessionId?: string;
          expiresAt?: number;
          dispatchProfile?: string;
        }>;
        peerSessionSay: (
          peerId: string,
          sessionId: string,
          prompt: string
        ) => Promise<{ ok: boolean; error?: string; text?: string; finishReason?: string | null }>;
        peerSessionEnd: (
          peerId: string,
          sessionId: string
        ) => Promise<{ ok: boolean; error?: string; closed?: boolean }>;
        peerSessionList: (peerId: string) => Promise<{
          ok: boolean;
          error?: string;
          count?: number;
          sessions: Array<{
            sessionId: string;
            turnCount: number;
            model?: string;
            dispatchProfile?: string;
            ageMs?: number;
            idleMs?: number;
            expiresInMs?: number;
          }>;
        }>;
      };
      team: {
        getStatus: () => Promise<unknown>;
        start: (goal?: string) => Promise<{ success: boolean; leadId?: string; message: string }>;
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
        catalog: () => Promise<unknown[]>;
        runCatalogItem: (id: string) => Promise<unknown>;
        runFailing: () => Promise<unknown>;
        cancel: () => Promise<{ success: boolean }>;
        getState: () => Promise<{
          framework: string | null;
          lastResult: unknown | null;
          isRunning: boolean;
          catalog?: unknown[];
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
          sources?: string[];
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
            source?: string;
            platform?: string;
            origin?: string;
            userId?: string;
            tags?: string[];
            totalCost?: number;
            totalTokens?: number;
            toolCallCount?: number;
          }>
        >;
        getRunDetail: (runId: string) => Promise<unknown | null>;
        searchRuns: (filter?: { query?: string; limit?: number; sources?: string[] }) => Promise<{
          schemaVersion: 1;
          generatedAt: string;
          query: string;
          filters: { limit: number; sources: string[] };
          count: number;
          results: Array<{
            runId: string;
            objective: string;
            status: 'running' | 'completed' | 'failed' | 'cancelled';
            startedAt: number;
            matched: 'artifact' | 'event' | 'summary';
            score: number;
            snippet: string;
            artifact?: string;
            eventType?: string;
            source?: string;
          }>;
        }>;
        getArtifactIndexDoctorStatus: () => Promise<{
          schemaVersion: 1;
          generatedAt: string;
          kind: 'artifact_index_doctor_status';
          status: 'healthy' | 'attention' | 'unavailable';
          unavailable: boolean;
          totalRows: number;
          healthyRows: number;
          staleRows: number;
          orphanedRows: number;
          rows: Array<{
            runId: string;
            artifact: string;
            reason: 'missing_run' | 'missing_artifact';
          }>;
          recommendations: string[];
          repairCommands: {
            staleOnly: string;
            includeOrphans: string;
          };
        }>;
        buildRecallPack: (filter?: {
          cwd?: string;
          includeLessons?: boolean;
          includeMemories?: boolean;
          includeSessions?: boolean;
          query?: string;
          limit?: number;
          maxMemories?: number;
          maxMatchesPerRun?: number;
          maxLessons?: number;
          maxSessions?: number;
          sources?: string[];
        }) => Promise<{
          schemaVersion: 1;
          generatedAt: string;
          query: string;
          filters: {
            limit: number;
            maxMemories: number;
            maxMatchesPerRun: number;
            maxLessons: number;
            maxSessions: number;
            sources: string[];
          };
          count: number;
          lessonCount: number;
          lessons: Array<{
            category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
            content: string;
            context?: string;
            createdAt: number;
            id: string;
            source: 'user_correction' | 'self_observed' | 'manual';
          }>;
          memories: Array<{
            category?: string;
            content: string;
            file: string;
            key?: string;
            line: number;
            scope: 'project' | 'project-memory' | 'user' | 'custom';
            score: number;
            sourceSessionId?: string;
          }>;
          memoryCount: number;
          runCount: number;
          results: Array<{
            runId: string;
            objective: string;
            status: 'running' | 'completed' | 'failed' | 'cancelled';
            startedAt: number;
            matched: 'artifact' | 'event' | 'summary';
            score: number;
            snippet: string;
            artifact?: string;
            eventType?: string;
            source?: string;
          }>;
          runs: Array<{
            artifactCount: number;
            channel?: string;
            eventCount: number;
            matches: Array<{
              artifact?: string;
              eventType?: string;
              matched: 'artifact' | 'event' | 'summary';
              score: number;
              snippet: string;
            }>;
            objective: string;
            runId: string;
            source?: string;
            startedAt: number;
            status: 'running' | 'completed' | 'failed' | 'cancelled';
            tags: string[];
          }>;
          sessionCount: number;
          sessions: Array<{
            id: string;
            lastAccessedAt: string;
            messageId?: number;
            name: string;
            parentSessionId?: string;
            role?: string;
            score?: number;
            snippet?: string;
            workingDirectory: string;
          }>;
          promptContext: string;
        }>;
        buildTrajectoryExport: (filter?: {
          includeArtifactContent?: boolean;
          maxArtifactBytes?: number;
          maxEventValueBytes?: number;
          runId?: string;
        }) => Promise<unknown | null>;
        buildPolicyEvalReport: (filter?: {
          maxArtifactBytes?: number;
          policyIds?: string[];
          runId?: string;
        }) => Promise<unknown | null>;
        buildGoldenWorkflowEvalReport: (filter?: {
          fixtureIds?: string[];
          maxArtifactBytes?: number;
          runId?: string;
        }) => Promise<unknown | null>;
        buildMobileSnapshot: (filter?: {
          cwd?: string;
          includeLessons?: boolean;
          includeMemories?: boolean;
          includeSessions?: boolean;
          query?: string;
          limit?: number;
          maxMemories?: number;
          maxLessons?: number;
          maxSessions?: number;
          sources?: string[];
        }) => Promise<unknown>;
        buildMobileGatewayContract: (filter?: {
          cwd?: string;
          includeLessons?: boolean;
          includeMemories?: boolean;
          includeSessions?: boolean;
          includeSnapshot?: boolean;
          query?: string;
          limit?: number;
          maxMemories?: number;
          maxLessons?: number;
          maxSessions?: number;
          sources?: string[];
        }) => Promise<unknown>;
        buildMobileGatewayReviewDraft: (filter?: {
          action?: string;
          cwd?: string;
          includeLessons?: boolean;
          includeMemories?: boolean;
          includeSessions?: boolean;
          includeSnapshot?: boolean;
          localOperator?: boolean;
          method?: 'GET' | 'POST' | string;
          path?: string;
          query?: string;
          limit?: number;
          maxMemories?: number;
          maxLessons?: number;
          maxSessions?: number;
          sources?: string[];
        }) => Promise<unknown>;
        buildMobileGatewayListenerShell: (filter?: {
          cwd?: string;
          includeLessons?: boolean;
          includeMemories?: boolean;
          includeSessions?: boolean;
          query?: string;
          limit?: number;
          maxMemories?: number;
          maxLessons?: number;
          maxSessions?: number;
          sources?: string[];
        }) => Promise<unknown>;
        buildMobilePairingState: (filter?: {
          cwd?: string;
          deviceLabel?: string;
          includeLessons?: boolean;
          includeMemories?: boolean;
          includeSessions?: boolean;
          query?: string;
          limit?: number;
          maxMemories?: number;
          maxLessons?: number;
          maxSessions?: number;
          sources?: string[];
          ttlSeconds?: number;
        }) => Promise<unknown>;
        buildMobilePairingAcceptancePlan: (filter?: {
          cwd?: string;
          deviceLabel?: string;
          includeLessons?: boolean;
          includeMemories?: boolean;
          includeSessions?: boolean;
          localOperatorLabel?: string;
          query?: string;
          limit?: number;
          maxMemories?: number;
          maxLessons?: number;
          maxSessions?: number;
          sources?: string[];
          ttlSeconds?: number;
        }) => Promise<unknown>;
        buildMobileApprovalQueue: (filter?: {
          cwd?: string;
          deviceLabel?: string;
          includeLessons?: boolean;
          includeMemories?: boolean;
          includeSessions?: boolean;
          query?: string;
          limit?: number;
          maxMemories?: number;
          maxLessons?: number;
          maxSessions?: number;
          sources?: string[];
          ttlSeconds?: number;
        }) => Promise<unknown>;
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
          output?: string;
          error?: string;
          handled?: boolean;
          action?: {
            type: 'open_schedule' | 'create_schedule' | 'ui_effect';
            uiEffect?:
              | 'open_model_picker'
              | 'run_orchestrator'
              | 'open_orchestrator_launcher'
              | 'open_fleet'
              | 'set_plan_mode'
              | 'open_lessons'
              | 'open_team'
              | 'open_companion'
              | 'open_spec'
              | 'open_settings'
              | 'open_panel'
              | 'engine_action';
            args?: string[];
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
      autonomy: {
        snapshot: (dir?: string) => Promise<{
          ok: boolean;
          error?: string;
          dir: string | null;
          tasks: Array<{
            id: string;
            title: string;
            description?: string;
            status: string;
            priority: string;
            claimedBy?: string | null;
            claimedAt?: string | null;
            dependsOn?: string[];
          }>;
          worklog: Array<{
            id?: string;
            date?: string;
            agent?: string;
            taskId?: string | null;
            summary?: string;
          }>;
          presence: Record<
            string,
            { host?: string; status?: string; currentTask?: string | null; lastSeen?: string }
          >;
        }>;
        daemonStatus: () => Promise<{
          ok: boolean;
          error?: string;
          serviceName: string;
          service: { installed: boolean; running: boolean; platform: string } | null;
          queueDir: string;
          manageCommand: string;
        }>;
        serviceControl: (action: 'start' | 'stop' | 'restart') => Promise<{
          ok: boolean;
          error?: string;
          action: 'start' | 'stop' | 'restart';
          service: { installed: boolean; running: boolean; platform: string } | null;
        }>;
        serviceInstall: (options?: {
          dir?: string;
          model?: string;
          ollamaUrl?: string;
          intervalMs?: number;
          executor?: 'artifact' | 'agent';
          workspace?: string;
        }) => Promise<{
          ok: boolean;
          error?: string;
          servicePath?: string;
          platform?: string;
          instructions?: string;
          queueDir?: string;
          model?: string;
          executor?: 'artifact' | 'agent';
        }>;
        serviceUninstall: () => Promise<{
          ok: boolean;
          error?: string;
          servicePath?: string;
          platform?: string;
        }>;
        runTick: (dir?: string) => Promise<{
          ok: boolean;
          error?: string;
          ticks?: number;
          outcomes?: Record<string, number>;
          stoppedReason?: string;
          output?: string;
        }>;
        modelTier: () => Promise<{
          ok: boolean;
          error?: string;
          ladder: Array<{
            tier: 'local' | 'network' | 'escalated';
            model: string;
            baseUrl?: string;
            paid: boolean;
            configured: boolean;
          }>;
          currentChoice?: { model: string; tier: string; paid: boolean; reason: string };
        }>;
        serviceLogs: (
          lines?: number
        ) => Promise<{ ok: boolean; error?: string; source?: string; lines?: string[] }>;
        taskAdd: (input: {
          title: string;
          description?: string;
          priority?: 'critical' | 'high' | 'medium' | 'low';
          dependsOn?: string[];
          verifyCommand?: string;
          acceptanceCriteria?: string[];
          dir?: string;
        }) => Promise<{
          ok: boolean;
          error?: string;
          task?: {
            id: string;
            title: string;
            description?: string;
            status: string;
            priority: string;
            claimedBy?: string | null;
            blockedReason?: string;
            dependsOn?: string[];
          };
          dir?: string;
        }>;
        taskClaim: (
          taskId: string,
          dir?: string
        ) => Promise<{
          ok: boolean;
          error?: string;
          task?: {
            id: string;
            title: string;
            status: string;
            priority: string;
            claimedBy?: string | null;
          };
          dir?: string;
        }>;
        taskComplete: (
          taskId: string,
          summary: string,
          dir?: string
        ) => Promise<{
          ok: boolean;
          error?: string;
          task?: {
            id: string;
            title: string;
            status: string;
            priority: string;
            claimedBy?: string | null;
          };
          dir?: string;
        }>;
        taskBlock: (
          taskId: string,
          reason: string,
          dir?: string
        ) => Promise<{
          ok: boolean;
          error?: string;
          task?: {
            id: string;
            title: string;
            status: string;
            priority: string;
            blockedReason?: string;
          };
          dir?: string;
        }>;
        taskRelease: (
          taskId: string,
          dir?: string
        ) => Promise<{
          ok: boolean;
          error?: string;
          task?: {
            id: string;
            title: string;
            status: string;
            priority: string;
            claimedBy?: string | null;
          };
          dir?: string;
        }>;
        reclaimExpired: (
          dir?: string
        ) => Promise<{ ok: boolean; error?: string; reclaimed: string[]; dir?: string }>;
      };
      lessons: {
        add: (
          category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT',
          content: string,
          projectId?: string
        ) => Promise<{ success: boolean; error?: string; lessonId?: string }>;
      };
      backup: {
        list: () => Promise<{ ok: boolean; error?: string; output?: string }>;
        create: (options?: {
          onlyConfig?: boolean;
        }) => Promise<{ ok: boolean; error?: string; output?: string }>;
        verify: (file: string) => Promise<{ ok: boolean; error?: string; output?: string }>;
        restore: (file: string) => Promise<{ ok: boolean; error?: string; output?: string }>;
      };
      liveLauncher: {
        start: (input: {
          kind: 'research' | 'flow';
          prompt: string;
          model?: string;
          provider?: 'ollama' | 'inherit';
          ollamaUrl?: string;
          wide?: boolean;
          workers?: number;
          maxRetries?: number;
          timeoutMs?: number;
        }) => Promise<{ ok: boolean; error?: string; runId?: string; reportPath?: string }>;
        cancel: (runId: string) => Promise<{ ok: boolean; error?: string }>;
        status: (runId: string) => Promise<{
          runId: string;
          kind: 'research' | 'flow';
          prompt: string;
          model?: string;
          provider: 'ollama' | 'inherit';
          status: 'running' | 'succeeded' | 'failed' | 'cancelled';
          startedAt: number;
          endedAt?: number;
          exitCode?: number;
          reportPath?: string;
          logTail: string[];
          result?: string;
          error?: string;
        } | null>;
        list: () => Promise<
          Array<{
            runId: string;
            kind: 'research' | 'flow';
            prompt: string;
            status: 'running' | 'succeeded' | 'failed' | 'cancelled';
            startedAt: number;
            endedAt?: number;
            reportPath?: string;
          }>
        >;
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
      lessonCandidate: LessonCandidateApi;
      userModel: UserModelApi;
      deviceNodes: {
        list: () => Promise<{
          ok: boolean;
          error?: string;
          items: Array<{
            id: string;
            name: string;
            type: string;
            transportType: string;
            capabilities: string[];
            paired: boolean;
            lastSeen: number;
            address?: string;
            port?: number;
            username?: string;
          }>;
        }>;
      };
      profiles: {
        list: () => Promise<{
          ok: boolean;
          error?: string;
          profiles: Array<{ name: string; active: boolean }>;
          active: string | null;
        }>;
        active: () => Promise<{ ok: boolean; error?: string; active: string | null }>;
        create: (name: string) => Promise<{
          ok: boolean;
          error?: string;
          requiresRestart?: boolean;
          profiles?: Array<{ name: string; active: boolean }>;
          active?: string | null;
        }>;
        switch: (name: string | null) => Promise<{
          ok: boolean;
          error?: string;
          requiresRestart?: boolean;
          profiles?: Array<{ name: string; active: boolean }>;
          active?: string | null;
        }>;
      };
      channels: {
        status: () => Promise<{
          ok: boolean;
          error?: string;
          items: Array<{
            type: string;
            connected: boolean;
            authenticated: boolean;
            lastActivity?: number;
            error?: string;
          }>;
          report: {
            config: {
              channels: Array<{
                allowedChannelsCount: number;
                allowedUsersCount: number;
                enabled: boolean;
                hasToken: boolean;
                hasWebhookUrl: boolean;
                optionKeys: string[];
                type: string;
              }>;
              configuredCount: number;
              disabledCount: number;
              enabledCount: number;
              path?: string;
            };
            generatedAt: string;
            kind: 'codebuddy_channel_status';
            recommendations: string[];
            runtime: {
              authenticatedCount: number;
              channels: Array<{
                authenticated: boolean;
                connected: boolean;
                error?: string;
                lastActivity?: string;
                type: string;
              }>;
              connectedCount: number;
              registeredCount: number;
            };
            schemaVersion: 1;
          } | null;
        }>;
        listConfig: (opts?: { configPath?: string }) => Promise<{
          ok: boolean;
          error?: string;
          path: string;
          channels: Array<{
            type: string;
            enabled: boolean;
            configured: boolean;
            hasSecret: boolean;
            hasWebhookUrl: boolean;
            webhookUrl?: string;
            allowedUsers: string[];
            allowedChannels: string[];
            optionKeys: string[];
            connected: boolean;
            authenticated: boolean;
            lastActivity?: number;
            error?: string;
          }>;
          catalog: Array<{
            type: string;
            label: string;
            secretLabel: string;
            needsSecret: boolean;
            supportsWebhook: boolean;
          }>;
        }>;
        setConfig: (
          type: string,
          patch: {
            enabled?: boolean;
            webhookUrl?: string;
            allowedUsers?: string[];
            allowedChannels?: string[];
          },
          opts?: { configPath?: string }
        ) => Promise<{ ok: boolean; error?: string }>;
        setEnabled: (
          type: string,
          enabled: boolean,
          opts?: { configPath?: string }
        ) => Promise<{ ok: boolean; error?: string }>;
        setSecret: (type: string, token: string) => Promise<{ ok: boolean; error?: string }>;
        deleteSecret: (type: string) => Promise<{ ok: boolean; error?: string }>;
        removeChannel: (
          type: string,
          opts?: { configPath?: string }
        ) => Promise<{ ok: boolean; error?: string }>;
      };
      pairing: {
        status: () => Promise<{
          ok: boolean;
          error?: string;
          enabled: boolean;
          totalApproved: number;
          totalPending: number;
          totalBlocked: number;
          approvedByChannel: Record<string, number>;
        }>;
        list: () => Promise<{
          ok: boolean;
          error?: string;
          approved: Array<{
            channelType: string;
            senderId: string;
            displayName?: string;
            approvedAt: string;
            approvedBy: string;
            notes?: string;
          }>;
        }>;
        pending: () => Promise<{
          ok: boolean;
          error?: string;
          pending: Array<{
            code: string;
            channelType: string;
            senderId: string;
            displayName?: string;
            createdAt: string;
            expiresAt: string;
            attempts: number;
          }>;
        }>;
        approve: (
          channelType: string,
          code: string,
          approvedBy?: string
        ) => Promise<{
          ok: boolean;
          error?: string;
          approved?: {
            channelType: string;
            senderId: string;
            approvedAt: string;
            approvedBy: string;
            displayName?: string;
          } | null;
        }>;
        approveDirect: (
          channelType: string,
          senderId: string,
          approvedBy?: string,
          displayName?: string
        ) => Promise<{
          ok: boolean;
          error?: string;
          approved?: {
            channelType: string;
            senderId: string;
            approvedAt: string;
            approvedBy: string;
            displayName?: string;
          } | null;
        }>;
        revoke: (
          channelType: string,
          senderId: string
        ) => Promise<{ ok: boolean; error?: string; revoked?: boolean }>;
      };
      identityFiles: {
        list: (projectId?: string) => Promise<{
          ok: boolean;
          error?: string;
          items: Array<{
            name: string;
            content: string;
            source: 'project' | 'global';
            path: string;
            lastModified: number;
          }>;
        }>;
        get: (
          name: string,
          projectId?: string
        ) => Promise<{
          ok: boolean;
          error?: string;
          file?: {
            name: string;
            content: string;
            source: 'project' | 'global';
            path: string;
            lastModified: number;
          } | null;
        }>;
        set: (
          name: string,
          content: string,
          projectId?: string
        ) => Promise<{ ok: boolean; error?: string }>;
      };
      mobileSupervision: {
        status: () => Promise<{
          running: boolean;
          port: number | null;
          pairingCode?: string;
          devices?: string[];
          drafts?: Array<{
            id: string;
            prompt: string;
            status: 'needs_local_operator' | 'approved' | 'cancelled';
            source: 'mobile_device' | 'draft_only';
            createdAt: number;
            approvedBy?: string;
          }>;
          error?: string;
        }>;
        approve: (id: string, reviewer?: string) => Promise<{ ok: boolean; error?: string }>;
        cancel: (id: string) => Promise<{ ok: boolean; error?: string }>;
        rotateCode: () => Promise<{ ok: boolean; pairingCode?: string; error?: string }>;
      };
      spec: SpecApi;
      skillsHub: {
        list: (projectId?: string) => Promise<unknown[]>;
        listEnabled: (projectId?: string) => Promise<unknown[]>;
        setEnabled: (
          name: string,
          enabled: boolean,
          projectId?: string,
          filePath?: string
        ) => Promise<unknown>;
      };
      memoryProvider: {
        list: () => Promise<string[]>;
        getActive: () => Promise<string>;
        setActive: (id: string) => Promise<{ success: boolean; error?: string }>;
      };
    };
  }
}
