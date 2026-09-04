/**
 * Tests for Quality Gate Middleware
 */

import {
  QualityGateMiddleware,
  createQualityGateMiddleware,
  DEFAULT_QUALITY_GATE_CONFIG,
  extractStructuredFindings,
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

// ── Implementation-complete detection uses structured tool calls ───
// The detector scanned assistant CONTENT text for "tool_call" (which lives in a
// separate field, so it never matched) and would report "complete" mid-work,
// firing the gate prematurely right after a tool round.

describe('detectImplementationComplete uses entry.toolCalls', () => {
  function assistantWithToolCalls(content: string): ChatEntry {
    return {
      type: 'assistant',
      content,
      timestamp: new Date(),
      toolCalls: [{ id: 'c1', type: 'function', function: { name: 'str_replace_editor', arguments: '{}' } }],
    };
  }
  const detect = (mw: QualityGateMiddleware, ctx: MiddlewareContext): boolean =>
    (mw as unknown as { detectImplementationComplete(c: MiddlewareContext): boolean }).detectImplementationComplete(ctx);

  it('is NOT complete when the latest assistant turn made structured tool calls', () => {
    const mw = new QualityGateMiddleware();
    const ctx = makeContext({
      history: [assistantWithToolCalls('Editing the file to add the new function and wiring it up now.')],
    });
    expect(detect(mw, ctx)).toBe(false); // still working — gate must not fire
  });

  it('IS complete when the latest assistant turn is prose with no tool calls', () => {
    const mw = new QualityGateMiddleware();
    const ctx = makeContext({
      history: [assistantEntry('I have finished implementing the feature and all edits are applied.')],
    });
    expect(detect(mw, ctx)).toBe(true);
  });

  it('is NOT complete for a trivial prose reply (<50 chars)', () => {
    const mw = new QualityGateMiddleware();
    const ctx = makeContext({ history: [assistantEntry('done')] });
    expect(detect(mw, ctx)).toBe(false);
  });
});

// ── V3: changedFiles drives gate selection ─────────────────────────
// The gate scraped tool_result TEXT for verbs (wrote/created/…), but editors
// emit unified diffs, so changedFiles was always empty → security-review never
// applied and code-guardian reviewed nothing. Now it consumes context.changedFiles.

describe('quality gate consumes context.changedFiles (V3)', () => {
  it('extractChangedFiles prefers context.changedFiles over the text scrape', () => {
    const mw = new QualityGateMiddleware();
    const ctx = makeContext({
      changedFiles: ['src/auth/login.ts'],
      // A diff-formatted result the legacy scrape can NOT parse.
      history: [toolResultEntry('--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -1 +1 @@', 'str_replace_editor')],
    });
    const files = (mw as unknown as { extractChangedFiles(c: MiddlewareContext): string[] }).extractChangedFiles(ctx);
    expect(files).toEqual(['src/auth/login.ts']);
  });

  it('security-review becomes applicable when an auth file is in changedFiles', () => {
    const mw = new QualityGateMiddleware();
    const files = ['src/auth/login.ts'];
    const gates = (mw as unknown as { filterApplicableGates(f: string[]): Array<{ id: string }> }).filterApplicableGates(files);
    expect(gates.map(g => g.id)).toContain('security-review');
    expect(gates.map(g => g.id)).toContain('code-guardian'); // always applicable
  });

  it('security-review is NOT applicable for a non-sensitive file', () => {
    const mw = new QualityGateMiddleware();
    const gates = (mw as unknown as { filterApplicableGates(f: string[]): Array<{ id: string }> }).filterApplicableGates(['src/util/math.ts']);
    expect(gates.map(g => g.id)).not.toContain('security-review');
    expect(gates.map(g => g.id)).toContain('code-guardian');
  });

  it('falls back to the legacy text scrape when changedFiles is empty', () => {
    const mw = new QualityGateMiddleware();
    const ctx = makeContext({
      changedFiles: [],
      history: [toolResultEntry('wrote `src/legacy.ts`')],
    });
    const files = (mw as unknown as { extractChangedFiles(c: MiddlewareContext): string[] }).extractChangedFiles(ctx);
    expect(files).toContain('src/legacy.ts');
  });
});

// ── Structured findings extraction ─────────────────────────────────
// The middleware used to DISCARD the agents' structured data and re-parse
// their prose with regexes; these pins guarantee the structure is read.

describe('extractStructuredFindings', () => {
  it('maps SecurityReview findings (severity/title/description/file/line/recommendation)', () => {
    const findings = extractStructuredFindings({
      findings: [
        {
          id: 'sec-1',
          title: 'Hardcoded credential',
          severity: 'critical',
          category: 'secrets',
          description: 'an AWS key is committed',
          file: 'src/config.ts',
          line: 12,
          recommendation: 'move it to the environment',
        },
      ],
      summary: { critical: 1 },
    })!;

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      severity: 'critical',
      message: 'Hardcoded credential — an AWS key is committed',
      file: 'src/config.ts',
      line: 12,
      recommendation: 'move it to the environment',
    });
  });

  it('maps CodeGuardian issues and normalises error/warning severities', () => {
    const findings = extractStructuredFindings({
      issues: [
        { type: 'bug', severity: 'error', file: 'a.ts', line: 3, message: 'null deref', suggestion: 'guard it' },
        { type: 'style', severity: 'warning', file: 'a.ts', message: 'long function' },
        { type: 'note', severity: 'info', file: 'b.ts', message: 'consider a test' },
      ],
    })!;

    expect(findings.map(f => f.severity)).toEqual(['high', 'medium', 'info']);
    expect(findings[0]!.recommendation).toBe('guard it');
    expect(findings[0]!.line).toBe(3);
  });

  it('returns null on unstructured data so the caller can fall back to text parsing', () => {
    expect(extractStructuredFindings(undefined)).toBeNull();
    expect(extractStructuredFindings('just prose')).toBeNull();
    expect(extractStructuredFindings({ report: 'text' })).toBeNull();
    expect(extractStructuredFindings({ findings: [] })).toBeNull();
    expect(extractStructuredFindings({ findings: [{ severity: 'high' }] })).toBeNull(); // no message
  });

  it('accepts a bare array of issue-shaped objects', () => {
    const findings = extractStructuredFindings([
      { severity: 'low', message: 'nit' },
    ])!;
    expect(findings).toEqual([{ severity: 'low', message: 'nit' }]);
  });
});

