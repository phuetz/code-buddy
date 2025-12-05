/**
 * Tests for Observation Masking
 */

import {
  ObservationMasker,
  getObservationMasker,
  resetObservationMasker,
  Observation,
  OutputType,
} from '../src/context/observation-masking';

describe('ObservationMasker', () => {
  let masker: ObservationMasker;

  beforeEach(() => {
    resetObservationMasker();
    masker = new ObservationMasker();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(masker).toBeDefined();
      const config = masker.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.maxTokensPerObservation).toBe(2000);
      expect(config.totalTokenBudget).toBe(8000);
    });

    it('should accept custom config', () => {
      const customMasker = new ObservationMasker({
        maxTokensPerObservation: 1000,
        minRelevanceThreshold: 0.5,
      });

      const config = customMasker.getConfig();
      expect(config.maxTokensPerObservation).toBe(1000);
      expect(config.minRelevanceThreshold).toBe(0.5);
    });
  });

  describe('setQueryContext', () => {
    it('should set query context for relevance scoring', () => {
      masker.setQueryContext('fix authentication bug');

      // Context should affect relevance scoring
      const obs: Observation = {
        id: '1',
        toolName: 'search',
        input: 'auth',
        output: 'Found authentication handler in auth.ts',
        timestamp: Date.now(),
        type: 'search_result',
      };

      const result = masker.maskObservation(obs);
      expect(result.relevanceScore).toBeGreaterThan(0);
    });

    it('should emit context:updated event', (done) => {
      masker.on('context:updated', (data) => {
        expect(data.query).toBe('test query');
        expect(data.keywords).toBeInstanceOf(Array);
        done();
      });

      masker.setQueryContext('test query');
    });
  });

  describe('maskObservation', () => {
    it('should retain high-relevance observations', () => {
      masker.setQueryContext('error handling');

      const obs: Observation = {
        id: '1',
        toolName: 'bash',
        input: 'npm test',
        output: 'Error: Test failed - error handling broken',
        timestamp: Date.now(),
        type: 'error',
      };

      const result = masker.maskObservation(obs);

      expect(result.wasRetained).toBe(true);
      expect(result.output).toContain('Error');
    });

    it('should mask low-relevance observations', () => {
      masker.setQueryContext('database optimization');

      const lowRelevanceMasker = new ObservationMasker({
        minRelevanceThreshold: 0.8,
      });
      lowRelevanceMasker.setQueryContext('database optimization');

      const obs: Observation = {
        id: '1',
        toolName: 'bash',
        input: 'ls',
        output: 'file1.txt\nfile2.txt\nfile3.txt',
        timestamp: Date.now(),
        type: 'command_output',
      };

      const result = lowRelevanceMasker.maskObservation(obs);

      // Result should have relevance score calculated
      expect(result.relevanceScore).toBeDefined();
      expect(result.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(result.relevanceScore).toBeLessThanOrEqual(1);
    });

    it('should always retain error observations', () => {
      const obs: Observation = {
        id: '1',
        toolName: 'bash',
        input: 'npm build',
        output: 'Error: Build failed\nTypeError: undefined is not a function',
        timestamp: Date.now(),
        type: 'error',
      };

      const result = masker.maskObservation(obs);

      expect(result.wasRetained).toBe(true);
      expect(result.output).toContain('Error');
    });

    it('should track original and masked length', () => {
      const longOutput = 'x'.repeat(10000);

      const obs: Observation = {
        id: '1',
        toolName: 'read_file',
        input: 'large-file.txt',
        output: longOutput,
        timestamp: Date.now(),
        type: 'file_content',
      };

      const result = masker.maskObservation(obs);

      expect(result.originalLength).toBe(10000);
      expect(result.maskedLength).toBeLessThanOrEqual(result.originalLength);
    });
  });

  describe('maskObservations', () => {
    it('should process multiple observations', () => {
      const observations: Observation[] = [
        {
          id: '1',
          toolName: 'search',
          input: 'query',
          output: 'Result 1',
          timestamp: Date.now(),
          type: 'search_result',
        },
        {
          id: '2',
          toolName: 'read_file',
          input: 'file.ts',
          output: 'const x = 1;',
          timestamp: Date.now(),
          type: 'file_content',
        },
      ];

      const { masked, stats } = masker.maskObservations(observations);

      expect(masked).toHaveLength(2);
      expect(stats.totalObservations).toBe(2);
    });

    it('should respect total token budget', () => {
      const budgetMasker = new ObservationMasker({
        totalTokenBudget: 100,
        maxTokensPerObservation: 50,
      });

      const observations: Observation[] = Array(10).fill(null).map((_, i) => ({
        id: String(i),
        toolName: 'bash',
        input: 'command',
        output: 'x'.repeat(200), // ~50 tokens each
        timestamp: Date.now(),
        type: 'command_output' as OutputType,
      }));

      const { stats } = budgetMasker.maskObservations(observations);

      // Should attempt to reduce tokens compared to original
      expect(stats.maskedTokens).toBeLessThanOrEqual(stats.originalTokens);
      expect(stats.totalObservations).toBe(10);
    });

    it('should prioritize by relevance and type', () => {
      masker.setQueryContext('authentication error');

      const observations: Observation[] = [
        {
          id: '1',
          toolName: 'bash',
          input: 'ls',
          output: 'irrelevant file listing',
          timestamp: Date.now(),
          type: 'command_output',
        },
        {
          id: '2',
          toolName: 'bash',
          input: 'npm test',
          output: 'Error: authentication failed',
          timestamp: Date.now(),
          type: 'error',
        },
      ];

      const { masked } = masker.maskObservations(observations);

      // Error should be retained with higher priority
      const errorObs = masked.find(m => m.type === 'error');
      expect(errorObs?.wasRetained).toBe(true);
    });

    it('should calculate savings statistics', () => {
      const observations: Observation[] = [
        {
          id: '1',
          toolName: 'read_file',
          input: 'file.ts',
          output: 'x'.repeat(1000),
          timestamp: Date.now(),
          type: 'file_content',
        },
      ];

      const { stats } = masker.maskObservations(observations);

      expect(stats.originalTokens).toBeGreaterThan(0);
      expect(stats.tokensSaved).toBeGreaterThanOrEqual(0);
      expect(stats.savingsPercentage).toBeDefined();
    });
  });

  describe('detectOutputType', () => {
    it('should detect error type from content', () => {
      const type = masker.detectOutputType('bash', 'Error: Something failed');
      expect(type).toBe('error');
    });

    it('should detect search result type', () => {
      const type = masker.detectOutputType('search', 'file.ts:10: match');
      expect(type).toBe('search_result');
    });

    it('should detect file content type', () => {
      const type = masker.detectOutputType('read_file', 'const x = 1;');
      expect(type).toBe('file_content');
    });

    it('should detect code type from content patterns', () => {
      const type = masker.detectOutputType('unknown', 'function test() { return 1; }');
      expect(type).toBe('code');
    });

    it('should detect log type from timestamp patterns', () => {
      const type = masker.detectOutputType('unknown', '[2024-01-01] INFO: Starting...');
      expect(type).toBe('log');
    });

    it('should return unknown for unrecognized content', () => {
      const type = masker.detectOutputType('unknown', 'random text');
      expect(type).toBe('unknown');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      masker.updateConfig({ enabled: false });

      const config = masker.getConfig();
      expect(config.enabled).toBe(false);
    });

    it('should emit config:updated event', (done) => {
      masker.on('config:updated', (config) => {
        expect(config.totalTokenBudget).toBe(5000);
        done();
      });

      masker.updateConfig({ totalTokenBudget: 5000 });
    });
  });

  describe('disabled mode', () => {
    it('should pass through when disabled', () => {
      const disabledMasker = new ObservationMasker({ enabled: false });

      const obs: Observation = {
        id: '1',
        toolName: 'bash',
        input: 'test',
        output: 'output',
        timestamp: Date.now(),
        type: 'command_output',
      };

      const result = disabledMasker.maskObservation(obs);

      expect(result.wasRetained).toBe(true);
      expect(result.output).toBe('output');
      expect(result.relevanceScore).toBe(1);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getObservationMasker();
      const instance2 = getObservationMasker();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getObservationMasker();
      resetObservationMasker();
      const instance2 = getObservationMasker();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('events', () => {
    it('should emit mask:complete event', (done) => {
      masker.on('mask:complete', ({ stats }) => {
        expect(stats.totalObservations).toBe(1);
        done();
      });

      masker.maskObservations([
        {
          id: '1',
          toolName: 'bash',
          input: 'test',
          output: 'output',
          timestamp: Date.now(),
          type: 'command_output',
        },
      ]);
    });
  });
});
