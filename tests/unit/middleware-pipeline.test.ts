/**
 * Unit Tests for Middleware Pipeline
 *
 * Tests covering:
 * - MiddlewarePipeline: adding, removing, running middleware
 * - PipelineBuilder: fluent API for building pipelines
 * - Event handling and error recovery
 * - Priority ordering
 */

import {
  MiddlewarePipeline,
  PipelineBuilder,
  createPipeline,
  PipelineEvent,
} from '../../src/middleware/pipeline';

import {
  ConversationMiddleware,
  ConversationContext,
  MiddlewareResult,
  MiddlewareAction,
  continueResult,
  stopResult,
  compactResult,
  injectMessageResult,
  createInitialStats,
  defaultModelInfo,
} from '../../src/middleware/types';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a mock middleware for testing
 */
function createMockMiddleware(
  name: string,
  priority: number,
  beforeResult: MiddlewareResult = continueResult(),
  afterResult: MiddlewareResult = continueResult()
): ConversationMiddleware {
  return {
    name,
    priority,
    beforeTurn: jest.fn().mockResolvedValue(beforeResult),
    afterTurn: jest.fn().mockResolvedValue(afterResult),
    reset: jest.fn(),
  };
}

/**
 * Create a mock conversation context
 */
function createMockContext(): ConversationContext {
  return {
    messages: [],
    stats: createInitialStats(),
    model: defaultModelInfo(),
    workingDirectory: '/test',
    sessionId: 'test-session',
    autoApprove: false,
    metadata: {},
  };
}

// =============================================================================
// MiddlewarePipeline Tests
// =============================================================================

