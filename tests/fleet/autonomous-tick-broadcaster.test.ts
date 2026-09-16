/**
 * Autonomous-tick daemon — verify the wake-the-Python-wrapper pattern.
 *
 * The daemon mirrors `heartbeat-broadcaster`: singleton timer, unref'd,
 * idempotent start, graceful stop. The most important property is
 * graceful degradation — server boot stays clean when no fleet repo
 * is configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/agent/autonomous/fleet-tick-handler.js', () => ({
  runFleetTick: vi.fn(async () => ({ kind: 'no_task' })),
}));

import {
  startAutonomousTick,
  stopAutonomousTick,
  isAutonomousTickActive,
  getAutonomousTickIntervalMs,
  _stopAutonomousTickForTests,
} from '../../src/fleet/autonomous-tick-broadcaster';
import { logger } from '../../src/utils/logger.js';
import { runFleetTick } from '../../src/agent/autonomous/fleet-tick-handler.js';

beforeEach(() => {
  vi.useFakeTimers();
  _stopAutonomousTickForTests();
  vi.mocked(runFleetTick).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.info).mockClear();
});

afterEach(() => {
  _stopAutonomousTickForTests();
  vi.useRealTimers();
});

describe('autonomous-tick-broadcaster — graceful degradation', () => {
  it('logs warning and stays inactive when repoPath is undefined', () => {
    startAutonomousTick({ repoPath: undefined, host: 'test-host' });
    expect(isAutonomousTickActive()).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('daemon inactive'),
    );
  });

  it('logs warning and stays inactive when repoPath is empty string', () => {
    startAutonomousTick({ repoPath: '', host: 'test-host' });
    expect(isAutonomousTickActive()).toBe(false);
  });

  it('logs warning and stays inactive when repoPath is whitespace', () => {
    startAutonomousTick({ repoPath: '   ', host: 'test-host' });
    expect(isAutonomousTickActive()).toBe(false);
  });

  it('returned stop function is a no-op when daemon never started', () => {
    const stop = startAutonomousTick({ repoPath: undefined, host: 'h' });
    expect(() => stop()).not.toThrow();
  });
});

describe('autonomous-tick-broadcaster — active mode', () => {
  it('activates and stores the requested interval', () => {
    startAutonomousTick({
      repoPath: '/tmp/fake-fleet-repo',
      host: 'hub/grok-cli',
      intervalMs: 60_000,
    });
    expect(isAutonomousTickActive()).toBe(true);
    expect(getAutonomousTickIntervalMs()).toBe(60_000);
  });

  it('falls back to default interval when intervalMs is invalid', () => {
    startAutonomousTick({
      repoPath: '/tmp/fake',
      host: 'h',
      intervalMs: -1,
    });
    expect(getAutonomousTickIntervalMs()).toBe(5 * 60 * 1000);
  });

  it('fires runFleetTick at each interval', async () => {
    startAutonomousTick({
      repoPath: '/tmp/fake',
      host: 'h',
      intervalMs: 1000,
    });
    expect(runFleetTick).not.toHaveBeenCalled(); // not fired immediately
    await vi.advanceTimersByTimeAsync(1000);
    expect(runFleetTick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runFleetTick).toHaveBeenCalledTimes(2);
  });

  it('forwards repoPath + host + tickOptions to runFleetTick', async () => {
    startAutonomousTick({
      repoPath: '/repo',
      host: 'h1',
      intervalMs: 100,
      tickOptions: { priorityThreshold: 'high', dryRun: true },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(runFleetTick).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: '/repo',
        host: 'h1',
        priorityThreshold: 'high',
        dryRun: true,
      }),
    );
  });

  it('is idempotent — second start while active is a no-op', () => {
    startAutonomousTick({
      repoPath: '/r',
      host: 'h',
      intervalMs: 500,
    });
    startAutonomousTick({
      repoPath: '/r',
      host: 'h',
      intervalMs: 9999, // would change interval if not idempotent
    });
    expect(getAutonomousTickIntervalMs()).toBe(500);
  });

  it('survives a tick that throws — next tick still fires', async () => {
    vi.mocked(runFleetTick).mockImplementationOnce(async () => {
      throw new Error('git pull failed');
    });
    startAutonomousTick({
      repoPath: '/r',
      host: 'h',
      intervalMs: 200,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(runFleetTick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(runFleetTick).toHaveBeenCalledTimes(2);
  });
});

describe('autonomous-tick-broadcaster — stop', () => {
  it('stops cleanly and reports inactive', () => {
    startAutonomousTick({ repoPath: '/r', host: 'h' });
    expect(isAutonomousTickActive()).toBe(true);
    stopAutonomousTick();
    expect(isAutonomousTickActive()).toBe(false);
    expect(getAutonomousTickIntervalMs()).toBeNull();
  });

  it('is idempotent — second stop is a no-op', () => {
    startAutonomousTick({ repoPath: '/r', host: 'h' });
    stopAutonomousTick();
    expect(() => stopAutonomousTick()).not.toThrow();
  });
});
