import fs from "fs-extra";
import { createFileExclusive } from "./exclusive-create.js";
import * as path from "path";
import { measureLatency } from "../../optimization/latency-optimizer.js";
import { getWorkspaceIsolation, type PathValidationResult } from "../../workspace/workspace-isolation.js";
import {
  checkSecretFileAccess,
  formatSecretRefusal,
  type SecretFileAccess,
} from "../../security/secret-files.js";

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
  /** `access` defaults to 'read'; writers pass 'write' (read-only whitelist, credential stores). */
  resolvePath(
    filePath: string,
    baseDir: string,
    access?: SecretFileAccess
  ): { valid: boolean; resolved: string; error?: string };
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
    const verdict = checkSecretFileAccess(filePath, 'read');
    if (verdict.secret) throw new Error(formatSecretRefusal(filePath, verdict));
    return measureLatency('file_read', () =>
      fs.readFile(filePath, encoding as BufferEncoding)
    );
  }

  async readFileBuffer(filePath: string): Promise<Buffer> {
    const verdict = checkSecretFileAccess(filePath, 'read');
    if (verdict.secret) throw new Error(formatSecretRefusal(filePath, verdict));
    return measureLatency('file_read_buffer', () =>
      fs.readFile(filePath)
    );
  }

  async writeFile(filePath: string, content: string, encoding: string = "utf-8"): Promise<void> {
    await measureLatency('file_write', () =>
      fs.writeFile(filePath, content, encoding as BufferEncoding)
    );
  }

  /** Exclusive creation; never overwrite an entry appearing after confirmation. */
  async createFile(filePath: string, content: string, encoding: string = 'utf-8', baseDirectory: string = process.cwd()): Promise<void> {
    await measureLatency('file_create', async () => {
      createFileExclusive(filePath, content, encoding as BufferEncoding, () => {
        const verdict = this.resolvePath(filePath, baseDirectory, 'write');
        if (!verdict.valid) throw new Error(verdict.error ?? 'Creation path refused');
      });
    });
  }

  /** lstat observes the entry itself, including dangling symlinks. */
  async lstat(filePath: string): Promise<IFileStat | null> {
    try { return await fs.lstat(filePath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
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
  resolvePath(
    filePath: string,
    baseDir: string,
    access: SecretFileAccess = 'read'
  ): { valid: boolean; resolved: string; error?: string } {
    const isolation = getWorkspaceIsolation();

    // If isolation is disabled, fall back to basic path validation (which
    // still refuses credential files).
    if (!isolation.getConfig().enabled) {
      return this.basicResolvePath(filePath, baseDir, access);
    }

    // Use workspace isolation for comprehensive validation
    const result = isolation.validatePath(filePath, 'vfs_resolve', access);

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
  private basicResolvePath(
    filePath: string,
    baseDir: string,
    access: SecretFileAccess = 'read'
  ): { valid: boolean; resolved: string; error?: string } {
    const resolved = path.resolve(filePath);

    const secret = checkSecretFileAccess(resolved, access);
    if (secret.secret) {
      return { valid: false, resolved, error: formatSecretRefusal(filePath, secret) };
    }
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

    // Second check: resolve symlinks through the nearest EXISTING ancestor, so
    // `link/new-file` (where `link` points outside) is caught before a create,
    // not only when the final file already exists.
    // Note: We use fs directly here because realpath is a physical FS concept
    let realBase: string;
    try {
      realBase = fs.realpathSync(baseDir);
    } catch (_err) {
      return {
        valid: false,
        resolved,
        error: `Project directory cannot be resolved: ${baseDir}`
      };
    }
    let ancestor = resolved;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    let realPath: string;
    try {
      const realAncestor = fs.realpathSync(ancestor);
      const suffix = path.relative(ancestor, resolved);
      realPath = suffix ? path.resolve(realAncestor, suffix) : realAncestor;
    } catch (_err) {
      // Fail closed: an ancestor exists but cannot be resolved (permissions,
      // symlink loop) — we cannot prove where the path lands.
      return {
        valid: false,
        resolved,
        error: `Path cannot be resolved safely: ${filePath}`
      };
    }
    if (!realPath.startsWith(realBase + path.sep) && realPath !== realBase) {
      return {
        valid: false,
        resolved,
        error: `Symlink traversal not allowed: ${filePath} points outside project directory`
      };
    }

    return { valid: true, resolved };
  }

  /**
   * Validate a path using workspace isolation
   * Returns the full PathValidationResult for detailed error handling
   */
  validateWithIsolation(
    filePath: string,
    operation?: string,
    access: SecretFileAccess = 'read'
  ): PathValidationResult {
    return getWorkspaceIsolation().validatePath(filePath, operation, access);
  }
}
