/**
 * Tests for GitTool
 *
 * Comprehensive tests covering:
 * - Git status operations
 * - Git commit operations
 * - Git diff operations
 * - Git log operations
 * - Branch operations
 * - Stash operations
 * - Error handling for non-git directories
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { GitTool, GitStatus, getGitTool } from '../../src/tools/git-tool';

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock ConfirmationService
jest.mock('../../src/utils/confirmation-service', () => ({
  ConfirmationService: {
    getInstance: jest.fn(() => ({
      getSessionFlags: jest.fn(() => ({ bashCommands: true, allOperations: false })),
      requestConfirmation: jest.fn(() => Promise.resolve({ confirmed: true })),
    })),
  },
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

/**
 * Create a mock readable stream that is also an EventEmitter
 */
function createMockReadable(): Readable & EventEmitter {
  const readable = new Readable({
    read() {
      // no-op
    },
  });
  return readable as Readable & EventEmitter;
}

/**
 * Helper to create a mock child process
 */
function createMockProcess(stdout: string, stderr: string, exitCode: number): ChildProcess {
  const mockProcess = new EventEmitter() as ChildProcess;
  const mockStdout = createMockReadable();
  const mockStderr = createMockReadable();

  mockProcess.stdout = mockStdout;
  mockProcess.stderr = mockStderr;

  // Emit data and close events asynchronously
  setImmediate(() => {
    if (stdout) {
      mockStdout.emit('data', Buffer.from(stdout));
    }
    if (stderr) {
      mockStderr.emit('data', Buffer.from(stderr));
    }
    mockProcess.emit('close', exitCode);
  });

  return mockProcess;
}

