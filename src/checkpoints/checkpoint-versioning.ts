/**
 * Checkpoint Versioning System
 *
 * Extends checkpoint management with version control features:
 * - Named versions (tags)
 * - Version branches
 * - Version history with metadata
 * - Diff between versions
 * - Merge capabilities
 */

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { Checkpoint, FileSnapshot } from './checkpoint-manager.js';
import { logger } from '../utils/logger.js';

export interface Version {
  id: string;
  name?: string;
  description: string;
  parentId: string | null;
  branchName: string;
  checkpoint: Checkpoint;
  metadata: VersionMetadata;
  createdAt: Date;
}

export interface VersionMetadata {
  author?: string;
  sessionId?: string;
  toolName?: string;
  tags: string[];
  custom: Record<string, unknown>;
}

export interface Branch {
  name: string;
  headVersionId: string;
  createdAt: Date;
  description?: string;
}

export interface VersionDiff {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
  details: Array<{
    path: string;
    type: 'added' | 'modified' | 'deleted';
    oldContent?: string;
    newContent?: string;
    hunks?: DiffHunk[];
  }>;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface VersioningConfig {
  storageDir?: string;
  maxVersionsPerBranch?: number;
  defaultBranch?: string;
  autoSave?: boolean;
}

const DEFAULT_CONFIG: Required<VersioningConfig> = {
  storageDir: '.codebuddy/versions',
  maxVersionsPerBranch: 100,
  defaultBranch: 'main',
  autoSave: true,
};

/**
 * Checkpoint Versioning Manager
 */
export class CheckpointVersioning extends EventEmitter {
  private config: Required<VersioningConfig>;
  private versions: Map<string, Version> = new Map();
  private branches: Map<string, Branch> = new Map();
  private currentBranch: string;
  private tags: Map<string, string> = new Map(); // tag name -> version id
  private workingDirectory: string;

  constructor(config: VersioningConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentBranch = this.config.defaultBranch;
    this.workingDirectory = process.cwd();

    // Initialize default branch
    this.branches.set(this.config.defaultBranch, {
      name: this.config.defaultBranch,
      headVersionId: '',
      createdAt: new Date(),
      description: 'Default branch',
    });
  }

  /**
   * Create a new version from a checkpoint
   */
  createVersion(
    checkpoint: Checkpoint,
    options: {
      name?: string;
      description?: string;
      metadata?: Partial<VersionMetadata>;
    } = {}
  ): Version {
    const branch = this.branches.get(this.currentBranch);
    if (!branch) {
      throw new Error(`Branch not found: ${this.currentBranch}`);
    }

    const version: Version = {
      id: this.generateVersionId(checkpoint),
      name: options.name,
      description: options.description || checkpoint.description,
      parentId: branch.headVersionId || null,
      branchName: this.currentBranch,
      checkpoint,
      metadata: {
        author: process.env.USER || 'unknown',
        sessionId: undefined,
        toolName: undefined,
        tags: [],
        custom: {},
        ...options.metadata,
      },
      createdAt: new Date(),
    };

    this.versions.set(version.id, version);

    // Update branch head
    branch.headVersionId = version.id;

    // Auto-save if enabled
    if (this.config.autoSave) {
      this.save().catch((err) => {
        logger.debug('Failed to auto-save checkpoint version', { error: err instanceof Error ? err.message : String(err) });
      });
    }

    this.emit('version-created', version);
    return version;
  }

  /**
   * Generate a unique version ID based on content hash
   */
  private generateVersionId(checkpoint: Checkpoint): string {
    const content = JSON.stringify({
      files: checkpoint.files.map((f) => ({
        path: f.path,
        content: f.content,
        existed: f.existed,
      })),
      timestamp: checkpoint.timestamp.getTime(),
    });

    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return `v_${hash.slice(0, 12)}`;
  }

  /**
   * Create a tag for a version
   */
  createTag(versionId: string, tagName: string): void {
    if (!this.versions.has(versionId)) {
      throw new Error(`Version not found: ${versionId}`);
    }

    if (this.tags.has(tagName)) {
      throw new Error(`Tag already exists: ${tagName}`);
    }

    this.tags.set(tagName, versionId);
    this.emit('tag-created', { tagName, versionId });
  }

