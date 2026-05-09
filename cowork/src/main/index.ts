/**
 * @module main/index
 *
 * Electron main-process entry point (2181 lines).
 *
 * Responsibilities:
 * - App lifecycle: ready, activate, before-quit, window-will-close
 * - Central IPC hub: ~60 handlers namespaced as config.*, mcp.*, session.*,
 *   sandbox.*, logs.*, remote.*, schedule.*, etc.
 * - BrowserWindow creation and deep-link / protocol handling
 *
 * Dependencies: session-manager, config-store, mcp-manager, sandbox-adapter,
 *               skills-manager, scheduled-task-manager, nav-server, remote-manager
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, Tray, globalShortcut } from 'electron';
import { join, resolve, dirname, isAbsolute, basename } from 'path';
import { pathToFileURL } from 'url';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { config } from 'dotenv';
import { registerProjectIpcHandlers } from './ipc/project-ipc';
import { registerSubAgentIpcHandlers } from './ipc/subagent-ipc';
import { registerOrchestratorIpcHandlers } from './ipc/orchestrator-ipc';
import { registerFleetIpcHandlers } from './ipc/fleet-ipc';
import { registerTeamIpcHandlers } from './ipc/team-ipc';
import { registerMentionIpcHandlers } from './ipc/mention-ipc';
import { registerCommandIpcHandlers } from './ipc/command-ipc';
import { registerSkillMdIpcHandlers } from './ipc/skill-md-ipc';
import { registerKnowledgeIpcHandlers } from './ipc/knowledge-ipc';
import { initDatabase, closeDatabase } from './db/database';
import { SessionManager, type EngineAdapterLike } from './session/session-manager';
import { classifyEngineLoadError, isEmbeddedOptOut, resolveEnginePath } from './engine/embedded-mode';
import { applyGroundingToggle } from './codebuddy/grounding-handler';
import {
  ProjectManager,
} from './project/project-manager';
import { ProjectMemoryService } from './project/project-memory';
import { SubAgentBridge } from './agent/sub-agent-bridge';
import { OrchestratorBridge } from './agent/orchestrator-bridge';
import { FleetBridge } from './fleet/fleet-bridge';
import { TeamBridge } from './agent/team-bridge';
import { MentionProcessor } from './input/mention-processor';
import { SlashCommandBridge } from './commands/slash-command-bridge';
import { SkillMdBridge } from './skills/skill-md-bridge';
import { MCPMarketplaceBridge } from './mcp/mcp-marketplace-bridge';
import { CostBridge } from './cost/cost-bridge';
import { RulesBridge } from './security/rules-bridge';
import { SessionBranchingBridge } from './session/session-branching';
import { GlobalSearchService } from './search/global-search-service';
import { PreviewService } from './preview/preview-service';
import { parseUnifiedDiff, revertHunks, type ParsedHunk } from './diff/hunk-diff-service';
import { getGitBridge } from './git/git-bridge';
import { getModelCapabilities } from './config/model-capability-bridge';
import { TemplateService } from './project/template-service';
import { WorkflowBridge } from './workflows/workflow-bridge';
import { SessionExportService } from './session/session-export-service';
import { SessionInsightsBridge } from './session/session-insights-bridge';
import { ActivityFeed } from './activity/activity-feed';
import { BookmarksService } from './bookmarks/bookmarks-service';
import { getSnippetsService } from './snippets/snippets-service';
import { getCustomCommandsService } from './commands/custom-commands-service';
import {
  getWorkspacePresetsService,
  type WorkspacePreset,
} from './workspace/workspace-presets-service';
import { ConfigExportService } from './config/config-export-service';
import { KnowledgeService } from './knowledge/knowledge-service';
import { NotificationBridge } from './notification/notification-bridge';
import { ICMIntegration } from './memory/icm-integration';
import { TaskDispatch, type DispatchRequest } from './remote/task-dispatch';
import { SkillsManager } from './skills/skills-manager';
import { PluginCatalogService } from './skills/plugin-catalog-service';
import { PluginRuntimeService } from './skills/plugin-runtime-service';
import {
  configStore,
  getPiAiModelPresets,
  type AppConfig,
  type AppTheme,
  type CreateConfigSetPayload,
} from './config/config-store';
import { runConfigApiTest } from './config/config-test-routing';
import { listLmStudioModels } from './config/lmstudio-api';
import { listOllamaModels } from './config/ollama-api';
import { mcpConfigStore } from './mcp/mcp-config-store';
import { getSandboxAdapter, shutdownSandbox } from './sandbox/sandbox-adapter';
import { SandboxSync } from './sandbox/sandbox-sync';
import { WSLBridge } from './sandbox/wsl-bridge';
import { LimaBridge } from './sandbox/lima-bridge';
import { getSandboxBootstrap } from './sandbox/sandbox-bootstrap';
import type { MCPServerConfig } from './mcp/mcp-manager';
import type {
  ClientEvent,
  ApiTestInput,
  ApiTestResult,
  DiagnosticInput,
  ProviderModelInfo,
} from '../renderer/types';
import { remoteManager, type AgentExecutor } from './remote/remote-manager';
import { remoteConfigStore } from './remote/remote-config-store';
import type { GatewayConfig, FeishuChannelConfig, ChannelType } from './remote/types';
import { startNavServer, stopNavServer } from './nav-server';
import {
  ScheduledTaskManager,
  type ScheduledTaskCreateInput,
  type ScheduledTaskUpdateInput,
} from './schedule/scheduled-task-manager';
import { createScheduledTaskStore } from './schedule/scheduled-task-store';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from '../shared/schedule/task-title';
import {
  isUncPath,
  isWindowsDrivePath,
  localPathFromAppUrlPathname,
  localPathFromFileUrl,
  decodePathSafely,
} from '../shared/local-file-path';
import { eventRequiresSessionManager } from './client-event-utils';
import { getUnsupportedWorkspacePathReason } from './workspace-path-constraints';
import {
  log,
  logWarn,
  logError,
  getLogFilePath,
  getLogsDirectory,
  getAllLogFiles,
  closeLogFile,
  setDevLogsEnabled,
  isDevLogsEnabled,
} from './utils/logger';
import { listRecentWorkspaceFiles } from './utils/recent-workspace-files';
import { buildDiagnosticsSummary } from './utils/diagnostics-summary';
import { getGeminiOauthTokens, clearGeminiCredentials } from '../../../src/providers/gemini-oauth';
import {
  loginInteractive as codexLoginInteractive,
  clearCodexCredentials,
  getChatGptAuth,
  hasCodexCredentials,
} from '../../../src/providers/codex-oauth';

// Current working directory (persisted between sessions)
let currentWorkingDir: string | null = null;

// Load .env file from project root (for development)
const envPath = resolve(__dirname, '../../.env');
log('[dotenv] Loading from:', envPath);
const dotenvResult = config({ path: envPath });
if (dotenvResult.error) {
  logWarn('[dotenv] Failed to load .env:', dotenvResult.error.message);
} else {
  log('[dotenv] Loaded successfully');
}

// Apply saved config (this overrides .env if config exists)
if (configStore.isConfigured()) {
  log('[Config] Applying saved configuration...');
  configStore.applyToEnv();
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let sessionManager: SessionManager | null = null;
let skillsManager: SkillsManager | null = null;
let pluginRuntimeService: PluginRuntimeService | null = null;
let scheduledTaskManager: ScheduledTaskManager | null = null;
let projectManager: ProjectManager | null = null;
let subAgentBridge: SubAgentBridge | null = null;
let orchestratorBridge: OrchestratorBridge | null = null;
let fleetBridge: FleetBridge | null = null;
let teamBridge: TeamBridge | null = null;
let mentionProcessor: MentionProcessor | null = null;
let slashCommandBridge: SlashCommandBridge | null = null;
let skillMdBridge: SkillMdBridge | null = null;
let mcpMarketplaceBridge: MCPMarketplaceBridge | null = null;
let costBridge: CostBridge | null = null;
let rulesBridge: RulesBridge | null = null;
let sessionBranchingBridge: SessionBranchingBridge | null = null;
let globalSearchService: GlobalSearchService | null = null;
let previewService: PreviewService | null = null;
let templateService: TemplateService | null = null;
let workflowBridge: WorkflowBridge | null = null;
let sessionExportService: SessionExportService | null = null;
let sessionInsightsBridge: SessionInsightsBridge | null = null;
let activityFeed: ActivityFeed | null = null;
let bookmarksService: BookmarksService | null = null;
let configExportService: ConfigExportService | null = null;
let knowledgeService: KnowledgeService | null = null;
let projectMemoryServiceRef: ProjectMemoryService | null = null;
let notificationBridge: NotificationBridge | null = null;
let icmIntegration: ICMIntegration | null = null;
let taskDispatch: TaskDispatch | null = null;

function sanitizeDiagnosticBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.origin}${pathname}`;
  } catch {
    return value.replace(/[?#].*$/, '');
  }
}

async function resolveScheduledTaskTitle(
  prompt: string,
  _cwd?: string,
  fallbackTitle?: string
): Promise<string> {
  const normalizedPrompt = prompt.trim();
  const fallback = fallbackTitle
    ? buildScheduledTaskTitle(fallbackTitle)
    : buildScheduledTaskFallbackTitle(normalizedPrompt);
  if (!sessionManager) {
    return fallback;
  }
  try {
    return await sessionManager.generateScheduledTaskTitle(normalizedPrompt);
  } catch (error) {
    logWarn('[Schedule] Failed to generate title via session title flow, using fallback', error);
    return fallback;
  }
}

async function waitForDevServer(url: string, maxAttempts = 30, intervalMs = 500): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        if (attempt > 1) {
          log(`[App] Dev server ready after ${attempt} attempt(s): ${url}`);
        }
        return true;
      }
    } catch {
      // Ignore and retry until timeout
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  logWarn(`[App] Dev server did not become ready within timeout: ${url}`);
  return false;
}

// Single-instance lock: skip in dev mode so vite-plugin-electron can restart freely
// without the old process blocking the new one during async cleanup.
const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isE2E = process.env.COWORK_E2E === '1';
const ELECTRON_DEVTOOLS_DEBUG_PORT = '9223';

// Enable Chrome DevTools Protocol in dev mode so the renderer can be inspected
// via chrome://inspect or connected to by Puppeteer/Playwright at localhost:9223.
// Chrome MCP uses 9222, so keep Electron on a separate port in development.
if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', ELECTRON_DEVTOOLS_DEBUG_PORT);
  app.commandLine.appendSwitch(
    'remote-allow-origins',
    `http://localhost:${ELECTRON_DEVTOOLS_DEBUG_PORT}`
  );
}

const hasSingleInstanceLock = isDev || isE2E || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logWarn('[App] Another instance is already running, quitting this instance');
  app.quit();
} else if (!isDev && !isE2E) {
  app.on('second-instance', () => {
    const existingWindow =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

    if (!existingWindow) {
      log('[App] No existing window found, creating new one');
      createWindow();
      return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = existingWindow;
    }
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.show();
    existingWindow.focus();
    log('[App] Blocked second instance and focused existing window');
  });
}

// Tray instance (kept alive to prevent GC)
let tray: Tray | null = null;
const DARK_BG = '#171614';
const LIGHT_BG = '#f5f3ee';

function buildMacMenu() {
  if (process.platform !== 'darwin') return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'CmdOrCtrl+,',
          click: () =>
            mainWindow?.webContents.send('server-event', { type: 'navigate', payload: 'settings' }),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray() {
  if (tray) return;

  // Use .ico on Windows for proper multi-resolution tray support; fall back to .png if absent
  const iconName =
    process.platform === 'darwin'
      ? 'tray-iconTemplate.png'
      : process.platform === 'win32'
        ? 'tray-icon.ico'
        : 'tray-icon.png';
  // tray-icon.ico is generated from tray-icon.png by scripts/build-tray-icon.js
  // (run as part of `npm run build` and available as `npm run build:tray-icon`).
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, iconName)
    : join(__dirname, '../../resources', iconName);

  // On Windows, fall back to .png if the .ico file has not been created yet
  const resolvedIconPath =
    process.platform === 'win32' && !fs.existsSync(iconPath)
      ? app.isPackaged
        ? join(process.resourcesPath, 'tray-icon.png')
        : join(__dirname, '../../resources', 'tray-icon.png')
      : iconPath;

  // Gracefully skip tray if icon is missing (e.g. dev environment)
  if (!fs.existsSync(resolvedIconPath)) {
    log('[Tray] Icon not found at', resolvedIconPath, '— skipping tray setup');
    return;
  }

  tray = new Tray(resolvedIconPath);
  tray.setToolTip('Open Cowork');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide Window',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'New Session',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('server-event', { type: 'new-session' });
        }
      },
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('server-event', { type: 'navigate', payload: 'settings' });
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getSavedThemePreference(): AppTheme {
  const theme = configStore.get('theme');
  return theme === 'dark' || theme === 'system' ? theme : 'light';
}

function resolveEffectiveTheme(theme: AppTheme): 'dark' | 'light' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return theme;
}

function applyNativeThemePreference(theme: AppTheme): void {
  nativeTheme.themeSource = theme;
}

function createWindow() {
  const savedTheme = getSavedThemePreference();
  applyNativeThemePreference(savedTheme);
  const effectiveTheme = resolveEffectiveTheme(savedTheme);
  const THEME =
    effectiveTheme === 'dark'
      ? {
          background: DARK_BG,
          titleBar: DARK_BG,
          titleBarSymbol: '#f1ece4',
        }
      : {
          background: LIGHT_BG,
          titleBar: LIGHT_BG,
          titleBarSymbol: '#1a1a1a',
        };

  // Platform-specific window configuration
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  // Base window options
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: THEME.background,
    icon: (() => {
      const windowIconName = isMac ? 'icon.icns' : isWindows ? 'icon.ico' : 'icon.png';
      return app.isPackaged
        ? join(process.resourcesPath, windowIconName)
        : join(__dirname, `../../resources/${windowIconName}`);
    })(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  if (isMac) {
    // macOS: Use hiddenInset for native traffic light buttons
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    // Windows: Use frameless window with custom titlebar
    // Note: frame: false removes native frame, allowing custom titlebar
    windowOptions.frame = false;
  } else {
    // Linux: Use frameless window
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  const allowedOrigins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
    } catch {
      // 忽略无效的开发服务地址
    }
  }
  const allowedProtocols = new Set<string>(['file:', 'devtools:']);

  const isExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (allowedProtocols.has(parsed.protocol)) {
        return false;
      }
      if (allowedOrigins.has(parsed.origin)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const extractLocalPathFromNavigationUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') {
        return localPathFromFileUrl(url);
      }
      if (!allowedOrigins.has(parsed.origin)) {
        return null;
      }
      return localPathFromAppUrlPathname(parsed.pathname || '');
    } catch {
      return null;
    }
  };

  async function revealNavigationTarget(url: string): Promise<boolean> {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (!localPath) {
      return false;
    }
    return revealFileInFolder(localPath);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      void revealNavigationTarget(url);
      return { action: 'deny' };
    }
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      event.preventDefault();
      void revealNavigationTarget(url);
      return;
    }
    if (isExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    void (async () => {
      await waitForDevServer(devServerUrl, 40, 500);
      if (!mainWindow || mainWindow.isDestroyed()) return;

      try {
        await mainWindow.loadURL(devServerUrl);
      } catch (error) {
        logError('[App] Failed to load dev server URL:', error);
      }
    })();
    // mainWindow.webContents.openDevTools(); // Commented out - open manually with Cmd+Option+I if needed
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }
  // Phase d.21 audit-debug — auto-open DevTools when NODE_ENV=development
  // so React errors come with full stack + console logs are visible.
  if (process.env.NODE_ENV === 'development' && mainWindow) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Register Panic Stop Shortcut
  mainWindow.on('focus', () => {
    globalShortcut.register('CommandOrControl+Alt+S', () => {
      logWarn('[App] Panic Stop shortcut triggered!');
      if (mainWindow) {
        sendToRenderer({ type: 'panic-stop', payload: {} });
      }
    });
  });
  mainWindow.on('blur', () => {
    globalShortcut.unregister('CommandOrControl+Alt+S');
  });

  // Notify renderer about config status after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const isConfigured = configStore.isConfigured();
    log('[Config] Notifying renderer, isConfigured:', isConfigured);
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: configStore.getAll(),
      },
    });

    // Send current working directory to renderer
    sendToRenderer({
      type: 'workdir.changed',
      payload: { path: currentWorkingDir || '' },
    });

    // Start sandbox bootstrap after window is loaded
    startSandboxBootstrap();
  });
}

/**
 * Initialize default working directory
 * This is always the app's default_working_dir in userData - it never changes
 * Each session can have its own cwd that differs from this default
 */
