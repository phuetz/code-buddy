import * as fs from "fs-extra";
import * as path from "path";
import { measureLatency } from "../../optimization/latency-optimizer.js";
import { getWorkspaceIsolation, type PathValidationResult } from "../../workspace/workspace-isolation.js";

export interface IFileStat {
  isDirectory(): boolean;
  isFile(): boolean;
  size: number;
  mtime: Date;
}

export interface VfsEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface IVfsProvider {
  readFile(path: string, encoding?: string): Promise<string>;
  readFileBuffer(path: string): Promise<Buffer>;
  writeFile(path: string, content: string, encoding?: string): Promise<void>;
  writeFileBuffer(path: string, content: Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<IFileStat>;
  readdir(path: string): Promise<string[]>;
  readDirectory(path: string): Promise<VfsEntry[]>;
  ensureDir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  resolvePath(filePath: string, baseDir: string): { valid: boolean; resolved: string; error?: string };
}

/**
 * Unified Virtual File System Router
 * Centralizes all file operations to prevent "Split Brain" scenarios and enable
 * virtual file systems (e.g. for testing, archives, or remote sync).
 */
export class UnifiedVfsRouter implements IVfsProvider {
  private static instance: UnifiedVfsRouter;
  private providers: Map<string, IVfsProvider> = new Map();

  private constructor() {}

  static get Instance(): UnifiedVfsRouter {
    if (!UnifiedVfsRouter.instance) {
      UnifiedVfsRouter.instance = new UnifiedVfsRouter();
    }
    return UnifiedVfsRouter.instance;
  }

  /**
   * Default implementation using physical file system (fs-extra)
   * File operations are wrapped with latency measurement for performance tracking.
   */
  async readFile(filePath: string, encoding: string = "utf-8"): Promise<string> {
    return measureLatency('file_read', () =>
      fs.readFile(filePath, encoding as BufferEncoding)
    );
  }

  async readFileBuffer(filePath: string): Promise<Buffer> {
    return measureLatency('file_read_buffer', () =>
      fs.readFile(filePath)
    );
  }

  async writeFile(filePath: string, content: string, encoding: string = "utf-8"): Promise<void> {
    await measureLatency('file_write', () =>
      fs.writeFile(filePath, content, encoding as BufferEncoding)
    );
  }

  async writeFileBuffer(filePath: string, content: Buffer): Promise<void> {
    await measureLatency('file_write_buffer', () =>
      fs.writeFile(filePath, content)
    );
  }

  async exists(filePath: string): Promise<boolean> {
    return fs.pathExists(filePath);
  }

  async stat(filePath: string): Promise<IFileStat> {
    return fs.stat(filePath);
  }

  async readdir(dirPath: string): Promise<string[]> {
    return fs.readdir(dirPath);
  }

  async readDirectory(dirPath: string): Promise<VfsEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile()
    }));
  }

  async ensureDir(dirPath: string): Promise<void> {
    return fs.ensureDir(dirPath);
  }

  async remove(filePath: string): Promise<void> {
    return fs.remove(filePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    return fs.rename(oldPath, newPath);
  }

  /**
   * Validates path traversal prevention using workspace isolation.
   * Delegates to WorkspaceIsolation for comprehensive security checks:
   * - Workspace boundary validation
   * - Path traversal prevention
   * - Symlink escape detection
   * - Blocked path enforcement
   * - System whitelist support
   */
  resolvePath(filePath: string, baseDir: string): { valid: boolean; resolved: string; error?: string } {
    const isolation = getWorkspaceIsolation();

    // If isolation is disabled or baseDir differs from workspace root,
    // fall back to basic path validation
    if (!isolation.getConfig().enabled) {
      return this.basicResolvePath(filePath, baseDir);
    }

    // Use workspace isolation for comprehensive validation
    const result = isolation.validatePath(filePath, 'vfs_resolve');

    return {
      valid: result.valid,
      resolved: result.resolved,
      error: result.error,
    };
  }

  /**
   * Basic path resolution without workspace isolation.
   * Used as fallback when isolation is disabled.
   */
  private basicResolvePath(filePath: string, baseDir: string): { valid: boolean; resolved: string; error?: string } {
    const resolved = path.resolve(filePath);
    const normalizedBase = path.normalize(baseDir);
    const normalizedResolved = path.normalize(resolved);

    // First check: normalized path must be within base directory
    if (!normalizedResolved.startsWith(normalizedBase + path.sep) &&
        normalizedResolved !== normalizedBase) {
      return {
        valid: false,
        resolved,
        error: `Path traversal not allowed: ${filePath} resolves outside project directory`
      };
    }

    // Second check: if file exists, resolve symlinks and verify real path
    // Note: We use fs directly here because realpath is a physical FS concept
    try {
      if (fs.existsSync(resolved)) {
        const realPath = fs.realpathSync(resolved);
        const realBase = fs.realpathSync(baseDir);
        if (!realPath.startsWith(realBase + path.sep) && realPath !== realBase) {
          return {
            valid: false,
            resolved,
            error: `Symlink traversal not allowed: ${filePath} points outside project directory`
          };
        }
      }
    } catch (_err) {
      // If realpath fails, allow the operation (file may not exist yet)
    }

    return { valid: true, resolved };
  }

  /**
   * Validate a path using workspace isolation
   * Returns the full PathValidationResult for detailed error handling
   */
  validateWithIsolation(filePath: string, operation?: string): PathValidationResult {
    return getWorkspaceIsolation().validatePath(filePath, operation);
  }
}
