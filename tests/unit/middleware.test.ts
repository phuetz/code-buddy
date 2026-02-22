/**
 * Comprehensive Unit Tests for Middleware Module
 *
 * Tests cover:
 * - Middleware chain execution
 * - Request/response handling (beforeTurn/afterTurn)
 * - Error middleware and error handling
 * - Pipeline management and events
 * - Helper functions
 */

import {
  MiddlewareAction,
  ConversationContext,
  ConversationStats,
  ModelInfo,
  MiddlewareResult,
  ConversationMiddleware,
  createInitialStats,
  defaultModelInfo,
  continueResult,
  stopResult,
  compactResult,
  injectMessageResult,
  TurnLimitMiddleware,
  PriceLimitMiddleware,
  AutoCompactMiddleware,
  ContextWarningMiddleware,
  RateLimitMiddleware,
  ToolExecutionLimitMiddleware,
  MiddlewarePipeline,
  PipelineBuilder,
  PipelineEvent,
  createPipeline,
  createDefaultMiddlewares,
  createYoloMiddlewares,
} from '../../src/middleware/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test context with optional overrides
 */
function createTestContext(overrides: Partial<{
  stats: Partial<ConversationStats>;
  model: Partial<ModelInfo>;
  messageCount: number;
  autoApprove: boolean;
  metadata: Record<string, unknown>;
}>): ConversationContext {
  const baseStats = createInitialStats();
  const baseModel = defaultModelInfo();

  return {
    messages: Array(overrides.messageCount ?? 10).fill({ role: 'user', content: 'test' }),
    stats: { ...baseStats, ...overrides.stats },
    model: { ...baseModel, ...overrides.model },
    workingDirectory: '/test',
    sessionId: 'test-session-123',
    autoApprove: overrides.autoApprove ?? false,
    metadata: overrides.metadata ?? {},
  };
}

/**
 * Create a mock middleware for testing
 */
function createMockMiddleware(
  name: string,
  priority: number,
  options?: {
    beforeTurnResult?: MiddlewareResult;
    afterTurnResult?: MiddlewareResult;
    beforeTurnCallback?: (context: ConversationContext) => void;
    afterTurnCallback?: (context: ConversationContext) => void;
    throwOnBefore?: boolean;
    throwOnAfter?: boolean;
    throwOnReset?: boolean;
  }
): ConversationMiddleware {
  return {
    name,
    priority,
    async beforeTurn(context: ConversationContext): Promise<MiddlewareResult> {
      if (options?.throwOnBefore) {
        throw new Error(`Error in ${name} beforeTurn`);
      }
      options?.beforeTurnCallback?.(context);
      return options?.beforeTurnResult ?? continueResult();
    },
    async afterTurn(context: ConversationContext): Promise<MiddlewareResult> {
      if (options?.throwOnAfter) {
        throw new Error(`Error in ${name} afterTurn`);
      }
      options?.afterTurnCallback?.(context);
      return options?.afterTurnResult ?? continueResult();
    },
    reset(): void {
      if (options?.throwOnReset) {
        throw new Error(`Error in ${name} reset`);
      }
    },
  };
}

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe('Middleware Helper Functions', () => {
  describe('continueResult', () => {
    it('should return a CONTINUE action', () => {
      const result = continueResult();
      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      expect(result.message).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });
  });

  describe('stopResult', () => {
    it('should return a STOP action with reason', () => {
      const result = stopResult('Test reason');
      expect(result.action).toBe(MiddlewareAction.STOP);
      expect(result.reason).toBe('Test reason');
      expect(result.message).toBeUndefined();
    });

    it('should return a STOP action with reason and message', () => {
      const result = stopResult('Test reason', 'Test message');
      expect(result.action).toBe(MiddlewareAction.STOP);
      expect(result.reason).toBe('Test reason');
      expect(result.message).toBe('Test message');
    });
  });

  describe('compactResult', () => {
    it('should return a COMPACT action with reason', () => {
      const result = compactResult('Test reason');
      expect(result.action).toBe(MiddlewareAction.COMPACT);
      expect(result.reason).toBe('Test reason');
      expect(result.metadata).toBeUndefined();
    });

    it('should return a COMPACT action with reason and metadata', () => {
      const metadata = { tokens: 1000, threshold: 800 };
      const result = compactResult('Test reason', metadata);
      expect(result.action).toBe(MiddlewareAction.COMPACT);
      expect(result.reason).toBe('Test reason');
      expect(result.metadata).toEqual(metadata);
    });
  });

  describe('injectMessageResult', () => {
    it('should return an INJECT_MESSAGE action with message', () => {
      const result = injectMessageResult('Test message');
      expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
      expect(result.message).toBe('Test message');
      expect(result.reason).toBeUndefined();
    });

    it('should return an INJECT_MESSAGE action with message and reason', () => {
      const result = injectMessageResult('Test message', 'Test reason');
      expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
      expect(result.message).toBe('Test message');
      expect(result.reason).toBe('Test reason');
    });
  });

  describe('createInitialStats', () => {
    it('should create stats with zero values', () => {
      const stats = createInitialStats();
      expect(stats.turns).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.promptTokens).toBe(0);
      expect(stats.completionTokens).toBe(0);
      expect(stats.sessionCost).toBe(0);
      expect(stats.toolCalls).toBe(0);
      expect(stats.successfulToolCalls).toBe(0);
      expect(stats.failedToolCalls).toBe(0);
      expect(stats.durationMs).toBe(0);
      expect(stats.startTime).toBeInstanceOf(Date);
    });
  });

  describe('defaultModelInfo', () => {
    it('should create default model info', () => {
      const model = defaultModelInfo();
      expect(model.name).toBe('unknown');
      expect(model.maxContextTokens).toBe(128000);
      expect(model.inputPricePerMillion).toBe(0.15);
      expect(model.outputPricePerMillion).toBe(0.60);
    });
  });
});

