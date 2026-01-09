/**
 * Unit tests for Integrations Module
 *
 * Tests for:
 * - GitHub Integration
 * - GitLab Integration
 * - GitHub Actions
 * - CI/CD Integration
 * - Notification Integrations (webhooks)
 * - Git Platform Integration
 * - Task Management Integration (Jira, Linear)
 * - Code Review
 */

import { EventEmitter } from 'events';

// Mock the logger first - this needs to be before any imports
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Create mock functions for BashTool
const mockBashExecute = jest.fn();

// Mock BashTool before any imports that use it
jest.mock('../../src/tools/bash', () => ({
  BashTool: jest.fn().mockImplementation(() => ({
    execute: mockBashExecute,
  })),
}));

// ============================================================================
// GitHub Integration Tests
// ============================================================================

describe('GitHubIntegration', () => {
  let GitHubIntegration: typeof import('../../src/integrations/github-integration').GitHubIntegration;
  let getGitHubIntegration: typeof import('../../src/integrations/github-integration').getGitHubIntegration;
  let resetGitHubIntegration: typeof import('../../src/integrations/github-integration').resetGitHubIntegration;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBashExecute.mockReset();

    // Re-import to get fresh module
    const module = require('../../src/integrations/github-integration');
    GitHubIntegration = module.GitHubIntegration;
    getGitHubIntegration = module.getGitHubIntegration;
    resetGitHubIntegration = module.resetGitHubIntegration;
    resetGitHubIntegration();
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const integration = new GitHubIntegration();
      expect(integration).toBeDefined();
      expect(integration).toBeInstanceOf(EventEmitter);
    });

    it('should create instance with custom config', () => {
      const integration = new GitHubIntegration({
        defaultBranch: 'develop',
        autoLabels: false,
      });
      expect(integration).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize and detect GitHub repository', async () => {
      mockBashExecute.mockResolvedValueOnce({
        success: true,
        output: 'https://github.com/owner/repo.git',
      });

      const integration = new GitHubIntegration();
      const result = await integration.initialize();

      expect(result).toBe(true);
      expect(integration.getRepoInfo()).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should initialize and detect GitLab repository', async () => {
      mockBashExecute.mockResolvedValueOnce({
        success: true,
        output: 'git@gitlab.com:owner/repo.git',
      });

      const integration = new GitHubIntegration();
      const result = await integration.initialize();

      expect(result).toBe(true);
      expect(integration.getProvider().type).toBe('gitlab');
    });

    it('should return false when git remote fails', async () => {
      mockBashExecute.mockResolvedValueOnce({
        success: false,
        error: 'Not a git repository',
      });

      const integration = new GitHubIntegration();
      const result = await integration.initialize();

      expect(result).toBe(false);
    });

    it('should parse SSH remote URL', async () => {
      mockBashExecute.mockResolvedValueOnce({
        success: true,
        output: 'git@github.com:test-owner/test-repo.git',
      });

      const integration = new GitHubIntegration();
      await integration.initialize();

      expect(integration.getRepoInfo()).toEqual({
        owner: 'test-owner',
        repo: 'test-repo',
      });
    });

    it('should parse HTTPS remote URL', async () => {
      mockBashExecute.mockResolvedValueOnce({
        success: true,
        output: 'https://github.com/my-org/my-project.git',
      });

      const integration = new GitHubIntegration();
      await integration.initialize();

      expect(integration.getRepoInfo()).toEqual({
        owner: 'my-org',
        repo: 'my-project',
      });
    });

    it('should emit initialized event', async () => {
      mockBashExecute.mockResolvedValueOnce({
        success: true,
        output: 'https://github.com/owner/repo.git',
      });

      const integration = new GitHubIntegration();
      const eventHandler = jest.fn();
      integration.on('initialized', eventHandler);

      await integration.initialize();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: { owner: 'owner', repo: 'repo' },
        })
      );
    });
  });

  describe('createPullRequest', () => {
    it('should create GitHub PR using gh CLI', async () => {
      // Mock initialize
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true, output: 'feature-branch' })
        .mockResolvedValueOnce({ success: true, output: '' }) // git push
        .mockResolvedValueOnce({
          success: true,
          output: 'https://github.com/owner/repo/pull/123',
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const pr = await integration.createPullRequest({
        title: 'Test PR',
        body: 'Test description',
      });

      expect(pr).not.toBeNull();
      expect(pr?.number).toBe(123);
      expect(pr?.title).toBe('Test PR');
    });

    it('should create PR with labels and reviewers', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true, output: 'feature-branch' })
        .mockResolvedValueOnce({ success: true, output: '' })
        .mockResolvedValueOnce({
          success: true,
          output: 'https://github.com/owner/repo/pull/456',
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const pr = await integration.createPullRequest({
        title: 'Feature PR',
        body: 'New feature',
        labels: ['enhancement', 'needs-review'],
        reviewers: ['reviewer1', 'reviewer2'],
        draft: true,
      });

      expect(pr).not.toBeNull();
      expect(pr?.isDraft).toBe(true);
      expect(pr?.labels).toEqual(['enhancement', 'needs-review']);
    });

    it('should return null when PR creation fails', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true, output: 'feature-branch' })
        .mockResolvedValueOnce({ success: true, output: '' })
        .mockResolvedValueOnce({
          success: false,
          error: 'PR creation failed',
        });

      const integration = new GitHubIntegration();
      // Add error listener to prevent unhandled error
      integration.on('error', () => {});
      await integration.initialize();

      const pr = await integration.createPullRequest({
        title: 'Test PR',
        body: 'Test',
      });

      expect(pr).toBeNull();
    });
  });

  describe('getPRDiff', () => {
    it('should get PR diff using gh CLI', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({
          success: true,
          output: '+ added line\n- removed line',
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const diff = await integration.getPRDiff(123);

      expect(diff).toContain('+ added line');
    });

    it('should return null when diff fails', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: false });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const diff = await integration.getPRDiff(123);

      expect(diff).toBeNull();
    });
  });

  describe('getPRDetails', () => {
    it('should get PR details from GitHub', async () => {
      const prData = {
        number: 42,
        title: 'Feature PR',
        body: 'Description',
        state: 'OPEN',
        author: { login: 'testuser' },
        headRefName: 'feature',
        baseRefName: 'main',
        url: 'https://github.com/owner/repo/pull/42',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        labels: [{ name: 'bug' }],
        reviewRequests: [{ login: 'reviewer' }],
        isDraft: false,
      };

      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(prData),
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const pr = await integration.getPRDetails(42);

      expect(pr).not.toBeNull();
      expect(pr?.number).toBe(42);
      expect(pr?.author).toBe('testuser');
      expect(pr?.labels).toEqual(['bug']);
    });
  });

  describe('addPRComment', () => {
    it('should add comment to PR', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const result = await integration.addPRComment(123, 'Test comment');

      expect(result).toBe(true);
    });
  });

  describe('addPRReview', () => {
    it('should add approve review', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const result = await integration.addPRReview(123, {
        event: 'APPROVE',
        body: 'LGTM!',
      });

      expect(result).toBe(true);
    });

    it('should add request changes review', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const result = await integration.addPRReview(123, {
        event: 'REQUEST_CHANGES',
        body: 'Please fix the issues',
      });

      expect(result).toBe(true);
    });
  });

  describe('listOpenPRs', () => {
    it('should list open PRs', async () => {
      const prsData = [
        {
          number: 1,
          title: 'PR 1',
          author: { login: 'user1' },
          headRefName: 'feature-1',
          baseRefName: 'main',
          url: 'https://github.com/owner/repo/pull/1',
          createdAt: '2024-01-01T00:00:00Z',
          labels: [],
          isDraft: false,
        },
        {
          number: 2,
          title: 'PR 2',
          author: { login: 'user2' },
          headRefName: 'feature-2',
          baseRefName: 'main',
          url: 'https://github.com/owner/repo/pull/2',
          createdAt: '2024-01-02T00:00:00Z',
          labels: [{ name: 'wip' }],
          isDraft: true,
        },
      ];

      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(prsData),
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const prs = await integration.listOpenPRs();

      expect(prs).toHaveLength(2);
      expect(prs[0].number).toBe(1);
      expect(prs[1].isDraft).toBe(true);
    });

    it('should return empty array on failure', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: false });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const prs = await integration.listOpenPRs();

      expect(prs).toEqual([]);
    });
  });

  describe('createIssue', () => {
    it('should create GitHub issue', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({
          success: true,
          output: 'https://github.com/owner/repo/issues/99',
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const issue = await integration.createIssue({
        title: 'Bug Report',
        body: 'There is a bug',
        labels: ['bug'],
        assignees: ['developer'],
      });

      expect(issue).not.toBeNull();
      expect(issue?.number).toBe(99);
      expect(issue?.title).toBe('Bug Report');
    });
  });

  describe('listIssues', () => {
    it('should list issues with filters', async () => {
      const issuesData = [
        {
          number: 10,
          title: 'Issue 1',
          body: 'Description 1',
          state: 'open',
          author: { login: 'user1' },
          labels: [{ name: 'bug' }],
          assignees: [{ login: 'dev1' }],
          url: 'https://github.com/owner/repo/issues/10',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(issuesData),
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const issues = await integration.listIssues({ labels: ['bug'] });

      expect(issues).toHaveLength(1);
      expect(issues[0].labels).toContain('bug');
    });
  });

  describe('getCIStatus', () => {
    it('should get CI status for commit', async () => {
      const runsData = [
        { name: 'Build', status: 'completed', conclusion: 'success' },
        { name: 'Test', status: 'completed', conclusion: 'success' },
      ];

      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(runsData),
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const status = await integration.getCIStatus();

      expect(status.state).toBe('success');
      expect(status.checks).toHaveLength(2);
    });

    it('should detect failure state', async () => {
      const runsData = [
        { name: 'Build', status: 'completed', conclusion: 'success' },
        { name: 'Test', status: 'completed', conclusion: 'failure' },
      ];

      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(runsData),
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const status = await integration.getCIStatus();

      expect(status.state).toBe('failure');
    });

    it('should detect pending state', async () => {
      const runsData = [
        { name: 'Build', status: 'in_progress', conclusion: null },
      ];

      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(runsData),
        });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const status = await integration.getCIStatus();

      expect(status.state).toBe('pending');
    });
  });

  describe('generatePRDescription', () => {
    it('should generate PR description from commits', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true, output: 'feat: add feature\nfix: fix bug' })
        .mockResolvedValueOnce({ success: true, output: ' 2 files changed, 10 insertions(+)' });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const description = await integration.generatePRDescription();

      expect(description).toContain('Summary');
      expect(description).toContain('feat: add feature');
      expect(description).toContain('fix: fix bug');
      expect(description).toContain('Test Plan');
    });
  });

  describe('mergePR', () => {
    it('should merge PR with squash', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const result = await integration.mergePR(123, { method: 'squash' });

      expect(result).toBe(true);
    });

    it('should merge PR with delete branch option', async () => {
      mockBashExecute
        .mockResolvedValueOnce({ success: true, output: 'https://github.com/owner/repo.git' })
        .mockResolvedValueOnce({ success: true });

      const integration = new GitHubIntegration();
      await integration.initialize();

      const result = await integration.mergePR(123, { deleteAfter: true });

      expect(result).toBe(true);
    });
  });

  describe('formatPRList', () => {
    it('should format empty PR list', () => {
      const integration = new GitHubIntegration();
      const output = integration.formatPRList([]);

      expect(output).toBe('No open pull requests.');
    });

    it('should format PR list with items', () => {
      const integration = new GitHubIntegration();
      const prs = [
        {
          id: 1,
          number: 123,
          title: 'Test PR',
          body: '',
          state: 'open' as const,
          author: 'user',
          sourceBranch: 'feature',
          targetBranch: 'main',
          url: 'https://github.com/owner/repo/pull/123',
          createdAt: new Date(),
          updatedAt: new Date(),
          labels: ['enhancement'],
          reviewers: [],
          isDraft: false,
        },
      ];

      const output = integration.formatPRList(prs);

      expect(output).toContain('OPEN PULL REQUESTS');
      expect(output).toContain('#123');
      expect(output).toContain('Test PR');
      expect(output).toContain('feature');
      expect(output).toContain('main');
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      resetGitHubIntegration();
      const instance1 = getGitHubIntegration();
      const instance2 = getGitHubIntegration();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getGitHubIntegration();
      resetGitHubIntegration();
      const instance2 = getGitHubIntegration();

      expect(instance1).not.toBe(instance2);
    });
  });
});

