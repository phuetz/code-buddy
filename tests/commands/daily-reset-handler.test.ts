/**
 * Daily Reset slash handler tests
 *
 * Covers: action validation, status output shape, enable→disable
 * lifecycle, manual run trigger, case-insensitivity.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleDailyReset } from '../../src/commands/handlers/daily-reset-handler.js';
import { resetDailyResetManager } from '../../src/daemon/daily-reset.js';

describe('handleDailyReset', () => {
  beforeEach(() => {
    resetDailyResetManager();
  });

  afterEach(() => {
    resetDailyResetManager();
  });

  it('rejects unknown action with help text', async () => {
    const r = await handleDailyReset(['lol']);
    expect(r.handled).toBe(true);
    expect(r.entry?.content).toContain('Unknown daily-reset action');
    expect(r.entry?.content).toContain('Usage: /daily-reset');
  });

  it('shows help when action is "help"', async () => {
    const r = await handleDailyReset(['help']);
    expect(r.entry?.content).toContain('Usage: /daily-reset');
    expect(r.entry?.content).toContain('enable');
    expect(r.entry?.content).toContain('disable');
    expect(r.entry?.content).toContain('status');
    expect(r.entry?.content).toContain('run');
    expect(r.entry?.content).toContain('does not clear');
    expect(r.entry?.content).not.toContain('clear in-memory conversation history');
  });

  it('defaults to status when no action provided', async () => {
    const r = await handleDailyReset([]);
    expect(r.entry?.content).toContain('Daily Reset Manager Status');
    expect(r.entry?.content).toContain('Enabled:');
    expect(r.entry?.content).toContain('Time:');
  });

  it('status output formats time as HH:MM', async () => {
    const r = await handleDailyReset(['status']);
    expect(r.entry?.content).toMatch(/Time:\s+\d{2}:\d{2}/);
  });

  it('enable starts the scheduler', async () => {
    const r = await handleDailyReset(['enable']);
    expect(r.entry?.content).toContain('Daily reset scheduler started');

    const status = await handleDailyReset(['status']);
    expect(status.entry?.content).toMatch(/Enabled:\s+yes/);
    expect(status.entry?.content).toMatch(/Scheduled:\s+yes/);
    expect(status.entry?.content).toMatch(/Next in:\s+\d+h\s+\d+m/);
  });

  it('disable stops the scheduler after enable', async () => {
    await handleDailyReset(['enable']);
    const r = await handleDailyReset(['disable']);
    expect(r.entry?.content).toContain('Daily reset scheduler stopped');

    const status = await handleDailyReset(['status']);
    expect(status.entry?.content).toMatch(/Scheduled:\s+no/);
  });

  it('run triggers manual reset and returns result', async () => {
    const r = await handleDailyReset(['run']);
    expect(r.entry?.content).toContain('Daily reset triggered manually');
    expect(r.entry?.content).toContain('Messages cleared:');
  });

  it('action is case-insensitive', async () => {
    const r = await handleDailyReset(['ENABLE']);
    expect(r.entry?.content).toContain('Daily reset scheduler started');
    await handleDailyReset(['DISABLE']);
  });
});