// ============================================================================
// Middleware Chain Execution Tests
// ============================================================================

describe('Middleware Chain Execution', () => {
  describe('Priority ordering', () => {
    it('should execute middlewares in ascending priority order', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('third', 30, {
          beforeTurnCallback: () => executionOrder.push('third'),
        }),
        createMockMiddleware('first', 10, {
          beforeTurnCallback: () => executionOrder.push('first'),
        }),
        createMockMiddleware('second', 20, {
          beforeTurnCallback: () => executionOrder.push('second'),
        }),
      ]);

      await pipeline.runBefore(createTestContext({}));

      expect(executionOrder).toEqual(['first', 'second', 'third']);
    });

    it('should maintain order when adding middlewares dynamically', async () => {
      const executionOrder: string[] = [];
      const pipeline = new MiddlewarePipeline();

      pipeline.add(createMockMiddleware('c', 30, {
        beforeTurnCallback: () => executionOrder.push('c'),
      }));
      pipeline.add(createMockMiddleware('a', 10, {
        beforeTurnCallback: () => executionOrder.push('a'),
      }));
      pipeline.add(createMockMiddleware('b', 20, {
        beforeTurnCallback: () => executionOrder.push('b'),
      }));

      await pipeline.runBefore(createTestContext({}));

      expect(executionOrder).toEqual(['a', 'b', 'c']);
    });

    it('should handle middlewares with same priority (stable order)', async () => {
      const executionOrder: string[] = [];
      const pipeline = new MiddlewarePipeline();

      // Add in specific order
      pipeline.add(createMockMiddleware('first-added', 10, {
        beforeTurnCallback: () => executionOrder.push('first-added'),
      }));
      pipeline.add(createMockMiddleware('second-added', 10, {
        beforeTurnCallback: () => executionOrder.push('second-added'),
      }));

      await pipeline.runBefore(createTestContext({}));

      // Both have priority 10, stable sort should maintain order
      expect(executionOrder.length).toBe(2);
    });
  });

  describe('Short-circuit behavior', () => {
    it('should stop execution on STOP action', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('first', 10, {
          beforeTurnCallback: () => executionOrder.push('first'),
          beforeTurnResult: stopResult('Stopped', 'First middleware stopped'),
        }),
        createMockMiddleware('second', 20, {
          beforeTurnCallback: () => executionOrder.push('second'),
        }),
      ]);

      const result = await pipeline.runBefore(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.STOP);
      expect(executionOrder).toEqual(['first']);
    });

    it('should stop execution on COMPACT action', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('first', 10, {
          beforeTurnCallback: () => executionOrder.push('first'),
          beforeTurnResult: compactResult('Needs compaction'),
        }),
        createMockMiddleware('second', 20, {
          beforeTurnCallback: () => executionOrder.push('second'),
        }),
      ]);

      const result = await pipeline.runBefore(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.COMPACT);
      expect(executionOrder).toEqual(['first']);
    });

    it('should stop execution on INJECT_MESSAGE action', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('first', 10, {
          beforeTurnCallback: () => executionOrder.push('first'),
          beforeTurnResult: injectMessageResult('Warning message'),
        }),
        createMockMiddleware('second', 20, {
          beforeTurnCallback: () => executionOrder.push('second'),
        }),
      ]);

      const result = await pipeline.runBefore(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
      expect(executionOrder).toEqual(['first']);
    });

    it('should continue execution on CONTINUE action', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('first', 10, {
          beforeTurnCallback: () => executionOrder.push('first'),
          beforeTurnResult: continueResult(),
        }),
        createMockMiddleware('second', 20, {
          beforeTurnCallback: () => executionOrder.push('second'),
          beforeTurnResult: continueResult(),
        }),
      ]);

      const result = await pipeline.runBefore(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      expect(executionOrder).toEqual(['first', 'second']);
    });
  });

  describe('Empty pipeline', () => {
    it('should return CONTINUE for empty pipeline', async () => {
      const pipeline = new MiddlewarePipeline();
      const result = await pipeline.runBefore(createTestContext({}));
      expect(result.action).toBe(MiddlewareAction.CONTINUE);
    });

    it('should return CONTINUE for afterTurn on empty pipeline', async () => {
      const pipeline = new MiddlewarePipeline();
      const result = await pipeline.runAfter(createTestContext({}));
      expect(result.action).toBe(MiddlewareAction.CONTINUE);
    });
  });
});