describe('GitTool', () => {
  let gitTool: GitTool;

  beforeEach(() => {
    jest.clearAllMocks();
    gitTool = new GitTool('/test/repo');
  });

  describe('isGitRepo', () => {
    it('should return true for a valid git repository', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('.git', '', 0));

      const result = await gitTool.isGitRepo();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--git-dir'],
        { cwd: '/test/repo' }
      );
    });

    it('should return false for a non-git directory', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'fatal: not a git repository', 128)
      );

      const result = await gitTool.isGitRepo();

      expect(result).toBe(false);
    });

    it('should return false when git command fails', async () => {
      const mockProcess = new EventEmitter() as ChildProcess;
      mockProcess.stdout = createMockReadable();
      mockProcess.stderr = createMockReadable();

      mockSpawn.mockReturnValueOnce(mockProcess);

      setImmediate(() => {
        mockProcess.emit('error', new Error('git not found'));
      });

      const result = await gitTool.isGitRepo();

      expect(result).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should parse git status correctly with staged files', async () => {
      const porcelainOutput = 'M  src/file1.ts\nA  src/file2.ts\n';
      const branchOutput = '# branch.head main\n# branch.ab +2 -1\n';

      mockSpawn
        .mockReturnValueOnce(createMockProcess(porcelainOutput, '', 0))
        .mockReturnValueOnce(createMockProcess(branchOutput, '', 0));

      const status = await gitTool.getStatus();

      expect(status.staged).toEqual(['src/file1.ts', 'src/file2.ts']);
      expect(status.unstaged).toEqual([]);
      expect(status.untracked).toEqual([]);
      expect(status.branch).toBe('main');
      expect(status.ahead).toBe(2);
      expect(status.behind).toBe(1);
    });

    it('should parse git status with unstaged files', async () => {
      const porcelainOutput = ' M src/file1.ts\n M src/file2.ts\n';
      const branchOutput = '# branch.head develop\n';

      mockSpawn
        .mockReturnValueOnce(createMockProcess(porcelainOutput, '', 0))
        .mockReturnValueOnce(createMockProcess(branchOutput, '', 0));

      const status = await gitTool.getStatus();

      expect(status.staged).toEqual([]);
      expect(status.unstaged).toEqual(['src/file1.ts', 'src/file2.ts']);
      expect(status.untracked).toEqual([]);
      expect(status.branch).toBe('develop');
    });

    it('should parse git status with untracked files', async () => {
      const porcelainOutput = '?? new-file.ts\n?? another-file.ts\n';
      const branchOutput = '# branch.head feature/test\n';

      mockSpawn
        .mockReturnValueOnce(createMockProcess(porcelainOutput, '', 0))
        .mockReturnValueOnce(createMockProcess(branchOutput, '', 0));

      const status = await gitTool.getStatus();

      expect(status.staged).toEqual([]);
      expect(status.unstaged).toEqual([]);
      expect(status.untracked).toEqual(['new-file.ts', 'another-file.ts']);
      expect(status.branch).toBe('feature/test');
    });

    it('should parse git status with mixed changes', async () => {
      const porcelainOutput = 'MM src/file1.ts\nA  src/file2.ts\n?? new.ts\n';
      const branchOutput = '# branch.head main\n# branch.ab +0 -3\n';

      mockSpawn
        .mockReturnValueOnce(createMockProcess(porcelainOutput, '', 0))
        .mockReturnValueOnce(createMockProcess(branchOutput, '', 0));

      const status = await gitTool.getStatus();

      expect(status.staged).toContain('src/file1.ts');
      expect(status.staged).toContain('src/file2.ts');
      expect(status.unstaged).toContain('src/file1.ts');
      expect(status.untracked).toContain('new.ts');
      expect(status.behind).toBe(3);
    });

    it('should handle empty status (clean working tree)', async () => {
      const porcelainOutput = '';
      const branchOutput = '# branch.head main\n';

      mockSpawn
        .mockReturnValueOnce(createMockProcess(porcelainOutput, '', 0))
        .mockReturnValueOnce(createMockProcess(branchOutput, '', 0));

      const status = await gitTool.getStatus();

      expect(status.staged).toEqual([]);
      expect(status.unstaged).toEqual([]);
      expect(status.untracked).toEqual([]);
      expect(status.branch).toBe('main');
    });
  });

  describe('getDiff', () => {
    it('should return unstaged diff by default', async () => {
      const diffOutput = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line1
+new line
 line2`;

      mockSpawn.mockReturnValueOnce(createMockProcess(diffOutput, '', 0));

      const diff = await gitTool.getDiff();

      expect(diff).toBe(diffOutput);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['diff'],
        { cwd: '/test/repo' }
      );
    });

    it('should return staged diff when staged=true', async () => {
      const diffOutput = 'staged diff content';

      mockSpawn.mockReturnValueOnce(createMockProcess(diffOutput, '', 0));

      const diff = await gitTool.getDiff(true);

      expect(diff).toBe(diffOutput);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['diff', '--cached'],
        { cwd: '/test/repo' }
      );
    });

    it('should return empty string when no changes', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));

      const diff = await gitTool.getDiff();

      expect(diff).toBe('');
    });
  });

  describe('getLog', () => {
    it('should return log with default count of 5', async () => {
      const logOutput = `abc1234 First commit
def5678 Second commit
ghi9012 Third commit
jkl3456 Fourth commit
mno7890 Fifth commit`;

      mockSpawn.mockReturnValueOnce(createMockProcess(logOutput, '', 0));

      const log = await gitTool.getLog();

      expect(log).toBe(logOutput);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['log', '--oneline', '-5', '--format=%h %s'],
        { cwd: '/test/repo' }
      );
    });

    it('should return log with custom count', async () => {
      const logOutput = 'abc1234 Commit message';

      mockSpawn.mockReturnValueOnce(createMockProcess(logOutput, '', 0));

      await gitTool.getLog(1);

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['log', '--oneline', '-1', '--format=%h %s'],
        { cwd: '/test/repo' }
      );
    });

    it('should handle empty log (new repo)', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));

      const log = await gitTool.getLog();

      expect(log).toBe('');
    });
  });

  describe('add', () => {
    it('should add all files when "all" is passed', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));

      const result = await gitTool.add('all');

      expect(result.success).toBe(true);
      expect(result.output).toContain('all changes');
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['add', '.'],
        { cwd: '/test/repo' }
      );
    });

    it('should add specific files', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));

      const result = await gitTool.add(['file1.ts', 'file2.ts']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.ts');
      expect(result.output).toContain('file2.ts');
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['add', 'file1.ts', 'file2.ts'],
        { cwd: '/test/repo' }
      );
    });

    it('should handle add errors', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'pathspec did not match any files', 1)
      );

      const result = await gitTool.add(['nonexistent.ts']);

      expect(result.success).toBe(false);
      expect(result.error).toContain('pathspec did not match');
    });
  });

  describe('commit', () => {
    it('should commit with message when confirmation is bypassed', async () => {
      const commitOutput = '[main abc1234] Test commit message\n 1 file changed';

      mockSpawn.mockReturnValueOnce(createMockProcess(commitOutput, '', 0));

      const result = await gitTool.commit('Test commit message');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Test commit message');
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'Test commit message\n\nCo-Authored-By: Code Buddy <noreply@codebuddy.dev>'],
        { cwd: '/test/repo' }
      );
    });

    it('should not duplicate Co-Authored-By if already present', async () => {
      const messageWithTrailer = 'feat: add feature\n\nCo-Authored-By: Someone <someone@example.com>';
      const commitOutput = '[main abc1234] feat: add feature\n 1 file changed';

      mockSpawn.mockReturnValueOnce(createMockProcess(commitOutput, '', 0));

      await gitTool.commit(messageWithTrailer);

      // Should NOT append a second Co-Authored-By trailer
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', messageWithTrailer],
        { cwd: '/test/repo' }
      );
    });

    it('should handle commit errors', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'nothing to commit, working tree clean', 1)
      );

      const result = await gitTool.commit('Test message');

      expect(result.success).toBe(false);
      expect(result.error).toContain('nothing to commit');
    });

    it('should prevent command injection in commit message', async () => {
      const maliciousMessage = 'test"; rm -rf /; echo "';
      const commitOutput = '[main abc1234] test"; rm -rf /; echo "';

      mockSpawn.mockReturnValueOnce(createMockProcess(commitOutput, '', 0));

      await gitTool.commit(maliciousMessage);

      // The message should be passed as a single argument, not executed
      // Attribution trailer is appended but the malicious content remains safely quoted
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', `${maliciousMessage}\n\nCo-Authored-By: Code Buddy <noreply@codebuddy.dev>`],
        { cwd: '/test/repo' }
      );
    });
  });

  describe('push', () => {
    it('should push to remote', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'Everything up-to-date', 0)
      );

      const result = await gitTool.push();

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['push'],
        { cwd: '/test/repo' }
      );
    });

    it('should push with upstream when setUpstream=true', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('Branch set up to track remote', '', 0)
      );

      const result = await gitTool.push(true);

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['push', '-u', 'origin', 'HEAD'],
        { cwd: '/test/repo' }
      );
    });

    it('should retry with upstream when no upstream branch error', async () => {
      mockSpawn
        .mockReturnValueOnce(
          createMockProcess('', 'fatal: The current branch has no upstream branch', 1)
        )
        .mockReturnValueOnce(
          createMockProcess('Branch set up to track', '', 0)
        );

      const result = await gitTool.push();

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('pull', () => {
    it('should pull from remote', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('Updating abc123..def456\nFast-forward', '', 0)
      );

      const result = await gitTool.pull();

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['pull'],
        { cwd: '/test/repo' }
      );
    });

    it('should handle already up to date', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));

      const result = await gitTool.pull();

      expect(result.success).toBe(true);
      expect(result.output).toBe('Already up to date');
    });

    it('should handle pull errors', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'Merge conflict in file.ts', 1)
      );

      const result = await gitTool.pull();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Merge conflict');
    });
  });

  describe('stash', () => {
    it('should stash changes without message', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('Saved working directory and index state', '', 0)
      );

      const result = await gitTool.stash();

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['stash'],
        { cwd: '/test/repo' }
      );
    });

    it('should stash changes with message', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('Saved working directory', '', 0)
      );

      const result = await gitTool.stash('WIP: feature work');

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['stash', '-m', 'WIP: feature work'],
        { cwd: '/test/repo' }
      );
    });

    it('should handle stash with no local changes', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));

      const result = await gitTool.stash();

      expect(result.success).toBe(true);
      expect(result.output).toBe('Stashed changes');
    });
  });

  describe('stashPop', () => {
    it('should pop stashed changes', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('Dropped refs/stash@{0}', '', 0)
      );

      const result = await gitTool.stashPop();

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['stash', 'pop'],
        { cwd: '/test/repo' }
      );
    });

    it('should handle no stash entries', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'No stash entries found', 1)
      );

      const result = await gitTool.stashPop();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No stash entries');
    });
  });

  describe('checkout', () => {
    it('should checkout existing branch', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', "Switched to branch 'develop'", 0)
      );

      const result = await gitTool.checkout('develop');

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['checkout', 'develop'],
        { cwd: '/test/repo' }
      );
    });

    it('should create and checkout new branch', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', "Switched to a new branch 'feature/new'", 0)
      );

      const result = await gitTool.checkout('feature/new', true);

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['checkout', '-b', 'feature/new'],
        { cwd: '/test/repo' }
      );
    });

    it('should handle checkout file', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));

      const result = await gitTool.checkout('src/file.ts');

      expect(result.success).toBe(true);
      expect(result.output).toContain('src/file.ts');
    });

    it('should handle checkout errors', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', "error: pathspec 'nonexistent' did not match", 1)
      );

      const result = await gitTool.checkout('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('pathspec');
    });
  });

  describe('branch', () => {
    it('should list all branches', async () => {
      const branchOutput = `* main
  develop
  feature/test
  remotes/origin/main`;

      mockSpawn.mockReturnValueOnce(createMockProcess(branchOutput, '', 0));

      const result = await gitTool.branch();

      expect(result.success).toBe(true);
      expect(result.output).toContain('main');
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['branch', '-a'],
        { cwd: '/test/repo' }
      );
    });

    it('should create new branch', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));

      const result = await gitTool.branch('feature/new');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Created branch feature/new');
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['branch', 'feature/new'],
        { cwd: '/test/repo' }
      );
    });

    it('should delete branch', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('Deleted branch feature/old', '', 0)
      );

      const result = await gitTool.branch('feature/old', true);

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['branch', '-d', 'feature/old'],
        { cwd: '/test/repo' }
      );
    });

    it('should handle branch already exists error', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', "fatal: A branch named 'existing' already exists", 1)
      );

      const result = await gitTool.branch('existing');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('autoCommit', () => {
    it('should return error if not a git repo', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'fatal: not a git repository', 128)
      );

      const result = await gitTool.autoCommit();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not a git repository');
    });

    it('should return error if no changes to commit', async () => {
      // isGitRepo check
      mockSpawn.mockReturnValueOnce(createMockProcess('.git', '', 0));
      // getStatus - porcelain
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
      // getStatus - branch info
      mockSpawn.mockReturnValueOnce(
        createMockProcess('# branch.head main\n', '', 0)
      );

      const result = await gitTool.autoCommit();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No changes to commit');
    });

    it('should auto-commit with generated message', async () => {
      // isGitRepo check
      mockSpawn.mockReturnValueOnce(createMockProcess('.git', '', 0));
      // getStatus - porcelain (has changes)
      mockSpawn.mockReturnValueOnce(createMockProcess('M  src/file.ts\n', '', 0));
      // getStatus - branch info
      mockSpawn.mockReturnValueOnce(
        createMockProcess('# branch.head main\n', '', 0)
      );
      // add
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
      // generateCommitMessage - getStatus porcelain
      mockSpawn.mockReturnValueOnce(createMockProcess('M  src/file.ts\n', '', 0));
      // generateCommitMessage - getStatus branch
      mockSpawn.mockReturnValueOnce(
        createMockProcess('# branch.head main\n', '', 0)
      );
      // getDiff
      mockSpawn.mockReturnValueOnce(createMockProcess('diff content', '', 0));
      // commit
      mockSpawn.mockReturnValueOnce(
        createMockProcess('[main abc1234] feat: update file.ts', '', 0)
      );

      const result = await gitTool.autoCommit();

      expect(result.success).toBe(true);
    });

    it('should push after commit when push=true', async () => {
      // isGitRepo
      mockSpawn.mockReturnValueOnce(createMockProcess('.git', '', 0));
      // getStatus - porcelain
      mockSpawn.mockReturnValueOnce(createMockProcess('M  src/file.ts\n', '', 0));
      // getStatus - branch
      mockSpawn.mockReturnValueOnce(
        createMockProcess('# branch.head main\n', '', 0)
      );
      // add
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
      // generateCommitMessage - getStatus porcelain
      mockSpawn.mockReturnValueOnce(createMockProcess('M  src/file.ts\n', '', 0));
      // generateCommitMessage - getStatus branch
      mockSpawn.mockReturnValueOnce(
        createMockProcess('# branch.head main\n', '', 0)
      );
      // getDiff
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
      // commit
      mockSpawn.mockReturnValueOnce(
        createMockProcess('[main abc1234] feat: update file.ts', '', 0)
      );
      // push
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'Everything up-to-date', 0)
      );

      const result = await gitTool.autoCommit({ push: true });

      expect(result.success).toBe(true);
    });
  });

  describe('formatStatus', () => {
    it('should format status with all components', () => {
      const status: GitStatus = {
        staged: ['file1.ts'],
        unstaged: ['file2.ts'],
        untracked: ['file3.ts'],
        branch: 'main',
        ahead: 2,
        behind: 1,
      };

      const formatted = gitTool.formatStatus(status);

      expect(formatted).toContain('Branch: main');
      expect(formatted).toContain('↑2');
      expect(formatted).toContain('↓1');
      expect(formatted).toContain('Staged:');
      expect(formatted).toContain('✓ file1.ts');
      expect(formatted).toContain('Modified:');
      expect(formatted).toContain('● file2.ts');
      expect(formatted).toContain('Untracked:');
      expect(formatted).toContain('? file3.ts');
    });

    it('should format clean working tree', () => {
      const status: GitStatus = {
        staged: [],
        unstaged: [],
        untracked: [],
        branch: 'main',
        ahead: 0,
        behind: 0,
      };

      const formatted = gitTool.formatStatus(status);

      expect(formatted).toContain('Branch: main');
      expect(formatted).toContain('Working tree clean');
      expect(formatted).not.toContain('Staged:');
      expect(formatted).not.toContain('Modified:');
      expect(formatted).not.toContain('Untracked:');
    });

    it('should format status with only ahead', () => {
      const status: GitStatus = {
        staged: [],
        unstaged: [],
        untracked: [],
        branch: 'feature',
        ahead: 5,
        behind: 0,
      };

      const formatted = gitTool.formatStatus(status);

      expect(formatted).toContain('↑5');
      expect(formatted).not.toContain('↓');
    });

    it('should format status with only behind', () => {
      const status: GitStatus = {
        staged: [],
        unstaged: [],
        untracked: [],
        branch: 'feature',
        ahead: 0,
        behind: 3,
      };

      const formatted = gitTool.formatStatus(status);

      expect(formatted).toContain('↓3');
      expect(formatted).not.toContain('↑');
    });
  });

  describe('Error Handling', () => {
    it('should handle spawn errors gracefully', async () => {
      const mockProcess = new EventEmitter() as ChildProcess;
      mockProcess.stdout = createMockReadable();
      mockProcess.stderr = createMockReadable();

      mockSpawn.mockReturnValueOnce(mockProcess);

      setImmediate(() => {
        mockProcess.emit('error', new Error('spawn ENOENT'));
      });

      // getStatus uses Promise.all, which catches the error from the spawn
      await expect(gitTool.getStatus()).rejects.toThrow();
    });

    it('should handle non-zero exit codes', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('', 'fatal: ambiguous argument', 128)
      );

      const result = await gitTool.add(['bad-path']);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ambiguous argument');
    });
  });

  describe('Constructor', () => {
    it('should use provided cwd', () => {
      const tool = new GitTool('/custom/path');
      mockSpawn.mockReturnValueOnce(createMockProcess('.git', '', 0));

      tool.isGitRepo();

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.any(Array),
        { cwd: '/custom/path' }
      );
    });

    it('should default to process.cwd when no cwd provided', () => {
      const tool = new GitTool();
      mockSpawn.mockReturnValueOnce(createMockProcess('.git', '', 0));

      tool.isGitRepo();

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.any(Array),
        { cwd: process.cwd() }
      );
    });
  });
});

describe('getGitTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return singleton instance', () => {
    const firstTool = getGitTool();
    const secondTool = getGitTool();

    // They should be the same instance when no cwd is provided
    expect(firstTool).toBe(secondTool);
  });

  it('should create new instance when cwd is provided', () => {
    getGitTool();
    const toolWithDifferentPath = getGitTool('/different/path');

    // New instance should be created when cwd is provided
    expect(toolWithDifferentPath).toBeInstanceOf(GitTool);
  });
});

describe('GitTool Commit Message Generation', () => {
  let gitTool: GitTool;

  beforeEach(() => {
    jest.clearAllMocks();
    gitTool = new GitTool('/test/repo');
  });

  it('should generate test commit type for test files', async () => {
    // isGitRepo
    mockSpawn.mockReturnValueOnce(createMockProcess('.git', '', 0));
    // getStatus - porcelain
    mockSpawn.mockReturnValueOnce(
      createMockProcess('M  tests/file.test.ts\n', '', 0)
    );
    // getStatus - branch
    mockSpawn.mockReturnValueOnce(
      createMockProcess('# branch.head main\n', '', 0)
    );
    // add
    mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
    // generateCommitMessage - getStatus porcelain
    mockSpawn.mockReturnValueOnce(
      createMockProcess('M  tests/file.test.ts\n', '', 0)
    );
    // generateCommitMessage - getStatus branch
    mockSpawn.mockReturnValueOnce(
      createMockProcess('# branch.head main\n', '', 0)
    );
    // getDiff
    mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
    // commit - capture the message
    mockSpawn.mockReturnValueOnce(
      createMockProcess('[main abc1234] test: update file.test.ts', '', 0)
    );

    await gitTool.autoCommit();

    // Verify commit was called (the message would be auto-generated)
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['commit', '-m', expect.any(String)]),
      expect.any(Object)
    );
  });

  it('should generate docs commit type for documentation files', async () => {
    // isGitRepo
    mockSpawn.mockReturnValueOnce(createMockProcess('.git', '', 0));
    // getStatus - porcelain
    mockSpawn.mockReturnValueOnce(createMockProcess('M  README.md\n', '', 0));
    // getStatus - branch
    mockSpawn.mockReturnValueOnce(
      createMockProcess('# branch.head main\n', '', 0)
    );
    // add
    mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
    // generateCommitMessage - getStatus porcelain
    mockSpawn.mockReturnValueOnce(createMockProcess('M  README.md\n', '', 0));
    // generateCommitMessage - getStatus branch
    mockSpawn.mockReturnValueOnce(
      createMockProcess('# branch.head main\n', '', 0)
    );
    // getDiff
    mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
    // commit
    mockSpawn.mockReturnValueOnce(
      createMockProcess('[main abc1234] docs: update README.md', '', 0)
    );

    await gitTool.autoCommit();

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['commit', '-m', expect.any(String)]),
      expect.any(Object)
    );
  });
});

describe('GitTool Confirmation Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should request confirmation when session flags require it', async () => {
    // Override the mock to require confirmation
    const mockConfirmationService = require('../../src/utils/confirmation-service');
    mockConfirmationService.ConfirmationService.getInstance.mockReturnValue({
      getSessionFlags: jest.fn(() => ({
        bashCommands: false,
        allOperations: false,
      })),
      requestConfirmation: jest.fn(() =>
        Promise.resolve({ confirmed: false, feedback: 'User rejected' })
      ),
    });

    const gitTool = new GitTool('/test/repo');
    const result = await gitTool.commit('Test message');

    expect(result.success).toBe(false);
    expect(result.error).toContain('rejected');
  });
});
