/**
 * Heartbeat slash handler tests
 *
 * Covers: action validation, status output shape, enable→disable
 * idempotence, TOML config plumbing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleHeartbeat } from '../../src/commands/handlers/heartbeat-handler.js';
import { resetHeartbeatEngine } from '../../src/daemon/heartbeat.js';

describe('handleHeartbeat', () => {
  beforeEach(() => {
    // Each test starts with a fresh singleton so state doesn't leak between cases
    resetHeartbeatEngine();
  });

  afterEach(() => {
    resetHeartbeatEngine();
  });

  it('rejects unknown action with help text', async () => {
    const r = await handleHeartbeat(['lol']);
    expect(r.handled).toBe(true);
    expect(r.entry?.content).toContain('Unknown heartbeat action');
    expect(r.entry?.content).toContain('Usage: /heartbeat');
  });

  it('shows help when action is "help"', async () => {
    const r = await handleHeartbeat(['help']);
    expect(r.handled).toBe(true);
    expect(r.entry?.content).toContain('Usage: /heartbeat');
    expect(r.entry?.content).toContain('enable');
    expect(r.entry?.content).toContain('disable');
    expect(r.entry?.content).toContain('status');
  });

  it('defaults to status when no action provided', async () => {
    const r = await handleHeartbeat([]);
    expect(r.handled).toBe(true);
    expect(r.entry?.content).toContain('Heartbeat Engine Status');
    expect(r.entry?.content).toContain('Running:');
    expect(r.entry?.content).toContain('Enabled:');
  });

  it('status output includes file path and counters', async () => {
    const r = await handleHeartbeat(['status']);
    const content = r.entry?.content ?? '';
    expect(content).toContain('Total ticks:');
    expect(content).toContain('Total suppressions:');
    expect(content).toContain('File:');
  });

  it('enable starts the engine', async () => {
    const r = await handleHeartbeat(['enable']);
    expect(r.handled).toBe(true);
    expect(r.entry?.content).toContain('Heartbeat engine started');

    const status = await handleHeartbeat(['status']);
    expect(status.entry?.content).toMatch(/Running:\s+yes/);
  });

  it('enable is idempotent (does not double-start)', async () => {
    await handleHeartbeat(['enable']);
    const r2 = await handleHeartbeat(['enable']);
    expect(r2.entry?.content).toContain('already running');
  });

  it('disable stops the engine after enable', async () => {
    await handleHeartbeat(['enable']);
    const r = await handleHeartbeat(['disable']);
    expect(r.entry?.content).toContain('Heartbeat engine and companion always-on loops stopped');

    const status = await handleHeartbeat(['status']);
    expect(status.entry?.content).toMatch(/Running:\s+no/);
  });

  it('disable is a no-op when engine is not running', async () => {
    const r = await handleHeartbeat(['disable']);
    expect(r.entry?.content).toContain('not running');
  });

  it('action is case-insensitive', async () => {
    const r = await handleHeartbeat(['ENABLE']);
    expect(r.entry?.content).toContain('Heartbeat engine started');
    await handleHeartbeat(['DISABLE']);
  });
});
