/**
 * Git Platform Integration
 *
 * Native integration with GitHub and GitLab:
 * - Repository management
 * - Pull/Merge request operations
 * - Issue tracking
 * - CI/CD status
 */

import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';

export interface GitPlatformConfig {
  /** Platform type */
  platform: 'github' | 'gitlab' | 'auto';
  /** API token */
  token?: string;
  /** API base URL (for enterprise/self-hosted) */
  baseUrl?: string;
  /** Default owner/organization */
  defaultOwner?: string;
  /** Default repository */
  defaultRepo?: string;
}

export interface Repository {
  id: string | number;
  name: string;
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  private: boolean;
  language?: string;
  stars: number;
  forks: number;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  description: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  labels: string[];
  reviewers: string[];
  draft: boolean;
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  description: string;
  state: 'open' | 'closed';
  author: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  labels: string[];
  assignees: string[];
  milestone?: string;
}

export interface CIStatus {
  state: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  context: string;
  description: string;
  url?: string;
  createdAt: Date;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: Date;
  url: string;
}

/**
 * Git Platform Integration
 */
export class GitPlatformIntegration extends EventEmitter {
  private config: Required<GitPlatformConfig>;
  private detectedPlatform: 'github' | 'gitlab' | null = null;
  private repoInfo: { owner: string; repo: string } | null = null;

  constructor(config: GitPlatformConfig) {
    super();
    this.config = {
      platform: config.platform || 'auto',
      token: config.token || process.env.GITHUB_TOKEN || process.env.GITLAB_TOKEN || '',
      baseUrl: config.baseUrl || '',
      defaultOwner: config.defaultOwner || '',
      defaultRepo: config.defaultRepo || '',
    };
  }

  /**
   * Initialize and detect platform
   */
  async init(): Promise<void> {
    if (this.config.platform === 'auto') {
      this.detectedPlatform = await this.detectPlatform();
    } else {
      this.detectedPlatform = this.config.platform;
    }

    this.repoInfo = await this.detectRepoInfo();

    if (!this.config.baseUrl) {
      this.config.baseUrl = this.detectedPlatform === 'github'
        ? 'https://api.github.com'
        : 'https://gitlab.com/api/v4';
    }

    this.emit('initialized', {
      platform: this.detectedPlatform,
      repo: this.repoInfo,
    });
  }

  /**
   * Detect platform from git remote
   */
  private async detectPlatform(): Promise<'github' | 'gitlab' | null> {
    try {
      const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();

      if (remoteUrl.includes('github.com') || remoteUrl.includes('github.')) {
        return 'github';
      } else if (remoteUrl.includes('gitlab.com') || remoteUrl.includes('gitlab.')) {
        return 'gitlab';
      }
    } catch {
      // Not a git repository
    }
    return null;
  }

  /**
   * Detect repository info from git remote
   */
  private async detectRepoInfo(): Promise<{ owner: string; repo: string } | null> {
    try {
      const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();

      // Parse SSH URL: git@github.com:owner/repo.git
      const sshMatch = remoteUrl.match(/@[^:]+:([^/]+)\/([^.]+)/);
      if (sshMatch) {
        return { owner: sshMatch[1], repo: sshMatch[2] };
      }

      // Parse HTTPS URL: https://github.com/owner/repo.git
      const httpsMatch = remoteUrl.match(/\/\/[^/]+\/([^/]+)\/([^.]+)/);
      if (httpsMatch) {
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
      }
    } catch {
      // Not a git repository
    }

    if (this.config.defaultOwner && this.config.defaultRepo) {
      return { owner: this.config.defaultOwner, repo: this.config.defaultRepo };
    }

    return null;
  }

  /**
   * Get repository info
   */
  async getRepository(): Promise<Repository | null> {
    if (!this.repoInfo) return null;

    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}`
      : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.apiRequest<any>('GET', endpoint);

      if (this.detectedPlatform === 'github') {
        return {
          id: data.id,
          name: data.name,
          fullName: data.full_name,
          description: data.description || '',
          url: data.html_url,
          defaultBranch: data.default_branch,
          private: data.private,
          language: data.language,
          stars: data.stargazers_count,
          forks: data.forks_count,
        };
      } else {
        return {
          id: data.id,
          name: data.name,
          fullName: data.path_with_namespace,
          description: data.description || '',
          url: data.web_url,
          defaultBranch: data.default_branch,
          private: data.visibility === 'private',
          language: data.repository_language,
          stars: data.star_count,
          forks: data.forks_count,
        };
      }
    } catch (error) {
      logger.error('Failed to get repository', { error });
      return null;
    }
  }

  /**
   * List pull/merge requests
   */
  async listPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequest[]> {
    if (!this.repoInfo) return [];

    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/pulls?state=${state}`
      : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/merge_requests?state=${state === 'all' ? 'all' : state === 'closed' ? 'merged' : 'opened'}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.apiRequest<any[]>('GET', endpoint);

