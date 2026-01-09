/**
 * Tests for Delegate Command
 *
 * Comprehensive tests covering:
 * - Branch name generation
 * - Git repository operations
 * - Pull request creation
 * - Delegate workflow
 * - Error handling
 */

import * as delegate from '../../src/commands/delegate';

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('abc123'),
  }),
}));

const { exec } = require('child_process');
const crypto = require('crypto');

// Helper to create mock exec implementation
function mockExec(responses: Record<string, { stdout?: string; stderr?: string; error?: Error }>) {
  exec.mockImplementation((
    cmd: string,
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) {
        if (response.error) {
          callback(response.error, { stdout: '', stderr: response.stderr || '' });
        } else {
          callback(null, { stdout: response.stdout || '', stderr: response.stderr || '' });
        }
        return;
      }
    }
    // Default success
    callback(null, { stdout: '', stderr: '' });
  });
}

describe('Delegate Command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateBranchName', () => {
    test('should generate branch name from task', () => {
      const branchName = delegate.generateBranchName('Fix all TypeScript errors');

      expect(branchName).toMatch(/^grok\//);
      expect(branchName).toContain('fix-all-typescript-errors');
      expect(branchName).toMatch(/-[a-f0-9]{6}$/);
    });

    test('should lowercase task description', () => {
      const branchName = delegate.generateBranchName('ADD New Feature');

      expect(branchName).toContain('add-new-feature');
      expect(branchName).not.toContain('ADD');
    });

    test('should replace spaces with hyphens', () => {
      const branchName = delegate.generateBranchName('fix bug in parser');

      expect(branchName).toContain('fix-bug-in-parser');
      expect(branchName).not.toContain(' ');
    });

    test('should remove special characters', () => {
      const branchName = delegate.generateBranchName('Fix bug! @#$% in parser');

      expect(branchName).not.toMatch(/[!@#$%]/);
    });

    test('should truncate long task descriptions', () => {
      const longTask = 'This is a very long task description that exceeds forty characters by quite a bit';
      const branchName = delegate.generateBranchName(longTask);

      // Branch name before hash should be at most 40 chars for slug
      const slug = branchName.split('/')[1].split('-').slice(0, -1).join('-');
      expect(slug.length).toBeLessThanOrEqual(40);
    });

    test('should append random hash for uniqueness', () => {
      const branchName = delegate.generateBranchName('Test task');

      expect(branchName).toContain('-abc123');
    });
  });

  describe('isGitRepo', () => {
    test('should return true when in git repo', async () => {
      mockExec({
        'git rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      });

      const result = await delegate.isGitRepo();

      expect(result).toBe(true);
    });

    test('should return false when not in git repo', async () => {
      mockExec({
        'git rev-parse': { error: new Error('Not a git repository') },
      });

      const result = await delegate.isGitRepo();

      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    test('should return current branch name', async () => {
      mockExec({
        'git branch --show-current': { stdout: 'main\n' },
      });

      const branch = await delegate.getCurrentBranch();

      expect(branch).toBe('main');
    });

    test('should trim whitespace from branch name', async () => {
      mockExec({
        'git branch --show-current': { stdout: '  feature/test  \n' },
      });

      const branch = await delegate.getCurrentBranch();

      expect(branch).toBe('feature/test');
    });
  });

  describe('hasUncommittedChanges', () => {
    test('should return true when there are changes', async () => {
      mockExec({
        'git status --porcelain': { stdout: 'M  src/file.ts\n' },
      });

      const result = await delegate.hasUncommittedChanges();

      expect(result).toBe(true);
    });

    test('should return false when working tree is clean', async () => {
      mockExec({
        'git status --porcelain': { stdout: '' },
      });

      const result = await delegate.hasUncommittedChanges();

      expect(result).toBe(false);
    });

    test('should handle whitespace-only output', async () => {
      mockExec({
        'git status --porcelain': { stdout: '   \n' },
      });

      const result = await delegate.hasUncommittedChanges();

      expect(result).toBe(false);
    });
  });

  describe('createBranch', () => {
    test('should execute git checkout -b command', async () => {
      mockExec({
        'git checkout -b': { stdout: '' },
      });

      await delegate.createBranch('feature/new-branch');

      expect(exec).toHaveBeenCalledWith(
        'git checkout -b feature/new-branch',
        expect.any(Function)
      );
    });
  });

  describe('commitChanges', () => {
    test('should add all files and commit', async () => {
      mockExec({
        'git add -A': { stdout: '' },
        'git commit': { stdout: '' },
      });

      await delegate.commitChanges('Test commit message');

      expect(exec).toHaveBeenCalledWith('git add -A', expect.any(Function));
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git commit -m'),
        expect.any(Function)
      );
    });

    test('should escape quotes in commit message', async () => {
      mockExec({
        'git add -A': { stdout: '' },
        'git commit': { stdout: '' },
      });

      await delegate.commitChanges('Fix "bug" in parser');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('\\"bug\\"'),
        expect.any(Function)
      );
    });
  });

  describe('pushBranch', () => {
    test('should push branch with upstream tracking', async () => {
      mockExec({
        'git push -u origin': { stdout: '' },
      });

      await delegate.pushBranch('feature/test');

      expect(exec).toHaveBeenCalledWith(
        'git push -u origin feature/test',
        expect.any(Function)
      );
    });
  });

  describe('hasGhCli', () => {
    test('should return true when gh is installed', async () => {
      mockExec({
        'gh --version': { stdout: 'gh version 2.0.0\n' },
      });

      const result = await delegate.hasGhCli();

      expect(result).toBe(true);
    });

    test('should return false when gh is not installed', async () => {
      mockExec({
        'gh --version': { error: new Error('command not found: gh') },
      });

      const result = await delegate.hasGhCli();

      expect(result).toBe(false);
    });
  });

  describe('createPullRequest', () => {
    test('should create PR with all parameters', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/123\n' },
      });

      const result = await delegate.createPullRequest(
        'Test PR',
        'PR body',
        'main',
        true,
        ['bug', 'enhancement'],
        ['reviewer1', 'reviewer2']
      );

      expect(result.url).toBe('https://github.com/owner/repo/pull/123');
      expect(result.number).toBe(123);
    });

    test('should include draft flag when draft is true', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Title', 'Body', 'main', true);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--draft'),
        expect.any(Function)
      );
    });

    test('should not include draft flag when draft is false', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Title', 'Body', 'main', false);

      const call = exec.mock.calls.find((c: string[]) => c[0].includes('gh pr create'));
      expect(call[0]).not.toContain('--draft');
    });

    test('should include labels when provided', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Title', 'Body', 'main', false, ['bug', 'urgent']);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--label'),
        expect.any(Function)
      );
    });

    test('should include reviewers when provided', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Title', 'Body', 'main', false, [], ['user1']);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--reviewer'),
        expect.any(Function)
      );
    });

    test('should throw error when PR URL cannot be parsed', async () => {
      mockExec({
        'gh pr create': { stdout: 'Some other output\n' },
      });

      await expect(
        delegate.createPullRequest('Title', 'Body', 'main')
      ).rejects.toThrow('Failed to parse PR URL');
    });

    test('should escape quotes in title and body', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Fix "bug"', 'Body with "quotes"', 'main');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('\\"bug\\"'),
        expect.any(Function)
      );
    });
  });

  describe('addPRComment', () => {
    test('should add comment to PR', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
      });

      await delegate.addPRComment(123, 'Test comment');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('gh pr comment 123'),
        expect.any(Function)
      );
    });

    test('should escape quotes in comment', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
      });

      await delegate.addPRComment(123, 'Comment with "quotes"');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('\\"quotes\\"'),
        expect.any(Function)
      );
    });
  });

  describe('requestReview', () => {
    test('should request review from multiple reviewers', async () => {
      mockExec({
        'gh pr edit': { stdout: '' },
      });

      await delegate.requestReview(123, ['user1', 'user2']);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--add-reviewer'),
        expect.any(Function)
      );
    });

    test('should not make request when reviewers list is empty', async () => {
      await delegate.requestReview(123, []);

      expect(exec).not.toHaveBeenCalled();
    });
  });

  describe('markReady', () => {
    test('should mark PR as ready for review', async () => {
      mockExec({
        'gh pr ready': { stdout: '' },
      });

      await delegate.markReady(123);

      expect(exec).toHaveBeenCalledWith(
        'gh pr ready 123',
        expect.any(Function)
      );
    });
  });

  describe('delegate (main function)', () => {
    test('should fail when not in git repo', async () => {
      mockExec({
        'git rev-parse': { error: new Error('Not a git repo') },
      });

      const result = await delegate.delegate({ task: 'Test task' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a git repository');
    });

    test('should fail when gh CLI is not installed', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { error: new Error('not found') },
      });

      const result = await delegate.delegate({ task: 'Test task' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('gh CLI not installed');
    });

    test('should complete full workflow successfully', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'main' },
        'git status --porcelain': { stdout: '' },
        'git checkout -b': { stdout: '' },
        'git push -u origin': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/42\n' },
      });

      const result = await delegate.delegate({ task: 'Fix bug' });

      expect(result.success).toBe(true);
      expect(result.branchName).toMatch(/^grok\/fix-bug-/);
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
      expect(result.prNumber).toBe(42);
    });

    test('should commit uncommitted changes before creating branch', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'main' },
        'git status --porcelain': { stdout: 'M  file.ts' },
        'git add -A': { stdout: '' },
        'git commit': { stdout: '' },
        'git checkout -b': { stdout: '' },
        'git push -u origin': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      const result = await delegate.delegate({ task: 'Test task' });

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith('git add -A', expect.any(Function));
    });

    test('should use custom base branch when provided', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'feature' },
        'git status --porcelain': { stdout: '' },
        'git checkout -b': { stdout: '' },
        'git push -u origin': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.delegate({ task: 'Test', baseBranch: 'develop' });

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--base develop'),
        expect.any(Function)
      );
    });

    test('should pass labels to PR creation', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'main' },
        'git status --porcelain': { stdout: '' },
        'git checkout -b': { stdout: '' },
        'git push -u origin': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.delegate({
        task: 'Test',
        labels: ['custom-label'],
      });

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--label'),
        expect.any(Function)
      );
    });

    test('should handle errors gracefully', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'main' },
        'git status --porcelain': { stdout: '' },
        'git checkout -b': { error: new Error('Branch already exists') },
      });

      const result = await delegate.delegate({ task: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Branch already exists');
    });
  });

  describe('completeDelegate', () => {
    test('should add completion comment and mark ready', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
        'gh pr ready': { stdout: '' },
      });

      await delegate.completeDelegate(123, 'Task completed successfully');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('gh pr comment 123'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        'gh pr ready 123',
        expect.any(Function)
      );
    });

    test('should request review when reviewers provided', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
        'gh pr ready': { stdout: '' },
        'gh pr edit': { stdout: '' },
      });

      await delegate.completeDelegate(123, 'Done', ['reviewer1']);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--add-reviewer'),
        expect.any(Function)
      );
    });
  });

  describe('abortDelegate', () => {
    test('should add abort comment and close PR', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
        'gh pr close': { stdout: '' },
      });

      await delegate.abortDelegate(123, 'Task could not be completed');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('Task Aborted'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        'gh pr close 123 --delete-branch',
        expect.any(Function)
      );
    });
  });
});
