import { parseCallbackData, ProCallbackRouter } from '../../../src/channels/pro/callback-router.js';

describe('parseCallbackData', () => {
  describe('new format (pro:feature:action:id)', () => {
    it('should parse diff apply', () => {
      const result = parseCallbackData('pro:diff:apply:abc123');
      expect(result).toEqual({ feature: 'diff', action: 'apply', id: 'abc123' });
    });

    it('should parse diff cancel', () => {
      const result = parseCallbackData('pro:diff:cancel:def456');
      expect(result).toEqual({ feature: 'diff', action: 'cancel', id: 'def456' });
    });

    it('should parse diff view', () => {
      const result = parseCallbackData('pro:diff:view:abc');
      expect(result).toEqual({ feature: 'diff', action: 'view', id: 'abc' });
    });

    it('should parse run detail', () => {
      const result = parseCallbackData('pro:run:detail:run_abc123');
      expect(result).toEqual({ feature: 'run', action: 'detail', id: 'run_abc123' });
    });

    it('should parse run rerun', () => {
      const result = parseCallbackData('pro:run:rerun:run_abc123');
      expect(result).toEqual({ feature: 'run', action: 'rerun', id: 'run_abc123' });
    });

    it('should parse ci fix', () => {
      const result = parseCallbackData('pro:ci:fix:gh_abc123');
      expect(result).toEqual({ feature: 'ci', action: 'fix', id: 'gh_abc123' });
    });

    it('should parse ci mute', () => {
      const result = parseCallbackData('pro:ci:mute:gh_abc123');
      expect(result).toEqual({ feature: 'ci', action: 'mute', id: 'gh_abc123' });
    });

    it('should parse plan approve', () => {
      const result = parseCallbackData('pro:plan:approve:lk2m3n4');
      expect(result).toEqual({ feature: 'plan', action: 'approve', id: 'lk2m3n4' });
    });

    it('should parse pr merge', () => {
      const result = parseCallbackData('pro:pr:merge:42');
      expect(result).toEqual({ feature: 'pr', action: 'merge', id: '42' });
    });

    it('should handle ids with colons', () => {
      const result = parseCallbackData('pro:diff:apply:id:with:colons');
      expect(result).toEqual({ feature: 'diff', action: 'apply', id: 'id:with:colons' });
    });

    it('should return null for malformed pro: format', () => {
      expect(parseCallbackData('pro:diff')).toBeNull();
      expect(parseCallbackData('pro:')).toBeNull();
    });
  });

  describe('legacy Telegram format', () => {
    it('should parse da_ (diff apply)', () => {
      expect(parseCallbackData('da_abc123')).toEqual({ feature: 'diff', action: 'apply', id: 'abc123' });
    });

    it('should parse dc_ (diff cancel)', () => {
      expect(parseCallbackData('dc_abc123')).toEqual({ feature: 'diff', action: 'cancel', id: 'abc123' });
    });

    it('should parse dv_ (diff view)', () => {
      expect(parseCallbackData('dv_abc123')).toEqual({ feature: 'diff', action: 'view', id: 'abc123' });
    });

    it('should parse rd_ (run detail)', () => {
      expect(parseCallbackData('rd_run123')).toEqual({ feature: 'run', action: 'detail', id: 'run123' });
    });

    it('should parse rr_ (run rerun)', () => {
      expect(parseCallbackData('rr_run123')).toEqual({ feature: 'run', action: 'rerun', id: 'run123' });
    });

    it('should parse rt_ (run tests)', () => {
      expect(parseCallbackData('rt_run123')).toEqual({ feature: 'run', action: 'tests', id: 'run123' });
    });

    it('should parse rb_ (run rollback)', () => {
      expect(parseCallbackData('rb_run123')).toEqual({ feature: 'run', action: 'rollback', id: 'run123' });
    });

    it('should parse cf_ (ci fix)', () => {
      expect(parseCallbackData('cf_evt123')).toEqual({ feature: 'ci', action: 'fix', id: 'evt123' });
    });

    it('should parse cm_ (ci mute)', () => {
      expect(parseCallbackData('cm_evt123')).toEqual({ feature: 'ci', action: 'mute', id: 'evt123' });
    });

    it('should parse pm_ (pr merge)', () => {
      expect(parseCallbackData('pm_42')).toEqual({ feature: 'pr', action: 'merge', id: '42' });
    });

    it('should parse pv_ (pr review)', () => {
      expect(parseCallbackData('pv_42')).toEqual({ feature: 'pr', action: 'review', id: '42' });
    });

    it('should parse pa_ (plan approve)', () => {
      expect(parseCallbackData('pa_abc')).toEqual({ feature: 'plan', action: 'approve', id: 'abc' });
    });

    it('should parse pr_ (plan reject)', () => {
      expect(parseCallbackData('pr_abc')).toEqual({ feature: 'plan', action: 'reject', id: 'abc' });
    });
  });

  describe('pin callback', () => {
    it('should parse pin_ prefix', () => {
      expect(parseCallbackData('pin_abc123')).toEqual({ feature: 'pin', action: 'create', id: 'abc123' });
    });
  });

  describe('unrecognized data', () => {
    it('should return null for unknown format', () => {
      expect(parseCallbackData('unknown_data')).toBeNull();
      expect(parseCallbackData('')).toBeNull();
      expect(parseCallbackData('xyz')).toBeNull();
    });
  });
});

