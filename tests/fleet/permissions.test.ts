/**
 * Fleet — pure permission helpers (`src/fleet/permissions.ts`).
 *
 * Covers the three documented gates of `assertPeerToolInvokeAllowed`
 * (allowlist → fleetSafe → scope), the allowlist env override parsing,
 * and the scope-matching matrix. No production code is mocked: these
 * are pure functions, and `getPeerToolAllowlist` reads
 * `CODEBUDDY_PEER_TOOL_ALLOWLIST` at call time.
 *
 * Documented barrier order (docs/fleet-guide.md §peer.tool.invoke):
 *   1. allowlist   → TOOL_NOT_ALLOWED_FOR_PEER_INVOKE
 *   2. fleetSafe   → TOOL_NOT_FLEET_SAFE
 *   3. scope list  → PEER_SCOPE_DENIED
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertPeerToolInvokeAllowed,
  getPeerToolAllowlist,
  isPeerScopeAllowed,
} from '../../src/fleet/permissions.js';

const ALLOWLIST_ENV = 'CODEBUDDY_PEER_TOOL_ALLOWLIST';
const DEFAULT_TOOLS = ['view_file', 'list_directory', 'search'];

describe('fleet permissions (pure helpers)', () => {
  let savedAllowlist: string | undefined;

  beforeEach(() => {
    savedAllowlist = process.env[ALLOWLIST_ENV];
    delete process.env[ALLOWLIST_ENV];
  });

  afterEach(() => {
    // Restore the exact prior state so no test leaks env into another.
    if (savedAllowlist === undefined) {
      delete process.env[ALLOWLIST_ENV];
    } else {
      process.env[ALLOWLIST_ENV] = savedAllowlist;
    }
  });

  // ────────────────────────────────────────────────────────────────
  // getPeerToolAllowlist
  // ────────────────────────────────────────────────────────────────
  describe('getPeerToolAllowlist', () => {
    it('returns the default allowlist when the env var is unset', () => {
      const allowlist = getPeerToolAllowlist();
      expect([...allowlist].sort()).toEqual([...DEFAULT_TOOLS].sort());
    });

    it('returns the default allowlist when the env var is an empty string', () => {
      process.env[ALLOWLIST_ENV] = '';
      const allowlist = getPeerToolAllowlist();
      expect([...allowlist].sort()).toEqual([...DEFAULT_TOOLS].sort());
    });

    it('returns the default allowlist when the env var is only whitespace/commas', () => {
      process.env[ALLOWLIST_ENV] = ' , ,, ';
      const allowlist = getPeerToolAllowlist();
      expect([...allowlist].sort()).toEqual([...DEFAULT_TOOLS].sort());
    });

    it('parses a comma-separated override', () => {
      process.env[ALLOWLIST_ENV] = 'read_file,glob';
      const allowlist = getPeerToolAllowlist();
      expect([...allowlist].sort()).toEqual(['glob', 'read_file']);
    });

    it('trims surrounding spaces around each entry', () => {
      process.env[ALLOWLIST_ENV] = ' read_file , glob ';
      const allowlist = getPeerToolAllowlist();
      expect(allowlist.has('read_file')).toBe(true);
      expect(allowlist.has('glob')).toBe(true);
      expect(allowlist.size).toBe(2);
    });

    it('drops empty entries produced by stray commas', () => {
      process.env[ALLOWLIST_ENV] = 'read_file,,glob,';
      const allowlist = getPeerToolAllowlist();
      expect([...allowlist].sort()).toEqual(['glob', 'read_file']);
      expect(allowlist.has('')).toBe(false);
    });

    it('replaces — does not merge with — the default allowlist', () => {
      process.env[ALLOWLIST_ENV] = 'read_file';
      const allowlist = getPeerToolAllowlist();
      expect(allowlist.has('read_file')).toBe(true);
      expect(allowlist.has('view_file')).toBe(false);
    });

    it('accepts an explicit raw argument, bypassing the env var', () => {
      process.env[ALLOWLIST_ENV] = 'from_env';
      const allowlist = getPeerToolAllowlist('from_arg');
      expect(allowlist.has('from_arg')).toBe(true);
      expect(allowlist.has('from_env')).toBe(false);
    });

    it('falls back to the default for an explicit empty raw argument', () => {
      const allowlist = getPeerToolAllowlist('');
      expect([...allowlist].sort()).toEqual([...DEFAULT_TOOLS].sort());
    });

    it('returns a fresh Set each call (no shared mutable default)', () => {
      const first = getPeerToolAllowlist();
      first.add('injected');
      const second = getPeerToolAllowlist();
      expect(second.has('injected')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // isPeerScopeAllowed
  // ────────────────────────────────────────────────────────────────
  describe('isPeerScopeAllowed', () => {
    it.each(['*', 'all', 'peer:invoke', 'peer:tool:invoke'])(
      'accepts the wildcard/global scope %s',
      (scope) => {
        expect(isPeerScopeAllowed('view_file', [scope])).toBe(true);
      },
    );

    it('accepts the exact tool name as a scope', () => {
      expect(isPeerScopeAllowed('view_file', ['view_file'])).toBe(true);
    });

    it('accepts the tool:<name> prefixed scope', () => {
      expect(isPeerScopeAllowed('view_file', ['tool:view_file'])).toBe(true);
    });

    it.each(['tool:*', 'tool:all'])(
      'accepts the tool-wide scope %s',
      (scope) => {
        expect(isPeerScopeAllowed('view_file', [scope])).toBe(true);
        expect(isPeerScopeAllowed('search', [scope])).toBe(true);
      },
    );

    it('accepts when any one scope in the list matches', () => {
      expect(isPeerScopeAllowed('view_file', ['nope', 'tool:view_file'])).toBe(true);
    });

    it('rejects when no scope in the list matches', () => {
      expect(isPeerScopeAllowed('view_file', ['search', 'tool:glob'])).toBe(false);
    });

    it('rejects a scope that names a different tool', () => {
      expect(isPeerScopeAllowed('view_file', ['search'])).toBe(false);
      expect(isPeerScopeAllowed('view_file', ['tool:search'])).toBe(false);
    });

    it('rejects an empty scopes list (deny by default)', () => {
      expect(isPeerScopeAllowed('view_file', [])).toBe(false);
    });

    it('rejects near-miss / malformed scopes', () => {
      expect(isPeerScopeAllowed('view_file', ['TOOL:view_file'])).toBe(false);
      expect(isPeerScopeAllowed('view_file', ['tool:'])).toBe(false);
      expect(isPeerScopeAllowed('view_file', ['*view_file'])).toBe(false);
      expect(isPeerScopeAllowed('view_file', ['tool:view_file:*'])).toBe(false);
    });

    it('treats undefined scopes as the documented default ["*"] (allow)', () => {
      // Documented fail-open default (see docs/audits SEC-6). Asserted so a
      // future change to deny-by-default is a deliberate, visible decision.
      expect(isPeerScopeAllowed('view_file', undefined)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // assertPeerToolInvokeAllowed — happy path
  // ────────────────────────────────────────────────────────────────
  describe('assertPeerToolInvokeAllowed — accepted cases', () => {
    it('passes when allowlisted, fleetSafe and scope-permitted', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          scopes: ['peer:tool:invoke'],
          fleetSafe: true,
        }),
      ).not.toThrow();
    });

    it('passes with undefined scopes (defaults to ["*"])', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          fleetSafe: true,
        }),
      ).not.toThrow();
    });

    it('passes for an env-overridden allowlisted tool', () => {
      process.env[ALLOWLIST_ENV] = 'custom_read';
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'custom_read',
          scopes: ['custom_read'],
          fleetSafe: true,
        }),
      ).not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // assertPeerToolInvokeAllowed — gate 1: allowlist
  // ────────────────────────────────────────────────────────────────
  describe('assertPeerToolInvokeAllowed — gate 1 (allowlist)', () => {
    it('throws TOOL_NOT_ALLOWED_FOR_PEER_INVOKE for a tool outside the default allowlist', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'bash',
          scopes: ['*'],
          fleetSafe: true,
        }),
      ).toThrow(/TOOL_NOT_ALLOWED_FOR_PEER_INVOKE/);
    });

    it('throws TOOL_NOT_ALLOWED_FOR_PEER_INVOKE when the env override excludes the tool', () => {
      process.env[ALLOWLIST_ENV] = 'read_file,glob';
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          scopes: ['*'],
          fleetSafe: true,
        }),
      ).toThrow(/TOOL_NOT_ALLOWED_FOR_PEER_INVOKE/);
    });

    it('names the offending tool in the message', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'bash',
          scopes: ['*'],
          fleetSafe: true,
        }),
      ).toThrow(/"bash" is not in the peer-invoke allowlist/);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // assertPeerToolInvokeAllowed — gate 2: fleetSafe
  // ────────────────────────────────────────────────────────────────
  describe('assertPeerToolInvokeAllowed — gate 2 (fleetSafe)', () => {
    it('throws TOOL_NOT_FLEET_SAFE for an allowlisted tool lacking the flag', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          scopes: ['*'],
          fleetSafe: false,
        }),
      ).toThrow(/TOOL_NOT_FLEET_SAFE/);
    });

    it('names the offending tool in the message', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'search',
          scopes: ['*'],
          fleetSafe: false,
        }),
      ).toThrow(/"search" lacks fleetSafe metadata/);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // assertPeerToolInvokeAllowed — gate 3: scope
  // ────────────────────────────────────────────────────────────────
  describe('assertPeerToolInvokeAllowed — gate 3 (scope)', () => {
    it('throws PEER_SCOPE_DENIED for an empty scopes list', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          scopes: [],
          fleetSafe: true,
        }),
      ).toThrow(/PEER_SCOPE_DENIED/);
    });

    it('mentions the empty scopes list in the message', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          scopes: [],
          fleetSafe: true,
        }),
      ).toThrow(/empty scopes list/);
    });

    it('throws PEER_SCOPE_DENIED when scopes do not permit the tool', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          scopes: ['tool:search'],
          fleetSafe: true,
        }),
      ).toThrow(/PEER_SCOPE_DENIED/);
    });

    it('lists the denied scopes in the message', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          scopes: ['search', 'glob'],
          fleetSafe: true,
        }),
      ).toThrow(/peer scopes \[search, glob\] do not permit invoking tool "view_file"/);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Barrier precedence — the documented order must hold
  // ────────────────────────────────────────────────────────────────
  describe('assertPeerToolInvokeAllowed — barrier order', () => {
    it('gate 1 wins over gate 2 and gate 3 (allowlist checked first)', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'bash', // not allowlisted
          scopes: [], // also empty
          fleetSafe: false, // also unsafe
        }),
      ).toThrow(/TOOL_NOT_ALLOWED_FOR_PEER_INVOKE/);
    });

    it('gate 2 wins over gate 3 (fleetSafe checked before scope)', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file', // allowlisted
          scopes: [], // empty scope
          fleetSafe: false, // unsafe
        }),
      ).toThrow(/TOOL_NOT_FLEET_SAFE/);
    });

    it('gate 3 is reached only when gates 1 and 2 pass', () => {
      expect(() =>
        assertPeerToolInvokeAllowed({
          toolName: 'view_file',
          scopes: [],
          fleetSafe: true,
        }),
      ).toThrow(/PEER_SCOPE_DENIED/);
    });

    it('error codes are stable, prefixed tokens', () => {
      const codeOf = (fn: () => void): string => {
        try {
          fn();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return message.split(':')[0] ?? '';
        }
        return '';
      };

      expect(
        codeOf(() =>
          assertPeerToolInvokeAllowed({
            toolName: 'bash',
            scopes: ['*'],
            fleetSafe: true,
          }),
        ),
      ).toBe('TOOL_NOT_ALLOWED_FOR_PEER_INVOKE');

      expect(
        codeOf(() =>
          assertPeerToolInvokeAllowed({
            toolName: 'view_file',
            scopes: ['*'],
            fleetSafe: false,
          }),
        ),
      ).toBe('TOOL_NOT_FLEET_SAFE');

      expect(
        codeOf(() =>
          assertPeerToolInvokeAllowed({
            toolName: 'view_file',
            scopes: [],
            fleetSafe: true,
          }),
        ),
      ).toBe('PEER_SCOPE_DENIED');
    });
  });
});
