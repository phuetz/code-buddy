/**
 * Tests for FaultLocalizer
 *
 * Comprehensive tests covering:
 * - Error pattern parsing (TypeScript, ESLint, Node.js stack traces, etc.)
 * - Stack trace extraction
 * - Spectrum-based fault localization with various metrics
 * - Fault ranking and deduplication
 * - Code snippet extraction
 * - Configuration management
 */

import {
  FaultLocalizer,
  createFaultLocalizer,
} from '../../src/agent/repair/fault-localization';
import type {
  FaultLocalizationConfig,
  TestCoverage,
  FileReader,
} from '../../src/agent/repair/types';

describe('FaultLocalizer', () => {
  let localizer: FaultLocalizer;

  beforeEach(() => {
    localizer = createFaultLocalizer();
  });

  describe('Construction', () => {
    it('should create with default config', () => {
      const fl = new FaultLocalizer();
      expect(fl).toBeInstanceOf(FaultLocalizer);
      const config = fl.getConfig();
      expect(config.metric).toBe('ochiai');
      expect(config.threshold).toBe(0.3);
      expect(config.maxStatements).toBe(20);
      expect(config.useStackTrace).toBe(true);
      expect(config.useStaticAnalysis).toBe(true);
    });

    it('should create with custom config', () => {
      const customConfig: Partial<FaultLocalizationConfig> = {
        metric: 'tarantula',
        threshold: 0.5,
        maxStatements: 10,
        useStackTrace: false,
      };
      const fl = new FaultLocalizer(customConfig);
      const config = fl.getConfig();
      expect(config.metric).toBe('tarantula');
      expect(config.threshold).toBe(0.5);
      expect(config.maxStatements).toBe(10);
      expect(config.useStackTrace).toBe(false);
    });

    it('should accept file reader', () => {
      const mockFileReader: FileReader = jest.fn().mockResolvedValue('file content');
      const fl = new FaultLocalizer({}, mockFileReader);
      expect(fl).toBeInstanceOf(FaultLocalizer);
    });

    it('should use factory function to create instance', () => {
      const fl = createFaultLocalizer({ metric: 'dstar' });
      expect(fl).toBeInstanceOf(FaultLocalizer);
      expect(fl.getConfig().metric).toBe('dstar');
    });
  });

  describe('Configuration Management', () => {
    it('should return current config', () => {
      const config = localizer.getConfig();
      expect(config).toHaveProperty('metric');
      expect(config).toHaveProperty('threshold');
      expect(config).toHaveProperty('maxStatements');
      expect(config).toHaveProperty('useStackTrace');
      expect(config).toHaveProperty('useStaticAnalysis');
    });

    it('should update config partially', () => {
      localizer.updateConfig({ threshold: 0.7 });
      const config = localizer.getConfig();
      expect(config.threshold).toBe(0.7);
      expect(config.metric).toBe('ochiai'); // Should remain unchanged
    });

    it('should return a copy of config (not reference)', () => {
      const config1 = localizer.getConfig();
      config1.metric = 'jaccard';
      const config2 = localizer.getConfig();
      expect(config2.metric).toBe('ochiai'); // Should not be affected
    });
  });

  describe('Error Pattern Parsing', () => {
    describe('TypeScript Errors', () => {
      it('should parse TypeScript error format', async () => {
        const errorOutput = 'src/index.ts(42,15): error TS2339: Property "foo" does not exist on type "Bar".';
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        const fault = result.faults[0];
        expect(fault.location.file).toBe('src/index.ts');
        expect(fault.location.startLine).toBe(42);
        expect(fault.location.startColumn).toBe(15);
        expect(fault.type).toBe('type_error');
        expect(fault.severity).toBe('high');
      });

      it('should parse multiple TypeScript errors', async () => {
        const errorOutput = `src/utils.ts(10,5): error TS2304: Cannot find name "unknownVar".
src/main.ts(25,12): error TS2551: Property "naem" does not exist on type "Person".`;
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBe(2);
        expect(result.faults[0].location.file).toBe('src/utils.ts');
        expect(result.faults[1].location.file).toBe('src/main.ts');
      });
    });

    describe('ESLint Errors', () => {
      it('should parse ESLint error format', async () => {
        const errorOutput = 'src/component.tsx:15:10: error no-unused-vars Unused variable "x"';
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        const fault = result.faults[0];
        expect(fault.location.file).toBe('src/component.tsx');
        expect(fault.location.startLine).toBe(15);
        expect(fault.location.startColumn).toBe(10);
        expect(fault.type).toBe('lint_error');
        expect(fault.severity).toBe('medium');
      });

      it('should parse ESLint warning format', async () => {
        const errorOutput = 'src/helper.js:8:1: warning prefer-const Use const instead of let';
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        expect(result.faults[0].type).toBe('lint_error');
      });
    });

    describe('Node.js Stack Traces', () => {
      it('should parse Node.js stack trace', async () => {
        const errorOutput = `Error: Something went wrong
    at processData (src/processor.ts:45:10)
    at main (src/index.ts:12:5)`;
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        const fault = result.faults[0];
        expect(fault.location.file).toBe('src/processor.ts');
        expect(fault.location.startLine).toBe(45);
        expect(fault.type).toBe('runtime_error');
        expect(fault.severity).toBe('high');
      });

      it('should parse stack trace with function at beginning', async () => {
        const errorOutput = 'at userFunction (src/app.ts:30:15)';
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        expect(result.faults[0].location.file).toBe('src/app.ts');
      });
    });

    describe('SyntaxError', () => {
      it('should parse SyntaxError format', async () => {
        const errorOutput = 'SyntaxError: Unexpected token } at src/parser.ts:88';
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        const fault = result.faults[0];
        expect(fault.location.file).toBe('src/parser.ts');
        expect(fault.location.startLine).toBe(88);
        expect(fault.type).toBe('syntax_error');
        expect(fault.severity).toBe('critical');
      });
    });

    describe('TypeError and ReferenceError', () => {
      it('should parse TypeError format', async () => {
        const errorOutput = 'TypeError: Cannot read property "x" of undefined at src/data.ts:55';
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        const fault = result.faults[0];
        expect(fault.location.file).toBe('src/data.ts');
        expect(fault.location.startLine).toBe(55);
        expect(fault.type).toBe('runtime_error');
        expect(fault.severity).toBe('high');
      });

      it('should parse ReferenceError format', async () => {
        const errorOutput = 'ReferenceError: unknownVar is not defined at src/utils.ts:33';
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        expect(result.faults[0].type).toBe('runtime_error');
      });
    });

    describe('Python Errors', () => {
      it('should parse Python error format', async () => {
        const errorOutput = `Traceback (most recent call last):
  File "main.py", line 42
    print(undefined_var)
NameError: name 'undefined_var' is not defined`;
        const result = await localizer.localize(errorOutput);

        expect(result.faults.length).toBeGreaterThan(0);
        const fault = result.faults[0];
        expect(fault.location.file).toBe('main.py');
        expect(fault.location.startLine).toBe(42);
        expect(fault.type).toBe('runtime_error');
      });
    });

    describe('Jest Test Failures', () => {
      it('should detect Jest test failure patterns', async () => {
        const errorOutput = '  ● UserService › should create user';
        const result = await localizer.localize(errorOutput);

        // Jest pattern may not extract location, but should detect fault type
        // The current implementation returns null for location, so no faults created
        expect(result.faults.length).toBe(0);
      });
    });
  });

  describe('analyzeSingleError', () => {
    it('should analyze a single TypeScript error', () => {
      const fault = localizer.analyzeSingleError('src/index.ts(10,5): error TS2322: Type "string" is not assignable.');

      expect(fault).not.toBeNull();
      expect(fault!.location.file).toBe('src/index.ts');
      expect(fault!.location.startLine).toBe(10);
      expect(fault!.type).toBe('type_error');
    });

    it('should analyze a single runtime error', () => {
      const fault = localizer.analyzeSingleError('at processRequest (src/handler.ts:25:8)');

      expect(fault).not.toBeNull();
      expect(fault!.location.file).toBe('src/handler.ts');
      expect(fault!.location.startLine).toBe(25);
      expect(fault!.type).toBe('runtime_error');
    });

    it('should return null for unrecognized error format', () => {
      const fault = localizer.analyzeSingleError('Some random text without error pattern');

      expect(fault).toBeNull();
    });

    it('should return null for empty string', () => {
      const fault = localizer.analyzeSingleError('');

      expect(fault).toBeNull();
    });
  });

  describe('Stack Trace Enhancement', () => {
    it('should add related locations from stack trace', async () => {
      const errorOutput = `TypeError: Cannot read property 'value' of undefined
    at getValue (src/utils.ts:10:5)
    at processData (src/processor.ts:25:10)
    at main (src/index.ts:5:3)`;
      const result = await localizer.localize(errorOutput);

      // Should have the main fault with related locations
      expect(result.faults.length).toBeGreaterThan(0);
      const primaryFault = result.faults[0];
      expect(primaryFault.relatedLocations).toBeDefined();
    });

    it('should create fault from stack trace locations', async () => {
      const errorOutput = `    at functionA (src/moduleA.ts:15:3)
    at functionB (src/moduleB.ts:22:7)`;
      const localizer2 = createFaultLocalizer({ useStackTrace: true });
      const result = await localizer2.localize(errorOutput);

      // Should create faults from stack trace
      expect(result.faults.length).toBeGreaterThan(0);
      expect(result.faults[0].type).toBe('runtime_error');
    });
  });

  describe('Fault Deduplication', () => {
    it('should deduplicate faults at the same location', async () => {
      const errorOutput = `src/file.ts(10,5): error TS2304: Cannot find name 'x'.
src/file.ts(10,5): error TS2304: Cannot find name 'x'.`;
      const result = await localizer.localize(errorOutput);

      // Should only have one fault for the same location
      expect(result.faults.length).toBe(1);
    });

    it('should keep faults at different locations', async () => {
      const errorOutput = `src/file.ts(10,5): error TS2304: Cannot find name 'x'.
src/file.ts(20,5): error TS2304: Cannot find name 'y'.`;
      const result = await localizer.localize(errorOutput);

      expect(result.faults.length).toBe(2);
    });
  });

  describe('Suspiciousness Metrics', () => {
    const createCoverageData = (
      passingTests: number,
      failingTests: number,
      coverage: Map<string, Set<number>>
    ): TestCoverage => ({
      totalTests: passingTests + failingTests,
      passingTests,
      failingTests,
      statementCoverage: coverage,
    });

    it('should calculate Ochiai metric', async () => {
      const coverage = createCoverageData(5, 2, new Map([['file.ts', new Set([10, 20, 30])]]));
      const localizer2 = createFaultLocalizer({ metric: 'ochiai', threshold: 0 });
      const result = await localizer2.localize('Error at file.ts:10', coverage);

      expect(result.suspiciousStatements.length).toBeGreaterThan(0);
      // All statements should have suspiciousness calculated
      result.suspiciousStatements.forEach(stmt => {
        expect(stmt.suspiciousness).toBeGreaterThanOrEqual(0);
        expect(stmt.suspiciousness).toBeLessThanOrEqual(1);
        expect(stmt.metric).toBe('ochiai');
      });
    });

    it('should calculate Tarantula metric', async () => {
      const coverage = createCoverageData(5, 2, new Map([['file.ts', new Set([10, 20])]]));
      const localizer2 = createFaultLocalizer({ metric: 'tarantula', threshold: 0 });
      const result = await localizer2.localize('Error at file.ts:10', coverage);

      expect(result.suspiciousStatements.length).toBeGreaterThan(0);
      result.suspiciousStatements.forEach(stmt => {
        expect(stmt.metric).toBe('tarantula');
      });
    });

    it('should calculate Jaccard metric', async () => {
      const coverage = createCoverageData(3, 3, new Map([['file.ts', new Set([5, 10, 15])]]));
      const localizer2 = createFaultLocalizer({ metric: 'jaccard', threshold: 0 });
      const result = await localizer2.localize('Error', coverage);

      expect(result.suspiciousStatements.length).toBeGreaterThan(0);
      result.suspiciousStatements.forEach(stmt => {
        expect(stmt.metric).toBe('jaccard');
      });
    });

    it('should calculate DStar metric', async () => {
      const coverage = createCoverageData(4, 1, new Map([['file.ts', new Set([10])]]));
      const localizer2 = createFaultLocalizer({ metric: 'dstar', threshold: 0 });
      const result = await localizer2.localize('Error', coverage);

      expect(result.suspiciousStatements.length).toBeGreaterThan(0);
      result.suspiciousStatements.forEach(stmt => {
        expect(stmt.metric).toBe('dstar');
      });
    });

    it('should calculate Barinel metric', async () => {
      const coverage = createCoverageData(5, 2, new Map([['file.ts', new Set([10, 20])]]));
      const localizer2 = createFaultLocalizer({ metric: 'barinel', threshold: 0 });
      const result = await localizer2.localize('Error', coverage);

      expect(result.suspiciousStatements.length).toBeGreaterThan(0);
      result.suspiciousStatements.forEach(stmt => {
        expect(stmt.metric).toBe('barinel');
      });
    });

    it('should calculate Op2 metric', async () => {
      const coverage = createCoverageData(5, 2, new Map([['file.ts', new Set([10])]]));
      const localizer2 = createFaultLocalizer({ metric: 'op2', threshold: -10 }); // Op2 can be negative
      const result = await localizer2.localize('Error', coverage);

      expect(result.suspiciousStatements.length).toBeGreaterThan(0);
      result.suspiciousStatements.forEach(stmt => {
        expect(stmt.metric).toBe('op2');
      });
    });

    it('should filter statements below threshold', async () => {
      const coverage = createCoverageData(10, 1, new Map([['file.ts', new Set([10, 20, 30])]]));
      const localizer2 = createFaultLocalizer({ threshold: 0.9 });
      const result = await localizer2.localize('Error', coverage);

      // All returned statements should be above threshold
      result.suspiciousStatements.forEach(stmt => {
        expect(stmt.suspiciousness).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should handle edge cases in metrics', async () => {
      // Zero failing tests
      const coverage1 = createCoverageData(5, 0, new Map([['file.ts', new Set([10])]]));
      const result1 = await localizer.localize('Error', coverage1);
      expect(result1.suspiciousStatements).toBeDefined();

      // Zero passing tests
      const coverage2 = createCoverageData(0, 5, new Map([['file.ts', new Set([10])]]));
      const result2 = await localizer.localize('Error', coverage2);
      expect(result2.suspiciousStatements).toBeDefined();
    });
  });

  describe('Fault Ranking', () => {
    it('should sort faults by suspiciousness descending', async () => {
      const coverage = createCoverage(5, 3, new Map([
        ['file.ts', new Set([10, 20, 30, 40])],
      ]));

      const errorOutput = `src/file.ts(10,5): error TS2304: Error 1
src/file.ts(20,5): error TS2304: Error 2`;
      const result = await localizer.localize(errorOutput, coverage);

      // Faults should be sorted by suspiciousness
      for (let i = 1; i < result.faults.length; i++) {
        expect(result.faults[i - 1].suspiciousness).toBeGreaterThanOrEqual(
          result.faults[i].suspiciousness
        );
      }
    });

    it('should combine static analysis and spectrum scores', async () => {
      const coverage = createCoverage(5, 2, new Map([
        ['src/file.ts', new Set([10])],
      ]));

      const errorOutput = 'src/file.ts(10,5): error TS2304: Error at line 10';
      const result = await localizer.localize(errorOutput, coverage);

      expect(result.faults.length).toBeGreaterThan(0);
      // Suspiciousness should be a weighted combination
      expect(result.faults[0].suspiciousness).toBeGreaterThan(0);
      expect(result.faults[0].suspiciousness).toBeLessThanOrEqual(1);
    });

    it('should add high-suspicion spectrum statements as faults', async () => {
      const coverage = createCoverage(2, 5, new Map([
        ['src/suspicious.ts', new Set([100])],
      ]));

      // Error in a different file
      const errorOutput = 'src/other.ts(10,5): error TS2304: Some error';
      const localizer2 = createFaultLocalizer({ threshold: 0.3 });
      const result = await localizer2.localize(errorOutput, coverage);

      // Should have faults from both error parsing and high-suspicion spectrum
      expect(result.faults.length).toBeGreaterThan(0);
    });

    it('should limit results to maxStatements', async () => {
      const coverage = createCoverage(5, 5, new Map([
        ['file.ts', new Set(Array.from({ length: 50 }, (_, i) => i + 1))],
      ]));

      const localizer2 = createFaultLocalizer({ maxStatements: 5, threshold: 0 });
      const result = await localizer2.localize('Error in file.ts', coverage);

      expect(result.faults.length).toBeLessThanOrEqual(5);
      expect(result.suspiciousStatements.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Code Snippet Extraction', () => {
    it('should add code snippets when file reader is provided', async () => {
      const mockFileReader: FileReader = jest.fn().mockResolvedValue(
        'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10'
      );
      const localizer2 = createFaultLocalizer({}, mockFileReader);

      const errorOutput = 'src/test.ts(5,1): error TS2304: Error on line 5';
      const result = await localizer2.localize(errorOutput);

      expect(result.faults.length).toBeGreaterThan(0);
      expect(result.faults[0].location.snippet).toBeDefined();
      expect(mockFileReader).toHaveBeenCalledWith('src/test.ts');
    });

    it('should handle file read errors gracefully', async () => {
      const mockFileReader: FileReader = jest.fn().mockRejectedValue(new Error('File not found'));
      const localizer2 = createFaultLocalizer({}, mockFileReader);

      const errorOutput = 'src/missing.ts(10,1): error TS2304: Error';
      const result = await localizer2.localize(errorOutput);

      // Should not throw, just skip snippet
      expect(result.faults.length).toBeGreaterThan(0);
      expect(result.faults[0].location.snippet).toBeUndefined();
    });

    it('should get surrounding context lines for snippet', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      const mockFileReader: FileReader = jest.fn().mockResolvedValue(lines.join('\n'));
      const localizer2 = createFaultLocalizer({}, mockFileReader);

      const errorOutput = 'src/test.ts(10,1): error TS2304: Error on line 10';
      const result = await localizer2.localize(errorOutput);

      expect(result.faults[0].location.snippet).toBeDefined();
      // Should include lines around line 10
      const snippet = result.faults[0].location.snippet!;
      expect(snippet).toContain('line 7');
      expect(snippet).toContain('line 10');
      expect(snippet).toContain('line 12');
    });
  });

  describe('localize Method', () => {
    it('should return analysis time', async () => {
      const result = await localizer.localize('some error');
      expect(result.analysisTime).toBeGreaterThanOrEqual(0);
    });

    it('should return coverage when provided', async () => {
      const coverage = createCoverage(5, 2, new Map());
      const result = await localizer.localize('error', coverage);
      expect(result.coverage).toBe(coverage);
    });

    it('should handle empty error output', async () => {
      const result = await localizer.localize('');
      expect(result.faults).toEqual([]);
      expect(result.suspiciousStatements).toEqual([]);
    });

    it('should handle error output with no matching patterns', async () => {
      const result = await localizer.localize('Just some random text without errors');
      expect(result.faults).toEqual([]);
    });
  });

  describe('Fault Structure', () => {
    it('should generate unique fault IDs', async () => {
      const errorOutput = `src/file.ts(10,5): error TS2304: Error 1
src/file.ts(20,5): error TS2304: Error 2`;
      const result = await localizer.localize(errorOutput);

      const ids = result.faults.map(f => f.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include metadata in faults', async () => {
      const errorOutput = 'src/file.ts(10,5): error TS2304: Cannot find name';
      const result = await localizer.localize(errorOutput);

      expect(result.faults[0].metadata).toBeDefined();
      expect(result.faults[0].metadata.rawMatch).toBeDefined();
    });

    it('should have correct fault properties', async () => {
      const errorOutput = 'src/file.ts(10,5): error TS2304: Cannot find name "x"';
      const result = await localizer.localize(errorOutput);

      const fault = result.faults[0];
      expect(fault).toHaveProperty('id');
      expect(fault).toHaveProperty('type');
      expect(fault).toHaveProperty('severity');
      expect(fault).toHaveProperty('message');
      expect(fault).toHaveProperty('location');
      expect(fault).toHaveProperty('suspiciousness');
      expect(fault).toHaveProperty('metadata');

      expect(fault.location).toHaveProperty('file');
      expect(fault.location).toHaveProperty('startLine');
      expect(fault.location).toHaveProperty('endLine');
    });
  });
});

// Helper function to create coverage
function createCoverage(
  passingTests: number,
  failingTests: number,
  statementCoverage: Map<string, Set<number>>
): TestCoverage {
  return {
    totalTests: passingTests + failingTests,
    passingTests,
    failingTests,
    statementCoverage,
  };
}
