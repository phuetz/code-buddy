/**
 * S5 — computer_control must gate dangerous actions under the DEFAULT profile
 * and give the confirmation real teeth via the permission mode, instead of
 * relying only on the model-set `confirmDangerous` flag.
 *
 * Exercises the safety policy directly (enforceSafetyPolicy) so no desktop
 * backend / nut-js is touched — the gate runs before any automation init.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';
import type { ComputerControlInput } from '../../src/tools/computer-control-tool.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';

// enforceSafetyPolicy is private; call it directly for a deterministic gate test.
function gate(tool: ComputerControlTool, input: ComputerControlInput): string | null {
  return (tool as unknown as { enforceSafetyPolicy(i: ComputerControlInput): string | null }).enforceSafetyPolicy(input);
}

describe('computer_control safety policy (S5)', () => {
  let tool: ComputerControlTool;
  beforeEach(() => {
    resetPermissionModeManager();
    tool = new ComputerControlTool();
  });
  afterEach(() => resetPermissionModeManager());

  it('DEFAULT (balanced) profile gates a dangerous action — the S5 regression', () => {
    getPermissionModeManager().setMode('default');
    // balanced is the default profile; close_window is dangerous.
    const err = gate(tool, { action: 'close_window', safetyProfile: 'balanced' });
    expect(err).toBeTruthy();
    expect(err).toMatch(/requires explicit confirmation/i);
  });

  it('a benign action (plain click) is still allowed with no gate', () => {
    getPermissionModeManager().setMode('default');
    expect(gate(tool, { action: 'click', x: 10, y: 20 })).toBeNull();
  });

  it('confirmDangerous lets a dangerous action through in default mode', () => {
    getPermissionModeManager().setMode('default');
    expect(gate(tool, { action: 'close_window', confirmDangerous: true })).toBeNull();
  });

  it('plan (read-only) mode blocks a dangerous action EVEN with confirmDangerous=true', () => {
    getPermissionModeManager().setMode('plan');
    const err = gate(tool, { action: 'close_window', confirmDangerous: true });
    expect(err).toBeTruthy();
    expect(err).toMatch(/plan mode/i);
  });

  it('bypassPermissions pre-approves a dangerous action without confirmDangerous', () => {
    getPermissionModeManager().setMode('bypassPermissions');
    expect(gate(tool, { action: 'close_window' })).toBeNull();
  });

  it('simulateOnly dry-run is never gated', () => {
    getPermissionModeManager().setMode('default');
    expect(gate(tool, { action: 'close_window', simulateOnly: true })).toBeNull();
  });

  it('a dangerous keystroke (alt+F4) is gated under the default profile', () => {
    getPermissionModeManager().setMode('default');
    const err = gate(tool, { action: 'key', key: 'f4', modifiers: ['alt'] });
    expect(err).toBeTruthy();
    expect(err).toMatch(/requires explicit confirmation/i);
  });
});
