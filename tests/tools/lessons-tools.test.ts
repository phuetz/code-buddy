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
  LessonsProposeTool,
  LessonsGraphTool,
  LessonsSearchTool,
  LessonsListTool,
  TaskVerifyTool,
  createLessonsTools,
} from '../../src/tools/registry/lessons-tools.js';
import { getLessonCandidateQueue, resetLessonCandidateQueues } from '../../src/agent/lesson-candidate-queue.js';

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
  // LessonsGraphTool
  // ==========================================================================

  describe('LessonsGraphTool', () => {
    let addTool: LessonsAddTool;
    let graphTool: LessonsGraphTool;

    beforeEach(() => {
      addTool = new LessonsAddTool();
      graphTool = new LessonsGraphTool();
    });

    it('should have schema name "lessons_graph"', () => {
      expect(graphTool.getSchema().name).toBe('lessons_graph');
    });

    it('should return a concept graph summary for linked lessons', async () => {
      await addTool.execute({
        category: 'PATTERN',
        content: 'Use [[contact-discovery]] and [sandbox scripts](concepts/sandbox-scripts.md) before broad scraping. tags: lead-scout',
        context: 'Lead Scout',
      });
      await addTool.execute({
        category: 'INSIGHT',
        content: 'Architecture enrichment should reuse contact pages. related: contact-discovery',
        context: 'Lead Scout',
      });

      const result = await graphTool.execute({});

      expect(result.success).toBe(true);
      expect(result.output).toContain('Lesson graph: 2 lesson(s)');
      expect(result.output).toContain('contact-discovery');
      expect(result.output).toContain('sandbox scripts');
      expect(result.output).toContain('Backlinks');
      expect(result.output).toContain('Related Lessons');
    });

    it('should return full graph JSON when requested', async () => {
      await addTool.execute({
        category: 'RULE',
        content: 'Always verify learned patterns. tags: verification',
      });

      const result = await graphTool.execute({ format: 'json' });
      const parsed = JSON.parse(result.output ?? '{}');

      expect(result.success).toBe(true);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.lessons).toHaveLength(1);
      expect(parsed.filters).toEqual({ includeKeywords: true, limit: 50 });
      expect(parsed.concepts.some((concept: { id: string }) => concept.id === 'verification')).toBe(true);
      expect(parsed.backlinks.verification).toEqual([parsed.lessons[0].id]);
    });

    it('should filter graph JSON by concept when requested', async () => {
      await addTool.execute({
        category: 'PATTERN',
        content: 'Use [[contact-discovery]] before broad scraping.',
      });
      await addTool.execute({
        category: 'RULE',
        content: 'Always run typecheck. tags: verification',
      });

      const result = await graphTool.execute({ concept: 'contact-discovery', format: 'json' });
      const parsed = JSON.parse(result.output ?? '{}');

      expect(result.success).toBe(true);
      expect(parsed.lessons).toHaveLength(1);
      expect(parsed.lessons[0].content).toContain('contact-discovery');
      expect(parsed.concepts.some((concept: { id: string }) => concept.id === 'verification')).toBe(false);
    });

    it('should return Mermaid graph text when requested', async () => {
      await addTool.execute({
        category: 'PATTERN',
        content: 'Use [[contact-discovery]] before broad scraping.',
      });

      const result = await graphTool.execute({ format: 'mermaid' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('graph TD');
      expect(result.output).toContain('contact-discovery');
    });

    it('should return an Obsidian-friendly Markdown index when requested', async () => {
      await addTool.execute({
        category: 'PATTERN',
        content: 'Use [[contact-discovery]] before broad scraping.',
      });

      const result = await graphTool.execute({ format: 'markdown' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('# Lessons Graph');
      expect(result.output).toContain('[[contact-discovery|contact-discovery]]');
    });

    it('should omit fallback keyword concepts when includeKeywords is false', async () => {
      await addTool.execute({
        category: 'PATTERN',
        content: 'Use [[contact-discovery]] before broad scraping.',
      });

      const result = await graphTool.execute({ format: 'json', includeKeywords: false });
      const parsed = JSON.parse(result.output ?? '{}');

      expect(result.success).toBe(true);
      expect(parsed.filters.includeKeywords).toBe(false);
      expect(parsed.concepts.some((concept: { id: string }) => concept.id === 'contact-discovery')).toBe(true);
      expect(parsed.concepts.some((concept: { id: string }) => concept.id === 'broad')).toBe(false);
    });

    it('should validate category and format inputs', () => {
      expect(graphTool.validate({ category: 'BAD' }).valid).toBe(false);
      expect(graphTool.validate({ format: 'xml' }).valid).toBe(false);
      expect(graphTool.validate({ category: 'RULE', format: 'markdown' }).valid).toBe(true);
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
    it('should return the lessons tools with the correct names', () => {
      const tools = createLessonsTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('lessons_add');
      expect(names).toContain('lessons_propose');
      expect(names).toContain('lessons_search');
      expect(names).toContain('lessons_list');
      expect(names).toContain('lessons_graph');
      expect(names).toContain('task_verify');
    });
  });

  // ==========================================================================
  // LessonsProposeTool
  // ==========================================================================

  describe('LessonsProposeTool', () => {
    let tool: LessonsProposeTool;

    beforeEach(() => {
      resetLessonCandidateQueues();
      tool = new LessonsProposeTool();
    });

    it('should have schema name "lessons_propose"', () => {
      expect(tool.getSchema().name).toBe('lessons_propose');
    });

    it('proposes a pending candidate without writing lessons.md', async () => {
      const result = await tool.execute({
        category: 'PATTERN',
        content: 'Wire new ITools into the factory so the registry can dispatch them.',
        context: 'tools',
      });

      expect(result.success).toBe(true);
      expect(result.output).toMatch(/awaiting human review/i);
      // No silent mutation: lessons.md must not exist yet.
      expect(await fs.pathExists(path.join(tmpDir, '.codebuddy', 'lessons.md'))).toBe(false);
      // The candidate is queued and pending.
      const pending = getLessonCandidateQueue(tmpDir).list('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].content).toContain('Wire new ITools');
    });

    it('does not create a review candidate for an already recorded lesson', async () => {
      const content = 'Do not re-review lessons that are already recorded.';
      await new LessonsAddTool().execute({
        category: 'RULE',
        content,
        source: 'manual',
      });

      const result = await tool.execute({
        category: 'RULE',
        content,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Lesson already recorded');
      expect(result.output).toContain('No new review candidate was created');
      expect(result.output).not.toContain('Approve with: buddy lessons candidate approve');
      expect(getLessonCandidateQueue(tmpDir).list('pending')).toHaveLength(0);
    });

    it('rejects missing content and invalid category', async () => {
      expect((await tool.execute({ category: 'RULE' })).success).toBe(false);
      const bad = await tool.execute({ category: 'NOPE', content: 'x' });
      expect(bad.success).toBe(false);
      expect(bad.error).toMatch(/category must be one of/i);
    });
  });

  // Regression: the Cowork embedded engine passes the active project's
  // workspacePath as IToolExecutionContext.cwd. The proposal must be queued
  // under that project's .codebuddy/, not the Electron process directory —
  // otherwise the LessonCandidatePanel (which reads the project dir) never
  // sees what the agent proposed and the self-improvement loop never closes.
  describe('honors IToolExecutionContext.cwd', () => {
    it('queues the proposal under context.cwd, not process.cwd()', async () => {
      const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-ctx-'));
      resetLessonCandidateQueues();
      try {
        const content = 'Scope embedded-engine cwd before writing .codebuddy state.';
        const result = await new LessonsProposeTool().execute(
          { category: 'PATTERN', content },
          { cwd: projectDir },
        );
        expect(result.success).toBe(true);

        // Landed in the context (active-project) dir...
        const projectPending = getLessonCandidateQueue(projectDir).list('pending');
        expect(projectPending.some((c) => c.content === content)).toBe(true);
        // ...and NOT in the spied process.cwd() dir.
        expect(getLessonCandidateQueue(tmpDir).list('pending')).toHaveLength(0);
        expect(
          await fs.pathExists(path.join(projectDir, '.codebuddy', 'lesson-candidates.json')),
        ).toBe(true);
        expect(
          await fs.pathExists(path.join(tmpDir, '.codebuddy', 'lesson-candidates.json')),
        ).toBe(false);
      } finally {
        resetLessonCandidateQueues();
        await fs.remove(projectDir);
      }
    });
  });
});
