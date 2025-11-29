/**
 * Advanced GitHub/GitLab Integration
 *
 * Provides comprehensive integration with GitHub and GitLab:
 * - PR creation and review
 * - Issue management
 * - Automated reviews via webhooks
 * - CI/CD integration
 */

import { EventEmitter } from 'events';
import { BashTool } from '../tools/bash.js';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface GitProvider {
  type: 'github' | 'gitlab';
  host: string;
  apiUrl: string;
  token?: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  labels: string[];
  reviewers: string[];
  isDraft: boolean;
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  author: string;
  labels: string[];
  assignees: string[];
  url: string;
  createdAt: Date;
}

export interface ReviewComment {
  id: number;
  body: string;
  path?: string;
  line?: number;
  author: string;
  createdAt: Date;
}

export interface PRReviewResult {
  approved: boolean;
  comments: ReviewComment[];
  summary: string;
  suggestedChanges: Array<{
    file: string;
    line: number;
    suggestion: string;
  }>;
}

export interface GitHubConfig {
  provider: GitProvider;
  defaultBranch: string;
  prTemplate?: string;
  issueTemplate?: string;
  autoLabels: boolean;
  requireReview: boolean;
}

const DEFAULT_CONFIG: GitHubConfig = {
  provider: {
    type: 'github',
    host: 'github.com',
    apiUrl: 'https://api.github.com',
  },
  defaultBranch: 'main',
  autoLabels: true,
  requireReview: true,
};

/**
 * GitHub/GitLab Integration Manager
 */
export class GitHubIntegration extends EventEmitter {
  private config: GitHubConfig;
  private bash: BashTool;
  private repoInfo: { owner: string; repo: string } | null = null;

  constructor(config: Partial<GitHubConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bash = new BashTool();
  }

