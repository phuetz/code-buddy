/**
 * Tests for Pipeline CLI Command
 *
 * Tests covering:
 * - Pipeline file loading (JSON and YAML)
 * - Pipeline validation
 * - createPipelineCommand structure
 * - Error handling for invalid inputs
 */

import {
  loadPipelineFile,
  validatePipelineDefinition,
  createPipelineCommand,
} from '../../src/commands/pipeline';
import type { PipelineFileDefinition } from '../../src/commands/pipeline';
import fs from 'fs';

// Mock fs module
jest.mock('fs', () => {
  const impl = {
  default: {
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
  },
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
};
  return { ...impl, default: impl };
});

// Mock path module
jest.mock('path', () => {
  const impl = {
  default: {
    resolve: jest.fn((p: string) => p),
    extname: jest.fn((p: string) => {
      const idx = p.lastIndexOf('.');
      return idx >= 0 ? p.slice(idx) : '';
    }),
    join: jest.fn((...args: string[]) => args.join('/')),
  },
  resolve: jest.fn((p: string) => p),
  extname: jest.fn((p: string) => {
    const idx = p.lastIndexOf('.');
    return idx >= 0 ? p.slice(idx) : '';
  }),
  join: jest.fn((...args: string[]) => args.join('/')),
};
  return { ...impl, default: impl };
});

// Mock js-yaml for YAML parsing
jest.mock('js-yaml', () => ({
  default: {
    load: jest.fn((content: string) => JSON.parse(content)),
  },
  load: jest.fn((content: string) => JSON.parse(content)),
}));

// const fs = require('fs'); -- replaced by import

