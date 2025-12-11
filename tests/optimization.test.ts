/**
 * Tests for Optimization Modules
 * - Model Routing (FrugalGPT)
 * - Tool Filtering (Less-is-More)
 * - Latency Optimizer
 */

import {
  classifyTaskComplexity,
  selectModel,
  calculateCost,
  getCostComparison,
  ModelRouter,
  getModelRouter,
  initializeModelRouter,
  GROK_MODELS,
  DEFAULT_ROUTING_CONFIG,
  type TaskClassification,
  type RoutingDecision,
  type ModelTier,
} from '../src/optimization/model-routing.js';

import {
  filterTools,
  buildTaskContext,
  classifyTaskType,
  extractKeywords,
  getFilteringStats,
  detectFileOps,
  detectExecution,
  detectSearch,
  type TaskContext,
  type TaskType,
} from '../src/optimization/tool-filtering.js';

import {
  LatencyOptimizer,
  StreamingOptimizer,
  getLatencyOptimizer,
  getStreamingOptimizer,
  measureLatency,
  precompute,
  LATENCY_THRESHOLDS,
  OPERATION_TARGETS,
} from '../src/optimization/latency-optimizer.js';

import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions';

// ============================================================================
// Model Routing Tests
// ============================================================================

describe('Model Routing', () => {
  describe('GROK_MODELS', () => {
    it('should have all model tiers defined', () => {
      expect(GROK_MODELS['grok-3-mini']).toBeDefined();
      expect(GROK_MODELS['grok-3']).toBeDefined();
      expect(GROK_MODELS['grok-3-reasoning']).toBeDefined();
      expect(GROK_MODELS['grok-2-vision']).toBeDefined();
    });

    it('should have correct tier assignments', () => {
      expect(GROK_MODELS['grok-3-mini'].tier).toBe('mini');
      expect(GROK_MODELS['grok-3'].tier).toBe('standard');
      expect(GROK_MODELS['grok-3-reasoning'].tier).toBe('reasoning');
      expect(GROK_MODELS['grok-2-vision'].tier).toBe('vision');
    });

    it('should have increasing cost per tier', () => {
      const miniCost = GROK_MODELS['grok-3-mini'].costPerMillionTokens;
      const standardCost = GROK_MODELS['grok-3'].costPerMillionTokens;
      const reasoningCost = GROK_MODELS['grok-3-reasoning'].costPerMillionTokens;

      expect(miniCost).toBeLessThan(standardCost);
      expect(standardCost).toBeLessThan(reasoningCost);
    });
  });

  describe('classifyTaskComplexity', () => {
    it('should classify simple tasks', () => {
      const result = classifyTaskComplexity('show the file');
      expect(result.complexity).toBe('simple');
      expect(result.requiresReasoning).toBe(false);
    });

    it('should classify complex tasks', () => {
      const result = classifyTaskComplexity('analyze this code');
      expect(result.complexity).toBe('complex');
      expect(result.requiresReasoning).toBe(true);
    });

    it('should classify reasoning-heavy tasks', () => {
      const result = classifyTaskComplexity('megathink about the architecture and design a better solution');
      expect(result.complexity).toBe('reasoning_heavy');
      expect(result.requiresReasoning).toBe(true);
    });

    it('should detect vision requirements', () => {
      const result = classifyTaskComplexity('analyze this image screenshot.png');
      expect(result.requiresVision).toBe(true);
    });

    it('should detect long context needs', () => {
      const longHistory = Array(200).fill('Previous message with substantial content here');
      const result = classifyTaskComplexity('summarize', longHistory);
      expect(result.estimatedTokens).toBeGreaterThan(1000);
    });

    it('should have lower confidence with mixed signals', () => {
      // Contains both simple ("show") and reasoning ("analyze") indicators
      const result = classifyTaskComplexity('show and analyze this');
      expect(result.confidence).toBeLessThan(0.8);
    });
  });

  describe('selectModel', () => {
    it('should respect user preference', () => {
      const classification: TaskClassification = {
        complexity: 'simple',
        requiresVision: false,
        requiresReasoning: false,
        requiresLongContext: false,
        estimatedTokens: 100,
        confidence: 0.9,
      };

      const result = selectModel(classification, 'grok-3-reasoning');
      expect(result.recommendedModel).toBe('grok-3-reasoning');
      expect(result.reason).toBe('User preference');
    });

    it('should select vision model for image tasks', () => {
      const classification: TaskClassification = {
        complexity: 'moderate',
        requiresVision: true,
        requiresReasoning: false,
        requiresLongContext: false,
        estimatedTokens: 500,
        confidence: 0.8,
      };

      const result = selectModel(classification);
      expect(result.recommendedModel).toBe('grok-2-vision');
      expect(result.tier).toBe('vision');
    });

    it('should select mini model for simple tasks', () => {
      const classification: TaskClassification = {
        complexity: 'simple',
        requiresVision: false,
        requiresReasoning: false,
        requiresLongContext: false,
        estimatedTokens: 100,
        confidence: 0.9,
      };

      const result = selectModel(classification);
      expect(result.recommendedModel).toBe('grok-3-mini');
    });

    it('should select reasoning model for complex reasoning', () => {
      const classification: TaskClassification = {
        complexity: 'reasoning_heavy',
        requiresVision: false,
        requiresReasoning: true,
        requiresLongContext: false,
        estimatedTokens: 2000,
        confidence: 0.9,
      };

      const result = selectModel(classification);
      expect(result.recommendedModel).toBe('grok-3-reasoning');
    });

    it('should provide alternative model', () => {
      const classification: TaskClassification = {
        complexity: 'moderate',
        requiresVision: false,
        requiresReasoning: false,
        requiresLongContext: false,
        estimatedTokens: 500,
        confidence: 0.8,
      };

      const result = selectModel(classification);
      expect(result.alternativeModel).toBeDefined();
    });

    it('should handle unavailable models', () => {
      const classification: TaskClassification = {
        complexity: 'simple',
        requiresVision: false,
        requiresReasoning: false,
        requiresLongContext: false,
        estimatedTokens: 100,
        confidence: 0.9,
      };

      const result = selectModel(classification, undefined, ['grok-3']);
      expect(result.recommendedModel).toBe('grok-3');
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for known model', () => {
      const cost = calculateCost(1000000, 'grok-3-mini');
      expect(cost).toBeGreaterThan(0);
    });

    it('should return 0 for unknown model', () => {
      const cost = calculateCost(1000, 'unknown-model');
      expect(cost).toBe(0);
    });

    it('should scale with token count', () => {
      const cost1 = calculateCost(1000, 'grok-3');
      const cost2 = calculateCost(2000, 'grok-3');
      expect(cost2).toBeCloseTo(cost1 * 2);
    });
  });

  describe('getCostComparison', () => {
    it('should return comparison for all models', () => {
      const comparison = getCostComparison(10000);
      expect(comparison.length).toBe(Object.keys(GROK_MODELS).length);
    });

    it('should sort by cost ascending', () => {
      const comparison = getCostComparison(10000);
      for (let i = 1; i < comparison.length; i++) {
        expect(comparison[i].cost).toBeGreaterThanOrEqual(comparison[i - 1].cost);
      }
    });

    it('should include savings percentage', () => {
      const comparison = getCostComparison(10000);
      expect(comparison[0].savings).toMatch(/-\d+%|baseline/);
    });
  });

  describe('ModelRouter', () => {
    it('should create router with default config', () => {
      const router = new ModelRouter();
      expect(router.getConfig()).toEqual(DEFAULT_ROUTING_CONFIG);
    });

    it('should create router with custom config', () => {
      const router = new ModelRouter({
        enabled: false,
        defaultModel: 'grok-3-mini',
      });
      expect(router.getConfig().enabled).toBe(false);
      expect(router.getConfig().defaultModel).toBe('grok-3-mini');
    });

    it('should route when enabled', () => {
      const router = new ModelRouter({ enabled: true });
      const decision = router.route('analyze this complex problem');
      expect(decision.recommendedModel).toBeDefined();
    });

    it('should use default model when disabled', () => {
      const router = new ModelRouter({ enabled: false, defaultModel: 'grok-3' });
      const decision = router.route('analyze this');
      expect(decision.recommendedModel).toBe('grok-3');
      expect(decision.reason).toBe('Routing disabled');
    });

    it('should use default model with low confidence', () => {
      const router = new ModelRouter({ minConfidence: 0.95 });
      // Mixed signals should have lower confidence
      const decision = router.route('show and think about this analyze display');
      expect(decision.reason).toContain('Low confidence');
    });

    it('should record usage', () => {
      const router = new ModelRouter();
      router.recordUsage('grok-3', 1000, 0.003);
      router.recordUsage('grok-3', 500, 0.0015);

      const stats = router.getUsageStats();
      expect(stats.get('grok-3')?.calls).toBe(2);
      expect(stats.get('grok-3')?.tokens).toBe(1500);
    });

    it('should calculate total cost', () => {
      const router = new ModelRouter();
      router.recordUsage('grok-3', 1000, 0.003);
      router.recordUsage('grok-3-mini', 500, 0.0001);

      expect(router.getTotalCost()).toBeCloseTo(0.0031, 4);
    });

    it('should estimate savings', () => {
      const router = new ModelRouter();
      router.recordUsage('grok-3-mini', 1000, 0.0003);
      router.recordUsage('grok-3', 1000, 0.003);

      const savings = router.getEstimatedSavings();
      expect(savings.saved).toBeGreaterThan(0);
      expect(savings.percentage).toBeGreaterThan(0);
    });

    it('should update config', () => {
      const router = new ModelRouter();
      router.updateConfig({ costSensitivity: 'high' });
      expect(router.getConfig().costSensitivity).toBe('high');
    });

    it('should prefer cheaper model with high cost sensitivity', () => {
      const router = new ModelRouter({ costSensitivity: 'high' });
      const decision = router.route('analyze this moderately complex task');

      // With high cost sensitivity, should prefer cheaper alternative
      const altConfig = decision.alternativeModel
        ? GROK_MODELS[decision.alternativeModel]
        : null;
      const recConfig = GROK_MODELS[decision.recommendedModel];

      if (altConfig && recConfig) {
        // Either recommended is cheaper or it's cost-optimized
        expect(
          decision.reason.includes('Cost-optimized') ||
          recConfig.costPerMillionTokens <= altConfig.costPerMillionTokens
        ).toBe(true);
      }
    });
  });

  describe('Singleton functions', () => {
    it('should return same instance from getModelRouter', () => {
      const router1 = getModelRouter();
      const router2 = getModelRouter();
      expect(router1).toBe(router2);
    });

    it('should create new instance with initializeModelRouter', () => {
      const router1 = getModelRouter();
      const router2 = initializeModelRouter({ enabled: false });
      expect(router1).not.toBe(router2);
    });
  });
});