function initializeDefaultWorkingDir(): string {
  // Create default working directory in user data path (this is the permanent global default)
  const userDataPath = app.getPath('userData');
  const defaultDir = join(userDataPath, 'default_working_dir');

  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
    log('[App] Created default working directory:', defaultDir);
  }

  currentWorkingDir = defaultDir;

  log('[App] Global default working directory:', currentWorkingDir);
  return currentWorkingDir;
}

/**
 * Get current working directory
 */
function getWorkingDir(): string | null {
  return currentWorkingDir;
}

function getWorkspacePathUnsupportedReason(workspacePath?: string): string | null {
  return getUnsupportedWorkspacePathReason({
    platform: process.platform,
    sandboxEnabled: configStore.get('sandboxEnabled') !== false,
    workspacePath,
  });
}

/**
 * Set working directory
 * - If sessionId is provided: update only that session's cwd (for switching directories within a chat)
 * - If no sessionId: update UI display only (for WelcomeView - will be used when creating new session)
 *
 * Note: The global default (currentWorkingDir) is NEVER changed after initialization.
 * It is always app.getPath('userData')/default_working_dir
 */
async function setWorkingDir(
  newDir: string,
  sessionId?: string
): Promise<{ success: boolean; path: string; error?: string }> {
  const unsupportedReason = getWorkspacePathUnsupportedReason(newDir);
  if (unsupportedReason) {
    return { success: false, path: newDir, error: unsupportedReason };
  }

  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: 'Directory does not exist' };
  }

  if (sessionId && sessionManager) {
    // Update only this session's cwd - don't change the global default
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    sessionManager.updateSessionCwd(sessionId, newDir);

    // Clear this session's sandbox mapping so next query uses the new directory
    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('./sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  }

  // Notify renderer of workdir change (for UI display)
  // This updates what the user sees, and will be passed to startSession for new sessions
  sendToRenderer({
    type: 'workdir.changed',
    payload: { path: newDir },
  });

  // Sync persona bridge workspace so identity lookups follow the active cwd
  try {
    const { getIdentityBridge } = await import('./identity/identity-bridge');
    const bridge = getIdentityBridge();
    if (!(bridge as unknown as { _coworkListenerBound?: boolean })._coworkListenerBound) {
      bridge.on('personas:updated', (entries) => {
        sendToRenderer({ type: 'identity.updated', payload: entries });
      });
      bridge.on('personas:activated', (entry) => {
        sendToRenderer({ type: 'identity.activated', payload: entry });
      });
      (bridge as unknown as { _coworkListenerBound?: boolean })._coworkListenerBound = true;
    }
    bridge.setWorkspace(newDir);
  } catch (err) {
    logWarn('[App] identity bridge workspace sync failed:', err);
  }

  // Sync hooks bridge workspace
  try {
    const { getHooksBridge } = await import('./hooks/hooks-bridge');
    getHooksBridge().setWorkspace(newDir);
  } catch (err) {
    logWarn('[App] hooks bridge workspace sync failed:', err);
  }

  // Sync test runner workspace + event forwarding
  try {
    const { getTestRunnerBridge } = await import('./testing/test-runner-bridge');
    const bridge = getTestRunnerBridge();
    if (!(bridge as unknown as { _coworkListenerBound?: boolean })._coworkListenerBound) {
      bridge.on('test.framework', (p) => sendToRenderer({ type: 'test.framework', payload: p }));
      bridge.on('test.start', (p) => sendToRenderer({ type: 'test.start', payload: p }));
      bridge.on('test.output', (p) => sendToRenderer({ type: 'test.output', payload: p }));
      bridge.on('test.complete', (p) => sendToRenderer({ type: 'test.complete', payload: p }));
      bridge.on('test.cancelled', () => sendToRenderer({ type: 'test.cancelled', payload: null }));
      (bridge as unknown as { _coworkListenerBound?: boolean })._coworkListenerBound = true;
    }
    bridge.setWorkspace(newDir);
  } catch (err) {
    logWarn('[App] test runner workspace sync failed:', err);
  }

  log(
    '[App] Working directory for UI updated:',
    newDir,
    sessionId ? `(session: ${sessionId})` : '(pending new session)'
  );

  return { success: true, path: newDir };
}

/**
 * Start sandbox bootstrap in the background
 * This pre-initializes WSL/Lima environment at app startup
 */
async function startSandboxBootstrap(): Promise<void> {
  // Skip sandbox bootstrap if disabled - use native mode directly
  const sandboxEnabled = configStore.get('sandboxEnabled');
  if (sandboxEnabled === false) {
    log('[App] Sandbox disabled, skipping bootstrap (using native mode)');
    return;
  }

  const bootstrap = getSandboxBootstrap();

  // Skip if already complete
  if (bootstrap.isComplete()) {
    log('[App] Sandbox bootstrap already complete');
    return;
  }

  // Set up progress callback to notify renderer
  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({
      type: 'sandbox.progress',
      payload: progress,
    });
  });

  // Start bootstrap (non-blocking)
  log('[App] Starting sandbox bootstrap...');
  try {
    const result = await bootstrap.bootstrap();
    log('[App] Sandbox bootstrap complete:', result.mode);
  } catch (error) {
    logError('[App] Sandbox bootstrap error:', error);
  }
}

import { sendToRenderer } from './ipc-main-bridge';

