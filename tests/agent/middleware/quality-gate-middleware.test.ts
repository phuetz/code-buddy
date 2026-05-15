/**
 * Tests for Quality Gate Middleware
 */

const agentRegistryMocks = vi.hoisted(() => ({
  registerBuiltInAgents: vi.fn(),
  executeOn: vi.fn(),
}));

vi.mock('../../../src/agent/specialized/agent-registry.js', () => ({
  AgentRegistry: vi.fn().mockImplementation(function() {
    return {
      registerBuiltInAgents: agentRegistryMocks.registerBuiltInAgents,
      executeOn: agentRegistryMocks.executeOn,
    };
  }),
}));

import {
  QualityGateMiddleware,
  createQualityGateMiddleware,
  DEFAULT_QUALITY_GATE_CONFIG,
} from '../../../src/agent/middleware/quality-gate-middleware.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';
import type { ChatEntry } from '../../../src/agent/types.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    toolRound: 5,
    maxToolRounds: 50,
    sessionCost: 0.5,
    sessionCostLimit: 10,
    inputTokens: 5000,
    outputTokens: 2000,
    history: [],
    messages: [],
    isStreaming: false,
    ...overrides,
  };
}

function assistantEntry(content: string): ChatEntry {
  return {
    type: 'assistant',
    content,
    timestamp: new Date(),
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

// ── Tests ──────────────────────────────────────────────────────────

describe('QualityGateMiddleware', () => {
  beforeEach(() => {
    agentRegistryMocks.registerBuiltInAgents.mockReset();
    agentRegistryMocks.executeOn.mockReset();
    agentRegistryMocks.registerBuiltInAgents.mockResolvedValue(undefined);
    agentRegistryMocks.executeOn.mockResolvedValue({ success: true, output: '' });
  });

  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const mw = new QualityGateMiddleware();
      const config = mw.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.gates).toHaveLength(2);
      expect(config.minRoundsBeforeGate).toBe(3);
      expect(config.maxGateRuns).toBe(2);
    });

    it('merges partial config with defaults', () => {
      const mw = new QualityGateMiddleware({ maxGateRuns: 5 });
      expect(mw.getConfig().maxGateRuns).toBe(5);
      expect(mw.getConfig().enabled).toBe(true);
    });

    it('has correct name and priority', () => {
      const mw = new QualityGateMiddleware();
      expect(mw.name).toBe('quality-gate');
      expect(mw.priority).toBe(200);
    });
  });

  describe('afterTurn', () => {
    it('returns continue when disabled', async () => {
      const mw = new QualityGateMiddleware({ enabled: false });
      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('continue');
    });

    it('returns continue when too few rounds', async () => {
      const mw = new QualityGateMiddleware();
      const ctx = makeContext({ toolRound: 1 });
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('returns continue when max gate runs reached', async () => {
      const mw = new QualityGateMiddleware({ maxGateRuns: 0 });
      const ctx = makeContext({
        toolRound: 10,
        history: [
          assistantEntry('Implementation complete. All changes have been made.'),
        ],
      });
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('returns continue when no implementation completion detected', async () => {
      const mw = new QualityGateMiddleware();
      const ctx = makeContext({
        toolRound: 5,
        history: [
          toolResultEntry('some tool output'),
        ],
      });
      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('returns continue when no applicable gates match', async () => {
      const mw = new QualityGateMiddleware({
        gates: [{
          id: 'security-only',
          agentId: 'security-review',
          action: 'scan',
          required: false,
          filePatterns: [/auth\.ts$/],
        }],
      });

      const ctx = makeContext({
        toolRound: 5,
        history: [
          toolResultEntry('wrote readme.md'),
          assistantEntry('I have completed the implementation of the readme file with the required content.'),
        ],
      });

      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('warns instead of silently passing when a gate cannot execute', async () => {
      agentRegistryMocks.registerBuiltInAgents.mockRejectedValueOnce(new Error('registry unavailable'));
      const mw = new QualityGateMiddleware({
        minRoundsBeforeGate: 0,
        maxGateRuns: 1,
        gates: [{
          id: 'code-guardian',
          agentId: 'code-guardian',
          action: 'review',
          required: false,
        }],
      });

      const ctx = makeContext({
        toolRound: 5,
        history: [
          toolResultEntry('wrote src/app.ts'),
          assistantEntry('Implementation complete. All requested code changes have been made and are ready for review.'),
        ],
      });

      const result = await mw.afterTurn(ctx);
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Quality gate code-guardian failed to execute');
      expect(result.message).toContain('registry unavailable');
    });
  });

  describe('resetGateCount', () => {
    it('resets the gate run counter', () => {
      const mw = new QualityGateMiddleware();
      mw.resetGateCount();
      expect(mw.getGateRunCount()).toBe(0);
    });
  });

  describe('createQualityGateMiddleware', () => {
    it('creates an instance with default config', () => {
      const mw = createQualityGateMiddleware();
      expect(mw).toBeInstanceOf(QualityGateMiddleware);
      expect(mw.name).toBe('quality-gate');
    });

    it('creates an instance with custom config', () => {
      const mw = createQualityGateMiddleware({
        minRoundsBeforeGate: 10,
        gates: [],
      });
      expect(mw.getConfig().minRoundsBeforeGate).toBe(10);
      expect(mw.getConfig().gates).toHaveLength(0);
    });
  });

  describe('default gates configuration', () => {
    it('includes code-guardian gate', () => {
      const config = DEFAULT_QUALITY_GATE_CONFIG;
      const cg = config.gates.find(g => g.id === 'code-guardian');
      expect(cg).toBeDefined();
      expect(cg!.agentId).toBe('code-guardian');
      expect(cg!.required).toBe(false);
    });

    it('includes security-review gate with file patterns', () => {
      const config = DEFAULT_QUALITY_GATE_CONFIG;
      const sr = config.gates.find(g => g.id === 'security-review');
      expect(sr).toBeDefined();
      expect(sr!.filePatterns).toBeDefined();
      expect(sr!.filePatterns!.length).toBeGreaterThan(0);

      expect(sr!.filePatterns!.some(p => p.test('auth.ts'))).toBe(true);
      expect(sr!.filePatterns!.some(p => p.test('.env'))).toBe(true);
      expect(sr!.filePatterns!.some(p => p.test('password-utils.ts'))).toBe(true);
    });
  });
});
