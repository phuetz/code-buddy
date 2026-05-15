/**
 * Tests for Tool Filter Middleware
 */

import {
  ToolFilterMiddleware,
  createToolFilterMiddleware,
  DEFAULT_TOOL_FILTER_CONFIG,
} from '../../../src/agent/middleware/tool-filter-middleware.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';

// ── Helpers ────────────────────────────────────────────────────────

type TestTool = { type: string; function: { name: string; description?: string; parameters?: unknown } };

function makeContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  const state = new Map<string, unknown>();
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
    state,
    getState<T>(key: string): T | undefined { return state.get(key) as T | undefined; },
    setState<T>(key: string, value: T): void { state.set(key, value); },
    ...overrides,
  };
}

function makeTool(name: string, desc = ''): TestTool {
  return { type: 'function', function: { name, description: desc } };
}

const planModeMocks = vi.hoisted(() => ({
  filterToolsForMode: vi.fn((tools: TestTool[]) => tools),
}));

// Mock the sandbox registry import
vi.mock('../../../src/sandbox/sandbox-registry.js', () => ({
  getActiveSandboxBackend: vi.fn().mockResolvedValue(null), // No sandbox available
}));

// Mock the plan-mode import
vi.mock('../../../src/agent/plan-mode.js', () => ({
  filterToolsForMode: planModeMocks.filterToolsForMode,
}));

// ── Tests ──────────────────────────────────────────────────────────

describe('ToolFilterMiddleware', () => {
  beforeEach(() => {
    planModeMocks.filterToolsForMode.mockReset();
    planModeMocks.filterToolsForMode.mockImplementation((tools: TestTool[]) => tools);
  });

  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const mw = new ToolFilterMiddleware();
      expect(mw.getConfig()).toEqual(DEFAULT_TOOL_FILTER_CONFIG);
    });

    it('merges partial config with defaults', () => {
      const mw = new ToolFilterMiddleware({ failureThreshold: 5 });
      const config = mw.getConfig();
      expect(config.failureThreshold).toBe(5);
      expect(config.checkSandbox).toBe(true);
    });

    it('has correct name and priority', () => {
      const mw = new ToolFilterMiddleware();
      expect(mw.name).toBe('tool-filter');
      expect(mw.priority).toBe(50);
    });
  });

  describe('beforeTurn', () => {
    it('returns continue when no tools in context', async () => {
      const mw = new ToolFilterMiddleware();
      const result = await mw.beforeTurn(makeContext());
      expect(result.action).toBe('continue');
    });

    it('returns continue when tools array is empty', async () => {
      const mw = new ToolFilterMiddleware();
      const result = await mw.beforeTurn(makeContext({ tools: [] }));
      expect(result.action).toBe('continue');
    });

    it('removes sandbox-requiring tools when no sandbox available', async () => {
      const mw = new ToolFilterMiddleware();
      const ctx = makeContext({
        tools: [
          makeTool('bash'),
          makeTool('read_file'),
          makeTool('run_script'),
          makeTool('grep'),
        ],
      });

      await mw.beforeTurn(ctx);

      const remaining = ctx.tools!.map(t => t.function.name);
      expect(remaining).not.toContain('bash');
      expect(remaining).not.toContain('run_script');
      expect(remaining).toContain('read_file');
      expect(remaining).toContain('grep');
    });

    it('skips sandbox check when disabled', async () => {
      const mw = new ToolFilterMiddleware({ checkSandbox: false });
      const ctx = makeContext({
        tools: [makeTool('bash'), makeTool('read_file')],
      });

      await mw.beforeTurn(ctx);

      const remaining = ctx.tools!.map(t => t.function.name);
      expect(remaining).toContain('bash');
      expect(remaining).toContain('read_file');
    });

    it('warns after consecutive failures of same tool', async () => {
      const mw = new ToolFilterMiddleware({
        checkSandbox: false,
        failureThreshold: 3,
      });

      // Simulate 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        const ctx = makeContext({
          tools: [makeTool('bash')],
          lastToolResults: [{ toolName: 'grep', success: false, output: 'error' }],
        });
        const result = await mw.beforeTurn(ctx);

        if (i < 2) {
          expect(result.action).toBe('continue');
        } else {
          expect(result.action).toBe('warn');
          expect(result.message).toContain('grep');
          expect(result.message).toContain('3 consecutive times');
        }
      }
    });

    it('resets failure count on success', async () => {
      const mw = new ToolFilterMiddleware({
        checkSandbox: false,
        failureThreshold: 3,
      });

      // Two failures
      await mw.beforeTurn(makeContext({
        tools: [makeTool('bash')],
        lastToolResults: [{ toolName: 'grep', success: false, output: 'error' }],
      }));
      await mw.beforeTurn(makeContext({
        tools: [makeTool('bash')],
        lastToolResults: [{ toolName: 'grep', success: false, output: 'error' }],
      }));

      // Success resets
      await mw.beforeTurn(makeContext({
        tools: [makeTool('bash')],
        lastToolResults: [{ toolName: 'grep', success: true, output: 'ok' }],
      }));

      // Another failure — count should be back to 1
      const result = await mw.beforeTurn(makeContext({
        tools: [makeTool('bash')],
        lastToolResults: [{ toolName: 'grep', success: false, output: 'error' }],
      }));

      expect(result.action).toBe('continue');
    });

    it('does not warn for same tool twice', async () => {
      const mw = new ToolFilterMiddleware({
        checkSandbox: false,
        failureThreshold: 2,
      });

      // First batch of failures — triggers warn
      await mw.beforeTurn(makeContext({
        tools: [makeTool('bash')],
        lastToolResults: [{ toolName: 'grep', success: false, output: 'error' }],
      }));
      const first = await mw.beforeTurn(makeContext({
        tools: [makeTool('bash')],
        lastToolResults: [{ toolName: 'grep', success: false, output: 'error' }],
      }));
      expect(first.action).toBe('warn');

      // Additional failure — should not warn again
      const second = await mw.beforeTurn(makeContext({
        tools: [makeTool('bash')],
        lastToolResults: [{ toolName: 'grep', success: false, output: 'error' }],
      }));
      expect(second.action).toBe('continue');
    });

    it('warns when plan-mode filtering is unavailable', async () => {
      planModeMocks.filterToolsForMode.mockImplementationOnce(() => {
        throw new Error('plan mode import failed');
      });
      const mw = new ToolFilterMiddleware({ checkSandbox: false });
      const ctx = makeContext({ tools: [makeTool('write_file'), makeTool('read_file')] });

      const result = await mw.beforeTurn(ctx);

      expect(result.action).toBe('warn');
      expect(result.message).toContain('Plan-mode tool filtering is unavailable');
      expect(result.message).toContain('plan mode import failed');
    });
  });

  describe('resetFailures', () => {
    it('clears failure tracking state', async () => {
      const mw = new ToolFilterMiddleware({ checkSandbox: false, failureThreshold: 2 });

      // Accumulate failures
      await mw.beforeTurn(makeContext({
        tools: [makeTool('bash')],
        lastToolResults: [{ toolName: 'grep', success: false, output: 'error' }],
      }));

      expect(mw.getFailureCounts().get('grep')).toBe(1);

      mw.resetFailures();

      expect(mw.getFailureCounts().size).toBe(0);
    });
  });

  describe('factory', () => {
    it('createToolFilterMiddleware returns instance', () => {
      const mw = createToolFilterMiddleware();
      expect(mw).toBeInstanceOf(ToolFilterMiddleware);
      expect(mw.name).toBe('tool-filter');
    });
  });
});
