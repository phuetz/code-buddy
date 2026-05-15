/**
 * /share slash handler tests
 *
 * Covers: action validation, status output shape, enable/disable
 * idempotence, create/join arg validation, case-insensitivity.
 *
 * Uses the real TeamSessionManager (no fs mock). The manager creates
 * ~/.codebuddy/shares/ at instantiation but does not write session
 * files until createSession() is called — which we do not invoke in
 * happy paths to keep tests filesystem-clean.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleShare, _resetSessionHandlerForTests } from '../../src/commands/handlers/team-session-handler.js';
import { resetTeamSessionManager } from '../../src/collaboration/team-session.js';

describe('handleShare (/share)', () => {
  // Slash renamed from /session to /share to avoid tab-collision with
  // existing /sessions (HTTP sessions persistance, session-handlers.ts).
  beforeEach(() => {
    resetTeamSessionManager();
    _resetSessionHandlerForTests();
  });

  afterEach(() => {
    resetTeamSessionManager();
    _resetSessionHandlerForTests();
  });

  it('rejects unknown action with help text', async () => {
    const r = await handleShare(['lol']);
    expect(r.handled).toBe(true);
    expect(r.entry?.content).toContain('Unknown share action');
    expect(r.entry?.content).toContain('Usage: /share');
  });

  it('shows help when action is "help"', async () => {
    const r = await handleShare(['help']);
    expect(r.entry?.content).toContain('Usage: /share');
    expect(r.entry?.content).toContain('enable');
    expect(r.entry?.content).toContain('disable');
    expect(r.entry?.content).toContain('status');
    expect(r.entry?.content).toContain('create');
    expect(r.entry?.content).toContain('join');
    expect(r.entry?.content).toContain('list');
    expect(r.entry?.content).toContain('leave');
  });

  it('defaults to status when no action provided', async () => {
    const r = await handleShare([]);
    expect(r.entry?.content).toContain('Team Session Manager Status');
    expect(r.entry?.content).toContain('Enabled:');
    expect(r.entry?.content).toContain('Real-time sync:');
  });

  it('status shows DISABLED V0.2 marker for sync when no server_url', async () => {
    const r = await handleShare(['status']);
    expect(r.entry?.content).toContain('DISABLED — V0.2');
  });

  it('does not claim encrypted storage when no encryption key is configured', async () => {
    const r = await handleShare(['status']);
    expect(r.entry?.content).toContain('plain (encryption key not configured)');
  });

  it('enable instantiates the manager', async () => {
    const r = await handleShare(['enable']);
    expect(r.entry?.content).toContain('Team session manager started');

    const status = await handleShare(['status']);
    expect(status.entry?.content).toMatch(/Enabled:\s+yes/);
  });

  it('enable is idempotent', async () => {
    await handleShare(['enable']);
    const r2 = await handleShare(['enable']);
    expect(r2.entry?.content).toContain('already enabled');
  });

  it('disable resets the manager when enabled', async () => {
    await handleShare(['enable']);
    const r = await handleShare(['disable']);
    expect(r.entry?.content).toContain('Team session manager stopped');

    const status = await handleShare(['status']);
    expect(status.entry?.content).toMatch(/Enabled:\s+no/);
  });

  it('disable is a no-op when not enabled', async () => {
    const r = await handleShare(['disable']);
    expect(r.entry?.content).toContain('not enabled');
  });

  it('create with no name returns usage', async () => {
    const r = await handleShare(['create']);
    expect(r.entry?.content).toContain('Usage: /share create <name>');
  });

  it('join with no sessionId returns usage', async () => {
    const r = await handleShare(['join']);
    expect(r.entry?.content).toContain('Usage: /share join <sessionId>');
  });

  it('join with unknown sessionId reports not found', async () => {
    const r = await handleShare(['join', 'nonexistent-id-0000']);
    expect(r.entry?.content).toContain('Session not found');
    expect(r.entry?.content).toContain('/share list');
  });

  it('leave with no active session is a no-op', async () => {
    const r = await handleShare(['leave']);
    expect(r.entry?.content).toContain('No active session');
  });

  it('action is case-insensitive', async () => {
    const r = await handleShare(['ENABLE']);
    expect(r.entry?.content).toContain('Team session manager started');
    await handleShare(['DISABLE']);
  });
});
