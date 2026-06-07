/**
 * Trust Folder Manager
 *
 * Manages a set of trusted directories. Tools that modify files or execute
 * commands are restricted to trusted directories only when trust enforcement
 * is enabled. Certain dangerous directories are always blocked.
 *
 * @module security
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

const CONFIG_DIR = path.join(os.homedir(), '.codebuddy');
const TRUST_FILE = path.join(CONFIG_DIR, 'trusted-folders.json');

/**
 * The agent's own managed skills directory (`~/.codebuddy/skills`).
 *
 * This holds SKILL.md definitions and their helper scripts that the agent
 * legitimately needs to read in order to follow its own skill instructions.
 * It is intentionally NOT the whole `~/.codebuddy` config dir — that dir also
 * stores credentials (`codex-auth.json`, `credentials.enc`, `fleet.env`,
 * `auth/`, …), so a read-allow must stay scoped to `skills/` only and must
 * never grant write access.
 */
const SKILLS_READ_DIR = path.join(CONFIG_DIR, 'skills');

/**
 * Directories that can never be trusted (too dangerous).
 */
const ALWAYS_BLOCKED: string[] = [
  '/',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/tmp',
  '/root',
  os.homedir(),
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.aws'),
];

export class TrustFolderManager {
  private trustedFolders: Set<string> = new Set();
  private enforcementEnabled: boolean = true;
  private readonly isTestMode: boolean = process.env.NODE_ENV === 'test';

  constructor() {
    if (this.isTestMode) {
      // Keep tests hermetic: avoid mutating user config and disable enforcement by default.
      this.enforcementEnabled = false;
      return;
    }
    this.load();
  }

  /**
   * Check if a given path is within a trusted directory.
   */
  isTrusted(targetPath: string): boolean {
    if (!this.enforcementEnabled) return true;

    let resolved: string;
    try {
      resolved = fs.realpathSync(targetPath);
    } catch {
      resolved = path.resolve(targetPath);
    }

    // Check if the path is within any trusted folder
    for (const trusted of this.trustedFolders) {
      if (resolved === trusted || resolved.startsWith(trusted + path.sep)) {
        return true;
      }
    }

    // Also trust current working directory by default
    const cwd = process.cwd();
    if (resolved === cwd || resolved.startsWith(cwd + path.sep)) {
      return true;
    }

    return false;
  }

  /**
   * Check whether a path is inside the agent's own managed skills directory
   * (`~/.codebuddy/skills`).
   *
   * This is a READ-ONLY scoping helper, kept deliberately narrow: it is meant
   * to let read-only file tools (e.g. `view_file`) read the agent's own
   * SKILL.md files and helper scripts without a trust prompt, even when
   * enforcement is on and the skills dir is outside the workspace cwd.
   *
   * It does NOT add the directory to the trusted set and does NOT cover the
   * rest of `~/.codebuddy` (which holds credentials). Callers MUST additionally
   * confirm the invoking tool is read-only before honoring this — see the gate
   * in `tool-handler.ts`. Returning true here never authorizes a write.
   */
  isReadableSkillsPath(targetPath: string): boolean {
    let resolved: string;
    try {
      resolved = fs.realpathSync(targetPath);
    } catch {
      resolved = path.resolve(targetPath);
    }
    const skillsRoot = (() => {
      try {
        return fs.realpathSync(SKILLS_READ_DIR);
      } catch {
        return path.resolve(SKILLS_READ_DIR);
      }
    })();
    return resolved === skillsRoot || resolved.startsWith(skillsRoot + path.sep);
  }

  /**
   * Check if a directory is in the always-blocked list.
   */
  isBlocked(dirPath: string): boolean {
    const resolved = path.resolve(dirPath);
    return ALWAYS_BLOCKED.some(blocked => resolved === path.resolve(blocked));
  }

  /**
   * Add a directory to the trusted list.
   * Returns false if the directory is always-blocked.
   */
  trustFolder(dirPath: string): boolean {
    const resolved = path.resolve(dirPath);

    if (this.isBlocked(resolved)) {
      logger.warn(`Cannot trust blocked directory: ${resolved}`);
      return false;
    }

    this.trustedFolders.add(resolved);
    this.save();
    return true;
  }

  /**
   * Remove a directory from the trusted list.
   */
  untrustFolder(dirPath: string): boolean {
    const resolved = path.resolve(dirPath);
    const removed = this.trustedFolders.delete(resolved);
    if (removed) this.save();
    return removed;
  }

  /**
   * Get list of all trusted folders.
   */
  getTrustedFolders(): string[] {
    return [...this.trustedFolders];
  }

  /**
   * Enable or disable trust enforcement.
   */
  setEnforcement(enabled: boolean): void {
    this.enforcementEnabled = enabled;
  }

  /**
   * Check if enforcement is enabled.
   */
  isEnforcementEnabled(): boolean {
    return this.enforcementEnabled;
  }

  private load(): void {
    if (this.isTestMode) {
      return;
    }
    try {
      if (fs.existsSync(TRUST_FILE)) {
        const data = JSON.parse(fs.readFileSync(TRUST_FILE, 'utf-8'));
        if (Array.isArray(data.folders)) {
          for (const folder of data.folders) {
            if (typeof folder === 'string' && !this.isBlocked(folder)) {
              this.trustedFolders.add(path.resolve(folder));
            }
          }
        }
        if (typeof data.enforcement === 'boolean') {
          this.enforcementEnabled = data.enforcement;
        }
      }
    } catch (error) {
      logger.debug('Failed to load trusted folders', { error });
    }
  }

  private save(): void {
    if (this.isTestMode) {
      return;
    }
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(TRUST_FILE, JSON.stringify({
        folders: [...this.trustedFolders],
        enforcement: this.enforcementEnabled,
      }, null, 2));
    } catch (error) {
      logger.debug('Failed to save trusted folders', { error });
    }
  }
}

// Singleton
let trustFolderInstance: TrustFolderManager | null = null;

export function getTrustFolderManager(): TrustFolderManager {
  if (!trustFolderInstance) {
    trustFolderInstance = new TrustFolderManager();
  }
  return trustFolderInstance;
}

export function resetTrustFolderManager(): void {
  trustFolderInstance = null;
}