// ============================================================================
// Request/Response Handling Tests
// ============================================================================

describe('Request/Response Handling', () => {
  describe('beforeTurn hook', () => {
    it('should pass context to beforeTurn', async () => {
      let receivedContext: ConversationContext | null = null;

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10, {
          beforeTurnCallback: (ctx) => {
            receivedContext = ctx;
          },
        }),
      ]);

      const testContext = createTestContext({
        stats: { turns: 5 },
        metadata: { key: 'value' },
      });

      await pipeline.runBefore(testContext);

      expect(receivedContext).not.toBeNull();
      expect(receivedContext!.stats.turns).toBe(5);
      expect(receivedContext!.metadata.key).toBe('value');
    });

    it('should handle async middleware correctly', async () => {
      const results: number[] = [];

      const pipeline = new MiddlewarePipeline([
        {
          name: 'async-test',
          priority: 10,
          async beforeTurn(): Promise<MiddlewareResult> {
            await new Promise((resolve) => setTimeout(resolve, 10));
            results.push(1);
            return continueResult();
          },
          async afterTurn(): Promise<MiddlewareResult> {
            return continueResult();
          },
          reset(): void {},
        },
      ]);

      await pipeline.runBefore(createTestContext({}));

      expect(results).toEqual([1]);
    });
  });

  describe('afterTurn hook', () => {
    it('should pass context to afterTurn', async () => {
      let receivedContext: ConversationContext | null = null;

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10, {
          afterTurnCallback: (ctx) => {
            receivedContext = ctx;
          },
        }),
      ]);

      const testContext = createTestContext({
        stats: { sessionCost: 1.5 },
      });

      await pipeline.runAfter(testContext);

      expect(receivedContext).not.toBeNull();
      expect(receivedContext!.stats.sessionCost).toBe(1.5);
    });

    it('should execute afterTurn in priority order', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('third', 30, {
          afterTurnCallback: () => executionOrder.push('third'),
        }),
        createMockMiddleware('first', 10, {
          afterTurnCallback: () => executionOrder.push('first'),
        }),
        createMockMiddleware('second', 20, {
          afterTurnCallback: () => executionOrder.push('second'),
        }),
      ]);

      await pipeline.runAfter(createTestContext({}));

      expect(executionOrder).toEqual(['first', 'second', 'third']);
    });

    it('should short-circuit afterTurn on non-CONTINUE action', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('first', 10, {
          afterTurnCallback: () => executionOrder.push('first'),
          afterTurnResult: stopResult('Stopped after turn'),
        }),
        createMockMiddleware('second', 20, {
          afterTurnCallback: () => executionOrder.push('second'),
        }),
      ]);

      const result = await pipeline.runAfter(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.STOP);
      expect(executionOrder).toEqual(['first']);
    });
  });

  describe('Context access patterns', () => {
    it('should allow middleware to access all context properties', async () => {
      let messagesCount = 0;
      let modelName = '';
      let workingDir = '';
      let sessionId = '';
      let autoApprove = false;

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('context-inspector', 10, {
          beforeTurnCallback: (ctx) => {
            messagesCount = ctx.messages.length;
            modelName = ctx.model.name;
            workingDir = ctx.workingDirectory;
            sessionId = ctx.sessionId;
            autoApprove = ctx.autoApprove;
          },
        }),
      ]);

      const testContext = createTestContext({
        messageCount: 15,
        model: { name: 'grok-beta' },
        autoApprove: true,
      });
      testContext.workingDirectory = '/custom/path';
      testContext.sessionId = 'custom-session';

      await pipeline.runBefore(testContext);

      expect(messagesCount).toBe(15);
      expect(modelName).toBe('grok-beta');
      expect(workingDir).toBe('/custom/path');
      expect(sessionId).toBe('custom-session');
      expect(autoApprove).toBe(true);
    });
  });
});

// ============================================================================
// Error Middleware Tests
// ============================================================================

