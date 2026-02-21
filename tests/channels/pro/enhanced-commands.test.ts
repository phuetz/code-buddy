import { EnhancedCommands } from '../../../src/channels/pro/enhanced-commands.js';
import { execSync } from 'child_process';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

interface MockAuthManager {
  grantTemporaryFullAccess: jest.Mock;
  revokeTemporaryAccess: jest.Mock;
}

function createMockAuthManager(): MockAuthManager {
  return {
    grantTemporaryFullAccess: jest.fn(),
    revokeTemporaryAccess: jest.fn(),
  };
}

describe('EnhancedCommands', () => {
  let commands: EnhancedCommands;
  let mockAuth: MockAuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAuth = createMockAuthManager();
    commands = new EnhancedCommands(mockAuth as any);
  });

  afterEach(() => {
    commands.destroy();
    jest.useRealTimers();
  });

  describe('handleRepo', () => {
    it('should return structured repo info from git commands', () => {
      mockExecSync
        .mockReturnValueOnce('https://github.com/user/repo.git')  // remote
        .mockReturnValueOnce('main')                                // branch
        .mockReturnValueOnce('42')                                  // commit count
        .mockReturnValueOnce('abc1234 Initial commit')              // last commit
        .mockReturnValueOnce('abc1234 Initial commit (2 days ago)') // recent commits
        .mockReturnValueOnce('5');                                  // pr count

      const result = commands.handleRepo('chat1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.remote).toBe('https://github.com/user/repo.git');
        expect(result.data.branch).toBe('main');
        expect(result.data.commitCount).toBe('42');
        expect(result.data.lastCommit).toBe('abc1234 Initial commit');
        expect(result.data.recentCommits).toContain('abc1234');
      }
    });

    it('should handle git errors gracefully', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repository');
      });

      const result = commands.handleRepo('chat1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Failed to get repo info');
        expect(result.error).toContain('not a git repository');
      }
    });
  });

  describe('handleBranch', () => {
    it('should return structured branch info', () => {
      mockExecSync
        .mockReturnValueOnce('feature-branch')  // current branch
        .mockReturnValueOnce('')                 // rev-parse --verify main
        .mockReturnValueOnce(' 3 files changed, 20 insertions(+), 5 deletions(-)') // diff stat
        .mockReturnValueOnce('2')                // commits behind
        .mockReturnValueOnce('5');               // commits ahead

      const result = commands.handleBranch('chat1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.branch).toBe('feature-branch');
        expect(result.data.diffStat).toContain('3 files changed');
        expect(result.data.commitsAhead).toBe('5');
        expect(result.data.commitsBehind).toBe('2');
      }
    });

    it('should use provided branch name', () => {
      mockExecSync
        .mockReturnValueOnce('')   // rev-parse --verify main
        .mockReturnValueOnce('1 file changed') // diff stat
        .mockReturnValueOnce('0')  // behind
        .mockReturnValueOnce('1'); // ahead

      const result = commands.handleBranch('chat1', 'my-branch');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.branch).toBe('my-branch');
      }
    });

    it('should handle errors gracefully', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('bad revision');
      });

      const result = commands.handleBranch('chat1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Failed to get branch info');
      }
    });
  });

  describe('handlePR', () => {
    it('should list open PRs when no number given', () => {
      const prs = [
        { number: 1, title: 'Fix bug', author: { login: 'alice' }, updatedAt: '2024-01-01' },
        { number: 2, title: 'Add feature', author: { login: 'bob' }, updatedAt: '2024-01-02' },
      ];
      mockExecSync.mockReturnValueOnce(JSON.stringify(prs));

      const result = commands.handlePR('chat1');

      expect(result.success).toBe(true);
      if (result.success && 'list' in result) {
        expect(result.list).toHaveLength(2);
        expect(result.list[0].number).toBe(1);
        expect(result.list[0].title).toBe('Fix bug');
        expect(result.list[0].author).toBe('alice');
        expect(result.list[1].number).toBe(2);
        expect(result.list[1].author).toBe('bob');
      }
    });

    it('should show specific PR details as structured data', () => {
      const pr = {
        title: 'Fix critical bug',
        state: 'OPEN',
        author: { login: 'alice' },
        body: 'This fixes the crash on startup',
        url: 'https://github.com/user/repo/pull/42',
        additions: 10,
        deletions: 3,
        changedFiles: 2,
      };
      mockExecSync.mockReturnValueOnce(JSON.stringify(pr));

      const result = commands.handlePR('chat1', '42');

      expect(result.success).toBe(true);
      if (result.success && 'data' in result) {
        expect(result.data.number).toBe('42');
        expect(result.data.title).toBe('Fix critical bug');
        expect(result.data.state).toBe('OPEN');
        expect(result.data.author).toBe('alice');
        expect(result.data.additions).toBe(10);
        expect(result.data.deletions).toBe(3);
        expect(result.data.changedFiles).toBe(2);
        expect(result.data.body).toBe('This fixes the crash on startup');
        expect(result.data.url).toBe('https://github.com/user/repo/pull/42');
      }
    });

    it('should handle gh CLI errors', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('gh: command not found');
      });

      const result = commands.handlePR('chat1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Failed to get PR info');
      }
    });
  });

  describe('handleTask', () => {
    it('should return task text and objective', () => {
      const result = commands.handleTask('chat1', 'user1', 'Fix the login page');

      expect(result.text).toBe('Task created: Fix the login page');
      expect(result.objective).toBe('Fix the login page');
    });
  });

  describe('handleYolo', () => {
    it('should grant temporary full access via authManager', () => {
      const result = commands.handleYolo('chat1', 'user1', '15');

      expect(result.text).toContain('YOLO mode activated for 15 minutes');
      expect(result.text).toContain('Full access granted');
      expect(mockAuth.grantTemporaryFullAccess).toHaveBeenCalledWith(
        'user1',
        15 * 60 * 1000,
        'user1'
      );
    });

    it('should default to 10 minutes when no duration given', () => {
      commands.handleYolo('chat1', 'user1');

      expect(mockAuth.grantTemporaryFullAccess).toHaveBeenCalledWith(
        'user1',
        10 * 60 * 1000,
        'user1'
      );
    });

    it('should reject minutes below 1', () => {
      const result = commands.handleYolo('chat1', 'user1', '0');

      expect(result.text).toBe('YOLO duration must be 1-60 minutes.');
      expect(mockAuth.grantTemporaryFullAccess).not.toHaveBeenCalled();
    });

    it('should reject minutes above 60', () => {
      const result = commands.handleYolo('chat1', 'user1', '120');

      expect(result.text).toBe('YOLO duration must be 1-60 minutes.');
      expect(mockAuth.grantTemporaryFullAccess).not.toHaveBeenCalled();
    });

    it('should reject non-numeric input', () => {
      const result = commands.handleYolo('chat1', 'user1', 'abc');

      expect(result.text).toBe('YOLO duration must be 1-60 minutes.');
    });

    it('should return error when no authManager configured', () => {
      const noAuth = new EnhancedCommands();
      const result = noAuth.handleYolo('chat1', 'user1', '5');

      expect(result.text).toBe('Auth manager not configured.');
      noAuth.destroy();
    });

    it('should auto-revoke access after timer expires', () => {
      commands.handleYolo('chat1', 'user1', '5');

      expect(mockAuth.revokeTemporaryAccess).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5 * 60 * 1000);

      expect(mockAuth.revokeTemporaryAccess).toHaveBeenCalledWith('user1');
    });

    it('should clear previous timer when yolo called again', () => {
      commands.handleYolo('chat1', 'user1', '10');
      commands.handleYolo('chat1', 'user1', '5');

      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(mockAuth.revokeTemporaryAccess).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(mockAuth.revokeTemporaryAccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('handlePinContext', () => {
    it('should create and store a pin', () => {
      const pin = commands.handlePinContext('chat1', 'user1', 'important note', ['tag1']);

      expect(pin.id).toMatch(/^pin_/);
      expect(pin.content).toBe('important note');
      expect(pin.pinnedBy).toBe('user1');
      expect(pin.chatId).toBe('chat1');
      expect(pin.tags).toEqual(['tag1']);
      expect(pin.timestamp).toBeGreaterThan(0);
    });

    it('should default tags to empty array', () => {
      const pin = commands.handlePinContext('chat1', 'user1', 'note');

      expect(pin.tags).toEqual([]);
    });
  });

  describe('getPins', () => {
    it('should filter pins by chatId', () => {
      commands.handlePinContext('chat1', 'user1', 'note A');
      jest.advanceTimersByTime(1);
      commands.handlePinContext('chat2', 'user1', 'note B');
      jest.advanceTimersByTime(1);
      commands.handlePinContext('chat1', 'user1', 'note C');

      const pins = commands.getPins('chat1');

      expect(pins).toHaveLength(2);
      expect(pins.every((p) => p.chatId === 'chat1')).toBe(true);
    });

    it('should return pins sorted by timestamp descending', () => {
      commands.handlePinContext('chat1', 'user1', 'first');
      jest.advanceTimersByTime(1);
      commands.handlePinContext('chat1', 'user1', 'second');

      const pins = commands.getPins('chat1');

      expect(pins[0].content).toBe('second');
      expect(pins[1].content).toBe('first');
    });

    it('should return empty array for unknown chatId', () => {
      expect(commands.getPins('unknown')).toEqual([]);
    });
  });

  describe('removePin', () => {
    it('should remove an existing pin and return true', () => {
      const pin = commands.handlePinContext('chat1', 'user1', 'to remove');

      expect(commands.removePin(pin.id)).toBe(true);
      expect(commands.getPins('chat1')).toHaveLength(0);
    });

    it('should return false for non-existent pin', () => {
      expect(commands.removePin('pin_nonexistent')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should clear all yolo timers', () => {
      commands.handleYolo('chat1', 'user1', '10');
      commands.handleYolo('chat1', 'user2', '20');

      commands.destroy();

      jest.advanceTimersByTime(20 * 60 * 1000);
      expect(mockAuth.revokeTemporaryAccess).not.toHaveBeenCalled();
    });
  });
});