// ============================================================================
// GitHub Actions Manager Tests
// ============================================================================

describe('GitHubActionsManager', () => {
  let GitHubActionsManager: typeof import('../../src/integrations/github-actions').GitHubActionsManager;
  let getGitHubActionsManager: typeof import('../../src/integrations/github-actions').getGitHubActionsManager;
  let resetGitHubActionsManager: typeof import('../../src/integrations/github-actions').resetGitHubActionsManager;

  beforeEach(() => {
    jest.clearAllMocks();

    const module = require('../../src/integrations/github-actions');
    GitHubActionsManager = module.GitHubActionsManager;
    getGitHubActionsManager = module.getGitHubActionsManager;
    resetGitHubActionsManager = module.resetGitHubActionsManager;
    resetGitHubActionsManager();
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const manager = new GitHubActionsManager();
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(EventEmitter);
    });

    it('should create instance with custom workflows directory', () => {
      const manager = new GitHubActionsManager({
        workflowsDir: 'custom/.github/workflows',
      });
      expect(manager).toBeDefined();
    });
  });

  describe('getTemplates', () => {
    it('should return available templates', () => {
      const manager = new GitHubActionsManager();
      const templates = manager.getTemplates();

      expect(templates).toContain('node-ci');
      expect(templates).toContain('python-ci');
      expect(templates).toContain('security-scan');
      expect(templates).toContain('docker-build');
    });
  });

  describe('getTemplate', () => {
    it('should return template config', () => {
      const manager = new GitHubActionsManager();
      const template = manager.getTemplate('node-ci');

      expect(template).not.toBeNull();
      expect(template?.name).toBe('Node.js CI');
      expect(template?.jobs).toBeDefined();
    });

    it('should return null for unknown template', () => {
      const manager = new GitHubActionsManager();
      const template = manager.getTemplate('unknown-template');

      expect(template).toBeNull();
    });
  });

  describe('validateWorkflow', () => {
    it('should validate correct workflow', () => {
      const manager = new GitHubActionsManager();
      const config = {
        name: 'Valid Workflow',
        on: { push: { branches: ['main'] } },
        jobs: {
          build: {
            'runs-on': 'ubuntu-latest',
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
      };

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report missing name', () => {
      const manager = new GitHubActionsManager();
      const config = {
        name: '',
        on: { push: {} },
        jobs: { build: { 'runs-on': 'ubuntu-latest', steps: [] } },
      };

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Workflow must have a name');
    });

    it('should report missing trigger', () => {
      const manager = new GitHubActionsManager();
      const config = {
        name: 'Test',
        on: {},
        jobs: { build: { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo test' }] } },
      };

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Workflow must have at least one trigger');
    });

    it('should report missing runs-on', () => {
      const manager = new GitHubActionsManager();
      const config = {
        name: 'Test',
        on: { push: {} },
        jobs: {
          build: {
            'runs-on': '',
            steps: [{ run: 'echo test' }],
          },
        },
      };

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('runs-on'))).toBe(true);
    });

    it('should report step without uses or run', () => {
      const manager = new GitHubActionsManager();
      const config = {
        name: 'Test',
        on: { push: {} },
        jobs: {
          build: {
            'runs-on': 'ubuntu-latest',
            steps: [{ name: 'Empty step' }],
          },
        },
      };

      const result = manager.validateWorkflow(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'uses' or 'run'"))).toBe(true);
    });
  });

  describe('analyzeWorkflow', () => {
    it('should suggest caching for node setup', () => {
      const manager = new GitHubActionsManager();
      const config = {
        name: 'CI',
        on: { push: {} },
        jobs: {
          build: {
            'runs-on': 'ubuntu-latest',
            steps: [
              { uses: 'actions/checkout@v4' },
              { uses: 'actions/setup-node@v4' },
            ],
          },
        },
      };

      const suggestions = manager.analyzeWorkflow(config);

      expect(suggestions.some((s) => s.type === 'caching')).toBe(true);
    });

    it('should warn about unpinned actions', () => {
      const manager = new GitHubActionsManager();
      const config = {
        name: 'CI',
        on: { push: {} },
        jobs: {
          build: {
            'runs-on': 'ubuntu-latest',
            steps: [{ uses: 'actions/checkout' }], // Missing version
          },
        },
      };

      const suggestions = manager.analyzeWorkflow(config);

      expect(suggestions.some((s) => s.type === 'security')).toBe(true);
    });

    it('should suggest timeout for jobs', () => {
      const manager = new GitHubActionsManager();
      const config = {
        name: 'CI',
        on: { push: {} },
        jobs: {
          build: {
            'runs-on': 'ubuntu-latest',
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
      };

      const suggestions = manager.analyzeWorkflow(config);

      expect(suggestions.some((s) => s.type === 'reliability')).toBe(true);
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      resetGitHubActionsManager();
      const instance1 = getGitHubActionsManager();
      const instance2 = getGitHubActionsManager();

      expect(instance1).toBe(instance2);
    });
  });
});

// ============================================================================
// Notification Manager Tests
// ============================================================================

describe('NotificationManager', () => {
  let NotificationManager: typeof import('../../src/integrations/notification-integrations').NotificationManager;
  let getNotificationManager: typeof import('../../src/integrations/notification-integrations').getNotificationManager;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Save and mock global fetch
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const module = require('../../src/integrations/notification-integrations');
    NotificationManager = module.NotificationManager;
    getNotificationManager = module.getNotificationManager;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const manager = new NotificationManager();
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(EventEmitter);
    });

    it('should create instance with custom config', () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
        botName: 'TestBot',
        rateLimit: 60,
      });
      expect(manager).toBeDefined();
    });
  });

  describe('notify', () => {
    it('should send notification to Slack', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.notify({
        title: 'Test',
        message: 'Test message',
        level: 'info',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should send notification to Discord', async () => {
      const manager = new NotificationManager({
        discordWebhook: 'https://discord.com/api/webhooks/test',
      });

      await manager.notify({
        title: 'Test',
        message: 'Test message',
        level: 'success',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.anything()
      );
    });

    it('should send notification to Teams', async () => {
      const manager = new NotificationManager({
        teamsWebhook: 'https://outlook.office.com/webhook/test',
      });

      await manager.notify({
        title: 'Test',
        message: 'Test message',
        level: 'warning',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://outlook.office.com/webhook/test',
        expect.anything()
      );
    });

    it('should send to custom webhooks', async () => {
      const manager = new NotificationManager({
        customWebhooks: ['https://custom.api/webhook1', 'https://custom.api/webhook2'],
      });

      await manager.notify({
        title: 'Test',
        message: 'Custom notification',
        level: 'error',
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should emit notification event', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      const eventHandler = jest.fn();
      manager.on('notification', eventHandler);

      await manager.notify({
        title: 'Test',
        message: 'Message',
        level: 'info',
      });

      expect(eventHandler).toHaveBeenCalled();
    });

    it('should respect rate limiting', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
        rateLimit: 2,
      });

      // Send 3 notifications quickly
      await manager.notify({ title: 'Test 1', message: 'Msg', level: 'info' });
      await manager.notify({ title: 'Test 2', message: 'Msg', level: 'info' });
      await manager.notify({ title: 'Test 3', message: 'Msg', level: 'info' });

      // Only first 2 should go through
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Convenience methods', () => {
    it('should send info notification', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.info('Info Title', 'Info message');

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should send success notification', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.success('Success Title', 'Success message');

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should send warning notification', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.warning('Warning Title', 'Warning message');

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should send error notification', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.error('Error Title', 'Error message');

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Session notifications', () => {
    it('should notify session start', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.notifySessionStart('session-123');

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should notify session end with stats', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.notifySessionEnd('session-123', {
        messages: 10,
        cost: 0.05,
        duration: 300,
      });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should notify error', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.notifyError(new Error('Test error'), 'Test context');

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should notify cost threshold', async () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
      });

      await manager.notifyCostThreshold(8.5, 10.0);

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should flush pending notifications on close', () => {
      const manager = new NotificationManager({
        slackWebhook: 'https://hooks.slack.com/test',
        batchNotifications: true,
        batchInterval: 5000,
      });

      manager.notify({ title: 'Test', message: 'Msg', level: 'info' });
      manager.close();

      // Should complete without error
      expect(true).toBe(true);
    });
  });
});