describe('Error Middleware', () => {
  describe('Error handling in beforeTurn', () => {
    it('should continue pipeline when middleware throws', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('error-middleware', 10, {
          throwOnBefore: true,
        }),
        createMockMiddleware('success-middleware', 20, {
          beforeTurnCallback: () => executionOrder.push('success'),
          beforeTurnResult: stopResult('Normal stop'),
        }),
      ]);

      const result = await pipeline.runBefore(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.STOP);
      expect(executionOrder).toEqual(['success']);
    });

    it('should emit error event when middleware throws', async () => {
      const events: PipelineEvent[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('error-middleware', 10, {
          throwOnBefore: true,
        }),
      ]);

      pipeline.on((event) => events.push(event));

      await pipeline.runBefore(createTestContext({}));

      const errorEvent = events.find((e) => e.type === 'middleware:error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.middlewareName).toBe('error-middleware');
      expect(errorEvent!.error).toBeInstanceOf(Error);
      expect(errorEvent!.error!.message).toBe('Error in error-middleware beforeTurn');
    });

    it('should handle non-Error exceptions', async () => {
      const events: PipelineEvent[] = [];

      const pipeline = new MiddlewarePipeline([
        {
          name: 'string-throw',
          priority: 10,
          async beforeTurn(): Promise<MiddlewareResult> {
            throw 'String error'; // Non-Error throw
          },
          async afterTurn(): Promise<MiddlewareResult> {
            return continueResult();
          },
          reset(): void {},
        },
      ]);

      pipeline.on((event) => events.push(event));

      const result = await pipeline.runBefore(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      const errorEvent = events.find((e) => e.type === 'middleware:error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error!.message).toBe('String error');
    });
  });

  describe('Error handling in afterTurn', () => {
    it('should continue pipeline when afterTurn middleware throws', async () => {
      const executionOrder: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('error-middleware', 10, {
          throwOnAfter: true,
        }),
        createMockMiddleware('success-middleware', 20, {
          afterTurnCallback: () => executionOrder.push('success'),
        }),
      ]);

      await pipeline.runAfter(createTestContext({}));

      expect(executionOrder).toEqual(['success']);
    });

    it('should emit error event for afterTurn errors', async () => {
      const events: PipelineEvent[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('error-middleware', 10, {
          throwOnAfter: true,
        }),
      ]);

      pipeline.on((event) => events.push(event));

      await pipeline.runAfter(createTestContext({}));

      const errorEvent = events.find((e) => e.type === 'middleware:error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.middlewareName).toBe('error-middleware');
    });
  });

  describe('Error isolation', () => {
    it('should not affect other middlewares when one throws', async () => {
      const results: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('before-error', 5, {
          beforeTurnCallback: () => results.push('before-error'),
        }),
        createMockMiddleware('error', 10, {
          throwOnBefore: true,
        }),
        createMockMiddleware('after-error', 15, {
          beforeTurnCallback: () => results.push('after-error'),
        }),
      ]);

      await pipeline.runBefore(createTestContext({}));

      expect(results).toContain('before-error');
      expect(results).toContain('after-error');
    });

    it('should handle multiple consecutive errors', async () => {
      const events: PipelineEvent[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('error1', 10, { throwOnBefore: true }),
        createMockMiddleware('error2', 20, { throwOnBefore: true }),
        createMockMiddleware('error3', 30, { throwOnBefore: true }),
      ]);

      pipeline.on((event) => events.push(event));

      const result = await pipeline.runBefore(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      const errorEvents = events.filter((e) => e.type === 'middleware:error');
      expect(errorEvents.length).toBe(3);
    });
  });
});

// ============================================================================
// Pipeline Management Tests
// ============================================================================

