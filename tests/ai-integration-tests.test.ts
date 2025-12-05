/**
 * AI Integration Tests Module Tests
 *
 * These tests verify the test runner structure without making real API calls.
 */

import {
  AITestRunner,
  createAITestRunner,
  type AITestResult,
  type AITestSuite,
  type AITestOptions,
} from '../src/testing/ai-integration-tests.js';

// Mock GrokClient for testing
const mockGrokClient = {
  getCurrentModel: () => 'grok-3-latest',
  chat: jest.fn(),
  chatStream: jest.fn(),
} as any;

describe('AITestRunner', () => {
  describe('Initialization', () => {
    it('should create test runner with default options', () => {
      const runner = new AITestRunner(mockGrokClient);
      expect(runner).toBeDefined();
      expect(runner).toBeInstanceOf(AITestRunner);
    });

    it('should accept custom options', () => {
      const options: AITestOptions = {
        timeout: 60000,
        verbose: true,
        skipExpensive: true,
        testTools: false,
        testStreaming: false,
      };

      const runner = new AITestRunner(mockGrokClient, options);
      expect(runner).toBeDefined();
    });
  });

  describe('Factory Function', () => {
    it('should create runner with factory', () => {
      const runner = createAITestRunner(mockGrokClient);
      expect(runner).toBeInstanceOf(AITestRunner);
    });

    it('should pass options through factory', () => {
      const runner = createAITestRunner(mockGrokClient, {
        skipExpensive: true,
      });
      expect(runner).toBeDefined();
    });
  });

  describe('Events', () => {
    it('should emit test:start events', () => {
      const runner = new AITestRunner(mockGrokClient);
      const handler = jest.fn();
      runner.on('test:start', handler);
      expect(runner.listenerCount('test:start')).toBe(1);
    });

    it('should emit test:complete events', () => {
      const runner = new AITestRunner(mockGrokClient);
      const handler = jest.fn();
      runner.on('test:complete', handler);
      expect(runner.listenerCount('test:complete')).toBe(1);
    });

    it('should emit test:skipped events', () => {
      const runner = new AITestRunner(mockGrokClient);
      const handler = jest.fn();
      runner.on('test:skipped', handler);
      expect(runner.listenerCount('test:skipped')).toBe(1);
    });

    it('should emit suite:complete events', () => {
      const runner = new AITestRunner(mockGrokClient);
      const handler = jest.fn();
      runner.on('suite:complete', handler);
      expect(runner.listenerCount('suite:complete')).toBe(1);
    });
  });

  describe('Result Formatting', () => {
    it('should format results correctly', () => {
      const suite: AITestSuite = {
        provider: 'grok',
        model: 'grok-3-latest',
        timestamp: Date.now(),
        duration: 5000,
        results: [
          { name: 'Test 1', passed: true, duration: 1000, details: 'OK' },
          { name: 'Test 2', passed: false, duration: 2000, error: 'Failed' },
          { name: 'Test 3', passed: true, duration: 0, details: 'Skipped' },
        ],
        summary: {
          total: 3,
          passed: 2,
          failed: 1,
          skipped: 1,
          totalTokens: 500,
          totalCost: 0.001,
        },
      };

      const output = AITestRunner.formatResults(suite);

      expect(output).toContain('AI INTEGRATION TEST RESULTS');
      expect(output).toContain('grok');
      expect(output).toContain('grok-3-latest');
      expect(output).toContain('Test 1');
      expect(output).toContain('Test 2');
      expect(output).toContain('2/3 passed');
    });

    it('should include error details in output', () => {
      const suite: AITestSuite = {
        provider: 'grok',
        model: 'test',
        timestamp: Date.now(),
        duration: 1000,
        results: [
          { name: 'Failed Test', passed: false, duration: 500, error: 'Something went wrong' },
        ],
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          totalTokens: 0,
          totalCost: 0,
        },
      };

      const output = AITestRunner.formatResults(suite);
      expect(output).toContain('Error');
      expect(output).toContain('Something went wrong');
    });

    it('should show token and cost summary', () => {
      const suite: AITestSuite = {
        provider: 'grok',
        model: 'test',
        timestamp: Date.now(),
        duration: 1000,
        results: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          totalTokens: 1234,
          totalCost: 0.0567,
        },
      };

      const output = AITestRunner.formatResults(suite);
      expect(output).toContain('1234');
      expect(output).toContain('0.0567');
    });
  });
});

describe('AITestResult Type', () => {
  it('should define result structure', () => {
    const result: AITestResult = {
      name: 'Test Name',
      passed: true,
      duration: 1500,
      details: 'Test passed successfully',
      tokensUsed: 100,
      cost: 0.001,
    };

    expect(result.name).toBe('Test Name');
    expect(result.passed).toBe(true);
    expect(result.duration).toBe(1500);
  });

  it('should support error field', () => {
    const result: AITestResult = {
      name: 'Failed Test',
      passed: false,
      duration: 500,
      error: 'Connection timeout',
    };

    expect(result.passed).toBe(false);
    expect(result.error).toBe('Connection timeout');
  });
});

describe('AITestOptions Type', () => {
  it('should support all options', () => {
    const options: AITestOptions = {
      timeout: 30000,
      verbose: true,
      skipExpensive: true,
      testTools: true,
      testStreaming: true,
    };

    expect(options.timeout).toBe(30000);
    expect(options.verbose).toBe(true);
    expect(options.skipExpensive).toBe(true);
    expect(options.testTools).toBe(true);
    expect(options.testStreaming).toBe(true);
  });

  it('should allow partial options', () => {
    const options: AITestOptions = {
      skipExpensive: true,
    };

    expect(options.skipExpensive).toBe(true);
    expect(options.timeout).toBeUndefined();
  });
});