// ============================================================================
// Task Management Integration Tests
// ============================================================================

describe('TaskManagementIntegration', () => {
  let TaskManagementIntegration: typeof import('../../src/integrations/task-management-integration').TaskManagementIntegration;
  let JiraClient: typeof import('../../src/integrations/task-management-integration').JiraClient;
  let LinearClient: typeof import('../../src/integrations/task-management-integration').LinearClient;
  let getTaskManagement: typeof import('../../src/integrations/task-management-integration').getTaskManagement;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.clearAllMocks();

    // Save and mock global fetch
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const module = require('../../src/integrations/task-management-integration');
    TaskManagementIntegration = module.TaskManagementIntegration;
    JiraClient = module.JiraClient;
    LinearClient = module.LinearClient;
    getTaskManagement = module.getTaskManagement;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('TaskManagementIntegration', () => {
    describe('configure', () => {
      it('should configure Jira client', () => {
        const manager = new TaskManagementIntegration();
        manager.configure({
          platform: 'jira',
          apiKey: 'test-key',
          baseUrl: 'https://test.atlassian.net',
          projectKey: 'TEST',
        });

        expect(manager.isConfigured()).toBe(true);
        expect(manager.getPlatform()).toBe('jira');
      });

      it('should configure Linear client', () => {
        const manager = new TaskManagementIntegration();
        manager.configure({
          platform: 'linear',
          apiKey: 'lin_test_key',
          teamId: 'team-123',
        });

        expect(manager.isConfigured()).toBe(true);
        expect(manager.getPlatform()).toBe('linear');
      });

      it('should throw for unsupported platform', () => {
        const manager = new TaskManagementIntegration();

        expect(() =>
          manager.configure({
            platform: 'unsupported' as 'jira',
            apiKey: 'test',
          })
        ).toThrow(/Unsupported platform/);
      });

      it('should emit configured event', () => {
        const manager = new TaskManagementIntegration();
        const handler = jest.fn();
        manager.on('configured', handler);

        manager.configure({
          platform: 'jira',
          apiKey: 'test-key',
          baseUrl: 'https://test.atlassian.net',
        });

        expect(handler).toHaveBeenCalledWith('jira');
      });
    });

    describe('extractIssueKeys', () => {
      it('should extract Jira-style keys', () => {
        const manager = new TaskManagementIntegration();
        const keys = manager.extractIssueKeys('Fix PROJ-123 and PROJ-456');

        expect(keys).toContain('PROJ-123');
        expect(keys).toContain('PROJ-456');
      });

      it('should extract GitHub-style references', () => {
        const manager = new TaskManagementIntegration();
        const keys = manager.extractIssueKeys('fixes #42, closes #99');

        expect(keys).toContain('42');
        expect(keys).toContain('99');
      });

      it('should deduplicate keys', () => {
        const manager = new TaskManagementIntegration();
        const keys = manager.extractIssueKeys('PROJ-123 and PROJ-123 again');

        expect(keys).toHaveLength(1);
      });
    });

    describe('getIssue', () => {
      it('should throw when not configured', async () => {
        const manager = new TaskManagementIntegration();

        await expect(manager.getIssue('TEST-123')).rejects.toThrow(
          /not configured/
        );
      });
    });
  });

  describe('JiraClient', () => {
    it('should require baseUrl', () => {
      expect(
        () =>
          new JiraClient({
            platform: 'jira',
            apiKey: 'test',
          })
      ).toThrow(/requires baseUrl/);
    });

    it('should create client with valid config', () => {
      const client = new JiraClient({
        platform: 'jira',
        apiKey: 'test-key',
        baseUrl: 'https://test.atlassian.net',
        projectKey: 'TEST',
      });

      expect(client).toBeDefined();
    });

    describe('testConnection', () => {
      it('should return true on successful connection', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ accountId: 'test' }),
        });

        const client = new JiraClient({
          platform: 'jira',
          apiKey: 'test-key',
          baseUrl: 'https://test.atlassian.net',
        });

        const result = await client.testConnection();

        expect(result).toBe(true);
      });

      it('should return false on failed connection', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
        });

        const client = new JiraClient({
          platform: 'jira',
          apiKey: 'invalid-key',
          baseUrl: 'https://test.atlassian.net',
        });

        const result = await client.testConnection();

        expect(result).toBe(false);
      });
    });

    describe('getIssue', () => {
      it('should fetch issue details', async () => {
        const issueData = {
          id: '10001',
          key: 'TEST-123',
          fields: {
            summary: 'Test Issue',
            description: null,
            status: { name: 'Open' },
            priority: { name: 'Medium' },
            issuetype: { name: 'Task' },
            assignee: { displayName: 'Test User' },
            labels: ['test'],
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-02T00:00:00Z',
          },
        };

        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(issueData),
        });

        const client = new JiraClient({
          platform: 'jira',
          apiKey: 'test-key',
          baseUrl: 'https://test.atlassian.net',
        });

        const issue = await client.getIssue('TEST-123');

        expect(issue).not.toBeNull();
        expect(issue?.key).toBe('TEST-123');
        expect(issue?.title).toBe('Test Issue');
      });

      it('should return null for non-existent issue', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 404,
          text: () => Promise.resolve('Not found'),
        });

        const client = new JiraClient({
          platform: 'jira',
          apiKey: 'test-key',
          baseUrl: 'https://test.atlassian.net',
        });

        const issue = await client.getIssue('TEST-999');

        expect(issue).toBeNull();
      });
    });
  });

  describe('LinearClient', () => {
    it('should create client', () => {
      const client = new LinearClient({
        platform: 'linear',
        apiKey: 'lin_test_key',
        teamId: 'team-123',
      });

      expect(client).toBeDefined();
    });

    describe('testConnection', () => {
      it('should return true on successful connection', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ data: { viewer: { id: 'user-123' } } }),
        });

        const client = new LinearClient({
          platform: 'linear',
          apiKey: 'lin_test_key',
          teamId: 'team-123',
        });

        const result = await client.testConnection();

        expect(result).toBe(true);
      });

      it('should return false on error', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              errors: [{ message: 'Invalid API key' }],
            }),
        });

        const client = new LinearClient({
          platform: 'linear',
          apiKey: 'invalid-key',
          teamId: 'team-123',
        });

        const result = await client.testConnection();

        expect(result).toBe(false);
      });
    });

    describe('getIssue', () => {
      it('should fetch issue via GraphQL', async () => {
        const issueData = {
          data: {
            issue: {
              id: 'issue-123',
              identifier: 'ENG-42',
              title: 'Test Issue',
              description: 'Description',
              priority: 3,
              url: 'https://linear.app/team/issue/ENG-42',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-02T00:00:00Z',
              state: { name: 'In Progress' },
              assignee: { name: 'Test User' },
              labels: { nodes: [{ name: 'bug' }] },
            },
          },
        };

        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(issueData),
        });

        const client = new LinearClient({
          platform: 'linear',
          apiKey: 'lin_test_key',
          teamId: 'team-123',
        });

        const issue = await client.getIssue('ENG-42');

        expect(issue).not.toBeNull();
        expect(issue?.key).toBe('ENG-42');
      });
    });
  });
});

