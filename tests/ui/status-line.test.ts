/**
 * Tests for StatusLineManager
 *
 * Covers constructor options, render(), token formatting, updateData(),
 * custom templates, dispose(), and the start/stop refresh cycle.
 */

// ─── Mock heavy dependencies ──────────────────────────────────────────────────

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { execSync } from 'child_process';
import {
  StatusLineManager,
  type StatusLineConfig,
  type StatusLineData,
} from '../../src/ui/status-line';

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StatusLineManager', () => {

  // ── Constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates an instance with default config when no arguments are given', () => {
      const mgr = new StatusLineManager();
      expect(mgr).toBeInstanceOf(StatusLineManager);
      expect(mgr.isEnabled()).toBe(false); // default is disabled
    });

    it('creates an enabled instance when enabled: true is supplied', () => {
      const mgr = new StatusLineManager({ enabled: true });
      expect(mgr.isEnabled()).toBe(true);
    });

    it('creates a disabled instance when enabled: false is supplied', () => {
      const mgr = new StatusLineManager({ enabled: false });
      expect(mgr.isEnabled()).toBe(false);
    });

    it('merges partial config with defaults', () => {
      const mgr = new StatusLineManager({ refreshInterval: 9999 });
      expect(mgr.getConfig().refreshInterval).toBe(9999);
      expect(mgr.getConfig().position).toBe('bottom'); // default preserved
    });

    it('respects position config option', () => {
      const mgr = new StatusLineManager({ position: 'top' });
      expect(mgr.getConfig().position).toBe('top');
    });
  });

  // ── enable() / disable() ──────────────────────────────────────────────────

  describe('enable() / disable()', () => {
    it('enable() sets isEnabled() to true', () => {
      const mgr = new StatusLineManager({ enabled: false });
      mgr.enable();
      expect(mgr.isEnabled()).toBe(true);
    });

    it('disable() sets isEnabled() to false', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.disable();
      expect(mgr.isEnabled()).toBe(false);
    });

    it('disable() stops any running refresh timer', () => {
      jest.useFakeTimers();
      const mgr = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
      mgr.startRefresh();
      expect(mgr.isRefreshing()).toBe(true);

      mgr.disable();
      expect(mgr.isRefreshing()).toBe(false);

      jest.useRealTimers();
    });
  });

  // ── render() ──────────────────────────────────────────────────────────────

  describe('render()', () => {
    it('returns empty string when disabled', () => {
      const mgr = new StatusLineManager({ enabled: false });
      expect(mgr.render()).toBe('');
    });

    it('returns non-empty string when enabled', () => {
      const mgr = new StatusLineManager({ enabled: true });
      expect(mgr.render().length).toBeGreaterThan(0);
    });

    it('renders model name from status data', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ model: 'grok-3-mini' });
      expect(mgr.render()).toContain('grok-3-mini');
    });

    it('renders git branch from status data', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ gitBranch: 'feature/my-branch' });
      expect(mgr.render()).toContain('feature/my-branch');
    });

    it('renders "no branch" when gitBranch is empty string', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ gitBranch: '' });
      expect(mgr.render()).toContain('no branch');
    });

    it('renders "unknown" model placeholder when model is not set', () => {
      const mgr = new StatusLineManager({ enabled: true });
      expect(mgr.render()).toContain('unknown');
    });

    it('renders uncommitted changes count', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ uncommittedChanges: 7 });
      expect(mgr.render()).toContain('7');
    });

    it('renders customContent directly when it is set', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ customContent: 'MY_CUSTOM_STATUS' });
      expect(mgr.render()).toBe('MY_CUSTOM_STATUS');
    });
  });

  // ── Token usage formatting ─────────────────────────────────────────────────

  describe('token usage display', () => {
    it('renders percentage with abbreviated counts (e.g. 45% (18K/40K))', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ tokenUsage: { used: 18_000, max: 40_000 } });
      const output = mgr.render();
      expect(output).toContain('45%');
      expect(output).toContain('18K');
      expect(output).toContain('40K');
    });

    it('renders 0% when used is 0', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ tokenUsage: { used: 0, max: 100_000 } });
      expect(mgr.render()).toContain('0%');
    });

    it('renders 100% when used equals max', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ tokenUsage: { used: 50_000, max: 50_000 } });
      expect(mgr.render()).toContain('100%');
    });

    it('renders 0/0 when tokenUsage is absent', () => {
      const mgr = new StatusLineManager({ enabled: true });
      expect(mgr.render()).toContain('0/0');
    });
  });

  // ── Human-readable token formatting ──────────────────────────────────────

  describe('human-readable token count formatting', () => {
    it('formats 1000 as 1K', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ tokenUsage: { used: 1_000, max: 2_000 } });
      const output = mgr.render();
      expect(output).toContain('1K');
      expect(output).toContain('2K');
    });

    it('formats 1500 as 1.5K', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ tokenUsage: { used: 1_500, max: 10_000 } });
      expect(mgr.render()).toContain('1.5K');
    });

    it('formats 1000000 as 1M', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ tokenUsage: { used: 1_000_000, max: 2_000_000 } });
      const output = mgr.render();
      expect(output).toContain('1M');
      expect(output).toContain('2M');
    });

    it('formats 1500000 as 1.5M', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ tokenUsage: { used: 1_500_000, max: 10_000_000 } });
      expect(mgr.render()).toContain('1.5M');
    });

    it('formats numbers below 1000 as plain digits', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ tokenUsage: { used: 500, max: 999 } });
      const output = mgr.render();
      expect(output).toContain('500');
      expect(output).toContain('999');
    });
  });

  // ── updateData() ──────────────────────────────────────────────────────────

  describe('updateData()', () => {
    it('merges new data with existing data', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ model: 'grok-3' });
      mgr.updateData({ gitBranch: 'main' });

      const data = mgr.getData();
      expect(data.model).toBe('grok-3');
      expect(data.gitBranch).toBe('main');
    });

    it('overwrites existing keys on conflict', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ model: 'grok-3' });
      mgr.updateData({ model: 'claude-opus-4-6' });

      expect(mgr.getData().model).toBe('claude-opus-4-6');
    });

    it('getData() returns a copy of the internal state', () => {
      const mgr = new StatusLineManager();
      mgr.updateData({ sessionId: 'abc123' });

      const data1 = mgr.getData();
      const data2 = mgr.getData();
      expect(data1).toEqual(data2);
      expect(data1).not.toBe(data2); // different references
    });
  });

  // ── Custom template ───────────────────────────────────────────────────────

  describe('render() with custom template', () => {
    it('uses a custom template string when one is configured', () => {
      const mgr = new StatusLineManager({
        enabled: true,
        template: 'Model: {{model}} | Branch: {{gitBranch}}',
      });
      mgr.updateData({ model: 'gemini-pro', gitBranch: 'develop' });
      const output = mgr.render();
      expect(output).toBe('Model: gemini-pro | Branch: develop');
    });

    it('replaces {{sessionId}} placeholder', () => {
      const mgr = new StatusLineManager({
        enabled: true,
        template: 'Session: {{sessionId}}',
      });
      mgr.updateData({ sessionId: 'sess-999' });
      expect(mgr.render()).toBe('Session: sess-999');
    });

    it('replaces {{tokenUsage}} placeholder with formatted usage', () => {
      const mgr = new StatusLineManager({
        enabled: true,
        template: 'Ctx: {{tokenUsage}}',
      });
      mgr.updateData({ tokenUsage: { used: 5_000, max: 10_000 } });
      expect(mgr.render()).toContain('50%');
    });

    it('replaces {{uncommittedChanges}} placeholder', () => {
      const mgr = new StatusLineManager({
        enabled: true,
        template: 'Changes: {{uncommittedChanges}}',
      });
      mgr.updateData({ uncommittedChanges: 3 });
      expect(mgr.render()).toBe('Changes: 3');
    });
  });

  // ── executeScript() ───────────────────────────────────────────────────────

  describe('executeScript()', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('returns empty string when no script is configured', async () => {
      const mgr = new StatusLineManager({ enabled: true });
      const result = await mgr.executeScript();
      expect(result).toBe('');
    });

    it('returns trimmed execSync output when script is configured', async () => {
      mockExecSync.mockReturnValue('  hello world  ' as unknown as string & Buffer);
      const mgr = new StatusLineManager({ enabled: true, script: 'echo hello' });
      const result = await mgr.executeScript();
      expect(result).toBe('hello world');
    });

    it('returns empty string and logs a warning when script throws', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('command not found');
      });
      const mgr = new StatusLineManager({ enabled: true, script: 'nonexistent-cmd' });
      const result = await mgr.executeScript();
      expect(result).toBe('');
    });
  });

  // ── start / stop refresh cycle ────────────────────────────────────────────

  describe('startRefresh() / stopRefresh() / isRefreshing()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('isRefreshing() returns false before startRefresh() is called', () => {
      const mgr = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
      expect(mgr.isRefreshing()).toBe(false);
    });

    it('isRefreshing() returns true after startRefresh() is called', () => {
      const mgr = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
      mgr.startRefresh();
      expect(mgr.isRefreshing()).toBe(true);
      mgr.stopRefresh();
    });

    it('isRefreshing() returns false after stopRefresh() is called', () => {
      const mgr = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
      mgr.startRefresh();
      mgr.stopRefresh();
      expect(mgr.isRefreshing()).toBe(false);
    });

    it('calling startRefresh() twice does not create a second timer', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const mgr = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
      mgr.startRefresh();
      mgr.startRefresh(); // second call should be a no-op
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      mgr.stopRefresh();
      setIntervalSpy.mockRestore();
    });

    it('tick interval respects the configured refreshInterval', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const mgr = new StatusLineManager({ enabled: true, refreshInterval: 7500 });
      mgr.startRefresh();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 7500);
      mgr.stopRefresh();
      setIntervalSpy.mockRestore();
    });
  });

  // ── dispose() ─────────────────────────────────────────────────────────────

  describe('dispose()', () => {
    it('stops the refresh timer', () => {
      jest.useFakeTimers();
      const mgr = new StatusLineManager({ enabled: true, refreshInterval: 1000 });
      mgr.startRefresh();
      expect(mgr.isRefreshing()).toBe(true);

      mgr.dispose();
      expect(mgr.isRefreshing()).toBe(false);
      jest.useRealTimers();
    });

    it('clears currentData after dispose', () => {
      const mgr = new StatusLineManager({ enabled: true });
      mgr.updateData({ model: 'grok-3', gitBranch: 'main', sessionId: 'xyz' });
      mgr.dispose();
      expect(mgr.getData()).toEqual({});
    });

    it('dispose() can be called multiple times without throwing', () => {
      const mgr = new StatusLineManager({ enabled: true });
      expect(() => {
        mgr.dispose();
        mgr.dispose();
        mgr.dispose();
      }).not.toThrow();
    });
  });

  // ── getConfig() ───────────────────────────────────────────────────────────

  describe('getConfig()', () => {
    it('returns a copy of the config (not the live object)', () => {
      const mgr = new StatusLineManager({ enabled: true });
      const cfg1 = mgr.getConfig();
      const cfg2 = mgr.getConfig();
      expect(cfg1).toEqual(cfg2);
      expect(cfg1).not.toBe(cfg2);
    });
  });
});
