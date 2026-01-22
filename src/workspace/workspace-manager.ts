/**
 * Workspace Manager - Isolation par workspace
 *
 * Permet d'isoler les sessions, checkpoints et configurations par projet.
 * Chaque projet (workspace) a son propre etat dans .grok/ ou dans ~/.codebuddy/workspaces/<hash>
 *
 * Detection automatique du root projet:
 * - .git directory
 * - package.json
 * - Cargo.toml
 * - go.mod
 * - pyproject.toml
 * - .grok/ directory (marker explicite)
 *
 * Structure:
 *   <project>/.grok/           # Config locale au projet
 *   ├── config.json            # Configuration du workspace
 *   ├── sessions/              # Sessions locales
 *   ├── checkpoints/           # Checkpoints locaux
 *   └── memory/                # Memoire locale
 *
 *   ~/.codebuddy/workspaces/   # Donnees globales par workspace
 *   └── <workspace-hash>/
 *       ├── sessions/
 *       ├── checkpoints/
 *       └── state.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceInfo {
  /** Unique identifier for the workspace (hash of root path) */
  id: string;
  /** Human-readable name (directory name) */
  name: string;
  /** Absolute path to workspace root */
  rootPath: string;
  /** How the root was detected */
  detectedBy: WorkspaceRootMarker;
  /** Whether workspace has local .grok/ directory */
  hasLocalConfig: boolean;
  /** Timestamp of last access */
  lastAccessed: Date;
  /** Project type if detected */
  projectType?: string;
}

export interface WorkspaceState {
  /** Current session ID in this workspace */
  currentSessionId?: string;
  /** Last used model */
  lastModel?: string;
  /** Security mode for this workspace */
  securityMode?: 'suggest' | 'auto-edit' | 'full-auto';
  /** Agent mode for this workspace */
  agentMode?: 'plan' | 'code' | 'ask' | 'architect';
  /** Custom settings */
  settings?: Record<string, unknown>;
  /** Last accessed */
  lastAccessed: string;
}

export interface WorkspaceConfig {
  /** Use local .grok/ directory for workspace data */
  useLocalStorage: boolean;
  /** Automatically create .grok/ in new workspaces */
  autoCreateLocal: boolean;
  /** Root markers to search for */
  rootMarkers: WorkspaceRootMarker[];
  /** Maximum search depth for root detection */
  maxSearchDepth: number;
  /** Isolated data per workspace */
  isolateSessions: boolean;
  isolateCheckpoints: boolean;
  isolateMemory: boolean;
}

export type WorkspaceRootMarker =
  | '.git'
  | 'package.json'
  | 'Cargo.toml'
  | 'go.mod'
  | 'pyproject.toml'
  | 'pom.xml'
  | 'build.gradle'
  | '.grok'
  | 'tsconfig.json'
  | '.hg'
  | '.svn';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: WorkspaceConfig = {
  useLocalStorage: true,
  autoCreateLocal: false,
  rootMarkers: [
    '.grok',      // Explicit marker (highest priority)
    '.git',
    'package.json',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'pom.xml',
    'build.gradle',
    'tsconfig.json',
  ],
  maxSearchDepth: 10,
  isolateSessions: true,
  isolateCheckpoints: true,
  isolateMemory: true,
};

const ROOT_MARKER_PRIORITY: Record<WorkspaceRootMarker, number> = {
  '.grok': 100,        // Explicit marker
  '.git': 90,          // Version control
  '.hg': 85,
  '.svn': 85,
  'package.json': 80,  // Project files
  'Cargo.toml': 80,
  'go.mod': 80,
  'pyproject.toml': 80,
  'pom.xml': 80,
  'build.gradle': 80,
  'tsconfig.json': 70,
};

const GROK_LOCAL_DIR = '.grok';
const WORKSPACES_DIR = 'workspaces';

// ============================================================================
// Workspace Manager
// ============================================================================