  /**
   * Delete a tag
   */
  deleteTag(tagName: string): boolean {
    return this.tags.delete(tagName);
  }

  /**
   * Get version by tag name
   */
  getVersionByTag(tagName: string): Version | undefined {
    const versionId = this.tags.get(tagName);
    return versionId ? this.versions.get(versionId) : undefined;
  }

  /**
   * Create a new branch
   */
  createBranch(name: string, fromVersionId?: string, description?: string): Branch {
    if (this.branches.has(name)) {
      throw new Error(`Branch already exists: ${name}`);
    }

    const headId = fromVersionId || this.getCurrentVersion()?.id || '';

    const branch: Branch = {
      name,
      headVersionId: headId,
      createdAt: new Date(),
      description,
    };

    this.branches.set(name, branch);
    this.emit('branch-created', branch);
    return branch;
  }

  /**
   * Switch to a different branch
   */
  switchBranch(name: string): Branch {
    const branch = this.branches.get(name);
    if (!branch) {
      throw new Error(`Branch not found: ${name}`);
    }

    this.currentBranch = name;
    this.emit('branch-switched', branch);
    return branch;
  }

  /**
   * Delete a branch
   */
  deleteBranch(name: string): boolean {
    if (name === this.config.defaultBranch) {
      throw new Error('Cannot delete default branch');
    }

    if (name === this.currentBranch) {
      throw new Error('Cannot delete current branch');
    }

    return this.branches.delete(name);
  }

  /**
   * Get the current version (head of current branch)
   */
  getCurrentVersion(): Version | undefined {
    const branch = this.branches.get(this.currentBranch);
    if (!branch || !branch.headVersionId) {
      return undefined;
    }
    return this.versions.get(branch.headVersionId);
  }

  /**
   * Get version history for current branch
   */
  getVersionHistory(options: { limit?: number; branch?: string } = {}): Version[] {
    const branchName = options.branch || this.currentBranch;
    const limit = options.limit || 50;

    const history: Version[] = [];
    let currentId = this.branches.get(branchName)?.headVersionId;

    while (currentId && history.length < limit) {
      const version = this.versions.get(currentId);
      if (!version) break;

      history.push(version);
      currentId = version.parentId ?? undefined;
    }

    return history;
  }

  /**
   * Checkout a specific version
   */
  async checkout(versionId: string): Promise<{ success: boolean; restored: string[]; errors: string[] }> {
    const version = this.versions.get(versionId);
    if (!version) {
      return {
        success: false,
        restored: [],
        errors: [`Version not found: ${versionId}`],
      };
    }

    const restored: string[] = [];
    const errors: string[] = [];

    for (const snapshot of version.checkpoint.files) {
      try {
        if (snapshot.existed) {
          const dir = path.dirname(snapshot.path);
          await fs.ensureDir(dir);
          await fs.writeFile(snapshot.path, snapshot.content, 'utf-8');
          restored.push(snapshot.path);
        } else if (await fs.pathExists(snapshot.path)) {
          await fs.unlink(snapshot.path);
          restored.push(`Deleted: ${snapshot.path}`);
        }
      } catch (error) {
        errors.push(`Failed to restore ${snapshot.path}: ${String(error)}`);
      }
    }

    this.emit('checkout', version, restored, errors);
    return { success: errors.length === 0, restored, errors };
  }

