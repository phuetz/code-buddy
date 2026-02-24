/**
 * Tests for ReasoningMiddleware and detectComplexity
 *
 * Covers complexity scoring, middleware guidance injection,
 * auto-detect toggling, and double-injection prevention.
 */

import {
  detectComplexity,
  ReasoningMiddleware,
  createReasoningMiddleware,
} from '../../src/agent/middleware/reasoning-middleware.js';
import type { MiddlewareContext } from '../../src/agent/middleware/types.js';

// Mock the think-handlers module so getActiveThinkingMode is controllable
let mockActiveMode: string | null = null;

jest.mock('../../src/commands/handlers/think-handlers.js', () => ({
  getActiveThinkingMode: () => mockActiveMode,
}));

// ── Helper ──────────────────────────────────────────────────────────────

function makeContext(
  userMessages: string[],
  extraMessages: Array<{ role: string; content: string }> = [],
): MiddlewareContext {
  const messages = [
    ...extraMessages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
    ...userMessages.map((content) => ({ role: 'user' as const, content })),
  ];
  return {
    toolRound: 0,
    maxToolRounds: 50,
    sessionCost: 0,
    sessionCostLimit: 10,
    inputTokens: 0,
    outputTokens: 0,
    history: [],
    messages: messages as MiddlewareContext['messages'],
    isStreaming: false,
  };
}

// ── detectComplexity ────────────────────────────────────────────────────