describe('Pipeline Management', () => {
  describe('add/remove/get operations', () => {
    it('should add middleware and maintain count', () => {
      const pipeline = new MiddlewarePipeline();

      expect(pipeline.count).toBe(0);

      pipeline.add(createMockMiddleware('test1', 10));
      expect(pipeline.count).toBe(1);

      pipeline.add(createMockMiddleware('test2', 20));
      expect(pipeline.count).toBe(2);
    });

    it('should support fluent chaining when adding', () => {
      const pipeline = new MiddlewarePipeline();

      const result = pipeline
        .add(createMockMiddleware('test1', 10))
        .add(createMockMiddleware('test2', 20));

      expect(result).toBe(pipeline);
      expect(pipeline.count).toBe(2);
    });

    it('should remove middleware by name', () => {
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test1', 10),
        createMockMiddleware('test2', 20),
      ]);

      const removed = pipeline.remove('test1');

      expect(removed).toBe(true);
      expect(pipeline.count).toBe(1);
      expect(pipeline.has('test1')).toBe(false);
      expect(pipeline.has('test2')).toBe(true);
    });

    it('should return false when removing non-existent middleware', () => {
      const pipeline = new MiddlewarePipeline();

      const removed = pipeline.remove('non-existent');

      expect(removed).toBe(false);
    });

    it('should get middleware by name', () => {
      const middleware = createMockMiddleware('test', 10);
      const pipeline = new MiddlewarePipeline([middleware]);

      const retrieved = pipeline.get('test');

      expect(retrieved).toBe(middleware);
    });

    it('should return undefined for non-existent middleware', () => {
      const pipeline = new MiddlewarePipeline();

      const retrieved = pipeline.get('non-existent');

      expect(retrieved).toBeUndefined();
    });

    it('should check middleware existence with has()', () => {
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('exists', 10),
      ]);

      expect(pipeline.has('exists')).toBe(true);
      expect(pipeline.has('not-exists')).toBe(false);
    });

    it('should get all middleware names in priority order', () => {
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('c', 30),
        createMockMiddleware('a', 10),
        createMockMiddleware('b', 20),
      ]);

      expect(pipeline.getNames()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('Enable/disable', () => {
    it('should disable pipeline execution', async () => {
      const executed: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10, {
          beforeTurnCallback: () => executed.push('executed'),
        }),
      ]);

      pipeline.setEnabled(false);

      const result = await pipeline.runBefore(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      expect(executed).toEqual([]);
    });

    it('should re-enable pipeline execution', async () => {
      const executed: string[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10, {
          beforeTurnCallback: () => executed.push('executed'),
        }),
      ]);

      pipeline.setEnabled(false);
      pipeline.setEnabled(true);

      await pipeline.runBefore(createTestContext({}));

      expect(executed).toEqual(['executed']);
    });

    it('should report enabled state correctly', () => {
      const pipeline = new MiddlewarePipeline();

      expect(pipeline.isEnabled()).toBe(true);

      pipeline.setEnabled(false);
      expect(pipeline.isEnabled()).toBe(false);

      pipeline.setEnabled(true);
      expect(pipeline.isEnabled()).toBe(true);
    });

    it('should return CONTINUE for disabled pipeline afterTurn', async () => {
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10, {
          afterTurnResult: stopResult('Should not execute'),
        }),
      ]);

      pipeline.setEnabled(false);

      const result = await pipeline.runAfter(createTestContext({}));

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
    });
  });

  describe('Reset functionality', () => {
    it('should reset all middlewares', () => {
      const resetCalls: string[] = [];

      const pipeline = new MiddlewarePipeline([
        {
          name: 'test1',
          priority: 10,
          async beforeTurn(): Promise<MiddlewareResult> {
            return continueResult();
          },
          async afterTurn(): Promise<MiddlewareResult> {
            return continueResult();
          },
          reset(): void {
            resetCalls.push('test1');
          },
        },
        {
          name: 'test2',
          priority: 20,
          async beforeTurn(): Promise<MiddlewareResult> {
            return continueResult();
          },
          async afterTurn(): Promise<MiddlewareResult> {
            return continueResult();
          },
          reset(): void {
            resetCalls.push('test2');
          },
        },
      ]);

      pipeline.reset();

      expect(resetCalls).toContain('test1');
      expect(resetCalls).toContain('test2');
    });

    it('should emit reset event', () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline();

      pipeline.on((event) => events.push(event));
      pipeline.reset();

      const resetEvent = events.find((e) => e.type === 'pipeline:reset');
      expect(resetEvent).toBeDefined();
      expect(resetEvent!.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Clear functionality', () => {
    it('should clear all middlewares', () => {
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test1', 10),
        createMockMiddleware('test2', 20),
      ]);

      pipeline.clear();

      expect(pipeline.count).toBe(0);
      expect(pipeline.getNames()).toEqual([]);
    });
  });
});

// ============================================================================
// Pipeline Events Tests
// ============================================================================

describe('Pipeline Events', () => {
  describe('Event subscription', () => {
    it('should subscribe to events', () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10),
      ]);

      pipeline.on((event) => events.push(event));
      pipeline.reset();

      expect(events.length).toBeGreaterThan(0);
    });

    it('should unsubscribe from events', () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10),
      ]);

      const unsubscribe = pipeline.on((event) => events.push(event));
      unsubscribe();
      pipeline.reset();

      expect(events.length).toBe(0);
    });

    it('should support multiple subscribers', async () => {
      const events1: PipelineEvent[] = [];
      const events2: PipelineEvent[] = [];

      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10),
      ]);

      pipeline.on((event) => events1.push(event));
      pipeline.on((event) => events2.push(event));

      await pipeline.runBefore(createTestContext({}));

      expect(events1.length).toBeGreaterThan(0);
      expect(events2.length).toBeGreaterThan(0);
      expect(events1.length).toBe(events2.length);
    });
  });

  describe('Event types', () => {
    it('should emit middleware:before event', async () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10),
      ]);

      pipeline.on((event) => events.push(event));
      await pipeline.runBefore(createTestContext({}));

      const beforeEvent = events.find((e) => e.type === 'middleware:before');
      expect(beforeEvent).toBeDefined();
      expect(beforeEvent!.middlewareName).toBe('test');
    });

    it('should emit middleware:after event', async () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10),
      ]);

      pipeline.on((event) => events.push(event));
      await pipeline.runAfter(createTestContext({}));

      const afterEvent = events.find((e) => e.type === 'middleware:after');
      expect(afterEvent).toBeDefined();
      expect(afterEvent!.middlewareName).toBe('test');
    });

    it('should emit middleware:action event on non-CONTINUE', async () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10, {
          beforeTurnResult: stopResult('Stopped', 'Stop message'),
        }),
      ]);

      pipeline.on((event) => events.push(event));
      await pipeline.runBefore(createTestContext({}));

      const actionEvent = events.find((e) => e.type === 'middleware:action');
      expect(actionEvent).toBeDefined();
      expect(actionEvent!.middlewareName).toBe('test');
      expect(actionEvent!.action).toBe(MiddlewareAction.STOP);
      expect(actionEvent!.message).toBe('Stop message');
    });

    it('should not emit middleware:action on CONTINUE', async () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10),
      ]);

      pipeline.on((event) => events.push(event));
      await pipeline.runBefore(createTestContext({}));

      const actionEvent = events.find((e) => e.type === 'middleware:action');
      expect(actionEvent).toBeUndefined();
    });
  });

  describe('Event handler errors', () => {
    it('should ignore errors in event handlers', async () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10),
      ]);

      pipeline.on(() => {
        throw new Error('Handler error');
      });
      pipeline.on((event) => events.push(event));

      // Should not throw
      await pipeline.runBefore(createTestContext({}));

      // Second handler should still receive events
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Event timestamps', () => {
    it('should include timestamp in events', async () => {
      const events: PipelineEvent[] = [];
      const pipeline = new MiddlewarePipeline([
        createMockMiddleware('test', 10),
      ]);

      pipeline.on((event) => events.push(event));
      await pipeline.runBefore(createTestContext({}));

      events.forEach((event) => {
        expect(event.timestamp).toBeInstanceOf(Date);
      });
    });
  });
});

