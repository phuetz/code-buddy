/**
 * Undo/Checkpoint System
 *
 * Features:
 * - File state checkpoints
 * - Undo/redo operations
 * - Checkpoint naming and tagging
 * - Diff viewing between checkpoints
 * - Automatic checkpoints before dangerous operations
 * - Git integration for version control
 *
 * Allows reverting changes made by Grok CLI.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync, spawn } from 'child_process';
import { diff_match_patch } from 'diff-match-patch';

export interface Checkpoint {
  id: string;
  name: string;
  description?: string;
  timestamp: Date;
  files: CheckpointFile[];
  metadata: CheckpointMetadata;
  tags: string[];
  parentId?: string;
}

export interface CheckpointFile {
  path: string;
  relativePath: string;
  hash: string;
  size: number;
  mode: number;
  exists: boolean;
  isNew: boolean;
  isDeleted: boolean;
}

export interface CheckpointMetadata {
  workingDirectory: string;
  gitBranch?: string;
  gitCommit?: string;
  sessionId?: string;
  operation: string;
  tool?: string;
  automatic: boolean;
}

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  oldContent?: string;
  newContent?: string;
  diff?: string;
}

export interface UndoResult {
  success: boolean;
  checkpoint: Checkpoint;
  restoredFiles: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface CheckpointConfig {
  enabled: boolean;
  maxCheckpoints: number;
  autoCheckpoint: boolean;
  autoCheckpointInterval: number;
  checkpointOnDangerousOps: boolean;
  excludePatterns: string[];
  maxFileSize: number; // bytes
  compressCheckpoints: boolean;
}

const DEFAULT_CONFIG: CheckpointConfig = {
  enabled: true,
  maxCheckpoints: 100,
  autoCheckpoint: true,
  autoCheckpointInterval: 300000, // 5 minutes
  checkpointOnDangerousOps: true,
  excludePatterns: [
    'node_modules/**',
    '.git/**',
    '*.log',
    '.env*',
    '*.lock',
    'dist/**',
    'build/**',
    '.next/**',
    '__pycache__/**',
    '*.pyc',
  ],
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  compressCheckpoints: true,
};

const DANGEROUS_OPERATIONS = [
  'delete',
  'remove',
  'rm',
  'mv',
  'rename',
  'overwrite',
  'replace',
  'refactor',
  'rewrite',
];

/**
 * Checkpoint Manager
 */
export class CheckpointManager extends EventEmitter {
  private config: CheckpointConfig;
  private dataDir: string;
  private checkpointsDir: string;
  private checkpoints: Checkpoint[] = [];
  private currentIndex: number = -1;
  private workingDirectory: string;
  private autoCheckpointTimer: NodeJS.Timeout | null = null;
  private dmp: diff_match_patch;

  constructor(workingDirectory: string, config: Partial<CheckpointConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.workingDirectory = workingDirectory;
    this.dataDir = path.join(os.homedir(), '.grok', 'checkpoints');
    this.checkpointsDir = path.join(
      this.dataDir,
      this.hashPath(workingDirectory)
    );
    this.dmp = new diff_match_patch();
    this.initialize();
  }

  /**
   * Initialize checkpoint manager
   */
  private async initialize(): Promise<void> {
    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(this.checkpointsDir);
    await fs.ensureDir(path.join(this.checkpointsDir, 'files'));

    await this.loadCheckpoints();

    if (this.config.autoCheckpoint) {
      this.startAutoCheckpoint();
    }
  }

  /**
   * Hash a path for storage
   */
  private hashPath(p: string): string {
    return crypto.createHash('sha256').update(p).digest('hex').slice(0, 16);
  }

  /**
   * Load checkpoints from disk
   */
  private async loadCheckpoints(): Promise<void> {
    const indexPath = path.join(this.checkpointsDir, 'index.json');

    if (await fs.pathExists(indexPath)) {
      try {
        const data = await fs.readJSON(indexPath);
        this.checkpoints = data.checkpoints || [];
        this.currentIndex = data.currentIndex ?? (this.checkpoints.length - 1);
      } catch {
        this.checkpoints = [];
        this.currentIndex = -1;
      }
    }
  }

