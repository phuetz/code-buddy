/**
 * PR Session Linker
 *
 * Links CLI sessions to pull requests for context-aware assistance.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

export interface PRInfo {
  number: number;
  repo: string;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  url: string;
  branch: string;
}

export type ReviewStatus = 'approved' | 'changes_requested' | 'pending' | 'draft' | null;

// ============================================================================
// PRSessionLinker
// ============================================================================

export class PRSessionLinker {
  private currentPR: PRInfo | null = null;
  private reviewStatus: ReviewStatus = null;

  /**
   * Link session to a PR by number or URL
   */
  async linkToPR(prIdentifier: string): Promise<PRInfo> {
    const parsed = this.parsePRIdentifier(prIdentifier);
    const repo = parsed.repo || await this.resolveRepository();
    const fetched = repo ? await this.fetchPullRequest(repo, parsed.number) : null;

    this.currentPR = fetched || this.buildFallbackPR(parsed.number, repo);
    this.reviewStatus = fetched ? await this.resolveReviewStatus(this.currentPR) : 'pending';
    logger.debug(`Linked to PR #${this.currentPR.number}`);
    return this.currentPR;
  }

  /**
   * Get currently linked PR info
   */
  getCurrentPR(): PRInfo | null {
    return this.currentPR;
  }

  /**
   * Get review status of linked PR
   */
  getReviewStatus(): ReviewStatus {
    if (!this.currentPR) return null;
    return this.reviewStatus;
  }

  /**
   * Remove the PR link
   */
  unlinkPR(): void {
    this.currentPR = null;
    this.reviewStatus = null;
    logger.debug('Unlinked PR');
  }

  /**
   * Format a footer string showing PR status for prompt injection
   */
  formatPRFooter(): string {
    if (!this.currentPR) {
      return '';
    }

    const statusIcon = {
      approved: 'approved',
      changes_requested: 'changes requested',
      pending: 'pending review',
      draft: 'draft',
    };

    const statusText = this.reviewStatus
      ? statusIcon[this.reviewStatus] || this.reviewStatus
      : 'unknown';

    return `[PR #${this.currentPR.number}: ${this.currentPR.title} | Status: ${statusText} | ${this.currentPR.url}]`;
  }

  /**
   * Attempt to auto-detect PR from branch name
   */
  async autoLinkFromBranch(branch: string): Promise<PRInfo | null> {
    logger.debug(`Attempting auto-link from branch: ${branch}`);

    const prMatch = branch.match(/pr[/-](\d+)/i);
    if (prMatch) {
      return this.linkToPR(prMatch[1]);
    }

    const repo = await this.resolveRepository();
    if (repo) {
      const fromBranch = await this.fetchPullRequestByBranch(repo, branch);
      if (fromBranch) {
        this.currentPR = fromBranch;
        this.reviewStatus = await this.resolveReviewStatus(fromBranch);
        return fromBranch;
      }
    }

    return null;
  }

  private parsePRIdentifier(prIdentifier: string): { number: number; repo?: string } {
    const urlMatch = prIdentifier.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (urlMatch) {
      return {
        repo: urlMatch[1],
        number: parseInt(urlMatch[2], 10),
      };
    }

    const prNumber = parseInt(prIdentifier, 10);
    if (isNaN(prNumber)) {
      throw new Error(`Invalid PR identifier: ${prIdentifier}`);
    }

    return { number: prNumber };
  }

  private async resolveRepository(): Promise<string | null> {
    const envRepo = process.env.GITHUB_REPOSITORY?.trim();
    if (envRepo) {
      return envRepo;
    }

    try {
      const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], {
        timeout: 2000,
      });
      return this.parseGitHubRepoFromRemote(stdout.trim());
    } catch {
      return null;
    }
  }

  private parseGitHubRepoFromRemote(remote: string): string | null {
    if (!remote) {
      return null;
    }

    const httpsMatch = remote.match(/github\.com[:/](.+?)(?:\.git)?$/i);
    if (httpsMatch) {
      return httpsMatch[1];
    }

    return null;
  }

  private async fetchPullRequest(repo: string, prNumber: number): Promise<PRInfo | null> {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'code-buddy',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
        headers,
      });
      if (!response.ok) {
        return null;
      }

      const data = await response.json() as {
        number: number;
        title: string;
        body?: string | null;
        state: string;
        draft?: boolean;
        html_url: string;
        head?: { ref?: string };
      };

      return {
        number: data.number,
        repo,
        title: data.title,
        body: data.body || '',
        state: data.state,
        draft: Boolean(data.draft),
        url: data.html_url,
        branch: data.head?.ref || `pr-${prNumber}`,
      };
    } catch {
      return null;
    }
  }

  private async fetchPullRequestByBranch(repo: string, branch: string): Promise<PRInfo | null> {
    const [owner] = repo.split('/');
    if (!owner) {
      return null;
    }

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'code-buddy',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=1`,
        { headers }
      );
      if (!response.ok) {
        return null;
      }

      const data = await response.json() as Array<{
        number: number;
        title: string;
        body?: string | null;
        state: string;
        draft?: boolean;
        html_url: string;
        head?: { ref?: string };
      }>;

      const first = data[0];
      if (!first) {
        return null;
      }

      return {
        number: first.number,
        repo,
        title: first.title,
        body: first.body || '',
        state: first.state,
        draft: Boolean(first.draft),
        url: first.html_url,
        branch: first.head?.ref || branch,
      };
    } catch {
      return null;
    }
  }

  private async resolveReviewStatus(pr: PRInfo): Promise<ReviewStatus> {
    if (pr.draft) {
      return 'draft';
    }
    if (pr.repo === 'owner/repo') {
      return 'pending';
    }

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'code-buddy',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${pr.repo}/pulls/${pr.number}/reviews`, {
        headers,
      });
      if (!response.ok) {
        return 'pending';
      }

      const reviews = await response.json() as Array<{ state?: string }>;
      const states = reviews.map((review) => review.state?.toUpperCase()).filter(Boolean);
      if (states.includes('CHANGES_REQUESTED')) {
        return 'changes_requested';
      }
      if (states.includes('APPROVED')) {
        return 'approved';
      }
      return 'pending';
    } catch {
      return 'pending';
    }
  }

  private buildFallbackPR(prNumber: number, repo: string | null): PRInfo {
    const resolvedRepo = repo || 'owner/repo';
    return {
      number: prNumber,
      repo: resolvedRepo,
      title: `PR #${prNumber}`,
      body: '',
      state: 'open',
      draft: false,
      url: `https://github.com/${resolvedRepo}/pull/${prNumber}`,
      branch: `feature/pr-${prNumber}`,
    };
  }
}
