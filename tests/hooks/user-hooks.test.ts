/**
 * Tests for UserHooksManager
 *
 * Covers: command execution, HTTP handler, exit code semantics,
 * conditional `if` matching, timeout handling, env var expansion,
 * singleton, and event aggregation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  UserHooksManager,
  getUserHooksManager,
  resetUserHooksManager,
  type HookContext,
  type UserHookHandler,
} from '../../src/hooks/user-hooks.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'user-hooks-test-'));
}

function writeHooksJson(dir: string, content: object): void {
  const cbDir = path.join(dir, '.codebuddy');
  fs.mkdirSync(cbDir, { recursive: true });
  fs.writeFileSync(path.join(cbDir, 'hooks.json'), JSON.stringify(content));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UserHooksManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    resetUserHooksManager();
  });

  afterEach(() => {
    resetUserHooksManager();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  // ── loadConfig ──────────────────────────────────────────────────────────────

  describe('loadConfig()', () => {
    it('handles missing hooks.json gracefully', () => {
      const mgr = new UserHooksManager(tmpDir);
      expect(mgr.getActiveEvents()).toHaveLength(0);
    });

    it('loads event-keyed hooks from hooks.json', () => {
      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'command', command: 'echo hi' }],
          SessionStart: [{ type: 'command', command: 'echo start' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      expect(mgr.getActiveEvents()).toContain('PreToolUse');
      expect(mgr.getActiveEvents()).toContain('SessionStart');
      expect(mgr.getHandlers('PreToolUse')).toHaveLength(1);
    });

    it('handles malformed JSON without throwing', () => {
      const cbDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(cbDir, { recursive: true });
      fs.writeFileSync(path.join(cbDir, 'hooks.json'), '{ bad json }');
      expect(() => new UserHooksManager(tmpDir)).not.toThrow();
    });

    it('reloads via loadConfig()', () => {
      const mgr = new UserHooksManager(tmpDir);
      expect(mgr.getHandlers('Stop')).toHaveLength(0);

      writeHooksJson(tmpDir, { hooks: { Stop: [{ type: 'command', command: 'echo stop' }] } });
      mgr.loadConfig();
      expect(mgr.getHandlers('Stop')).toHaveLength(1);
    });
  });

  // ── conditional `if` matching ────────────────────────────────────────────────

  describe('conditional `if` matching', () => {
    it('runs handler when `if` matches tool name exactly', async () => {
      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'command', command: 'exit 0', if: 'bash' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });

    it('skips handler when `if` does not match tool name', async () => {
      // Use exit 2 to block — if `if` filters it out the result should be allowed
      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'command', command: 'exit 2', if: 'bash' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      // toolName is 'grep', not 'bash' — handler should be skipped → allowed
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'grep' });
      expect(result.allowed).toBe(true);
    });

    it('skips handler when `if` present but context has no toolName', async () => {
      writeHooksJson(tmpDir, {
        hooks: {
          SessionStart: [{ type: 'command', command: 'exit 2', if: 'bash' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('SessionStart', {});
      expect(result.allowed).toBe(true);
    });
  });

  // ── exit code semantics ──────────────────────────────────────────────────────

  describe('command handler — exit code semantics', () => {
    it('exit 0 → allowed', async () => {
      writeHooksJson(tmpDir, {
        hooks: { PreToolUse: [{ type: 'command', command: 'exit 0' }] },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });

    it('exit 2 → blocked with stderr as feedback', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? '(echo blocked message 1>&2) & exit 2'
        : 'echo "blocked message" >&2; exit 2';
      writeHooksJson(tmpDir, {
        hooks: { PreToolUse: [{ type: 'command', command: cmd }] },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(false);
      expect(result.feedback).toContain('blocked message');
    });

    it('exit 1 → non-blocking (allowed, warning only)', async () => {
      writeHooksJson(tmpDir, {
        hooks: { PreToolUse: [{ type: 'command', command: 'exit 1' }] },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });
  });

  // ── command stdout JSON parsing ───────────────────────────────────────────────

  describe('command handler — JSON stdout', () => {
    it('parses updatedInput from stdout JSON', async () => {
      // Write a .js script file that prints the JSON — avoids ALL shell quoting issues
      const jsonContent = JSON.stringify({ updatedInput: { foo: 'bar' } });
      const scriptFile = path.join(tmpDir, 'hook.js');
      // The script just console.logs the JSON (process.stdout.write for no newline)
      fs.writeFileSync(
        scriptFile,
        `process.stdout.write(${JSON.stringify(jsonContent)});`
      );
      const scriptSafe = scriptFile.replaceAll('\\', '/');
      const cmd = `node ${scriptSafe}`;
      writeHooksJson(tmpDir, {
        hooks: { PreToolUse: [{ type: 'command', command: cmd }] },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
      expect(result.updatedInput).toEqual({ foo: 'bar' });
    });

    it('allows plain-text stdout (no JSON parse needed)', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'echo plain text output' : 'echo "plain text output"';
      writeHooksJson(tmpDir, {
        hooks: { PreToolUse: [{ type: 'command', command: cmd }] },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });
  });

  // ── timeout ──────────────────────────────────────────────────────────────────

  describe('command handler — timeout', () => {
    it('times out gracefully and returns allowed (non-blocking)', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'timeout /t 10 /nobreak > nul' : 'sleep 10';
      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'command', command: cmd, timeout: 100 }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const start = Date.now();
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(Date.now() - start).toBeLessThan(3000);
      // Timeout is non-blocking — does not deny the action
      expect(result.allowed).toBe(true);
    }, 5000);
  });

  // ── HTTP handler ──────────────────────────────────────────────────────────────

  describe('http handler', () => {
    it('allowed on 200 response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      } as Response);

      writeHooksJson(tmpDir, {
        hooks: {
          PostToolUse: [{ type: 'http', url: 'https://example.com/hook' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PostToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });

    it('blocked on 403 response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Access denied',
      } as Response);

      writeHooksJson(tmpDir, {
        hooks: {
          PostToolUse: [{ type: 'http', url: 'https://example.com/hook' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PostToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(false);
      expect(result.feedback).toContain('Access denied');
    });

    it('allowed (non-blocking) on network error', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

      writeHooksJson(tmpDir, {
        hooks: {
          PostToolUse: [{ type: 'http', url: 'https://example.com/hook' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PostToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });

    it('resolves ${ENV_VAR} in headers', async () => {
      process.env.HOOK_TOKEN = 'test-secret';
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementationOnce((_url: string, opts: RequestInit) => {
        capturedHeaders = opts.headers as Record<string, string>;
        return Promise.resolve({ ok: true, status: 200, text: async () => '{}' } as Response);
      });

      writeHooksJson(tmpDir, {
        hooks: {
          SessionStart: [{
            type: 'http',
            url: 'https://example.com/hook',
            headers: { Authorization: 'Bearer ${HOOK_TOKEN}' },
          }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      await mgr.executeHooks('SessionStart', {});
      expect(capturedHeaders['Authorization']).toBe('Bearer test-secret');
      delete process.env.HOOK_TOKEN;
    });

    it('parses updatedInput from 200 JSON response body', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ updatedInput: { injected: true } }),
      } as Response);

      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'http', url: 'https://example.com/hook' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.updatedInput).toEqual({ injected: true });
    });

    it('blocked when JSON body has decision: block', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ decision: 'block', reason: 'policy violation' }),
      } as Response);

      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'http', url: 'https://example.com/hook' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(false);
      expect(result.feedback).toContain('policy violation');
    });
  });

  // ── prompt handler ─────────────────────────────────────────────────────────

  describe('prompt handler', () => {
    it('returns allowed when no evaluator is registered', async () => {
      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'prompt', prompt: 'Is this safe?' }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });
  });

  // ── agent handler ──────────────────────────────────────────────────────────

  describe('agent handler', () => {
    it('returns allowed when no spawner is registered', async () => {
      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'agent', agent: { prompt: 'Review this' } }],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });
  });

  // ── event with no handlers ─────────────────────────────────────────────────

  describe('event aggregation', () => {
    it('returns allowed when event has no handlers', async () => {
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('SessionEnd', {});
      expect(result.allowed).toBe(true);
    });

    it('first blocking handler short-circuits remaining handlers', async () => {
      const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' } as Response);
      global.fetch = spy;

      const isWin = process.platform === 'win32';
      const blockCmd = isWin ? '(echo blocked 1>&2) & exit 2' : 'echo "blocked" >&2; exit 2';

      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [
            { type: 'command', command: blockCmd },
            // This HTTP hook should NOT be called after the block
            { type: 'http', url: 'https://should-not-be-called.example.com/hook' },
          ],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('merges updatedInput from multiple passing handlers', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          text: async () => JSON.stringify({ updatedInput: { a: 1 } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          text: async () => JSON.stringify({ updatedInput: { b: 2 } }),
        } as Response);

      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [
            { type: 'http', url: 'https://example.com/hook1' },
            { type: 'http', url: 'https://example.com/hook2' },
          ],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const result = await mgr.executeHooks('PreToolUse', { toolName: 'bash' });
      expect(result.allowed).toBe(true);
      expect(result.updatedInput).toEqual({ a: 1, b: 2 });
    });
  });

  // ── singleton ──────────────────────────────────────────────────────────────

  describe('getUserHooksManager singleton', () => {
    it('returns same instance for same cwd', () => {
      const a = getUserHooksManager(tmpDir);
      const b = getUserHooksManager(tmpDir);
      expect(a).toBe(b);
    });

    it('creates new instance when cwd changes', () => {
      const tmpDir2 = makeTmpDir();
      try {
        const a = getUserHooksManager(tmpDir);
        const b = getUserHooksManager(tmpDir2);
        expect(a).not.toBe(b);
      } finally {
        fs.rmSync(tmpDir2, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    });

    it('resetUserHooksManager clears singleton', () => {
      const a = getUserHooksManager(tmpDir);
      resetUserHooksManager();
      const b = getUserHooksManager(tmpDir);
      expect(a).not.toBe(b);
    });
  });

  // ── getActiveEvents / getHandlers ──────────────────────────────────────────

  describe('getActiveEvents / getHandlers', () => {
    it('getActiveEvents returns only events with handlers', () => {
      writeHooksJson(tmpDir, {
        hooks: {
          PreToolUse: [{ type: 'command', command: 'exit 0' }],
          PostToolUse: [],
        },
      });
      const mgr = new UserHooksManager(tmpDir);
      const events = mgr.getActiveEvents();
      expect(events).toContain('PreToolUse');
      expect(events).not.toContain('PostToolUse');
    });

    it('getHandlers returns empty array for unknown event', () => {
      const mgr = new UserHooksManager(tmpDir);
      expect(mgr.getHandlers('FileChanged')).toEqual([]);
    });
  });
});
