/**
 * Git-Pinned Plugin Marketplace
 *
 * Manages plugins pinned to specific Git commit SHAs for reproducible
 * and auditable plugin installations.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

export interface GitPinnedPlugin {
  name: string;
  repo: string;
  commitSha: string;
  installedAt: number;
  verified: boolean;
  commands?: string[];
  hooks?: unknown[];
  mcpServers?: string[];
}

// ============================================================================
// GitPinnedMarketplace
// ============================================================================

let instance: GitPinnedMarketplace | null = null;

export class GitPinnedMarketplace {
  private plugins: Map<string, GitPinnedPlugin> = new Map();
  private configPath: string;

  constructor(configDir?: string) {
    const dir = configDir || path.join(os.homedir(), '.codebuddy', 'plugins', 'git-pinned');
    this.configPath = path.join(dir, 'plugins.json');
    this.loadFromDisk();
  }

  static getInstance(configDir?: string): GitPinnedMarketplace {
    if (!instance) {
      instance = new GitPinnedMarketplace(configDir);
    }
    return instance;
  }

  static resetInstance(): void {
    instance = null;
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = readJsonAtomicSync<unknown>(this.configPath, []);
        if (Array.isArray(data)) {
          for (const plugin of data) {
            this.plugins.set(plugin.name, plugin);
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to load git-pinned plugins', { error: err });
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      writeJsonAtomicSync(this.configPath, Array.from(this.plugins.values()));
    } catch (err) {
      logger.warn('Failed to save git-pinned plugins', { error: err });
    }
  }

  /**
   * Parse repo spec like "org/repo" or "org/repo@sha"
   */
  private parseRepoSpec(repoSpec: string): { org: string; repo: string; sha?: string } {
    const atIndex = repoSpec.indexOf('@');
    let repoPath: string;
    let sha: string | undefined;

    if (atIndex !== -1) {
      repoPath = repoSpec.substring(0, atIndex);
      sha = repoSpec.substring(atIndex + 1);
    } else {
      repoPath = repoSpec;
    }

    const parts = repoPath.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid repo spec: ${repoSpec}. Expected format: org/repo or org/repo@sha`);
    }

    return { org: parts[0], repo: parts[1], sha };
  }

  install(repoSpec: string): GitPinnedPlugin {
    const { org, repo, sha } = this.parseRepoSpec(repoSpec);
    const name = `${org}/${repo}`;
    const commitSha = sha || 'HEAD';

    const plugin: GitPinnedPlugin = {
      name,
      repo: `https://github.com/${name}`,
      commitSha,
      installedAt: Date.now(),
      verified: false,
      commands: [],
      hooks: [],
      mcpServers: [],
    };

    this.plugins.set(name, plugin);
    this.saveToDisk();
    logger.info(`Installed git-pinned plugin: ${name}@${commitSha}`);
    return plugin;
  }

  uninstall(name: string): boolean {
    const existed = this.plugins.delete(name);
    if (existed) {
      this.saveToDisk();
      logger.info(`Uninstalled git-pinned plugin: ${name}`);
    }
    return existed;
  }

  list(): GitPinnedPlugin[] {
    return Array.from(this.plugins.values());
  }

  verify(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }
    // In a real implementation, we would check the remote SHA
    // For now, mark as verified if SHA is not HEAD
    const isVerified = plugin.commitSha !== 'HEAD';
    plugin.verified = isVerified;
    this.saveToDisk();
    return isVerified;
  }

  update(name: string): GitPinnedPlugin | null {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return null;
    }
    // Simulate updating to a new SHA
    plugin.commitSha = `updated-${Date.now().toString(16)}`;
    plugin.verified = false;
    plugin.installedAt = Date.now();
    this.saveToDisk();
    logger.info(`Updated git-pinned plugin: ${name}`);
    return plugin;
  }

  getPlugin(name: string): GitPinnedPlugin | undefined {
    return this.plugins.get(name);
  }

  getTrustWarning(repo: string): string {
    return `WARNING: Plugin from '${repo}' is not verified. ` +
      'Unverified plugins may contain malicious code. ' +
      'Review the source code and pin to a specific commit SHA before using.';
  }

  isInstalled(name: string): boolean {
    return this.plugins.has(name);
  }
}

export function getGitPinnedMarketplace(configDir?: string): GitPinnedMarketplace {
  return GitPinnedMarketplace.getInstance(configDir);
}

export function resetGitPinnedMarketplace(): void {
  GitPinnedMarketplace.resetInstance();
}