  /**
   * Diff between two versions
   */
  diff(fromVersionId: string, toVersionId: string): VersionDiff {
    const fromVersion = this.versions.get(fromVersionId);
    const toVersion = this.versions.get(toVersionId);

    if (!fromVersion || !toVersion) {
      throw new Error('One or both versions not found');
    }

    const fromFiles = new Map<string, FileSnapshot>(
      fromVersion.checkpoint.files.map((f) => [f.path, f])
    );
    const toFiles = new Map<string, FileSnapshot>(
      toVersion.checkpoint.files.map((f) => [f.path, f])
    );

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const unchanged: string[] = [];
    const details: VersionDiff['details'] = [];

    // Check files in toVersion
    for (const [filePath, toFile] of toFiles) {
      const fromFile = fromFiles.get(filePath);

      if (!fromFile || !fromFile.existed) {
        if (toFile.existed) {
          added.push(filePath);
          details.push({
            path: filePath,
            type: 'added',
            newContent: toFile.content,
          });
        }
      } else if (!toFile.existed) {
        deleted.push(filePath);
        details.push({
          path: filePath,
          type: 'deleted',
          oldContent: fromFile.content,
        });
      } else if (fromFile.content !== toFile.content) {
        modified.push(filePath);
        details.push({
          path: filePath,
          type: 'modified',
          oldContent: fromFile.content,
          newContent: toFile.content,
          hunks: this.computeDiffHunks(fromFile.content, toFile.content),
        });
      } else {
        unchanged.push(filePath);
      }
    }

    // Check for files deleted in toVersion
    for (const [filePath, fromFile] of fromFiles) {
      if (fromFile.existed && !toFiles.has(filePath)) {
        deleted.push(filePath);
        details.push({
          path: filePath,
          type: 'deleted',
          oldContent: fromFile.content,
        });
      }
    }

    return { added, modified, deleted, unchanged, details };
  }

  /**
   * Compute diff hunks between two file contents
   */
  private computeDiffHunks(oldContent: string, newContent: string): DiffHunk[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const hunks: DiffHunk[] = [];

    // Simple line-by-line diff (not LCS-based for simplicity)
    let i = 0;
    let j = 0;
    let hunkStart = -1;
    let hunkLines: string[] = [];

    while (i < oldLines.length || j < newLines.length) {
      if (i >= oldLines.length) {
        // Remaining lines are additions
        if (hunkStart < 0) hunkStart = i;
        hunkLines.push(`+ ${newLines[j]}`);
        j++;
      } else if (j >= newLines.length) {
        // Remaining lines are deletions
        if (hunkStart < 0) hunkStart = i;
        hunkLines.push(`- ${oldLines[i]}`);
        i++;
      } else if (oldLines[i] === newLines[j]) {
        // Lines match - finalize current hunk if any
        if (hunkLines.length > 0) {
          hunks.push({
            oldStart: hunkStart + 1,
            oldLines: hunkLines.filter((l) => l.startsWith('-')).length,
            newStart: hunkStart + 1,
            newLines: hunkLines.filter((l) => l.startsWith('+')).length,
            lines: hunkLines,
          });
          hunkLines = [];
          hunkStart = -1;
        }
        i++;
        j++;
      } else {
        // Lines differ
        if (hunkStart < 0) hunkStart = i;
        hunkLines.push(`- ${oldLines[i]}`);
        hunkLines.push(`+ ${newLines[j]}`);
        i++;
        j++;
      }
    }

    // Finalize last hunk
    if (hunkLines.length > 0) {
      hunks.push({
        oldStart: hunkStart + 1,
        oldLines: hunkLines.filter((l) => l.startsWith('-')).length,
        newStart: hunkStart + 1,
        newLines: hunkLines.filter((l) => l.startsWith('+')).length,
        lines: hunkLines,
      });
    }

    return hunks;
  }

  /**
   * Find common ancestor of two versions
   */
  findCommonAncestor(versionId1: string, versionId2: string): Version | undefined {
    const ancestors1 = new Set<string>();
    let current: string | null | undefined = versionId1;

    // Collect all ancestors of version 1
    while (current) {
      ancestors1.add(current);
      const version = this.versions.get(current);
      current = version?.parentId;
    }

    // Find first ancestor of version 2 that's also an ancestor of version 1
    current = versionId2;
    while (current) {
      if (ancestors1.has(current)) {
        return this.versions.get(current);
      }
      const version = this.versions.get(current);
      current = version?.parentId;
    }

    return undefined;
  }

  /**
   * Save versioning state to disk
   */
  async save(): Promise<void> {
    const storageDir = path.join(this.workingDirectory, this.config.storageDir);
    await fs.ensureDir(storageDir);

    const state = {
      versions: Array.from(this.versions.entries()),
      branches: Array.from(this.branches.entries()),
      tags: Array.from(this.tags.entries()),
      currentBranch: this.currentBranch,
    };

    await fs.writeJson(path.join(storageDir, 'versions.json'), state, { spaces: 2 });
  }