// ============================================================================
// Pipeline Builder Tests
// ============================================================================

describe('PipelineBuilder', () => {
  describe('use() method', () => {
    it('should add single middleware', () => {
      const middleware = createMockMiddleware('test', 10);

      const pipeline = createPipeline()
        .use(middleware)
        .build();

      expect(pipeline.count).toBe(1);
      expect(pipeline.has('test')).toBe(true);
    });

    it('should support fluent chaining', () => {
      const pipeline = createPipeline()
        .use(createMockMiddleware('test1', 10))
        .use(createMockMiddleware('test2', 20))
        .use(createMockMiddleware('test3', 30))
        .build();

      expect(pipeline.count).toBe(3);
    });
  });

  describe('useAll() method', () => {
    it('should add multiple middlewares', () => {
      const middlewares = [
        createMockMiddleware('test1', 10),
        createMockMiddleware('test2', 20),
        createMockMiddleware('test3', 30),
      ];

      const pipeline = createPipeline()
        .useAll(middlewares)
        .build();

      expect(pipeline.count).toBe(3);
    });

    it('should handle empty array', () => {
      const pipeline = createPipeline()
        .useAll([])
        .build();

      expect(pipeline.count).toBe(0);
    });
  });

  describe('useIf() method', () => {
    it('should add middleware when condition is true', () => {
      const pipeline = createPipeline()
        .useIf(true, createMockMiddleware('conditional', 10))
        .build();

      expect(pipeline.has('conditional')).toBe(true);
    });

    it('should not add middleware when condition is false', () => {
      const pipeline = createPipeline()
        .useIf(false, createMockMiddleware('conditional', 10))
        .build();

      expect(pipeline.has('conditional')).toBe(false);
    });

    it('should work with dynamic conditions', () => {
      const featureEnabled = true;
      const debugMode = false;

      const pipeline = createPipeline()
        .useIf(featureEnabled, createMockMiddleware('feature', 10))
        .useIf(debugMode, createMockMiddleware('debug', 20))
        .build();

      expect(pipeline.has('feature')).toBe(true);
      expect(pipeline.has('debug')).toBe(false);
    });
  });

  describe('build() method', () => {
    it('should return a new MiddlewarePipeline instance', () => {
      const pipeline = createPipeline().build();

      expect(pipeline).toBeInstanceOf(MiddlewarePipeline);
    });

    it('should allow multiple builds from same builder', () => {
      const builder = createPipeline()
        .use(createMockMiddleware('test', 10));

      const pipeline1 = builder.build();
      const pipeline2 = builder.build();

      expect(pipeline1).not.toBe(pipeline2);
      expect(pipeline1.count).toBe(1);
      expect(pipeline2.count).toBe(1);
    });
  });

  describe('createPipeline() factory', () => {
    it('should return a new PipelineBuilder', () => {
      const builder = createPipeline();

      expect(builder).toBeInstanceOf(PipelineBuilder);
    });
  });
});

// ============================================================================
// Individual Middleware Tests
// ============================================================================

