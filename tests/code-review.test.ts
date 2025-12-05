/**
 * Code Review Mode Tests
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import {
  CodeReviewEngine,
  createCodeReview,
  reviewProject,
} from '../src/modes/code-review.js';

describe('CodeReviewEngine', () => {
  let engine: CodeReviewEngine;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `review-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

    engine = new CodeReviewEngine(testDir);
  });

  afterEach(async () => {
    engine.dispose();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Security Rules', () => {
    it('should detect hardcoded secrets', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'config.ts'),
        'const apiKey = "sk-1234567890abcdefghijklmnop";'
      );

      const result = await engine.review();
      const secretComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.category === 'security');

      expect(secretComments.length).toBeGreaterThan(0);
    });

    it('should detect eval usage', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'unsafe.ts'),
        'const result = eval(userInput);'
      );

      const result = await engine.review();
      const evalComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.message.includes('eval'));

      expect(evalComments.length).toBeGreaterThan(0);
    });

    it('should detect innerHTML usage', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'dom.ts'),
        'element.innerHTML = userContent;'
      );

      const result = await engine.review();
      const innerHTMLComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.message.includes('innerHTML'));

      expect(innerHTMLComments.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Rules', () => {
    it('should detect sync file operations', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'file.ts'),
        'const data = fs.readFileSync("file.txt");'
      );

      const result = await engine.review();
      const syncComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.category === 'performance');

      expect(syncComments.length).toBeGreaterThan(0);
      expect(syncComments[0].message).toContain('Synchronous');
    });

    it('should detect nested loops', async () => {
      // Pattern expects loops close together (single-line style)
      await fs.writeFile(
        path.join(testDir, 'src', 'loops.ts'),
        'for (let i = 0; i < n; i++) { for (let j = 0; j < m; j++) { } }'
      );

      const result = await engine.review();
      const loopComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.message.includes('Nested loops'));

      expect(loopComments.length).toBeGreaterThan(0);
    });
  });

  describe('Bug-prone Code Rules', () => {
    it('should detect loose equality', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'compare.ts'),
        'if (a == b) { return true; }'
      );

      const result = await engine.review();
      const equalityComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.message.includes('strict equality'));

      expect(equalityComments.length).toBeGreaterThan(0);
      expect(equalityComments[0].category).toBe('bug');
    });

    it('should detect empty catch blocks', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'error.ts'),
        'try { doSomething(); } catch (e) {}'
      );

      const result = await engine.review();
      const catchComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.message.includes('Empty catch'));

      expect(catchComments.length).toBeGreaterThan(0);
    });
  });

  describe('Best Practice Rules', () => {
    it('should detect console statements', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'debug.ts'),
        'console.log("debug info");'
      );

      const result = await engine.review();
      const consoleComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.message.includes('Console'));

      expect(consoleComments.length).toBeGreaterThan(0);
      expect(consoleComments[0].category).toBe('best-practice');
    });

    it('should detect any type usage', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'typed.ts'),
        'function process(data: any) { return data; }'
      );

      const result = await engine.review();
      const anyComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.message.includes('any'));

      expect(anyComments.length).toBeGreaterThan(0);
    });
  });

  describe('Maintainability Rules', () => {
    it('should detect TODO comments', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'todo.ts'),
        '// TODO: fix this later\nfunction doSomething() {}'
      );

      const result = await engine.review();
      const todoComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.message.includes('TODO'));

      expect(todoComments.length).toBeGreaterThan(0);
    });
  });

  describe('Review Summary', () => {
    it('should generate summary', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'test.ts'),
        'const x = eval("1+1"); console.log(x);'
      );

      const result = await engine.review();

      expect(result.summary).toBeDefined();
      expect(result.summary.totalFiles).toBeGreaterThanOrEqual(1);
      expect(result.summary.totalComments).toBeGreaterThan(0);
      expect(result.summary.score).toBeGreaterThanOrEqual(0);
      expect(result.summary.score).toBeLessThanOrEqual(100);
    });

    it('should calculate grade', async () => {
      await fs.writeFile(path.join(testDir, 'src', 'clean.ts'), 'export const x = 1;');

      const result = await engine.review();

      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.summary.grade);
    });

    it('should count by severity', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'mixed.ts'),
        'const secret = "password=secret123456789";\nconsole.log("debug");'
      );

      const result = await engine.review();

      expect(result.summary.bySeverity).toHaveProperty('critical');
      expect(result.summary.bySeverity).toHaveProperty('warning');
      expect(result.summary.bySeverity).toHaveProperty('info');
    });
  });

  describe('File Review', () => {
    it('should review single file', async () => {
      await fs.writeFile(path.join(testDir, 'src', 'single.ts'), 'console.log("test");');

      const review = await engine.reviewFile('src/single.ts');

      expect(review.path).toBe('src/single.ts');
      expect(review.linesReviewed).toBeGreaterThan(0);
      expect(review.score).toBeDefined();
    });

    it('should include line numbers', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'lines.ts'),
        'const x = 1;\nconsole.log(x);'
      );

      const review = await engine.reviewFile('src/lines.ts');

      for (const comment of review.comments) {
        expect(comment.line).toBeGreaterThan(0);
      }
    });
  });

  describe('Configuration', () => {
    it('should respect include patterns', async () => {
      await fs.writeFile(path.join(testDir, 'src', 'included.ts'), 'console.log("test");');
      await fs.writeFile(path.join(testDir, 'src', 'excluded.py'), 'print("test")');

      const customEngine = new CodeReviewEngine(testDir, {
        includePatterns: ['**/*.ts'],
      });

      const result = await customEngine.review();
      const files = result.files.map(f => f.path);

      expect(files.some(f => f.endsWith('.ts'))).toBe(true);
      customEngine.dispose();
    });

    it('should filter by severity threshold', async () => {
      await fs.writeFile(path.join(testDir, 'src', 'code.ts'), 'console.log("test");');

      const warningEngine = new CodeReviewEngine(testDir, {
        severityThreshold: 'warning',
      });

      const result = await warningEngine.review();
      const infoComments = result.files
        .flatMap(f => f.comments)
        .filter(c => c.severity === 'info' || c.severity === 'suggestion');

      expect(infoComments).toHaveLength(0);
      warningEngine.dispose();
    });
  });

  describe('Text Formatting', () => {
    it('should format result as text', async () => {
      await fs.writeFile(path.join(testDir, 'src', 'test.ts'), 'console.log("test");');

      const result = await engine.review();
      const text = engine.formatAsText(result);

      expect(text).toContain('CODE REVIEW REPORT');
      expect(text).toContain('Score:');
      expect(text).toContain('Grade:');
    });
  });

  describe('Factory Functions', () => {
    it('should create engine with factory', () => {
      const e = createCodeReview('/tmp');
      expect(e).toBeInstanceOf(CodeReviewEngine);
      e.dispose();
    });

    it('should run quick review', async () => {
      await fs.writeFile(path.join(testDir, 'src', 'quick.ts'), 'const x = 1;');

      const result = await reviewProject(testDir, { maxFiles: 1 });

      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Events', () => {
    it('should emit progress events', async () => {
      await fs.writeFile(path.join(testDir, 'src', 'event.ts'), 'const x = 1;');

      const handler = jest.fn();
      engine.on('progress', handler);

      await engine.review();

      expect(handler).toHaveBeenCalled();
    });
  });
});