  /**
   * Save checkpoints index
   */
  private async saveIndex(): Promise<void> {
    const indexPath = path.join(this.checkpointsDir, 'index.json');
    await fs.writeJSON(indexPath, {
      workingDirectory: this.workingDirectory,
      checkpoints: this.checkpoints,
      currentIndex: this.currentIndex,
      updatedAt: new Date().toISOString(),
    }, { spaces: 2 });
  }

  /**
   * Create a new checkpoint
   */
  async createCheckpoint(options: {
    name?: string;
    description?: string;
    operation: string;
    tool?: string;
    files?: string[];
    tags?: string[];
    automatic?: boolean;
  }): Promise<Checkpoint> {
    if (!this.config.enabled) {
      throw new Error('Checkpoints are disabled');
    }

    const id = crypto.randomBytes(8).toString('hex');
    const timestamp = new Date();

    // Get files to checkpoint
    const filesToCheckpoint = options.files || await this.getTrackedFiles();

    // Create file snapshots
    const files: CheckpointFile[] = [];
    for (const filePath of filesToCheckpoint) {
      const file = await this.snapshotFile(filePath, id);
      if (file) {
        files.push(file);
      }
    }

    // Get git info
    const gitInfo = this.getGitInfo();

    const checkpoint: Checkpoint = {
      id,
      name: options.name || `Checkpoint ${this.checkpoints.length + 1}`,
      description: options.description,
      timestamp,
      files,
      metadata: {
        workingDirectory: this.workingDirectory,
        gitBranch: gitInfo.branch,
        gitCommit: gitInfo.commit,
        operation: options.operation,
        tool: options.tool,
        automatic: options.automatic || false,
      },
      tags: options.tags || [],
      parentId: this.checkpoints.length > 0
        ? this.checkpoints[this.currentIndex]?.id
        : undefined,
    };

    // Remove any checkpoints after current index (for redo clearing)
    if (this.currentIndex < this.checkpoints.length - 1) {
      const removed = this.checkpoints.splice(this.currentIndex + 1);
      for (const cp of removed) {
        await this.deleteCheckpointFiles(cp);
      }
    }

    this.checkpoints.push(checkpoint);
    this.currentIndex = this.checkpoints.length - 1;

    // Enforce max checkpoints
    await this.enforceMaxCheckpoints();

    await this.saveIndex();
    this.emit('checkpoint:created', { checkpoint });

    return checkpoint;
  }

  /**
   * Snapshot a single file
   */
  private async snapshotFile(filePath: string, checkpointId: string): Promise<CheckpointFile | null> {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workingDirectory, filePath);

    const relativePath = path.relative(this.workingDirectory, fullPath);

    // Check exclude patterns
    if (this.isExcluded(relativePath)) {
      return null;
    }

    const exists = await fs.pathExists(fullPath);

    if (!exists) {
      return {
        path: fullPath,
        relativePath,
        hash: '',
        size: 0,
        mode: 0,
        exists: false,
        isNew: false,
        isDeleted: true,
      };
    }

    const stats = await fs.stat(fullPath);

    // Skip large files
    if (stats.size > this.config.maxFileSize) {
      return null;
    }

    // Read and hash content
    const content = await fs.readFile(fullPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Save file content
    const storagePath = path.join(
      this.checkpointsDir,
      'files',
      checkpointId,
      relativePath
    );
    await fs.ensureDir(path.dirname(storagePath));
    await fs.writeFile(storagePath, content);

    // Check if this is a new file
    const isNew = !this.checkpoints.some(cp =>
      cp.files.some(f => f.relativePath === relativePath && f.exists)
    );

    return {
      path: fullPath,
      relativePath,
      hash,
      size: stats.size,
      mode: stats.mode,
      exists: true,
      isNew,
      isDeleted: false,
    };
  }

