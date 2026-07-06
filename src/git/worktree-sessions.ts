/**
 * Worktree Multi-Session Manager
 *
 * Links git worktrees to Code Buddy sessions for parallel branch work.
 * Singleton pattern for global coordination.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface WorktreeSession {
  branch: string;
  worktreePath: string;
  sessionId: string;
  createdAt: number;
}

// ============================================================================
// WorktreeSessionManager
// ============================================================================

export class WorktreeSessionManager {
  private static instance: WorktreeSessionManager | null = null;
  private sessions: Map<string, WorktreeSession> = new Map();

  constructor() {
    logger.debug('WorktreeSessionManager initialized');
  }

  static getInstance(): WorktreeSessionManager {
    if (!WorktreeSessionManager.instance) {
      WorktreeSessionManager.instance = new WorktreeSessionManager();
    }
    return WorktreeSessionManager.instance;
  }

  static resetInstance(): void {
    WorktreeSessionManager.instance = null;
  }

  createWorktreeSession(branch: string, basePath: string): WorktreeSession {
    const worktreePath = path.join(basePath, '.worktrees', branch);

    // Create the worktree directory
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    try {
      execSync(`git worktree add "${worktreePath}" "${branch}"`, {
        cwd: basePath,
        stdio: 'pipe',
      });
    } catch (_err) {
      // If worktree already exists or branch doesn't exist, create with -b
      try {
        execSync(`git worktree add -b "${branch}" "${worktreePath}"`, {
          cwd: basePath,
          stdio: 'pipe',
        });
      } catch (innerErr) {
        logger.warn(`Failed to create worktree for ${branch}`);
        throw innerErr;
      }
    }

    const session: WorktreeSession = {
      branch,
      worktreePath,
      sessionId: `wt-${branch}-${Date.now()}`,
      createdAt: Date.now(),
    };

    this.sessions.set(branch, session);
    logger.info(`Worktree session created: ${branch} at ${worktreePath}`);
    return session;
  }

  listWorktreeSessions(): WorktreeSession[] {
    return Array.from(this.sessions.values());
  }

  getSessionForWorktree(worktreePath: string): WorktreeSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.worktreePath === worktreePath) {
        return session;
      }
    }
    return undefined;
  }

  cleanupWorktree(branch: string): boolean {
    const session = this.sessions.get(branch);
    if (!session) return false;

    try {
      execSync(`git worktree remove "${session.worktreePath}" --force`, {
        stdio: 'pipe',
      });
    } catch {
      logger.warn(`Failed to remove worktree for ${branch}`);
    }

    this.sessions.delete(branch);
    logger.info(`Worktree session cleaned up: ${branch}`);
    return true;
  }

  isWorktreeActive(branch: string): boolean {
    return this.sessions.has(branch);
  }
}
