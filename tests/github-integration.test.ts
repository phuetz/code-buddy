/**
 * Tests for GitHub Integration
 */

import { GitHubIntegration, getGitHubIntegration, resetGitHubIntegration } from '../src/integrations/github-integration';

// Mock BashTool
jest.mock('../src/tools/bash', () => ({
  BashTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation((command: string) => {
      // Mock different commands
      if (command.includes('git remote get-url')) {
        return Promise.resolve({
          success: true,
          output: 'https://github.com/owner/repo.git',
        });
      }
      if (command.includes('gh pr list')) {
        return Promise.resolve({
          success: true,
          output: JSON.stringify([
            {
              number: 1,
              title: 'Test PR',
              author: { login: 'user' },
              headRefName: 'feature',
              baseRefName: 'main',
              url: 'https://github.com/owner/repo/pull/1',
              createdAt: '2024-01-01T00:00:00Z',
              labels: [],
              isDraft: false,
            },
          ]),
        });
      }
      if (command.includes('gh pr create')) {
        return Promise.resolve({
          success: true,
          output: 'https://github.com/owner/repo/pull/123',
        });
      }
      if (command.includes('gh pr view')) {
        return Promise.resolve({
          success: true,
          output: JSON.stringify({
            number: 1,
            title: 'Test PR',
            body: 'Description',
            state: 'OPEN',
            author: { login: 'user' },
            headRefName: 'feature',
            baseRefName: 'main',
            url: 'https://github.com/owner/repo/pull/1',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            labels: [{ name: 'bug' }],
            reviewRequests: [],
            isDraft: false,
          }),
        });
      }
      if (command.includes('git branch --show-current')) {
        return Promise.resolve({
          success: true,
          output: 'feature-branch',
        });
      }
      if (command.includes('git push')) {
        return Promise.resolve({ success: true, output: '' });
      }
      if (command.includes('gh issue list')) {
        return Promise.resolve({
          success: true,
          output: JSON.stringify([
            {
              number: 1,
              title: 'Test Issue',
              body: 'Description',
              state: 'OPEN',
              author: { login: 'user' },
              labels: [{ name: 'bug' }],
              assignees: [],
              url: 'https://github.com/owner/repo/issues/1',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ]),
        });
      }
      if (command.includes('gh issue create')) {
        return Promise.resolve({
          success: true,
          output: 'https://github.com/owner/repo/issues/123',
        });
      }
      if (command.includes('git log')) {
        return Promise.resolve({
          success: true,
          output: 'feat: add new feature\nfix: bug fix',
        });
      }
      if (command.includes('git diff')) {
        return Promise.resolve({
          success: true,
          output: '5 files changed, 100 insertions(+), 20 deletions(-)',
        });
      }
      return Promise.resolve({ success: true, output: '' });
    }),
  })),
}));

describe('GitHubIntegration', () => {
  let github: GitHubIntegration;

  beforeEach(() => {
    resetGitHubIntegration();
    github = new GitHubIntegration();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(github).toBeDefined();
      const provider = github.getProvider();
      expect(provider.type).toBe('github');
    });
  });

  describe('initialize', () => {
    it('should detect repository info', async () => {
      const result = await github.initialize();

      expect(result).toBe(true);
      const repoInfo = github.getRepoInfo();
      expect(repoInfo?.owner).toBe('owner');
      expect(repoInfo?.repo).toBe('repo');
    });
  });

  describe('createPullRequest', () => {
    it('should create a pull request', async () => {
      await github.initialize();

      const pr = await github.createPullRequest({
        title: 'Test PR',
        body: 'Test description',
        targetBranch: 'main',
      });

      expect(pr).toBeDefined();
      expect(pr?.number).toBe(123);
      expect(pr?.url).toContain('github.com');
    });

    it('should support draft PRs', async () => {
      await github.initialize();

      const pr = await github.createPullRequest({
        title: 'Draft PR',
        body: 'WIP',
        draft: true,
      });

      expect(pr).toBeDefined();
    });
  });

  describe('listOpenPRs', () => {
    it('should list open pull requests', async () => {
      await github.initialize();

      const prs = await github.listOpenPRs();

      expect(prs).toHaveLength(1);
      expect(prs[0].title).toBe('Test PR');
      expect(prs[0].state).toBe('open');
    });
  });

  describe('getPRDetails', () => {
    it('should get PR details', async () => {
      await github.initialize();

      const pr = await github.getPRDetails(1);

      expect(pr).toBeDefined();
      expect(pr?.title).toBe('Test PR');
      expect(pr?.labels).toContain('bug');
    });
  });

  describe('createIssue', () => {
    it('should create an issue', async () => {
      await github.initialize();

      const issue = await github.createIssue({
        title: 'Bug Report',
        body: 'Description of the bug',
        labels: ['bug'],
      });

      expect(issue).toBeDefined();
      expect(issue?.number).toBe(123);
    });
  });

  describe('listIssues', () => {
    it('should list issues', async () => {
      await github.initialize();

      const issues = await github.listIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe('Test Issue');
      expect(issues[0].labels).toContain('bug');
    });

    it('should filter by state', async () => {
      await github.initialize();

      const issues = await github.listIssues({ state: 'closed' });

      expect(Array.isArray(issues)).toBe(true);
    });
  });

  describe('generatePRDescription', () => {
    it('should generate PR description from commits', async () => {
      await github.initialize();

      const description = await github.generatePRDescription();

      expect(description).toContain('## Summary');
      expect(description).toContain('## Changes');
      expect(description).toContain('## Test Plan');
    });
  });

  describe('formatPRList', () => {
    it('should format PR list for display', async () => {
      await github.initialize();
      const prs = await github.listOpenPRs();

      const formatted = github.formatPRList(prs);

      expect(formatted).toContain('OPEN PULL REQUESTS');
      expect(formatted).toContain('Test PR');
    });

    it('should handle empty list', () => {
      const formatted = github.formatPRList([]);

      expect(formatted).toContain('No open pull requests');
    });
  });

  describe('events', () => {
    it('should emit initialized event', (done) => {
      github.on('initialized', (data) => {
        expect(data.repo).toBeDefined();
        expect(data.provider).toBeDefined();
        done();
      });

      github.initialize();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getGitHubIntegration();
      const instance2 = getGitHubIntegration();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getGitHubIntegration();
      resetGitHubIntegration();
      const instance2 = getGitHubIntegration();
      expect(instance1).not.toBe(instance2);
    });
  });
});
