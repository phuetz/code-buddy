/**
 * Tests for Auto-Repair Middleware
 */

import {
  AutoRepairMiddleware,
  createAutoRepairMiddleware,
  DEFAULT_AUTO_REPAIR_CONFIG,
} from '../../../src/agent/middleware/auto-repair-middleware.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';
import type { ChatEntry } from '../../../src/agent/types.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    toolRound: 5,
    maxToolRounds: 50,
    sessionCost: 0.1,
    sessionCostLimit: 10,
    inputTokens: 1000,
    outputTokens: 500,
    history: [],
    messages: [],
    isStreaming: false,
    ...overrides,
  };
}

function toolResultEntry(content: string, toolName = 'bash'): ChatEntry {
  return {
    type: 'tool_result',
    content,
    timestamp: new Date(),
    toolCall: {
      id: 'call-1',
      type: 'function',
      function: { name: toolName, arguments: '{}' },
    },
  };
}

function assistantEntry(content: string): ChatEntry {
  return {
    type: 'assistant',
    content,
    timestamp: new Date(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('AutoRepairMiddleware', () => {
  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const mw = new AutoRepairMiddleware();
      expect(mw.getConfig()).toEqual(DEFAULT_AUTO_REPAIR_CONFIG);
    });

    it('merges partial config with defaults', () => {
      const mw = new AutoRepairMiddleware({ maxRepairAttempts: 5 });
      const config = mw.getConfig();
      expect(config.maxRepairAttempts).toBe(5);
      expect(config.enabled).toBe(true);
    });

    it('has correct name and priority', () => {
      const mw = new AutoRepairMiddleware();
      expect(mw.name).toBe('auto-repair');
      expect(mw.priority).toBe(150);
    });
  });

  describe('afterTurn', () => {
    it('returns continue when disabled', async () => {
      const mw = new AutoRepairMiddleware({ enabled: false });
      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('continue');
    });

    it('returns continue when no tool failures in history', async () => {
      const mw = new AutoRepairMiddleware();
      const ctx = makeContext({
        history: [
          toolResultEntry('All tests passed', 'run_tests'),
          assistantEntry('Tests are green!'),
        ],
      });
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('detects error in bash tool output', async () => {
      const mw = new AutoRepairMiddleware();
      const ctx = makeContext({
        history: [
          toolResultEntry('SyntaxError: Unexpected token at line 42', 'bash'),
        ],
      });
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Auto-Repair');
      expect(result.message).toContain('bash');
    });

    it('detects FAIL pattern', async () => {
      const mw = new AutoRepairMiddleware();
      const ctx = makeContext({
        history: [
          toolResultEntry('FAIL src/tests/foo.test.ts', 'run_tests'),
        ],
      });
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('warn');
    });

    it('detects exit code errors', async () => {
      const mw = new AutoRepairMiddleware();
      const ctx = makeContext({
        history: [
          toolResultEntry('Process exited with exit code 1', 'bash'),
        ],
      });
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('warn');
    });

    it('ignores non-trigger tools', async () => {
      const mw = new AutoRepairMiddleware();
      const ctx = makeContext({
        history: [
          toolResultEntry('SyntaxError: bad code', 'file_read'),
        ],
      });
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('stops after max repair attempts', async () => {
      const mw = new AutoRepairMiddleware({ maxRepairAttempts: 2 });
      const ctx = makeContext({
        history: [
          toolResultEntry('error: something broke', 'bash'),
        ],
      });

      // First attempt
      const r1 = await mw.afterTurn(ctx);
      expect(r1.action).toBe('warn');

      // Second attempt
      const r2 = await mw.afterTurn(ctx);
      expect(r2.action).toBe('warn');

      // Third attempt — blocked
      const r3 = await mw.afterTurn(ctx);
      expect(r3.action).toBe('continue');
    });

    it('includes attempt count in message', async () => {
      const mw = new AutoRepairMiddleware();
      const ctx = makeContext({
        history: [
          toolResultEntry('TypeError: undefined is not a function', 'bash'),
        ],
      });

      const result = await mw.afterTurn(ctx);
      expect(result.message).toContain('1/3');
    });
  });

  describe('resetAttempts', () => {
    it('resets the attempt counter', async () => {
      const mw = new AutoRepairMiddleware({ maxRepairAttempts: 1 });
      const ctx = makeContext({
        history: [
          toolResultEntry('error in code', 'bash'),
        ],
      });

      await mw.afterTurn(ctx);
      expect(mw.getAttemptCount()).toBe(1);

      mw.resetAttempts();
      expect(mw.getAttemptCount()).toBe(0);

      // Can repair again after reset
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('warn');
    });
  });

  describe('createAutoRepairMiddleware', () => {
    it('creates an instance with default config', () => {
      const mw = createAutoRepairMiddleware();
      expect(mw).toBeInstanceOf(AutoRepairMiddleware);
      expect(mw.name).toBe('auto-repair');
    });

    it('creates an instance with custom config', () => {
      const mw = createAutoRepairMiddleware({ maxRepairAttempts: 10 });
      expect(mw.getConfig().maxRepairAttempts).toBe(10);
    });
  });
});
