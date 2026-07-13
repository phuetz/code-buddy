/**
 * @module main/session/session-manager
 *
 * Session lifecycle manager (957 lines).
 *
 * Responsibilities:
 * - Session CRUD: create, continue, stop, delete, list
 * - Chat history persistence to SQLite via DatabaseInstance
 * - Workspace-scoped sessions with sandbox integration
 * - Delegates AI execution to ClaudeAgentRunner
 *
 * Dependencies: database, agent-runner, config-store, mcp-manager, sandbox-adapter
 */
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type {
  Session,
  Message,
  ServerEvent,
  PermissionResult,
  ContentBlock,
  TextContent,
  TraceStep,
  FileAttachmentContent,
  ToolUseContent,
  ToolResultContent,
  MessageMetadata,
} from '../../renderer/types';
import type { DatabaseInstance, TraceStepRow } from '../db/database';
import { PathResolver } from '../sandbox/path-resolver';
import { resolveSafeCwd } from './safe-cwd';
import { loadCoreModule } from '../utils/core-loader';
import {
  SandboxAdapter,
  getSandboxAdapter,
  initializeSandbox,
  reinitializeSandbox,
} from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { ClaudeAgentRunner } from '../claude/agent-runner';
import { configStore } from '../config/config-store';
import { MCPManager, type MCPServerConfig } from '../mcp/mcp-manager';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import {
  log,
  logError,
  logWarn,
  logCtx,
  logCtxError,
  runWithLogContext,
  generateTraceId,
} from '../utils/logger';
import { maybeGenerateSessionTitle } from './session-title-flow';
import {
  buildTitlePrompt,
  getDefaultTitleFromPrompt,
  normalizeGeneratedTitle,
} from './session-title-utils';
import {
  buildAttachedFilesPromptContext,
  buildAttachmentOnlyPrompt,
  buildYoutubeVideoGuidance,
} from './file-attachment-context';
import { generateTitleWithClaudeSdk } from '../claude/claude-sdk-one-shot';
import { buildScheduledTaskTitle } from '../../shared/schedule/task-title';
import { CodeBuddyEngineRunner } from '../engine/codebuddy-engine-runner';
import { TurnJournal, type TurnJournalReadResult } from './turn-journal';
import { buildSessionRecallPrefill, repairSessionTranscript } from './session-insights-bridge';

export { formatFileAttachmentPromptLine } from './file-attachment-context';

export function createUniqueAttachmentFilename(
  filename: string,
  usedFilenames: Set<string>,
  isUnavailable: (candidate: string) => boolean = () => false,
): string {
  const basename = path.basename(filename) || `attachment-${Date.now()}`;
  const extension = path.extname(basename);
  const stem = path.basename(basename, extension) || 'attachment';
  let candidate = basename;
  let index = 2;

  while (usedFilenames.has(candidate.toLowerCase()) || isUnavailable(candidate)) {
    candidate = `${stem}-${index}${extension}`;
    index += 1;
  }

  usedFilenames.add(candidate.toLowerCase());
  return candidate;
}

interface AgentRunner {
  run(session: Session, prompt: string, existingMessages: Message[]): Promise<void>;
  cancel(sessionId: string): void;
  steer?(sessionId: string, prompt: string): boolean | Promise<boolean>;
  clearSdkSession?(sessionId: string): void;
}

/**
 * Minimal EngineAdapter interface — structurally matches Code Buddy's EngineAdapter.
 * Uses wide types (Record) so the Cowork side doesn't need to import Code Buddy types.
 */
export interface EngineAdapterLike {
  runSession(
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    onEvent: (event: { type: string; [key: string]: unknown }) => void,
    options?: Record<string, unknown>,
  ): Promise<{ content: string; tokenCount?: number; toolCallCount?: number }>;
  cancel(sessionId: string): void;
  steer?(sessionId: string, prompt: string): boolean | Promise<boolean>;
  clearSession(sessionId: string): void;
  /**
   * Toggle Gemini server-side Google Search grounding default for this
   * adapter. Optional because not every adapter implementation routes
   * through the Gemini-native provider; calling it on an adapter that
   * doesn't have a Gemini path is a no-op rather than a crash.
   */
  setDefaultGoogleSearch?: (enabled: boolean) => void;
  /**
   * Toggle visual grounding fallback for this adapter.
   */
  setDefaultVisionGrounding?: (enabled: boolean, model?: string) => void;
  /**
   * Hot-swap the reasoning/thinking level (`off..xhigh`) for live sessions.
   * Optional — older bundles without the hook simply don't expose it.
   * See `EngineAdapter.setThinkingLevel` (core).
   */
  setThinkingLevel?: (level: string) => Promise<void>;
  /**
   * Push the host's view of the MCP server registry to the engine.
   * Optional — older bundles without the runtime sync hook simply
   * don't expose it. See `EngineAdapter.setMcpServers` (core).
   */
  setMcpServers?: (
    configs: Array<{
      name: string;
      transport: {
        type: 'stdio' | 'http' | 'sse' | 'streamable_http';
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
      };
      enabled?: boolean;
    }>,
  ) => Promise<void>;
  /**
   * Reload the engine's skills registry. Called by Cowork after a
   * skill is installed / removed / toggled in Settings.
   * Optional — older bundles without skills hot-reload don't expose it.
   */
  reloadSkills?: () => Promise<void>;
  /**
   * Push updated provider/model settings into the embedded engine.
   * The core adapter owns cached CodeBuddyAgent instances and needs an
   * explicit config update when Cowork Settings change.
   */
  updateConfig?: (config: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    workingDirectory?: string;
  }) => void;
}

/** Minimal interface for the project memory service */
export interface ProjectMemoryServiceLike {
  loadProjectContext(projectId: string): Promise<string | null>;
  consolidateSessionMemory(
    projectId: string,
    sessionId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<{ added: number; duplicatesSkipped: number; memoryDir: string } | null>;
  previewProjectMemory?: (
    projectId: string,
    sessionId: string,
    messages: Array<{ role: string; content: string }>
  ) => {
    projectId: string;
    candidateCount: number;
    candidates: Array<{
      category: 'preference' | 'pattern' | 'context' | 'decision';
      content: string;
      sourceSessionId?: string;
      sourceKind: 'user' | 'assistant';
      evidence: string;
    }>;
    hasWorkspace: boolean;
    projectMemoryPath?: string;
  } | null;
}

/** Minimal interface for the project manager */
export interface ProjectManagerLike {
  get(id: string): {
    id: string;
    name: string;
    workspacePath?: string;
    memoryConfig?: { memoryStrategy?: 'auto' | 'manual' | 'rolling' };
  } | null;
  getActiveId(): string | null;
}

/** Minimal interface for the mention processor */
export interface MentionProcessorLike {
  process(
    text: string,
    cwd?: string
  ): Promise<{
    cleanedText: string;
    contextBlocks: Array<{ type: string; content: string; source: string }>;
  }>;
  buildEnhancedPrompt(result: {
    cleanedText: string;
    contextBlocks: Array<{ type: string; content: string; source: string }>;
  }): string;
}

/** Minimal interface for the notification bridge */
export interface NotificationBridgeLike {
  notifyTaskComplete(sessionId: string, summary: string, success: boolean): void;
  notifyTaskProgress(sessionId: string, message: string): void;
}

/** Minimal interface for the ICM cross-session memory */
export interface ICMIntegrationLike {
  isAvailable(): boolean;
  searchRelevantMemories(
    query: string,
    projectId?: string,
    limit?: number
  ): Promise<Array<{ id: string; content: string; score?: number }>>;
  storeEpisode(
    content: string,
    metadata: {
      sessionId: string;
      projectId?: string;
      tags?: string[];
      source?: string;
    }
  ): Promise<void>;
  formatContextBlock(
    memories: Array<{ id: string; content: string; score?: number }>
  ): string | null;
}

export interface SessionMemoryPreview {
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
}

const WORKSPACE_MOUNT_VIRTUAL_PATH = '/mnt/workspace';
const TITLE_GENERATION_TIMEOUT_MS = 20000;

function extractSessionTags(title: string): string[] {
  const tags = title.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.slice(1).trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function parseSessionTags(raw: string | null | undefined, fallbackTitle: string): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
      }
    } catch {
      // Fall through to title-derived tags.
    }
  }
  return extractSessionTags(fallbackTitle);
}

function remapDuplicatedContentBlocks(
  content: ContentBlock[],
  toolUseIdMap: Map<string, string>
): ContentBlock[] {
  return content.map((block) => {
    if (block.type === 'tool_use') {
      const toolUse = block as ToolUseContent;
      const nextId = toolUseIdMap.get(toolUse.id) ?? uuidv4();
      toolUseIdMap.set(toolUse.id, nextId);
      return { ...toolUse, id: nextId };
    }
    if (block.type === 'tool_result') {
      const toolResult = block as ToolResultContent;
      const nextToolUseId = toolUseIdMap.get(toolResult.toolUseId) ?? toolResult.toolUseId;
      return { ...toolResult, toolUseId: nextToolUseId };
    }
    return { ...block } as ContentBlock;
  });
}

function remapDuplicatedMessageMetadata(
  metadata: MessageMetadata | undefined,
  turnIdMap: Map<string, string>
): MessageMetadata | undefined {
  if (!metadata) return undefined;
  const next: MessageMetadata = { ...metadata };
  if (metadata.turn) {
    const nextTurnId = turnIdMap.get(metadata.turn.id) ?? uuidv4();
    turnIdMap.set(metadata.turn.id, nextTurnId);
    next.turn = { ...metadata.turn, id: nextTurnId };
  }
  if (metadata.pendingIntent) {
    next.pendingIntent = { ...metadata.pendingIntent };
  }
  if (metadata.recovery) {
    const nextTurnId = turnIdMap.get(metadata.recovery.turnId) ?? uuidv4();
    turnIdMap.set(metadata.recovery.turnId, nextTurnId);
    next.recovery = { ...metadata.recovery, turnId: nextTurnId };
  }
  return next;
}

function buildTurnSubmissionSnapshot(content: ContentBlock[]): {
  content: ContentBlock[];
  recoverable: boolean;
  nonRecoverableTypes: string[];
} {
  const snapshot: ContentBlock[] = [];
  const nonRecoverableTypes: string[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      snapshot.push({ ...block });
      continue;
    }
    if (block.type === 'file_attachment') {
      const fileBlock = { ...block };
      delete fileBlock.inlineDataBase64;
      if (!fileBlock.relativePath) {
        nonRecoverableTypes.push(block.type);
        continue;
      }
      snapshot.push(fileBlock);
      continue;
    }
    nonRecoverableTypes.push(block.type);
  }

  return {
    content: snapshot,
    recoverable: snapshot.length > 0 && nonRecoverableTypes.length === 0,
    nonRecoverableTypes,
  };
}

interface QueuedPromptItem {
  turnId: string;
  prompt: string;
  content?: ContentBlock[];
}

