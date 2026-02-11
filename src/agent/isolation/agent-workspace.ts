/**
 * Agent Workspace
 *
 * Provides isolated workspaces for agents with separate
 * file access, environment, and state management.
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import fs from 'fs-extra';
import * as crypto from 'crypto';
import type { AgentConfig, AgentSession } from './agent-config.js';
import { generateSessionKey, parseSessionKey } from './agent-config.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Workspace state
 */
export interface WorkspaceState {
  /** Working directory */
  workingDirectory: string;
  /** Environment variables */
  environment: Record<string, string>;
  /** Active files (open or modified) */
  activeFiles: Set<string>;
  /** Custom state */
  state: Record<string, unknown>;
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Base directory for workspace isolation */
  baseDir: string;
  /** Whether to create isolated temp directories */
  isolateTempDir: boolean;
  /** Whether to track file access */
  trackFileAccess: boolean;
  /** Maximum active files */
  maxActiveFiles: number;
}

/**
 * Default workspace configuration
 */
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  baseDir: path.join(os.homedir(), '.codebuddy', 'workspaces'),
  isolateTempDir: true,
  trackFileAccess: true,
  maxActiveFiles: 100,
};

// ============================================================================
// Agent Workspace
// ============================================================================

/**
 * Isolated workspace for an agent
 */
export class AgentWorkspace extends EventEmitter {
  private config: AgentConfig;
  private workspaceConfig: WorkspaceConfig;
  private session: AgentSession;
  private state: WorkspaceState;
  private workspaceDir: string;
  private initialized: boolean = false;

  constructor(
    agentConfig: AgentConfig,
    sessionId: string,
    workspaceConfig: Partial<WorkspaceConfig> = {}
  ) {
    super();
    this.config = agentConfig;
    this.workspaceConfig = { ...DEFAULT_WORKSPACE_CONFIG, ...workspaceConfig };

    const now = Date.now();
    this.session = {
      key: generateSessionKey(agentConfig.id, sessionId),
      agentId: agentConfig.id,
      sessionId,
      createdAt: now,
      lastActivityAt: now,
    };

    this.workspaceDir = path.join(
      this.workspaceConfig.baseDir,
      agentConfig.id,
      sessionId
    );

    this.state = {
      workingDirectory: process.cwd(),
      environment: {},
      activeFiles: new Set(),
      state: {},
    };
  }

  /**
   * Initialize workspace
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create workspace directory
    await fs.ensureDir(this.workspaceDir);

    // Create isolated temp directory if enabled
    if (this.workspaceConfig.isolateTempDir) {
      const tempDir = path.join(this.workspaceDir, 'tmp');
      await fs.ensureDir(tempDir);
      this.state.environment.TMPDIR = tempDir;
      this.state.environment.TEMP = tempDir;
      this.state.environment.TMP = tempDir;
    }

    // Create state file
    await this.saveState();

    this.initialized = true;
    this.emit('workspace:initialized', { session: this.session });

    logger.debug('Agent workspace initialized', {
      agentId: this.config.id,
      sessionId: this.session.sessionId,
      workspaceDir: this.workspaceDir,
    });
  }

  /**
   * Get session info
   */
  getSession(): AgentSession {
    return { ...this.session };
  }

  /**
   * Get agent config
   */
  getAgentConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Get workspace directory
   */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /**
   * Get working directory
   */
  getWorkingDirectory(): string {
    return this.state.workingDirectory;
  }

  /**
   * Set working directory
   */
  setWorkingDirectory(dir: string): void {
    this.state.workingDirectory = dir;
    this.updateActivity();
  }

  /**
   * Get environment
   */
  getEnvironment(): Record<string, string> {
    return { ...this.state.environment };
  }

  /**
   * Set environment variable
   */
  setEnvironmentVariable(key: string, value: string): void {
    this.state.environment[key] = value;
    this.updateActivity();
  }

  /**
   * Track file access
   */
  trackFile(filePath: string): void {
    if (!this.workspaceConfig.trackFileAccess) return;

    this.state.activeFiles.add(filePath);

    // Trim if too many files
    if (this.state.activeFiles.size > this.workspaceConfig.maxActiveFiles) {
      const files = Array.from(this.state.activeFiles);
      this.state.activeFiles = new Set(files.slice(-this.workspaceConfig.maxActiveFiles));
    }

    this.updateActivity();
    this.emit('file:accessed', { filePath, agentId: this.config.id });
  }

  /**
   * Get active files
   */
  getActiveFiles(): string[] {
    return Array.from(this.state.activeFiles);
  }

  /**
   * Get/set custom state
   */
  getState<T = unknown>(key: string): T | undefined {
    return this.state.state[key] as T | undefined;
  }

  setState<T>(key: string, value: T): void {
    this.state.state[key] = value;
    this.updateActivity();
  }

  /**
   * Update last activity timestamp
   */
  private updateActivity(): void {
    this.session.lastActivityAt = Date.now();
  }

  /**
   * Check if session is expired
   */
  isExpired(): boolean {
    const elapsed = Date.now() - this.session.lastActivityAt;
    return elapsed > this.config.sessionTimeoutMs;
  }