  /**
   * Check if a path matches exclude patterns
   */
  private isExcluded(relativePath: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      if (this.matchGlob(relativePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob matching
   */
  private matchGlob(path: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/{{GLOBSTAR}}/g, '.*');

    return new RegExp(`^${regexPattern}$`).test(path);
  }

  /**
   * Get tracked files in working directory
   */
  private async getTrackedFiles(): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.workingDirectory, fullPath);

        if (this.isExcluded(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    };

    await walk(this.workingDirectory);
    return files;
  }

  /**
   * Get git info
   */
  private getGitInfo(): { branch?: string; commit?: string } {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workingDirectory,
        encoding: 'utf-8',
      }).trim();

      const commit = execSync('git rev-parse --short HEAD', {
        cwd: this.workingDirectory,
        encoding: 'utf-8',
      }).trim();

      return { branch, commit };
    } catch {
      return {};
    }
  }

  /**
   * Undo to previous checkpoint
   */
  async undo(): Promise<UndoResult | null> {
    if (this.currentIndex <= 0) {
      this.emit('undo:noop', { reason: 'No previous checkpoint' });
      return null;
    }

    const targetCheckpoint = this.checkpoints[this.currentIndex - 1];
    return this.restoreCheckpoint(targetCheckpoint, 'undo');
  }

  /**
   * Redo to next checkpoint
   */
  async redo(): Promise<UndoResult | null> {
    if (this.currentIndex >= this.checkpoints.length - 1) {
      this.emit('redo:noop', { reason: 'No next checkpoint' });
      return null;
    }

    const targetCheckpoint = this.checkpoints[this.currentIndex + 1];
    return this.restoreCheckpoint(targetCheckpoint, 'redo');
  }

  /**
   * Restore a specific checkpoint
   */
  async restoreCheckpoint(checkpoint: Checkpoint, operation: 'undo' | 'redo' | 'restore'): Promise<UndoResult> {
    const restoredFiles: string[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    // Create a safety checkpoint before restore
    await this.createCheckpoint({
      name: `Before ${operation}`,
      operation: operation,
      automatic: true,
    });

    for (const file of checkpoint.files) {
      try {
        const storagePath = path.join(
          this.checkpointsDir,
          'files',
          checkpoint.id,
          file.relativePath
        );

        const targetPath = path.join(this.workingDirectory, file.relativePath);

        if (file.isDeleted || !file.exists) {
          // File was deleted at this checkpoint
          if (await fs.pathExists(targetPath)) {
            await fs.remove(targetPath);
            restoredFiles.push(file.relativePath);
          }
        } else {
          // Restore file content
          await fs.ensureDir(path.dirname(targetPath));

          if (await fs.pathExists(storagePath)) {
            await fs.copy(storagePath, targetPath);
            await fs.chmod(targetPath, file.mode);
            restoredFiles.push(file.relativePath);
          }
        }
      } catch (error: any) {
        errors.push({
          path: file.relativePath,
          error: error.message,
        });
      }
    }

    // Update current index
    const checkpointIndex = this.checkpoints.findIndex(c => c.id === checkpoint.id);
    if (checkpointIndex !== -1) {
      this.currentIndex = checkpointIndex;
    }

    await this.saveIndex();

    const result: UndoResult = {
      success: errors.length === 0,
      checkpoint,
      restoredFiles,
      errors,
    };

    this.emit(`${operation}:complete`, result);

    return result;
  }

  /**
   * Get diff between two checkpoints
   */
  async getDiff(fromId: string, toId: string): Promise<FileChange[]> {
    const fromCheckpoint = this.checkpoints.find(c => c.id === fromId);
    const toCheckpoint = this.checkpoints.find(c => c.id === toId);

    if (!fromCheckpoint || !toCheckpoint) {
      throw new Error('Checkpoint not found');
    }

    const changes: FileChange[] = [];

    // Create maps for easier lookup
    const fromFiles = new Map(fromCheckpoint.files.map(f => [f.relativePath, f]));
    const toFiles = new Map(toCheckpoint.files.map(f => [f.relativePath, f]));

    // Find all unique paths
    const allPaths = new Set([
      ...fromFiles.keys(),
      ...toFiles.keys(),
    ]);

    for (const relativePath of allPaths) {
      const fromFile = fromFiles.get(relativePath);
      const toFile = toFiles.get(relativePath);

      let change: FileChange | null = null;

      if (!fromFile && toFile && toFile.exists) {
        // File was created
        const content = await this.getCheckpointFileContent(toCheckpoint.id, relativePath);
        change = {
          path: relativePath,
          type: 'created',
          newContent: content,
        };
      } else if (fromFile && fromFile.exists && (!toFile || !toFile.exists)) {
        // File was deleted
        const content = await this.getCheckpointFileContent(fromCheckpoint.id, relativePath);
        change = {
          path: relativePath,
          type: 'deleted',
          oldContent: content,
        };
      } else if (fromFile && toFile && fromFile.hash !== toFile.hash) {
        // File was modified
        const oldContent = await this.getCheckpointFileContent(fromCheckpoint.id, relativePath);
        const newContent = await this.getCheckpointFileContent(toCheckpoint.id, relativePath);

        const diffs = this.dmp.diff_main(oldContent || '', newContent || '');
        this.dmp.diff_cleanupSemantic(diffs);
        const patchText = this.dmp.patch_toText(
          this.dmp.patch_make(oldContent || '', diffs)
        );

        change = {
          path: relativePath,
          type: 'modified',
          oldContent,
          newContent,
          diff: patchText,
        };
      }

      if (change) {
        changes.push(change);
      }
    }

    return changes;
  }

  /**
   * Get file content from checkpoint
   */
  private async getCheckpointFileContent(checkpointId: string, relativePath: string): Promise<string | undefined> {
    const storagePath = path.join(
      this.checkpointsDir,
      'files',
      checkpointId,
      relativePath
    );

    try {
      return await fs.readFile(storagePath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /**
   * Delete checkpoint files
   */
  private async deleteCheckpointFiles(checkpoint: Checkpoint): Promise<void> {
    const filesDir = path.join(this.checkpointsDir, 'files', checkpoint.id);
    await fs.remove(filesDir);
  }

  /**
   * Enforce maximum checkpoints
   */
  private async enforceMaxCheckpoints(): Promise<void> {
    while (this.checkpoints.length > this.config.maxCheckpoints) {
      const oldest = this.checkpoints.shift()!;
      await this.deleteCheckpointFiles(oldest);
      if (this.currentIndex > 0) {
        this.currentIndex--;
      }
    }
  }

  /**
   * Check if operation should trigger auto-checkpoint
   */
  shouldAutoCheckpoint(operation: string): boolean {
    if (!this.config.checkpointOnDangerousOps) return false;

    const lowerOp = operation.toLowerCase();
    return DANGEROUS_OPERATIONS.some(op => lowerOp.includes(op));
  }

  /**
   * Start auto-checkpoint timer
   */
  private startAutoCheckpoint(): void {
    this.autoCheckpointTimer = setInterval(async () => {
      try {
        await this.createCheckpoint({
          name: 'Auto checkpoint',
          operation: 'auto',
          automatic: true,
        });
      } catch {
        // Ignore auto-checkpoint errors
      }
    }, this.config.autoCheckpointInterval);
  }

  /**
   * Stop auto-checkpoint timer
   */
  private stopAutoCheckpoint(): void {
    if (this.autoCheckpointTimer) {
      clearInterval(this.autoCheckpointTimer);
      this.autoCheckpointTimer = null;
    }
  }

  /**
   * Get all checkpoints
   */
  getCheckpoints(): Checkpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Get current checkpoint
   */
  getCurrentCheckpoint(): Checkpoint | null {
    return this.checkpoints[this.currentIndex] || null;
  }

  /**
   * Get checkpoint by ID
   */
  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.find(c => c.id === id);
  }

  /**
   * Search checkpoints by tag or name
   */
  searchCheckpoints(query: string): Checkpoint[] {
    const lowerQuery = query.toLowerCase();
    return this.checkpoints.filter(c =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.tags.some(t => t.toLowerCase().includes(lowerQuery)) ||
      c.description?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Tag a checkpoint
   */
  async tagCheckpoint(id: string, tag: string): Promise<void> {
    const checkpoint = this.checkpoints.find(c => c.id === id);
    if (!checkpoint) {
      throw new Error('Checkpoint not found');
    }

    if (!checkpoint.tags.includes(tag)) {
      checkpoint.tags.push(tag);
      await this.saveIndex();
    }
  }

  /**
   * Rename a checkpoint
   */
  async renameCheckpoint(id: string, name: string): Promise<void> {
    const checkpoint = this.checkpoints.find(c => c.id === id);
    if (!checkpoint) {
      throw new Error('Checkpoint not found');
    }

    checkpoint.name = name;
    await this.saveIndex();
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(id: string): Promise<void> {
    const index = this.checkpoints.findIndex(c => c.id === id);
    if (index === -1) {
      throw new Error('Checkpoint not found');
    }

    const checkpoint = this.checkpoints[index];
    await this.deleteCheckpointFiles(checkpoint);
    this.checkpoints.splice(index, 1);

    if (this.currentIndex >= index) {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    }

    await this.saveIndex();
    this.emit('checkpoint:deleted', { id });
  }

  /**
   * Can undo
   */
  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  /**
   * Can redo
   */
  canRedo(): boolean {
    return this.currentIndex < this.checkpoints.length - 1;
  }

  /**
   * Format status
   */
  formatStatus(): string {
    const current = this.getCurrentCheckpoint();

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                    ↩️  CHECKPOINT MANAGER                     ║',
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Total Checkpoints: ${this.checkpoints.length.toString().padEnd(40)}║`,
      `║ Current Position:  ${(this.currentIndex + 1)}/${this.checkpoints.length}${''.padEnd(37)}║`,
      `║ Can Undo:          ${this.canUndo() ? '✅ Yes' : '❌ No'}${''.padEnd(35)}║`,
      `║ Can Redo:          ${this.canRedo() ? '✅ Yes' : '❌ No'}${''.padEnd(35)}║`,
      '╠══════════════════════════════════════════════════════════════╣',
    ];

    if (current) {
      lines.push('║ CURRENT CHECKPOINT                                           ║');
      lines.push(`║ Name: ${current.name.slice(0, 50).padEnd(53)}║`);
      lines.push(`║ Time: ${new Date(current.timestamp).toLocaleString().padEnd(53)}║`);
      lines.push(`║ Files: ${current.files.length.toString().padEnd(52)}║`);
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');

    // Show recent checkpoints
    const recent = this.checkpoints.slice(-5).reverse();
    if (recent.length > 0) {
      lines.push('║ RECENT CHECKPOINTS                                           ║');
      for (const cp of recent) {
        const marker = cp.id === current?.id ? '→' : ' ';
        const auto = cp.metadata.automatic ? '🤖' : '👤';
        lines.push(`║ ${marker} ${auto} ${cp.name.slice(0, 45).padEnd(45)} ${cp.files.length} files ║`);
      }
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ /undo | /redo | /checkpoint create <name>                    ║');
    lines.push('║ /checkpoint list | /checkpoint restore <id>                  ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.stopAutoCheckpoint();
    this.saveIndex();
    this.removeAllListeners();
  }
}

// Factory function
export function createCheckpointManager(
  workingDirectory: string,
  config?: Partial<CheckpointConfig>
): CheckpointManager {
  return new CheckpointManager(workingDirectory, config);
}
