/**
 * Phase T1 — Tests for src/security/permission-modes.ts.
 *
 * Permission gating is the entry door for ALL tool execution. A bug here
 * silently bypasses user confirmations or blocks legitimate operations.
 * The 5-tier system (default | plan | acceptEdits | dontAsk | bypassPermissions)
 * + bypass-disabled managed setting + pattern allowlist + subagent mode
 * is dense enough that an audit identified it as critical-without-coverage.
 *
 * Test scope:
 * - Constructor defaults + partial config.
 * - setMode transitions + bypassPermissions guard when disableBypass=true.
 * - checkPermission decision matrix across all 5 modes × 4 tool categories.
 * - Pattern allowlist (glob → regex conversion + dedup + check-first ordering).
 * - Subagent mode (getSubagentMode fallback to main mode).
 * - setBypassDisabled side-effect (reverts mode if currently bypass).
 * - Singleton getter / reset.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  PermissionModeManager,
  getPermissionModeManager,
  resetPermissionModeManager,
} from '../../src/security/permission-modes.js';

describe('PermissionModeManager — Phase T1', () => {
  beforeEach(() => {
    resetPermissionModeManager();
  });

  describe('constructor', () => {
    it('uses defaults when no config is passed', () => {
      const m = new PermissionModeManager();
      expect(m.getMode()).toBe('default');
      expect(m.isBypassDisabled()).toBe(false);
      // Subagent mode falls back to main mode when not explicitly set
      expect(m.getSubagentMode()).toBe('default');
    });

    it('honors a partial config (mode + disableBypass + subagentMode)', () => {
      const m = new PermissionModeManager({
        mode: 'plan',
        disableBypass: true,
        subagentMode: 'acceptEdits',
      });
      expect(m.getMode()).toBe('plan');
      expect(m.isBypassDisabled()).toBe(true);
      expect(m.getSubagentMode()).toBe('acceptEdits');
    });

    it('coerces undefined disableBypass to false (??=)', () => {
      const m = new PermissionModeManager({ mode: 'default' });
      expect(m.isBypassDisabled()).toBe(false);
    });
  });

  describe('setMode', () => {
    it('accepts every legal mode transition', () => {
      const m = new PermissionModeManager();
      const modes = ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const;
      for (const mode of modes) {
        const ok = m.setMode(mode);
        expect(ok).toBe(true);
        expect(m.getMode()).toBe(mode);
      }
    });

    it('refuses bypassPermissions when disableBypass is true (returns false, mode unchanged)', () => {
      const m = new PermissionModeManager({ mode: 'plan', disableBypass: true });
      const ok = m.setMode('bypassPermissions');
      expect(ok).toBe(false);
      expect(m.getMode()).toBe('plan'); // unchanged
    });

    it('allows bypassPermissions when disableBypass is false (default)', () => {
      const m = new PermissionModeManager();
      const ok = m.setMode('bypassPermissions');
      expect(ok).toBe(true);
      expect(m.getMode()).toBe('bypassPermissions');
    });
  });

  describe('tool classification helpers', () => {
    const m = new PermissionModeManager();

    it('classifies known read-only tools', () => {
      for (const t of ['view_file', 'read_file', 'search', 'list_files', 'grep', 'glob', 'git_log', 'git_status', 'git_diff']) {
        expect(m.isReadOnlyTool(t)).toBe(true);
        expect(m.isEditTool(t)).toBe(false);
        expect(m.isDestructiveTool(t)).toBe(false);
      }
    });

    it('classifies known edit tools', () => {
      for (const t of ['str_replace_editor', 'create_file', 'write_file', 'edit_file', 'apply_patch', 'multi_edit']) {
        expect(m.isEditTool(t)).toBe(true);
        expect(m.isReadOnlyTool(t)).toBe(false);
        expect(m.isDestructiveTool(t)).toBe(false);
      }
    });

    it('classifies known destructive tools', () => {
      for (const t of ['bash', 'delete_file', 'rm', 'git_reset', 'git_checkout']) {
        expect(m.isDestructiveTool(t)).toBe(true);
        expect(m.isReadOnlyTool(t)).toBe(false);
        expect(m.isEditTool(t)).toBe(false);
      }
    });

    it('returns false for unknown tools across all categories', () => {
      const t = 'totally_unknown_tool';
      expect(m.isReadOnlyTool(t)).toBe(false);
      expect(m.isEditTool(t)).toBe(false);
      expect(m.isDestructiveTool(t)).toBe(false);
    });
  });

  describe('checkPermission — pattern allowlist (highest priority)', () => {
    it('matched literal pattern allows immediately, no prompt', () => {
      const m = new PermissionModeManager({ mode: 'default' });
      m.addAllowedPattern('Bash(git log)');
      const d = m.checkPermission('Bash(git log)', 'bash');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false);
      expect(d.reason).toContain('allowed pattern');
    });

    it('glob * is converted to regex .* and matches', () => {
      const m = new PermissionModeManager();
      m.addAllowedPattern('Bash(git status*)');
      // Wildcard match
      const d = m.checkPermission('Bash(git status:--short)', 'bash');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false);
    });

    it('non-matching action falls through to the mode handler (gets prompted in default for non-read-only)', () => {
      const m = new PermissionModeManager({ mode: 'default' });
      m.addAllowedPattern('Bash(git log)');
      const d = m.checkPermission('Bash(rm -rf /)', 'bash');
      // Falls through to default mode → bash is not read-only → prompted=true
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(true);
    });

    it('tolerates duplicate addAllowedPattern calls without breaking match behavior', () => {
      // The implementation dedups via includes() check; we verify only
      // the externally-observable contract here: "calling N times leaves
      // matching working". A true dedup assertion would need internal
      // state exposure — not worth the API surface.
      const m = new PermissionModeManager();
      m.addAllowedPattern('Bash(ls)');
      m.addAllowedPattern('Bash(ls)');
      m.addAllowedPattern('Bash(ls)');
      const d = m.checkPermission('Bash(ls)', 'bash');
      expect(d.allowed).toBe(true);
      expect(d.reason).toContain('allowed pattern');
    });

    it('special regex characters in the literal portion are escaped (no false matches)', () => {
      const m = new PermissionModeManager();
      m.addAllowedPattern('Bash(echo a.b)');
      // The "." should be escaped — "Bash(echo aXb)" should NOT match
      const matchesLiteral = m.isPatternAllowed('Bash(echo a.b)');
      const matchesRegexDot = m.isPatternAllowed('Bash(echo aXb)');
      expect(matchesLiteral).toBe(true);
      expect(matchesRegexDot).toBe(false);
    });
  });

  describe('checkPermission — default mode', () => {
    const m = new PermissionModeManager({ mode: 'default' });

    it('auto-approves read-only tools without prompt', () => {
      const d = m.checkPermission('any', 'view_file');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false);
    });

    it('requires prompt for edit / destructive / unknown tools', () => {
      for (const t of ['edit_file', 'bash', 'unknown_x']) {
        const d = m.checkPermission('any', t);
        expect(d.allowed).toBe(true);
        expect(d.prompted).toBe(true);
      }
    });
  });

  describe('checkPermission — plan mode (read-only ONLY)', () => {
    const m = new PermissionModeManager({ mode: 'plan' });

    it('allows read-only tools', () => {
      const d = m.checkPermission('any', 'grep');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false);
    });

    it('blocks edit + destructive + unknown tools (allowed=false)', () => {
      for (const t of ['edit_file', 'bash', 'unknown_x']) {
        const d = m.checkPermission('any', t);
        expect(d.allowed).toBe(false);
        expect(d.prompted).toBe(false);
      }
    });

    it('allows an option-aware read-only shell expression but blocks shell mutation', () => {
      expect(m.checkPermission('git status && rg TODO src', 'bash')).toMatchObject({
        allowed: true,
        prompted: false,
      });
      expect(m.checkPermission('find . -delete', 'bash').allowed).toBe(false);
      expect(m.checkPermission('cat README.md > copy.md', 'bash').allowed).toBe(false);
    });
  });

  describe('checkPermission — acceptEdits mode', () => {
    const m = new PermissionModeManager({ mode: 'acceptEdits' });

    it('auto-approves read-only', () => {
      expect(m.checkPermission('any', 'view_file')).toEqual({
        allowed: true,
        reason: 'Read-only tool auto-approved',
        prompted: false,
      });
    });

    it('auto-approves edit tools', () => {
      const d = m.checkPermission('any', 'str_replace_editor');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false);
    });

    it('prompts on destructive tools', () => {
      const d = m.checkPermission('any', 'bash');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(true);
    });

    it('prompts on unknown tools (defensive default)', () => {
      const d = m.checkPermission('any', 'unknown_x');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(true);
    });
  });

  describe('checkPermission — dontAsk mode', () => {
    const m = new PermissionModeManager({ mode: 'dontAsk' });

    it('auto-approves read-only + edit + unknown', () => {
      for (const t of ['view_file', 'edit_file', 'unknown_x']) {
        const d = m.checkPermission('any', t);
        expect(d.allowed).toBe(true);
        expect(d.prompted).toBe(false);
      }
    });

    it('STILL prompts on destructive (the only safety net)', () => {
      const d = m.checkPermission('any', 'rm');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(true);
    });
  });

  describe('checkPermission — bypassPermissions mode', () => {
    const m = new PermissionModeManager({ mode: 'bypassPermissions' });

    it('auto-approves EVERYTHING (incl. destructive — bypass is bypass)', () => {
      for (const t of ['view_file', 'edit_file', 'bash', 'rm', 'unknown_x']) {
        const d = m.checkPermission('any', t);
        expect(d.allowed).toBe(true);
        expect(d.prompted).toBe(false);
      }
    });
  });

  describe('subagent mode', () => {
    it('getSubagentMode falls back to main mode when subagentMode is unset', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      expect(m.getSubagentMode()).toBe('plan');
    });

    it('getSubagentMode returns the explicit subagent mode when set', () => {
      const m = new PermissionModeManager({ mode: 'plan', subagentMode: 'acceptEdits' });
      expect(m.getSubagentMode()).toBe('acceptEdits');
    });

    it('setSubagentMode updates and is independently readable', () => {
      const m = new PermissionModeManager({ mode: 'default' });
      m.setSubagentMode('dontAsk');
      expect(m.getSubagentMode()).toBe('dontAsk');
      expect(m.getMode()).toBe('default'); // main mode unchanged
    });
  });

  describe('setBypassDisabled side-effects', () => {
    it('reverts the active mode to "default" if it was bypassPermissions', () => {
      const m = new PermissionModeManager({ mode: 'bypassPermissions' });
      m.setBypassDisabled(true);
      expect(m.isBypassDisabled()).toBe(true);
      expect(m.getMode()).toBe('default'); // forced revert
    });

    it('does NOT touch the mode if it is anything other than bypassPermissions', () => {
      const m = new PermissionModeManager({ mode: 'acceptEdits' });
      m.setBypassDisabled(true);
      expect(m.getMode()).toBe('acceptEdits'); // unchanged
    });

    it('re-enabling bypass (setBypassDisabled(false)) does NOT auto-restore the previous mode', () => {
      const m = new PermissionModeManager({ mode: 'bypassPermissions' });
      m.setBypassDisabled(true); // mode reverted to default
      m.setBypassDisabled(false); // bypass re-allowed
      // The user must explicitly call setMode again — no auto-restore.
      expect(m.getMode()).toBe('default');
      // But setMode('bypassPermissions') is now allowed again.
      expect(m.setMode('bypassPermissions')).toBe(true);
      expect(m.getMode()).toBe('bypassPermissions');
    });
  });

  describe('singleton', () => {
    it('getPermissionModeManager returns the same instance across calls', () => {
      const a = getPermissionModeManager();
      const b = getPermissionModeManager();
      expect(a).toBe(b);
    });

    it('singleton state persists between getters until reset', () => {
      const a = getPermissionModeManager();
      a.setMode('plan');
      const b = getPermissionModeManager();
      expect(b.getMode()).toBe('plan');
    });

    it('resetPermissionModeManager clears the cached instance (next get returns a fresh one)', () => {
      const a = getPermissionModeManager();
      a.setMode('plan');
      resetPermissionModeManager();
      const b = getPermissionModeManager();
      expect(b).not.toBe(a);
      expect(b.getMode()).toBe('default'); // fresh defaults
    });
  });

  describe('async-scoped posture', () => {
    it('keeps a temporary actor mode out of the owning code session', async () => {
      const m = new PermissionModeManager({ mode: 'plan' });

      await m.withModeAsync('default', async () => {
        expect(m.getMode()).toBe('default');
        expect(m.checkPermission('inspect repository', 'bash').allowed).toBe(true);
        await Promise.resolve();
        expect(m.getMode()).toBe('default');
      });

      expect(m.getMode()).toBe('plan');
      expect(m.checkPermission('inspect repository', 'bash').allowed).toBe(false);
    });

    it('isolates concurrent voice and code postures', async () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      let releaseVoice!: () => void;
      const voiceGate = new Promise<void>((resolve) => { releaseVoice = resolve; });
      let voiceStarted!: () => void;
      const started = new Promise<void>((resolve) => { voiceStarted = resolve; });

      const voice = m.withModeAsync('default', async () => {
        voiceStarted();
        expect(m.getMode()).toBe('default');
        await voiceGate;
        return m.getMode();
      });

      await started;
      expect(m.getMode()).toBe('plan');
      releaseVoice();
      await expect(voice).resolves.toBe('default');
      expect(m.getMode()).toBe('plan');
    });
  });

  describe('regression — pattern check is evaluated BEFORE mode dispatch', () => {
    it('an allowlisted destructive action in plan mode is still allowed (allowlist trumps mode)', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      // Plan mode normally blocks bash. Allowlist must override.
      m.addAllowedPattern('Bash(git status)');
      const d = m.checkPermission('Bash(git status)', 'bash');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false);
      expect(d.reason).toContain('allowed pattern');
    });
  });

  describe('defense-in-depth — invalid mode value', () => {
    it('falls through to default-mode handler for an out-of-band mode value', () => {
      // Defensive: the public type narrows to 5 values, but a runtime
      // value sneaking in (config from disk, future migration) must not
      // crash — the switch's default branch routes to checkDefault().
      const m = new PermissionModeManager({ mode: 'totallyInvalid' as unknown as PermissionMode });
      const d = m.checkPermission('any', 'view_file');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false); // read-only path of checkDefault
      const dEdit = m.checkPermission('any', 'edit_file');
      expect(dEdit.allowed).toBe(true);
      expect(dEdit.prompted).toBe(true); // confirmation path of checkDefault
    });
  });

  describe('logger side-effects', () => {
    it('setMode / setBypassDisabled / setSubagentMode never throw on the real logger', () => {
      // Smoke test: production logger calls shouldn't blow up. We don't
      // assert message contents (that's noise) — just that the calls
      // complete cleanly.
      const m = new PermissionModeManager();
      expect(() => m.setMode('plan')).not.toThrow();
      expect(() => m.setBypassDisabled(true)).not.toThrow();
      expect(() => m.setSubagentMode('acceptEdits')).not.toThrow();
    });
  });

  describe('plan mode honors the registry fleetSafe read-only surface', () => {
    // The voice companion runs under plan posture; the legacy 9-entry
    // READ_ONLY_TOOLS list denied every OTHER read-only tool, so Lisa kept
    // answering "je ne peux pas faire de recherche en plan mode". Plan mode
    // now unions the registry's fleetSafe flag (the maintained read-only
    // source of truth, ~41 tools).
    it('allows registry read-only tools (web_search/web_fetch/list_directory) in plan mode', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      for (const tool of ['web_search', 'web_fetch', 'list_directory', 'weather']) {
        expect(m.checkPermission(tool, tool).allowed, tool).toBe(true);
      }
    });

    it('still denies writes, shell and unknown tools in plan mode', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      for (const tool of ['write_file', 'apply_patch', 'bash', 'delete_file', 'not_a_real_tool']) {
        expect(m.checkPermission(tool, tool).allowed, tool).toBe(false);
      }
    });
  });
});
