/**
 * Middleware System Tests
 */

import {
  MiddlewareAction,
  ConversationContext,
  ConversationStats,
  ModelInfo,
  createInitialStats,
  defaultModelInfo,
  TurnLimitMiddleware,
  PriceLimitMiddleware,
  AutoCompactMiddleware,
  ContextWarningMiddleware,
  RateLimitMiddleware,
  ToolExecutionLimitMiddleware,
  MiddlewarePipeline,
  createPipeline,
  createDefaultMiddlewares,
  createYoloMiddlewares,
} from '../src/middleware/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(overrides: Partial<{
  stats: Partial<ConversationStats>;
  model: Partial<ModelInfo>;
  messageCount: number;
}>): ConversationContext {
  const baseStats = createInitialStats();
  const baseModel = defaultModelInfo();

  return {
    messages: Array(overrides.messageCount || 10).fill({ role: 'user', content: 'test' }),
    stats: { ...baseStats, ...overrides.stats },
    model: { ...baseModel, ...overrides.model },
    workingDirectory: '/test',
    sessionId: 'test-session',
    autoApprove: false,
    metadata: {},
  };
}

// ============================================================================
// TurnLimitMiddleware Tests
// ============================================================================

describe('TurnLimitMiddleware', () => {
  it('should continue when under limit', async () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100 });
    const context = createTestContext({ stats: { turns: 50 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should stop when at limit', async () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100 });
    const context = createTestContext({ stats: { turns: 100 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.STOP);
    expect(result.message).toContain('100');
  });

  it('should warn when approaching limit', async () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100, warningThreshold: 0.8 });
    const context = createTestContext({ stats: { turns: 80 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
    expect(result.message).toContain('Warning');
  });

  it('should only warn once', async () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100, warningThreshold: 0.8 });
    const context = createTestContext({ stats: { turns: 80 } });

    const result1 = await middleware.beforeTurn(context);
    const result2 = await middleware.beforeTurn(context);

    expect(result1.action).toBe(MiddlewareAction.INJECT_MESSAGE);
    expect(result2.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should reset warning state', async () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100, warningThreshold: 0.8 });
    const context = createTestContext({ stats: { turns: 80 } });

    await middleware.beforeTurn(context);
    middleware.reset();
    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
  });
});

// ============================================================================
// PriceLimitMiddleware Tests
// ============================================================================