  /**
   * Initialize and detect repository
   */
  async initialize(): Promise<boolean> {
    try {
      // Get remote URL
      const result = await this.bash.execute('git remote get-url origin');
      if (!result.success || !result.output) {
        return false;
      }

      // Parse remote URL
      const remoteUrl = result.output.trim();
      const parsed = this.parseRemoteUrl(remoteUrl);

      if (parsed) {
        this.repoInfo = parsed;
        this.detectProvider(remoteUrl);
        this.emit('initialized', { repo: this.repoInfo, provider: this.config.provider });
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Parse git remote URL
   */
  private parseRemoteUrl(url: string): { owner: string; repo: string } | null {
    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    // SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    return null;
  }

  /**
   * Detect provider from URL
   */
  private detectProvider(url: string): void {
    if (url.includes('gitlab')) {
      this.config.provider = {
        type: 'gitlab',
        host: 'gitlab.com',
        apiUrl: 'https://gitlab.com/api/v4',
      };
    } else if (url.includes('github')) {
      this.config.provider = {
        type: 'github',
        host: 'github.com',
        apiUrl: 'https://api.github.com',
      };
    }
  }

  /**
   * Create a Pull Request
   */
  async createPullRequest(options: {
    title: string;
    body: string;
    sourceBranch?: string;
    targetBranch?: string;
    draft?: boolean;
    labels?: string[];
    reviewers?: string[];
  }): Promise<PullRequest | null> {
    if (!this.repoInfo) {
      await this.initialize();
    }

    const {
      title,
      body,
      sourceBranch,
      targetBranch = this.config.defaultBranch,
      draft = false,
      labels = [],
      reviewers = [],
    } = options;

    // Get current branch if not specified
    let branch = sourceBranch;
    if (!branch) {
      const branchResult = await this.bash.execute('git branch --show-current');
      branch = branchResult.output?.trim() || 'main';
    }

    // Ensure branch is pushed
    await this.bash.execute(`git push -u origin ${branch}`);

    if (this.config.provider.type === 'github') {
      return this.createGitHubPR({
        title,
        body,
        head: branch,
        base: targetBranch,
        draft,
        labels,
        reviewers,
      });
    } else {
      return this.createGitLabMR({
        title,
        description: body,
        sourceBranch: branch,
        targetBranch,
        draft,
        labels,
        reviewers,
      });
    }
  }

  /**
   * Create GitHub PR using gh CLI
   */
  private async createGitHubPR(options: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
    labels: string[];
    reviewers: string[];
  }): Promise<PullRequest | null> {
    const { title, body, head, base, draft, labels, reviewers } = options;

    // Build gh command
    let cmd = `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --head "${head}" --base "${base}"`;

    if (draft) {
      cmd += ' --draft';
    }

    if (labels.length > 0) {
      cmd += ` --label "${labels.join(',')}"`;
    }

    if (reviewers.length > 0) {
      cmd += ` --reviewer "${reviewers.join(',')}"`;
    }

    const result = await this.bash.execute(cmd);

    if (result.success && result.output) {
      // Parse PR URL from output
      const urlMatch = result.output.match(/https:\/\/github\.com\/[^\s]+/);
      const prUrl = urlMatch ? urlMatch[0] : '';
      const prNumber = parseInt(prUrl.split('/').pop() || '0', 10);

      return {
        id: prNumber,
        number: prNumber,
        title,
        body,
        state: 'open',
        author: '', // Would need to fetch
        sourceBranch: head,
        targetBranch: base,
        url: prUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
        labels,
        reviewers,
        isDraft: draft,
      };
    }

    this.emit('error', { operation: 'createPR', error: result.error });
    return null;
  }

  /**
   * Create GitLab MR using glab CLI
   */
  private async createGitLabMR(options: {
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    draft: boolean;
    labels: string[];
    reviewers: string[];
  }): Promise<PullRequest | null> {
    const { title, description, sourceBranch, targetBranch, draft, labels } = options;

    let cmd = `glab mr create --title "${title.replace(/"/g, '\\"')}" --description "${description.replace(/"/g, '\\"')}" --source-branch "${sourceBranch}" --target-branch "${targetBranch}"`;

    if (draft) {
      cmd += ' --draft';
    }

    if (labels.length > 0) {
      cmd += ` --label "${labels.join(',')}"`;
    }

    const result = await this.bash.execute(cmd);

    if (result.success && result.output) {
      const urlMatch = result.output.match(/https:\/\/gitlab[^\s]+/);
      const mrUrl = urlMatch ? urlMatch[0] : '';
      const mrNumber = parseInt(mrUrl.split('/').pop() || '0', 10);

      return {
        id: mrNumber,
        number: mrNumber,
        title,
        body: description,
        state: 'open',
        author: '',
        sourceBranch,
        targetBranch,
        url: mrUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
        labels,
        reviewers: [],
        isDraft: draft,
      };
    }

    return null;
  }

  /**
   * Get PR/MR diff
   */
  async getPRDiff(prNumber: number): Promise<string | null> {
    if (this.config.provider.type === 'github') {
      const result = await this.bash.execute(`gh pr diff ${prNumber}`);
      return result.success ? result.output || null : null;
    } else {
      const result = await this.bash.execute(`glab mr diff ${prNumber}`);
      return result.success ? result.output || null : null;
    }
  }

  /**
   * Get PR/MR details
   */
  async getPRDetails(prNumber: number): Promise<PullRequest | null> {
    if (this.config.provider.type === 'github') {
      const result = await this.bash.execute(`gh pr view ${prNumber} --json number,title,body,state,author,headRefName,baseRefName,url,createdAt,updatedAt,labels,reviewRequests,isDraft`);

      if (result.success && result.output) {
        try {
          const data = JSON.parse(result.output);
          return {
            id: data.number,
            number: data.number,
            title: data.title,
            body: data.body,
            state: data.state.toLowerCase(),
            author: data.author?.login || '',
            sourceBranch: data.headRefName,
            targetBranch: data.baseRefName,
            url: data.url,
            createdAt: new Date(data.createdAt),
            updatedAt: new Date(data.updatedAt),
            labels: (data.labels || []).map((l: { name: string }) => l.name),
            reviewers: (data.reviewRequests || []).map((r: { login: string }) => r.login),
            isDraft: data.isDraft,
          };
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Add comment to PR
   */
  async addPRComment(prNumber: number, body: string): Promise<boolean> {
    if (this.config.provider.type === 'github') {
      const result = await this.bash.execute(`gh pr comment ${prNumber} --body "${body.replace(/"/g, '\\"')}"`);
      return result.success;
    } else {
      const result = await this.bash.execute(`glab mr comment ${prNumber} --message "${body.replace(/"/g, '\\"')}"`);
      return result.success;
    }
  }

  /**
   * Add review to PR
   */
  async addPRReview(
    prNumber: number,
    review: {
      event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
      body: string;
    }
  ): Promise<boolean> {
    if (this.config.provider.type === 'github') {
      let cmd = `gh pr review ${prNumber} --body "${review.body.replace(/"/g, '\\"')}"`;

      switch (review.event) {
        case 'APPROVE':
          cmd += ' --approve';
          break;
        case 'REQUEST_CHANGES':
          cmd += ' --request-changes';
          break;
        default:
          cmd += ' --comment';
      }

      const result = await this.bash.execute(cmd);
      return result.success;
    }

    return false;
  }

  /**
   * List open PRs
   */
  async listOpenPRs(): Promise<PullRequest[]> {
    if (this.config.provider.type === 'github') {
      const result = await this.bash.execute('gh pr list --json number,title,author,headRefName,baseRefName,url,createdAt,labels,isDraft --limit 20');

      if (result.success && result.output) {
        try {
          const data = JSON.parse(result.output);
          return data.map((pr: {
            number: number;
            title: string;
            author?: { login: string };
            headRefName: string;
            baseRefName: string;
            url: string;
            createdAt: string;
            labels?: { name: string }[];
            isDraft: boolean;
          }) => ({
            id: pr.number,
            number: pr.number,
            title: pr.title,
            body: '',
            state: 'open' as const,
            author: pr.author?.login || '',
            sourceBranch: pr.headRefName,
            targetBranch: pr.baseRefName,
            url: pr.url,
            createdAt: new Date(pr.createdAt),
            updatedAt: new Date(pr.createdAt),
            labels: (pr.labels || []).map((l) => l.name),
            reviewers: [],
            isDraft: pr.isDraft,
          }));
        } catch {
          return [];
        }
      }
    }

    return [];
  }

  /**
   * Create an issue
   */
  async createIssue(options: {
    title: string;
    body: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue | null> {
    const { title, body, labels = [], assignees = [] } = options;

    if (this.config.provider.type === 'github') {
      let cmd = `gh issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`;

      if (labels.length > 0) {
        cmd += ` --label "${labels.join(',')}"`;
      }

      if (assignees.length > 0) {
        cmd += ` --assignee "${assignees.join(',')}"`;
      }

      const result = await this.bash.execute(cmd);

      if (result.success && result.output) {
        const urlMatch = result.output.match(/https:\/\/github\.com\/[^\s]+/);
        const issueUrl = urlMatch ? urlMatch[0] : '';
        const issueNumber = parseInt(issueUrl.split('/').pop() || '0', 10);

        return {
          id: issueNumber,
          number: issueNumber,
          title,
          body,
          state: 'open',
          author: '',
          labels,
          assignees,
          url: issueUrl,
          createdAt: new Date(),
        };
      }
    }

    return null;
  }

  /**
   * List issues
   */
  async listIssues(options: { state?: 'open' | 'closed' | 'all'; labels?: string[] } = {}): Promise<Issue[]> {
    const { state = 'open', labels = [] } = options;

    if (this.config.provider.type === 'github') {
      let cmd = `gh issue list --state ${state} --json number,title,body,state,author,labels,assignees,url,createdAt --limit 20`;

      if (labels.length > 0) {
        cmd += ` --label "${labels.join(',')}"`;
      }

      const result = await this.bash.execute(cmd);

      if (result.success && result.output) {
        try {
          const data = JSON.parse(result.output);
          return data.map((issue: {
            number: number;
            title: string;
            body: string;
            state: string;
            author?: { login: string };
            labels?: { name: string }[];
            assignees?: { login: string }[];
            url: string;
            createdAt: string;
          }) => ({
            id: issue.number,
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state.toLowerCase(),
            author: issue.author?.login || '',
            labels: (issue.labels || []).map((l) => l.name),
            assignees: (issue.assignees || []).map((a) => a.login),
            url: issue.url,
            createdAt: new Date(issue.createdAt),
          }));
        } catch {
          return [];
        }
      }
    }

    return [];
  }

  /**
   * Get CI/CD status
   */
  async getCIStatus(ref?: string): Promise<{
    state: 'success' | 'failure' | 'pending' | 'unknown';
    checks: Array<{ name: string; status: string; conclusion: string }>;
  }> {
    const targetRef = ref || 'HEAD';

    if (this.config.provider.type === 'github') {
      const result = await this.bash.execute(`gh run list --commit $(git rev-parse ${targetRef}) --json status,conclusion,name --limit 10`);

      if (result.success && result.output) {
        try {
          const runs = JSON.parse(result.output);
          const checks = runs.map((run: { name: string; status: string; conclusion: string }) => ({
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
          }));

          let state: 'success' | 'failure' | 'pending' | 'unknown' = 'unknown';
          if (checks.length > 0) {
            const hasFailure = checks.some((c: { conclusion: string }) => c.conclusion === 'failure');
            const hasPending = checks.some((c: { status: string }) => c.status === 'in_progress' || c.status === 'queued');
            const allSuccess = checks.every((c: { conclusion: string }) => c.conclusion === 'success');

            if (hasFailure) state = 'failure';
            else if (hasPending) state = 'pending';
            else if (allSuccess) state = 'success';
          }

          return { state, checks };
        } catch {
          return { state: 'unknown', checks: [] };
        }
      }
    }

    return { state: 'unknown', checks: [] };
  }

  /**
   * Generate PR description from commits
   */
  async generatePRDescription(baseBranch?: string): Promise<string> {
    const base = baseBranch || this.config.defaultBranch;

    // Get commits since base
    const commitsResult = await this.bash.execute(`git log ${base}..HEAD --pretty=format:"%s" --reverse`);
    const commits = commitsResult.output?.split('\n').filter(Boolean) || [];

    // Get diff stats
    const statsResult = await this.bash.execute(`git diff ${base}...HEAD --stat`);
    const stats = statsResult.output || '';

    // Build description
    const lines = [
      '## Summary',
      '',
      'This PR includes the following changes:',
      '',
      ...commits.map(c => `- ${c}`),
      '',
      '## Changes',
      '',
      '```',
      stats,
      '```',
      '',
      '## Test Plan',
      '',
      '- [ ] Tests pass locally',
      '- [ ] Manual testing completed',
    ];

    return lines.join('\n');
  }

  /**
   * Merge PR
   */
  async mergePR(
    prNumber: number,
    options: { method?: 'merge' | 'squash' | 'rebase'; deleteAfter?: boolean } = {}
  ): Promise<boolean> {
    const { method = 'squash', deleteAfter = true } = options;

    if (this.config.provider.type === 'github') {
      let cmd = `gh pr merge ${prNumber} --${method}`;

      if (deleteAfter) {
        cmd += ' --delete-branch';
      }

      const result = await this.bash.execute(cmd);
      return result.success;
    }

    return false;
  }

  /**
   * Format PR list for display
   */
  formatPRList(prs: PullRequest[]): string {
    if (prs.length === 0) {
      return 'No open pull requests.';
    }

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                    OPEN PULL REQUESTS                        ║',
      '╠══════════════════════════════════════════════════════════════╣',
    ];

    for (const pr of prs) {
      const draft = pr.isDraft ? '[DRAFT] ' : '';
      lines.push(`║ #${pr.number.toString().padEnd(5)} ${draft}${pr.title.slice(0, 45).padEnd(45)}║`);
      lines.push(`║   ${pr.sourceBranch} → ${pr.targetBranch}`.padEnd(65) + '║');
      if (pr.labels.length > 0) {
        lines.push(`║   Labels: ${pr.labels.join(', ').slice(0, 50)}`.padEnd(65) + '║');
      }
      lines.push('╟──────────────────────────────────────────────────────────────╢');
    }

    lines.pop(); // Remove last separator
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Get repo info
   */
  getRepoInfo(): { owner: string; repo: string } | null {
    return this.repoInfo;
  }

  /**
   * Get provider
   */
  getProvider(): GitProvider {
    return this.config.provider;
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<GitHubConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton
let githubIntegrationInstance: GitHubIntegration | null = null;

export function getGitHubIntegration(config?: Partial<GitHubConfig>): GitHubIntegration {
  if (!githubIntegrationInstance) {
    githubIntegrationInstance = new GitHubIntegration(config);
  }
  return githubIntegrationInstance;
}

export function resetGitHubIntegration(): void {
  githubIntegrationInstance = null;
}