describe('MiddlewarePipeline', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  describe('Constructor', () => {
    it('should create empty pipeline', () => {
      expect(pipeline.count).toBe(0);
      expect(pipeline.getNames()).toEqual([]);
    });

    it('should accept initial middlewares', () => {
      const m1 = createMockMiddleware('m1', 1);
      const m2 = createMockMiddleware('m2', 2);

      const p = new MiddlewarePipeline([m1, m2]);

      expect(p.count).toBe(2);
      expect(p.getNames()).toEqual(['m1', 'm2']);
    });

    it('should sort initial middlewares by priority', () => {
      const m1 = createMockMiddleware('high', 10);
      const m2 = createMockMiddleware('low', 1);
      const m3 = createMockMiddleware('medium', 5);

      const p = new MiddlewarePipeline([m1, m2, m3]);

      expect(p.getNames()).toEqual(['low', 'medium', 'high']);
    });
  });

  describe('add', () => {
    it('should add middleware to pipeline', () => {
      const middleware = createMockMiddleware('test', 1);

      pipeline.add(middleware);

      expect(pipeline.count).toBe(1);
      expect(pipeline.has('test')).toBe(true);
    });

    it('should maintain priority order when adding', () => {
      pipeline.add(createMockMiddleware('high', 10));
      pipeline.add(createMockMiddleware('low', 1));
      pipeline.add(createMockMiddleware('medium', 5));

      expect(pipeline.getNames()).toEqual(['low', 'medium', 'high']);
    });

    it('should return this for chaining', () => {
      const result = pipeline.add(createMockMiddleware('test', 1));

      expect(result).toBe(pipeline);
    });
  });

  describe('remove', () => {
    it('should remove middleware by name', () => {
      pipeline.add(createMockMiddleware('toRemove', 1));
      pipeline.add(createMockMiddleware('toKeep', 2));

      const removed = pipeline.remove('toRemove');

      expect(removed).toBe(true);
      expect(pipeline.has('toRemove')).toBe(false);
      expect(pipeline.has('toKeep')).toBe(true);
    });

    it('should return false for non-existent middleware', () => {
      const removed = pipeline.remove('nonexistent');

      expect(removed).toBe(false);
    });
  });

  describe('get', () => {
    it('should return middleware by name', () => {
      const middleware = createMockMiddleware('findMe', 1);
      pipeline.add(middleware);

      expect(pipeline.get('findMe')).toBe(middleware);
    });

    it('should return undefined for non-existent middleware', () => {
      expect(pipeline.get('nonexistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for existing middleware', () => {
      pipeline.add(createMockMiddleware('exists', 1));

      expect(pipeline.has('exists')).toBe(true);
    });

    it('should return false for non-existent middleware', () => {
      expect(pipeline.has('nonexistent')).toBe(false);
    });
  });

  describe('setEnabled / isEnabled', () => {
    it('should be enabled by default', () => {
      expect(pipeline.isEnabled()).toBe(true);
    });

    it('should disable pipeline', () => {
      pipeline.setEnabled(false);

      expect(pipeline.isEnabled()).toBe(false);
    });

    it('should re-enable pipeline', () => {
      pipeline.setEnabled(false);
      pipeline.setEnabled(true);

      expect(pipeline.isEnabled()).toBe(true);
    });
  });

  describe('runBefore', () => {
    it('should run all middlewares beforeTurn in priority order', async () => {
      const callOrder: string[] = [];

      const m1 = createMockMiddleware('first', 1);
      (m1.beforeTurn as jest.Mock).mockImplementation(async () => {
        callOrder.push('first');
        return continueResult();
      });

      const m2 = createMockMiddleware('second', 2);
      (m2.beforeTurn as jest.Mock).mockImplementation(async () => {
        callOrder.push('second');
        return continueResult();
      });

      pipeline.add(m2).add(m1);

      await pipeline.runBefore(createMockContext());

      expect(callOrder).toEqual(['first', 'second']);
    });

    it('should return continue when all middlewares continue', async () => {
      pipeline.add(createMockMiddleware('m1', 1));
      pipeline.add(createMockMiddleware('m2', 2));

      const result = await pipeline.runBefore(createMockContext());

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
    });

    it('should stop at first non-continue result', async () => {
      const m1 = createMockMiddleware('m1', 1, stopResult('test stop', 'Stop message'));
      const m2 = createMockMiddleware('m2', 2);

      pipeline.add(m1).add(m2);

      const result = await pipeline.runBefore(createMockContext());

      expect(result.action).toBe(MiddlewareAction.STOP);
      expect(result.message).toBe('Stop message');
      expect(m2.beforeTurn).not.toHaveBeenCalled();
    });

    it('should return continue when pipeline is disabled', async () => {
      const m1 = createMockMiddleware('m1', 1, stopResult('blocked'));
      pipeline.add(m1);
      pipeline.setEnabled(false);

      const result = await pipeline.runBefore(createMockContext());

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      expect(m1.beforeTurn).not.toHaveBeenCalled();
    });

    it('should continue on middleware error', async () => {
      const m1 = createMockMiddleware('errorMiddleware', 1);
      (m1.beforeTurn as jest.Mock).mockRejectedValue(new Error('Test error'));

      const m2 = createMockMiddleware('normalMiddleware', 2);

      pipeline.add(m1).add(m2);

      const result = await pipeline.runBefore(createMockContext());

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      expect(m2.beforeTurn).toHaveBeenCalled();
    });

    it('should pass context to middleware', async () => {
      const middleware = createMockMiddleware('m1', 1);
      pipeline.add(middleware);

      const context = createMockContext();
      context.sessionId = 'custom-session';

      await pipeline.runBefore(context);

      expect(middleware.beforeTurn).toHaveBeenCalledWith(context);
    });
  });

  describe('runAfter', () => {
    it('should run all middlewares afterTurn in priority order', async () => {
      const callOrder: string[] = [];

      const m1 = createMockMiddleware('first', 1);
      (m1.afterTurn as jest.Mock).mockImplementation(async () => {
        callOrder.push('first');
        return continueResult();
      });

      const m2 = createMockMiddleware('second', 2);
      (m2.afterTurn as jest.Mock).mockImplementation(async () => {
        callOrder.push('second');
        return continueResult();
      });

      pipeline.add(m2).add(m1);

      await pipeline.runAfter(createMockContext());

      expect(callOrder).toEqual(['first', 'second']);
    });

    it('should return continue when all middlewares continue', async () => {
      pipeline.add(createMockMiddleware('m1', 1));

      const result = await pipeline.runAfter(createMockContext());

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
    });

    it('should stop at first non-continue result', async () => {
      const m1 = createMockMiddleware(
        'm1',
        1,
        continueResult(),
        compactResult('need compaction')
      );
      const m2 = createMockMiddleware('m2', 2);

      pipeline.add(m1).add(m2);

      const result = await pipeline.runAfter(createMockContext());

      expect(result.action).toBe(MiddlewareAction.COMPACT);
      expect(m2.afterTurn).not.toHaveBeenCalled();
    });

    it('should return continue when pipeline is disabled', async () => {
      const m1 = createMockMiddleware(
        'm1',
        1,
        continueResult(),
        stopResult('blocked')
      );
      pipeline.add(m1);
      pipeline.setEnabled(false);

      const result = await pipeline.runAfter(createMockContext());

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      expect(m1.afterTurn).not.toHaveBeenCalled();
    });

    it('should continue on middleware error', async () => {
      const m1 = createMockMiddleware('errorMiddleware', 1);
      (m1.afterTurn as jest.Mock).mockRejectedValue(new Error('Test error'));

      const m2 = createMockMiddleware('normalMiddleware', 2);

      pipeline.add(m1).add(m2);

      const result = await pipeline.runAfter(createMockContext());

      expect(result.action).toBe(MiddlewareAction.CONTINUE);
      expect(m2.afterTurn).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should call reset on all middlewares', () => {
      const m1 = createMockMiddleware('m1', 1);
      const m2 = createMockMiddleware('m2', 2);

      pipeline.add(m1).add(m2);
      pipeline.reset();

      expect(m1.reset).toHaveBeenCalled();
      expect(m2.reset).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should remove all middlewares', () => {
      pipeline.add(createMockMiddleware('m1', 1));
      pipeline.add(createMockMiddleware('m2', 2));

      pipeline.clear();

      expect(pipeline.count).toBe(0);
      expect(pipeline.getNames()).toEqual([]);
    });
  });

  describe('Event Handling', () => {
    it('should emit middleware:before event', async () => {
      const handler = jest.fn();
      pipeline.on(handler);

      const middleware = createMockMiddleware('test', 1);
      pipeline.add(middleware);

      await pipeline.runBefore(createMockContext());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'middleware:before',
          middlewareName: 'test',
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit middleware:after event', async () => {
      const handler = jest.fn();
      pipeline.on(handler);

      const middleware = createMockMiddleware('test', 1);
      pipeline.add(middleware);

      await pipeline.runAfter(createMockContext());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'middleware:after',
          middlewareName: 'test',
        })
      );
    });

    it('should emit middleware:action event on non-continue', async () => {
      const handler = jest.fn();
      pipeline.on(handler);

      const middleware = createMockMiddleware(
        'test',
        1,
        stopResult('stopping', 'Stop message')
      );
      pipeline.add(middleware);

      await pipeline.runBefore(createMockContext());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'middleware:action',
          middlewareName: 'test',
          action: MiddlewareAction.STOP,
          message: 'Stop message',
        })
      );
    });

    it('should emit middleware:error event on error', async () => {
      const handler = jest.fn();
      pipeline.on(handler);

      const middleware = createMockMiddleware('test', 1);
      (middleware.beforeTurn as jest.Mock).mockRejectedValue(new Error('Test error'));
      pipeline.add(middleware);

      await pipeline.runBefore(createMockContext());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'middleware:error',
          middlewareName: 'test',
          error: expect.any(Error),
        })
      );
    });

    it('should emit pipeline:reset event', () => {
      const handler = jest.fn();
      pipeline.on(handler);

      pipeline.reset();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pipeline:reset',
        })
      );
    });

    it('should return unsubscribe function', () => {
      const handler = jest.fn();
      const unsubscribe = pipeline.on(handler);

      pipeline.reset();
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      pipeline.reset();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle handler errors gracefully', async () => {
      const errorHandler = jest.fn(() => {
        throw new Error('Handler error');
      });
      const normalHandler = jest.fn();

      pipeline.on(errorHandler);
      pipeline.on(normalHandler);

      pipeline.add(createMockMiddleware('test', 1));

      // Should not throw
      await pipeline.runBefore(createMockContext());

      expect(normalHandler).toHaveBeenCalled();
    });
  });

  describe('count', () => {
    it('should return correct middleware count', () => {
      expect(pipeline.count).toBe(0);

      pipeline.add(createMockMiddleware('m1', 1));
      expect(pipeline.count).toBe(1);

      pipeline.add(createMockMiddleware('m2', 2));
      expect(pipeline.count).toBe(2);

      pipeline.remove('m1');
      expect(pipeline.count).toBe(1);
    });
  });
});

