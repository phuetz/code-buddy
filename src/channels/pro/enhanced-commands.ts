/**
 * Enhanced Commands
 *
 * Rich slash commands for repo info, branch, PR, tasks, YOLO mode,
 * and context pinning. Channel-agnostic - returns structured data
 * for formatters to render.
 */

import { execSync } from 'child_process';
import type { ScopedAuthManager } from './scoped-auth.js';
import type { ContextPin, RepoInfo, BranchInfo, PRInfo, PRSummary } from './types.js';

/**
 * Handles enhanced slash commands. Returns structured data;
 * formatting is delegated to ChannelProFormatter.
 */
export class EnhancedCommands {
  private pins: Map<string, ContextPin> = new Map();
  private yoloTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private authManager?: ScopedAuthManager) {}

  /**
   * Handle /repo command - returns structured data
   */
  handleRepo(
    _chatId: string,
    _repoName?: string
  ): { success: true; data: RepoInfo } | { success: false; error: string } {
    try {
      const cwd = process.cwd();

      const remote = this.execGit('git remote get-url origin', cwd);
      const branch = this.execGit('git branch --show-current', cwd);
      const commitCount = this.execGit('git rev-list --count HEAD', cwd);
      const lastCommit = this.execGit('git log -1 --format="%h %s"', cwd);
      const recentCommits = this.execGit('git log -5 --format="%h %s (%ar)"', cwd);

      let openPRs: string | undefined;
      try {
        const prCount = this.execGit('gh pr list --state open --json number | wc -l', cwd);
        if (prCount) {
          openPRs = prCount.trim();
        }
      } catch {
        // gh not available
      }

      return {
        success: true,
        data: { remote, branch, commitCount, lastCommit, recentCommits, openPRs },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get repo info: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Handle /branch command - returns structured data
   */
  handleBranch(
    _chatId: string,
    branchName?: string
  ): { success: true; data: BranchInfo } | { success: false; error: string } {
    try {
      const cwd = process.cwd();
      const branch = branchName || this.execGit('git branch --show-current', cwd);
      const mainBranch = this.getMainBranch(cwd);

      let diffStat: string | undefined;
      let commitsAhead = '0';
      let commitsBehind = '0';

      try {
        diffStat = this.execGit(`git diff ${mainBranch}...${branch} --stat`, cwd);
        commitsBehind = this.execGit(`git rev-list --count ${branch}..${mainBranch}`, cwd).trim();
        commitsAhead = this.execGit(`git rev-list --count ${mainBranch}..${branch}`, cwd).trim();
      } catch {
        // Could not compare with main branch
      }

      return {
        success: true,
        data: { branch, mainBranch, diffStat, commitsAhead, commitsBehind },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get branch info: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Handle /pr command - returns structured data
   */
  handlePR(
    _chatId: string,
    prNumber?: string
  ): { success: true; data: PRInfo } | { success: true; list: PRSummary[] } | { success: false; error: string } {
    try {
      const cwd = process.cwd();

      if (prNumber) {
        const prJson = this.execGit(
          `gh pr view ${prNumber} --json title,state,author,body,url,additions,deletions,changedFiles`,
          cwd
        );
        const pr = JSON.parse(prJson);

        return {
          success: true,
          data: {
            number: prNumber,
            title: pr.title,
            state: pr.state,
            author: pr.author?.login || 'unknown',
            additions: pr.additions,
            deletions: pr.deletions,
            changedFiles: pr.changedFiles,
            body: pr.body || '(no description)',
            url: pr.url,
          },
        };
      }

      const prsJson = this.execGit(
        'gh pr list --state open --json number,title,author --limit 10',
        cwd
      );
      const prs = JSON.parse(prsJson);

      return {
        success: true,
        list: prs.map((pr: { number: number; title: string; author?: { login?: string } }) => ({
          number: pr.number,
          title: pr.title,
          author: pr.author?.login || 'unknown',
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get PR info: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Handle /task command - create an agent task
   */
  handleTask(
    _chatId: string,
    _userId: string,
    description: string
  ): { text: string; objective: string } {
    return {
      text: `Task created: ${description}`,
      objective: description,
    };
  }

  /**
   * Handle /yolo command - timed full access
   */
  handleYolo(
    _chatId: string,
    userId: string,
    minutesStr?: string
  ): { text: string } {
    if (!this.authManager) {
      return { text: 'Auth manager not configured.' };
    }

    const minutes = parseInt(minutesStr || '10', 10);
    if (isNaN(minutes) || minutes < 1 || minutes > 60) {
      return { text: 'YOLO duration must be 1-60 minutes.' };
    }

    const durationMs = minutes * 60 * 1000;

    const existingTimer = this.yoloTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.authManager.grantTemporaryFullAccess(userId, durationMs, userId);

    const timer = setTimeout(() => {
      this.authManager?.revokeTemporaryAccess(userId);
      this.yoloTimers.delete(userId);
    }, durationMs);

    this.yoloTimers.set(userId, timer);

    return {
      text: `YOLO mode activated for ${minutes} minutes. Full access granted. Auto-revokes at ${new Date(Date.now() + durationMs).toLocaleTimeString()}.`,
    };
  }

  /**
   * Pin context for future reference
   */
  handlePinContext(
    chatId: string,
    userId: string,
    content: string,
    tags?: string[]
  ): ContextPin {
    const pin: ContextPin = {
      id: `pin_${Date.now().toString(36)}`,
      content,
      pinnedBy: userId,
      chatId,
      timestamp: Date.now(),
      tags: tags || [],
    };

    this.pins.set(pin.id, pin);
    return pin;
  }

  /**
   * Get pins for a chat
   */
  getPins(chatId: string): ContextPin[] {
    return Array.from(this.pins.values())
      .filter((p) => p.chatId === chatId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Remove a pin
   */
  removePin(pinId: string): boolean {
    return this.pins.delete(pinId);
  }

  /**
   * Clean up timers
   */
  destroy(): void {
    for (const timer of this.yoloTimers.values()) {
      clearTimeout(timer);
    }
    this.yoloTimers.clear();
  }

  private execGit(cmd: string, cwd: string): string {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  }

  private getMainBranch(cwd: string): string {
    try {
      this.execGit('git rev-parse --verify main', cwd);
      return 'main';
    } catch {
      try {
        this.execGit('git rev-parse --verify master', cwd);
        return 'master';
      } catch {
        return 'main';
      }
    }
  }
}