  /**
   * Save workspace state to disk
   */
  async saveState(): Promise<void> {
    const stateFile = path.join(this.workspaceDir, 'state.json');
    const data = {
      session: this.session,
      state: {
        workingDirectory: this.state.workingDirectory,
        environment: this.state.environment,
        activeFiles: Array.from(this.state.activeFiles),
        state: this.state.state,
      },
    };
    await fs.writeJSON(stateFile, data, { spaces: 2 });
  }

  /**
   * Load workspace state from disk
   */
  async loadState(): Promise<boolean> {
    const stateFile = path.join(this.workspaceDir, 'state.json');

    if (!await fs.pathExists(stateFile)) {
      return false;
    }

    try {
      const data = await fs.readJSON(stateFile);
      this.session = data.session;
      this.state = {
        workingDirectory: data.state.workingDirectory || process.cwd(),
        environment: data.state.environment || {},
        activeFiles: new Set(data.state.activeFiles || []),
        state: data.state.state || {},
      };
      return true;
    } catch (error) {
      logger.warn('Failed to load workspace state', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Clean up workspace
   */
  async cleanup(): Promise<void> {
    await this.saveState();
    this.emit('workspace:cleanup', { session: this.session });
  }

  /**
   * Destroy workspace (remove all data)
   */
  async destroy(): Promise<void> {
    try {
      await fs.remove(this.workspaceDir);
      this.emit('workspace:destroyed', { session: this.session });
    } catch (error) {
      logger.warn('Failed to destroy workspace', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ============================================================================
// Workspace Manager
// ============================================================================

/**
 * Manages multiple agent workspaces
 */
export class WorkspaceManager extends EventEmitter {
  private workspaces: Map<string, AgentWorkspace> = new Map();
  private config: WorkspaceConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<WorkspaceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WORKSPACE_CONFIG, ...config };

    // Periodically clean up expired workspaces (every 5 minutes)
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch(() => {});
    }, 300000);
    this.cleanupTimer.unref();
  }

  /**
   * Create workspace for an agent
   */
  async createWorkspace(
    agentConfig: AgentConfig,
    sessionId?: string
  ): Promise<AgentWorkspace> {
    const sid = sessionId || crypto.randomBytes(8).toString('hex');
    const workspace = new AgentWorkspace(agentConfig, sid, this.config);

    await workspace.initialize();
    this.workspaces.set(workspace.getSession().key, workspace);

    this.emit('workspace:created', { key: workspace.getSession().key, agentId: agentConfig.id });

    return workspace;
  }

  /**
   * Get workspace by session key
   */
  getWorkspace(sessionKey: string): AgentWorkspace | undefined {
    return this.workspaces.get(sessionKey);
  }

  /**
   * Get workspace by agent ID (returns first active)
   */
  getWorkspaceByAgent(agentId: string): AgentWorkspace | undefined {
    for (const workspace of this.workspaces.values()) {
      if (workspace.getAgentConfig().id === agentId && !workspace.isExpired()) {
        return workspace;
      }
    }
    return undefined;
  }

  /**
   * Get all workspaces for an agent
   */
  getWorkspacesForAgent(agentId: string): AgentWorkspace[] {
    return Array.from(this.workspaces.values()).filter(
      ws => ws.getAgentConfig().id === agentId
    );
  }

  /**
   * Remove workspace
   */
  async removeWorkspace(sessionKey: string, destroy: boolean = false): Promise<boolean> {
    const workspace = this.workspaces.get(sessionKey);
    if (!workspace) return false;

    if (destroy) {
      await workspace.destroy();
    } else {
      await workspace.cleanup();
    }

    this.workspaces.delete(sessionKey);
    this.emit('workspace:removed', { key: sessionKey });

    return true;
  }

  /**
   * Clean up expired workspaces
   */
  async cleanupExpired(): Promise<number> {
    const expired: string[] = [];

    for (const [key, workspace] of this.workspaces) {
      if (workspace.isExpired()) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      await this.removeWorkspace(key, true);
    }

    return expired.length;
  }

  /**
   * Get all active workspaces
   */
  getActiveWorkspaces(): AgentWorkspace[] {
    return Array.from(this.workspaces.values()).filter(ws => !ws.isExpired());
  }

  /**
   * Load existing workspace from disk
   */
  async loadWorkspace(agentConfig: AgentConfig, sessionId: string): Promise<AgentWorkspace | null> {
    const workspace = new AgentWorkspace(agentConfig, sessionId, this.config);
    const loaded = await workspace.loadState();

    if (!loaded) {
      return null;
    }

    this.workspaces.set(workspace.getSession().key, workspace);
    return workspace;
  }

  /**
   * Clear all workspaces
   */
  async clearAll(destroy: boolean = false): Promise<void> {
    const keys = Array.from(this.workspaces.keys());
    for (const key of keys) {
      await this.removeWorkspace(key, destroy);
    }
  }

  /**
   * Dispose manager
   */
  async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.clearAll();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let workspaceManagerInstance: WorkspaceManager | null = null;

/**
 * Get or create WorkspaceManager singleton
 */
export function getWorkspaceManager(config?: Partial<WorkspaceConfig>): WorkspaceManager {
  if (!workspaceManagerInstance) {
    workspaceManagerInstance = new WorkspaceManager(config);
  }
  return workspaceManagerInstance;
}

/**
 * Reset WorkspaceManager singleton
 */
export async function resetWorkspaceManager(): Promise<void> {
  if (workspaceManagerInstance) {
    await workspaceManagerInstance.dispose();
  }
  workspaceManagerInstance = null;
}
