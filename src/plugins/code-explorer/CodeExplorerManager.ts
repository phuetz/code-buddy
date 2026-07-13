/**
 * CodeExplorer Manager
 *
 * Handles CodeExplorer indexing, stats retrieval, and MCP server lifecycle.
 * CodeExplorer provides code graph analysis (symbols, relations, processes, clusters)
 * and exposes them via an MCP server for agent consumption.
 *
 * Usage:
 *   const mgr = getCodeExplorerManager('/path/to/repo');
 *   if (mgr.isInstalled() && !mgr.isRepoIndexed()) {
 *     await mgr.analyze();
 *   }
 *   await mgr.startMCPServer();
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../utils/logger.js';

export interface CodeExplorerStats {
  symbols: number;
  relations: number;
  processes: number;
  clusters: number;
  indexed: boolean;
  stale: boolean;
}

export interface CodeExplorerFreshness {
  indexed: boolean;
  /** Commit the index was built from (real `.gitnexus` schema only). */
  lastCommit?: string;
  /** ISO timestamp the index was built (real `.gitnexus` schema only). */
  indexedAt?: string;
  /** Commits on HEAD since the index was built (undefined if uncomputable). */
  commitsBehind?: number;
  /** The graph no longer matches HEAD (or the legacy `stale` flag was set). */
  stale: boolean;
}

const DEFAULT_STATS: CodeExplorerStats = {
  symbols: 0,
  relations: 0,
  processes: 0,
  clusters: 0,
  indexed: false,
  stale: false,
};

/** Singleton cache keyed by resolved repo path */
const instances = new Map<string, CodeExplorerManager>();

/**
 * The engine ships under TWO binary names: `code-explorer` (the product name)
 * and `gitnexus` (the original name, still what many installs have on PATH).
 * Same double-name tolerance as the MCP tool prefix (CODE_EXPLORER_TOOL_RE in
 * codebuddy/tools.ts) — only probing `code-explorer` silently broke every
 * gitnexus install.
 */
const CODE_EXPLORER_BINARIES = ['code-explorer', 'gitnexus'] as const;

export class CodeExplorerManager {
  private repoPath: string;
  private mcpProcess: ChildProcess | null = null;
  private autoIndexAttemptedFor: string | null = null;
  /** Resolved binary name; undefined = not probed yet, null = none found. */
  private binaryName: string | null | undefined;

  constructor(repoPath: string = process.cwd()) {
    this.repoPath = path.resolve(repoPath);
  }

  /** First CLI name on PATH that answers `--version`, cached per instance. */
  private resolveBinary(): string | null {
    if (this.binaryName !== undefined) return this.binaryName;
    for (const name of CODE_EXPLORER_BINARIES) {
      try {
        execSync(`${name} --version`, {
          stdio: 'pipe',
          timeout: 10_000,
          cwd: this.repoPath,
        });
        this.binaryName = name;
        return name;
      } catch {
        // Try the next name.
      }
    }
    this.binaryName = null;
    return null;
  }

  /** Check whether the CLI (`code-explorer` or `gitnexus`) is available on PATH. */
  isInstalled(): boolean {
    return this.resolveBinary() !== null;
  }

  /**
   * Check whether the repo has been indexed. The engine writes its index under
   * `.gitnexus/` (real, current) — the legacy `.codeexplorer/` name is still
   * probed first for back-compat.
   */
  isRepoIndexed(): boolean {
    return (
      fs.existsSync(path.join(this.repoPath, '.codeexplorer')) ||
      fs.existsSync(path.join(this.repoPath, '.gitnexus'))
    );
  }