      return data.map((pr: Record<string, unknown>) => this.parsePullRequest(pr));
    } catch (error) {
      logger.error('Failed to list pull requests', { error });
      return [];
    }
  }

  /**
   * Get pull/merge request details
   */
  async getPullRequest(number: number): Promise<PullRequest | null> {
    if (!this.repoInfo) return null;

    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/pulls/${number}`
      : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/merge_requests/${number}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.apiRequest<any>('GET', endpoint);
      return this.parsePullRequest(data);
    } catch (error) {
      logger.error('Failed to get pull request', { error });
      return null;
    }
  }

  /**
   * Create pull/merge request
   */
  async createPullRequest(options: {
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    draft?: boolean;
  }): Promise<PullRequest | null> {
    if (!this.repoInfo) return null;

    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/pulls`
      : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/merge_requests`;

    const body = this.detectedPlatform === 'github'
      ? {
          title: options.title,
          body: options.description,
          head: options.sourceBranch,
          base: options.targetBranch,
          draft: options.draft || false,
        }
      : {
          title: options.title,
          description: options.description,
          source_branch: options.sourceBranch,
          target_branch: options.targetBranch,
        };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.apiRequest<any>('POST', endpoint, body);
      return this.parsePullRequest(data);
    } catch (error) {
      logger.error('Failed to create pull request', { error });
      return null;
    }
  }

  /**
   * List issues
   */
  async listIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> {
    if (!this.repoInfo) return [];

    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/issues?state=${state}`
      : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/issues?state=${state === 'all' ? '' : state === 'closed' ? 'closed' : 'opened'}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.apiRequest<any[]>('GET', endpoint);

      return data
        .filter((issue: Record<string, unknown>) => !issue.pull_request) // GitHub includes PRs in issues
        .map((issue: Record<string, unknown>) => this.parseIssue(issue));
    } catch (error) {
      logger.error('Failed to list issues', { error });
      return [];
    }
  }

  /**
   * Create issue
   */
  async createIssue(options: {
    title: string;
    description: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<Issue | null> {
    if (!this.repoInfo) return null;

    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/issues`
      : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/issues`;

    const body = this.detectedPlatform === 'github'
      ? {
          title: options.title,
          body: options.description,
          labels: options.labels,
          assignees: options.assignees,
        }
      : {
          title: options.title,
          description: options.description,
          labels: options.labels?.join(','),
          assignee_ids: options.assignees,
        };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.apiRequest<any>('POST', endpoint, body);
      return this.parseIssue(data);
    } catch (error) {
      logger.error('Failed to create issue', { error });
      return null;
    }
  }

  /**
   * Get CI status for a commit
   */
  async getCIStatus(sha: string): Promise<CIStatus[]> {
    if (!this.repoInfo) return [];

    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/commits/${sha}/status`
      : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/pipelines?sha=${sha}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.apiRequest<any>('GET', endpoint);

      if (this.detectedPlatform === 'github') {
        return (data.statuses || []).map((status: Record<string, unknown>) => ({
          state: this.mapState(status.state as string),
          context: status.context as string,
          description: status.description as string || '',
          url: status.target_url as string,
          createdAt: new Date(status.created_at as string),
        }));
      } else {
        return data.map((pipeline: Record<string, unknown>) => ({
          state: this.mapState(pipeline.status as string),
          context: `Pipeline #${pipeline.id}`,
          description: pipeline.ref as string || '',
          url: pipeline.web_url as string,
          createdAt: new Date(pipeline.created_at as string),
        }));
      }
    } catch (error) {
      logger.error('Failed to get CI status', { error });
      return [];
    }
  }

  /**
   * Get recent commits
   */
  async getCommits(branch?: string, limit: number = 10): Promise<CommitInfo[]> {
    if (!this.repoInfo) return [];

    const branchParam = branch ? `sha=${branch}` : '';
    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/commits?${branchParam}&per_page=${limit}`
      : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/repository/commits?ref_name=${branch || ''}&per_page=${limit}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this.apiRequest<any[]>('GET', endpoint);

      return data.map((commit: Record<string, unknown>) => {
        if (this.detectedPlatform === 'github') {
          const c = commit.commit as Record<string, unknown>;
          const author = c.author as Record<string, unknown>;
          return {
            sha: commit.sha as string,
            message: c.message as string,
            author: author.name as string,
            date: new Date(author.date as string),
            url: commit.html_url as string,
          };
        } else {
          return {
            sha: commit.id as string,
            message: commit.message as string,
            author: commit.author_name as string,
            date: new Date(commit.created_at as string),
            url: commit.web_url as string,
          };
        }
      });
    } catch (error) {
      logger.error('Failed to get commits', { error });
      return [];
    }
  }

  /**
   * Add comment to issue or PR
   */
  async addComment(number: number, body: string, isPullRequest: boolean = false): Promise<boolean> {
    if (!this.repoInfo) return false;

    const endpoint = this.detectedPlatform === 'github'
      ? `/repos/${this.repoInfo.owner}/${this.repoInfo.repo}/issues/${number}/comments`
      : isPullRequest
        ? `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/merge_requests/${number}/notes`
        : `/projects/${encodeURIComponent(`${this.repoInfo.owner}/${this.repoInfo.repo}`)}/issues/${number}/notes`;

    try {
      await this.apiRequest('POST', endpoint, { body });
      return true;
    } catch (error) {
      logger.error('Failed to add comment', { error });
      return false;
    }
  }

  /**
   * Make API request
   */
  private async apiRequest<T = unknown>(
    method: string,
    endpoint: string,
    body?: object
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (this.config.token) {
      if (this.detectedPlatform === 'github') {
        headers['Authorization'] = `Bearer ${this.config.token}`;
      } else {
        headers['PRIVATE-TOKEN'] = this.config.token;
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as T;
  }

  /**
   * Parse pull request response
   */
  private parsePullRequest(data: Record<string, unknown>): PullRequest {
    if (this.detectedPlatform === 'github') {
      return {
        id: data.id as number,
        number: data.number as number,
        title: data.title as string,
        description: (data.body as string) || '',
        state: data.merged ? 'merged' : (data.state as 'open' | 'closed'),
        author: (data.user as Record<string, unknown>).login as string,
        sourceBranch: (data.head as Record<string, unknown>).ref as string,
        targetBranch: (data.base as Record<string, unknown>).ref as string,
        url: data.html_url as string,
        createdAt: new Date(data.created_at as string),
        updatedAt: new Date(data.updated_at as string),
        labels: ((data.labels as Array<Record<string, unknown>>) || []).map(l => l.name as string),
        reviewers: ((data.requested_reviewers as Array<Record<string, unknown>>) || []).map(r => r.login as string),
        draft: data.draft as boolean || false,
      };
    } else {
      return {
        id: data.id as number,
        number: data.iid as number,
        title: data.title as string,
        description: (data.description as string) || '',
        state: data.state === 'merged' ? 'merged' : data.state === 'closed' ? 'closed' : 'open',
        author: (data.author as Record<string, unknown>).username as string,
        sourceBranch: data.source_branch as string,
        targetBranch: data.target_branch as string,
        url: data.web_url as string,
        createdAt: new Date(data.created_at as string),
        updatedAt: new Date(data.updated_at as string),
        labels: (data.labels as string[]) || [],
        reviewers: ((data.reviewers as Array<Record<string, unknown>>) || []).map(r => r.username as string),
        draft: data.draft as boolean || false,
      };
    }
  }

  /**
   * Parse issue response
   */
  private parseIssue(data: Record<string, unknown>): Issue {
    if (this.detectedPlatform === 'github') {
      return {
        id: data.id as number,
        number: data.number as number,
        title: data.title as string,
        description: (data.body as string) || '',
        state: data.state as 'open' | 'closed',
        author: (data.user as Record<string, unknown>).login as string,
        url: data.html_url as string,
        createdAt: new Date(data.created_at as string),
        updatedAt: new Date(data.updated_at as string),
        labels: ((data.labels as Array<Record<string, unknown>>) || []).map(l => l.name as string),
        assignees: ((data.assignees as Array<Record<string, unknown>>) || []).map(a => a.login as string),
        milestone: (data.milestone as Record<string, unknown>)?.title as string | undefined,
      };
    } else {
      return {
        id: data.id as number,
        number: data.iid as number,
        title: data.title as string,
        description: (data.description as string) || '',
        state: data.state as 'open' | 'closed',
        author: (data.author as Record<string, unknown>).username as string,
        url: data.web_url as string,
        createdAt: new Date(data.created_at as string),
        updatedAt: new Date(data.updated_at as string),
        labels: (data.labels as string[]) || [],
        assignees: ((data.assignees as Array<Record<string, unknown>>) || []).map(a => a.username as string),
        milestone: (data.milestone as Record<string, unknown>)?.title as string | undefined,
      };
    }
  }

  /**
   * Map CI state
   */
  private mapState(state: string): CIStatus['state'] {
    const stateMap: Record<string, CIStatus['state']> = {
      pending: 'pending',
      running: 'running',
      success: 'success',
      passed: 'success',
      failure: 'failure',
      failed: 'failure',
      error: 'failure',
      cancelled: 'cancelled',
      canceled: 'cancelled',
      skipped: 'cancelled',
    };
    return stateMap[state.toLowerCase()] || 'pending';
  }
}

// Singleton instance
let gitPlatform: GitPlatformIntegration | null = null;

/**
 * Get or create git platform integration
 */
export function getGitPlatform(config?: GitPlatformConfig): GitPlatformIntegration {
  if (!gitPlatform) {
    gitPlatform = new GitPlatformIntegration(config || { platform: 'auto' });
    gitPlatform.init().catch((err) => {
      logger.debug('Failed to initialize git platform', { error: err instanceof Error ? err.message : String(err) });
    });
  }
  return gitPlatform;
}

export default GitPlatformIntegration;