// ── DELEG3: multiplexed, fail-closed quality delegates ────────────

describe('quality gate delegated execution (DELEG3)', () => {
  const gates = [
    { id: 'code-guardian', agentId: 'code-guardian', action: 'find-issues', required: false },
    { id: 'security-review', agentId: 'security-review', action: 'quick-scan', required: false },
  ];

  const completedContext = makeContext({
    changedFiles: ['src/auth/login.ts'],
    history: [assistantEntry('Implementation is complete and the changed authentication code is ready for review.')],
  });

  function replaceGateExecutor(
    middleware: QualityGateMiddleware,
    execute: (gate: { id: string }) => Promise<unknown>,
  ): void {
    (middleware as unknown as {
      runSingleGate: (gate: { id: string }, files: string[]) => Promise<unknown>;
    }).runSingleGate = execute;
  }

  it('runs both gates concurrently and exposes their tagged multiplexed results', async () => {
    let active = 0;
    let maxActive = 0;
    const events: Array<{ agentId: string; kind: string; payload: unknown }> = [];
    const middleware = new QualityGateMiddleware(
      { gates },
      { onDelegateEvent: (event) => events.push(event) },
    );
    replaceGateExecutor(middleware, async (gate) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return {
        gateId: gate.id,
        passed: true,
        findings: [],
        structured: true,
      };
    });

    const result = await middleware.afterTurn(completedContext);

    expect(result.action).toBe('continue');
    expect(maxActive).toBe(2);
    expect(events.filter((event) => event.kind === 'output').map((event) => event.agentId).sort())
      .toEqual(['code-guardian', 'security-review']);
  });

  it('reports a throwing delegate as an incomplete review instead of a false green', async () => {
    const middleware = new QualityGateMiddleware({ gates });
    replaceGateExecutor(middleware, async (gate) => {
      if (gate.id === 'security-review') throw new Error('scanner crashed');
      return {
        gateId: gate.id,
        passed: true,
        findings: [],
        structured: true,
      };
    });

    const result = await middleware.afterTurn(completedContext);

    expect(result.action).toBe('warn');
    expect(result.message).toMatch(/incomplete review/i);
    expect(result.message).toContain('scanner crashed');
    expect(result.message).toContain('security-review');
  });

  it('reports delegate budget exhaustion and preserves the inherited default concurrency of one', async () => {
    const sameAgentGates = [
      { id: 'first-review', agentId: 'shared-reviewer', action: 'review-one', required: false },
      { id: 'second-review', agentId: 'shared-reviewer', action: 'review-two', required: false },
    ];
    const middleware = new QualityGateMiddleware({
      gates: sameAgentGates,
      delegateParentBudget: {
        maxTurns: 2,
        maxCostUsd: 1,
        maxContextTokens: 8_192,
      },
      delegateConcurrency: 1,
    });
    replaceGateExecutor(middleware, async (gate) => ({
      gateId: gate.id,
      passed: true,
      findings: [],
      structured: true,
    }));

    const result = await middleware.afterTurn(completedContext);

    expect(result.action).toBe('warn');
    expect(result.message).toMatch(/incomplete review/i);
    expect(result.message).toMatch(/turn budget exhausted/i);
  });
});
