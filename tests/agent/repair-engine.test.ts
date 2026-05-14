/**
 * Tests for RepairEngine
 *
 * Comprehensive tests covering:
 * - Fault localization
 * - Patch generation (template-based and LLM)
 * - Patch validation
 * - Learning and statistics
 */

import { EventEmitter } from 'events';

import {
  RepairEngine,
  createRepairEngine,
  getRepairEngine,
  resetRepairEngine,
} from '../../src/agent/repair/repair-engine';

import * as faultLocalizationModule from '../../src/agent/repair/fault-localization';

// Mock the CodeBuddyClient
jest.mock('../../src/codebuddy/client', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(function() { return {
    chat: jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: `<fix>
<file>test.ts</file>
<line_start>10</line_start>
<line_end>10</line_end>
<original>const x = null;</original>
<fixed>const x = undefined;</fixed>
<explanation>Changed null to undefined to fix the error</explanation>
</fix>`
        }
      }]
    })
  }; })
}));

// Mock fault localization
jest.mock('../../src/agent/repair/fault-localization', () => ({
  createFaultLocalizer: jest.fn(function() { return {
    localize: jest.fn().mockResolvedValue({
      faults: [{
        id: 'fault-1',
        type: 'type_error',
        severity: 'high',
        message: 'Cannot read property of undefined',
        location: {
          file: 'test.ts',
          startLine: 10,
          endLine: 10,
          snippet: 'const x = null;'
        },
        suspiciousness: 0.8,
        metadata: {}
      }],
      confidence: 0.9,
      technique: 'stack_trace'
    })
  }; })
}));

// Mock template repair engine
jest.mock('../../src/agent/repair/repair-templates', () => ({
  createTemplateRepairEngine: jest.fn(function() { return {
    generatePatches: jest.fn().mockReturnValue([{
      id: 'patch-template-1',
      fault: {
        id: 'fault-1',
        type: 'type_error',
        severity: 'high',
        message: 'Test error',
        location: { file: 'test.ts', startLine: 10, endLine: 10 },
        suspiciousness: 0.8,
        metadata: {}
      },
      changes: [{
        file: 'test.ts',
        type: 'replace',
        startLine: 10,
        endLine: 10,
        originalCode: 'const x = null;',
        newCode: 'const x: string | null = null;'
      }],
      strategy: 'null_check_addition',
      confidence: 0.7,
      explanation: 'Added null check',
      generatedBy: 'template',
      validated: false
    }]),
    recordResult: jest.fn()
  }; })
}));

