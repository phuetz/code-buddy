import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatEngine } from '../../src/daemon/heartbeat.js';
import { Command } from 'commander';
import { registerHeartbeatCommands } from '../../src/commands/cli/native-engine-commands.js';
import * as heartbeatModule from '../../src/daemon/heartbeat.js';

describe('HeartbeatEngine Interval Validation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const testInvalidInterval = async (intervalMs: number) => {
    const mockTick = vi.fn().mockResolvedValue({
      timestamp: new Date(),
      skipped: false,
      suppressed: false,
      duration: 10,
    });

    const engine = new HeartbeatEngine({ intervalMs });
    engine.tick = mockTick;

    engine.start();

    // Advance by 50ms - if interval was reset to 1ms due to NaN/0/negative, tick would be called ~50 times.
    // If it defaults to 30 min (1800000ms), it shouldn't be called after the initial start.
    // Note: the original code does not execute tick synchronously on start, it uses setTimeout for the first run.
    await vi.advanceTimersByTimeAsync(50);

    // It should be 0 because 50ms is less than the expected fallback (30 minutes).
    expect(mockTick).toHaveBeenCalledTimes(0);

    engine.stop();
  };

  it('should not tick rapidly for intervalMs = NaN', async () => {
    await testInvalidInterval(Number.NaN);
  });

  it('should not tick rapidly for intervalMs = 0', async () => {
    await testInvalidInterval(0);
  });

  it('should not tick rapidly for intervalMs = -5', async () => {
    await testInvalidInterval(-5);
  });
});

describe('Heartbeat CLI Commands', () => {
  let program: Command;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    program = new Command();
    program.exitOverride(); // Prevent process.exit
    registerHeartbeatCommands(program);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(heartbeatModule, 'getHeartbeatEngine');
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('should fail to start when interval is not a number (abc)', async () => {
    try {
      await program.parseAsync(['node', 'test', 'heartbeat', 'start', '--interval', 'abc']);
    } catch (e) {
      // Catch commander exit if any
    }

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid interval'));
    expect(heartbeatModule.getHeartbeatEngine).not.toHaveBeenCalled();
  });

  it('should fail to start when interval is less than minimum (500ms)', async () => {
    try {
      await program.parseAsync(['node', 'test', 'heartbeat', 'start', '--interval', '500']);
    } catch (e) {
      // Catch commander exit if any
    }

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid interval'));
    expect(heartbeatModule.getHeartbeatEngine).not.toHaveBeenCalled();
  });

  it.each(['1000oops', '1000.5', '1e309'])('rejects malformed interval %s', async (value) => {
    await program.parseAsync(['node', 'test', 'heartbeat', 'start', '--interval', value]);
    expect(process.exitCode).toBe(1);
    expect(heartbeatModule.getHeartbeatEngine).not.toHaveBeenCalled();
  });
});