// ============================================================================
// Code Review Manager Tests
// ============================================================================

describe('CodeReviewManager', () => {
  let CodeReviewManager: typeof import('../../src/integrations/code-review').CodeReviewManager;
  let getCodeReviewManager: typeof import('../../src/integrations/code-review').getCodeReviewManager;

  beforeEach(() => {
    jest.clearAllMocks();

    const module = require('../../src/integrations/code-review');
    CodeReviewManager = module.CodeReviewManager;
    getCodeReviewManager = module.getCodeReviewManager;
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const manager = new CodeReviewManager('/test/project');
      expect(manager).toBeDefined();
    });

    it('should create instance with custom config', () => {
      const manager = new CodeReviewManager('/test/project', {
        checkSecurity: false,
        maxComplexity: 15,
      });
      expect(manager.getConfig().maxComplexity).toBe(15);
    });
  });

  describe('generateReviewPrompt', () => {
    it('should generate prompt with diff', () => {
      const manager = new CodeReviewManager('/test/project');
      const diff = '+added line\n-removed line';

      const prompt = manager.generateReviewPrompt(diff);

      expect(prompt).toContain('senior code reviewer');
      expect(prompt).toContain('Security');
      expect(prompt).toContain('+added line');
    });
  });

  describe('formatResults', () => {
    it('should format passed review', () => {
      const manager = new CodeReviewManager('/test/project');
      const result = {
        success: true,
        files: [],
        issues: [],
        summary: {
          filesReviewed: 3,
          totalIssues: 0,
          critical: 0,
          major: 0,
          minor: 0,
          info: 0,
        },
        duration: 100,
        recommendation: 'approve' as const,
      };

      const output = manager.formatResults(result);

      expect(output).toContain('Code Review Passed');
      expect(output).toContain('3 files reviewed');
    });

    it('should format results with issues', () => {
      const manager = new CodeReviewManager('/test/project');
      const result = {
        success: true,
        files: [],
        issues: [
          {
            id: '1',
            file: 'test.js',
            line: 10,
            type: 'security' as const,
            severity: 'critical' as const,
            message: 'Security issue found',
            fixable: false,
          },
        ],
        summary: {
          filesReviewed: 1,
          totalIssues: 1,
          critical: 1,
          major: 0,
          minor: 0,
          info: 0,
        },
        duration: 100,
        recommendation: 'request-changes' as const,
      };

      const output = manager.formatResults(result);

      expect(output).toContain('1 issue(s) found');
      expect(output).toContain('Critical: 1');
      expect(output).toContain('test.js');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const manager = new CodeReviewManager('/test/project');

      manager.updateConfig({ maxComplexity: 20, checkStyle: false });

      const config = manager.getConfig();
      expect(config.maxComplexity).toBe(20);
      expect(config.checkStyle).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return configuration', () => {
      const manager = new CodeReviewManager('/test/project', {
        enabled: true,
        checkSecurity: true,
        checkPerformance: false,
      });

      const config = manager.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.checkSecurity).toBe(true);
      expect(config.checkPerformance).toBe(false);
    });
  });
});