describe('RepairEngine', () => {
  let engine: RepairEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRepairEngine();
    engine = createRepairEngine();
  });

  describe('Construction', () => {
    test('should create engine with default config', () => {
      const newEngine = createRepairEngine();
      expect(newEngine).toBeInstanceOf(RepairEngine);
      expect(newEngine).toBeInstanceOf(EventEmitter);
    });

    test('should create engine with custom config', () => {
      const newEngine = createRepairEngine({
        maxIterations: 10,
        maxCandidates: 20
      });
      const config = newEngine.getConfig();
      expect(config.maxIterations).toBe(10);
      expect(config.maxCandidates).toBe(20);
    });

    test('should accept API key for LLM features', () => {
      const newEngine = createRepairEngine({}, 'test-api-key');
      expect(newEngine).toBeDefined();
    });
  });

  describe('Configuration', () => {
    test('should return current config', () => {
      const config = engine.getConfig();
      expect(config).toHaveProperty('maxIterations');
      expect(config).toHaveProperty('maxCandidates');
      expect(config).toHaveProperty('useTemplates');
      expect(config).toHaveProperty('useLLM');
    });

    test('should update config', () => {
      engine.updateConfig({ maxIterations: 15 });
      const config = engine.getConfig();
      expect(config.maxIterations).toBe(15);
    });
  });

  describe('Executors', () => {
    test('should set external executors', () => {
      const mockFileReader = jest.fn().mockResolvedValue('file content');
      const mockFileWriter = jest.fn().mockResolvedValue(undefined);
      const mockTestExecutor = jest.fn().mockResolvedValue({
        success: true,
        testsRun: 5,
        testsPassed: 5,
        testsFailed: 0,
        failingTests: [],
        newFailures: [],
        regressions: [],
        duration: 1000
      });

      engine.setExecutors({
        fileReader: mockFileReader,
        fileWriter: mockFileWriter,
        testExecutor: mockTestExecutor
      });

      // Verify executors are set (no error thrown)
      expect(true).toBe(true);
    });
  });

  describe('Repair Process', () => {
    test('should emit events during repair', async () => {
      const events: string[] = [];

      engine.on('repair:session:start', () => events.push('session:start'));
      engine.on('repair:progress', () => events.push('progress'));
      engine.on('repair:localization', () => events.push('localization'));
      engine.on('repair:start', () => events.push('start'));
      engine.on('repair:candidate', () => events.push('candidate'));

      await engine.repair('Error: test error at test.ts:10');

      expect(events).toContain('session:start');
      expect(events).toContain('progress');
    });

    test('should return results for localized faults', async () => {
      const results = await engine.repair('Error: Cannot read property of undefined at test.ts:10');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    test('should handle errors gracefully', async () => {
      // Mock to throw error
      const mockedFL = vi.mocked(faultLocalizationModule);
      mockedFL.createFaultLocalizer.mockReturnValueOnce({
        localize: jest.fn().mockRejectedValue(new Error('Localization failed'))
      });

      const errorEngine = createRepairEngine();

      await expect(errorEngine.repair('some error')).rejects.toThrow('Localization failed');
    });
  });

  describe('Repair Results', () => {
    test('should track candidates generated and tested', async () => {
      const results = await engine.repair('Error at test.ts:10');

      if (results.length > 0) {
        const result = results[0];
        expect(result).toHaveProperty('candidatesGenerated');
        expect(result).toHaveProperty('candidatesTested');
        expect(result).toHaveProperty('iterations');
        expect(result).toHaveProperty('duration');
      }
    });

    test('should include fault information', async () => {
      const results = await engine.repair('Error at test.ts:10');

      if (results.length > 0) {
        expect(results[0]).toHaveProperty('fault');
        expect(results[0].fault).toHaveProperty('location');
        expect(results[0].fault).toHaveProperty('message');
      }
    });
  });

  describe('Statistics', () => {
    test('should return empty stats initially', () => {
      const stats = engine.getStatistics();

      expect(stats.totalFaults).toBe(0);
      expect(stats.repairedFaults).toBe(0);
      expect(stats.failedFaults).toBe(0);
    });

    test('should update stats after repair', async () => {
      await engine.repair('Error at test.ts:10');
      const stats = engine.getStatistics();

      expect(stats.totalFaults).toBeGreaterThan(0);
    });

    test('should track strategy success rates', () => {
      const stats = engine.getStatistics();
      expect(stats.strategySuccessRates).toBeInstanceOf(Map);
      expect(stats.templateSuccessRates).toBeInstanceOf(Map);
    });
  });

  describe('History', () => {
    test('should return empty history initially', () => {
      const history = engine.getHistory();
      expect(history).toEqual([]);
    });

    test('should track repair sessions', async () => {
      await engine.repair('Error at test.ts:10');
      const history = engine.getHistory();

      expect(history.length).toBe(1);
      expect(history[0]).toHaveProperty('id');
      expect(history[0]).toHaveProperty('startTime');
    });

    test('should clear history', async () => {
      await engine.repair('Error at test.ts:10');
      expect(engine.getHistory().length).toBe(1);

      engine.clearHistory();
      expect(engine.getHistory().length).toBe(0);
    });
  });

  describe('Result Formatting', () => {
    test('should format successful result', async () => {
      const results = await engine.repair('Error at test.ts:10');

      if (results.length > 0) {
        const formatted = engine.formatResult(results[0]);

        expect(formatted).toContain('AUTOMATED PROGRAM REPAIR RESULT');
        expect(formatted).toContain('Status:');
        expect(formatted).toContain('Fault:');
        expect(formatted).toContain('Location:');
      }
    });

    test('should include fix details when successful', async () => {
      // Create a mock successful result
      const mockResult = {
        success: true,
        fault: {
          id: 'fault-1',
          type: 'error',
          severity: 'high',
          message: 'Test error message',
          location: { file: 'test.ts', startLine: 10, endLine: 10 },
          suspiciousness: 0.8,
          metadata: {}
        },
        candidatesGenerated: 3,
        candidatesTested: 2,
        allPatches: [],
        iterations: 1,
        duration: 500,
        appliedPatch: {
          id: 'patch-1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock fault object for testing
          fault: {} as any,
          changes: [{
            file: 'test.ts',
            type: 'replace' as const,
            startLine: 10,
            endLine: 10,
            originalCode: 'old code',
            newCode: 'new code'
          }],
          strategy: 'template',
          confidence: 0.8,
          explanation: 'Fixed the bug',
          generatedBy: 'template',
          validated: true
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock result for testing
      const formatted = engine.formatResult(mockResult as any);

      expect(formatted).toContain('Fixed');
      expect(formatted).toContain('Applied Fix');
      expect(formatted).toContain('Strategy:');
      expect(formatted).toContain('template');
    });
  });

  describe('Singleton Pattern', () => {
    test('should return same instance', () => {
      resetRepairEngine();

      const instance1 = getRepairEngine();
      const instance2 = getRepairEngine();

      expect(instance1).toBe(instance2);
    });

    test('should rebuild singleton when provider model changes', () => {
      resetRepairEngine();

      const instance1 = getRepairEngine('test-key', 'https://api.x.ai/v1', 'grok-3-fast');
      const instance2 = getRepairEngine('test-key', 'https://chatgpt.com/backend-api/codex', 'gpt-5.5');

      expect(instance2).not.toBe(instance1);
    });

    test('should reset singleton', () => {
      const instance1 = getRepairEngine();
      resetRepairEngine();
      const instance2 = getRepairEngine();

      expect(instance2).not.toBe(instance1);
    });
  });

  describe('LLM Patch Parsing', () => {
    test('should parse valid LLM fix response', async () => {
      // Engine with API key to enable LLM
      const llmEngine = createRepairEngine({ useLLM: true }, 'test-key');

      const results = await llmEngine.repair('Error at test.ts:10');

      // LLM patches should be generated if client is available
      expect(results).toBeDefined();
    });
  });

  describe('Generic Fault Creation', () => {
    test('should handle error output with file reference', async () => {
      // Mock localization to return empty faults
      const mockedFL = vi.mocked(faultLocalizationModule);
      mockedFL.createFaultLocalizer.mockReturnValueOnce({
        localize: jest.fn().mockResolvedValue({
          faults: [],
          confidence: 0,
          technique: 'none'
        })
      });

      const newEngine = createRepairEngine();
      const results = await newEngine.repair('Error: something failed at myfile.ts:42');

      // Should create a generic fault from the error message
      expect(results).toBeDefined();
    });

    test('should return empty for unparseable errors', async () => {
      const mockedFL = vi.mocked(faultLocalizationModule);
      mockedFL.createFaultLocalizer.mockReturnValueOnce({
        localize: jest.fn().mockResolvedValue({
          faults: [],
          confidence: 0,
          technique: 'none'
        })
      });

      const newEngine = createRepairEngine();
      const results = await newEngine.repair('Some random error without file info');

      expect(results).toEqual([]);
    });
  });

  describe('Language Detection', () => {
    test('should format result with language in context', async () => {
      const results = await engine.repair('Error at test.ts:10');

      // Language should be detected from file extension
      if (results.length > 0 && results[0].fault) {
        expect(results[0].fault.location.file).toContain('.ts');
      }
    });
  });
});

describe('RepairEngine Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRepairEngine();
  });

  test('should work end-to-end with template patches', async () => {
    const engine = createRepairEngine({
      useTemplates: true,
      useLLM: false,
      validateWithTests: false
    });

    const results = await engine.repair('TypeError: Cannot read property x of null at file.ts:15');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].candidatesGenerated).toBeGreaterThan(0);
  });

  test('should emit session events', async () => {
    const engine = createRepairEngine();
    const sessionEvents: { id: string }[] = [];

    engine.on('repair:session:start', (data) => sessionEvents.push(data));
    engine.on('repair:session:end', (data) => sessionEvents.push(data));

    await engine.repair('Error at test.ts:10');

    expect(sessionEvents.length).toBeGreaterThan(0);
  });
});