describe('Pipeline CLI Command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // validatePipelineDefinition
  // ========================================================================

  describe('validatePipelineDefinition', () => {
    it('should validate a correct pipeline definition', () => {
      const definition: PipelineFileDefinition = {
        name: 'test-pipeline',
        description: 'A test pipeline',
        steps: [
          { name: 'step1', type: 'tool' },
          { name: 'step2', type: 'transform' },
        ],
      };

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stepCount).toBe(2);
      expect(result.pipelineName).toBe('test-pipeline');
    });

    it('should reject a pipeline with no name', () => {
      const definition = {
        steps: [{ name: 'step1' }],
      } as unknown as PipelineFileDefinition;

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pipeline must have a "name" field (string)');
    });

    it('should reject a pipeline with no steps', () => {
      const definition: PipelineFileDefinition = {
        name: 'empty-pipeline',
        steps: [],
      };

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pipeline must have at least one step');
    });

    it('should reject a pipeline with missing steps array', () => {
      const definition = {
        name: 'no-steps',
      } as unknown as PipelineFileDefinition;

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pipeline must have a "steps" field (array)');
    });

    it('should reject steps with invalid type', () => {
      const definition: PipelineFileDefinition = {
        name: 'bad-type',
        steps: [
          { name: 'step1', type: 'invalid' as 'tool' },
        ],
      };

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid type'))).toBe(true);
    });

    it('should warn about duplicate step names', () => {
      const definition: PipelineFileDefinition = {
        name: 'dup-steps',
        steps: [
          { name: 'step1', type: 'tool' },
          { name: 'step1', type: 'transform' },
        ],
      };

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('duplicate step name'))).toBe(true);
    });

    it('should warn about missing description', () => {
      const definition: PipelineFileDefinition = {
        name: 'no-desc',
        steps: [{ name: 'step1' }],
      };

      const result = validatePipelineDefinition(definition);
      expect(result.warnings.some(w => w.includes('no description'))).toBe(true);
    });

    it('should reject pipeline exceeding max steps', () => {
      const steps = Array.from({ length: 25 }, (_, i) => ({
        name: `step-${i}`,
        type: 'tool' as const,
      }));

      const definition: PipelineFileDefinition = {
        name: 'too-many-steps',
        steps,
      };

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum'))).toBe(true);
    });

    it('should handle null/undefined definition gracefully', () => {
      const result = validatePipelineDefinition(null as unknown as PipelineFileDefinition);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pipeline definition is empty or null');
    });

    it('should warn about invalid timeout values', () => {
      const definition: PipelineFileDefinition = {
        name: 'bad-timeout',
        steps: [{ name: 'step1', timeout: -100 }],
      };

      const result = validatePipelineDefinition(definition);
      expect(result.warnings.some(w => w.includes('timeout'))).toBe(true);
    });

    it('should accept steps with no explicit type', () => {
      const definition: PipelineFileDefinition = {
        name: 'no-type',
        description: 'Steps without types',
        steps: [
          { name: 'step1' },
          { name: 'step2' },
        ],
      };

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(true);
    });

    it('should respect custom maxSteps from config', () => {
      const definition: PipelineFileDefinition = {
        name: 'custom-max',
        steps: [
          { name: 'step1' },
          { name: 'step2' },
          { name: 'step3' },
        ],
        config: { maxSteps: 2 },
      };

      const result = validatePipelineDefinition(definition);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum of 2'))).toBe(true);
    });
  });

  // ========================================================================
  // loadPipelineFile
  // ========================================================================

  describe('loadPipelineFile', () => {
    it('should load a valid JSON pipeline file', async () => {
      const pipelineData: PipelineFileDefinition = {
        name: 'json-pipeline',
        description: 'A JSON pipeline',
        steps: [
          { name: 'search', type: 'tool', args: { query: 'test' } },
          { name: 'uppercase', type: 'transform' },
        ],
      };

      fs.default.existsSync.mockReturnValue(true);
      fs.default.readFileSync.mockReturnValue(JSON.stringify(pipelineData));

      const result = await loadPipelineFile('test.json');
      expect(result.name).toBe('json-pipeline');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].name).toBe('search');
    });

    it('should load a valid YAML pipeline file', async () => {
      const pipelineData: PipelineFileDefinition = {
        name: 'yaml-pipeline',
        steps: [{ name: 'trim', type: 'transform' }],
      };

      fs.default.existsSync.mockReturnValue(true);
      fs.default.readFileSync.mockReturnValue(JSON.stringify(pipelineData));

      const result = await loadPipelineFile('test.yaml');
      expect(result.name).toBe('yaml-pipeline');
      expect(result.steps).toHaveLength(1);
    });

    it('should throw for non-existent file', async () => {
      fs.default.existsSync.mockReturnValue(false);

      await expect(loadPipelineFile('missing.json')).rejects.toThrow('Pipeline file not found');
    });

    it('should throw for unsupported file extension', async () => {
      fs.default.existsSync.mockReturnValue(true);
      fs.default.readFileSync.mockReturnValue('content');

      await expect(loadPipelineFile('test.txt')).rejects.toThrow('Unsupported pipeline file format');
    });

    it('should throw for invalid JSON content', async () => {
      fs.default.existsSync.mockReturnValue(true);
      fs.default.readFileSync.mockReturnValue('not valid json {{{');

      await expect(loadPipelineFile('bad.json')).rejects.toThrow('Invalid JSON');
    });

    it('should load .yml files the same as .yaml', async () => {
      const pipelineData: PipelineFileDefinition = {
        name: 'yml-pipeline',
        steps: [{ name: 'count' }],
      };

      fs.default.existsSync.mockReturnValue(true);
      fs.default.readFileSync.mockReturnValue(JSON.stringify(pipelineData));

      const result = await loadPipelineFile('test.yml');
      expect(result.name).toBe('yml-pipeline');
    });
  });

  // ========================================================================
  // createPipelineCommand
  // ========================================================================

  describe('createPipelineCommand', () => {
    it('should create a Commander command with expected subcommands', () => {
      const cmd = createPipelineCommand();
      expect(cmd.name()).toBe('pipeline');

      // Check that subcommands are registered
      const subcommandNames = cmd.commands.map((c: { name: () => string }) => c.name());
      expect(subcommandNames).toContain('run');
      expect(subcommandNames).toContain('list');
      expect(subcommandNames).toContain('validate');
      expect(subcommandNames).toContain('status');
    });

    it('should have description set', () => {
      const cmd = createPipelineCommand();
      expect(cmd.description()).toBe('Manage and run pipeline workflows');
    });

    it('should have an alias for list command', () => {
      const cmd = createPipelineCommand();
      const listCmd = cmd.commands.find((c: { name: () => string }) => c.name() === 'list');
      expect(listCmd).toBeDefined();
      expect(listCmd?.aliases()).toContain('ls');
    });

    it('should have run command with options', () => {
      const cmd = createPipelineCommand();
      const runCmd = cmd.commands.find((c: { name: () => string }) => c.name() === 'run');
      expect(runCmd).toBeDefined();

      // Check that run has the expected options
      const optionNames = runCmd?.options?.map((o: { long?: string }) => o.long) || [];
      expect(optionNames).toContain('--timeout');
      expect(optionNames).toContain('--dry-run');
    });
  });
});