  /**
   * Read the index `meta.json`, trying the legacy `.codeexplorer/` layout first
   * then the real `.gitnexus/` one. Returns the raw parsed object, or null if
   * absent/malformed (callers fall back to defaults).
   */
  private readMeta(): Record<string, unknown> | null {
    for (const dir of ['.codeexplorer', '.gitnexus']) {
      const metaPath = path.join(this.repoPath, dir, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
      } catch (err) {
        logger.warn('CodeExplorer: failed to read meta.json', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }
    return null;
  }

  /**
   * Run `code-explorer analyze` to index the repository.
   *
   * @param options.force  - Re-index even if `.codeexplorer/` already exists.
   * @param options.withSkills - Also generate skill annotations.
   */
  async analyze(options: { force?: boolean; withSkills?: boolean } = {}): Promise<void> {
    const args = ['analyze'];
    if (options.force) args.push('--force');
    if (options.withSkills) args.push('--with-skills');

    logger.info(`CodeExplorer: analyzing repo at ${this.repoPath}`, { args });

    const binary = this.resolveBinary();
    if (!binary) {
      throw new Error(
        `CodeExplorer analyze failed: neither ${CODE_EXPLORER_BINARIES.join(' nor ')} is on PATH`,
      );
    }

    return new Promise<void>((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd: this.repoPath,
        stdio: 'pipe',
        shell: true,
      });

      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) logger.debug(`CodeExplorer analyze: ${line}`);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        logger.error('CodeExplorer analyze failed to start', { error: err.message });
        reject(new Error(`CodeExplorer analyze failed to start: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          logger.info('CodeExplorer: analysis complete');
          resolve();
        } else {
          const msg = `CodeExplorer analyze exited with code ${code}: ${stderr.trim()}`;
          logger.error(msg);
          reject(new Error(msg));
        }
      });
    });
  }

  /**
   * Read stats from the index `meta.json`. Supports BOTH on-disk schemas:
   *   - legacy flat `.codeexplorer` shape: `{symbols, relations, processes, clusters, stale}`
   *   - real `.gitnexus` shape: `{lastCommit, indexedAt, stats:{nodes, edges, communities, processes}}`
   * Returns defaults if the index is absent or malformed. Cheap (no git) — use
   * getFreshness() to compare against HEAD.
   */
  getStats(): CodeExplorerStats {
    const meta = this.readMeta();
    if (!meta) return { ...DEFAULT_STATS };

    const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
    const nested =
      meta.stats && typeof meta.stats === 'object' ? (meta.stats as Record<string, unknown>) : null;

    if (nested) {
      return {
        symbols: num(nested.nodes),
        relations: num(nested.edges),
        processes: num(nested.processes),
        clusters: num(nested.communities),
        indexed: true,
        stale: meta.stale === true,
      };
    }

    return {
      symbols: num(meta.symbols),
      relations: num(meta.relations),
      processes: num(meta.processes),
      clusters: num(meta.clusters),
      indexed: true,
      stale: meta.stale === true,
    };
  }

  /**
   * Compare the index's `lastCommit` (real `.gitnexus` schema) against the
   * repo's current git HEAD to detect a stale graph — the fix for "the agent
   * reasons over an index N commits behind without knowing it". Unlike
   * getStats() this may shell out to git, so it's a deliberate call.
   * `runGit` is injectable for testing.
   */
  getFreshness(
    runGit: (args: string, cwd: string) => string = (args, cwd) =>
      execSync(`git ${args}`, { cwd, stdio: 'pipe', timeout: 10_000 }).toString().trim(),
  ): CodeExplorerFreshness {
    const meta = this.readMeta();
    if (!meta) return { indexed: false, stale: false };

    const lastCommit = typeof meta.lastCommit === 'string' ? meta.lastCommit : undefined;
    const indexedAt = typeof meta.indexedAt === 'string' ? meta.indexedAt : undefined;

    // Legacy flat schema: no commit recorded, trust the explicit stale flag.
    if (!lastCommit) {
      const freshness = {
        indexed: true,
        stale: meta.stale === true,
        ...(indexedAt ? { indexedAt } : {}),
      };
      this.maybeAutoIndex(freshness);
      return freshness;
    }

    let commitsBehind: number | undefined;
    try {
      const out = runGit(`rev-list --count ${lastCommit}..HEAD`, this.repoPath);
      const n = Number.parseInt(out, 10);
      if (Number.isFinite(n)) commitsBehind = n;
    } catch {
      // Not a git repo, unknown commit, or git unavailable → leave undefined.
    }

    const freshness = {
      indexed: true,
      lastCommit,
      ...(indexedAt ? { indexedAt } : {}),
      ...(commitsBehind !== undefined ? { commitsBehind } : {}),
      stale: (commitsBehind ?? 0) > 0,
    };
    this.maybeAutoIndex(freshness);
    return freshness;
  }

  /** Launch one detached incremental refresh per stale index revision when explicitly enabled. */
  private maybeAutoIndex(freshness: CodeExplorerFreshness): void {
    if (!freshness.stale || process.env.CODEBUDDY_CODE_EXPLORER_AUTOINDEX !== 'true') return;

    const revision = freshness.lastCommit ?? freshness.indexedAt ?? 'legacy';
    if (this.autoIndexAttemptedFor === revision) return;
    this.autoIndexAttemptedFor = revision;

    try {
      const child = spawn('gitnexus', ['analyze', '--incremental'], {
        cwd: this.repoPath,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', (err) => {
        logger.warn('CodeExplorer: background auto-index failed', { error: err.message });
      });
      child.on('close', (code) => {
        if (code === 0) {
          logger.info('CodeExplorer: background auto-index complete');
        } else {
          logger.warn('CodeExplorer: background auto-index exited unsuccessfully', { code });
        }
      });
      child.unref();
      logger.info('CodeExplorer: background auto-index started');
    } catch (err) {
      logger.warn('CodeExplorer: failed to launch background auto-index', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Start the CodeExplorer MCP server as a child process (stdio transport).
   * Only one server is kept alive per manager instance.
   */
  async startMCPServer(): Promise<void> {
    if (this.mcpProcess) {
      logger.debug('CodeExplorer MCP server already running');
      return;
    }

    logger.info('CodeExplorer: starting MCP server');

    const binary = this.resolveBinary();
    if (!binary) {
      throw new Error(
        `CodeExplorer MCP server failed to start: neither ${CODE_EXPLORER_BINARIES.join(' nor ')} is on PATH`,
      );
    }

    this.mcpProcess = spawn(binary, ['mcp'], {
      cwd: this.repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    this.mcpProcess.on('error', (err) => {
      logger.error('CodeExplorer MCP server error', { error: err.message });
      this.mcpProcess = null;
    });

    this.mcpProcess.on('close', (code) => {
      logger.debug(`CodeExplorer MCP server exited with code ${code}`);
      this.mcpProcess = null;
    });

    // Give the server a moment to start
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    logger.info('CodeExplorer MCP server started');
  }

  /** Stop the MCP server if running. */
  stopMCPServer(): void {
    if (this.mcpProcess) {
      logger.debug('CodeExplorer: stopping MCP server');
      this.mcpProcess.kill();
      this.mcpProcess = null;
    }
  }

  /** Get the repo path this manager is bound to. */
  getRepoPath(): string {
    return this.repoPath;
  }

  /** Whether the MCP server process is currently alive. */
  isMCPRunning(): boolean {
    return this.mcpProcess !== null && !this.mcpProcess.killed;
  }

  /** Clean up resources. */
  dispose(): void {
    this.stopMCPServer();
  }
}

/**
 * Get or create a singleton CodeExplorerManager for the given repo path.
 * Defaults to `process.cwd()` if no path is provided.
 */
export function getCodeExplorerManager(repoPath?: string): CodeExplorerManager {
  const resolved = path.resolve(repoPath || process.cwd());
  let manager = instances.get(resolved);
  if (!manager) {
    manager = new CodeExplorerManager(resolved);
    instances.set(resolved, manager);
  }
  return manager;
}

/** Clear the singleton cache (for testing). */
export function clearCodeExplorerManagerCache(): void {
  instances.forEach((mgr) => mgr.dispose());
  instances.clear();
}