  /**
   * Load versioning state from disk
   */
  async load(): Promise<void> {
    const storageDir = path.join(this.workingDirectory, this.config.storageDir);
    const filePath = path.join(storageDir, 'versions.json');

    if (!(await fs.pathExists(filePath))) {
      return;
    }

    try {
      const state = await fs.readJson(filePath);

      this.versions = new Map(
        state.versions.map(([id, v]: [string, Version]) => [
          id,
          {
            ...v,
            createdAt: new Date(v.createdAt),
            checkpoint: {
              ...v.checkpoint,
              timestamp: new Date(v.checkpoint.timestamp),
            },
          },
        ])
      );

      this.branches = new Map(
        state.branches.map(([name, b]: [string, Branch]) => [
          name,
          { ...b, createdAt: new Date(b.createdAt) },
        ])
      );

      this.tags = new Map(state.tags);
      this.currentBranch = state.currentBranch;
    } catch (error) {
      this.emit('load-error', error);
    }
  }

  /**
   * Get all branches
   */
  getBranches(): Branch[] {
    return Array.from(this.branches.values());
  }

  /**
   * Get current branch name
   */
  getCurrentBranch(): string {
    return this.currentBranch;
  }

  /**
   * Get all tags
   */
  getTags(): Map<string, string> {
    return new Map(this.tags);
  }

  /**
   * Get a version by ID
   */
  getVersion(id: string): Version | undefined {
    return this.versions.get(id);
  }

  /**
   * Format version for display
   */
  formatVersion(version: Version): string {
    const time = version.createdAt.toLocaleString();
    const name = version.name ? ` (${version.name})` : '';
    const tags = version.metadata.tags.length > 0 ? ` [${version.metadata.tags.join(', ')}]` : '';
    return `${version.id.slice(0, 10)}${name} - ${version.description}${tags} (${time})`;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalVersions: number;
    totalBranches: number;
    totalTags: number;
    versionsPerBranch: Record<string, number>;
  } {
    const versionsPerBranch: Record<string, number> = {};

    for (const version of this.versions.values()) {
      versionsPerBranch[version.branchName] =
        (versionsPerBranch[version.branchName] || 0) + 1;
    }

    return {
      totalVersions: this.versions.size,
      totalBranches: this.branches.size,
      totalTags: this.tags.size,
      versionsPerBranch,
    };
  }

  /**
   * Clean up old versions
   */
  prune(keepCount: number = 50): number {
    const branchVersions = new Map<string, Version[]>();

    // Group versions by branch
    for (const version of this.versions.values()) {
      const versions = branchVersions.get(version.branchName) || [];
      versions.push(version);
      branchVersions.set(version.branchName, versions);
    }

    let pruned = 0;

    // Prune each branch
    for (const [branchName, versions] of branchVersions) {
      // Sort by date (newest first)
      versions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Keep only the most recent
      const toDelete = versions.slice(keepCount);

      for (const version of toDelete) {
        // Don't delete tagged versions
        const isTagged = Array.from(this.tags.values()).includes(version.id);
        if (!isTagged) {
          this.versions.delete(version.id);
          pruned++;
        }
      }

      // Update branch head if needed
      const branch = this.branches.get(branchName);
      if (branch && !this.versions.has(branch.headVersionId)) {
        const remaining = versions.filter((v) => this.versions.has(v.id));
        if (remaining.length > 0) {
          branch.headVersionId = remaining[0].id;
        }
      }
    }

    if (pruned > 0 && this.config.autoSave) {
      this.save().catch((err) => {
        logger.debug('Failed to save after pruning', { error: err instanceof Error ? err.message : String(err) });
      });
    }

    return pruned;
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    this.versions.clear();
    this.branches.clear();
    this.tags.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
let versioningInstance: CheckpointVersioning | null = null;

/**
 * Get the checkpoint versioning instance
 */
export function getCheckpointVersioning(config?: VersioningConfig): CheckpointVersioning {
  if (!versioningInstance) {
    versioningInstance = new CheckpointVersioning(config);
  }
  return versioningInstance;
}

/**
 * Reset the versioning instance
 */
export function resetCheckpointVersioning(): void {
  if (versioningInstance) {
    versioningInstance.dispose();
  }
  versioningInstance = null;
}

export default CheckpointVersioning;