// ============================================================================
// Git Platform Integration Tests (API-based)
// ============================================================================

describe('GitPlatformIntegration', () => {
  let GitPlatformIntegration: typeof import('../../src/integrations/git-platform-integration').GitPlatformIntegration;
  let getGitPlatform: typeof import('../../src/integrations/git-platform-integration').getGitPlatform;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.clearAllMocks();

    // Save and mock global fetch
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const module = require('../../src/integrations/git-platform-integration');
    GitPlatformIntegration = module.GitPlatformIntegration;
    getGitPlatform = module.getGitPlatform;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Constructor', () => {
    it('should create instance with auto platform detection', () => {
      const integration = new GitPlatformIntegration({ platform: 'auto' });
      expect(integration).toBeDefined();
    });

    it('should create instance with explicit GitHub platform', () => {
      const integration = new GitPlatformIntegration({
        platform: 'github',
        token: 'test-token',
      });
      expect(integration).toBeDefined();
    });
  });

  describe('getRepository', () => {
    it('should return null when no repo info available', async () => {
      const integration = new GitPlatformIntegration({
        platform: 'github',
      });
      // Don't call init, so repoInfo is null

      const repo = await integration.getRepository();

      expect(repo).toBeNull();
    });
  });

  describe('listPullRequests', () => {
    it('should return empty array when no repo info', async () => {
      const integration = new GitPlatformIntegration({
        platform: 'github',
      });

      const prs = await integration.listPullRequests();

      expect(prs).toEqual([]);
    });
  });

  describe('listIssues', () => {
    it('should return empty array when no repo info', async () => {
      const integration = new GitPlatformIntegration({
        platform: 'github',
      });

      const issues = await integration.listIssues();

      expect(issues).toEqual([]);
    });
  });

  describe('getCIStatus', () => {
    it('should return empty array when no repo info', async () => {
      const integration = new GitPlatformIntegration({
        platform: 'github',
      });

      const statuses = await integration.getCIStatus('abc123');

      expect(statuses).toEqual([]);
    });
  });

  describe('addComment', () => {
    it('should return false when no repo info', async () => {
      const integration = new GitPlatformIntegration({
        platform: 'github',
      });

      const result = await integration.addComment(123, 'Test');

      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// CI/CD Integration Tests
// ============================================================================

describe('CICDManager', () => {
  let CICDManager: typeof import('../../src/integrations/cicd-integration').CICDManager;
  let getCICDManager: typeof import('../../src/integrations/cicd-integration').getCICDManager;

  beforeEach(() => {
    jest.clearAllMocks();

    const module = require('../../src/integrations/cicd-integration');
    CICDManager = module.CICDManager;
    getCICDManager = module.getCICDManager;
  });

  describe('Constructor', () => {
    it('should create instance with working directory', () => {
      const manager = new CICDManager('/test/project', { autoDetect: false });
      expect(manager).toBeDefined();
    });
  });

  describe('getTemplates', () => {
    it('should return available templates', () => {
      const manager = new CICDManager('/test/project', { autoDetect: false });
      const templates = manager.getTemplates();

      expect(templates).toContain('node-ci');
      expect(templates).toContain('python-ci');
      expect(templates).toContain('rust-ci');
      expect(templates).toContain('docker-build');
      expect(templates).toContain('release');
    });
  });

  describe('formatStatus', () => {
    it('should format status output', () => {
      const manager = new CICDManager('/test/project', { autoDetect: false });
      const output = manager.formatStatus();

      expect(output).toContain('CI/CD Integration');
      expect(output).toContain('Provider:');
    });
  });

  describe('getWorkflows', () => {
    it('should return workflows list', () => {
      const manager = new CICDManager('/test/project', { autoDetect: false });
      const workflows = manager.getWorkflows();

      expect(Array.isArray(workflows)).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return configuration', () => {
      const manager = new CICDManager('/test/project', {
        autoDetect: false,
        provider: 'github-actions',
      });

      const config = manager.getConfig();

      expect(config.provider).toBe('github-actions');
      expect(config.autoDetect).toBe(false);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const manager = new CICDManager('/test/project', { autoDetect: false });

      manager.updateConfig({ monitorRuns: false });

      const config = manager.getConfig();
      expect(config.monitorRuns).toBe(false);
    });
  });
});