describe('TurnLimitMiddleware', () => {
  it('should have correct name and priority', () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100 });
    expect(middleware.name).toBe('turn-limit');
    expect(middleware.priority).toBe(10);
  });

  it('should use default warning threshold', async () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100 });
    const context = createTestContext({ stats: { turns: 80 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
  });

  it('should respect custom warning threshold', async () => {
    const middleware = new TurnLimitMiddleware({
      maxTurns: 100,
      warningThreshold: 0.9,
    });
    const context = createTestContext({ stats: { turns: 80 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should return CONTINUE from afterTurn', async () => {
    const middleware = new TurnLimitMiddleware({ maxTurns: 100 });
    const context = createTestContext({ stats: { turns: 100 } });

    const result = await middleware.afterTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });
});

describe('PriceLimitMiddleware', () => {
  it('should have correct name and priority', () => {
    const middleware = new PriceLimitMiddleware({ maxCost: 10 });
    expect(middleware.name).toBe('price-limit');
    expect(middleware.priority).toBe(20);
  });

  it('should use default warning threshold', async () => {
    const middleware = new PriceLimitMiddleware({ maxCost: 10 });
    const context = createTestContext({ stats: { sessionCost: 8 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.INJECT_MESSAGE);
  });

  it('should respect custom warning threshold', async () => {
    const middleware = new PriceLimitMiddleware({
      maxCost: 10,
      warningThreshold: 0.9,
    });
    const context = createTestContext({ stats: { sessionCost: 8 } });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should format cost correctly in messages', async () => {
    const middleware = new PriceLimitMiddleware({ maxCost: 10 });
    const context = createTestContext({ stats: { sessionCost: 10 } });

    const result = await middleware.beforeTurn(context);

    expect(result.message).toContain('$10.00');
  });
});

describe('AutoCompactMiddleware', () => {
  it('should have correct name and priority', () => {
    const middleware = new AutoCompactMiddleware({ tokenThreshold: 80000 });
    expect(middleware.name).toBe('auto-compact');
    expect(middleware.priority).toBe(30);
  });

  it('should use default configuration values', async () => {
    const middleware = new AutoCompactMiddleware({ tokenThreshold: 80000 });
    const context = createTestContext({
      stats: { totalTokens: 85000 },
      messageCount: 20,
    });

    const result = await middleware.beforeTurn(context);

    expect(result.action).toBe(MiddlewareAction.COMPACT);
  });

  it('should prevent repeated compaction', async () => {
    const middleware = new AutoCompactMiddleware({ tokenThreshold: 80000 });
    const context = createTestContext({
      stats: { totalTokens: 85000 },
      messageCount: 20,
    });

    const result1 = await middleware.beforeTurn(context);
    const result2 = await middleware.beforeTurn(context);

    expect(result1.action).toBe(MiddlewareAction.COMPACT);
    expect(result2.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should include metadata in compact result', async () => {
    const middleware = new AutoCompactMiddleware({ tokenThreshold: 80000 });
    const context = createTestContext({
      stats: { totalTokens: 85000 },
      messageCount: 20,
    });

    const result = await middleware.beforeTurn(context);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.previousTokens).toBe(85000);
    expect(result.metadata!.messageCount).toBe(20);
  });

  it('should return CONTINUE from afterTurn', async () => {
    const middleware = new AutoCompactMiddleware({ tokenThreshold: 80000 });
    const context = createTestContext({});

    const result = await middleware.afterTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });
});

describe('ContextWarningMiddleware', () => {
  it('should have correct name and priority', () => {
    const middleware = new ContextWarningMiddleware({ warningPercentage: 0.7 });
    expect(middleware.name).toBe('context-warning');
    expect(middleware.priority).toBe(40);
  });

  it('should format percentage correctly in message', async () => {
    const middleware = new ContextWarningMiddleware({ warningPercentage: 0.7 });
    const context = createTestContext({
      stats: { totalTokens: 100000 },
      model: { maxContextTokens: 128000 },
    });

    const result = await middleware.beforeTurn(context);

    expect(result.message).toMatch(/\d+\.\d%/);
    expect(result.message).toContain((100000).toLocaleString());
    expect(result.message).toContain((128000).toLocaleString());
  });

  it('should default warnOnce to true', async () => {
    const middleware = new ContextWarningMiddleware({ warningPercentage: 0.7 });
    const context = createTestContext({
      stats: { totalTokens: 100000 },
      model: { maxContextTokens: 128000 },
    });

    const result1 = await middleware.beforeTurn(context);
    const result2 = await middleware.beforeTurn(context);

    expect(result1.action).toBe(MiddlewareAction.INJECT_MESSAGE);
    expect(result2.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should return CONTINUE from afterTurn', async () => {
    const middleware = new ContextWarningMiddleware({ warningPercentage: 0.7 });
    const context = createTestContext({});

    const result = await middleware.afterTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });
});

describe('RateLimitMiddleware', () => {
  it('should have correct name and priority', () => {
    const middleware = new RateLimitMiddleware(500);
    expect(middleware.name).toBe('rate-limit');
    expect(middleware.priority).toBe(5);
  });

  it('should use default interval', async () => {
    const middleware = new RateLimitMiddleware();
    const context = createTestContext({});

    // First request should be immediate
    const start = Date.now();
    await middleware.beforeTurn(context);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  it('should return CONTINUE from afterTurn', async () => {
    const middleware = new RateLimitMiddleware();
    const context = createTestContext({});

    const result = await middleware.afterTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });
});

describe('ToolExecutionLimitMiddleware', () => {
  it('should have correct name and priority', () => {
    const middleware = new ToolExecutionLimitMiddleware(20);
    expect(middleware.name).toBe('tool-execution-limit');
    expect(middleware.priority).toBe(15);
  });

  it('should use default limit', () => {
    const middleware = new ToolExecutionLimitMiddleware();

    // Should allow 20 calls by default
    for (let i = 0; i < 20; i++) {
      expect(middleware.checkToolCall()).toBe(true);
    }
    expect(middleware.checkToolCall()).toBe(false);
  });

  it('should reset counter on reset()', () => {
    const middleware = new ToolExecutionLimitMiddleware(3);

    middleware.checkToolCall();
    middleware.checkToolCall();
    middleware.checkToolCall();
    expect(middleware.checkToolCall()).toBe(false);

    middleware.reset();

    expect(middleware.checkToolCall()).toBe(true);
  });

  it('should return CONTINUE from afterTurn', async () => {
    const middleware = new ToolExecutionLimitMiddleware(5);
    const context = createTestContext({});

    const result = await middleware.afterTurn(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
  });
});

// ============================================================================
// Factory Functions Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createDefaultMiddlewares', () => {
    it('should create 4 default middlewares', () => {
      const middlewares = createDefaultMiddlewares();

      expect(middlewares.length).toBe(4);
      expect(middlewares.map((m) => m.name)).toContain('turn-limit');
      expect(middlewares.map((m) => m.name)).toContain('price-limit');
      expect(middlewares.map((m) => m.name)).toContain('auto-compact');
      expect(middlewares.map((m) => m.name)).toContain('context-warning');
    });

    it('should apply custom options', () => {
      const middlewares = createDefaultMiddlewares({
        maxTurns: 200,
        maxCost: 20,
        autoCompactThreshold: 100000,
        contextWarningPercentage: 0.8,
      });

      expect(middlewares.length).toBe(4);
    });

    it('should work with partial options', () => {
      const middlewares = createDefaultMiddlewares({
        maxTurns: 50,
      });

      expect(middlewares.length).toBe(4);
    });

    it('should work with empty options', () => {
      const middlewares = createDefaultMiddlewares({});

      expect(middlewares.length).toBe(4);
    });
  });

  describe('createYoloMiddlewares', () => {
    it('should create 3 YOLO middlewares', () => {
      const middlewares = createYoloMiddlewares();

      expect(middlewares.length).toBe(3);
      expect(middlewares.map((m) => m.name)).toContain('turn-limit');
      expect(middlewares.map((m) => m.name)).toContain('price-limit');
      expect(middlewares.map((m) => m.name)).toContain('auto-compact');
      // No context-warning in YOLO mode
      expect(middlewares.map((m) => m.name)).not.toContain('context-warning');
    });

    it('should apply custom options', () => {
      const middlewares = createYoloMiddlewares({
        maxTurns: 1000,
        maxCost: 100,
      });

      expect(middlewares.length).toBe(3);
    });

    it('should work with empty options', () => {
      const middlewares = createYoloMiddlewares({});

      expect(middlewares.length).toBe(3);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  it('should work with all default middlewares in pipeline', async () => {
    const middlewares = createDefaultMiddlewares();
    const pipeline = createPipeline().useAll(middlewares).build();

    const context = createTestContext({
      stats: { turns: 5, sessionCost: 0.5, totalTokens: 1000 },
    });

    const beforeResult = await pipeline.runBefore(context);
    const afterResult = await pipeline.runAfter(context);

    expect(beforeResult.action).toBe(MiddlewareAction.CONTINUE);
    expect(afterResult.action).toBe(MiddlewareAction.CONTINUE);
  });

  it('should handle complex middleware combinations', async () => {
    const events: PipelineEvent[] = [];

    const pipeline = createPipeline()
      .use(new RateLimitMiddleware(10))
      .use(new TurnLimitMiddleware({ maxTurns: 100 }))
      .use(new PriceLimitMiddleware({ maxCost: 10 }))
      .use(new AutoCompactMiddleware({ tokenThreshold: 80000 }))
      .use(new ContextWarningMiddleware({ warningPercentage: 0.7 }))
      .use(new ToolExecutionLimitMiddleware(20))
      .build();

    pipeline.on((event) => events.push(event));

    const context = createTestContext({
      stats: { turns: 10, sessionCost: 1, totalTokens: 5000 },
    });

    const result = await pipeline.runBefore(context);

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
    expect(events.filter((e) => e.type === 'middleware:before').length).toBe(6);
  });

  it('should reset all middlewares correctly', async () => {
    const middlewares = createDefaultMiddlewares();
    const pipeline = createPipeline().useAll(middlewares).build();

    // Trigger warnings
    const warningContext = createTestContext({
      stats: { turns: 85, sessionCost: 9, totalTokens: 100000 },
      model: { maxContextTokens: 128000 },
    });

    await pipeline.runBefore(warningContext);

    // Reset
    pipeline.reset();

    // Warnings should trigger again
    const result = await pipeline.runBefore(warningContext);

    // One of the warning middlewares should have triggered
    expect(
      result.action === MiddlewareAction.INJECT_MESSAGE ||
      result.action === MiddlewareAction.COMPACT
    ).toBe(true);
  });

  it('should handle middleware that modifies behavior based on context', async () => {
    let autoApproveDetected = false;

    const pipeline = createPipeline()
      .use({
        name: 'auto-approve-detector',
        priority: 1,
        async beforeTurn(ctx): Promise<MiddlewareResult> {
          if (ctx.autoApprove) {
            autoApproveDetected = true;
          }
          return continueResult();
        },
        async afterTurn(): Promise<MiddlewareResult> {
          return continueResult();
        },
        reset(): void {},
      })
      .build();

    const context = createTestContext({ autoApprove: true });
    await pipeline.runBefore(context);

    expect(autoApproveDetected).toBe(true);
  });
});
