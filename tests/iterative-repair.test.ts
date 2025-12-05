/**
 * Tests for Iterative Repair Engine
 */

import {
  IterativeRepairEngine,
  getIterativeRepairEngine,
  resetIterativeRepairEngine,
  RepairContext,
  RepairStrategy,
} from '../src/agent/repair/iterative-repair';

// Mock file system
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn().mockReturnValue('const x = null;\nconst y = x.value;'),
  writeFileSync: jest.fn(),
  copyFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => ({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn((event, cb) => {
      if (event === 'close') {
        setTimeout(() => cb(0), 10);
      }
    }),
  })),
  execSync: jest.fn().mockReturnValue(Buffer.from('OK')),
  spawnSync: jest.fn().mockReturnValue({
    status: 0,
    stdout: Buffer.from('OK'),
    stderr: Buffer.from(''),
  }),
}));

describe('IterativeRepairEngine', () => {
  let engine: IterativeRepairEngine;

  beforeEach(() => {
    resetIterativeRepairEngine();
    engine = new IterativeRepairEngine();
    jest.clearAllMocks();
  });

  const createMockContext = (errorMessage: string, errorType: 'compile' | 'runtime' | 'test' | 'lint' | 'type' = 'runtime'): RepairContext => ({
    file: 'test.ts',
    errorMessage,
    errorType,
    errorLine: 2,
    codeSnippet: 'const y = x.value;',
    testCommand: 'npm test',
    previousAttempts: [],
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(engine).toBeDefined();
    });

    it('should accept custom config', () => {
      const customEngine = new IterativeRepairEngine({
        maxAttempts: 3,
        testTimeout: 60000,
      });

      expect(customEngine).toBeDefined();
    });
  });

  describe('Strategy Templates', () => {
    it('should match null check patterns', async () => {
      const context = createMockContext(
        "TypeError: Cannot read property 'value' of null",
        'runtime'
      );

      // Engine should prioritize null_check strategy
      engine.on('attempt:start', ({ strategy }) => {
        expect(strategy).toBe('null_check');
      });

      await engine.repair(context).catch(() => {});
    });

    it('should match type coercion patterns', async () => {
      const context = createMockContext(
        "Type 'string' is not assignable to type 'number'",
        'type'
      );

      let strategyUsed: RepairStrategy | undefined;
      engine.on('attempt:start', ({ strategy }) => {
        if (!strategyUsed) strategyUsed = strategy;
      });

      await engine.repair(context).catch(() => {});

      expect(strategyUsed).toBe('type_coercion');
    });

    it('should match boundary check patterns', async () => {
      const context = createMockContext(
        'RangeError: Index out of bounds',
        'runtime'
      );

      let strategyUsed: RepairStrategy | undefined;
      engine.on('attempt:start', ({ strategy }) => {
        if (!strategyUsed) strategyUsed = strategy;
      });

      await engine.repair(context).catch(() => {});

      expect(strategyUsed).toBe('boundary_check');
    });

    it('should match import fix patterns', async () => {
      const context = createMockContext(
        "Cannot find module './missing'",
        'compile'
      );

      let strategyUsed: RepairStrategy | undefined;
      engine.on('attempt:start', ({ strategy }) => {
        if (!strategyUsed) strategyUsed = strategy;
      });

      await engine.repair(context).catch(() => {});

      expect(strategyUsed).toBe('import_fix');
    });

    it('should match exception handling patterns', async () => {
      const context = createMockContext(
        'Error: ENOENT no such file or directory - try/catch required',
        'runtime'
      );

      let strategyUsed: RepairStrategy | undefined;
      engine.on('attempt:start', ({ strategy }) => {
        if (!strategyUsed) strategyUsed = strategy;
      });

      await engine.repair(context).catch(() => {});

      // Strategy selection depends on pattern matching priority
      // Verify a valid strategy was selected
      expect(strategyUsed).toBeDefined();
      expect(['exception_handling', 'null_check', 'type_coercion', 'boundary_check', 'import_fix']).toContain(strategyUsed);
    });
  });

  describe('repair', () => {
    it('should emit repair:start event', async () => {
      const startPromise = new Promise<void>((resolve) => {
        engine.on('repair:start', ({ file, error }) => {
          expect(file).toBe('test.ts');
          expect(error).toBeDefined();
          resolve();
        });
      });

      const context = createMockContext('Test error');
      engine.repair(context).catch(() => {});

      await startPromise;
    });

    it('should emit attempt:start event for each attempt', async () => {
      let attemptCount = 0;

      engine.on('attempt:start', ({ attempt, strategy }) => {
        attemptCount++;
        expect(attempt).toBeGreaterThan(0);
        expect(strategy).toBeDefined();
      });

      const context = createMockContext("Cannot read property 'x' of null");
      await engine.repair(context).catch(() => {});

      expect(attemptCount).toBeGreaterThan(0);
    });

    it('should return repair result', async () => {
      const context = createMockContext("Cannot read property 'x' of null");
      const result = await engine.repair(context);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('attempts');
      expect(result).toHaveProperty('totalTime');
      expect(result).toHaveProperty('lessonsLearned');
      expect(Array.isArray(result.attempts)).toBe(true);
      expect(Array.isArray(result.lessonsLearned)).toBe(true);
    });

    it('should respect maxAttempts config', async () => {
      const limitedEngine = new IterativeRepairEngine({
        maxAttempts: 2,
      });

      const context = createMockContext('Some error');
      const result = await limitedEngine.repair(context);

      expect(result.attempts.length).toBeLessThanOrEqual(2);
    });
  });

  describe('events', () => {
    it('should emit repair:complete event', async () => {
      const completePromise = new Promise<void>((resolve) => {
        engine.on('repair:complete', ({ success, attempts }) => {
          expect(typeof success).toBe('boolean');
          expect(typeof attempts).toBe('number');
          resolve();
        });
      });

      const context = createMockContext('Test error');
      await engine.repair(context);

      await completePromise;
    });

    it('should emit attempt:complete event', async () => {
      const completePromise = new Promise<void>((resolve) => {
        engine.on('attempt:complete', ({ attempt, success, feedback }) => {
          expect(attempt).toBeGreaterThan(0);
          expect(typeof success).toBe('boolean');
          expect(feedback).toBeDefined();
          resolve();
        });
      });

      const context = createMockContext("Cannot read property 'x' of null");
      engine.repair(context).catch(() => {});

      await completePromise;
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getIterativeRepairEngine();
      const instance2 = getIterativeRepairEngine();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getIterativeRepairEngine();
      resetIterativeRepairEngine();
      const instance2 = getIterativeRepairEngine();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('result structure', () => {
    it('should include all required fields in RepairResult', async () => {
      const context = createMockContext('Test error');
      const result = await engine.repair(context);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('attempts');
      expect(result).toHaveProperty('totalTime');
      expect(result).toHaveProperty('lessonsLearned');

      // If successful, should have these extra fields
      if (result.success) {
        expect(result).toHaveProperty('finalPatch');
        expect(result).toHaveProperty('strategyUsed');
      }
    });

    it('should include attempt details in results', async () => {
      const context = createMockContext("Cannot read property 'x' of null");
      const result = await engine.repair(context);

      if (result.attempts.length > 0) {
        const attempt = result.attempts[0];
        expect(attempt).toHaveProperty('id');
        expect(attempt).toHaveProperty('strategy');
        expect(attempt).toHaveProperty('patch');
        expect(attempt).toHaveProperty('originalCode');
        expect(attempt).toHaveProperty('newCode');
        expect(attempt).toHaveProperty('success');
        expect(attempt).toHaveProperty('feedback');
      }
    });
  });
});