// ============================================================================
// Tool Filtering Tests
// ============================================================================

describe('Tool Filtering', () => {
  // Mock tools for testing
  const mockTools: ChatCompletionFunctionTool[] = [
    {
      type: 'function',
      function: { name: 'Read', description: 'Read a file from disk', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'Write', description: 'Write content to a file', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'Edit', description: 'Edit a file in place', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'Bash', description: 'Execute shell commands', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'Grep', description: 'Search file contents with regex', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'Glob', description: 'Find files matching pattern', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'AST', description: 'Parse code abstract syntax tree', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'Git', description: 'Git version control operations', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'Test', description: 'Run test suite', parameters: {} },
    },
    {
      type: 'function',
      function: { name: 'Debug', description: 'Debug code execution', parameters: {} },
    },
  ];

  describe('classifyTaskType', () => {
    it('should classify file read tasks', () => {
      expect(classifyTaskType({ userMessage: 'read the config file' })).toBe('file_read');
      expect(classifyTaskType({ userMessage: 'show me the contents' })).toBe('file_read');
    });

    it('should classify file write tasks', () => {
      expect(classifyTaskType({ userMessage: 'write a new function' })).toBe('file_write');
      expect(classifyTaskType({ userMessage: 'create a new file' })).toBe('file_write');
    });

    it('should classify search tasks', () => {
      expect(classifyTaskType({ userMessage: 'find all typescript files' })).toBe('file_search');
      expect(classifyTaskType({ userMessage: 'search for usage of this function' })).toBe('file_search');
    });

    it('should classify execution tasks', () => {
      expect(classifyTaskType({ userMessage: 'run the tests' })).toBe('code_execution');
      expect(classifyTaskType({ userMessage: 'execute npm install' })).toBe('code_execution');
    });

    it('should classify git tasks', () => {
      expect(classifyTaskType({ userMessage: 'git commit the changes' })).toBe('git_operations');
      expect(classifyTaskType({ userMessage: 'push to main branch' })).toBe('git_operations');
    });

    it('should classify debugging tasks', () => {
      expect(classifyTaskType({ userMessage: 'debug this error' })).toBe('debugging');
      expect(classifyTaskType({ userMessage: 'fix this bug' })).toBe('debugging');
    });

    it('should return general for unclear tasks', () => {
      expect(classifyTaskType({ userMessage: 'hello' })).toBe('general');
    });
  });

  describe('extractKeywords', () => {
    it('should extract meaningful keywords', () => {
      const keywords = extractKeywords('read the typescript configuration file');
      expect(keywords).toContain('typescript');
      expect(keywords).toContain('configuration');
      expect(keywords).toContain('file');
    });

    it('should filter stop words', () => {
      const keywords = extractKeywords('the quick brown fox');
      expect(keywords).not.toContain('the');
      expect(keywords).toContain('quick');
      expect(keywords).toContain('brown');
      expect(keywords).toContain('fox');
    });

    it('should filter short words', () => {
      const keywords = extractKeywords('a is it so');
      expect(keywords.length).toBe(0);
    });
  });

  describe('detectFileOps', () => {
    it('should detect file operations', () => {
      expect(detectFileOps('read the file')).toBe(true);
      expect(detectFileOps('write to disk')).toBe(true);
      expect(detectFileOps('edit the config')).toBe(true);
      expect(detectFileOps('create new file')).toBe(true);
    });

    it('should not detect non-file operations', () => {
      expect(detectFileOps('think about this')).toBe(false);
      expect(detectFileOps('analyze the code')).toBe(false);
    });
  });

  describe('detectExecution', () => {
    it('should detect execution needs', () => {
      expect(detectExecution('run the tests')).toBe(true);
      expect(detectExecution('execute npm install')).toBe(true);
      expect(detectExecution('build the project')).toBe(true);
    });

    it('should not detect non-execution tasks', () => {
      expect(detectExecution('read the file')).toBe(false);
    });
  });

  describe('detectSearch', () => {
    it('should detect search needs', () => {
      expect(detectSearch('find all files')).toBe(true);
      expect(detectSearch('search for this')).toBe(true);
      expect(detectSearch('where is the config')).toBe(true);
    });
  });

  describe('buildTaskContext', () => {
    it('should build complete context', () => {
      const context = buildTaskContext(
        'read the config.ts file',
        'src/config.ts',
        ['src/config.ts', 'src/index.ts']
      );

      expect(context.userMessage).toBe('read the config.ts file');
      expect(context.currentFile).toBe('src/config.ts');
      expect(context.mentionedFiles).toHaveLength(2);
      expect(context.taskType).toBe('file_read');
      expect(context.involvesFileOps).toBe(true);
      expect(context.fileExtensions).toContain('ts');
    });

    it('should handle missing optional parameters', () => {
      const context = buildTaskContext('hello world');
      expect(context.currentFile).toBeUndefined();
      expect(context.mentionedFiles).toBeUndefined();
    });
  });

  describe('filterTools', () => {
    it('should filter to relevant tools', () => {
      const context = buildTaskContext('read the config file');
      const filtered = filterTools(mockTools, context);

      expect(filtered.length).toBeLessThanOrEqual(10);
      // Read should be included for file read task
      expect(filtered.some(t => t.function.name === 'Read')).toBe(true);
    });

    it('should include essential tools even with low relevance', () => {
      const context = buildTaskContext('do something');
      const filtered = filterTools(mockTools, context, 10, 0);

      // Essential tools should be present
      const names = filtered.map(t => t.function.name);
      expect(names.length).toBeGreaterThan(0);
    });

    it('should prioritize tools matching task type', () => {
      const context = buildTaskContext('run npm test');
      const filtered = filterTools(mockTools, context);

      const names = filtered.map(t => t.function.name);
      // Bash should be high priority for execution
      expect(names.indexOf('Bash')).toBeLessThan(5);
    });

    it('should respect maxTools limit', () => {
      const context = buildTaskContext('do everything');
      const filtered = filterTools(mockTools, context, 3);

      expect(filtered.length).toBeLessThanOrEqual(3);
    });

    it('should filter by minimum relevance', () => {
      const context = buildTaskContext('read file');
      const filtered = filterTools(mockTools, context, 10, 20);

      // Only high-relevance tools should pass
      expect(filtered.length).toBeLessThan(mockTools.length);
    });

    it('should return essential tools if filtering too aggressive', () => {
      const context = buildTaskContext('xyz123'); // No matching keywords
      const filtered = filterTools(mockTools, context, 10, 1000);

      // Should return at least essential tools
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  describe('getFilteringStats', () => {
    it('should return filtering statistics', () => {
      const context = buildTaskContext('read and edit the config file');
      const stats = getFilteringStats(mockTools, context);

      expect(stats.totalTools).toBe(mockTools.length);
      expect(stats.filteredCount).toBeGreaterThan(0);
      expect(stats.taskType).toBe('file_read');
      expect(stats.topTools.length).toBeLessThanOrEqual(10);
    });

    it('should include match reasons', () => {
      const context = buildTaskContext('grep for errors');
      const stats = getFilteringStats(mockTools, context);

      const grepTool = stats.topTools.find(t => t.name === 'Grep');
      expect(grepTool).toBeDefined();
      expect(grepTool!.reasons.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Latency Optimizer Tests
// ============================================================================

describe('Latency Optimizer', () => {
  describe('LATENCY_THRESHOLDS', () => {
    it('should have correct thresholds', () => {
      expect(LATENCY_THRESHOLDS.INSTANT).toBe(100);
      expect(LATENCY_THRESHOLDS.FAST).toBe(300);
      expect(LATENCY_THRESHOLDS.ACCEPTABLE).toBe(500);
      expect(LATENCY_THRESHOLDS.SLOW).toBe(1000);
      expect(LATENCY_THRESHOLDS.VERY_SLOW).toBe(3000);
    });
  });

  describe('OPERATION_TARGETS', () => {
    it('should have targets for common operations', () => {
      expect(OPERATION_TARGETS.file_read).toBeDefined();
      expect(OPERATION_TARGETS.file_write).toBeDefined();
      expect(OPERATION_TARGETS.grep_search).toBeDefined();
      expect(OPERATION_TARGETS.simple_response).toBeDefined();
    });

    it('should have increasing targets for complex operations', () => {
      expect(OPERATION_TARGETS.file_read).toBeLessThan(OPERATION_TARGETS.code_analysis);
      expect(OPERATION_TARGETS.simple_response).toBeLessThan(OPERATION_TARGETS.complex_response);
    });
  });

  describe('LatencyOptimizer', () => {
    let optimizer: LatencyOptimizer;

    beforeEach(() => {
      optimizer = new LatencyOptimizer();
    });

    afterEach(() => {
      optimizer.dispose(); // Clear interval and cleanup resources
    });

    it('should start and end operations', () => {
      const id = optimizer.startOperation('file_read');
      expect(id).toBeDefined();

      // Simulate some work
      const measurement = optimizer.endOperation(id);
      expect(measurement).toBeDefined();
      expect(measurement!.duration).toBeGreaterThanOrEqual(0);
    });

    it('should determine if target was met', async () => {
      const id = optimizer.startOperation('file_read');
      // Quick operation
      const measurement = optimizer.endOperation(id);

      expect(measurement!.status).toBe('met');
    });

    it('should measure async operations', async () => {
      const result = await optimizer.measure('file_read', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'done';
      });

      expect(result).toBe('done');
    });

    it('should handle errors in measured operations', async () => {
      await expect(
        optimizer.measure('file_read', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });

    it('should precompute and cache values', async () => {
      let computeCount = 0;
      const compute = async () => {
        computeCount++;
        return 'computed';
      };

      // First call computes
      const result1 = await optimizer.precompute('test-key', compute);
      expect(result1).toBe('computed');
      expect(computeCount).toBe(1);

      // Second call uses cache
      const result2 = await optimizer.precompute('test-key', compute);
      expect(result2).toBe('computed');
      expect(computeCount).toBe(1); // Still 1
    });

    it('should handle concurrent precompute calls', async () => {
      let computeCount = 0;
      const compute = async () => {
        computeCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'computed';
      };

      // Start two concurrent calls
      const [result1, result2] = await Promise.all([
        optimizer.precompute('concurrent-key', compute),
        optimizer.precompute('concurrent-key', compute),
      ]);

      expect(result1).toBe('computed');
      expect(result2).toBe('computed');
      expect(computeCount).toBe(1); // Only one computation
    });

    it('should invalidate cache', async () => {
      let computeCount = 0;
      const compute = async () => {
        computeCount++;
        return 'computed';
      };

      await optimizer.precompute('invalidate-key', compute);
      expect(computeCount).toBe(1);

      optimizer.invalidate('invalidate-key');

      await optimizer.precompute('invalidate-key', compute);
      expect(computeCount).toBe(2);
    });

    it('should invalidate by pattern', async () => {
      await optimizer.precompute('user:1', async () => 'user1');
      await optimizer.precompute('user:2', async () => 'user2');
      await optimizer.precompute('config:1', async () => 'config1');

      const count = optimizer.invalidatePattern(/^user:/);
      expect(count).toBe(2);
    });

    it('should register and run warmup tasks', async () => {
      let warmupRan = false;
      optimizer.registerWarmup(async () => {
        warmupRan = true;
      });

      await optimizer.warmup();
      expect(warmupRan).toBe(true);
    });

    it('should return statistics', async () => {
      // Perform some operations
      const id1 = optimizer.startOperation('file_read');
      optimizer.endOperation(id1);

      const id2 = optimizer.startOperation('file_write');
      optimizer.endOperation(id2);

      const stats = optimizer.getStats();

      expect(stats.totalOperations).toBe(2);
      expect(stats.metTarget).toBeGreaterThanOrEqual(0);
      expect(stats.avgDuration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate percentiles', async () => {
      // Perform multiple operations
      for (let i = 0; i < 10; i++) {
        const id = optimizer.startOperation('file_read');
        optimizer.endOperation(id);
      }

      const stats = optimizer.getStats();
      expect(stats.p50).toBeGreaterThanOrEqual(0);
      expect(stats.p95).toBeGreaterThanOrEqual(stats.p50);
      expect(stats.p99).toBeGreaterThanOrEqual(stats.p95);
    });

    it('should track by operation type', async () => {
      const id1 = optimizer.startOperation('file_read');
      optimizer.endOperation(id1);

      const id2 = optimizer.startOperation('file_write');
      optimizer.endOperation(id2);

      const stats = optimizer.getStats();
      expect(stats.byOperation['file_read']).toBeDefined();
      expect(stats.byOperation['file_write']).toBeDefined();
    });

    it('should return cache statistics', async () => {
      await optimizer.precompute('key1', async () => 'value1');
      await optimizer.precompute('key2', async () => 'value2');
      await optimizer.precompute('key1', async () => 'value1'); // Cache hit

      const stats = optimizer.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.totalAccesses).toBeGreaterThan(0);
    });

    it('should cleanup old measurements', async () => {
      const id = optimizer.startOperation('file_read');
      optimizer.endOperation(id);

      optimizer.cleanup();

      // Measurements within 5 minutes should still exist
      const stats = optimizer.getStats();
      expect(stats.totalOperations).toBe(1);
    });

    it('should emit events', (done) => {
      optimizer.on('operation:start', (data) => {
        expect(data.operation).toBe('file_read');
        done();
      });

      optimizer.startOperation('file_read');
    });

    it('should reset all data', async () => {
      const id = optimizer.startOperation('file_read');
      optimizer.endOperation(id);
      await optimizer.precompute('key', async () => 'value');

      optimizer.reset();

      expect(optimizer.getStats().totalOperations).toBe(0);
      expect(optimizer.getCacheStats().size).toBe(0);
    });
  });

  describe('StreamingOptimizer', () => {
    let optimizer: StreamingOptimizer;

    beforeEach(() => {
      optimizer = new StreamingOptimizer();
    });

    it('should record first token latency', () => {
      optimizer.recordFirstToken(100);
      optimizer.recordFirstToken(200);
      optimizer.recordFirstToken(150);

      const stats = optimizer.getStats();
      expect(stats.avgFirstToken).toBe(150);
    });

    it('should record total time', () => {
      optimizer.recordFirstToken(100);
      optimizer.recordTotalTime(5000);
      optimizer.recordFirstToken(200);
      optimizer.recordTotalTime(4000);

      const stats = optimizer.getStats();
      expect(stats.avgTotalTime).toBe(4500);
    });

    it('should calculate percentiles', () => {
      for (let i = 1; i <= 100; i++) {
        optimizer.recordFirstToken(i * 10);
      }

      const stats = optimizer.getStats();
      expect(stats.firstTokenP50).toBe(500);
      expect(stats.firstTokenP95).toBe(950);
    });

    it('should calculate target meeting percentage', () => {
      // Target is 300ms
      optimizer.recordFirstToken(100); // Meets
      optimizer.recordFirstToken(200); // Meets
      optimizer.recordFirstToken(400); // Exceeds
      optimizer.recordFirstToken(500); // Exceeds

      const stats = optimizer.getStats();
      expect(stats.meetingTarget).toBe(50);
    });

    it('should reset statistics', () => {
      optimizer.recordFirstToken(100);
      optimizer.recordTotalTime(1000);

      optimizer.reset();

      const stats = optimizer.getStats();
      expect(stats.avgFirstToken).toBe(0);
      expect(stats.avgTotalTime).toBe(0);
    });

    it('should handle empty data', () => {
      const stats = optimizer.getStats();
      expect(stats.avgFirstToken).toBe(0);
      expect(stats.meetingTarget).toBe(0);
    });
  });

  describe('Singleton functions', () => {
    it('should return same LatencyOptimizer instance', () => {
      const opt1 = getLatencyOptimizer();
      const opt2 = getLatencyOptimizer();
      expect(opt1).toBe(opt2);
    });

    it('should return same StreamingOptimizer instance', () => {
      const opt1 = getStreamingOptimizer();
      const opt2 = getStreamingOptimizer();
      expect(opt1).toBe(opt2);
    });
  });

  describe('Convenience functions', () => {
    it('measureLatency should use global optimizer', async () => {
      const result = await measureLatency('test_op', async () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it('precompute should use global optimizer', async () => {
      const result = await precompute('global-key', async () => 'global-value');
      expect(result).toBe('global-value');
    });
  });
});