describe('PriceLimitMiddleware', () => {
  it('should continue when under cost limit', async () => {
    const middleware = new PriceLimitMiddleware({ maxCost: 10 });
    const context = createTestContext({ stats: { sessionCost: 5 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should stop when at cost limit', async () => {
    const middleware = new PriceLimitMiddleware({ maxCost: 10 });
    const context = createTestContext({ stats: { sessionCost: 10 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.STOP);
    expect(result.message).toContain('$10.00');
  });

  it('should warn when approaching cost limit', async () => {
    const middleware = new PriceLimitMiddleware({ maxCost: 10, warningThreshold: 0.8 });
    const context = createTestContext({ stats: { sessionCost: 8 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
    expect(result.message).toContain('Warning');
    expect(result.message).toContain('remaining');
  });

  it('should check cost after turn', async () => {
    const middleware = new PriceLimitMiddleware({ maxCost: 10 });
    const context = createTestContext({ stats: { sessionCost: 12 } });

    const result = await middleware.afterTurn(context);

    expect(result.action).toBe(MiddlewareAction.STOP);
  });
});

// ============================================================================
// AutoCompactMiddleware Tests
// ============================================================================

describe('AutoCompactMiddleware', () => {
  it('should continue when under token threshold', async () => {
    const middleware = new AutoCompactMiddleware({ tokenThreshold: 80000 });
    const context = createTestContext({ stats: { totalTokens: 40000 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should compact when over token threshold', async () => {
    const middleware = new AutoCompactMiddleware({ tokenThreshold: 80000 });
    const context = createTestContext({
      stats: { totalTokens: 85000 },
      messageCount: 20,
    });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.COMPACT);
    expect(result.reason).toContain('85000');
  });

  it('should not compact if too few messages', async () => {
    const middleware = new AutoCompactMiddleware({
      tokenThreshold: 80000,
      minMessagesToKeep: 10,
    });
    const context = createTestContext({
      stats: { totalTokens: 85000 },
      messageCount: 5,
    });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should use context percentage for threshold', async () => {
    const middleware = new AutoCompactMiddleware({
      tokenThreshold: 200000,
      contextPercentage: 0.5,
    });
    const context = createTestContext({
      stats: { totalTokens: 70000 },
      model: { maxContextTokens: 128000 },
      messageCount: 20,
    });

    const result = await middleware.beforeTurn(context);

    // 128000 * 0.5 = 64000, so 70000 should trigger compact
    expect(result.action).toBe(MiddlewareAction.COMPACT);
  });
});

// ============================================================================
// ContextWarningMiddleware Tests
// ============================================================================

describe('ContextWarningMiddleware', () => {
  it('should continue when context usage is low', async () => {
    const middleware = new ContextWarningMiddleware({ warningPercentage: 0.7 });
    const context = createTestContext({
      stats: { totalTokens: 50000 },
      model: { maxContextTokens: 128000 },
    });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should warn when context usage is high', async () => {
    const middleware = new ContextWarningMiddleware({ warningPercentage: 0.7 });
    const context = createTestContext({
      stats: { totalTokens: 100000 },
      model: { maxContextTokens: 128000 },
    });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
    expect(result.message).toContain('Context usage');
  });

  it('should only warn once when warnOnce is true', async () => {
    const middleware = new ContextWarningMiddleware({
      warningPercentage: 0.7,
      warnOnce: true,
    });
    const context = createTestContext({
      stats: { totalTokens: 100000 },
      model: { maxContextTokens: 128000 },
    });

    const result1 = await middleware.beforeTurn(context);
    const result2 = await middleware.beforeTurn(context);

    expect(result1.action).toBe(MiddlewareAction.INJECT_MESSAGE);
    expect(result2.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should warn multiple times when warnOnce is false', async () => {
    const middleware = new ContextWarningMiddleware({
      warningPercentage: 0.7,
      warnOnce: false,
    });
    const context = createTestContext({
      stats: { totalTokens: 100000 },
      model: { maxContextTokens: 128000 },
    });

    const result1 = await middleware.beforeTurn(context);
    middleware.reset(); // Reset to simulate fresh check
    const result2 = await middleware.beforeTurn(context);

    expect(result1.action).toBe(MiddlewareAction.INJECT_MESSAGE);
    expect(result2.action).toBe(MiddlewareAction.INJECT_MESSAGE);
  });
});

// ============================================================================
// RateLimitMiddleware Tests
// ============================================================================

describe('RateLimitMiddleware', () => {
  it('should allow first request immediately', async () => {
    const middleware = new RateLimitMiddleware(100);
    const context = createTestContext({});

    const start = Date.now();
    await middleware.beforeTurn(context);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('should delay rapid requests', async () => {
    const middleware = new RateLimitMiddleware(100);
    const context = createTestContext({});

    await middleware.beforeTurn(context);
    const start = Date.now();
    await middleware.beforeTurn(context);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(50); // Some delay expected
  });

  it('should reset timing', async () => {
    const middleware = new RateLimitMiddleware(100);
    const context = createTestContext({});

    await middleware.beforeTurn(context);
    middleware.reset();

    const start = Date.now();
    await middleware.beforeTurn(context);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});

// ============================================================================
// ToolExecutionLimitMiddleware Tests
// ============================================================================

describe('ToolExecutionLimitMiddleware', () => {
  it('should allow tool calls under limit', () => {
    const middleware = new ToolExecutionLimitMiddleware(5);

    expect(middleware.checkToolCall()).toBe(true);
    expect(middleware.checkToolCall()).toBe(true);
    expect(middleware.checkToolCall()).toBe(true);
  });

  it('should block tool calls over limit', () => {
    const middleware = new ToolExecutionLimitMiddleware(3);

    expect(middleware.checkToolCall()).toBe(true);
    expect(middleware.checkToolCall()).toBe(true);
    expect(middleware.checkToolCall()).toBe(true);
    expect(middleware.checkToolCall()).toBe(false);
  });

  it('should reset counter on beforeTurn', async () => {
    const middleware = new ToolExecutionLimitMiddleware(2);
    const context = createTestContext({});

    middleware.checkToolCall();
    middleware.checkToolCall();
    expect(middleware.checkToolCall()).toBe(false);

    await middleware.beforeTurn(context);

    expect(middleware.checkToolCall()).toBe(true);
  });
});

// ============================================================================
// MiddlewarePipeline Tests
// ============================================================================

describe('MiddlewarePipeline', () => {
  it('should execute middlewares in priority order', async () => {
    const order: string[] = [];

    const pipeline = new MiddlewarePipeline([
      {
        name: 'second',
        priority: 20,
        async beforeTurn() {
          order.push('second');
          return { action: MiddlewareAction.CONTINUE };
        },
        async afterTurn() {
          return { action: MiddlewareAction.CONTINUE };
        },
        reset() {},
      },
      {
        name: 'first',
        priority: 10,
        async beforeTurn() {
          order.push('first');
          return { action: MiddlewareAction.CONTINUE };
        },
        async afterTurn() {
          return { action: MiddlewareAction.CONTINUE };
        },
        reset() {},
      },
    ]);

    const context = createTestContext({});
    await pipeline.runBefore(context);

    expect(order).toEqual(['first', 'second']);
  });

  it('should stop at first non-continue result', async () => {
    const order: string[] = [];

    const pipeline = new MiddlewarePipeline([
      {
        name: 'first',
        priority: 10,
        async beforeTurn() {
          order.push('first');
          return { action: MiddlewareAction.STOP, message: 'Stopped!' };
        },
        async afterTurn() {
          return { action: MiddlewareAction.CONTINUE };
        },
        reset() {},
      },
      {
        name: 'second',
        priority: 20,
        async beforeTurn() {
          order.push('second');
          return { action: MiddlewareAction.CONTINUE };
        },
        async afterTurn() {
          return { action: MiddlewareAction.CONTINUE };
        },
        reset() {},
      },
    ]);

    const context = createTestContext({});
    const result = await pipeline.runBefore(context);

    expect(result.action).toBe(MiddlewareAction.STOP);
    expect(order).toEqual(['first']);
  });

  it('should continue on middleware error', async () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'error',
        priority: 10,
        async beforeTurn() {
          throw new Error('Test error');
        },
        async afterTurn() {
          return { action: MiddlewareAction.CONTINUE };
        },
        reset() {},
      },
      {
        name: 'success',
        priority: 20,
        async beforeTurn() {
          return { action: MiddlewareAction.STOP, message: 'Success' };
        },
        async afterTurn() {
          return { action: MiddlewareAction.CONTINUE };
        },
        reset() {},
      },
    ]);

    const context = createTestContext({});
    const result = await pipeline.runBefore(context);

    expect(result.action).toBe(MiddlewareAction.STOP);
    expect(result.message).toBe('Success');
  });

  it('should add/remove/get middlewares', () => {
    const pipeline = new MiddlewarePipeline();
    const middleware = {
      name: 'test',
      priority: 10,
      async beforeTurn() {
        return { action: MiddlewareAction.CONTINUE };
      },
      async afterTurn() {
        return { action: MiddlewareAction.CONTINUE };
      },
      reset() {},
    };

    pipeline.add(middleware);
    expect(pipeline.has('test')).toBe(true);
    expect(pipeline.get('test')).toBe(middleware);
    expect(pipeline.count).toBe(1);

    pipeline.remove('test');
    expect(pipeline.has('test')).toBe(false);
    expect(pipeline.count).toBe(0);
  });

  it('should emit events', async () => {
    const events: string[] = [];
    const pipeline = new MiddlewarePipeline([
      {
        name: 'test',
        priority: 10,
        async beforeTurn() {
          return { action: MiddlewareAction.STOP, message: 'Stop' };
        },
        async afterTurn() {
          return { action: MiddlewareAction.CONTINUE };
        },
        reset() {},
      },
    ]);

    pipeline.on(event => events.push(event.type));

    const context = createTestContext({});
    await pipeline.runBefore(context);
    pipeline.reset();

    expect(events).toContain('middleware:before');
    expect(events).toContain('middleware:action');
    expect(events).toContain('pipeline:reset');
  });

  it('should disable/enable pipeline', async () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'test',
        priority: 10,
        async beforeTurn() {
          return { action: MiddlewareAction.STOP, message: 'Stop' };
        },
        async afterTurn() {
          return { action: MiddlewareAction.CONTINUE };
        },
        reset() {},
      },
    ]);

    pipeline.setEnabled(false);
    const context = createTestContext({});
    const result = await pipeline.runBefore(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
    expect(pipeline.isEnabled()).toBe(false);
  });
});

// ============================================================================
// PipelineBuilder Tests
// ============================================================================

describe('PipelineBuilder', () => {
  it('should build pipeline with middlewares', () => {
    const middleware1 = new TurnLimitMiddleware({ maxTurns: 100 });
    const middleware2 = new PriceLimitMiddleware({ maxCost: 10 });

    const pipeline = createPipeline()
      .use(middleware1)
      .use(middleware2)
      .build();

    expect(pipeline.count).toBe(2);
    expect(pipeline.has('turn-limit')).toBe(true);
    expect(pipeline.has('price-limit')).toBe(true);
  });

  it('should conditionally add middlewares', () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100 });

    const pipeline1 = createPipeline()
      .useIf(true, middleware)
      .build();

    const pipeline2 = createPipeline()
      .useIf(false, middleware)
      .build();

    expect(pipeline1.count).toBe(1);
    expect(pipeline2.count).toBe(0);
  });

  it('should add all middlewares', () => {
    const middlewares = createDefaultMiddlewares();

    const pipeline = createPipeline()
      .useAll(middlewares)
      .build();

    expect(pipeline.count).toBe(4);
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  it('should create default middlewares', () => {
    const middlewares = createDefaultMiddlewares();

    expect(middlewares.length).toBe(4);
    expect(middlewares.some(m => m.name === 'turn-limit')).toBe(true);
    expect(middlewares.some(m => m.name === 'price-limit')).toBe(true);
    expect(middlewares.some(m => m.name === 'auto-compact')).toBe(true);
    expect(middlewares.some(m => m.name === 'context-warning')).toBe(true);
  });

  it('should create default middlewares with custom options', () => {
    const middlewares = createDefaultMiddlewares({
      maxTurns: 50,
      maxCost: 5,
    });

    expect(middlewares.length).toBe(4);
  });

  it('should create YOLO middlewares with relaxed limits', () => {
    const middlewares = createYoloMiddlewares();

    expect(middlewares.length).toBe(3);
    expect(middlewares.some(m => m.name === 'turn-limit')).toBe(true);
    expect(middlewares.some(m => m.name === 'price-limit')).toBe(true);
    expect(middlewares.some(m => m.name === 'auto-compact')).toBe(true);
    // No context warning in YOLO mode
    expect(middlewares.some(m => m.name === 'context-warning')).toBe(false);
  });
});