// Initialize app
app
  .whenReady()
  .then(async () => {
    // Apply dev logs setting from config
    const enableDevLogs = configStore.get('enableDevLogs');
    setDevLogsEnabled(enableDevLogs);

    // Log environment variables for debugging
    log('=== Open Cowork Starting ===');
    log('Config file:', configStore.getPath());
    log('Is configured:', configStore.isConfigured());
    log('[Runtime] Using pi-coding-agent SDK for all providers');
    log('Developer logs:', enableDevLogs ? 'Enabled' : 'Disabled');
    log('Environment Variables:');
    log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');
    log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(not set)');
    log('  CLAUDE_MODEL:', process.env.CLAUDE_MODEL || '(not set)');
    log('  CLAUDE_CODE_PATH:', process.env.CLAUDE_CODE_PATH || '(not set)');
    log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set');
    log('  OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL || '(not set)');
    log('  OPENAI_MODEL:', process.env.OPENAI_MODEL || '(not set)');
    log('  OPENAI_API_MODE:', process.env.OPENAI_API_MODE || '(default)');
    log('===========================');

    // Initialize default working directory
    initializeDefaultWorkingDir();
    log('Working directory:', currentWorkingDir);
    // 远程会话默认使用全局工作目录
    remoteManager.setDefaultWorkingDirectory(currentWorkingDir || undefined);

    // Initialize database
    const db = initDatabase();

    pluginRuntimeService = new PluginRuntimeService(new PluginCatalogService());

    // Initialize Code Buddy engine adapter (embedded mode).
    //
    // Default-on: we attempt to load the engine unless the user has
    // explicitly opted out with `CODEBUDDY_EMBEDDED=0`. See
    // `engine/embedded-mode.ts` for the rationale (previously every
    // entry point other than `buddy gui` silently fell back to the
    // pi-coding-agent runner).
    let engineAdapter: EngineAdapterLike | undefined;
    if (isEmbeddedOptOut()) {
      log('[Main] CODEBUDDY_EMBEDDED=0 — embedded engine disabled by env opt-out');
    } else {
      try {
        // Packaged-aware resolution: extraResources copies the engine to
        // `<install>/resources/dist/desktop/` (see electron-builder.yml),
        // while dev mode keeps it at `<repo>/dist/desktop/` next to cowork.
        const enginePath = resolveEnginePath({
          envOverride: process.env.CODEBUDDY_ENGINE_PATH,
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
        });
        // Node's ESM loader on Windows REQUIRES file:// URLs for absolute
        // paths (`d:\...` is rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME).
        // pathToFileURL produces a cross-platform-safe `file:///D:/...`
        // form that the loader accepts on every platform.
        const adapterUrl = pathToFileURL(
          resolve(enginePath, 'desktop', 'codebuddy-engine-adapter.js'),
        ).href;
        const { CodeBuddyEngineAdapter } = await import(
          /* webpackIgnore: true */ /* @vite-ignore */ adapterUrl
        );
        const apiConfig = configStore.getAll();
        engineAdapter = new CodeBuddyEngineAdapter({
          apiKey: apiConfig.apiKey || process.env.GROK_API_KEY || '',
          baseURL: apiConfig.baseUrl || process.env.GROK_BASE_URL,
          model: apiConfig.model,
          workingDirectory: currentWorkingDir || process.cwd(),
          embedded: true,
        }) as EngineAdapterLike;
        // Wire permission bridge for engine tool approvals
        try {
          const permBridgeUrl = pathToFileURL(
            resolve(enginePath, 'desktop', 'permission-bridge.js'),
          ).href;
          const { DesktopPermissionBridge } = await import(
            /* webpackIgnore: true */ /* @vite-ignore */ permBridgeUrl
          );
          const permissionBridge = new DesktopPermissionBridge(sendToRenderer);
          const adapterWithPerm = engineAdapter as unknown as {
            setPermissionCallback?: (cb: unknown) => void;
          };
          if (typeof adapterWithPerm.setPermissionCallback === 'function') {
            adapterWithPerm.setPermissionCallback(
              permissionBridge.requestPermission.bind(permissionBridge)
            );
          }

          // Handle permission responses from renderer
          ipcMain.on(
            'permission.bridge.response',
            (_event, { id, response }: { id: string; response: string }) => {
              permissionBridge.handleResponse(id, response as 'allow' | 'deny' | 'allow_always');
            }
          );

          log('[Main] Permission bridge wired to engine adapter');
        } catch (permErr) {
          logWarn('[Main] Failed to wire permission bridge:', permErr);
        }

        // Apply the user's persisted "Gemini Google Search grounding"
        // preference, if any. No-op when the user hasn't touched the
        // toggle (apiConfig.codebuddy?.geminiGroundingEnabled === undefined)
        // and when the adapter doesn't expose the method (defensive).
        if (apiConfig.codebuddy?.geminiGroundingEnabled === true) {
          const result = applyGroundingToggle(engineAdapter, true);
          if (result.ok) {
            log('[Main] Gemini Google Search grounding enabled by user setting');
          } else {
            log(`[Main] Gemini grounding toggle saved but not applied (reason: ${result.reason ?? 'unknown'})`);
          }
        }

        log('[Main] Code Buddy engine adapter initialized (embedded mode)');
      } catch (err) {
        if (classifyEngineLoadError(err) === 'missing') {
          log('[Main] Code Buddy engine not present, using pi-coding-agent runner');
        } else {
          logWarn('[Main] Failed to load Code Buddy engine, falling back to pi-coding-agent:', err);
        }
      }
    }

    // Hot-apply IPC for the user's "Gemini Google Search grounding"
    // toggle. Registered unconditionally so the renderer can call it
    // even when the embedded engine isn't loaded — the helper returns
    // {ok:false, reason} and the UI can degrade gracefully. The toggle
    // is also persisted to config-store, so the preference survives a
    // restart even when the hot-apply path is a no-op.
    ipcMain.handle(
      'codebuddy:set-gemini-grounding',
      async (_event, payload: { enabled: boolean }) => {
        return applyGroundingToggle(engineAdapter, payload.enabled === true);
      },
    );

    // Initialize session manager before creating an interactive window.
    // This avoids session.start racing the startup path and hitting a null manager.
    sessionManager = new SessionManager(db, sendToRenderer, pluginRuntimeService, engineAdapter);

    // Initialize ProjectManager for Claude Cowork parity
    projectManager = new ProjectManager(db);
    projectManager.setProjectChangeListener((project) => {
      sendToRenderer({
        type: 'project.activeChanged',
        payload: { projectId: project?.id ?? null },
      });
    });

    // Wire project memory service into session manager
    const projectMemoryService = new ProjectMemoryService(projectManager);
    projectMemoryServiceRef = projectMemoryService;
    sessionManager.setProjectServices(projectManager, projectMemoryService);

    // Initialize sub-agent bridge (Claude Cowork parity)
    subAgentBridge = new SubAgentBridge(sendToRenderer);
    void subAgentBridge.init();

    // Initialize orchestrator bridge for multi-agent workflows
    orchestratorBridge = new OrchestratorBridge(
      sendToRenderer,
      () => configStore.get('apiKey') || process.env.GROK_API_KEY || '',
      () => configStore.get('baseUrl') || process.env.GROK_BASE_URL
    );

    // Initialize fleet bridge — multi-host Code Buddy listener (GAP 3)
    fleetBridge = new FleetBridge(sendToRenderer);
    void fleetBridge.init();

    // Initialize team bridge — Phase 4 layer 9 (Agent Teams observability)
    teamBridge = new TeamBridge(sendToRenderer);
    void teamBridge.init();

    // Initialize A2A bridge with sendToRenderer so async task updates
    // (GAP 1 polling) can reach the renderer. Lazy `getA2ABridge()` calls
    // elsewhere will return this instance.
    {
      const { getA2ABridge: bootA2A } = await import('./a2a/a2a-bridge');
      bootA2A(sendToRenderer);
    }

    // Initialize mention processor (Claude Cowork parity)
    mentionProcessor = new MentionProcessor();
    sessionManager.setMentionProcessor(mentionProcessor);

    slashCommandBridge = new SlashCommandBridge();
    skillMdBridge = new SkillMdBridge();
    costBridge = new CostBridge(db);
    rulesBridge = new RulesBridge();
    sessionBranchingBridge = new SessionBranchingBridge();

    // MCP marketplace bridge — wired to the live config store + running manager.
    mcpMarketplaceBridge = new MCPMarketplaceBridge();
    mcpMarketplaceBridge.configure({
      listInstalledServers: () => mcpConfigStore.getServers(),
      saveServer: async (config) => {
        mcpConfigStore.saveServer(config as MCPServerConfig);
        const mgr = sessionManager?.getMCPManager();
        if (mgr) {
          try {
            await mgr.updateServer(config as MCPServerConfig);
            sessionManager?.invalidateMcpServersCache();
          } catch (err) {
            logError('[MCP Marketplace] updateServer failed:', err);
            mcpConfigStore.saveServer({
              ...(config as MCPServerConfig),
              enabled: false,
            });
            throw err;
          }
        }
      },
      deleteServer: async (serverId) => {
        mcpConfigStore.deleteServer(serverId);
        const mgr = sessionManager?.getMCPManager();
        if (mgr) {
          try {
            await mgr.removeServer(serverId);
            sessionManager?.invalidateMcpServersCache();
          } catch (err) {
            logError('[MCP Marketplace] removeServer failed:', err);
          }
        }
      },
      updateServer: async (config) => {
        mcpConfigStore.saveServer(config as MCPServerConfig);
        const mgr = sessionManager?.getMCPManager();
        if (mgr) {
          try {
            await mgr.updateServer(config as MCPServerConfig);
            sessionManager?.invalidateMcpServersCache();
          } catch (err) {
            logError('[MCP Marketplace] updateServer (toggle) failed:', err);
            throw err;
          }
        }
      },
      listTools: () => {
        const mgr = sessionManager?.getMCPManager();
        if (!mgr) return [];
        const tools = mgr.getTools();
        return tools.map(
          (t: {
            name: string;
            description?: string;
            serverId?: string;
            serverName?: string;
            inputSchema?: unknown;
          }) => ({
            name: t.name,
            description: t.description,
            serverId: t.serverId ?? '',
            serverName: t.serverName,
            inputSchema: t.inputSchema,
          })
        );
      },
      expandArgs: (args) => {
        // Expand {WORKSPACE} placeholder to the currently active project
        const activeProject = projectManager?.getActive();
        const workspace = activeProject?.workspacePath ?? process.cwd();
        return args.map((arg) => arg.replace(/\{WORKSPACE\}/g, workspace));
      },
      // Phase 3 step 7: MCP tool playground
      callTool: async (toolName: string, toolArgs: Record<string, unknown>) => {
        const mgr = sessionManager?.getMCPManager();
        if (!mgr) throw new Error('MCP manager not available');
        return mgr.callTool(toolName, toolArgs);
      },
    });

    // Initialize knowledge service (Claude Cowork parity)
    knowledgeService = new KnowledgeService();

    // Initialize presence bridge (face memory). Lazy-imported because the
    // chain of presence-bridge -> face-recognizer -> onnxruntime-node loads
    // a native binding we don't want eager on Cowork startup. The bridge
    // simply registers IPC handlers; encoder load is deferred to first call.
    const { getPresenceBridge } = await import('./presence/presence-bridge');
    const presenceBridge = getPresenceBridge();
    log('[main] PresenceBridge initialized — IPC handlers presence:* active');

    // Forward bridge events (detected/left/unknown/enrolled) to every
    // renderer window so the titlebar PresenceIndicator can show live
    // identity. The bridge already throttles via PRESENCE_DEDUP_WINDOW_MS
    // so we don't need to debounce here.
    presenceBridge.on('presence', (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('presence:event', event);
        }
      }
    });

    // Global search wires existing project services for cross-source queries.
    globalSearchService = new GlobalSearchService({
      db,
      projectManager,
      knowledgeService,
      projectMemoryService: projectMemoryServiceRef,
    });

    // File preview service — wraps core PDFTool, detects mime, returns text/image/binary.
    previewService = new PreviewService();

    // Project templates — wraps SKILL.md starter packs from the core registry.
    if (skillMdBridge) {
      templateService = new TemplateService(skillMdBridge);
    }

    // Workflow bridge — visual editor + execution.
    // The bridge needs `sendToRenderer` so it can stream `workflow.event`
    // and `workflow.approval_required` events back to the UI during a run.
    workflowBridge = new WorkflowBridge();
    workflowBridge.setSendToRenderer(sendToRenderer);

    // Session export — enhanced formats (markdown/json/html) with redaction
    const sessionInsightsSource = sessionManager;
    sessionExportService = new SessionExportService(sessionInsightsSource);
    sessionInsightsBridge = new SessionInsightsBridge({
      listSessions: () => sessionInsightsSource.listSessions(),
      getMessages: (sessionId: string) => sessionInsightsSource.getMessages(sessionId),
      getTraceSteps: (sessionId: string) => sessionInsightsSource.getTraceSteps(sessionId),
      replaceMessages: (sessionId: string, messages) =>
        sessionInsightsSource.replaceMessages(sessionId, messages),
    });

    // Activity feed — cross-project event log persisted in SQLite
    activityFeed = new ActivityFeed(db);

    // Phase 3 step 4: bookmarks service (starred messages)
    bookmarksService = new BookmarksService(db);

    // Config export/import — settings sync bundle
    configExportService = new ConfigExportService(projectManager);

    // Initialize notification bridge (Claude Cowork parity)
    notificationBridge = new NotificationBridge(sendToRenderer);
    void notificationBridge.init();
    sessionManager.setNotificationBridge(notificationBridge);

    // Initialize task dispatch for remote triggers (Claude Cowork parity)
    taskDispatch = new TaskDispatch(sessionManager, notificationBridge);

    // Initialize ICM cross-session memory integration (Claude Cowork parity)
    icmIntegration = new ICMIntegration();
    const icmIntegrationRef = icmIntegration;
    const sessionManagerRef = sessionManager;
    void (async () => {
      try {
        // Defer until MCP manager has had a chance to connect to servers
        const mcpMgr = (
          sessionManagerRef as unknown as {
            mcpManager?: {
              callTool?: (
                server: string,
                tool: string,
                args: Record<string, unknown>
              ) => Promise<unknown>;
              getConnectedServers?: () => string[];
            };
          }
        ).mcpManager;
        if (mcpMgr?.callTool && mcpMgr?.getConnectedServers) {
          const caller = {
            callTool: mcpMgr.callTool.bind(mcpMgr),
            getConnectedServers: mcpMgr.getConnectedServers.bind(mcpMgr),
          };
          const available = await icmIntegrationRef.initialize(caller);
          if (available) {
            sessionManagerRef.setICMIntegration(icmIntegrationRef);
            log('[Main] ICM cross-session memory wired');
          }
        }
      } catch (err) {
        logWarn('[Main] ICM integration setup failed:', err);
      }
    })();
    skillsManager = new SkillsManager(db, {
      getConfiguredGlobalSkillsPath: () => configStore.get('globalSkillsPath') || '',
      setConfiguredGlobalSkillsPath: (nextPath: string) => {
        configStore.update({ globalSkillsPath: nextPath });
      },
      watchStorage: true,
    });
    skillsManager.onStorageChanged((event) => {
      sendToRenderer({
        type: 'skills.storageChanged',
        payload: event,
      });
    });
    // pi-ai handles model routing natively — no proxy warmup needed

    // macOS: application menu, dock menu, tray icon
    buildMacMenu();
    if (!isE2E) {
      setupTray();
    }

    // Show window after core managers are ready so first-load actions can be handled.
    createWindow();

    // macOS: dock menu
    if (process.platform === 'darwin') {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: 'New Session',
          click: () => mainWindow?.webContents.send('server-event', { type: 'new-session' }),
        },
        {
          label: 'Settings',
          click: () =>
            mainWindow?.webContents.send('server-event', { type: 'navigate', payload: 'settings' }),
        },
      ]);
      app.dock?.setMenu(dockMenu);
    }

    // macOS: send initial system theme to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on('did-finish-load', () => {
        sendToRenderer({
          type: 'native-theme.changed',
          payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
        });
      });
    }

    // Listen for system theme changes
    nativeTheme.on('updated', () => {
      sendToRenderer({
        type: 'native-theme.changed',
        payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
      });
      if (getSavedThemePreference() === 'system' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
      }
    });

    // Auto-updater: check for updates in production
    if (!isDev && !isE2E) {
      import('electron-updater')
        .then(({ autoUpdater }) => {
          autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
            log('[AutoUpdater] Update check failed:', err);
          });
        })
        .catch((err: unknown) => {
          log('[AutoUpdater] Failed to load electron-updater:', err);
        });
    }

    if (!isE2E) {
      startNavServer(() => mainWindow);
    }

    const scheduledTaskStore = createScheduledTaskStore(db);
    scheduledTaskManager = new ScheduledTaskManager({
      store: scheduledTaskStore,
      executeTask: async (task) => {
        if (!sessionManager) {
          throw new Error('Session manager not initialized');
        }
        const unsupportedReason = getWorkspacePathUnsupportedReason(task.cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        const fallbackTitle = buildScheduledTaskFallbackTitle(task.prompt);
        const needsRegeneratedTitle = !task.title?.trim() || task.title === fallbackTitle;
        const title = needsRegeneratedTitle
          ? await resolveScheduledTaskTitle(task.prompt, task.cwd, task.title)
          : buildScheduledTaskTitle(task.title);
        if (title !== task.title) {
          scheduledTaskStore.update(task.id, { title });
        }
        const started = await sessionManager.startSession(title, task.prompt, task.cwd);
        // 定时任务创建的新会话需要主动同步到前端会话列表
        sendToRenderer({
          type: 'session.update',
          payload: { sessionId: started.id, updates: started },
        });
        return { sessionId: started.id };
      },
      onTaskError: (taskId, error) => {
        sendToRenderer({
          type: 'scheduled-task.error',
          payload: { taskId, error },
        });
      },
      now: () => Date.now(),
    });
    scheduledTaskManager.start();

    // 初始化远程管理器
    remoteManager.setRendererCallback(sendToRenderer);
    remoteManager.setPromptPreprocessor(async (prompt, sessionId) => {
      if (!prompt.trim().startsWith('/')) {
        return { allowed: true, prompt };
      }
      if (!slashCommandBridge) {
        return { allowed: false, message: 'Slash commands are unavailable in remote sessions.' };
      }
      return slashCommandBridge.executeRemoteInput(prompt, sessionId);
    });
    const agentExecutor: AgentExecutor = {
      startSession: async (title, prompt, cwd) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        return sessionManager.startSession(title, prompt, cwd);
      },
      continueSession: async (sessionId, prompt, content, cwd) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        if (cwd) {
          const result = await setWorkingDir(cwd, sessionId);
          if (!result.success) {
            throw new Error(result.error || 'Failed to update working directory');
          }
        }
        await sessionManager.continueSession(sessionId, prompt, content);
      },
      stopSession: async (sessionId) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        await sessionManager.stopSession(sessionId);
      },
      validateWorkingDirectory: async (cwd) => {
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          return unsupportedReason;
        }
        if (!fs.existsSync(cwd)) {
          return 'Directory does not exist';
        }
        return null;
      },
    };
    remoteManager.setAgentExecutor(agentExecutor);

    // 远程控制启用时启动
    if (remoteConfigStore.isEnabled()) {
      remoteManager.start().catch((error) => {
        logError('[App] Failed to start remote control:', error);
      });
    }

    app.on('activate', () => {
      const hasVisibleWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed());
      if (!hasVisibleWindow) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    logError('[App] Startup failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox('Open Cowork 启动失败', `${message}\n\n请查看日志获取更多信息。`);
    app.quit();
  });

// Flag to prevent double cleanup
let isCleaningUp = false;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

/**
 * Cleanup all sandbox resources
 * Called on app quit (both Windows and macOS)
 */
async function cleanupSandboxResources(): Promise<void> {
  if (isCleaningUp) {
    log('[App] Cleanup already in progress, skipping...');
    return;
  }
  isCleaningUp = true;

  stopNavServer();
  skillsManager?.stopStorageMonitoring();
  scheduledTaskManager?.stop();
  tray?.destroy();
  tray = null;

  // 停止远程控制
  try {
    log('[App] Stopping remote control...');
    await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');
    log('[App] Remote control stopped');
  } catch (error) {
    logError('[App] Error stopping remote control:', error);
  }

  // Cleanup all sandbox sessions (sync changes back to host OS first)
  try {
    log('[App] Cleaning up all sandbox sessions...');

    // Cleanup WSL sessions
    await withTimeout(SandboxSync.cleanupAllSessions(), 30000, 'WSL session cleanup');

    // Cleanup Lima sessions
    const { LimaSync } = await import('./sandbox/lima-sync');
    await withTimeout(LimaSync.cleanupAllSessions(), 30000, 'Lima session cleanup');

    log('[App] Sandbox sessions cleanup complete');
  } catch (error) {
    logError('[App] Error cleaning up sandbox sessions:', error);
  }

  // Shutdown sandbox adapter
  try {
    await withTimeout(shutdownSandbox(), 8000, 'Sandbox shutdown');
    log('[App] Sandbox shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down sandbox:', error);
  }

  // Shutdown MCP servers
  try {
    const mcpManager = sessionManager?.getMCPManager();
    if (mcpManager) {
      log('[App] Shutting down MCP servers...');
      await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');
      log('[App] MCP servers shutdown complete');
    }
  } catch (error) {
    logError('[App] Error shutting down MCP servers:', error);
  }

  try {
    closeDatabase();
  } catch (error) {
    logError('[App] Error closing database:', error);
  }

  closeLogFile();

  // pi-ai doesn't need proxy shutdown
}

// Handle app quit - window-all-closed (primary for Windows/Linux)
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin' || process.env.VITE_DEV_SERVER_URL) {
    // On Windows/Linux, closing all windows means quit.
    // On macOS dev mode, also quit — so vite-plugin-electron can restart cleanly
    // without the old process holding the single-instance lock.
    await cleanupSandboxResources();
    app.quit();
  }
  // On macOS production, keep app alive — cleanup happens in before-quit
});

// Handle SIGTERM/SIGINT (e.g. pkill) — route through app.quit() for clean shutdown
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => app.quit());
}