interface RecoveredQueuedPromptSnapshot {
  prompt: string;
  content?: ContentBlock[];
  recoverable: boolean;
  nonRecoverableTypes: string[];
}

export class SessionManager {
  private static readonly LOCAL_PERMISSION_TIMEOUT_MS = 60_000;
  private static readonly REMOTE_PERMISSION_TIMEOUT_MS = 5 * 60_000 + 30_000;
  private db: DatabaseInstance;
  private sendToRenderer: (event: ServerEvent) => void;
  private pathResolver: PathResolver;
  private sandboxAdapter: SandboxAdapter;
  private agentRunner!: AgentRunner;
  private mcpManager: MCPManager;
  private pluginRuntimeService?: PluginRuntimeService;
  private activeSessions: Map<string, AbortController> = new Map();
  private promptQueues: Map<string, QueuedPromptItem[]> = new Map();
  private pendingPermissions: Map<string, (result: PermissionResult) => void> = new Map();
  private pendingSudoPasswords: Map<
    string,
    { sessionId: string; resolve: (password: string | null) => void }
  > = new Map();
  private sandboxInitPromises: Map<string, Promise<void>> = new Map();
  private sessionTitleAttempts: Set<string> = new Set();
  private titleGenerationTokens: Map<string, symbol> = new Map();
  private messageCache: Map<string, Message[]> = new Map();
  private static readonly MAX_CACHE_SIZE = 100;
  private turnJournal = new TurnJournal();
  private activeTurnJournalIds: Map<string, string> = new Map();
  private isRemoteSession: (sessionId: string) => boolean;

  /** Optional Code Buddy engine adapter for in-process execution */
  private engineAdapter?: EngineAdapterLike;

  /** Optional project memory service (Claude Cowork parity) */
  private projectMemory?: ProjectMemoryServiceLike;

  /** Optional reference to the project manager for resolving session.projectId */
  private projectManager?: ProjectManagerLike;

  /** Optional mention processor (Claude Cowork parity) */
  private mentionProcessor?: MentionProcessorLike;

  /** Optional notification bridge (Claude Cowork parity) */
  private notificationBridge?: NotificationBridgeLike;

  /** Optional ICM cross-session memory integration (Claude Cowork parity) */
  private icmIntegration?: ICMIntegrationLike;

  constructor(
    db: DatabaseInstance,
    sendToRenderer: (event: ServerEvent) => void,
    pluginRuntimeService?: PluginRuntimeService,
    engineAdapter?: EngineAdapterLike,
    isRemoteSession: (sessionId: string) => boolean = () => false,
  ) {
    this.db = db;
    this.engineAdapter = engineAdapter;
    this.isRemoteSession = isRemoteSession;
    this.sendToRenderer = (event) => {
      if (event.type === 'trace.step') {
        this.saveTraceStep(event.payload.sessionId, event.payload.step);
        this.turnJournal.append(event.payload.sessionId, 'trace_step', {
          stepId: event.payload.step.id,
          stepType: event.payload.step.type,
          status: event.payload.step.status,
          title: event.payload.step.title,
          toolName: event.payload.step.toolName,
        });
      }
      if (event.type === 'trace.update') {
        const persistedUpdates = { ...event.payload.updates };
        delete persistedUpdates.toolOutputDelta;
        if (Object.keys(persistedUpdates).length > 0) {
          this.updateTraceStep(event.payload.stepId, persistedUpdates);
          this.turnJournal.append(event.payload.sessionId, 'trace_update', {
            stepId: event.payload.stepId,
            updates: persistedUpdates,
          });
        }
      }
      sendToRenderer(event);
    };
    this.pathResolver = new PathResolver();
    this.sandboxAdapter = getSandboxAdapter();
    this.pluginRuntimeService = pluginRuntimeService;

    // Initialize MCP Manager
    this.mcpManager = new MCPManager();
    this.initializeMCP();

    // Create agent runner based on current config
    this.createAgentRunner();

    log('[SessionManager] Initialized with persistent database and MCP support');
  }

  /** Inject project manager + memory service (wired from main/index.ts) */
  setProjectServices(
    projectManager: ProjectManagerLike,
    projectMemory: ProjectMemoryServiceLike,
  ): void {
    this.projectManager = projectManager;
    this.projectMemory = projectMemory;
  }

  /** Inject mention processor (wired from main/index.ts) */
  setMentionProcessor(processor: MentionProcessorLike): void {
    this.mentionProcessor = processor;
  }

  /** Inject notification bridge (wired from main/index.ts) */
  setNotificationBridge(bridge: NotificationBridgeLike): void {
    this.notificationBridge = bridge;
  }

  /** Inject ICM integration (wired from main/index.ts) */
  setICMIntegration(icm: ICMIntegrationLike): void {
    this.icmIntegration = icm;
  }

  /**
   * Create agent runner based on current config
   * Can be called to recreate runner when config changes
   */
  private createAgentRunner(): void {
    if (this.engineAdapter) {
      this.agentRunner = new CodeBuddyEngineRunner(
        this.engineAdapter,
        {
          sendToRenderer: this.sendToRenderer,
          saveMessage: (message: Message) => this.saveMessage(message),
        },
      );
      log('[SessionManager] Using Code Buddy engine runner (embedded)');
    } else {
      this.agentRunner = this.createClaudeAgentRunner();
      logWarn('[SessionManager] Using reduced pi-coding-agent runner (engine bundle absent) — full-fat features unavailable');
    }
  }

  private createClaudeAgentRunner(): ClaudeAgentRunner {
    return new ClaudeAgentRunner(
      {
        sendToRenderer: this.sendToRenderer,
        saveMessage: (message: Message) => this.saveMessage(message),
        requestSudoPassword: (sessionId: string, toolUseId: string, command: string) =>
          this.requestSudoPassword(sessionId, toolUseId, command),
      },
      this.pathResolver,
      this.mcpManager,
      this.pluginRuntimeService
    );
  }

  /**
   * Notify that API config changed.
   * Model/apiKey/baseUrl changes are picked up per-query via configStore.getAll()
   * and hot-swapped via piSession.setModel(). No need to recreate the runner.
   */
  reloadConfig(): void {
    log('[SessionManager] API config changed — will apply on next query');
  }

  /**
   * Reinitialize MCP servers (call only when MCP config actually changes)
   */
  async reloadMCP(): Promise<void> {
    log('[SessionManager] Reloading MCP servers');
    await this.initializeMCP();
    // Push to the embedded engine adapter too — see syncMcpServersToEngine.
    await this.syncMcpServersToEngine();
  }

  /**
   * Invalidate cached MCP servers config so the next query rebuilds tools.
   * Call after MCP server add/update/delete.
   */
  invalidateMcpServersCache(): void {
    if (this.agentRunner && 'invalidateMcpServersCache' in this.agentRunner) {
      (this.agentRunner as ClaudeAgentRunner).invalidateMcpServersCache();
    }
    // Phase 2 — Cowork-on-core migration: also push the new MCP server
    // list to the embedded engine adapter so its core MCPManager
    // singleton stays in sync with what the user has configured. The
    // pi runner rebuilds tools per-query (above), but the engine's
    // MCPManager is set once at boot and needs explicit refresh.
    void this.syncMcpServersToEngine();
  }

  private async syncMcpServersToEngine(): Promise<void> {
    if (!this.engineAdapter || typeof this.engineAdapter.setMcpServers !== 'function') {
      return;
    }
    try {
      const enabled = mcpConfigStore.getEnabledServers();
      const configs = enabled.map((s) => ({
        name: s.name,
        transport: toEngineTransport(s),
        enabled: true,
      }));
      await this.engineAdapter.setMcpServers(configs);
      log(`[SessionManager] synced ${configs.length} MCP server(s) to engine`);
    } catch (err) {
      logError('[SessionManager] syncMcpServersToEngine failed:', err);
    }
  }

  /**
   * Invalidate skills setup so the next query re-links skills.
   * Call after skill install/uninstall/toggle.
   */
  invalidateSkillsSetup(): void {
    if (this.agentRunner && 'invalidateSkillsSetup' in this.agentRunner) {
      (this.agentRunner as ClaudeAgentRunner).invalidateSkillsSetup();
    }
    // Phase 10 — hot-reload the engine's skills registry too. Pi
    // rebuilds skills per query (above); engine caches a global
    // SKILL.md registry that needs an explicit reload after install.
    void this.reloadSkillsOnEngine();
  }

  private async reloadSkillsOnEngine(): Promise<void> {
    if (!this.engineAdapter || typeof this.engineAdapter.reloadSkills !== 'function') {
      return;
    }
    try {
      await this.engineAdapter.reloadSkills();
      log('[SessionManager] reloaded skills on engine');
    } catch (err) {
      logError('[SessionManager] reloadSkillsOnEngine failed:', err);
    }
  }

  /**
   * Reinitialize sandbox adapter (call only when sandbox config changes)
   */
  async reloadSandbox(): Promise<void> {
    await this.reinitializeSandboxAsync();
  }

  /**
   * Reinitialize sandbox adapter asynchronously
   */
  private async reinitializeSandboxAsync(): Promise<void> {
    try {
      log('[SessionManager] Reinitializing sandbox adapter...');
      await reinitializeSandbox();
      this.sandboxAdapter = getSandboxAdapter();
      log('[SessionManager] Sandbox adapter reinitialized, mode:', this.sandboxAdapter.mode);
    } catch (error) {
      logError('[SessionManager] Failed to reinitialize sandbox:', error);
    }
  }