export class WorkspaceManager extends EventEmitter {
  private config: WorkspaceConfig;
  private currentWorkspace: WorkspaceInfo | null = null;
  private workspaceCache: Map<string, WorkspaceInfo> = new Map();
  private globalDataDir: string;

  constructor(config: Partial<WorkspaceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.globalDataDir = path.join(os.homedir(), '.codebuddy', WORKSPACES_DIR);
    this.ensureGlobalDir();
  }

  /**
   * Ensure global workspaces directory exists
   */
  private ensureGlobalDir(): void {
    if (!fs.existsSync(this.globalDataDir)) {
      fs.mkdirSync(this.globalDataDir, { recursive: true });
    }
  }

  /**
   * Hash a path to create workspace ID
   */
  private hashPath(p: string): string {
    return crypto.createHash('sha256').update(p).digest('hex').slice(0, 16);
  }

  /**
   * Detect workspace root from a given directory
   */
  detectWorkspaceRoot(startDir: string = process.cwd()): { root: string; marker: WorkspaceRootMarker } | null {
    let currentDir = path.resolve(startDir);
    let depth = 0;

    // Track all found markers with their paths
    const foundMarkers: Array<{ path: string; marker: WorkspaceRootMarker; depth: number }> = [];

    while (depth < this.config.maxSearchDepth) {
      // Check each marker at current level
      for (const marker of this.config.rootMarkers) {
        const markerPath = path.join(currentDir, marker);
        if (fs.existsSync(markerPath)) {
          foundMarkers.push({ path: currentDir, marker, depth });
        }
      }

      // If we found .grok, use it immediately (highest priority)
      const grokMarker = foundMarkers.find(m => m.marker === '.grok');
      if (grokMarker) {
        return { root: grokMarker.path, marker: '.grok' };
      }

      // Move up one directory
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        // Reached filesystem root
        break;
      }
      currentDir = parentDir;
      depth++;
    }

    // No .grok found, use the first marker with highest priority
    if (foundMarkers.length > 0) {
      // Sort by priority (higher first), then by depth (shallower first)
      foundMarkers.sort((a, b) => {
        const priorityDiff = ROOT_MARKER_PRIORITY[b.marker] - ROOT_MARKER_PRIORITY[a.marker];
        if (priorityDiff !== 0) return priorityDiff;
        return a.depth - b.depth;
      });

      const best = foundMarkers[0];
      return { root: best.path, marker: best.marker };
    }