// Handle app quit - before-quit (for macOS Cmd+Q and other quit methods)
app.on('before-quit', async (event) => {
  if (!isCleaningUp) {
    // In dev mode, exit quickly — no need for async sandbox cleanup
    if (process.env.VITE_DEV_SERVER_URL) {
      stopNavServer();
      try {
        closeDatabase();
      } catch {
        /* best-effort */
      }
      closeLogFile();
      tray?.destroy();
      tray = null;
      return;
    }
    // Set the flag immediately before any await to prevent re-entrant cleanup
    isCleaningUp = true;
    event.preventDefault();
    try {
      await cleanupSandboxResources();
    } catch (error) {
      logError('[App] before-quit cleanup failed, forcing quit:', error);
    }
    app.quit();
  }
});

// IPC Handlers
ipcMain.on('client-event', async (_event, data: ClientEvent) => {
  try {
    await handleClientEvent(data);
  } catch (error) {
    logError('Error handling client event:', error);
    sendToRenderer({
      type: 'error',
      payload: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

ipcMain.handle('client-invoke', async (_event, data: ClientEvent) => {
  return handleClientEvent(data);
});

ipcMain.handle('get-version', () => {
  try {
    return app.getVersion();
  } catch (error) {
    logError('[IPC] Error getting version:', error);
    return 'unknown';
  }
});

// ── Checkpoint IPC handlers ────────────────────────────────────────────
ipcMain.handle('checkpoint.list', async () => {
  try {
    const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
    if (!enginePath) return null;
    const { getGhostSnapshotManager } = await import(
      /* webpackIgnore: true */ resolve(enginePath, 'checkpoints', 'ghost-snapshot.js')
    );
    const gsm = getGhostSnapshotManager();
    return gsm.getTimeline();
  } catch {
    return null;
  }
});

ipcMain.handle('checkpoint.undo', async () => {
  try {
    const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
    if (!enginePath) return null;
    const { getGhostSnapshotManager } = await import(
      /* webpackIgnore: true */ resolve(enginePath, 'checkpoints', 'ghost-snapshot.js')
    );
    const gsm = getGhostSnapshotManager();
    return await gsm.undoLastTurn();
  } catch {
    return null;
  }
});

ipcMain.handle('checkpoint.redo', async () => {
  try {
    const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
    if (!enginePath) return null;
    const { getGhostSnapshotManager } = await import(
      /* webpackIgnore: true */ resolve(enginePath, 'checkpoints', 'ghost-snapshot.js')
    );
    const gsm = getGhostSnapshotManager();
    return await gsm.redoLastTurn();
  } catch {
    return null;
  }
});

ipcMain.handle('checkpoint.restore', async (_event, snapshotId: string) => {
  try {
    const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
    if (!enginePath) return null;
    const { getGhostSnapshotManager } = await import(
      /* webpackIgnore: true */ resolve(enginePath, 'checkpoints', 'ghost-snapshot.js')
    );
    const gsm = getGhostSnapshotManager();
    return await gsm.restoreSnapshot(snapshotId);
  } catch {
    return null;
  }
});

ipcMain.handle(
  'checkpoint.compare',
  async (_event, cwd: string, fromCommit: string, toCommit: string) => {
    try {
      if (!cwd || !fromCommit || !toCommit) return [];
      return getGitBridge().compareCommits(cwd, fromCommit, toCommit);
    } catch (err) {
      logError('[checkpoint.compare] failed:', err);
      return [];
    }
  }
);

// ── Workspace IPC handlers ────────────────────────────────────────────
ipcMain.handle('workspace.readDir', async (_event, dirPath: string) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: resolve(dirPath, e.name),
      }));
  } catch {
    return [];
  }
});

// ── Permission mode IPC handler ───────────────────────────────────────
ipcMain.handle('permission.setMode', async (_event, mode: string) => {
  try {
    const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
    if (!enginePath) return;
    const { getPermissionModeManager } = await import(
      /* webpackIgnore: true */ resolve(enginePath, 'security', 'permission-modes.js')
    );
    getPermissionModeManager().setMode(mode);
    log('[IPC] Permission mode set to:', mode);
  } catch {
    /* ignore */
  }
});

// ── Model switch IPC handler ──────────────────────────────────────────
ipcMain.handle('config.switchModel', async (_event, model: string) => {
  try {
    configStore.update({ model });
    log('[IPC] Model switched to:', model);
    return true;
  } catch {
    return false;
  }
});

// ── Gemini OAuth IPC handlers ─────────────────────────────────────────
ipcMain.handle('config.geminiOauthLogin', async () => {
  try {
    const tokens = await getGeminiOauthTokens(true);
    return { success: true, tokens };
  } catch (err: any) {
    logError('[IPC] Gemini OAuth Login failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config.geminiOauthClear', async () => {
  try {
    await clearGeminiCredentials();
    return { success: true };
  } catch (err: any) {
    logError('[IPC] Gemini OAuth Clear failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config.codexOauthLogin', async () => {
  try {
    const auth = await codexLoginInteractive();
    return {
      success: true,
      email: auth.email ?? null,
      plan_type: auth.plan_type ?? null,
      account_id: auth.account_id ?? null,
      is_fedramp: auth.is_fedramp,
    };
  } catch (err: any) {
    logError('[IPC] Codex OAuth Login failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config.codexOauthClear', async () => {
  try {
    clearCodexCredentials();
    return { success: true };
  } catch (err: any) {
    logError('[IPC] Codex OAuth Clear failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config.codexOauthStatus', async () => {
  try {
    if (!hasCodexCredentials()) {
      return { success: true, signedIn: false };
    }
    const auth = await getChatGptAuth();
    if (!auth) {
      return { success: true, signedIn: false, error: 'credentials present but unreadable' };
    }
    return {
      success: true,
      signedIn: true,
      email: auth.email ?? null,
      plan_type: auth.plan_type ?? null,
      account_id: auth.account_id ?? null,
      is_fedramp: auth.is_fedramp,
    };
  } catch (err: any) {
    logError('[IPC] Codex OAuth Status failed:', err);
    return { success: false, error: err.message };
  }
});

// ── Project IPC handlers (Claude Cowork parity) ──────────────────────
registerProjectIpcHandlers(projectManager, activityFeed);

// ── Sub-agent IPC handlers (Claude Cowork parity) ────────────────────
registerSubAgentIpcHandlers(subAgentBridge);

// ── Orchestrator IPC handlers ────────────────────────────────────────
registerOrchestratorIpcHandlers(orchestratorBridge);

// ── Fleet IPC handlers (GAP 3 — multi-host Code Buddy listener) ──────
registerFleetIpcHandlers(fleetBridge);

// ── Team IPC handlers (Phase 4 layer 9 — Agent Teams observability) ──
registerTeamIpcHandlers(teamBridge);

// ── Mention IPC handlers (Claude Cowork parity) ──────────────────────
registerMentionIpcHandlers(mentionProcessor);

// ── Slash command IPC handlers (Claude Cowork parity Phase 2) ────────
registerCommandIpcHandlers(slashCommandBridge);

// ── SKILL.md bridge IPC handlers (Claude Cowork parity Phase 2) ─────
registerSkillMdIpcHandlers(skillMdBridge);

// ── Knowledge IPC handlers (Claude Cowork parity) ────────────────────
registerKnowledgeIpcHandlers(knowledgeService, projectManager);

// ── Task dispatch IPC (mobile/remote → background session) ───────────
ipcMain.handle('dispatch.task', async (_event, request: DispatchRequest) => {
  if (!taskDispatch) return { success: false, error: 'TaskDispatch not initialized' };
  const validation = taskDispatch.validate(request);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }
  return taskDispatch.dispatch(request);
});

// ── Session settings update IPC (Claude Cowork parity) ──────────────
ipcMain.handle(
  'session.updateSettings',
  async (
    _event,
    sessionId: string,
    updates: {
      projectId?: string | null;
      executionMode?: 'chat' | 'task';
      isBackground?: boolean;
      title?: string;
    }
  ) => {
    if (!sessionManager) return false;
    return sessionManager.updateSessionSettings(sessionId, updates);
  }
);

// ── Background session IPC (Claude Cowork parity) ────────────────────
ipcMain.handle(
  'session.startBackground',
  async (
    _event,
    payload: {
      title: string;
      prompt: string;
      cwd?: string;
      projectId?: string;
    }
  ) => {
    if (!sessionManager) throw new Error('SessionManager not initialized');
    const session = await sessionManager.startBackgroundSession(
      payload.title,
      payload.prompt,
      payload.cwd,
      payload.projectId
    );
    return session;
  }
);

// ── Memory listing for MemoryBrowser (Claude Cowork parity) ──────────
ipcMain.handle('memory.list', async (_event, projectId?: string) => {
  if (!projectManager || !projectMemoryServiceRef) return [];
  const id = projectId ?? projectManager.getActiveId();
  if (!id) return [];
  return projectMemoryServiceRef.listMemoryEntries(id);
});

// Phase 2 step 17: memory CRUD for inline editor
ipcMain.handle(
  'memory.add',
  async (
    _event,
    category: 'preference' | 'pattern' | 'context' | 'decision',
    content: string,
    projectId?: string
  ) => {
    if (!projectManager || !projectMemoryServiceRef) {
      return { success: false, error: 'Memory service unavailable' };
    }
    const id = projectId ?? projectManager.getActiveId();
    if (!id) return { success: false, error: 'No active project' };
    return projectMemoryServiceRef.addMemoryEntry(id, category, content);
  }
);

ipcMain.handle(
  'memory.update',
  async (
    _event,
    entryIndex: number,
    newContent: string,
    newCategory?: 'preference' | 'pattern' | 'context' | 'decision',
    projectId?: string
  ) => {
    if (!projectManager || !projectMemoryServiceRef) {
      return { success: false, error: 'Memory service unavailable' };
    }
    const id = projectId ?? projectManager.getActiveId();
    if (!id) return { success: false, error: 'No active project' };
    return projectMemoryServiceRef.updateMemoryEntry(id, entryIndex, newContent, newCategory);
  }
);

ipcMain.handle('memory.delete', async (_event, entryIndex: number, projectId?: string) => {
  if (!projectManager || !projectMemoryServiceRef) {
    return { success: false, error: 'Memory service unavailable' };
  }
  const id = projectId ?? projectManager.getActiveId();
  if (!id) return { success: false, error: 'No active project' };
  return projectMemoryServiceRef.deleteMemoryEntry(id, entryIndex);
});

// ── Session export IPC handler ────────────────────────────────────────
ipcMain.handle('session.export', async (_event, sessionId: string, format: 'md' | 'json') => {
  try {
    if (!sessionManager) return null;
    const messages = (
      sessionManager as unknown as { getMessages?: (id: string) => unknown[] }
    ).getMessages?.(sessionId);
    return { messages, format };
  } catch {
    return null;
  }
});

// Phase 2 step 16: enhanced session export with format/redaction options
ipcMain.handle(
  'session.exportFull',
  async (
    _event,
    sessionId: string,
    options: {
      format: 'markdown' | 'json' | 'html';
      redactSecrets?: boolean;
      includeCheckpoints?: boolean;
    }
  ) => {
    if (!sessionExportService) {
      return { success: false, content: '', filename: '', error: 'Export service unavailable' };
    }
    return sessionExportService.exportSession(sessionId, options);
  }
);

ipcMain.handle(
  'session.exportToFile',
  async (
    _event,
    sessionId: string,
    options: {
      format: 'markdown' | 'json' | 'html';
      redactSecrets?: boolean;
      includeCheckpoints?: boolean;
    }
  ) => {
    if (!sessionExportService) {
      return { success: false, error: 'Export service unavailable' };
    }
    const result = sessionExportService.exportSession(sessionId, options);
    if (!result.success) return { success: false, error: result.error };
    const dialogResult = await dialog.showSaveDialog({
      title: 'Export session',
      defaultPath: result.filename,
      filters: [
        options.format === 'markdown'
          ? { name: 'Markdown', extensions: ['md'] }
          : options.format === 'html'
            ? { name: 'HTML', extensions: ['html'] }
            : { name: 'JSON', extensions: ['json'] },
      ],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, error: 'Cancelled' };
    }
    const writeResult = sessionExportService.saveToFile(dialogResult.filePath, result.content);
    return { success: writeResult.success, error: writeResult.error, path: dialogResult.filePath };
  }
);

ipcMain.handle('system.getTheme', () => {
  try {
    return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
  } catch (error) {
    logError('[IPC] Error getting theme:', error);
    return { shouldUseDarkColors: true };
  }
});

ipcMain.handle('shell.openExternal', async (_event, url: string) => {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      logWarn('[shell.openExternal] Blocked URL with disallowed protocol:', parsed.protocol);
      return false;
    }
  } catch {
    logWarn('[shell.openExternal] Blocked invalid URL:', url);
    return false;
  }

  return shell.openExternal(url);
});

async function revealFileInFolder(filePath: string, cwd?: string): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  const trimInput = filePath.trim();
  if (!trimInput) {
    return false;
  }

  let normalizedPath = decodePathSafely(trimInput);

  if (normalizedPath.startsWith('file://')) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      logWarn('[shell.showItemInFolder] could not parse file URL:', normalizedPath);
      return false;
    }
    normalizedPath = localPath;
  }

  const baseDir = cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath('home');
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    normalizedPath = resolve(baseDir, normalizedPath);
  }

  if (
    normalizedPath.startsWith('/workspace/') ||
    /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
  ) {
    const relativePart = normalizedPath.startsWith('/workspace/')
      ? normalizedPath.slice('/workspace/'.length)
      : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
    normalizedPath = resolve(baseDir, relativePart);
  }

  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }
  log('[shell.showItemInFolder] request:', { filePath, cwd, resolved: normalizedPath });

  const findFileByName = (fileName: string, roots: string[]): string | null => {
    if (!fileName) {
      return null;
    }

    const visited = new Set<string>();
    const queue = roots
      .map((root) => resolve(root))
      .filter((root) => !!root && fs.existsSync(root) && fs.statSync(root).isDirectory());

    let scannedDirs = 0;
    const MAX_DIRS = 2000;

    while (queue.length > 0 && scannedDirs < MAX_DIRS) {
      const dir = queue.shift()!;
      if (visited.has(dir)) {
        continue;
      }
      visited.add(dir);
      scannedDirs += 1;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
          return fullPath;
        }
        if (entry.isDirectory()) {
          queue.push(fullPath);
        }
      }
    }

    return null;
  };

  try {
    if (fs.existsSync(normalizedPath)) {
      const stat = fs.statSync(normalizedPath);
      if (stat.isDirectory()) {
        const openDirResult = await shell.openPath(normalizedPath);
        if (openDirResult) {
          logWarn('[shell.showItemInFolder] openPath returned warning:', openDirResult);
        }
      } else {
        if (process.platform === 'darwin') {
          try {
            execFileSync('open', ['-R', normalizedPath]);
          } catch (error) {
            logWarn(
              '[shell.showItemInFolder] open -R failed, fallback to shell.showItemInFolder:',
              error
            );
            shell.showItemInFolder(normalizedPath);
          }
        } else {
          shell.showItemInFolder(normalizedPath);
        }
      }
      return true;
    }

    const fileName = basename(normalizedPath);
    const defaultWorkingDir = getWorkingDir() || '';
    const discoveredPath = findFileByName(fileName, [
      cwd || '',
      defaultWorkingDir,
      join(app.getPath('userData'), 'default_working_dir'),
    ]);

    if (discoveredPath) {
      logWarn('[shell.showItemInFolder] resolved path not found, discovered by filename:', {
        requested: normalizedPath,
        discoveredPath,
      });
      if (process.platform === 'darwin') {
        try {
          execFileSync('open', ['-R', discoveredPath]);
        } catch (error) {
          logWarn(
            '[shell.showItemInFolder] open -R discovered file failed, fallback to shell.showItemInFolder:',
            error
          );
          shell.showItemInFolder(discoveredPath);
        }
      } else {
        shell.showItemInFolder(discoveredPath);
      }
      return true;
    }

    const parentDir = dirname(normalizedPath);
    if (parentDir && fs.existsSync(parentDir)) {
      logWarn('[shell.showItemInFolder] file not found, opening parent directory:', parentDir);
      const openParentResult = await shell.openPath(parentDir);
      if (openParentResult) {
        logWarn('[shell.showItemInFolder] openPath parent returned warning:', openParentResult);
      }
      return true;
    }

    logWarn('[shell.showItemInFolder] path and parent directory do not exist:', normalizedPath);
    return false;
  } catch (error) {
    logError('[shell.showItemInFolder] failed:', error);
    return false;
  }
}

ipcMain.handle('shell.showItemInFolder', async (_event, filePath: string, cwd?: string) => {
  return revealFileInFolder(filePath, cwd);
});

ipcMain.handle(
  'artifacts.listRecentFiles',
  async (_event, cwd: string, sinceMs: number, limit: number = 50) => {
    if (!cwd || !isAbsolute(cwd)) {
      return [];
    }
    return listRecentWorkspaceFiles(cwd, sinceMs, limit);
  }
);

ipcMain.handle('dialog.selectFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files',
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

// Config IPC handlers
ipcMain.handle('config.get', () => {
  try {
    return configStore.getAll();
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

const buildAgentRuntimeSignature = (config: AppConfig): string =>
  JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    enableThinking: config.enableThinking,
  });

const syncConfigAfterMutation = async (previousConfig: AppConfig) => {
  // Mark as configured if any config set has usable credentials
  configStore.set('isConfigured', configStore.hasAnyUsableCredentials());

  // Apply to environment
  configStore.applyToEnv();

  const updatedConfig = configStore.getAll();
  const shouldReloadRunner =
    buildAgentRuntimeSignature(previousConfig) !== buildAgentRuntimeSignature(updatedConfig);
  const shouldReloadSandbox = previousConfig.sandboxEnabled !== updatedConfig.sandboxEnabled;

  if (sessionManager) {
    if (shouldReloadRunner) {
      sessionManager.reloadConfig();
    }
    if (shouldReloadSandbox) {
      await sessionManager
        .reloadSandbox()
        .catch((err) => logError('[Config] Sandbox reload failed:', err));
    }
    if (shouldReloadRunner || shouldReloadSandbox) {
      log(
        '[Config] Session manager config synced:',
        JSON.stringify({ runnerReloaded: shouldReloadRunner, sandboxReloaded: shouldReloadSandbox })
      );
    }
  }

  // Notify renderer of config update
  const isConfigured = configStore.isConfigured();
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured,
      config: updatedConfig,
    },
  });
  log('[Config] Notified renderer of config update, isConfigured:', isConfigured);
  return updatedConfig;
};

ipcMain.handle('config.save', async (_event, newConfig: Partial<AppConfig>) => {
  log('[Config] Saving config:', { ...newConfig, apiKey: newConfig.apiKey ? '***' : '' });

  const previousConfig = configStore.getAll();
  // Update config
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
    payload: { provider: AppConfig['provider']; apiKey: string; baseUrl?: string }
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
    const { runDiagnostics } = await import('./config/api-diagnostics');
    return await runDiagnostics(payload);
  } catch (error) {
    logError('[Config] Error running diagnostics:', error);
    throw error;
  }
});

