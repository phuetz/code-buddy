/**
 * Tests for LessonsTracker — self-improvement loop
 *
 * Uses real fs in a tmpDir to match the production code path.
 * os.homedir() is spied on to prevent contamination from any real
 * ~/.codebuddy/lessons.md on the developer's machine.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { getLessonsTracker, LessonsTracker } from '../../src/agent/lessons-tracker.js';

// Mock os.homedir so global ~/.codebuddy/lessons.md never contaminates tests.
// The module-level variable is updated per-test in beforeEach.
let _fakeHome = '/tmp/lessons-test-home-placeholder';
jest.mock('os', () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: jest.fn(() => _fakeHome) };
});

describe('LessonsTracker', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-test-'));
    // Point "global" lessons dir to an empty location inside tmpDir
    _fakeHome = path.join(tmpDir, 'fake-home');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  // --------------------------------------------------------------------------
  // Singleton behaviour
  // --------------------------------------------------------------------------

  describe('getLessonsTracker (singleton)', () => {
    it('should return the same instance for the same directory', () => {
      const t1 = getLessonsTracker(tmpDir);
      const t2 = getLessonsTracker(tmpDir);
      expect(t1).toBe(t2);
    });

    it('should return different instances for different directories', async () => {
      const other = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-other-'));
      try {
        const t1 = getLessonsTracker(tmpDir);
        const t2 = getLessonsTracker(other);
        expect(t1).not.toBe(t2);
      } finally {
        await fs.remove(other);
      }
    });
  });

  // --------------------------------------------------------------------------
  // add()
  // --------------------------------------------------------------------------

  describe('add()', () => {
    it('should return a LessonItem with id and createdAt', () => {
      const tracker = getLessonsTracker(tmpDir);
      const item = tracker.add('PATTERN', 'use tsc before commit', 'manual');
      expect(item.id).toBeDefined();
      expect(typeof item.id).toBe('string');
      expect(item.createdAt).toBeGreaterThan(0);
      expect(item.category).toBe('PATTERN');
      expect(item.content).toBe('use tsc before commit');
      expect(item.source).toBe('manual');
    });

    it('should store context when provided', () => {
      const tracker = getLessonsTracker(tmpDir);
      const item = tracker.add('CONTEXT', 'repo uses ESM imports', 'manual', 'TypeScript');
      expect(item.context).toBe('TypeScript');
    });

    it('should support all valid categories', () => {
      const tracker = getLessonsTracker(tmpDir);
      const cats = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'] as const;
      for (const cat of cats) {
        const item = tracker.add(cat, `${cat} content`, 'manual');
        expect(item.category).toBe(cat);
      }
    });
  });

  // --------------------------------------------------------------------------
  // list()
  // --------------------------------------------------------------------------

  describe('list()', () => {
    it('should return all items when no category filter given', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'pattern lesson', 'manual');
      tracker.add('RULE', 'rule lesson', 'manual');
      const items = tracker.list();
      const contents = items.map(i => i.content);
      expect(contents).toContain('pattern lesson');
      expect(contents).toContain('rule lesson');
    });

    it('should filter by category', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'pattern lesson', 'manual');
      tracker.add('RULE', 'rule lesson', 'manual');
      const rules = tracker.list('RULE');
      expect(rules.every(i => i.category === 'RULE')).toBe(true);
      expect(rules.some(i => i.content === 'rule lesson')).toBe(true);
      expect(rules.some(i => i.content === 'pattern lesson')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // search()
  // --------------------------------------------------------------------------

  describe('search()', () => {
    it('should find items by substring match in content', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'always run tsc before committing', 'manual');
      const results = tracker.search('tsc');
      expect(results.some(i => i.content.includes('tsc'))).toBe(true);
    });

    it('should filter results by category when both query and category given', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'run tsc: pattern item', 'manual');
      tracker.add('RULE', 'run tsc: rule item', 'manual');
      const results = tracker.search('tsc', 'PATTERN');
      expect(results.every(i => i.category === 'PATTERN')).toBe(true);
    });

    it('should return empty array when no match found', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('INSIGHT', 'something unrelated', 'manual');
      expect(tracker.search('nonexistent_xyz')).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // remove()
  // --------------------------------------------------------------------------

  describe('remove()', () => {
    it('should remove an item by id and return true', () => {
      const tracker = getLessonsTracker(tmpDir);
      const item = tracker.add('INSIGHT', 'removable insight', 'manual');
      expect(tracker.remove(item.id)).toBe(true);
      expect(tracker.search('removable insight')).toHaveLength(0);
    });

    it('should return false for a non-existent id', () => {
      const tracker = getLessonsTracker(tmpDir);
      expect(tracker.remove('nonexistent-id-xyz')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // clearByCategory()
  // --------------------------------------------------------------------------

  describe('clearByCategory()', () => {
    it('should clear only the specified category and return the count removed', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('RULE', 'rule 1', 'manual');
      tracker.add('RULE', 'rule 2', 'manual');
      tracker.add('PATTERN', 'pattern stays', 'manual');
      const count = tracker.clearByCategory('RULE');
      expect(count).toBe(2);
      expect(tracker.list('RULE')).toHaveLength(0);
      expect(tracker.list('PATTERN').some(i => i.content === 'pattern stays')).toBe(true);
    });

    it('should clear all items when called without category', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('RULE', 'rule 1', 'manual');
      tracker.add('PATTERN', 'pattern 1', 'manual');
      const beforeCount = tracker.list().length;
      const count = tracker.clearByCategory();
      expect(count).toBe(beforeCount);
      expect(tracker.list()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // buildContextBlock()
  // --------------------------------------------------------------------------

  describe('buildContextBlock()', () => {
    it('should return null when there are no lessons', () => {
      const tracker = getLessonsTracker(tmpDir);
      // ensure clean state
      tracker.clearByCategory();
      expect(tracker.buildContextBlock()).toBeNull();
    });

    it('should return a <lessons_context> block when lessons exist', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('RULE', 'run tests before done', 'manual');
      tracker.add('PATTERN', 'wrong → correct approach', 'manual');
      const block = tracker.buildContextBlock();
      expect(block).not.toBeNull();
      expect(block).toContain('<lessons_context>');
      expect(block).toContain('</lessons_context>');
      expect(block).toContain('[RULE]');
      expect(block).toContain('[PATTERN]');
    });

    it('should order categories as RULE before PATTERN before CONTEXT before INSIGHT', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('INSIGHT', 'insight item', 'manual');
      tracker.add('RULE', 'rule item', 'manual');
      tracker.add('CONTEXT', 'context item', 'manual');
      const block = tracker.buildContextBlock()!;
      const ruleIdx = block.indexOf('[RULE]');
      const insightIdx = block.indexOf('[INSIGHT]');
      const contextIdx = block.indexOf('[CONTEXT]');
      expect(ruleIdx).toBeLessThan(contextIdx);
      expect(contextIdx).toBeLessThan(insightIdx);
    });

    it('should include context annotation when item has context', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('CONTEXT', 'uses ESM imports', 'manual', 'Node.js');
      const block = tracker.buildContextBlock()!;
      expect(block).toContain('Node.js');
    });
  });

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  describe('persistence', () => {
    it('should persist lessons to disk and reload on a new instance', () => {
      const persistDir = path.join(tmpDir, 'persist-test');
      fs.mkdirSync(persistDir, { recursive: true });

      const tracker1 = new LessonsTracker(persistDir);
      tracker1.add('CONTEXT', 'persist this lesson across sessions', 'manual');
      tracker1.save();

      // New instance reads from disk
      const tracker2 = new LessonsTracker(persistDir);
      const items = tracker2.list();
      expect(items.some(i => i.content === 'persist this lesson across sessions')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Markdown parsing
  // --------------------------------------------------------------------------

  describe('parseMd()', () => {
    it('should parse items with <!-- date source:context --> comment format', async () => {
      const parseDir = path.join(tmpDir, 'parse-test');
      const cbDir = path.join(parseDir, '.codebuddy');
      await fs.mkdirp(cbDir);

      const md = [
        '# Lessons Learned',
        '',
        '## PATTERN',
        '- [abc123] use tsc <!-- 2024-01-01 manual:TypeScript -->',
        '',
        '## RULE',
        '- [def456] always run tests <!-- 2024-01-02 user_correction -->',
        '',
      ].join('\n');

      await fs.writeFile(path.join(cbDir, 'lessons.md'), md, 'utf-8');

      const tracker = new LessonsTracker(parseDir);
      const items = tracker.list();
      expect(items).toHaveLength(2);

      const pattern = items.find(i => i.id === 'abc123');
      expect(pattern).toBeDefined();
      expect(pattern!.category).toBe('PATTERN');
      expect(pattern!.content).toBe('use tsc');
      expect(pattern!.context).toBe('TypeScript');
      expect(pattern!.source).toBe('manual');

      const rule = items.find(i => i.id === 'def456');
      expect(rule).toBeDefined();
      expect(rule!.category).toBe('RULE');
      expect(rule!.source).toBe('user_correction');
      expect(rule!.context).toBeUndefined();
    });
  });
});
