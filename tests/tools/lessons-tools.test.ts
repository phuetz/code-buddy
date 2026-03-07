/**
 * Tests for Lessons Tool Adapters
 *
 * Uses real fs in a unique tmpDir per test (via process.cwd() spy) to
 * exercise the full ITool → LessonsTracker → disk path without mocking
 * the tracker itself.
 *
 * os.homedir() is also spied on to isolate from any real global lessons.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  LessonsAddTool,
  LessonsSearchTool,
  LessonsListTool,
  TaskVerifyTool,
  createLessonsTools,
} from '../../src/tools/registry/lessons-tools.js';

// Mock os.homedir so global ~/.codebuddy/lessons.md never contaminates tests.
let _fakeHome = '/tmp/lessons-tools-test-home-placeholder';
jest.mock('os', () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: jest.fn(() => _fakeHome) };
});

describe('Lessons Tool Adapters', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Each test gets a unique dir so the singleton tracker is different
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-tools-test-'));
    _fakeHome = path.join(tmpDir, 'fake-home');
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await fs.remove(tmpDir);
  });

  // ==========================================================================
  // LessonsAddTool
  // ==========================================================================

  describe('LessonsAddTool', () => {
    let tool: LessonsAddTool;

    beforeEach(() => {
      tool = new LessonsAddTool();
    });

    it('should have schema name "lessons_add"', () => {
      expect(tool.getSchema().name).toBe('lessons_add');
    });

    it('should list "content" as required in the schema', () => {
      const schema = tool.getSchema();
      expect(schema.parameters.required).toContain('content');
    });

    it('should execute successfully with content provided', async () => {
      const result = await tool.execute({ content: 'use tsc before committing' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('use tsc before committing');
    });

    it('should include the lesson id in the output', async () => {
      const result = await tool.execute({ content: 'always check types' });
      expect(result.success).toBe(true);
      // Output format: "Lesson saved [<id>] (INSIGHT): always check types"
      expect(result.output).toMatch(/\[.+\]/);
    });

    it('should return failure when content is missing', async () => {
      const result = await tool.execute({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('content is required');
    });

    it('should return failure for an invalid category', async () => {
      const result = await tool.execute({ content: 'x', category: 'BAD' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it.each(['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'])(
      'should succeed with valid category %s',
      async (cat) => {
        const result = await tool.execute({ content: 'some lesson', category: cat });
        expect(result.success).toBe(true);
      }
    );

    describe('validate()', () => {
      it('should return valid: false when content is missing', () => {
        expect(tool.validate({}).valid).toBe(false);
      });

      it('should return valid: true when content is provided', () => {
        expect(tool.validate({ content: 'some content' }).valid).toBe(true);
      });

      it('should return valid: false for an invalid category', () => {
        expect(tool.validate({ content: 'x', category: 'UNKNOWN' }).valid).toBe(false);
      });
    });
  });

  // ==========================================================================
  // LessonsSearchTool
  // ==========================================================================

  describe('LessonsSearchTool', () => {
    let addTool: LessonsAddTool;
    let searchTool: LessonsSearchTool;

    beforeEach(() => {
      addTool = new LessonsAddTool();
      searchTool = new LessonsSearchTool();
    });

    it('should have schema name "lessons_search"', () => {
      expect(searchTool.getSchema().name).toBe('lessons_search');
    });

    it('should return failure when query is missing', async () => {
      const result = await searchTool.execute({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('query is required');
    });

    it('should return success with "No lessons found" for an unknown query', async () => {
      const result = await searchTool.execute({ query: 'nonexistent_xyz_query_12345' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('No lessons found');
    });

    it('should find a lesson that was previously added', async () => {
      await addTool.execute({ content: 'use tsc to validate TypeScript', category: 'PATTERN' });
      const result = await searchTool.execute({ query: 'tsc' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('tsc');
    });

    it('should report the count of found lessons', async () => {
      await addTool.execute({ content: 'run eslint before pushing', category: 'RULE' });
      const result = await searchTool.execute({ query: 'eslint' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('Found 1');
    });

    describe('validate()', () => {
      it('should return valid: false when query is missing', () => {
        expect(searchTool.validate({}).valid).toBe(false);
      });

      it('should return valid: true when query is provided', () => {
        expect(searchTool.validate({ query: 'test' }).valid).toBe(true);
      });
    });
  });

  // ==========================================================================
  // LessonsListTool
  // ==========================================================================

  describe('LessonsListTool', () => {
    let addTool: LessonsAddTool;
    let listTool: LessonsListTool;

    beforeEach(() => {
      addTool = new LessonsAddTool();
      listTool = new LessonsListTool();
    });

    it('should have schema name "lessons_list"', () => {
      expect(listTool.getSchema().name).toBe('lessons_list');
    });

    it('should return "No lessons recorded" when tracker is empty', async () => {
      const result = await listTool.execute({});
      expect(result.success).toBe(true);
      expect(result.output).toContain('No lessons recorded');
    });

    it('should list lessons after adding some', async () => {
      await addTool.execute({ content: 'always write tests', category: 'RULE' });
      const result = await listTool.execute({});
      expect(result.success).toBe(true);
      expect(result.output).toContain('always write tests');
    });

    it('should filter by category when category is provided', async () => {
      await addTool.execute({ content: 'rule lesson', category: 'RULE' });
      await addTool.execute({ content: 'pattern lesson', category: 'PATTERN' });
      const result = await listTool.execute({ category: 'RULE' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('rule lesson');
      expect(result.output).not.toContain('pattern lesson');
    });

    describe('validate()', () => {
      it('should always return valid: true (no required fields)', () => {
        expect(listTool.validate({}).valid).toBe(true);
        expect(listTool.validate({ category: 'RULE' }).valid).toBe(true);
      });
    });
  });

  // ==========================================================================
  // TaskVerifyTool
  // ==========================================================================

  describe('TaskVerifyTool', () => {
    let tool: TaskVerifyTool;

    beforeEach(() => {
      tool = new TaskVerifyTool();
    });

    it('should have schema name "task_verify"', () => {
      expect(tool.getSchema().name).toBe('task_verify');
    });

    it('should always return valid: true from validate() — no required params', () => {
      expect(tool.validate({}).valid).toBe(true);
      expect(tool.validate({ checks: ['typescript'] }).valid).toBe(true);
    });

    it('should return failure for an invalid check name', async () => {
      const result = await tool.execute({ checks: ['INVALID'], workDir: tmpDir });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid checks');
    }, 15_000);

    it('should run typescript check in workDir and return output with ✅ or ❌', async () => {
      const result = await tool.execute({ checks: ['typescript'], workDir: tmpDir });
      // tsc will fail in an empty tmpDir (no tsconfig) — that's fine, we just check format
      const output = result.output ?? result.error ?? '';
      const hasIcon = output.includes('✅') || output.includes('❌');
      expect(hasIcon).toBe(true);
    }, 60_000);
  });

  // ==========================================================================
  // createLessonsTools factory
  // ==========================================================================

  describe('createLessonsTools()', () => {
    it('should return 4 tools with the correct names', () => {
      const tools = createLessonsTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('lessons_add');
      expect(names).toContain('lessons_search');
      expect(names).toContain('lessons_list');
      expect(names).toContain('task_verify');
    });
  });
});