describe('ProCallbackRouter', () => {
  let router: ProCallbackRouter;
  let sendFn: jest.Mock;
  let emitTask: jest.Mock;
  let mockDiffFirst: any;
  let mockRunCommands: any;
  let mockCIWatcher: any;
  let mockEnhancedCommands: any;
  let mockFormatter: any;

  beforeEach(() => {
    sendFn = jest.fn().mockResolvedValue(undefined);
    emitTask = jest.fn();

    mockDiffFirst = {
      handleApply: jest.fn().mockResolvedValue({ success: true, filesApplied: 2 }),
      handleCancel: jest.fn().mockResolvedValue({ success: true }),
      handleViewFull: jest.fn().mockReturnValue('full diff content'),
    };

    mockRunCommands = {
      handleRunDetail: jest.fn().mockReturnValue({
        run: { id: 'run_1', objective: 'test' },
        testSteps: [],
        commitRefs: [],
      }),
      handleRerun: jest.fn().mockResolvedValue({ text: 'Re-running', objective: 'test task' }),
      handleRerunTests: jest.fn().mockResolvedValue({ text: 'Running tests', commands: ['npm test'] }),
      handleRollback: jest.fn().mockResolvedValue({ text: 'Rolling back' }),
    };

    mockCIWatcher = {
      handleFixIt: jest.fn().mockResolvedValue({ text: 'Fixing...', objective: 'Fix CI' }),
      handleMute: jest.fn().mockReturnValue({ text: 'Muted' }),
    };

    mockEnhancedCommands = {
      handlePinContext: jest.fn().mockReturnValue({ id: 'pin_abc' }),
    };

    mockFormatter = {
      formatRunDetail: jest.fn().mockReturnValue({ text: 'run detail', buttons: [] }),
    };

    router = new ProCallbackRouter(
      mockDiffFirst,
      mockRunCommands,
      mockCIWatcher,
      mockEnhancedCommands,
      mockFormatter,
    );
  });

  describe('diff callbacks', () => {
    it('should route diff apply callbacks', async () => {
      const handled = await router.route('pro:diff:apply:abc123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockDiffFirst.handleApply).toHaveBeenCalledWith('abc123', 'user1');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Applied 2 file(s) successfully.');
    });

    it('should send error message when diff apply fails', async () => {
      mockDiffFirst.handleApply.mockResolvedValue({ success: false, error: 'expired' });
      await router.route('pro:diff:apply:abc123', 'user1', 'chat1', sendFn);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Failed to apply: expired');
    });

    it('should route diff cancel callbacks', async () => {
      const handled = await router.route('pro:diff:cancel:abc123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockDiffFirst.handleCancel).toHaveBeenCalledWith('abc123', 'user1');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Changes cancelled.');
    });

    it('should send error message when diff cancel fails', async () => {
      mockDiffFirst.handleCancel.mockResolvedValue({ success: false, error: 'not found' });
      await router.route('pro:diff:cancel:abc123', 'user1', 'chat1', sendFn);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Failed: not found');
    });

    it('should route diff view callbacks', async () => {
      const handled = await router.route('pro:diff:view:abc123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockDiffFirst.handleViewFull).toHaveBeenCalledWith('abc123');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'full diff content');
    });

    it('should send fallback when diff view returns null', async () => {
      mockDiffFirst.handleViewFull.mockReturnValue(null);
      await router.route('pro:diff:view:abc123', 'user1', 'chat1', sendFn);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Diff not found.');
    });

    it('should return false for unknown diff action', async () => {
      const handled = await router.route('pro:diff:unknown:abc123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(false);
    });
  });

  describe('run callbacks', () => {
    it('should route run detail callbacks', async () => {
      const handled = await router.route('pro:run:detail:run_1', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockRunCommands.handleRunDetail).toHaveBeenCalledWith('chat1', 'run_1');
      expect(mockFormatter.formatRunDetail).toHaveBeenCalled();
      expect(sendFn).toHaveBeenCalledWith('chat1', 'run detail', []);
    });

    it('should handle run detail when run not found', async () => {
      mockRunCommands.handleRunDetail.mockReturnValue(null);
      const handled = await router.route('pro:run:detail:run_1', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockFormatter.formatRunDetail).not.toHaveBeenCalled();
    });

    it('should route run rerun callbacks and emit task', async () => {
      const handled = await router.route('pro:run:rerun:run_1', 'user1', 'chat1', sendFn, emitTask);
      expect(handled).toBe(true);
      expect(mockRunCommands.handleRerun).toHaveBeenCalledWith('run_1', 'user1', 'chat1');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Re-running');
      expect(emitTask).toHaveBeenCalledWith('chat1', 'user1', 'test task');
    });

    it('should not emit task when rerun has no objective', async () => {
      mockRunCommands.handleRerun.mockResolvedValue({ text: 'Re-running' });
      await router.route('pro:run:rerun:run_1', 'user1', 'chat1', sendFn, emitTask);
      expect(emitTask).not.toHaveBeenCalled();
    });

    it('should not emit task when emitTask is not provided', async () => {
      await router.route('pro:run:rerun:run_1', 'user1', 'chat1', sendFn);
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Re-running');
    });

    it('should route run tests callbacks', async () => {
      const handled = await router.route('pro:run:tests:run_1', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockRunCommands.handleRerunTests).toHaveBeenCalledWith('run_1', 'user1', 'chat1');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Running tests');
    });

    it('should route run rollback callbacks', async () => {
      const handled = await router.route('pro:run:rollback:run_1', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockRunCommands.handleRollback).toHaveBeenCalledWith('run_1', 'user1', 'chat1');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Rolling back');
    });

    it('should return false for unknown run action', async () => {
      const handled = await router.route('pro:run:unknown:run_1', 'user1', 'chat1', sendFn);
      expect(handled).toBe(false);
    });
  });

  describe('ci callbacks', () => {
    it('should route ci fix callbacks and emit task', async () => {
      const handled = await router.route('pro:ci:fix:evt123', 'user1', 'chat1', sendFn, emitTask);
      expect(handled).toBe(true);
      expect(mockCIWatcher.handleFixIt).toHaveBeenCalledWith('evt123', 'user1', 'chat1');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Fixing...');
      expect(emitTask).toHaveBeenCalledWith('chat1', 'user1', 'Fix CI');
    });

    it('should not emit task when ci fix has no objective', async () => {
      mockCIWatcher.handleFixIt.mockResolvedValue({ text: 'Fixing...' });
      await router.route('pro:ci:fix:evt123', 'user1', 'chat1', sendFn, emitTask);
      expect(emitTask).not.toHaveBeenCalled();
    });

    it('should route ci mute callbacks', async () => {
      const handled = await router.route('pro:ci:mute:evt123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockCIWatcher.handleMute).toHaveBeenCalledWith('evt123');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Muted');
    });

    it('should return false for unknown ci action', async () => {
      const handled = await router.route('pro:ci:unknown:evt123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(false);
    });
  });

  describe('pin callbacks', () => {
    it('should route pin callbacks', async () => {
      const handled = await router.route('pin_some-content', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockEnhancedCommands.handlePinContext).toHaveBeenCalledWith('chat1', 'user1', 'some-content');
      expect(sendFn).toHaveBeenCalledWith('chat1', 'Pinned: pin_abc');
    });
  });

  describe('legacy Telegram callbacks', () => {
    it('should route legacy da_ callbacks to diff apply', async () => {
      const handled = await router.route('da_abc123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockDiffFirst.handleApply).toHaveBeenCalledWith('abc123', 'user1');
    });

    it('should route legacy dc_ callbacks to diff cancel', async () => {
      const handled = await router.route('dc_abc123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockDiffFirst.handleCancel).toHaveBeenCalledWith('abc123', 'user1');
    });

    it('should route legacy rr_ callbacks to run rerun', async () => {
      const handled = await router.route('rr_run_1', 'user1', 'chat1', sendFn, emitTask);
      expect(handled).toBe(true);
      expect(mockRunCommands.handleRerun).toHaveBeenCalledWith('run_1', 'user1', 'chat1');
    });

    it('should route legacy cf_ callbacks to ci fix', async () => {
      const handled = await router.route('cf_evt123', 'user1', 'chat1', sendFn, emitTask);
      expect(handled).toBe(true);
      expect(mockCIWatcher.handleFixIt).toHaveBeenCalledWith('evt123', 'user1', 'chat1');
    });

    it('should route legacy cm_ callbacks to ci mute', async () => {
      const handled = await router.route('cm_evt123', 'user1', 'chat1', sendFn);
      expect(handled).toBe(true);
      expect(mockCIWatcher.handleMute).toHaveBeenCalledWith('evt123');
    });
  });

  describe('unrecognized callbacks', () => {
    it('should return false for unrecognized data', async () => {
      const handled = await router.route('unknown_data', 'user1', 'chat1', sendFn);
      expect(handled).toBe(false);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it('should return false for unsupported features like plan and pr', async () => {
      const handled = await router.route('pro:plan:approve:abc', 'user1', 'chat1', sendFn);
      expect(handled).toBe(false);
    });
  });
});
