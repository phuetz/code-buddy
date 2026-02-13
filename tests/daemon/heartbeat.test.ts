import { HeartbeatEngine, resetHeartbeatEngine, getHeartbeatEngine } from '../../src/daemon/heartbeat.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Shared mock agent review function
const mockAgentReview = jest.fn<Promise<string>, [string]>().mockResolvedValue('HEARTBEAT_OK');

describe('HeartbeatEngine', () => {
  let engine: HeartbeatEngine;
  let tmpDir: string;
  let heartbeatFilePath: string;

  beforeEach(async () => {
    resetHeartbeatEngine();
    mockAgentReview.mockClear();
    mockAgentReview.mockResolvedValue('HEARTBEAT_OK');

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heartbeat-test-'));
    heartbeatFilePath = path.join(tmpDir, 'HEARTBEAT.md');
    await fs.writeFile(heartbeatFilePath, '# Test Checklist\n- [ ] Check something');

    engine = new HeartbeatEngine({
      intervalMs: 60000,
      heartbeatFilePath,
      activeHoursStart: 0,
      activeHoursEnd: 24,
      enabled: true,
      agentReviewFn: mockAgentReview,
    });
  });

  afterEach(async () => {
    engine.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Config defaults
  // ==========================================================================

  describe('config defaults', () => {
    it('should use default config values', () => {
      const defaultEngine = new HeartbeatEngine();
      const config = defaultEngine.getConfig();

      expect(config.intervalMs).toBe(30 * 60 * 1000);
      expect(config.activeHoursStart).toBe(8);
      expect(config.activeHoursEnd).toBe(22);
      expect(config.suppressionKeyword).toBe('HEARTBEAT_OK');
      expect(config.maxConsecutiveSuppressions).toBe(5);
      expect(config.enabled).toBe(true);
      defaultEngine.stop();
    });

    it('should merge partial config with defaults', () => {
      const customEngine = new HeartbeatEngine({
        intervalMs: 10000,
        activeHoursStart: 6,
      });
      const config = customEngine.getConfig();

      expect(config.intervalMs).toBe(10000);
      expect(config.activeHoursStart).toBe(6);
      expect(config.activeHoursEnd).toBe(22); // default preserved
      expect(config.suppressionKeyword).toBe('HEARTBEAT_OK'); // default preserved
      customEngine.stop();
    });

    it('should allow config updates', () => {
      engine.updateConfig({ intervalMs: 5000 });
      expect(engine.getConfig().intervalMs).toBe(5000);
    });
  });

  // ==========================================================================
  // Active hours filtering
  // ==========================================================================

  describe('active hours filtering', () => {
    it('should allow times within active hours', () => {
      // 10 AM should be within 0-24
      const morning = new Date('2026-01-15T10:00:00');
      expect(engine.isWithinActiveHours(morning)).toBe(true);
    });

    it('should reject times before active hours start', () => {
      const earlyEngine = new HeartbeatEngine({
        activeHoursStart: 8,
        activeHoursEnd: 22,
        timezone: 'UTC',
      });

      // 5 AM UTC should be outside 8-22
      const early = new Date('2026-01-15T05:00:00Z');
      expect(earlyEngine.isWithinActiveHours(early)).toBe(false);
      earlyEngine.stop();
    });

    it('should reject times after active hours end', () => {
      const lateEngine = new HeartbeatEngine({
        activeHoursStart: 8,
        activeHoursEnd: 22,
        timezone: 'UTC',
      });

      // 23:00 UTC should be outside 8-22
      const late = new Date('2026-01-15T23:00:00Z');
      expect(lateEngine.isWithinActiveHours(late)).toBe(false);
      lateEngine.stop();
    });

    it('should handle wrap-around active hours (e.g., 22-6)', () => {
      const nightEngine = new HeartbeatEngine({
        activeHoursStart: 22,
        activeHoursEnd: 6,
        timezone: 'UTC',
      });

      // 23:00 should be within 22-6
      const lateNight = new Date('2026-01-15T23:00:00Z');
      expect(nightEngine.isWithinActiveHours(lateNight)).toBe(true);

      // 3:00 should be within 22-6
      const earlyMorning = new Date('2026-01-15T03:00:00Z');
      expect(nightEngine.isWithinActiveHours(earlyMorning)).toBe(true);

      // 12:00 should be outside 22-6
      const midday = new Date('2026-01-15T12:00:00Z');
      expect(nightEngine.isWithinActiveHours(midday)).toBe(false);

      nightEngine.stop();
    });

    it('should skip tick when outside active hours', async () => {
      const outsideHoursEngine = new HeartbeatEngine({
        activeHoursStart: 0,
        activeHoursEnd: 0, // No active hours (start === end means never active in non-wrap mode)
        heartbeatFilePath,
        timezone: 'UTC',
        agentReviewFn: mockAgentReview,
      });

      const result = await outsideHoursEngine.tick();
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('outside_active_hours');
      outsideHoursEngine.stop();
    });
  });

  // ==========================================================================
  // Suppression counting
  // ==========================================================================

  describe('suppression counting', () => {
    it('should increment consecutive suppressions when agent responds with HEARTBEAT_OK', async () => {
      const result = await engine.tick();

      expect(result.suppressed).toBe(true);
      expect(result.skipped).toBe(false);

      const status = engine.getStatus();
      expect(status.consecutiveSuppressions).toBe(1);
      expect(status.totalSuppressions).toBe(1);
    });

    it('should reset consecutive suppressions when agent finds issues', async () => {
      // First: get a suppression
      await engine.tick();
      expect(engine.getStatus().consecutiveSuppressions).toBe(1);

      // Change the mock to return a non-suppression response
      mockAgentReview.mockResolvedValue('WARNING: Tests are failing!');

      const result = await engine.tick();
      expect(result.suppressed).toBe(false);
      expect(engine.getStatus().consecutiveSuppressions).toBe(0);

      // Restore default mock
      mockAgentReview.mockResolvedValue('HEARTBEAT_OK');
    });

    it('should reset counter and emit event at max consecutive suppressions', async () => {
      const smallLimitEngine = new HeartbeatEngine({
        heartbeatFilePath,
        maxConsecutiveSuppressions: 3,
        activeHoursStart: 0,
        activeHoursEnd: 24,
        agentReviewFn: mockAgentReview,
      });

      const suppressionLimitEvents: unknown[] = [];
      smallLimitEngine.on('heartbeat:suppression-limit', (data) => {
        suppressionLimitEvents.push(data);
      });

      // Run 3 ticks to hit the suppression limit
      await smallLimitEngine.tick();
      await smallLimitEngine.tick();
      await smallLimitEngine.tick();

      // The counter should have been reset on the 3rd tick
      expect(smallLimitEngine.getStatus().consecutiveSuppressions).toBe(0);
      expect(smallLimitEngine.getStatus().totalSuppressions).toBe(3);
      expect(suppressionLimitEvents.length).toBe(1);

      smallLimitEngine.stop();
    });

    it('should track total suppressions across resets', async () => {
      const smallLimitEngine = new HeartbeatEngine({
        heartbeatFilePath,
        maxConsecutiveSuppressions: 2,
        activeHoursStart: 0,
        activeHoursEnd: 24,
        agentReviewFn: mockAgentReview,
      });

      // Run 4 ticks (two full cycles of suppression limit)
      await smallLimitEngine.tick();
      await smallLimitEngine.tick();
      await smallLimitEngine.tick();
      await smallLimitEngine.tick();

      expect(smallLimitEngine.getStatus().totalSuppressions).toBe(4);
      smallLimitEngine.stop();
    });
  });

  // ==========================================================================
  // Start/stop lifecycle
  // ==========================================================================

  describe('start/stop lifecycle', () => {
    it('should start and update running state', () => {
      expect(engine.isRunning()).toBe(false);

      engine.start();
      expect(engine.isRunning()).toBe(true);

      const status = engine.getStatus();
      expect(status.running).toBe(true);
      expect(status.nextRunTime).not.toBeNull();
    });

    it('should stop and clear state', () => {
      engine.start();
      expect(engine.isRunning()).toBe(true);

      engine.stop();
      expect(engine.isRunning()).toBe(false);

      const status = engine.getStatus();
      expect(status.running).toBe(false);
      expect(status.nextRunTime).toBeNull();
    });

    it('should not start when disabled', () => {
      const disabledEngine = new HeartbeatEngine({ enabled: false });
      disabledEngine.start();
      expect(disabledEngine.isRunning()).toBe(false);
      disabledEngine.stop();
    });

    it('should not start twice', () => {
      engine.start();
      engine.start(); // Should be a no-op
      expect(engine.isRunning()).toBe(true);
    });

    it('should emit started and stopped events', () => {
      const events: string[] = [];
      engine.on('started', () => events.push('started'));
      engine.on('stopped', () => events.push('stopped'));

      engine.start();
      engine.stop();

      expect(events).toEqual(['started', 'stopped']);
    });

    it('should handle stop when not running', () => {
      // Should not throw
      engine.stop();
      expect(engine.isRunning()).toBe(false);
    });
  });

  // ==========================================================================
  // Tick behavior
  // ==========================================================================

  describe('tick behavior', () => {
    it('should skip tick when disabled', async () => {
      const disabledEngine = new HeartbeatEngine({
        enabled: false,
        heartbeatFilePath,
        agentReviewFn: mockAgentReview,
      });

      const result = await disabledEngine.tick();
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('disabled');
      disabledEngine.stop();
    });

    it('should skip tick when heartbeat file is missing', async () => {
      const missingFileEngine = new HeartbeatEngine({
        heartbeatFilePath: path.join(tmpDir, 'nonexistent.md'),
        activeHoursStart: 0,
        activeHoursEnd: 24,
        agentReviewFn: mockAgentReview,
      });

      const result = await missingFileEngine.tick();
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('file_not_found');
      missingFileEngine.stop();
    });

    it('should emit heartbeat:wake event on successful tick', async () => {
      const wakeEvents: unknown[] = [];

      const alwaysActiveEngine = new HeartbeatEngine({
        heartbeatFilePath,
        activeHoursStart: 0,
        activeHoursEnd: 24,
        agentReviewFn: mockAgentReview,
      });
      alwaysActiveEngine.on('heartbeat:wake', (data) => wakeEvents.push(data));

      await alwaysActiveEngine.tick();
      expect(wakeEvents.length).toBeGreaterThan(0);
      alwaysActiveEngine.stop();
    });

    it('should include checklist content in tick result', async () => {
      const alwaysActiveEngine = new HeartbeatEngine({
        heartbeatFilePath,
        activeHoursStart: 0,
        activeHoursEnd: 24,
        agentReviewFn: mockAgentReview,
      });

      const result = await alwaysActiveEngine.tick();
      expect(result.checklistContent).toContain('Test Checklist');
      alwaysActiveEngine.stop();
    });

    it('should track total ticks', async () => {
      const alwaysActiveEngine = new HeartbeatEngine({
        heartbeatFilePath,
        activeHoursStart: 0,
        activeHoursEnd: 24,
        agentReviewFn: mockAgentReview,
      });

      await alwaysActiveEngine.tick();
      await alwaysActiveEngine.tick();

      expect(alwaysActiveEngine.getStatus().totalTicks).toBe(2);
      alwaysActiveEngine.stop();
    });

    it('should record last result in status', async () => {
      const alwaysActiveEngine = new HeartbeatEngine({
        heartbeatFilePath,
        activeHoursStart: 0,
        activeHoursEnd: 24,
        agentReviewFn: mockAgentReview,
      });

      await alwaysActiveEngine.tick();

      const status = alwaysActiveEngine.getStatus();
      expect(status.lastResult).toBe('HEARTBEAT_OK');
      expect(status.lastRunTime).not.toBeNull();
      alwaysActiveEngine.stop();
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('singleton', () => {
    it('should return the same instance on repeated calls', () => {
      const instance1 = getHeartbeatEngine({ intervalMs: 5000 });
      const instance2 = getHeartbeatEngine({ intervalMs: 9999 });

      expect(instance1).toBe(instance2);
      // Config from first call should be used
      expect(instance1.getConfig().intervalMs).toBe(5000);
    });

    it('should create a new instance after reset', () => {
      const instance1 = getHeartbeatEngine({ intervalMs: 5000 });
      resetHeartbeatEngine();
      const instance2 = getHeartbeatEngine({ intervalMs: 9999 });

      expect(instance1).not.toBe(instance2);
      expect(instance2.getConfig().intervalMs).toBe(9999);
    });

    it('should stop engine on reset', () => {
      const instance = getHeartbeatEngine();
      instance.start();
      expect(instance.isRunning()).toBe(true);

      resetHeartbeatEngine();
      expect(instance.isRunning()).toBe(false);
    });
  });
});