// =============================================================================
// PipelineBuilder Tests
// =============================================================================

describe('PipelineBuilder', () => {
  describe('use', () => {
    it('should add middleware to builder', () => {
      const builder = new PipelineBuilder();
      const middleware = createMockMiddleware('test', 1);

      const result = builder.use(middleware);

      expect(result).toBe(builder);
    });

    it('should support chaining', () => {
      const builder = new PipelineBuilder();

      builder
        .use(createMockMiddleware('m1', 1))
        .use(createMockMiddleware('m2', 2))
        .use(createMockMiddleware('m3', 3));

      const pipeline = builder.build();
      expect(pipeline.count).toBe(3);
    });
  });

  describe('useAll', () => {
    it('should add multiple middlewares', () => {
      const builder = new PipelineBuilder();

      builder.useAll([
        createMockMiddleware('m1', 1),
        createMockMiddleware('m2', 2),
      ]);

      const pipeline = builder.build();
      expect(pipeline.count).toBe(2);
    });

    it('should return builder for chaining', () => {
      const builder = new PipelineBuilder();

      const result = builder.useAll([createMockMiddleware('m1', 1)]);

      expect(result).toBe(builder);
    });
  });

  describe('useIf', () => {
    it('should add middleware when condition is true', () => {
      const builder = new PipelineBuilder();

      builder.useIf(true, createMockMiddleware('conditional', 1));

      const pipeline = builder.build();
      expect(pipeline.has('conditional')).toBe(true);
    });

    it('should not add middleware when condition is false', () => {
      const builder = new PipelineBuilder();

      builder.useIf(false, createMockMiddleware('conditional', 1));

      const pipeline = builder.build();
      expect(pipeline.has('conditional')).toBe(false);
    });

    it('should return builder for chaining', () => {
      const builder = new PipelineBuilder();

      const result = builder.useIf(true, createMockMiddleware('m1', 1));

      expect(result).toBe(builder);
    });
  });

  describe('build', () => {
    it('should create pipeline with middlewares in priority order', () => {
      const builder = new PipelineBuilder();

      builder
        .use(createMockMiddleware('high', 10))
        .use(createMockMiddleware('low', 1))
        .use(createMockMiddleware('medium', 5));

      const pipeline = builder.build();

      expect(pipeline.getNames()).toEqual(['low', 'medium', 'high']);
    });

    it('should create independent pipeline instances', () => {
      const builder = new PipelineBuilder();
      builder.use(createMockMiddleware('m1', 1));

      const pipeline1 = builder.build();
      const pipeline2 = builder.build();

      expect(pipeline1).not.toBe(pipeline2);
    });
  });
});