describe('detectComplexity', () => {
  it('returns "none" for simple greetings', () => {
    const result = detectComplexity('hello');
    expect(result.level).toBe('none');
    expect(result.score).toBeLessThan(3);
  });

  it('returns "none" for a trivial fix request', () => {
    const result = detectComplexity('fix typo');
    expect(result.level).toBe('none');
    expect(result.score).toBeLessThan(3);
  });

  it('returns "none" for short questions without action verbs', () => {
    const result = detectComplexity('what is this file?');
    expect(result.level).toBe('none');
    expect(result.score).toBeLessThan(3);
  });

  it('returns "cot" for moderately complex messages with action verbs', () => {
    // "refactor", "implement", "plan" are action verbs => 3 points
    const result = detectComplexity(
      'refactor and implement the new plan for the module',
    );
    expect(result.level).toBe('cot');
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeLessThan(6);
    expect(result.signals.actionVerbs).toBeGreaterThanOrEqual(2);
  });

  it('returns "cot" for messages scoring 3-5', () => {
    // "optimize" (1 action verb) + "must" + "ensure" (2 constraint) = 3
    const result = detectComplexity(
      'optimize the loop and ensure it must run fast',
    );
    expect(result.level).toBe('cot');
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeLessThanOrEqual(5);
  });

  it('returns "tot" for complex messages with constraints and exploration language', () => {
    // action: refactor, implement, design (3)
    // constraint: must, ensure, without (3 capped at 3)
    // exploration: compare (1)
    // => 7 => tot
    const result = detectComplexity(
      'refactor and implement a new design. You must ensure correctness ' +
      'without breaking changes. Compare the alternatives.',
    );
    expect(result.level).toBe('tot');
    expect(result.score).toBeGreaterThanOrEqual(6);
    expect(result.score).toBeLessThan(10);
  });

  it('returns "tot" for messages scoring 6-9', () => {
    // action: implement, architect, plan (3)
    // constraint: must, require, constraint (3)
    // => 6 => tot
    const result = detectComplexity(
      'implement and architect a plan that must require every constraint',
    );
    expect(result.level).toBe('tot');
    expect(result.score).toBeGreaterThanOrEqual(6);
  });

  it('returns "mcts" for very complex messages with many signals', () => {
    // action: refactor, implement, design, optimize, architect, migrate (6)
    // constraint: must, require, ensure (3 capped)
    // exploration: compare, evaluate, alternative (3 capped)
    // multi-step: then, next, finally (1.5)
    // => 6+3+3+1.5 = 13.5 => mcts
    const result = detectComplexity(
      'refactor and implement the design. Optimize the architecture, ' +
      'architect the migration, and migrate the data layer. ' +
      'You must require correctness and ensure reliability. ' +
      'Compare approaches, evaluate trade-offs, and pick the best alternative. ' +
      'First do X, then do Y, next do Z, and finally deploy.',
    );
    expect(result.level).toBe('mcts');
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it('awards length bonus for messages over 100 words', () => {
    // Generate a message with >100 words plus one action verb
    const filler = Array(100).fill('word').join(' ');
    const message = `implement the following: ${filler}`;
    const result = detectComplexity(message);
    expect(result.signals.lengthBonus).toBe(1);
  });

  it('does NOT award length bonus for short messages', () => {
    const result = detectComplexity('implement it');
    expect(result.signals.lengthBonus).toBe(0);
  });

  it('caps constraint language at 3', () => {
    // All 6 constraint words: must, require, ensure, without, except, constraint
    const result = detectComplexity(
      'must require ensure without except constraint',
    );
    expect(result.signals.constraintLanguage).toBe(3);
  });

  it('caps exploration language at 3', () => {
    // All exploration words
    const result = detectComplexity(
      'explore compare evaluate trade-off tradeoff alternative best approach',
    );
    expect(result.signals.explorationLanguage).toBe(3);
  });

  it('caps multi-step indicators at 2 points', () => {
    // 6 multi-step indicators * 0.5 = 3, capped at 2
    const result = detectComplexity(
      'then after that next finally also additionally',
    );
    expect(result.signals.multiStepIndicators).toBe(2);
  });

  it('returns all signal fields in the result', () => {
    const result = detectComplexity('hello');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('level');
    expect(result).toHaveProperty('signals');
    expect(result.signals).toHaveProperty('actionVerbs');
    expect(result.signals).toHaveProperty('constraintLanguage');
    expect(result.signals).toHaveProperty('explorationLanguage');
    expect(result.signals).toHaveProperty('multiStepIndicators');
    expect(result.signals).toHaveProperty('lengthBonus');
  });

  it('handles multi-word phrases like "best approach"', () => {
    const result = detectComplexity('what is the best approach here?');
    expect(result.signals.explorationLanguage).toBeGreaterThanOrEqual(1);
  });

  it('handles hyphenated phrases like "trade-off"', () => {
    const result = detectComplexity('consider the trade-off carefully');
    expect(result.signals.explorationLanguage).toBeGreaterThanOrEqual(1);
  });
});

// ── ReasoningMiddleware ─────────────────────────────────────────────────

describe('ReasoningMiddleware', () => {
  let middleware: ReasoningMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveMode = null;
    middleware = new ReasoningMiddleware();
  });

  it('has the correct name and priority', () => {
    expect(middleware.name).toBe('reasoning');
    expect(middleware.priority).toBe(42);
  });

  // ── Explicit thinking mode ──────────────────────────────────────────

  it('injects guidance when explicit thinking mode is set', async () => {
    mockActiveMode = 'medium';
    const ctx = makeContext(['hello']);

    const result = await middleware.beforeTurn(ctx);

    expect(result.action).toBe('continue');
    // Guidance system message should have been appended
    const injected = ctx.messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(injected).toBeDefined();
  });

  it('injects for any explicit mode regardless of message complexity', async () => {
    mockActiveMode = 'shallow';
    const ctx = makeContext(['hi']); // trivially simple

    await middleware.beforeTurn(ctx);

    const hasGuidance = ctx.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(hasGuidance).toBe(true);
  });

  // ── Auto-detect ─────────────────────────────────────────────────────

  it('injects guidance on auto-detect when complexity is tot', async () => {
    const complexMessage =
      'refactor and implement a new design. You must ensure correctness ' +
      'without breaking changes. Compare the alternatives.';
    const ctx = makeContext([complexMessage]);

    await middleware.beforeTurn(ctx);

    const hasGuidance = ctx.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(hasGuidance).toBe(true);
  });

  it('injects guidance on auto-detect when complexity is mcts', async () => {
    const veryComplex =
      'refactor, implement, design, optimize, architect, and migrate. ' +
      'You must require correctness and ensure reliability. ' +
      'Compare approaches, evaluate trade-offs, and pick the best alternative. ' +
      'Then do X, next do Y, finally deploy.';
    const ctx = makeContext([veryComplex]);

    await middleware.beforeTurn(ctx);

    const hasGuidance = ctx.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(hasGuidance).toBe(true);
  });

  it('does NOT inject guidance for simple messages', async () => {
    const ctx = makeContext(['hello world']);

    await middleware.beforeTurn(ctx);

    const hasGuidance = ctx.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(hasGuidance).toBe(false);
  });

  it('does NOT inject guidance for cot-level messages (auto-detect only fires for tot/mcts)', async () => {
    // "implement the plan" => cot level (action verb only)
    const ctx = makeContext(['implement the plan for the module']);

    await middleware.beforeTurn(ctx);

    const hasGuidance = ctx.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(hasGuidance).toBe(false);
  });

  // ── Double-injection prevention ─────────────────────────────────────

  it('does NOT double-inject guidance', async () => {
    mockActiveMode = 'deep';
    const ctx = makeContext(['anything']);

    // Call twice
    await middleware.beforeTurn(ctx);
    await middleware.beforeTurn(ctx);

    const guidanceMessages = ctx.messages.filter(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(guidanceMessages).toHaveLength(1);
  });

  it('does NOT inject if guidance is already present from another source', async () => {
    mockActiveMode = 'medium';
    const ctx = makeContext(['test'], [
      {
        role: 'system',
        content: '<reasoning_guidance>already here</reasoning_guidance>',
      },
    ]);

    await middleware.beforeTurn(ctx);

    const guidanceMessages = ctx.messages.filter(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(guidanceMessages).toHaveLength(1);
  });

  // ── setAutoDetect ───────────────────────────────────────────────────

  it('setAutoDetect(false) disables auto-detection', async () => {
    middleware.setAutoDetect(false);

    // A complex message that would normally trigger injection
    const complexMessage =
      'refactor and implement a new design. You must ensure correctness ' +
      'without breaking changes. Compare the alternatives.';
    const ctx = makeContext([complexMessage]);

    await middleware.beforeTurn(ctx);

    const hasGuidance = ctx.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(hasGuidance).toBe(false);
  });

  it('setAutoDetect(true) re-enables auto-detection', async () => {
    middleware.setAutoDetect(false);
    middleware.setAutoDetect(true);

    const complexMessage =
      'refactor and implement a new design. You must ensure correctness ' +
      'without breaking changes. Compare the alternatives.';
    const ctx = makeContext([complexMessage]);

    await middleware.beforeTurn(ctx);

    const hasGuidance = ctx.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(hasGuidance).toBe(true);
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it('handles empty message array gracefully', async () => {
    const ctx: MiddlewareContext = {
      toolRound: 0,
      maxToolRounds: 50,
      sessionCost: 0,
      sessionCostLimit: 10,
      inputTokens: 0,
      outputTokens: 0,
      history: [],
      messages: [],
      isStreaming: false,
    };

    const result = await middleware.beforeTurn(ctx);
    expect(result.action).toBe('continue');
  });

  it('uses the last user message for complexity detection', async () => {
    const ctx = makeContext([], [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      {
        role: 'user',
        content:
          'refactor and implement a new design. You must ensure correctness ' +
          'without breaking changes. Compare the alternatives.',
      },
    ]);

    await middleware.beforeTurn(ctx);

    const hasGuidance = ctx.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<reasoning_guidance>'),
    );
    expect(hasGuidance).toBe(true);
  });

  it('always returns { action: "continue" }', async () => {
    const ctx = makeContext(['anything']);
    const result = await middleware.beforeTurn(ctx);
    expect(result).toEqual({ action: 'continue' });
  });
});

// ── createReasoningMiddleware factory ───────────────────────────────────

describe('createReasoningMiddleware', () => {
  it('creates an instance with default options', () => {
    const mw = createReasoningMiddleware();
    expect(mw).toBeInstanceOf(ReasoningMiddleware);
    expect(mw.name).toBe('reasoning');
  });

  it('creates an instance with autoDetect disabled', () => {
    const mw = createReasoningMiddleware({ autoDetect: false });
    expect(mw).toBeInstanceOf(ReasoningMiddleware);
  });
});