  /**
   * Initialize MCP servers from configuration
   */
  private async initializeMCP(): Promise<void> {
    try {
      const servers = mcpConfigStore.getEnabledServers();
      await this.mcpManager.initializeServers(servers);
      log(`[SessionManager] Initialized ${servers.length} MCP servers`);
      // Push the same set to the embedded engine adapter so its core
      // MCPManager singleton matches Cowork's view from boot. The
      // engine adapter is a no-op if not present (legacy bundles).
      await this.syncMcpServersToEngine();
    } catch (error) {
      logError('[SessionManager] Failed to initialize MCP servers:', error);
      this.sendToRenderer({
        type: 'error',
        payload: {
          message: `Failed to initialize MCP servers: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    }
  }

  /**
   * Get MCP manager instance
   */
  getMCPManager(): MCPManager {
    return this.mcpManager;
  }

  /**
   * Phase 3 — surface which agent runner is active so the renderer can
   * display a status badge. The `engineAdapter` field is populated at
   * boot (`cowork/src/main/index.ts:870-905`) when the embedded engine
   * bundle resolves; otherwise it stays undefined and we fall back to
   * pi. We also expose how many sessions the engine currently caches
   * so power users can spot leaks.
   */
  getRunnerStatus(): {
    runner: 'engine' | 'pi';
    engineReady: boolean;
    bootError: string | null;
  } {
    if (this.engineAdapter) {
      const adapter = this.engineAdapter as EngineAdapterLike & {
        isReady?: () => boolean;
      };
      const ready = typeof adapter.isReady === 'function' ? adapter.isReady() : true;
      return { runner: 'engine', engineReady: ready, bootError: null };
    }
    return { runner: 'pi', engineReady: false, bootError: null };
  }

  /**
   * Get sandbox adapter instance
   */
  getSandboxAdapter(): SandboxAdapter {
    return this.sandboxAdapter;
  }

  // Create and start a new session
  async startSession(
    title: string,
    prompt: string,
    cwd?: string,
    projectId?: string | null,
    allowedTools?: string[],
    content?: ContentBlock[],
    memoryEnabled: boolean = false
  ): Promise<Session> {
    log('[SessionManager] Starting new session:', title);

    // If no explicit cwd, fall back to active project's workspacePath
    let effectiveCwd = cwd;
    let resolvedProjectId: string | null = projectId ?? null;
    if (this.projectManager) {
      if (!resolvedProjectId) {
        resolvedProjectId = this.projectManager.getActiveId();
      }
      if (resolvedProjectId) {
        const activeProject = this.projectManager.get(resolvedProjectId);
        if (activeProject?.workspacePath && !effectiveCwd) {
          effectiveCwd = activeProject.workspacePath;
          log(
            '[SessionManager] Using active project workspace as cwd:',
            effectiveCwd
          );
        }
      }
    }

    // A relative/empty cwd must never resolve against the Electron process
    // cwd (cowork/ in dev). Anchor it under the safe base first.
    effectiveCwd = resolveSafeCwd(effectiveCwd, this.safeCwdBase());
    this.ensureCwdExists(effectiveCwd);
    // Trust only a cwd the caller EXPLICITLY chose (GUI folder pick), not the
    // active-project fallback — that one was trusted when the project opened.
    if (effectiveCwd) await this.trustSessionCwd(effectiveCwd);

    const session = this.createSession(title, effectiveCwd, allowedTools, memoryEnabled);

    // Attach active project if any (Claude Cowork parity)
    if (resolvedProjectId) {
      session.projectId = resolvedProjectId;
    }

    // Save to database
    this.saveSession(session);

    // Start processing the prompt with content blocks
    this.enqueuePrompt(session, prompt, content);

    return session;
  }

  /**
   * Start a background session (Claude Cowork parity).
   * Runs without requiring the UI to be focused; notifies on completion.
   */
  async startBackgroundSession(
    title: string,
    prompt: string,
    cwd?: string,
    projectId?: string,
    content?: ContentBlock[]
  ): Promise<Session> {
    log('[SessionManager] Starting background session:', title);

    // Resolve project + cwd
    let resolvedProjectId: string | null = projectId ?? null;
    if (!resolvedProjectId && this.projectManager) {
      resolvedProjectId = this.projectManager.getActiveId();
    }
    let effectiveCwd = cwd;
    if (!effectiveCwd && resolvedProjectId && this.projectManager) {
      const project = this.projectManager.get(resolvedProjectId);
      if (project?.workspacePath) {
        effectiveCwd = project.workspacePath;
      }
    }

    effectiveCwd = resolveSafeCwd(effectiveCwd, this.safeCwdBase());
    this.ensureCwdExists(effectiveCwd);
    if (effectiveCwd) await this.trustSessionCwd(effectiveCwd);

    const session = this.createSession(title, effectiveCwd);
    session.isBackground = true;
    if (resolvedProjectId) {
      session.projectId = resolvedProjectId;
    }

    this.saveSession(session);

    // Notify renderer that a background session was created
    this.sendToRenderer({
      type: 'session.update',
      payload: {
        sessionId: session.id,
        updates: { isBackground: true, projectId: session.projectId },
      },
    });

    // Enqueue prompt — executes without blocking UI
    this.enqueuePrompt(session, prompt, content);

    return session;
  }

  /**
   * A session's cwd must EXIST before the engine runs: with a missing
   * workingDirectory the agent's relative paths silently resolve against the
   * Electron process cwd (proven live: an AI app generation targeting a fresh
   * folder overwrote cowork's own index.html). Fail-open: an uncreatable path
   * is logged and the session proceeds with the old behavior.
   */
  /** Base for anchoring relative session cwds — the app's default working dir. */
  private safeCwdBase(): string {
    try {
      // Lazy require avoids a hard electron dep in unit tests of this module.
      const electron = require('electron') as { app?: { getPath: (n: string) => string } };
      const home = electron.app?.getPath('userData');
      if (home) return path.join(home, 'default_working_dir');
    } catch {
      /* not in electron — fall through */
    }
    return path.join(require('os').homedir(), '.codebuddy', 'projects');
  }

  private ensureCwdExists(cwd?: string): void {
    if (!cwd) return;
    try {
      if (!fs.existsSync(cwd)) {
        fs.mkdirSync(cwd, { recursive: true });
        log('[SessionManager] Created missing session cwd:', cwd);
      }
    } catch (err) {
      log('[SessionManager] Could not create session cwd:', cwd, err);
    }
  }

  /**
   * Trust the cwd the USER designated for this session (same consent model as
   * opening a workspace). Without it the core's trust gate blocks every write
   * tool in the session — proven live: an App Studio generation targeting
   * /tmp/e2e-meteo2 emitted its plan then stopped with "dossier non fiable,
   * create_file indisponible". The embedded engine shares the core module
   * graph, so the TrustFolderManager singleton applies immediately; blocked
   * dirs (/, /home, …) are still refused by trustFolder itself. Fail-open.
   */
  private async trustSessionCwd(cwd?: string): Promise<void> {
    if (!cwd) return;
    try {
      const mod = await loadCoreModule<{
        getTrustFolderManager: () => { isTrusted(p: string): boolean; trustFolder(p: string): boolean };
      }>('security/trust-folders.js');
      if (!mod?.getTrustFolderManager) return;
      const manager = mod.getTrustFolderManager();
      if (!manager.isTrusted(cwd)) {
        const trusted = manager.trustFolder(cwd);
        log('[SessionManager] Session cwd trust:', cwd, trusted ? 'granted' : 'refused (blocked dir)');
      }
    } catch (err) {
      log('[SessionManager] Could not trust session cwd:', cwd, err);
    }
  }

  // Create a new session object
  private buildMountedPaths(cwd?: string): Session['mountedPaths'] {
    if (!cwd) {
      return [];
    }
    return [{ virtual: WORKSPACE_MOUNT_VIRTUAL_PATH, real: cwd }];
  }

  private createSession(title: string, cwd?: string, allowedTools?: string[], memoryEnabled: boolean = false): Session {
    const now = Date.now();
    // Prefer frontend-provided cwd; fallback to env vars if provided
    const envCwd = process.env.COWORK_WORKDIR || process.env.WORKDIR || process.env.DEFAULT_CWD;
    const effectiveCwd = cwd || envCwd;
    return {
      id: uuidv4(),
      title,
      status: 'idle',
      cwd: effectiveCwd,
      mountedPaths: this.buildMountedPaths(effectiveCwd),
      allowedTools: allowedTools || [
        'askuserquestion',
        'todowrite',
        'todoread',
        'webfetch',
        'websearch',
        'read',
        'write',
        'edit',
        'list_directory',
        'glob',
        'grep',
        'computer_control',
        'bash',
        'execute_bash',
        'browser',
      ],
      memoryEnabled,
      model: configStore.get('model') || undefined,
      pinned: false,
      archived: false,
      tags: extractSessionTags(title),
      source: 'cowork',
      createdAt: now,
      updatedAt: now,
    };
  }

  // Save session to database
  private saveSession(session: Session) {
    this.db.sessions.create({
      id: session.id,
      title: session.title,
      claude_session_id: session.claudeSessionId || null,
      openai_thread_id: session.openaiThreadId || null,
      status: session.status,
      cwd: session.cwd || null,
      mounted_paths: JSON.stringify(session.mountedPaths),
      allowed_tools: JSON.stringify(session.allowedTools),
      memory_enabled: session.memoryEnabled ? 1 : 0,
      model: session.model || null,
      project_id: session.projectId ?? null,
      is_background: session.isBackground ? 1 : 0,
      execution_mode: session.executionMode ?? null,
      pinned: session.pinned ? 1 : 0,
      archived: session.archived ? 1 : 0,
      tags: JSON.stringify(session.tags ?? extractSessionTags(session.title)),
      source: session.source ?? 'cowork',
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    });
  }

  // Load session from database
  private loadSession(sessionId: string): Session | null {
    const row = this.db.sessions.get(sessionId);
    if (!row) return null;

    let mountedPaths;
    try {
      mountedPaths = JSON.parse(row.mounted_paths);
    } catch (e) {
      logError('[SessionManager] Failed to parse mounted_paths:', e);
      mountedPaths = [];
    }

    let allowedTools;
    try {
      allowedTools = JSON.parse(row.allowed_tools);
    } catch (e) {
      logError('[SessionManager] Failed to parse allowed_tools:', e);
      allowedTools = [];
    }

    return {
      id: row.id,
      title: row.title,
      claudeSessionId: row.claude_session_id || undefined,
      openaiThreadId: row.openai_thread_id || undefined,
      status: row.status as Session['status'],
      cwd: row.cwd || undefined,
      mountedPaths,
      allowedTools,
      memoryEnabled: row.memory_enabled === 1,
      model: row.model || undefined,
      projectId: row.project_id ?? null,
      isBackground: row.is_background === 1,
      executionMode: (row.execution_mode as 'chat' | 'task' | null) ?? undefined,
      pinned: row.pinned === 1,
      archived: row.archived === 1,
      tags: parseSessionTags(row.tags, row.title),
      source: row.source ?? 'cowork',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // List all sessions
  listSessions(): Session[] {
    const rows = this.db.sessions.getAll();

    return rows.map((row) => {
      let mountedPaths;
      try {
        mountedPaths = JSON.parse(row.mounted_paths);
      } catch (e) {
        logError('[SessionManager] Failed to parse mounted_paths:', e);
        mountedPaths = [];
      }

      let allowedTools;
      try {
        allowedTools = JSON.parse(row.allowed_tools);
      } catch (e) {
        logError('[SessionManager] Failed to parse allowed_tools:', e);
        allowedTools = [];
      }

      return {
        id: row.id,
        title: row.title,
        claudeSessionId: row.claude_session_id || undefined,
        openaiThreadId: row.openai_thread_id || undefined,
        status: row.status as Session['status'],
        cwd: row.cwd || undefined,
        mountedPaths,
        allowedTools,
        memoryEnabled: row.memory_enabled === 1,
        model: row.model || undefined,
        projectId: row.project_id ?? null,
        isBackground: row.is_background === 1,
        executionMode: (row.execution_mode as 'chat' | 'task' | null) ?? undefined,
        pinned: row.pinned === 1,
        archived: row.archived === 1,
        tags: parseSessionTags(row.tags, row.title),
        source: row.source ?? 'cowork',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  /**
   * Cross-session content search (Phase 3 — global search "Messages" tab).
   * Returns messages whose content matches the query substring, with the
   * snippet trimmed to the area around the first match. The renderer uses
   * the `sessionId` + `messageId` to navigate-and-highlight.
   */
  searchMessageContent(
    query: string,
    limit: number = 50
  ): Array<{
    messageId: string;
    sessionId: string;
    sessionTitle: string;
    role: string;
    snippet: string;
    matchOffset: number;
    timestamp: number;
    projectId: string | null;
  }> {
    if (typeof query !== 'string' || query.trim().length === 0) return [];
    const hits = this.db.messages.searchContent(query, limit);
    const needle = query.trim().toLowerCase();
    const SNIPPET_RADIUS = 60;
    return hits.map((hit) => {
      // The DB stores `content` as a JSON string. Decode it lazily; if
      // decoding fails (legacy plain-text rows), fall back to the raw value.
      let plain = hit.content;
      try {
        const parsed = JSON.parse(hit.content);
        if (typeof parsed === 'string') {
          plain = parsed;
        } else if (parsed && typeof parsed === 'object') {
          // Newer messages may store an array of content blocks; flatten
          // text fields into a single string for snippeting.
          plain = JSON.stringify(parsed);
          if (Array.isArray(parsed)) {
            const texts = parsed
              .map((b: { type?: string; text?: string }) =>
                b && typeof b.text === 'string' ? b.text : ''
              )
              .filter(Boolean);
            if (texts.length > 0) plain = texts.join(' ');
          } else if ('text' in parsed && typeof parsed.text === 'string') {
            plain = parsed.text;
          }
        }
      } catch {
        // Not JSON — already plain text.
      }
      const lower = plain.toLowerCase();
      const matchIdx = lower.indexOf(needle);
      const start = matchIdx >= 0 ? Math.max(0, matchIdx - SNIPPET_RADIUS) : 0;
      const end =
        matchIdx >= 0
          ? Math.min(plain.length, matchIdx + needle.length + SNIPPET_RADIUS)
          : Math.min(plain.length, SNIPPET_RADIUS * 2);
      const snippet =
        (start > 0 ? '…' : '') +
        plain.slice(start, end) +
        (end < plain.length ? '…' : '');
      return {
        messageId: hit.message_id,
        sessionId: hit.session_id,
        sessionTitle: hit.session_title,
        role: hit.role,
        snippet,
        matchOffset: matchIdx >= 0 ? matchIdx - start : 0,
        timestamp: hit.timestamp,
        projectId: hit.project_id,
      };
    });
  }

  private buildRecallPrefillContext(session: Session, prompt: string): string | null {
    if (!session.memoryEnabled) {
      return null;
    }
    const memoryStrategy = this.resolveMemoryStrategy(session);
    if (memoryStrategy === 'manual') {
      return null;
    }
    const recallLimits =
      memoryStrategy === 'rolling'
        ? { limit: 8, maxChars: 8_000, perSessionMaxChars: 700 }
        : { limit: 5, maxChars: 6_000, perSessionMaxChars: 900 };
    const recall = buildSessionRecallPrefill(prompt, this, {
      currentSessionId: session.id,
      cwd: session.cwd,
      ...recallLimits,
    });
    if (!recall.text || recall.entries.length === 0) {
      return null;
    }
    this.sendToRenderer({
      type: 'trace.step',
      payload: {
        sessionId: session.id,
        step: {
          id: `session-recall-prefill-${Date.now()}`,
          type: 'thinking',
          status: 'completed',
          title: 'Session recall prefill',
          content:
            `${recall.entries.length} prior session(s) matched ` +
            `from ${recall.totalCandidateCount} candidate(s)` +
            (recall.truncated ? ' (truncated)' : ''),
          timestamp: Date.now(),
        },
      },
    });
    this.turnJournal.append(
      session.id,
      'trace_update',
      {
        kind: 'session_recall_prefill',
        entries: recall.entries.map((entry) => ({
          sessionId: entry.sessionId,
          score: entry.score,
          messageIds: entry.messageIds,
        })),
        totalCandidateCount: recall.totalCandidateCount,
        truncated: recall.truncated,
      },
      this.activeTurnJournalIds.get(session.id)
    );
    return recall.text;
  }

  private shouldUseAutomatedMemory(session: Session): boolean {
    return this.resolveMemoryStrategy(session) !== 'manual';
  }

  private resolveMemoryStrategy(session: Session): 'auto' | 'manual' | 'rolling' {
    const projectStrategy = session.projectId ? this.projectManager?.get(session.projectId)?.memoryConfig?.memoryStrategy : undefined;
    if (projectStrategy === 'auto' || projectStrategy === 'manual' || projectStrategy === 'rolling') {
      return projectStrategy;
    }
    const globalStrategy = configStore.get('memoryStrategy');
    return globalStrategy === 'manual' || globalStrategy === 'rolling' ? globalStrategy : 'auto';
  }

  // Continue an existing session
  async continueSession(
    sessionId: string,
    prompt: string,
    content?: ContentBlock[]
  ): Promise<void> {
    log('[SessionManager] Continuing session:', sessionId);

    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.enqueuePrompt(session, prompt, content);
  }

  async steerSession(
    sessionId: string,
    prompt: string,
    content?: ContentBlock[],
    intentId?: string
  ): Promise<{ delivered: boolean; fallbackQueued: boolean }> {
    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const delivered = Boolean(
      this.activeSessions.has(sessionId) &&
        this.agentRunner.steer &&
        (await this.agentRunner.steer(sessionId, prompt))
    );

    if (!delivered) {
      this.enqueuePrompt(session, prompt, content);
      this.turnJournal.append(session.id, 'steer_fallback_queued', {
        intentId,
        promptPreview: prompt.slice(0, 240),
      });
      return { delivered: false, fallbackQueued: true };
    }

    const steerMessage: Message = {
      id: uuidv4(),
      sessionId: session.id,
      role: 'user',
      content: content && content.length > 0 ? content : [{ type: 'text', text: prompt }],
      timestamp: Date.now(),
      metadata: {
        pendingIntent: {
          kind: 'steer',
          status: 'delivered',
          sourceIntentId: intentId,
        },
      },
    };
    this.saveMessage(steerMessage);
    this.turnJournal.append(session.id, 'steer_delivered', {
      intentId,
      messageId: steerMessage.id,
      promptPreview: prompt.slice(0, 240),
    });
    this.sendToRenderer({
      type: 'stream.message',
      payload: { sessionId: session.id, message: steerMessage },
    });
    return { delivered: true, fallbackQueued: false };
  }

  async generateSessionTitleFromPrompt(prompt: string): Promise<string> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return 'New Session';
    }

    const generated = await this.withTimeout(
      this.generateTitleWithConfig(buildTitlePrompt(normalizedPrompt)),
      TITLE_GENERATION_TIMEOUT_MS,
      'session-title-preview'
    );
    const normalizedGenerated = normalizeGeneratedTitle(generated);
    return normalizedGenerated ?? getDefaultTitleFromPrompt(normalizedPrompt);
  }

  async generateScheduledTaskTitle(prompt: string): Promise<string> {
    const sessionTitle = await this.generateSessionTitleFromPrompt(prompt);
    return buildScheduledTaskTitle(sessionTitle);
  }

  /**
   * Ensure sandbox is initialized for the session's workspace
   */
  private async ensureSandboxInitialized(session: Session): Promise<void> {
    if (!session.cwd) {
      log('[SessionManager] No workspace directory, skipping sandbox init');
      return;
    }

    // Check if already initialized with this exact workspace
    if (this.sandboxAdapter.initialized && this.sandboxAdapter.workspacePath === session.cwd) {
      return;
    }

    // Check if initialization is already in progress
    const existingPromise = this.sandboxInitPromises.get(session.cwd);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    // Initialize sandbox with workspace
    const initPromise = initializeSandbox({
      workspacePath: session.cwd,
      mainWindow: null, // Will show dialogs globally
    }).then(() => {
      /* void */
    });

    this.sandboxInitPromises.set(session.cwd, initPromise);

    try {
      await initPromise;
      log('[SessionManager] Sandbox initialized for workspace:', session.cwd);
      log('[SessionManager] Sandbox mode:', this.sandboxAdapter.mode);
    } catch (error) {
      logError('[SessionManager] Failed to initialize sandbox:', error);
      this.sendToRenderer({
        type: 'error',
        payload: {
          message: `Failed to initialize sandbox: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      // Continue anyway - sandbox adapter will fallback to native
    } finally {
      this.sandboxInitPromises.delete(session.cwd);
    }
  }

  // Helper: Copy files to session's .tmp directory and sync to sandbox if needed
  private async processFileAttachments(
    session: Session,
    content: ContentBlock[]
  ): Promise<ContentBlock[]> {
    const processedContent: ContentBlock[] = [];
    const usedAttachmentFilenames = new Set<string>();

    for (const block of content) {
      if (block.type === 'file_attachment') {
        const fileBlock = block as FileAttachmentContent;

        try {
          // Create .tmp directory if it doesn't exist
          const tmpDir = path.join(session.cwd || process.cwd(), '.tmp');
          if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
            log('[SessionManager] Created .tmp directory:', tmpDir);
          }

          // Get source file path from the file attachment
          const sourcePath = (fileBlock.relativePath || '').trim(); // This is the full path from Electron
          // IMPORTANT: Use path.basename() to extract only the filename, not the full path
          const fallbackFilename = fileBlock.filename || sourcePath || `attachment-${Date.now()}`;
          const destFilename = createUniqueAttachmentFilename(
            fallbackFilename,
            usedAttachmentFilenames,
            (candidate) => fs.existsSync(path.join(tmpDir, candidate))
          );
          if (!destFilename) continue;
          const destPath = path.join(tmpDir, destFilename);
          let actualSize = 0;

          // Copy file to .tmp directory
          if (sourcePath && fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);

            // Get actual file size
            const stats = fs.statSync(destPath);
            actualSize = stats.size;

            log(
              '[SessionManager] Copied file:',
              sourcePath,
              '->',
              destPath,
              `(${actualSize} bytes)`
            );
          } else if (fileBlock.inlineDataBase64) {
            const buffer = Buffer.from(fileBlock.inlineDataBase64, 'base64');
            fs.writeFileSync(destPath, buffer);
            actualSize = buffer.length;
            log('[SessionManager] Wrote file from inline data:', destPath, `(${actualSize} bytes)`);
          } else {
            logError(
              '[SessionManager] Source file not found and inline data missing:',
              sourcePath || '(empty path)'
            );
            // Skip this file attachment
            continue;
          }

          // If sandbox is already initialized, sync the file to sandbox as well
          // This handles the case where user attaches files in subsequent messages
          const sandboxPath = SandboxSync.getSandboxPath(session.id);
          if (sandboxPath) {
            const sandboxRelativePath = `.tmp/${destFilename}`;
            log('[SessionManager] Syncing attached file to sandbox:', sandboxRelativePath);
            const syncResult = await SandboxSync.syncFileToSandbox(
              session.id,
              destPath,
              sandboxRelativePath
            );
            if (syncResult.success) {
              log('[SessionManager] File synced to sandbox:', syncResult.sandboxPath);
            } else {
              logError('[SessionManager] Failed to sync file to sandbox:', syncResult.error);
              // Continue anyway - file is in Windows .tmp, agent might still work via /mnt/
            }
          } else {
            // Check for Lima sandbox
            const { LimaSync } = await import('../sandbox/lima-sync');
            const limaSandboxPath = LimaSync.getSandboxPath(session.id);
            if (limaSandboxPath) {
              const sandboxRelativePath = `.tmp/${destFilename}`;
              log('[SessionManager] Syncing attached file to Lima sandbox:', sandboxRelativePath);
              const syncResult = await LimaSync.syncFileToSandbox(
                session.id,
                destPath,
                sandboxRelativePath
              );
              if (syncResult.success) {
                log('[SessionManager] File synced to Lima sandbox:', syncResult.sandboxPath);
              } else {
                logError('[SessionManager] Failed to sync file to Lima sandbox:', syncResult.error);
                // Continue anyway - file is in macOS .tmp, agent might still work via direct access
              }
            }
          }

          // Update the content block with the new relative path and actual size
          const relativePathFromCwd = path.join('.tmp', destFilename);
          const restFileBlock = { ...fileBlock };
          delete restFileBlock.inlineDataBase64;
          processedContent.push({
            ...restFileBlock,
            relativePath: relativePathFromCwd,
            size: actualSize,
          });
        } catch (error) {
          logError('[SessionManager] Error copying file:', error);
          this.sendToRenderer({
            type: 'error',
            payload: {
              message: `Failed to process file attachment: ${error instanceof Error ? error.message : String(error)}`,
            },
          });
          // Skip this file attachment
        }
      } else {
        // Keep other content blocks as-is
        processedContent.push(block);
      }
    }

    return processedContent;
  }

  // Process a prompt using ClaudeAgentRunner
  private async processPrompt(
    session: Session,
    prompt: string,
    content?: ContentBlock[],
    options?: { turnId?: string }
  ): Promise<void> {
    const traceId = options?.turnId ?? generateTraceId();
    return runWithLogContext({ sessionId: session.id, traceId }, async () => {
      logCtx('[SessionManager] Processing prompt for session:', session.id, 'traceId:', traceId);
      this.turnJournal.append(
        session.id,
        'turn_started',
        {
          promptPreview: prompt.slice(0, 240),
          contentTypes: content?.map((block) => block.type) ?? ['text'],
        },
        traceId
      );
      logCtx(
        '[SessionManager] Received content:',
        content
          ? JSON.stringify(
              content.map((c) => ({
                type: c.type,
                hasData: !!(c as { source?: { data?: unknown } }).source?.data,
              }))
            )
          : 'none'
      );

      // Ensure sandbox is initialized for this workspace
      await this.ensureSandboxInitialized(session);

      this.activeTurnJournalIds.set(session.id, traceId);
      try {
        // Use provided content blocks or fall back to simple text
        let messageContent: ContentBlock[] =
          content && content.length > 0 ? content : [{ type: 'text', text: prompt } as TextContent];

        // Process file attachments - copy to .tmp directory
        messageContent = await this.processFileAttachments(session, messageContent);

        logCtx(
          '[SessionManager] Final message content types:',
          messageContent.map((c) => c.type)
        );

        // Build enhanced prompt with file information
        const fileAttachments = messageContent.filter(
          (c) => c.type === 'file_attachment'
        ) as FileAttachmentContent[];
        const promptForAgent =
          prompt.trim() || buildAttachmentOnlyPrompt(fileAttachments) || prompt;
        let enhancedPrompt = promptForAgent;
        if (fileAttachments.length > 0) {
          const fileContext = await buildAttachedFilesPromptContext(
            fileAttachments,
            session.cwd,
            promptForAgent
          );
          enhancedPrompt = `${promptForAgent}\n\n${fileContext}`;
          logCtx('[SessionManager] Enhanced prompt with file info:', enhancedPrompt);
        } else {
          // No attachment, but a YouTube URL in the prompt still routes to
          // understand_video (source = URL) — buildAttachedFilesPromptContext
          // only runs when files are present, so cover the no-attachment case.
          const urlVideoGuidance = buildYoutubeVideoGuidance(promptForAgent);
          if (urlVideoGuidance) {
            enhancedPrompt = `${promptForAgent}\n\n${urlVideoGuidance}`;
            logCtx('[SessionManager] Enhanced prompt with YouTube URL guidance');
          }
        }

        // Process @mentions in the prompt (Claude Cowork parity)
        if (this.mentionProcessor && enhancedPrompt.includes('@')) {
          try {
            const mentionResult = await this.mentionProcessor.process(enhancedPrompt, session.cwd);
            if (mentionResult.contextBlocks.length > 0) {
              enhancedPrompt = this.mentionProcessor.buildEnhancedPrompt(mentionResult);
              logCtx(
                '[SessionManager] Processed',
                mentionResult.contextBlocks.length,
                '@mentions'
              );
            }
          } catch (err) {
            logCtxError('[SessionManager] Mention processing failed:', err);
          }
        }

        const useAutomatedMemory = this.shouldUseAutomatedMemory(session);

        // Inject project memory context (Claude Cowork parity)
        const projectId = session.projectId ?? this.projectManager?.getActiveId() ?? null;
        if (useAutomatedMemory && projectId && this.projectMemory) {
          try {
            const projectContext = await this.projectMemory.loadProjectContext(projectId);
            if (projectContext) {
              enhancedPrompt = `${projectContext}\n\n${enhancedPrompt}`;
              logCtx('[SessionManager] Injected project memory for', projectId);
            }
          } catch (err) {
            logCtxError('[SessionManager] Failed to inject project memory:', err);
          }
        }

        // Query ICM cross-session memory (Claude Cowork parity)
        if (useAutomatedMemory && this.icmIntegration?.isAvailable()) {
          try {
            const memories = await this.icmIntegration.searchRelevantMemories(
              promptForAgent,
              projectId ?? undefined,
              5
            );
            const icmBlock = this.icmIntegration.formatContextBlock(memories);
            if (icmBlock) {
              enhancedPrompt = `${icmBlock}\n\n${enhancedPrompt}`;
              logCtx('[SessionManager] Injected', memories.length, 'ICM memories');
            }
          } catch (err) {
            logCtxError('[SessionManager] ICM search failed:', err);
          }
        }

        const recallPrefill = this.buildRecallPrefillContext(session, promptForAgent);
        if (recallPrefill) {
          enhancedPrompt = `${recallPrefill}\n\n${enhancedPrompt}`;
          logCtx('[SessionManager] Injected session recall prefill');
        }

        // Save user message to database for persistence
        const existingMessages = this.getMessages(session.id);
        const userMessageId = uuidv4();
        const submissionSnapshot = buildTurnSubmissionSnapshot(messageContent);
        this.turnJournal.append(
          session.id,
          'turn_submitted',
          {
            messageId: userMessageId,
            role: 'user',
            content: submissionSnapshot.content,
            recoverable: submissionSnapshot.recoverable,
            nonRecoverableTypes: submissionSnapshot.nonRecoverableTypes,
            promptPreview: promptForAgent.slice(0, 240),
            contentTypes: messageContent.map((block) => block.type),
          },
          traceId
        );
        const userMessage: Message = {
          id: userMessageId,
          sessionId: session.id,
          role: 'user',
          content: messageContent, // Save full content including images and files
          timestamp: Date.now(),
        };
        this.saveMessage(userMessage);
        logCtx(
          '[SessionManager] User message saved:',
          userMessage.id,
          'with',
          messageContent.length,
          'content blocks'
        );
        const messagesForContext = [...existingMessages, userMessage];

        // Update session model to match current config (may have changed since session creation)
        const currentModel = configStore.get('model');
        if (currentModel && currentModel !== session.model) {
          session.model = currentModel;
          this.db.sessions.update(session.id, { model: currentModel });
          this.sendToRenderer({
            type: 'session.update',
            payload: { sessionId: session.id, updates: { model: currentModel } },
          });
        }

        // Run the agent
        await this.agentRunner.run(session, enhancedPrompt, messagesForContext);
        this.turnJournal.append(session.id, 'turn_completed', {}, traceId);

        // Store ICM episode for cross-session recall (Claude Cowork parity)
        if (useAutomatedMemory && this.icmIntegration?.isAvailable()) {
          void this.icmIntegration
            .storeEpisode(
              `User asked: ${promptForAgent.slice(0, 500)}`,
              {
                sessionId: session.id,
                projectId: projectId ?? undefined,
                tags: ['cowork', 'user-query'],
                source: 'cowork-session',
              }
            )
            .catch((err: unknown) => logCtxError('[SessionManager] ICM store failed:', err));
        }

        // Notify task completion for background sessions or long tasks (Claude Cowork parity)
        if (this.notificationBridge && session.isBackground) {
          try {
            this.notificationBridge.notifyTaskComplete(
              session.id,
              `Background task "${session.title ?? session.id}" completed`,
              true
            );
          } catch (err) {
            logCtxError('[SessionManager] Notification dispatch failed:', err);
          }
        }

        // Consolidate project memory asynchronously (Claude Cowork parity)
        if (useAutomatedMemory && projectId && this.projectMemory) {
          void this.projectMemory
            .consolidateSessionMemory(
              projectId,
              session.id,
              messagesForContext.map((m) => ({
                role: m.role,
                content: typeof m.content === 'string'
                  ? m.content
                  : m.content
                      .filter((c) => c.type === 'text')
                      .map((c) => (c as { text: string }).text)
                      .join('\n'),
              }))
            )
            .then((result) => {
              if (result && result.added > 0) {
                log(`[SessionManager] Consolidated ${result.added} memories for project ${projectId}`);
              }
            })
            .catch((err) => logCtxError('[SessionManager] Memory consolidation failed:', err));
        }

        // 标题生成不再与首轮对话并发，避免与主请求竞争同一上游配额/通道导致体感变慢。
        this.runSessionTitleGeneration(session, promptForAgent, existingMessages).catch((err) =>
          logCtxError('[SessionManager] Title generation failed:', err)
        );
      } catch (error) {
        logCtxError('[SessionManager] Error processing prompt:', error);
        const errorText = error instanceof Error ? error.message : 'Unknown error';
        this.turnJournal.append(session.id, 'turn_failed', { error: errorText }, traceId);
        const alreadyReportedToUser = Boolean(
          error &&
          typeof error === 'object' &&
          (error as { alreadyReportedToUser?: boolean }).alreadyReportedToUser
        );
        if (!alreadyReportedToUser) {
          const assistantMessage: Message = {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: `**Error**: ${errorText}` }],
            timestamp: Date.now(),
          };
          this.saveMessage(assistantMessage);
          this.sendToRenderer({
            type: 'stream.message',
            payload: { sessionId: session.id, message: assistantMessage },
          });
        }
        this.sendToRenderer({
          type: 'error',
          payload: { sessionId: session.id, message: errorText },
        });
      } finally {
        this.activeTurnJournalIds.delete(session.id);
      }
    }); // end runWithLogContext
  }

  private async runSessionTitleGeneration(
    session: Session,
    prompt: string,
    existingMessages: Message[]
  ): Promise<void> {
    const token = Symbol(`title:${session.id}`);
    this.titleGenerationTokens.set(session.id, token);
    const shouldAbort = () => {
      if (this.titleGenerationTokens.get(session.id) !== token) {
        return true;
      }
      return !this.db.sessions.get(session.id);
    };
    const userMessageCount =
      existingMessages.filter((message) => message.role === 'user').length + 1;
    try {
      await maybeGenerateSessionTitle({
        sessionId: session.id,
        prompt,
        userMessageCount,
        currentTitle: session.title,
        hasAttempted: this.sessionTitleAttempts.has(session.id),
        generateTitle: async (titlePrompt) => {
          if (shouldAbort()) {
            return null;
          }
          const title = await this.withTimeout(
            this.generateTitleWithConfig(titlePrompt),
            TITLE_GENERATION_TIMEOUT_MS,
            session.id
          );
          return normalizeGeneratedTitle(title);
        },
        getLatestTitle: () => this.db.sessions.get(session.id)?.title ?? null,
        markAttempt: () => {
          this.sessionTitleAttempts.add(session.id);
        },
        updateTitle: async (title) => {
          if (shouldAbort()) {
            log('[SessionTitle] Skip update: session no longer active', session.id);
            return false;
          }
          const updated = this.updateSessionTitle(session.id, title);
          if (updated) {
            session.title = title;
          }
          return updated;
        },
        shouldAbort,
        log,
      });
    } catch (error) {
      logError('[SessionTitle] Unexpected error', session.id, error);
    } finally {
      if (this.titleGenerationTokens.get(session.id) === token) {
        this.titleGenerationTokens.delete(session.id);
      }
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    sessionId: string
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logError('[SessionTitle] Generation timed out', { sessionId, timeoutMs });
        resolve(null);
      }, timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          logError('[SessionTitle] Generation rejected', { sessionId, error });
          resolve(null);
        });
    });
  }

  private async generateTitleWithConfig(titlePrompt: string): Promise<string | null> {
    // Always use pi-ai SDK for title generation
    return normalizeGeneratedTitle(
      await generateTitleWithClaudeSdk(titlePrompt, configStore.getAll())
    );
  }

  private enqueuePrompt(
    session: Session,
    prompt: string,
    content?: ContentBlock[],
    options?: { turnId?: string; recordJournal?: boolean }
  ): void {
    const turnId = options?.turnId ?? generateTraceId();
    const queue = this.promptQueues.get(session.id) || [];
    queue.push({ turnId, prompt, content });
    this.promptQueues.set(session.id, queue);
    if (options?.recordJournal !== false) {
      const submissionSnapshot = content ? buildTurnSubmissionSnapshot(content) : null;
      this.turnJournal.append(
        session.id,
        'intent_queued',
        {
          turnId,
          prompt,
          promptPreview: prompt.slice(0, 240),
          queueLength: queue.length,
          contentTypes: content?.map((block) => block.type) ?? ['text'],
          ...(submissionSnapshot
            ? {
                recoverable: submissionSnapshot.recoverable,
                nonRecoverableTypes: submissionSnapshot.nonRecoverableTypes,
                contentSnapshot: submissionSnapshot.content,
              }
            : {}),
        },
        turnId
      );
    }

    if (!this.activeSessions.has(session.id)) {
      this.processQueue(session).catch((err) => {
        logError('[SessionManager] Queue processing error:', err);
        this.sendToRenderer({
          type: 'error',
          payload: {
            message: `Failed to process message: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      });
    } else {
      log('[SessionManager] Session running, queued prompt:', session.id);
    }
  }

  private async processQueue(session: Session): Promise<void> {
    if (this.activeSessions.has(session.id)) return;

    const controller = new AbortController();
    this.activeSessions.set(session.id, controller);
    this.updateSessionStatus(session.id, 'running');

    try {
      // Outer loop: after the inner loop drains, re-check for items that
      // arrived while processPrompt was awaited. This keeps the session in
      // activeSessions the entire time, preventing enqueuePrompt from
      // spawning a duplicate processQueue during the gap that previously
      // existed between activeSessions.delete and the restart call.
      let shouldContinue = true;
      while (shouldContinue) {
        while (!controller.signal.aborted) {
          const queue = this.promptQueues.get(session.id);
          if (!queue || queue.length === 0) break;

          const item = queue.shift();
          if (!item) continue;

          const latestSession = this.loadSession(session.id);
          if (!latestSession) {
            log('[SessionManager] Session removed while processing queue:', session.id);
            return; // finally handles cleanup
          }

          await this.processPrompt(latestSession, item.prompt, item.content, {
            turnId: item.turnId,
          });

          if (controller.signal.aborted) return; // finally handles cleanup
        }

        // If aborted, exit immediately — finally handles cleanup.
        if (controller.signal.aborted) {
          shouldContinue = false;
          continue;
        }

        // Re-check: items may have been enqueued during the last processPrompt await.
        const pendingQueue = this.promptQueues.get(session.id);
        if (!pendingQueue || pendingQueue.length === 0) {
          shouldContinue = false;
          continue;
        }

        // Reload session before continuing with newly arrived prompts.
        const latestSession = this.loadSession(session.id);
        if (!latestSession) {
          this.promptQueues.delete(session.id);
          shouldContinue = false;
          continue;
        }
        session = latestSession;
        log('[SessionManager] Continuing queue with newly arrived prompts:', session.id);
      }
    } finally {
      // Only clean up here — no restart logic needed since the outer loop
      // already handles re-checking. activeSessions is only deleted once
      // there are truly no pending items remaining.
      this.activeSessions.delete(session.id);
      const queue = this.promptQueues.get(session.id);
      if (queue && queue.length === 0) {
        this.promptQueues.delete(session.id);
      }
      this.updateSessionStatus(session.id, 'idle');
    }
  }

  // Stop a running session
  stopSession(sessionId: string): void {
    log('[SessionManager] Stopping session:', sessionId);
    this.turnJournal.append(
      sessionId,
      'cancel_requested',
      {},
      this.activeTurnJournalIds.get(sessionId)
    );
    this.titleGenerationTokens.delete(sessionId);
    this.agentRunner.cancel(sessionId);
    // Cancel any pending sudo password requests for this session
    for (const [toolUseId, entry] of this.pendingSudoPasswords) {
      if (entry.sessionId === sessionId) {
        entry.resolve(null);
        this.pendingSudoPasswords.delete(toolUseId);
        this.sendToRenderer({ type: 'sudo.password.dismiss', payload: { toolUseId } });
      }
    }
    // Also abort any pending controller we tracked
    const controller = this.activeSessions.get(sessionId);
    if (controller) {
      controller.abort();
    }
    this.promptQueues.delete(sessionId);
    this.messageCache.delete(sessionId);
    this.updateSessionStatus(sessionId, 'idle');
  }

  // Delete a session
  async deleteSession(sessionId: string): Promise<void> {
    // Stop if running
    this.stopSession(sessionId);

    // Sync and cleanup sandbox if it exists for this session
    if (SandboxSync.hasSession(sessionId)) {
      log('[SessionManager] Cleaning up sandbox for session:', sessionId);
      try {
        await SandboxSync.syncAndCleanup(sessionId);
        log('[SessionManager] Sandbox cleanup complete for session:', sessionId);
      } catch (error) {
        logError('[SessionManager] Failed to cleanup sandbox:', error);
        // Continue with session deletion even if sandbox cleanup fails
      }
    }

    // Delete from database (messages will be deleted automatically via CASCADE)
    this.db.sessions.delete(sessionId);
    this.messageCache.delete(sessionId);
    this.sessionTitleAttempts.delete(sessionId);
    this.titleGenerationTokens.delete(sessionId);
    this.turnJournal.delete(sessionId);

    log('[SessionManager] Session deleted:', sessionId);
  }

  async batchDeleteSessions(sessionIds: string[]): Promise<void> {
    // Stop sessions and clean up sandboxes first (async, cannot run inside SQLite transaction)
    for (const sessionId of sessionIds) {
      this.stopSession(sessionId);
      if (SandboxSync.hasSession(sessionId)) {
        try {
          await SandboxSync.syncAndCleanup(sessionId);
        } catch (error) {
          logError('[SessionManager] Failed to cleanup sandbox during batch delete:', error);
        }
      }
    }

    // Perform all SQLite deletions atomically
    this.db.raw.transaction(() => {
      for (const sessionId of sessionIds) {
        this.db.sessions.delete(sessionId);
        this.messageCache.delete(sessionId);
        this.sessionTitleAttempts.delete(sessionId);
        this.titleGenerationTokens.delete(sessionId);
        this.turnJournal.delete(sessionId);
      }
    })();

    log('[SessionManager] Batch deleted sessions:', sessionIds.length);
  }

  // Update session status
  private updateSessionStatus(sessionId: string, status: Session['status']): void {
    this.db.sessions.update(sessionId, { status, updated_at: Date.now() });

    this.sendToRenderer({
      type: 'session.status',
      payload: { sessionId, status },
    });
  }

  /** Update project assignment / execution mode / background flag (Claude Cowork parity) */
  updateSessionSettings(
    sessionId: string,
    updates: {
      projectId?: string | null;
      executionMode?: 'chat' | 'task';
      isBackground?: boolean;
      title?: string;
      pinned?: boolean;
      archived?: boolean;
      tags?: string[];
      source?: string;
    }
  ): boolean {
    const existing = this.db.sessions.get(sessionId);
    if (!existing) {
      logWarn('[SessionManager] updateSessionSettings: unknown session', sessionId);
      return false;
    }

    const dbUpdates: Record<string, unknown> = {};
    if (updates.projectId !== undefined) dbUpdates.project_id = updates.projectId;
    if (updates.executionMode !== undefined) dbUpdates.execution_mode = updates.executionMode;
    if (updates.isBackground !== undefined) dbUpdates.is_background = updates.isBackground ? 1 : 0;
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.pinned !== undefined) dbUpdates.pinned = updates.pinned ? 1 : 0;
    if (updates.archived !== undefined) dbUpdates.archived = updates.archived ? 1 : 0;
    if (updates.tags !== undefined) dbUpdates.tags = JSON.stringify(updates.tags);
    if (updates.source !== undefined) dbUpdates.source = updates.source;
    if (updates.title !== undefined && updates.tags === undefined) {
      dbUpdates.tags = JSON.stringify(extractSessionTags(updates.title));
    }

    if (Object.keys(dbUpdates).length === 0) return true;

    this.db.sessions.update(sessionId, dbUpdates);

    // Echo to renderer
    const rendererUpdates: Record<string, unknown> = {};
    if (updates.projectId !== undefined) rendererUpdates.projectId = updates.projectId;
    if (updates.executionMode !== undefined) rendererUpdates.executionMode = updates.executionMode;
    if (updates.isBackground !== undefined) rendererUpdates.isBackground = updates.isBackground;
    if (updates.title !== undefined) rendererUpdates.title = updates.title;
    if (updates.pinned !== undefined) rendererUpdates.pinned = updates.pinned;
    if (updates.archived !== undefined) rendererUpdates.archived = updates.archived;
    if (updates.tags !== undefined) rendererUpdates.tags = updates.tags;
    if (updates.source !== undefined) rendererUpdates.source = updates.source;
    if (updates.title !== undefined && updates.tags === undefined) {
      rendererUpdates.tags = extractSessionTags(updates.title);
    }

    this.sendToRenderer({
      type: 'session.update',
      payload: { sessionId, updates: rendererUpdates as Partial<Session> },
    });

    return true;
  }

  duplicateSession(sessionId: string): Session | null {
    const existing = this.loadSession(sessionId);
    if (!existing) {
      logWarn('[SessionManager] duplicateSession: unknown session', sessionId);
      return null;
    }

    const now = Date.now();
    const duplicate: Session = {
      ...existing,
      id: uuidv4(),
      title: `${existing.title} copy`,
      status: 'idle',
      claudeSessionId: undefined,
      openaiThreadId: undefined,
      pinned: false,
      archived: false,
      tags: existing.tags ?? extractSessionTags(existing.title),
      source: existing.source ?? 'cowork',
      createdAt: now,
      updatedAt: now,
    };

    const toolUseIdMap = new Map<string, string>();
    const turnIdMap = new Map<string, string>();
    const messages = this.getMessages(sessionId).map((message, index) => ({
      ...message,
      id: uuidv4(),
      sessionId: duplicate.id,
      content: remapDuplicatedContentBlocks(message.content, toolUseIdMap),
      metadata: remapDuplicatedMessageMetadata(message.metadata, turnIdMap),
      timestamp: now + index,
      localStatus: undefined,
    }));
    const traceSteps = this.getTraceSteps(sessionId);

    this.db.raw.transaction(() => {
      this.saveSession(duplicate);
      for (const message of messages) {
        this.db.messages.create({
          id: message.id,
          session_id: message.sessionId,
          role: message.role,
          content: JSON.stringify(message.content),
          timestamp: message.timestamp,
          token_usage: message.tokenUsage ? JSON.stringify(message.tokenUsage) : null,
          execution_time_ms: message.executionTimeMs ?? null,
          metadata: message.metadata ? JSON.stringify(message.metadata) : null,
        });
      }
      for (const [index, step] of traceSteps.entries()) {
        const stepId = toolUseIdMap.get(step.id) ?? uuidv4();
        this.db.traceSteps.create({
          id: stepId,
          session_id: duplicate.id,
          type: step.type,
          status: step.status,
          title: step.title,
          content: step.content ?? null,
          tool_name: step.toolName ?? null,
          tool_input: step.toolInput ? JSON.stringify(step.toolInput) : null,
          tool_output: step.toolOutput ?? null,
          is_error: step.isError ? 1 : null,
          timestamp: now + index,
          duration: step.duration ?? null,
        });
      }
    })();

    this.messageCache.set(duplicate.id, messages);
    log('[SessionManager] Duplicated session:', sessionId, '->', duplicate.id);
    return duplicate;
  }

  private updateSessionTitle(sessionId: string, title: string): boolean {
    const existing = this.db.sessions.get(sessionId);
    if (!existing) {
      log('[SessionTitle] Skip title update for deleted session:', sessionId);
      return false;
    }
    const tags = extractSessionTags(title);
    this.db.sessions.update(sessionId, { title, tags: JSON.stringify(tags) });
    this.sendToRenderer({
      type: 'session.update',
      payload: { sessionId, updates: { title, tags } },
    });
    return true;
  }

  // Update session's working directory
  // Also clears SDK session cache because Claude SDK sessions are bound to cwd
  updateSessionCwd(sessionId: string, cwd: string): void {
    if (this.activeSessions.has(sessionId)) {
      logWarn(
        '[SessionManager] CWD change requested while session running; stopping active run first',
        { sessionId, cwd }
      );
      this.stopSession(sessionId);
    }
    const mountedPaths = this.buildMountedPaths(cwd);
    // Clear claude_session_id in DB so next query creates a new SDK session
    // (Claude SDK sessions cannot change cwd mid-session)
    this.db.sessions.update(sessionId, {
      cwd,
      mounted_paths: JSON.stringify(mountedPaths),
      claude_session_id: null,
      openai_thread_id: null,
      updated_at: Date.now(),
    });

    // Also clear the in-memory SDK session cache
    if (this.agentRunner?.clearSdkSession) {
      this.agentRunner.clearSdkSession(sessionId);
    }

    this.sendToRenderer({
      type: 'session.update',
      payload: { sessionId, updates: { cwd, mountedPaths } },
    });

    log('[SessionManager] Session cwd updated:', sessionId, '->', cwd, '(SDK session cleared)');
  }

  // Save message to database
  saveMessage(message: Message): void {
    const activeTurnId = this.activeTurnJournalIds.get(message.sessionId);
    if (activeTurnId && !message.metadata?.turn) {
      message.metadata = {
        ...message.metadata,
        turn: {
          id: activeTurnId,
          role: message.role,
        },
      };
    }
    this.db.messages.create({
      id: message.id,
      session_id: message.sessionId,
      role: message.role,
      content: JSON.stringify(message.content),
      timestamp: message.timestamp,
      token_usage: message.tokenUsage ? JSON.stringify(message.tokenUsage) : null,
      execution_time_ms: message.executionTimeMs ?? null,
      metadata: message.metadata ? JSON.stringify(message.metadata) : null,
    });
    const cached = this.messageCache.get(message.sessionId);
    if (cached) {
      cached.push(message);
    } else {
      // Only evict when the cache could actually grow (i.e. the session is
      // not cached yet). Evicting on every saveMessage call is wrong because
      // the Map size didn't increase — we just appended to an existing array —
      // and the oldest entry could be the very session we just updated.
      if (this.messageCache.size > SessionManager.MAX_CACHE_SIZE) {
        const firstKey = this.messageCache.keys().next().value;
        if (firstKey) this.messageCache.delete(firstKey);
      }
      this.messageCache.set(message.sessionId, [message]);
    }

    log('[SessionManager] Message saved:', message.id, 'role:', message.role);
    this.turnJournal.append(
      message.sessionId,
      'message_saved',
      {
        messageId: message.id,
        role: message.role,
        contentTypes: message.content.map((block) => block.type),
        localStatus: message.localStatus,
        metadata: message.metadata,
      },
      this.activeTurnJournalIds.get(message.sessionId)
    );
  }

  // Get messages for a session
  getMessages(sessionId: string): Message[] {
    const cached = this.messageCache.get(sessionId);
    if (cached) {
      return [...cached];
    }

    const rows = this.db.messages.getBySessionId(sessionId);
    const messages = rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as Message['role'],
      content: this.normalizeContent(row.content),
      timestamp: row.timestamp,
      tokenUsage: row.token_usage ? JSON.parse(row.token_usage) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      executionTimeMs: row.execution_time_ms ?? undefined,
    }));
    this.messageCache.set(sessionId, messages);
    return [...messages];
  }

  getTurnJournal(sessionId: string): TurnJournalReadResult {
    return this.turnJournal.read(sessionId);
  }

  getMemoryPreview(sessionId: string): SessionMemoryPreview | null {
    const session = this.loadSession(sessionId);
    if (!session) return null;
    const memoryStrategy = this.resolveMemoryStrategy(session);
    const projectId = session.projectId ?? this.projectManager?.getActiveId() ?? null;
    const messages = this.getMessages(session.id)
      .map((message) => ({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('\n'),
      }))
      .filter((message) => message.content.trim().length > 0)
      .slice(-12);

    const projectPreview =
      projectId && this.projectMemory?.previewProjectMemory
        ? this.projectMemory.previewProjectMemory(projectId, session.id, messages)
        : null;
    const projectContextAvailable = Boolean(
      projectId && this.projectMemory && this.projectManager?.get(projectId)?.workspacePath
    );
    const automatedMemoryEnabled = memoryStrategy !== 'manual';
    return {
      sessionId: session.id,
      projectId,
      memoryStrategy,
      automatedMemoryEnabled,
      projectMemoryAvailable: Boolean(projectPreview?.hasWorkspace),
      ...(projectPreview?.projectMemoryPath ? { projectMemoryPath: projectPreview.projectMemoryPath } : {}),
      projectContextAvailable,
      icmAvailable: Boolean(this.icmIntegration?.isAvailable()),
      recallEnabled: automatedMemoryEnabled && session.memoryEnabled,
      candidateCount: projectPreview?.candidateCount ?? 0,
      candidates: projectPreview?.candidates ?? [],
    };
  }

  recoverFromTurnJournals(): {
    sessionsScanned: number;
    sessionsChanged: number;
    injectedJournalUserMessages: number;
    injectedJournalInterruptionMarkers: number;
    errors: number;
  } {
    let sessionsScanned = 0;
    let sessionsChanged = 0;
    let injectedJournalUserMessages = 0;
    let injectedJournalInterruptionMarkers = 0;
    let errors = 0;

    for (const session of this.listSessions()) {
      sessionsScanned += 1;
      try {
        const journal = this.getTurnJournal(session.id);
        if (!journal.exists || journal.totalEventCount === 0) {
          continue;
        }
        this.turnJournal.primeSequenceState(session.id);
        const result = repairSessionTranscript(session.id, this.getMessages(session.id), journal);
        if (!result.changed) {
          continue;
        }
        this.replaceMessages(session.id, result.messages);
        sessionsChanged += 1;
        injectedJournalUserMessages += result.injectedJournalUserMessages;
        injectedJournalInterruptionMarkers += result.injectedJournalInterruptionMarkers;
        const replayRun =
          journal.replay.runs.find((run) => run.status === 'running') ?? journal.replay.runs[0];
        this.turnJournal.append(
          session.id,
          'trace_update',
          {
          kind: 'startup_recovery',
          injectedJournalUserMessages: result.injectedJournalUserMessages,
          injectedJournalInterruptionMarkers: result.injectedJournalInterruptionMarkers,
          removedOrphanToolResults: result.removedOrphanToolResults,
          injectedSyntheticToolResults: result.injectedSyntheticToolResults,
          removedEmptyMessages: result.removedEmptyMessages,
            replayRunId: replayRun?.runId,
            replayTurnId: replayRun?.turnId,
            replayStatus: replayRun?.status,
            replayEventCount: replayRun?.eventCount ?? 0,
            replayAnchorCount: replayRun?.anchorCount ?? 0,
            replayLatestType: replayRun?.latestType,
            replayTerminalType: replayRun?.terminalEvent?.type,
            replayAnchorIds: replayRun?.anchors.slice(0, 8).map((anchor) => anchor.eventId) ?? [],
          },
          replayRun?.turnId,
          replayRun ? { runId: replayRun.runId } : undefined
        );
      } catch (error) {
        errors += 1;
        logWarn('[SessionManager] Turn journal startup recovery failed:', error);
      }
    }

    return {
      sessionsScanned,
      sessionsChanged,
      injectedJournalUserMessages,
      injectedJournalInterruptionMarkers,
      errors,
    };
  }

  recoverQueuedPromptsFromTurnJournals(): {
    sessionsScanned: number;
    sessionsChanged: number;
    recoveredQueuedPrompts: number;
    skippedQueuedPrompts: number;
    errors: number;
  } {
    let sessionsScanned = 0;
    let sessionsChanged = 0;
    let recoveredQueuedPrompts = 0;
    let skippedQueuedPrompts = 0;
    let errors = 0;

    for (const session of this.listSessions()) {
      sessionsScanned += 1;
      try {
        const journal = this.getTurnJournal(session.id);
        if (!journal.exists || journal.totalEventCount === 0) {
          continue;
        }

        this.turnJournal.primeSequenceState(session.id);

        const recoverableQueuedPrompts = this.getRecoverableQueuedPromptEvents(journal);
        if (recoverableQueuedPrompts.length === 0) {
          continue;
        }

        const queue = this.promptQueues.get(session.id) ?? [];
        for (const event of recoverableQueuedPrompts) {
          const snapshot = this.readQueuedPromptSnapshot(event.data);
          if (!snapshot || !snapshot.recoverable) {
            skippedQueuedPrompts += 1;
            continue;
          }

          queue.push({
            turnId: event.turnId ?? event.runId ?? generateTraceId(),
            prompt: snapshot.prompt,
            content: snapshot.content,
          });
          recoveredQueuedPrompts += 1;
        }

        if (queue.length === 0) {
          continue;
        }

        this.promptQueues.set(session.id, queue);
        sessionsChanged += 1;
        if (!this.activeSessions.has(session.id)) {
          this.processQueue(session).catch((err) => {
            logError('[SessionManager] Queue recovery processing error:', err);
          });
        }
      } catch (error) {
        errors += 1;
        logWarn('[SessionManager] Turn journal queued prompt recovery failed:', error);
      }
    }

    return {
      sessionsScanned,
      sessionsChanged,
      recoveredQueuedPrompts,
      skippedQueuedPrompts,
      errors,
    };
  }

  private getRecoverableQueuedPromptEvents(journal: TurnJournalReadResult): Array<{
    turnId?: string;
    runId?: string;
    data?: Record<string, unknown>;
    ts: number;
    seq?: number;
    eventId?: string;
  }> {
    const startedTurnIds = new Set(
      journal.replay.runs.flatMap((run) =>
        run.events
          .filter((event) => event.type === 'turn_started' && typeof event.turnId === 'string')
          .map((event) => event.turnId as string)
      )
    );

    return journal.replay.runs
      .flatMap((run) => run.events)
      .filter(
        (event) =>
          event.type === 'intent_queued' &&
          typeof event.turnId === 'string' &&
          !startedTurnIds.has(event.turnId)
      )
      .sort((a, b) => {
        if (a.ts !== b.ts) return a.ts - b.ts;
        const aSeq = typeof a.seq === 'number' ? a.seq : Number.MAX_SAFE_INTEGER;
        const bSeq = typeof b.seq === 'number' ? b.seq : Number.MAX_SAFE_INTEGER;
        if (aSeq !== bSeq) return aSeq - bSeq;
        return (a.eventId ?? '').localeCompare(b.eventId ?? '');
      });
  }

  private readQueuedPromptSnapshot(data?: Record<string, unknown>): RecoveredQueuedPromptSnapshot | null {
    if (!data) return null;
    const prompt = typeof data.prompt === 'string' ? data.prompt : null;
    if (!prompt) return null;
    const content = Array.isArray(data.contentSnapshot)
      ? (data.contentSnapshot as ContentBlock[])
      : undefined;
    return {
      prompt,
      content,
      recoverable: data.recoverable !== false,
      nonRecoverableTypes: Array.isArray(data.nonRecoverableTypes)
        ? data.nonRecoverableTypes.filter((value): value is string => typeof value === 'string')
        : [],
    };
  }

  replaceMessages(sessionId: string, messages: Message[]): void {
    const session = this.db.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const tx = this.db.raw.transaction((nextMessages: Message[]) => {
      this.db.messages.deleteBySessionId(sessionId);
      for (const message of nextMessages) {
        this.db.messages.create({
          id: message.id,
          session_id: message.sessionId,
          role: message.role,
          content: JSON.stringify(message.content),
          timestamp: message.timestamp,
          token_usage: message.tokenUsage ? JSON.stringify(message.tokenUsage) : null,
          execution_time_ms: message.executionTimeMs ?? null,
          metadata: message.metadata ? JSON.stringify(message.metadata) : null,
        });
      }
    });

    tx(messages);
    this.messageCache.set(sessionId, [...messages]);
    log('[SessionManager] Messages replaced for session:', sessionId, 'count:', messages.length);
  }

  private normalizeContent(raw: string): ContentBlock[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as ContentBlock[];
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'type' in parsed &&
        typeof (parsed as { type: unknown }).type === 'string'
      ) {
        return [parsed as ContentBlock];
      }
      if (typeof parsed === 'string') {
        return [{ type: 'text', text: parsed } as TextContent];
      }
      return [{ type: 'text', text: String(parsed) } as TextContent];
    } catch {
      return [{ type: 'text', text: raw } as TextContent];
    }
  }

  getTraceSteps(sessionId: string): TraceStep[] {
    const rows = this.db.traceSteps.getBySessionId(sessionId);
    const parseToolInput = (value: string | null): Record<string, unknown> | undefined => {
      if (!value) return undefined;
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    };
    return rows.map((row) => ({
      id: row.id,
      type: row.type as TraceStep['type'],
      status: row.status as TraceStep['status'],
      title: row.title,
      content: row.content || undefined,
      toolName: row.tool_name || undefined,
      toolInput: parseToolInput(row.tool_input),
      toolOutput: row.tool_output || undefined,
      isError: row.is_error === 1 ? true : undefined,
      timestamp: row.timestamp,
      duration: row.duration ?? undefined,
    }));
  }

  // Handle permission response
  handlePermissionResponse(toolUseId: string, result: PermissionResult): void {
    const resolver = this.pendingPermissions.get(toolUseId);
    if (resolver) {
      resolver(result);
      this.pendingPermissions.delete(toolUseId);
    }
  }

  dispose(): void {
    this.turnJournal.close();
  }

  // Request permission for a tool
  async requestPermission(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const timeoutMs = this.isRemoteSession(sessionId)
        ? SessionManager.REMOTE_PERMISSION_TIMEOUT_MS
        : SessionManager.LOCAL_PERMISSION_TIMEOUT_MS;
      const timeoutId = setTimeout(() => {
        this.pendingPermissions.delete(toolUseId);
        resolve('deny');
        this.sendToRenderer({ type: 'permission.dismiss', payload: { toolUseId } });
      }, timeoutMs);
      this.pendingPermissions.set(toolUseId, (result: PermissionResult) => {
        clearTimeout(timeoutId);
        resolve(result);
      });
      this.sendToRenderer({
        type: 'permission.request',
        payload: { toolUseId, toolName, input, sessionId },
      });
    });
  }

  // Request sudo password from the user
  async requestSudoPassword(
    sessionId: string,
    toolUseId: string,
    command: string
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSudoPasswords.delete(toolUseId);
        resolve(null);
        this.sendToRenderer({ type: 'sudo.password.dismiss', payload: { toolUseId } });
      }, 60_000);
      this.pendingSudoPasswords.set(toolUseId, {
        sessionId,
        resolve: (password: string | null) => {
          clearTimeout(timeout);
          resolve(password);
        },
      });
      this.sendToRenderer({
        type: 'sudo.password.request',
        payload: { toolUseId, command, sessionId },
      });
    });
  }

  // Handle sudo password response from renderer
  handleSudoPasswordResponse(toolUseId: string, password: string | null): void {
    const entry = this.pendingSudoPasswords.get(toolUseId);
    if (entry) {
      entry.resolve(password);
      this.pendingSudoPasswords.delete(toolUseId);
    }
  }

  private saveTraceStep(sessionId: string, step: TraceStep): void {
    this.db.traceSteps.create({
      id: step.id,
      session_id: sessionId,
      type: step.type,
      status: step.status,
      title: step.title,
      content: step.content ?? null,
      tool_name: step.toolName ?? null,
      tool_input: step.toolInput ? JSON.stringify(step.toolInput) : null,
      tool_output: step.toolOutput ?? null,
      is_error: step.isError ? 1 : null,
      timestamp: step.timestamp,
      duration: step.duration ?? null,
    });
  }

  private updateTraceStep(stepId: string, updates: Partial<TraceStep>): void {
    const rowUpdates: Partial<TraceStepRow> = {};
    if (updates.type !== undefined) rowUpdates.type = updates.type;
    if (updates.status !== undefined) rowUpdates.status = updates.status;
    if (updates.title !== undefined) rowUpdates.title = updates.title;
    if (updates.content !== undefined) rowUpdates.content = updates.content;
    if (updates.toolName !== undefined) rowUpdates.tool_name = updates.toolName;
    if (updates.toolInput !== undefined) {
      rowUpdates.tool_input = updates.toolInput ? JSON.stringify(updates.toolInput) : null;
    }
    if (updates.toolOutput !== undefined) rowUpdates.tool_output = updates.toolOutput;
    if (updates.isError !== undefined) rowUpdates.is_error = updates.isError ? 1 : 0;
    if (updates.timestamp !== undefined) rowUpdates.timestamp = updates.timestamp;
    if (updates.duration !== undefined) rowUpdates.duration = updates.duration;

    if (Object.keys(rowUpdates).length > 0) {
      this.db.traceSteps.update(stepId, rowUpdates);
    }
  }
}

/**
 * Translate a Cowork-side `MCPServerConfig` (which uses `type` +
 * inline command/url fields) to the engine's transport shape (a single
 * `transport` object with everything inside). The two have diverged
 * historically; this is the single point of conversion so adding new
 * transport types stays localised.
 */
function toEngineTransport(server: MCPServerConfig): {
  type: 'stdio' | 'http' | 'sse' | 'streamable_http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
} {
  const coworkType = server.type;
  const engineType: 'stdio' | 'http' | 'sse' | 'streamable_http' =
    coworkType === 'sse'
      ? 'sse'
      : coworkType === 'streamable-http'
        ? 'streamable_http'
        : 'stdio';
  return {
    type: engineType,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    headers: server.headers,
  };
}