// =============================================================================
// createPipeline Helper Tests
// =============================================================================

describe('createPipeline', () => {
  it('should create a new PipelineBuilder', () => {
    const builder = createPipeline();

    expect(builder).toBeInstanceOf(PipelineBuilder);
  });

  it('should allow fluent pipeline creation', async () => {
    const pipeline = createPipeline()
      .use(createMockMiddleware('m1', 1))
      .use(createMockMiddleware('m2', 2))
      .build();

    const result = await pipeline.runBefore(createMockContext());

    expect(result.action).toBe(MiddlewareAction.CONTINUE);
    expect(pipeline.count).toBe(2);
  });
});

// =============================================================================
// Helper Function Tests
// =============================================================================

describe('Middleware Result Helpers', () => {
  describe('continueResult', () => {
    it('should create continue result', () => {
      const result = continueResult();

      expect(result).toEqual({
        action: MiddlewareAction.CONTINUE,
      });
    });
  });

  describe('stopResult', () => {
    it('should create stop result with reason', () => {
      const result = stopResult('max turns reached');

      expect(result).toEqual({
        action: MiddlewareAction.STOP,
        reason: 'max turns reached',
        message: undefined,
      });
    });

    it('should create stop result with reason and message', () => {
      const result = stopResult('max turns', 'Session limit reached');

      expect(result).toEqual({
        action: MiddlewareAction.STOP,
        reason: 'max turns',
        message: 'Session limit reached',
      });
    });
  });

  describe('compactResult', () => {
    it('should create compact result', () => {
      const result = compactResult('context too large');

      expect(result).toEqual({
        action: MiddlewareAction.COMPACT,
        reason: 'context too large',
        metadata: undefined,
      });
    });

    it('should include metadata', () => {
      const result = compactResult('context too large', { tokens: 100000 });

      expect(result.metadata).toEqual({ tokens: 100000 });
    });
  });

  describe('injectMessageResult', () => {
    it('should create inject message result', () => {
      const result = injectMessageResult('Warning: approaching token limit');

      expect(result).toEqual({
        action: MiddlewareAction.INJECT_MESSAGE,
        message: 'Warning: approaching token limit',
        reason: undefined,
      });
    });

    it('should include reason', () => {
      const result = injectMessageResult('Warning message', 'token warning');

      expect(result.reason).toBe('token warning');
    });
  });
});

describe('Context Helper Functions', () => {
  describe('createInitialStats', () => {
    it('should create initial stats with zero values', () => {
      const stats = createInitialStats();

      expect(stats.turns).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.promptTokens).toBe(0);
      expect(stats.completionTokens).toBe(0);
      expect(stats.sessionCost).toBe(0);
      expect(stats.toolCalls).toBe(0);
      expect(stats.successfulToolCalls).toBe(0);
      expect(stats.failedToolCalls).toBe(0);
      expect(stats.startTime).toBeInstanceOf(Date);
      expect(stats.durationMs).toBe(0);
    });
  });

  describe('defaultModelInfo', () => {
    it('should create default model info', () => {
      const model = defaultModelInfo();

      expect(model.name).toBe('unknown');
      expect(model.maxContextTokens).toBe(128000);
      expect(model.inputPricePerMillion).toBeGreaterThan(0);
      expect(model.outputPricePerMillion).toBeGreaterThan(0);
    });
  });
});
