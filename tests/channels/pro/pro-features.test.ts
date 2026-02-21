import { ProFeatures } from '../../../src/channels/pro/pro-features.js';
import { TextProFormatter } from '../../../src/channels/pro/text-formatter.js';
import { ScopedAuthManager } from '../../../src/channels/pro/scoped-auth.js';
import { DiffFirstManager } from '../../../src/channels/pro/diff-first.js';
import { RunTracker } from '../../../src/channels/pro/run-tracker.js';
import { RunCommands } from '../../../src/channels/pro/run-commands.js';
import { EnhancedCommands } from '../../../src/channels/pro/enhanced-commands.js';
import { CIWatcher } from '../../../src/channels/pro/ci-watcher.js';
import { ProCallbackRouter } from '../../../src/channels/pro/callback-router.js';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

describe('ProFeatures', () => {
  let pro: ProFeatures;

  afterEach(() => {
    pro?.destroy();
  });

  describe('lazy loading', () => {
    it('should create with default config', () => {
      pro = new ProFeatures();
      expect(pro).toBeDefined();
    });

    it('should lazy-load formatter as TextProFormatter by default', () => {
      pro = new ProFeatures();
      expect(pro.formatter).toBeInstanceOf(TextProFormatter);
    });

    it('should use custom formatter when provided', () => {
      const customFormatter = {
        formatDiffMessage: jest.fn(),
        formatFullDiff: jest.fn(),
        formatPlanMessage: jest.fn(),
        formatRunsList: jest.fn(),
        formatRunTimeline: jest.fn(),
        formatRunDetail: jest.fn(),
        formatCIAlert: jest.fn(),
        formatRepoInfo: jest.fn(),
        formatBranchInfo: jest.fn(),
        formatPRInfo: jest.fn(),
        formatPRList: jest.fn(),
        getCommandList: jest.fn().mockReturnValue([]),
      };
      pro = new ProFeatures({ formatter: customFormatter });
      expect(pro.formatter).toBe(customFormatter);
    });

    it('should lazy-load scopedAuth', () => {
      pro = new ProFeatures({ adminUsers: ['admin1'] });
      expect(pro.scopedAuth).toBeInstanceOf(ScopedAuthManager);
    });

    it('should lazy-load diffFirst', () => {
      pro = new ProFeatures();
      expect(pro.diffFirst).toBeInstanceOf(DiffFirstManager);
    });

    it('should lazy-load runTracker', () => {
      pro = new ProFeatures();
      expect(pro.runTracker).toBeInstanceOf(RunTracker);
    });

    it('should lazy-load runCommands', () => {
      pro = new ProFeatures();
      expect(pro.runCommands).toBeInstanceOf(RunCommands);
    });

    it('should lazy-load enhancedCommands', () => {
      pro = new ProFeatures();
      expect(pro.enhancedCommands).toBeInstanceOf(EnhancedCommands);
    });

    it('should lazy-load ciWatcher', () => {
      pro = new ProFeatures();
      expect(pro.ciWatcher).toBeInstanceOf(CIWatcher);
    });

    it('should lazy-load callbackRouter', () => {
      pro = new ProFeatures();
      expect(pro.callbackRouter).toBeInstanceOf(ProCallbackRouter);
    });

    it('should return same instance on repeated access', () => {
      pro = new ProFeatures();
      const formatter1 = pro.formatter;
      const formatter2 = pro.formatter;
      expect(formatter1).toBe(formatter2);

      const auth1 = pro.scopedAuth;
      const auth2 = pro.scopedAuth;
      expect(auth1).toBe(auth2);

      const diff1 = pro.diffFirst;
      const diff2 = pro.diffFirst;
      expect(diff1).toBe(diff2);
    });
  });

  describe('routeCommand', () => {
    let sendFn: jest.Mock;

    beforeEach(() => {
      sendFn = jest.fn().mockResolvedValue(undefined);
    });

    it('should route /task command with description', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCommand('task', ['Fix', 'the', 'bug'], 'chat1', 'user1', sendFn);
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Task created: Fix the bug');
    });

    it('should route /task with empty args and show usage', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCommand('task', [], 'chat1', 'user1', sendFn);
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Usage: /task <description>');
    });

    it('should return false for unknown commands', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCommand('unknown', [], 'chat1', 'user1', sendFn);
      expect(handled).toBe(false);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it('should return false when enhancedCommands disabled', async () => {
      pro = new ProFeatures({ enhancedCommands: false });
      const handled = await pro.routeCommand('task', ['test'], 'chat1', 'user1', sendFn);
      expect(handled).toBe(false);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it('should route /yolo command with auth manager', async () => {
      pro = new ProFeatures({ adminUsers: ['admin1'] });
      jest.useFakeTimers();
      // Force scopedAuth init before enhancedCommands reads the private field
      void pro.scopedAuth;
      const handled = await pro.routeCommand('yolo', ['5'], 'chat1', 'user1', sendFn);
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', expect.stringContaining('5'));
      jest.useRealTimers();
    });

    it('should route /yolo command without auth manager', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCommand('yolo', ['5'], 'chat1', 'user1', sendFn);
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Auth manager not configured.');
    });

    it('should route /runs command with empty list', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCommand('runs', [], 'chat1', 'user1', sendFn);
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'No runs recorded yet.', undefined);
    });

    it('should route /run command with usage message when no id', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCommand('run', [], 'chat1', 'user1', sendFn);
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Usage: /run <id>');
    });

    it('should route /run with unknown id and show not found', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCommand('run', ['nonexistent'], 'chat1', 'user1', sendFn);
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Run not found: nonexistent');
    });

    it('should route /pins command with empty list', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCommand('pins', [], 'chat1', 'user1', sendFn);
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'No pinned context.');
    });
  });

  describe('routeCallback', () => {
    let sendFn: jest.Mock;

    beforeEach(() => {
      sendFn = jest.fn().mockResolvedValue(undefined);
    });

    it('should route diff cancel callback', async () => {
      pro = new ProFeatures();
      // Create a pending diff to route against
      const diff = pro.diffFirst.createPendingDiff('chat1', 'user1', 1, [{
        path: 'test.ts',
        action: 'modify',
        linesAdded: 1,
        linesRemoved: 0,
        excerpt: '+test',
      }]);

      const handled = await pro.routeCallback(
        `pro:diff:cancel:${diff.id}`,
        'user1',
        'chat1',
        sendFn
      );
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Changes cancelled.');
    });

    it('should route legacy telegram callback format', async () => {
      pro = new ProFeatures();
      const diff = pro.diffFirst.createPendingDiff('chat1', 'user1', 1, [{
        path: 'test.ts',
        action: 'modify',
        linesAdded: 1,
        linesRemoved: 0,
        excerpt: '+test',
      }]);

      const handled = await pro.routeCallback(
        `dc_${diff.id}`,
        'user1',
        'chat1',
        sendFn
      );
      expect(handled).toBe(true);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Changes cancelled.');
    });

    it('should return false for unrecognized callback', async () => {
      pro = new ProFeatures();
      const handled = await pro.routeCallback('unknown_data', 'user1', 'chat1', sendFn);
      expect(handled).toBe(false);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it('should pass emitTask to callback router', async () => {
      pro = new ProFeatures();
      const emitTask = jest.fn();
      const handled = await pro.routeCallback('unknown', 'user1', 'chat1', sendFn, emitTask);
      expect(handled).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should stop ciWatcher when it was started', () => {
      pro = new ProFeatures();
      // Force lazy init and start
      pro.ciWatcher.start();
      expect(pro.ciWatcher.isRunning()).toBe(true);

      pro.destroy();
      expect(pro.ciWatcher.isRunning()).toBe(false);
    });

    it('should be safe to call destroy without lazy-loaded modules', () => {
      pro = new ProFeatures();
      // Don't access any getters - destroy should not throw
      expect(() => pro.destroy()).not.toThrow();
    });

    it('should be safe to call destroy multiple times', () => {
      pro = new ProFeatures();
      pro.ciWatcher.start();
      pro.destroy();
      expect(() => pro.destroy()).not.toThrow();
    });
  });
});