ipcMain.handle('config.discover-local', async (_event, payload?: { baseUrl?: string }) => {
  try {
    const { discoverLocalOllama } = await import('./config/api-diagnostics');
    return await discoverLocalOllama(payload);
  } catch (error) {
    logError('[Config] Error discovering local services:', error);
    return [];
  }
});

ipcMain.handle('config.discover-lmstudio-local', async (_event, payload?: { baseUrl?: string }) => {
  try {
    const { discoverLocalLmStudio } = await import('./config/api-diagnostics');
    return await discoverLocalLmStudio(payload);
  } catch (error) {
    logError('[Config] Error discovering local LM Studio:', error);
    return { available: false, baseUrl: payload?.baseUrl || 'http://localhost:1234/v1', status: 'unavailable' };
  }
});

// MCP Server IPC handlers
ipcMain.handle('mcp.getServers', () => {
  try {
    return mcpConfigStore.getServers();
  } catch (error) {
    logError('[MCP] Error getting servers:', error);
    return [];
  }
});

ipcMain.handle('mcp.getServer', (_event, serverId: string) => {
  try {
    return mcpConfigStore.getServer(serverId);
  } catch (error) {
    logError('[MCP] Error getting server:', error);
    return null;
  }
});

ipcMain.handle('mcp.saveServer', async (_event, config: MCPServerConfig) => {
  mcpConfigStore.saveServer(config);
  // Update only this specific server, not all servers
  if (sessionManager) {
    const mcpManager = sessionManager.getMCPManager();
    try {
      await mcpManager.updateServer(config);
      sessionManager.invalidateMcpServersCache();
      log(`[MCP] Server ${config.name} updated successfully`);
    } catch (err) {
      logError('[MCP] Failed to update server:', err);
      // Roll back: save the config with enabled=false so a broken connector
      // is not retried on next app startup
      if (config.enabled) {
        mcpConfigStore.saveServer({ ...config, enabled: false });
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    }
  }
  return { success: true };
});

ipcMain.handle('mcp.deleteServer', async (_event, serverId: string) => {
  mcpConfigStore.deleteServer(serverId);
  // Remove and disconnect only this specific server
  if (sessionManager) {
    const mcpManager = sessionManager.getMCPManager();
    try {
      await mcpManager.removeServer(serverId);
      sessionManager.invalidateMcpServersCache();
      log(`[MCP] Server ${serverId} removed successfully`);
    } catch (err) {
      logError('[MCP] Failed to remove server:', err);
    }
  }
  return { success: true };
});

ipcMain.handle('mcp.getTools', () => {
  try {
    if (!sessionManager) {
      return [];
    }
    const mcpManager = sessionManager.getMCPManager();
    return mcpManager.getTools();
  } catch (error) {
    logError('[MCP] Error getting tools:', error);
    return [];
  }
});

ipcMain.handle('mcp.getServerStatus', () => {
  try {
    if (!sessionManager) {
      return [];
    }
    const mcpManager = sessionManager.getMCPManager();
    return mcpManager.getServerStatus();
  } catch (error) {
    logError('[MCP] Error getting server status:', error);
    return [];
  }
});

ipcMain.handle('mcp.getPresets', () => {
  try {
    return mcpConfigStore.getPresets();
  } catch (error) {
    logError('[MCP] Error getting presets:', error);
    return {};
  }
});

// ── MCP marketplace IPC handlers (Claude Cowork parity Phase 2) ─────
ipcMain.handle('mcp.registry', () => {
  if (!mcpMarketplaceBridge) return [];
  return mcpMarketplaceBridge.list();
});

ipcMain.handle('mcp.registrySearch', (_event, query: string) => {
  if (!mcpMarketplaceBridge) return [];
  return mcpMarketplaceBridge.search(query);
});

ipcMain.handle('mcp.registryGet', (_event, id: string) => {
  if (!mcpMarketplaceBridge) return null;
  return mcpMarketplaceBridge.get(id);
});

ipcMain.handle(
  'mcp.registryInstall',
  async (_event, id: string, envOverrides?: Record<string, string>) => {
    if (!mcpMarketplaceBridge) {
      return { success: false, error: 'Marketplace bridge unavailable' };
    }
    return mcpMarketplaceBridge.install(id, envOverrides);
  }
);

ipcMain.handle('mcp.registryUninstall', async (_event, id: string) => {
  if (!mcpMarketplaceBridge) {
    return { success: false, error: 'Marketplace bridge unavailable' };
  }
  return mcpMarketplaceBridge.uninstall(id);
});

ipcMain.handle('mcp.registrySetEnabled', async (_event, id: string, enabled: boolean) => {
  if (!mcpMarketplaceBridge) {
    return { success: false, error: 'Marketplace bridge unavailable' };
  }
  return mcpMarketplaceBridge.setEnabled(id, enabled);
});

ipcMain.handle('mcp.registryTools', (_event, id: string) => {
  if (!mcpMarketplaceBridge) return [];
  return mcpMarketplaceBridge.getTools(id);
});

// Phase 3 step 7: MCP tool playground
ipcMain.handle('mcp.listAllTools', () => {
  try {
    if (!mcpMarketplaceBridge) return [];
    return mcpMarketplaceBridge.listAllTools();
  } catch (err) {
    logError('[mcp.listAllTools] failed:', err);
    return [];
  }
});

ipcMain.handle(
  'mcp.invokeTool',
  async (_event, toolName: string, args: Record<string, unknown>) => {
    try {
      if (!mcpMarketplaceBridge) {
        return {
          success: false,
          durationMs: 0,
          error: 'MCP marketplace bridge not ready',
        };
      }
      return await mcpMarketplaceBridge.invokeTool(toolName, args ?? {});
    } catch (err) {
      logError('[mcp.invokeTool] failed:', err);
      return {
        success: false,
        durationMs: 0,
        error: (err as Error).message,
      };
    }
  }
);

// ── Cost dashboard IPC handlers (Claude Cowork parity Phase 2) ──────
ipcMain.handle('cost.summary', async () => {
  if (!costBridge) {
    return {
      sessionCost: 0,
      dailyCost: 0,
      weeklyCost: 0,
      monthlyCost: 0,
      totalCost: 0,
      sessionTokens: { input: 0, output: 0 },
      modelBreakdown: {},
    };
  }
  return costBridge.getSummary();
});

ipcMain.handle('cost.history', (_event, days?: number) => {
  if (!costBridge) return [];
  return costBridge.getDailyHistory(days);
});

ipcMain.handle('cost.modelBreakdown', (_event, days?: number) => {
  if (!costBridge) return [];
  return costBridge.getModelBreakdown(days);
});

ipcMain.handle('cost.setBudget', async (_event, monthlyLimit: number) => {
  if (!costBridge) return { success: false };
  await costBridge.setBudget(monthlyLimit);
  return { success: true };
});

ipcMain.handle('cost.setDailyLimit', async (_event, limit: number) => {
  if (!costBridge) return { success: false };
  await costBridge.setDailyLimit(limit);
  return { success: true };
});

ipcMain.handle(
  'cost.record',
  async (_event, inputTokens: number, outputTokens: number, model: string, cost?: number) => {
    if (!costBridge) return { success: false };
    await costBridge.record(inputTokens, outputTokens, model, cost);
    return { success: true };
  }
);

// ── Rules editor IPC handlers (Claude Cowork parity Phase 2) ────────
function resolveRulesWorkspace(projectId?: string): string {
  if (projectManager) {
    const project = projectId ? projectManager.get(projectId) : projectManager.getActive();
    if (project?.workspacePath) return project.workspacePath;
  }
  return process.cwd();
}

ipcMain.handle('rules.list', async (_event, projectId?: string) => {
  if (!rulesBridge) return { allow: [], deny: [] };
  return rulesBridge.list(resolveRulesWorkspace(projectId));
});

ipcMain.handle(
  'rules.add',
  async (_event, bucket: 'allow' | 'deny', rule: string, projectId?: string) => {
    if (!rulesBridge) {
      return { success: false, error: 'Rules bridge unavailable' };
    }
    return rulesBridge.add(resolveRulesWorkspace(projectId), bucket, rule);
  }
);

ipcMain.handle(
  'rules.remove',
  async (_event, bucket: 'allow' | 'deny', rule: string, projectId?: string) => {
    if (!rulesBridge) {
      return { success: false, error: 'Rules bridge unavailable' };
    }
    return rulesBridge.remove(resolveRulesWorkspace(projectId), bucket, rule);
  }
);

ipcMain.handle(
  'rules.update',
  async (
    _event,
    bucket: 'allow' | 'deny',
    oldRule: string,
    newRule: string,
    projectId?: string
  ) => {
    if (!rulesBridge) {
      return { success: false, error: 'Rules bridge unavailable' };
    }
    return rulesBridge.update(resolveRulesWorkspace(projectId), bucket, oldRule, newRule);
  }
);

ipcMain.handle(
  'rules.test',
  async (_event, toolName: string, toolArgs: Record<string, unknown>, projectId?: string) => {
    if (!rulesBridge) return { decision: 'ask' as const };
    return rulesBridge.test(resolveRulesWorkspace(projectId), toolName, toolArgs);
  }
);

// ── Session branching IPC handlers (Claude Cowork parity Phase 2) ──
ipcMain.handle('session.branches', async (_event, sessionId: string) => {
  if (!sessionBranchingBridge) return [];
  return sessionBranchingBridge.listBranches(sessionId);
});

ipcMain.handle(
  'session.fork',
  async (_event, sessionId: string, name: string, fromMessageIndex?: number) => {
    if (!sessionBranchingBridge) {
      return { success: false, error: 'Branching bridge unavailable' };
    }
    return sessionBranchingBridge.fork(sessionId, name, fromMessageIndex);
  }
);

ipcMain.handle('session.checkout', async (_event, sessionId: string, branchId: string) => {
  if (!sessionBranchingBridge) {
    return { success: false, error: 'Branching bridge unavailable' };
  }
  return sessionBranchingBridge.checkout(sessionId, branchId);
});

ipcMain.handle(
  'session.mergeBranch',
  async (_event, sessionId: string, sourceBranchId: string, strategy?: 'append' | 'replace') => {
    if (!sessionBranchingBridge) {
      return { success: false, error: 'Branching bridge unavailable' };
    }
    return sessionBranchingBridge.mergeBranch(sessionId, sourceBranchId, strategy);
  }
);

ipcMain.handle('session.deleteBranch', async (_event, sessionId: string, branchId: string) => {
  if (!sessionBranchingBridge) {
    return { success: false, error: 'Branching bridge unavailable' };
  }
  return sessionBranchingBridge.deleteBranch(sessionId, branchId);
});

ipcMain.handle(
  'session.renameBranch',
  async (_event, sessionId: string, branchId: string, newName: string) => {
    if (!sessionBranchingBridge) {
      return { success: false, error: 'Branching bridge unavailable' };
    }
    return sessionBranchingBridge.renameBranch(sessionId, branchId, newName);
  }
);

// Config export/import — Claude Cowork parity Phase 2 step 19
ipcMain.handle('config.export', async () => {
  if (!configExportService) {
    return { success: false, error: 'Export service unavailable' };
  }
  try {
    const bundle = configExportService.exportBundle();
    return { success: true, bundle };
  } catch (err) {
    logError('[config.export] failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('config.exportToFile', async () => {
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
    if (!configExportService) {
      return {
        success: false,
        imported: { projects: 0, mcpServers: 0, apiUpdated: false },
        errors: ['Export service unavailable'],
      };
    }
    return configExportService.importBundle(bundle as never, strategy);
  }
);

// Activity feed — Claude Cowork parity Phase 2 step 18
ipcMain.handle('activity.recent', async (_event, limit?: number, projectId?: string) => {
  if (!activityFeed) return [];
  return activityFeed.recent(limit ?? 100, projectId);
});

ipcMain.handle('activity.clear', async () => {
  if (!activityFeed) return { success: false };
  activityFeed.clear();
  return { success: true };
});

ipcMain.handle('sessionInsights.list', async (_event, limit?: number) => {
  try {
    return sessionInsightsBridge?.list(limit ?? 100) ?? [];
  } catch (err) {
    logError('[sessionInsights.list] failed:', err);
    return [];
  }
});

ipcMain.handle('sessionInsights.search', async (_event, query: string, limit?: number) => {
  try {
    return sessionInsightsBridge?.search(query ?? '', limit ?? 50) ?? [];
  } catch (err) {
    logError('[sessionInsights.search] failed:', err);
    return [];
  }
});

ipcMain.handle('sessionInsights.detail', async (_event, sessionId: string) => {
  try {
    return sessionInsightsBridge?.getDetail(sessionId) ?? null;
  } catch (err) {
    logError('[sessionInsights.detail] failed:', err);
    return null;
  }
});

ipcMain.handle('sessionInsights.audit', async (_event, sessionId: string) => {
  try {
    return sessionInsightsBridge?.getAudit(sessionId) ?? null;
  } catch (err) {
    logError('[sessionInsights.audit] failed:', err);
    return null;
  }
});

ipcMain.handle('sessionInsights.repair', async (_event, sessionId: string) => {
  try {
    return sessionInsightsBridge?.repair(sessionId) ?? null;
  } catch (err) {
    logError('[sessionInsights.repair] failed:', err);
    return null;
  }
});

// Workflow editor — Claude Cowork parity Phase 2 step 15
ipcMain.handle('workflow.list', async () => {
  if (!workflowBridge) return [];
  try {
    return workflowBridge.list();
  } catch (err) {
    logError('[workflow.list] failed:', err);
    return [];
  }
});

ipcMain.handle('workflow.get', async (_event, id: string) => {
  if (!workflowBridge) return null;
  return workflowBridge.get(id);
});

ipcMain.handle(
  'workflow.create',
  async (
    _event,
    input: {
      name: string;
      description?: string;
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    }
  ) => {
    if (!workflowBridge) return null;
    try {
      return workflowBridge.create({
        name: input.name,
        description: input.description,
        nodes: input.nodes as never,
        edges: input.edges as never,
      });
    } catch (err) {
      logError('[workflow.create] failed:', err);
      return null;
    }
  }
);

ipcMain.handle('workflow.update', async (_event, id: string, patch: Record<string, unknown>) => {
  if (!workflowBridge) return null;
  return workflowBridge.update(id, patch as never);
});

ipcMain.handle('workflow.delete', async (_event, id: string) => {
  if (!workflowBridge) return false;
  return workflowBridge.delete(id);
});

ipcMain.handle(
  'workflow.run',
  async (_event, id: string, initialContext?: Record<string, unknown>) => {
    if (!workflowBridge) {
      return {
        success: false,
        status: 'failed',
        duration: 0,
        completedSteps: 0,
        totalSteps: 0,
        error: 'Workflow bridge unavailable',
      };
    }
    return workflowBridge.run(id, initialContext ?? {});
  }
);

ipcMain.handle(
  'workflow.approve',
  async (_event, stepId: string, approved: boolean): Promise<boolean> => {
    if (!workflowBridge) return false;
    return workflowBridge.approveStep(stepId, approved);
  }
);

// Project templates — Claude Cowork parity Phase 2 step 12
ipcMain.handle('template.list', async () => {
  if (!templateService) return [];
  try {
    return await templateService.list();
  } catch (err) {
    logError('[template.list] failed:', err);
    return [];
  }
});

ipcMain.handle('template.preview', async (_event, name: string) => {
  if (!templateService) return null;
  try {
    return await templateService.preview(name);
  } catch (err) {
    logError('[template.preview] failed:', err);
    return null;
  }
});

ipcMain.handle('template.create', async (_event, name: string, workspaceRoot: string) => {
  if (!templateService) {
    return { success: false, error: 'Template service unavailable' };
  }
  try {
    return await templateService.apply(name, workspaceRoot);
  } catch (err) {
    logError('[template.create] failed:', err);
    return {
      success: false,
      error: (err as Error).message ?? 'Template execution failed',
    };
  }
});

// File preview pane — Claude Cowork parity Phase 2 step 9
ipcMain.handle('preview.get', async (_event, filePath: string) => {
  if (!previewService) {
    return {
      kind: 'error',
      path: filePath,
      name: filePath,
      size: 0,
      mime: 'application/octet-stream',
      error: 'Preview service not ready',
    };
  }
  try {
    return await previewService.getPreview(filePath);
  } catch (err) {
    logError('[preview.get] failed:', err);
    return {
      kind: 'error',
      path: filePath,
      name: filePath,
      size: 0,
      mime: 'application/octet-stream',
      error: (err as Error).message ?? 'Unknown error',
    };
  }
});

// Workspace presets — Claude Cowork parity Phase 3 step 9
ipcMain.handle('workspacePresets.list', async () => {
  try {
    return getWorkspacePresetsService().list();
  } catch (err) {
    logError('[workspacePresets.list] failed:', err);
    return [];
  }
});

ipcMain.handle(
  'workspacePresets.save',
  async (
    _event,
    preset: Omit<WorkspacePreset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => {
    try {
      return getWorkspacePresetsService().save(preset);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
);

ipcMain.handle('workspacePresets.delete', async (_event, id: string) => {
  try {
    return getWorkspacePresetsService().delete(id);
  } catch (err) {
    return { success: false };
  }
});

// A2A remote agent registry — Claude Cowork parity Phase 3 step 19
ipcMain.handle('a2a.list', async () => {
  try {
    const { getA2ABridge } = await import('./a2a/a2a-bridge');
    return await getA2ABridge().list();
  } catch (err) {
    logError('[a2a.list] failed:', err);
    return [];
  }
});

ipcMain.handle('a2a.discover', async (_event, url: string) => {
  try {
    const { getA2ABridge } = await import('./a2a/a2a-bridge');
    return await getA2ABridge().discover(url);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('a2a.add', async (_event, url: string) => {
  try {
    const { getA2ABridge } = await import('./a2a/a2a-bridge');
    return await getA2ABridge().add(url);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('a2a.remove', async (_event, id: string) => {
  try {
    const { getA2ABridge } = await import('./a2a/a2a-bridge');
    return await getA2ABridge().remove(id);
  } catch (err) {
    return { success: false };
  }
});

ipcMain.handle('a2a.ping', async (_event, id: string) => {
  try {
    const { getA2ABridge } = await import('./a2a/a2a-bridge');
    return await getA2ABridge().ping(id);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('a2a.invoke', async (_event, params: { id: string; message: string }) => {
  try {
    const { getA2ABridge } = await import('./a2a/a2a-bridge');
    return await getA2ABridge().invoke(params.id, params.message);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('a2a.cancelTask', async (_event, params: { id: string; taskId: string }) => {
  try {
    const { getA2ABridge } = await import('./a2a/a2a-bridge');
    return await getA2ABridge().cancelTask(params.id, params.taskId);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('a2a.listTasks', async () => {
  try {
    const { getA2ABridge } = await import('./a2a/a2a-bridge');
    return await getA2ABridge().listTasks();
  } catch (err) {
    logError('[a2a.listTasks] failed:', err);
    return [];
  }
});

// Reasoning trace viewer — Claude Cowork parity Phase 3 step 17
ipcMain.handle('reasoning.listTraces', async () => {
  try {
    const { getReasoningBridge } = await import('./reasoning/reasoning-bridge');
    return getReasoningBridge().listTraces();
  } catch (err) {
    logError('[reasoning.listTraces] failed:', err);
    return [];
  }
});

ipcMain.handle('reasoning.getTrace', async (_event, toolUseId: string) => {
  try {
    const { getReasoningBridge } = await import('./reasoning/reasoning-bridge');
    return getReasoningBridge().getTrace(toolUseId);
  } catch (err) {
    logError('[reasoning.getTrace] failed:', err);
    return null;
  }
});

ipcMain.handle('reasoning.clear', async () => {
  try {
    const { getReasoningBridge } = await import('./reasoning/reasoning-bridge');
    getReasoningBridge().clear();
    return { success: true };
  } catch (err) {
    return { success: false };
  }
});

// Hooks editor — Claude Cowork parity Phase 3 step 13
ipcMain.handle('hooks.list', async () => {
  try {
    const { getHooksBridge } = await import('./hooks/hooks-bridge');
    return await getHooksBridge().list();
  } catch (err) {
    logError('[hooks.list] failed:', err);
    return [];
  }
});

ipcMain.handle(
  'hooks.upsert',
  async (_event, params: { event: string; handler: Record<string, unknown>; index?: number }) => {
    try {
      const { getHooksBridge } = await import('./hooks/hooks-bridge');
      return await getHooksBridge().upsert(
        params.event as never,
        params.handler as never,
        params.index
      );
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
);

ipcMain.handle('hooks.remove', async (_event, params: { event: string; index: number }) => {
  try {
    const { getHooksBridge } = await import('./hooks/hooks-bridge');
    return await getHooksBridge().remove(params.event as never, params.index);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('hooks.test', async (_event, handler: Record<string, unknown>) => {
  try {
    const { getHooksBridge } = await import('./hooks/hooks-bridge');
    return await getHooksBridge().test(handler as never);
  } catch (err) {
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      error: (err as Error).message,
    };
  }
});

// Test runner — Claude Cowork parity Phase 3 step 12
ipcMain.handle('test.detect', async () => {
  try {
    const { getTestRunnerBridge } = await import('./testing/test-runner-bridge');
    return await getTestRunnerBridge().detectFramework();
  } catch (err) {
    logError('[test.detect] failed:', err);
    return null;
  }
});

ipcMain.handle('test.run', async (_event, files?: string[]) => {
  try {
    const { getTestRunnerBridge } = await import('./testing/test-runner-bridge');
    return await getTestRunnerBridge().run(files ?? []);
  } catch (err) {
    logError('[test.run] failed:', err);
    return null;
  }
});

ipcMain.handle('test.runFailing', async () => {
  try {
    const { getTestRunnerBridge } = await import('./testing/test-runner-bridge');
    return await getTestRunnerBridge().runFailing();
  } catch (err) {
    logError('[test.runFailing] failed:', err);
    return null;
  }
});

ipcMain.handle('test.cancel', async () => {
  try {
    const { getTestRunnerBridge } = await import('./testing/test-runner-bridge');
    getTestRunnerBridge().cancel();
    return { success: true };
  } catch (err) {
    return { success: false };
  }
});

ipcMain.handle('test.getState', async () => {
  try {
    const { getTestRunnerBridge } = await import('./testing/test-runner-bridge');
    return getTestRunnerBridge().getState();
  } catch (err) {
    return null;
  }
});

// Persona switcher — Claude Cowork parity Phase 3 step 11
ipcMain.handle('identity.list', async () => {
  try {
    const { getIdentityBridge } = await import('./identity/identity-bridge');
    return await getIdentityBridge().list();
  } catch (err) {
    logError('[identity.list] failed:', err);
    return [];
  }
});

ipcMain.handle('identity.getDetail', async (_event, id: string) => {
  try {
    const { getIdentityBridge } = await import('./identity/identity-bridge');
    return await getIdentityBridge().getDetail(id);
  } catch (err) {
    logError('[identity.getDetail] failed:', err);
    return null;
  }
});

ipcMain.handle('identity.activate', async (_event, id: string) => {
  try {
    const { getIdentityBridge } = await import('./identity/identity-bridge');
    const result = await getIdentityBridge().activate(id);
    if (result.success) {
      sendToRenderer({
        type: 'identity.activated',
        payload: result.active ?? null,
      });
    }
    return result;
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('identity.deactivate', async () => {
  try {
    const { getIdentityBridge } = await import('./identity/identity-bridge');
    const result = await getIdentityBridge().deactivate();
    sendToRenderer({
      type: 'identity.activated',
      payload: null,
    });
    return result;
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('identity.getActive', async () => {
  try {
    const { getIdentityBridge } = await import('./identity/identity-bridge');
    return getIdentityBridge().getActive();
  } catch (err) {
    return null;
  }
});

// Audit log — Claude Cowork parity Phase 3 step 10
ipcMain.handle('audit.listRuns', async (_event, filter?: Record<string, unknown>) => {
  try {
    const { listRuns } = await import('./observability/audit-bridge');
    return await listRuns(filter as never);
  } catch (err) {
    logError('[audit.listRuns] failed:', err);
    return [];
  }
});

ipcMain.handle('audit.getRunDetail', async (_event, runId: string) => {
  try {
    const { getRunDetail } = await import('./observability/audit-bridge');
    return await getRunDetail(runId);
  } catch (err) {
    logError('[audit.getRunDetail] failed:', err);
    return null;
  }
});

ipcMain.handle('audit.exportCsv', async (_event, filter?: Record<string, unknown>) => {
  try {
    const { exportCsv } = await import('./observability/audit-bridge');
    return await exportCsv(filter as never);
  } catch (err) {
    logError('[audit.exportCsv] failed:', err);
    return '';
  }
});

// Custom slash commands — Claude Cowork parity Phase 3 step 6
ipcMain.handle('customCommands.list', async () => {
  try {
    return getCustomCommandsService().list();
  } catch (err) {
    logError('[customCommands.list] failed:', err);
    return [];
  }
});

ipcMain.handle(
  'customCommands.save',
  async (_event, cmd: { name: string; description: string; body: string }) => {
    try {
      return getCustomCommandsService().save(cmd);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
);

ipcMain.handle('customCommands.delete', async (_event, name: string) => {
  try {
    return getCustomCommandsService().delete(name);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// Snippets / prompt library — Claude Cowork parity Phase 3 step 5
ipcMain.handle('snippets.list', async () => {
  try {
    return getSnippetsService().list();
  } catch (err) {
    logError('[snippets.list] failed:', err);
    return [];
  }
});

ipcMain.handle('snippets.get', async (_event, id: string) => {
  try {
    return getSnippetsService().get(id);
  } catch (err) {
    return null;
  }
});

ipcMain.handle(
  'snippets.save',
  async (
    _event,
    snippet: {
      id?: string;
      name: string;
      description?: string;
      tags?: string[];
      body: string;
    }
  ) => {
    try {
      return getSnippetsService().save(snippet);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
);

ipcMain.handle('snippets.delete', async (_event, id: string) => {
  try {
    return getSnippetsService().delete(id);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// Starred/bookmarked messages — Claude Cowork parity Phase 3 step 4
ipcMain.handle(
  'bookmarks.toggle',
  async (
    _event,
    entry: {
      sessionId: string;
      projectId?: string | null;
      messageId: string;
      preview: string;
      role?: string;
    }
  ) => {
    try {
      if (!bookmarksService) return { bookmarked: false };
      return bookmarksService.toggle(entry);
    } catch (err) {
      logError('[bookmarks.toggle] failed:', err);
      return { bookmarked: false };
    }
  }
);

ipcMain.handle('bookmarks.list', async (_event, projectId?: string | null, limit?: number) => {
  try {
    if (!bookmarksService) return [];
    return bookmarksService.list(projectId ?? null, limit ?? 100);
  } catch (err) {
    logError('[bookmarks.list] failed:', err);
    return [];
  }
});

ipcMain.handle('bookmarks.forSession', async (_event, sessionId: string) => {
  try {
    if (!bookmarksService) return [];
    return bookmarksService.getBookmarkedMessageIds(sessionId);
  } catch (err) {
    return [];
  }
});

ipcMain.handle('bookmarks.updateNote', async (_event, id: number, note: string) => {
  try {
    if (!bookmarksService) return { success: false };
    return { success: bookmarksService.updateNote(id, note) };
  } catch (err) {
    return { success: false };
  }
});

ipcMain.handle('bookmarks.remove', async (_event, id: number) => {
  try {
    if (!bookmarksService) return { success: false };
    return { success: bookmarksService.remove(id) };
  } catch (err) {
    return { success: false };
  }
});

// Model capabilities lookup — Claude Cowork parity Phase 3 step 3
ipcMain.handle('model.capabilities', async (_event, model: string) => {
  try {
    return await getModelCapabilities(model ?? '');
  } catch (err) {
    logError('[model.capabilities] failed:', err);
    return {
      model,
      supportsVision: false,
      supportsReasoning: false,
      supportsToolCalls: true,
      contextWindow: 128000,
      maxOutputTokens: 8192,
    };
  }
});

// Git status panel + commit composer — Claude Cowork parity Phase 3 step 2
ipcMain.handle('git.status', async (_event, cwd: string) => {
  try {
    if (!cwd)
      return { isRepo: false, branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
    return getGitBridge().getStatus(cwd);
  } catch (err) {
    logError('[git.status] failed:', err);
    return {
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      error: (err as Error).message,
    };
  }
});

ipcMain.handle('git.stage', async (_event, cwd: string, files: string[]) => {
  try {
    return getGitBridge().stage(cwd, files);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('git.unstage', async (_event, cwd: string, files: string[]) => {
  try {
    return getGitBridge().unstage(cwd, files);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('git.diff', async (_event, cwd: string, file: string, staged: boolean) => {
  try {
    return getGitBridge().diff(cwd, file, staged);
  } catch (err) {
    logError('[git.diff] failed:', err);
    return '';
  }
});

ipcMain.handle('git.commit', async (_event, cwd: string, message: string, amend?: boolean) => {
  try {
    return getGitBridge().commit(cwd, message, { amend: !!amend });
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('git.suggestMessage', async (_event, cwd: string) => {
  try {
    return { message: getGitBridge().suggestMessage(cwd) ?? '' };
  } catch (err) {
    return { message: '' };
  }
});

ipcMain.handle('git.branches', async (_event, cwd: string) => {
  try {
    return getGitBridge().listBranches(cwd);
  } catch {
    return [];
  }
});

ipcMain.handle('git.worktrees', async (_event, cwd: string) => {
  try {
    return getGitBridge().listWorktrees(cwd);
  } catch {
    return [];
  }
});

ipcMain.handle(
  'git.worktreeAdd',
  async (_event, cwd: string, targetPath: string, branch?: string) => {
    try {
      return getGitBridge().addWorktree(cwd, targetPath, branch);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
);

ipcMain.handle(
  'git.worktreeRemove',
  async (_event, cwd: string, targetPath: string, force?: boolean) => {
    try {
      return getGitBridge().removeWorktree(cwd, targetPath, !!force);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
);

ipcMain.handle('git.worktreePrune', async (_event, cwd: string) => {
  try {
    return getGitBridge().pruneWorktrees(cwd);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// Hunk diff accept/reject — Claude Cowork parity Phase 3 step 1
ipcMain.handle('diff.parseHunks', async (_event, excerpt: string) => {
  try {
    return parseUnifiedDiff(excerpt ?? '');
  } catch (err) {
    logError('[diff.parseHunks] failed:', err);
    return { hunks: [], preamble: '' };
  }
});

ipcMain.handle('diff.revertHunks', async (_event, filePath: string, hunks: ParsedHunk[]) => {
  try {
    if (!filePath || !Array.isArray(hunks)) {
      return { success: false, method: 'none', error: 'Invalid arguments' };
    }
    return revertHunks(filePath, hunks);
  } catch (err) {
    logError('[diff.revertHunks] failed:', err);
    return {
      success: false,
      method: 'none',
      error: (err as Error).message ?? 'Unknown error',
    };
  }
});

// Global search (Cmd+K palette) — Claude Cowork parity Phase 2 step 8
ipcMain.handle('search.global', async (_event, query: string, limit?: number) => {
  if (!globalSearchService) {
    return {
      hits: [],
      totalByCategory: {
        session: 0,
        message: 0,
        memory: 0,
        knowledge: 0,
        file: 0,
      },
    };
  }
  try {
    return await globalSearchService.search(query, limit ?? 40);
  } catch (err) {
    logError('[search.global] failed:', err);
    return {
      hits: [],
      totalByCategory: {
        session: 0,
        message: 0,
        memory: 0,
        knowledge: 0,
        file: 0,
      },
    };
  }
});

// Skills API handlers
ipcMain.handle('skills.getAll', async () => {
  try {
    if (!skillsManager) {
      throw new Error('Skills manager is still starting');
    }
    return await skillsManager.listSkills();
  } catch (error) {
    logError('[Skills] Error getting skills:', error);
    throw error;
  }
});

ipcMain.handle('skills.install', async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const skill = await skillsManager.installSkill(skillPath);
    sessionManager?.invalidateSkillsSetup();
    return { success: true, skill };
  } catch (error) {
    logError('[Skills] Error installing skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.delete', async (_event, skillId: string) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    await skillsManager.uninstallSkill(skillId);
    sessionManager?.invalidateSkillsSetup();
    return { success: true };
  } catch (error) {
    logError('[Skills] Error deleting skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.setEnabled', async (_event, skillId: string, enabled: boolean) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    skillsManager.setSkillEnabled(skillId, enabled);
    sessionManager?.invalidateSkillsSetup();
    return { success: true };
  } catch (error) {
    logError('[Skills] Error toggling skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.validate', async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      return { valid: false, errors: ['SkillsManager not initialized'] };
    }
    const result = await skillsManager.validateSkillFolder(skillPath);
    return result;
  } catch (error) {
    logError('[Skills] Error validating skill:', error);
    return { valid: false, errors: ['Validation failed'] };
  }
});

ipcMain.handle('skills.getStoragePath', async () => {
  try {
    if (!skillsManager) {
      return null;
    }
    return skillsManager.getGlobalSkillsPath();
  } catch (error) {
    logError('[Skills] Error getting storage path:', error);
    return null;
  }
});

ipcMain.handle('skills.setStoragePath', async (_event, targetPath: string, migrate = true) => {
  if (!skillsManager) {
    throw new Error('SkillsManager not initialized');
  }
  const result = await skillsManager.setGlobalSkillsPath(targetPath, migrate !== false);
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured: configStore.isConfigured(),
      config: configStore.getAll(),
    },
  });
  return { success: true, ...result };
});

ipcMain.handle('skills.openStoragePath', async () => {
  if (!skillsManager) {
    throw new Error('SkillsManager not initialized');
  }
  const storagePath = skillsManager.getGlobalSkillsPath();
  const openResult = await shell.openPath(storagePath);
  if (openResult) {
    return { success: false, path: storagePath, error: openResult };
  }
  return { success: true, path: storagePath };
});

ipcMain.handle('plugins.listCatalog', async (_event, options?: { installableOnly?: boolean }) => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    return await pluginRuntimeService.listCatalog(options);
  } catch (error) {
    logError('[Plugins] Error listing catalog:', error);
    throw error;
  }
});

ipcMain.handle('plugins.listInstalled', async () => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    return pluginRuntimeService.listInstalled();
  } catch (error) {
    logError('[Plugins] Error listing installed plugins:', error);
    throw error;
  }
});

ipcMain.handle('plugins.install', async (_event, pluginName: string) => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    const result = await pluginRuntimeService.install(pluginName);
    sessionManager?.invalidateSkillsSetup();
    return result;
  } catch (error) {
    logError('[Plugins] Error installing plugin:', error);
    throw error;
  }
});

ipcMain.handle('plugins.setEnabled', async (_event, pluginId: string, enabled: boolean) => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    const result = await pluginRuntimeService.setEnabled(pluginId, enabled);
    sessionManager?.invalidateSkillsSetup();
    return result;
  } catch (error) {
    logError('[Plugins] Error toggling plugin:', error);
    throw error;
  }
});

ipcMain.handle(
  'plugins.setComponentEnabled',
  async (
    _event,
    pluginId: string,
    component: 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp',
    enabled: boolean
  ) => {
    try {
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await pluginRuntimeService.setComponentEnabled(pluginId, component, enabled);
      if (component === 'skills') {
        sessionManager?.invalidateSkillsSetup();
      }
      return result;
    } catch (error) {
      logError('[Plugins] Error toggling plugin component:', error);
      throw error;
    }
  }
);

ipcMain.handle('plugins.uninstall', async (_event, pluginId: string) => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    const result = await pluginRuntimeService.uninstall(pluginId);
    sessionManager?.invalidateSkillsSetup();
    return result;
  } catch (error) {
    logError('[Plugins] Error uninstalling plugin:', error);
    throw error;
  }
});

// Window control IPC handlers
ipcMain.on('window.minimize', () => {
  try {
    mainWindow?.minimize();
  } catch (error) {
    logError('[Window] Error minimizing:', error);
  }
});

ipcMain.on('window.maximize', () => {
  try {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  } catch (error) {
    logError('[Window] Error maximizing:', error);
  }
});

ipcMain.on('window.close', () => {
  try {
    mainWindow?.close();
  } catch (error) {
    logError('[Window] Error closing:', error);
  }
});

// Sandbox IPC handlers
ipcMain.handle('sandbox.getStatus', async () => {
  try {
    const adapter = getSandboxAdapter();
    const platform = process.platform;

    if (platform === 'win32') {
      const wslStatus = await WSLBridge.checkWSLStatus();
      return {
        platform: 'win32',
        mode: adapter.initialized ? adapter.mode : 'none',
        initialized: adapter.initialized,
        wsl: wslStatus,
        lima: null,
      };
    } else if (platform === 'darwin') {
      const limaStatus = await LimaBridge.checkLimaStatus();
      return {
        platform: 'darwin',
        mode: adapter.initialized ? adapter.mode : 'native',
        initialized: adapter.initialized,
        wsl: null,
        lima: limaStatus,
      };
    } else {
      return {
        platform,
        mode: adapter.initialized ? adapter.mode : 'native',
        initialized: adapter.initialized,
        wsl: null,
        lima: null,
      };
    }
  } catch (error) {
    logError('[Sandbox] Error getting status:', error);
    return {
      platform: process.platform,
      mode: 'none',
      initialized: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// WSL IPC handlers (Windows)
ipcMain.handle('sandbox.checkWSL', async () => {
  try {
    return await WSLBridge.checkWSLStatus();
  } catch (error) {
    logError('[Sandbox] Error checking WSL:', error);
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.installNodeInWSL', async (_event, distro: string) => {
  try {
    return await WSLBridge.installNodeInWSL(distro);
  } catch (error) {
    logError('[Sandbox] Error installing Node.js:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installPythonInWSL', async (_event, distro: string) => {
  try {
    return await WSLBridge.installPythonInWSL(distro);
  } catch (error) {
    logError('[Sandbox] Error installing Python:', error);
    return false;
  }
});

// Lima IPC handlers (macOS)
ipcMain.handle('sandbox.checkLima', async () => {
  try {
    return await LimaBridge.checkLimaStatus();
  } catch (error) {
    logError('[Sandbox] Error checking Lima:', error);
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.createLimaInstance', async () => {
  try {
    return await LimaBridge.createLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error creating Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.startLimaInstance', async () => {
  try {
    return await LimaBridge.startLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error starting Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.stopLimaInstance', async () => {
  try {
    return await LimaBridge.stopLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error stopping Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installNodeInLima', async () => {
  try {
    return await LimaBridge.installNodeInLima();
  } catch (error) {
    logError('[Sandbox] Error installing Node.js in Lima:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installPythonInLima', async () => {
  try {
    return await LimaBridge.installPythonInLima();
  } catch (error) {
    logError('[Sandbox] Error installing Python in Lima:', error);
    return false;
  }
});

// Logs IPC handlers
ipcMain.handle('logs.getPath', () => {
  try {
    return getLogFilePath();
  } catch (error) {
    logError('[Logs] Error getting log path:', error);
    return null;
  }
});

ipcMain.handle('logs.getDirectory', () => {
  try {
    return getLogsDirectory();
  } catch (error) {
    logError('[Logs] Error getting logs directory:', error);
    return null;
  }
});

ipcMain.handle('logs.getAll', () => {
  try {
    return getAllLogFiles();
  } catch (error) {
    logError('[Logs] Error getting all log files:', error);
    return [];
  }
});

ipcMain.handle('logs.export', async () => {
  try {
    const logFiles = getAllLogFiles();
    const diagnosticsSummary = buildDiagnosticsSummary({
      app: {
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
      },
      runtime: {
        currentWorkingDir,
        logsDirectory: getLogsDirectory(),
        logFileCount: logFiles.length,
        totalLogSizeBytes: logFiles.reduce((total, file) => total + file.size, 0),
        devLogsEnabled: isDevLogsEnabled(),
      },
      config: {
        provider: configStore.get('provider'),
        model: configStore.get('model'),
        baseUrl: sanitizeDiagnosticBaseUrl(configStore.get('baseUrl') || undefined),
        customProtocol: configStore.get('customProtocol') || null,
        sandboxEnabled: !!configStore.get('sandboxEnabled'),
        thinkingEnabled: !!configStore.get('enableThinking'),
        apiKeyConfigured: !!configStore.get('apiKey'),
        claudeCodePathConfigured: !!configStore.get('claudeCodePath'),
        defaultWorkdir: configStore.get('defaultWorkdir') || null,
        globalSkillsPathConfigured: !!configStore.get('globalSkillsPath'),
      },
      sandbox: {
        mode: getSandboxAdapter().mode,
        initialized: getSandboxAdapter().initialized,
      },
      sessions: sessionManager ? sessionManager.listSessions() : [],
      logFiles,
      deps: {
        getMessages: (sessionId: string) =>
          sessionManager ? sessionManager.getMessages(sessionId) : [],
        getTraceSteps: (sessionId: string) =>
          sessionManager ? sessionManager.getTraceSteps(sessionId) : [],
      },
    });

    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Logs',
      defaultPath: `opencowork-logs-${new Date().toISOString().split('T')[0]}.zip`,
      filters: [
        { name: 'ZIP Archive', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'User cancelled' };
    }

    // Dynamic import archiver
    const archiver = await import('archiver');
    const output = fs.createWriteStream(result.filePath);
    const archive = archiver.default('zip', { zlib: { level: 9 } });

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: {
        success: boolean;
        path?: string;
        size?: number;
        error?: string;
      }) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      output.on('close', () => {
        log('[Logs] Exported logs to:', result.filePath);
        settle({
          success: true,
          path: result.filePath,
          size: archive.pointer(),
        });
      });

      output.on('error', (err: Error) => {
        logError('[Logs] Error writing exported archive:', err);
        settle({ success: false, error: err.message });
      });

      archive.on('error', (err: Error) => {
        logError('[Logs] Error creating archive:', err);
        settle({ success: false, error: err.message });
      });

      archive.pipe(output);

      // Add all log files
      for (const logFile of logFiles) {
        archive.file(logFile.path, { name: logFile.name });
      }

      // Add system info
      const systemInfo = {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: app.getVersion(),
        exportDate: new Date().toISOString(),
        logFiles: logFiles.map((f) => ({
          name: f.name,
          size: f.size,
          modified: f.mtime,
        })),
      };
      archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' });
      archive.append(JSON.stringify(diagnosticsSummary, null, 2), {
        name: 'diagnostics-summary.json',
      });
      archive.append(
        [
          'Open Cowork diagnostic bundle',
          `Exported at: ${diagnosticsSummary.exportedAt}`,
          '',
          'Included files:',
          '- Application log files (*.log)',
          '- system-info.json',
          '- diagnostics-summary.json',
          '',
          'diagnostics-summary.json contains a redacted runtime/config snapshot,',
          'plus metadata-only session summaries and recent error traces to speed up debugging.',
        ].join('\n'),
        { name: 'README.txt' }
      );

      archive.finalize();
    });
  } catch (error) {
    logError('[Logs] Error exporting logs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.open', async () => {
  try {
    const logsDir = getLogsDirectory();
    await shell.openPath(logsDir);
    return { success: true };
  } catch (error) {
    logError('[Logs] Error opening logs directory:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.clear', async () => {
  try {
    const logFiles = getAllLogFiles();

    // Close current log file
    closeLogFile();

    // Delete all log files
    for (const logFile of logFiles) {
      try {
        fs.unlinkSync(logFile.path);
        log('[Logs] Deleted log file:', logFile.name);
      } catch (err) {
        logError('[Logs] Failed to delete log file:', logFile.name, err);
      }
    }

    // Log will automatically reinitialize on next log call
    log('[Logs] Log files cleared and reinitialized');

    return { success: true, deletedCount: logFiles.length };
  } catch (error) {
    logError('[Logs] Error clearing logs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.setEnabled', async (_event, enabled: boolean) => {
  try {
    setDevLogsEnabled(enabled);
    configStore.set('enableDevLogs', enabled);
    log('[Logs] Developer logs', enabled ? 'enabled' : 'disabled');
    return { success: true, enabled };
  } catch (error) {
    logError('[Logs] Error setting dev logs enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.isEnabled', () => {
  try {
    return { success: true, enabled: isDevLogsEnabled() };
  } catch (error) {
    logError('[Logs] Error getting dev logs enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// ============================================================================
// 远程控制 IPC 处理
// ============================================================================

ipcMain.handle('remote.getConfig', () => {
  try {
    return remoteConfigStore.getAll();
  } catch (error) {
    logError('[Remote] Error getting config:', error);
    return null;
  }
});

ipcMain.handle('remote.getStatus', () => {
  try {
    return remoteManager.getStatus();
  } catch (error) {
    logError('[Remote] Error getting status:', error);
    return { running: false, channels: [], activeSessions: 0, pendingPairings: 0 };
  }
});

ipcMain.handle('remote.setEnabled', async (_event, enabled: boolean) => {
  try {
    remoteConfigStore.setEnabled(enabled);

    if (enabled) {
      await remoteManager.start();
    } else {
      await remoteManager.stop();
    }

    return { success: true };
  } catch (error) {
    logError('[Remote] Error setting enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.updateGatewayConfig', async (_event, config: Partial<GatewayConfig>) => {
  try {
    await remoteManager.updateGatewayConfig(config);
    return { success: true };
  } catch (error) {
    logError('[Remote] Error updating gateway config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.updateFeishuConfig', async (_event, config: FeishuChannelConfig) => {
  try {
    await remoteManager.updateFeishuConfig(config);
    return { success: true };
  } catch (error) {
    logError('[Remote] Error updating Feishu config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getPairedUsers', () => {
  try {
    return remoteManager.getPairedUsers();
  } catch (error) {
    logError('[Remote] Error getting paired users:', error);
    return [];
  }
});

ipcMain.handle('remote.getPendingPairings', () => {
  try {
    return remoteManager.getPendingPairings();
  } catch (error) {
    logError('[Remote] Error getting pending pairings:', error);
    return [];
  }
});

ipcMain.handle('remote.approvePairing', (_event, channelType: ChannelType, userId: string) => {
  try {
    const success = remoteManager.approvePairing(channelType, userId);
    return { success };
  } catch (error) {
    logError('[Remote] Error approving pairing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.revokePairing', (_event, channelType: ChannelType, userId: string) => {
  try {
    const success = remoteManager.revokePairing(channelType, userId);
    return { success };
  } catch (error) {
    logError('[Remote] Error revoking pairing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getRemoteSessions', () => {
  try {
    return remoteManager.getRemoteSessions();
  } catch (error) {
    logError('[Remote] Error getting remote sessions:', error);
    return [];
  }
});

ipcMain.handle('remote.clearRemoteSession', (_event, sessionId: string) => {
  try {
    const success = remoteManager.clearRemoteSession(sessionId);
    return { success };
  } catch (error) {
    logError('[Remote] Error clearing remote session:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getTunnelStatus', () => {
  try {
    return remoteManager.getTunnelStatus();
  } catch (error) {
    logError('[Remote] Error getting tunnel status:', error);
    return { connected: false, url: null, provider: 'none' };
  }
});

ipcMain.handle('remote.getWebhookUrl', () => {
  try {
    return remoteManager.getFeishuWebhookUrl();
  } catch (error) {
    logError('[Remote] Error getting webhook URL:', error);
    return null;
  }
});

ipcMain.handle('remote.restart', async () => {
  try {
    await remoteManager.restart();
    return { success: true };
  } catch (error) {
    logError('[Remote] Error restarting:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('schedule.list', () => {
  try {
    if (!scheduledTaskManager) return [];
    return scheduledTaskManager.list();
  } catch (error) {
    logError('[Schedule] Error listing tasks:', error);
    return [];
  }
});

ipcMain.handle('schedule.create', async (_event, payload: ScheduledTaskCreateInput) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  const unsupportedReason = getWorkspacePathUnsupportedReason(payload.cwd);
  if (unsupportedReason) {
    throw new Error(unsupportedReason);
  }
  const normalizedPrompt = payload.prompt.trim();
  const title = await resolveScheduledTaskTitle(normalizedPrompt, payload.cwd, payload.title);
  return scheduledTaskManager.create({
    ...payload,
    prompt: normalizedPrompt,
    title,
  });
});

ipcMain.handle('schedule.update', async (_event, id: string, updates: ScheduledTaskUpdateInput) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  const existing = scheduledTaskManager.get(id);
  if (!existing) return null;
  const nextCwd = updates.cwd ?? existing.cwd;
  const unsupportedReason = getWorkspacePathUnsupportedReason(nextCwd);
  if (unsupportedReason) {
    throw new Error(unsupportedReason);
  }
  const normalizedPrompt = updates.prompt === undefined ? existing.prompt : updates.prompt.trim();
  const normalizedUpdates: ScheduledTaskUpdateInput = {
    ...updates,
    prompt: normalizedPrompt,
  };

  if (updates.prompt !== undefined) {
    normalizedUpdates.title = await resolveScheduledTaskTitle(
      normalizedPrompt,
      updates.cwd ?? existing.cwd,
      updates.title ?? existing.title
    );
  } else if (updates.title !== undefined) {
    normalizedUpdates.title = buildScheduledTaskTitle(updates.title);
  }

  return scheduledTaskManager.update(id, normalizedUpdates);
});

ipcMain.handle('schedule.delete', (_event, id: string) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return { success: scheduledTaskManager.delete(id) };
});

ipcMain.handle('schedule.toggle', (_event, id: string, enabled: boolean) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return scheduledTaskManager.toggle(id, enabled);
});

ipcMain.handle('schedule.runNow', async (_event, id: string) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return scheduledTaskManager.runNow(id);
});

ipcMain.handle('logs.write', (_event, level: 'info' | 'warn' | 'error', args: unknown[]) => {
  try {
    if (level === 'warn') {
      logWarn(...args);
    } else if (level === 'error') {
      logError(...args);
    } else {
      log(...args);
    }
    return { success: true };
  } catch (error) {
    console.error('[Logs] Error writing log:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.retryLimaSetup', async () => {
  if (process.platform !== 'darwin') {
    return { success: false, error: 'Lima is only available on macOS' };
  }

  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: 'sandbox.progress',
        payload: progress,
      });
    });

    try {
      await LimaBridge.stopLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error stopping Lima before retry:', error);
    }

    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError('[Sandbox] Error retrying Lima setup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Generic retry setup for both WSL and Lima
ipcMain.handle('sandbox.retrySetup', async () => {
  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: 'sandbox.progress',
        payload: progress,
      });
    });

    // Reset and re-run bootstrap
    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError('[Sandbox] Error retrying setup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

async function handleClientEvent(event: ClientEvent): Promise<unknown> {
  // Check if configured before starting sessions
  if (event.type === 'session.start' && !configStore.hasUsableCredentialsForActiveSet()) {
    sendToRenderer({
      type: 'error',
      payload: {
        message: '当前方案未配置可用凭证，请先在 API 设置中完成配置',
        code: 'CONFIG_REQUIRED_ACTIVE_SET',
        action: 'open_api_settings',
      },
    });
    return null;
  }

  if (eventRequiresSessionManager(event) && !sessionManager) {
    throw new Error('Session manager not initialized');
  }
  // After the guard above, sessionManager is guaranteed non-null for session.* events.
  // Use a local alias to satisfy TypeScript's control-flow narrowing.
  const sm = sessionManager!;

  switch (event.type) {
    case 'session.start':
      if (getWorkspacePathUnsupportedReason(event.payload.cwd)) {
        sendToRenderer({
          type: 'error',
          payload: {
            message: getWorkspacePathUnsupportedReason(event.payload.cwd)!,
          },
        });
        return null;
      }
      return sm.startSession(
        event.payload.title,
        event.payload.prompt,
        event.payload.cwd,
        event.payload.projectId ?? null,
        event.payload.allowedTools,
        event.payload.content,
        event.payload.memoryEnabled
      );

    case 'session.continue':
      return sm.continueSession(
        event.payload.sessionId,
        event.payload.prompt,
        event.payload.content
      );

    case 'session.stop':
      return sm.stopSession(event.payload.sessionId);

    case 'session.delete':
      return sm.deleteSession(event.payload.sessionId);

    case 'session.batchDelete':
      return sm.batchDeleteSessions(event.payload.sessionIds);

    case 'session.list': {
      const sessions = sm.listSessions();
      sendToRenderer({ type: 'session.list', payload: { sessions } });
      return sessions;
    }

    case 'session.getMessages':
      return sm.getMessages(event.payload.sessionId);

    case 'session.getTraceSteps':
      return sm.getTraceSteps(event.payload.sessionId);

    case 'permission.response':
      return sm.handlePermissionResponse(event.payload.toolUseId, event.payload.result);

    case 'sudo.password.response':
      return sm.handleSudoPasswordResponse(event.payload.toolUseId, event.payload.password);

    case 'folder.select': {
      const folderResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
      });
      if (!folderResult.canceled && folderResult.filePaths.length > 0) {
        sendToRenderer({
          type: 'folder.selected',
          payload: { path: folderResult.filePaths[0] },
        });
        return folderResult.filePaths[0];
      }
      return null;
    }

    case 'workdir.get':
      return getWorkingDir();

    case 'workdir.set':
      return setWorkingDir(event.payload.path, event.payload.sessionId);

    case 'workdir.select': {
      const dialogDefaultPath =
        event.payload.currentPath && isAbsolute(event.payload.currentPath)
          ? event.payload.currentPath
          : currentWorkingDir || undefined;
      const workdirResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select Working Directory',
        defaultPath: dialogDefaultPath,
      });
      if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
        const selectedPath = workdirResult.filePaths[0];
        return setWorkingDir(selectedPath, event.payload.sessionId);
      }
      return { success: false, path: '', error: 'User cancelled' };
    }

    case 'settings.update':
      if (
        event.payload.theme === 'dark' ||
        event.payload.theme === 'light' ||
        event.payload.theme === 'system'
      ) {
        const nextTheme = event.payload.theme as AppTheme;
        configStore.update({ theme: nextTheme });
        applyNativeThemePreference(nextTheme);
        if (mainWindow && !mainWindow.isDestroyed()) {
          const effectiveTheme = resolveEffectiveTheme(nextTheme);
          mainWindow.setBackgroundColor(effectiveTheme === 'dark' ? DARK_BG : LIGHT_BG);
        }
        sendToRenderer({
          type: 'config.status',
          payload: {
            isConfigured: configStore.isConfigured(),
            config: configStore.getAll(),
          },
        });
      }
      return null;

    default:
      logWarn('Unknown event type:', event);
      return null;
  }
}