    return null;
  }

  /**
   * Initialize workspace from current directory
   */
  async initializeWorkspace(startDir: string = process.cwd()): Promise<WorkspaceInfo> {
    const detection = this.detectWorkspaceRoot(startDir);

    if (!detection) {
      // No project root found, use current directory
      return this.createWorkspaceInfo(startDir, 'package.json');
    }

    return this.createWorkspaceInfo(detection.root, detection.marker);
  }

  /**
   * Create workspace info object
   */
  private createWorkspaceInfo(rootPath: string, detectedBy: WorkspaceRootMarker): WorkspaceInfo {
    const id = this.hashPath(rootPath);
    const name = path.basename(rootPath);
    const hasLocalConfig = fs.existsSync(path.join(rootPath, GROK_LOCAL_DIR));

    // Detect project type
    let projectType: string | undefined;
    if (fs.existsSync(path.join(rootPath, 'package.json'))) {
      projectType = 'node';
      // Check for specific frameworks
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
        if (pkg.dependencies?.next || pkg.devDependencies?.next) projectType = 'nextjs';
        else if (pkg.dependencies?.react || pkg.devDependencies?.react) projectType = 'react';
        else if (pkg.dependencies?.vue || pkg.devDependencies?.vue) projectType = 'vue';
      } catch {
        // Ignore JSON errors
      }
    } else if (fs.existsSync(path.join(rootPath, 'Cargo.toml'))) {
      projectType = 'rust';
    } else if (fs.existsSync(path.join(rootPath, 'go.mod'))) {
      projectType = 'go';
    } else if (fs.existsSync(path.join(rootPath, 'pyproject.toml')) || fs.existsSync(path.join(rootPath, 'requirements.txt'))) {
      projectType = 'python';
    }

    const workspace: WorkspaceInfo = {
      id,
      name,
      rootPath,
      detectedBy,
      hasLocalConfig,
      lastAccessed: new Date(),
      projectType,
    };

    this.workspaceCache.set(id, workspace);
    this.currentWorkspace = workspace;

    // Save to recent workspaces
    this.saveRecentWorkspace(workspace);

    this.emit('workspace:initialized', workspace);
    return workspace;
  }

  /**
   * Get current workspace
   */
  getCurrentWorkspace(): WorkspaceInfo | null {
    return this.currentWorkspace;
  }

  /**
   * Set current workspace
   */
  setCurrentWorkspace(workspace: WorkspaceInfo): void {
    this.currentWorkspace = workspace;
    workspace.lastAccessed = new Date();
    this.workspaceCache.set(workspace.id, workspace);
    this.saveRecentWorkspace(workspace);
    this.emit('workspace:changed', workspace);
  }

  /**
   * Switch to a different workspace by path
   */
  async switchWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
    const resolvedPath = path.resolve(workspacePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Workspace path does not exist: ${resolvedPath}`);
    }

    const workspace = await this.initializeWorkspace(resolvedPath);
    this.setCurrentWorkspace(workspace);

    return workspace;
  }

  /**
   * Get workspace data directory (local or global)
   */
  getWorkspaceDataDir(workspace?: WorkspaceInfo): string {
    const ws = workspace || this.currentWorkspace;
    if (!ws) {
      throw new Error('No workspace initialized. Call initializeWorkspace() first.');
    }

    if (this.config.useLocalStorage && ws.hasLocalConfig) {
      return path.join(ws.rootPath, GROK_LOCAL_DIR);
    }

    // Use global directory
    const globalDir = path.join(this.globalDataDir, ws.id);
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }
    return globalDir;
  }

  /**
   * Get workspace sessions directory
   */
  getSessionsDir(workspace?: WorkspaceInfo): string {
    if (!this.config.isolateSessions) {
      return path.join(os.homedir(), '.codebuddy', 'sessions');
    }

    const dataDir = this.getWorkspaceDataDir(workspace);
    const sessionsDir = path.join(dataDir, 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    return sessionsDir;
  }

  /**
   * Get workspace checkpoints directory
   */
  getCheckpointsDir(workspace?: WorkspaceInfo): string {
    if (!this.config.isolateCheckpoints) {
      return path.join(os.homedir(), '.codebuddy', 'checkpoints');
    }

    const dataDir = this.getWorkspaceDataDir(workspace);
    const checkpointsDir = path.join(dataDir, 'checkpoints');
    if (!fs.existsSync(checkpointsDir)) {
      fs.mkdirSync(checkpointsDir, { recursive: true });
    }
    return checkpointsDir;
  }

  /**
   * Get workspace memory directory
   */
  getMemoryDir(workspace?: WorkspaceInfo): string {
    if (!this.config.isolateMemory) {
      return path.join(os.homedir(), '.codebuddy', 'memory');
    }

    const dataDir = this.getWorkspaceDataDir(workspace);
    const memoryDir = path.join(dataDir, 'memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    return memoryDir;
  }

  /**
   * Initialize local .grok directory in workspace
   */
  initializeLocalConfig(workspace?: WorkspaceInfo): string {
    const ws = workspace || this.currentWorkspace;
    if (!ws) {
      throw new Error('No workspace initialized. Call initializeWorkspace() first.');
    }

    const localDir = path.join(ws.rootPath, GROK_LOCAL_DIR);

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });

      // Create subdirectories
      fs.mkdirSync(path.join(localDir, 'sessions'), { recursive: true });
      fs.mkdirSync(path.join(localDir, 'checkpoints'), { recursive: true });
      fs.mkdirSync(path.join(localDir, 'memory'), { recursive: true });

      // Create default config
      const config: WorkspaceState = {
        lastAccessed: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(localDir, 'config.json'),
        JSON.stringify(config, null, 2)
      );

      // Add .grok to .gitignore if it exists
      this.addToGitignore(ws.rootPath);

      ws.hasLocalConfig = true;
      this.emit('workspace:local-init', ws);
    }

    return localDir;
  }

  /**
   * Add .grok to .gitignore
   */
  private addToGitignore(rootPath: string): void {
    const gitignorePath = path.join(rootPath, '.gitignore');
    const grokEntry = '\n# Code Buddy workspace data\n.grok/\n';

    try {
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        if (!content.includes('.grok')) {
          fs.appendFileSync(gitignorePath, grokEntry);
        }
      }
    } catch {
      // Ignore gitignore errors
    }
  }

  /**
   * Load workspace state
   */
  loadWorkspaceState(workspace?: WorkspaceInfo): WorkspaceState | null {
    const ws = workspace || this.currentWorkspace;
    if (!ws) return null;

    const statePath = path.join(this.getWorkspaceDataDir(ws), 'state.json');

    try {
      if (fs.existsSync(statePath)) {
        return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      }
    } catch {
      // Ignore read errors
    }

    return null;
  }

  /**
   * Save workspace state
   */
  saveWorkspaceState(state: WorkspaceState, workspace?: WorkspaceInfo): void {
    const ws = workspace || this.currentWorkspace;
    if (!ws) return;

    const dataDir = this.getWorkspaceDataDir(ws);
    const statePath = path.join(dataDir, 'state.json');

    state.lastAccessed = new Date().toISOString();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Update workspace state
   */
  updateWorkspaceState(updates: Partial<WorkspaceState>, workspace?: WorkspaceInfo): void {
    const ws = workspace || this.currentWorkspace;
    if (!ws) return;

    const currentState = this.loadWorkspaceState(ws) || { lastAccessed: new Date().toISOString() };
    const newState = { ...currentState, ...updates };
    this.saveWorkspaceState(newState, ws);
  }

  /**
   * Save to recent workspaces list
   */
  private saveRecentWorkspace(workspace: WorkspaceInfo): void {
    const recentPath = path.join(this.globalDataDir, 'recent.json');
    let recent: WorkspaceInfo[] = [];

    try {
      if (fs.existsSync(recentPath)) {
        recent = JSON.parse(fs.readFileSync(recentPath, 'utf-8'));
      }
    } catch {
      // Ignore read errors
    }

    // Remove existing entry for this workspace
    recent = recent.filter(w => w.id !== workspace.id);

    // Add to front
    recent.unshift({
      ...workspace,
      lastAccessed: new Date(),
    });

    // Keep only last 20 workspaces
    recent = recent.slice(0, 20);

    fs.writeFileSync(recentPath, JSON.stringify(recent, null, 2));
  }

  /**
   * Get recent workspaces
   */
  getRecentWorkspaces(): WorkspaceInfo[] {
    const recentPath = path.join(this.globalDataDir, 'recent.json');

    try {
      if (fs.existsSync(recentPath)) {
        const recent = JSON.parse(fs.readFileSync(recentPath, 'utf-8')) as WorkspaceInfo[];
        // Filter out non-existent workspaces
        return recent.filter(w => fs.existsSync(w.rootPath));
      }
    } catch {
      // Ignore read errors
    }

    return [];
  }

  /**
   * Format workspace info for display
   */
  formatWorkspaceInfo(workspace?: WorkspaceInfo): string {
    const ws = workspace || this.currentWorkspace;
    if (!ws) {
      return 'No workspace initialized.';
    }

    const lines = [
      '',
      '='.repeat(60),
      '  WORKSPACE INFO',
      '='.repeat(60),
      '',
      `  Name:        ${ws.name}`,
      `  ID:          ${ws.id}`,
      `  Path:        ${ws.rootPath}`,
      `  Detected by: ${ws.detectedBy}`,
      `  Project:     ${ws.projectType || 'unknown'}`,
      `  Local .grok: ${ws.hasLocalConfig ? 'Yes' : 'No'}`,
      `  Last access: ${ws.lastAccessed.toLocaleString()}`,
      '',
      '  Data directories:',
      `    Sessions:    ${this.getSessionsDir(ws)}`,
      `    Checkpoints: ${this.getCheckpointsDir(ws)}`,
      `    Memory:      ${this.getMemoryDir(ws)}`,
      '',
      '='.repeat(60),
      '',
    ];

    return lines.join('\n');
  }

  /**
   * Format recent workspaces list
   */
  formatRecentWorkspaces(): string {
    const recent = this.getRecentWorkspaces();

    if (recent.length === 0) {
      return 'No recent workspaces.';
    }

    const lines = [
      '',
      'Recent Workspaces:',
      '-'.repeat(50),
    ];

    for (let i = 0; i < recent.length; i++) {
      const ws = recent[i];
      const current = this.currentWorkspace?.id === ws.id ? ' (current)' : '';
      const lastAccessed = new Date(ws.lastAccessed).toLocaleDateString();
      lines.push(`  ${i + 1}. ${ws.name}${current}`);
      lines.push(`     ${ws.rootPath}`);
      lines.push(`     ${ws.projectType || 'unknown'} | ${lastAccessed}`);
    }

    lines.push('');
    lines.push('Use /workspace switch <path> to switch workspace');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Clean up orphaned workspace data
   */
  cleanupOrphanedWorkspaces(): number {
    let cleaned = 0;

    try {
      const entries = fs.readdirSync(this.globalDataDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'recent.json') {
          const statePath = path.join(this.globalDataDir, entry.name, 'state.json');

          if (fs.existsSync(statePath)) {
            try {
              const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
              // Check if last accessed is more than 90 days ago
              const lastAccessed = new Date(state.lastAccessed);
              const daysSinceAccess = (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);

              if (daysSinceAccess > 90) {
                fs.rmSync(path.join(this.globalDataDir, entry.name), { recursive: true });
                cleaned++;
              }
            } catch {
              // Skip invalid state files
            }
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    return cleaned;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let workspaceManagerInstance: WorkspaceManager | null = null;

export function getWorkspaceManager(config?: Partial<WorkspaceConfig>): WorkspaceManager {
  if (!workspaceManagerInstance) {
    workspaceManagerInstance = new WorkspaceManager(config);
  }
  return workspaceManagerInstance;
}

export function resetWorkspaceManager(): void {
  workspaceManagerInstance = null;
}

/**
 * Initialize workspace from current directory
 */
export async function initializeCurrentWorkspace(): Promise<WorkspaceInfo> {
  const manager = getWorkspaceManager();
  return manager.initializeWorkspace();
}

/**
 * Get current workspace info
 */
export function getCurrentWorkspaceInfo(): WorkspaceInfo | null {
  return getWorkspaceManager().getCurrentWorkspace();
}

/**
 * Get workspace-aware sessions directory
 */
export function getWorkspaceSessionsDir(): string {
  return getWorkspaceManager().getSessionsDir();
}

/**
 * Get workspace-aware checkpoints directory
 */
export function getWorkspaceCheckpointsDir(): string {
  return getWorkspaceManager().getCheckpointsDir();
}

/**
 * Get workspace-aware memory directory
 */
export function getWorkspaceMemoryDir(): string {
  return getWorkspaceManager().getMemoryDir();
}
