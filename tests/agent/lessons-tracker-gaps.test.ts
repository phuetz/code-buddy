/**
 * Gap coverage for LessonsTracker — autoDecay, export, getStats, merge
 *
 * The base tests in lessons-tracker.test.ts cover add/remove/search/buildContextBlock.
 * This file covers the remaining untested methods.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { LessonsTracker } from '../../src/agent/lessons-tracker';
import { logger } from '../../src/utils/logger';

// Mock os.homedir so global ~/.codebuddy/lessons.md never contaminates tests.
let _fakeHome = '/tmp/lessons-gaps-placeholder';
jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return { ...actual, homedir: jest.fn(() => _fakeHome) };
});

describe('LessonsTracker (gap coverage)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-gaps-'));
    _fakeHome = path.join(tmpDir, 'fake-home');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  function createTracker(dir?: string): LessonsTracker {
    return new (LessonsTracker as any)(dir ?? tmpDir);
  }

  // --------------------------------------------------------------------------
  // autoDecay()
  // --------------------------------------------------------------------------

  describe('autoDecay()', () => {
    it('should remove INSIGHT items older than maxAgeDays', () => {
      const tracker = createTracker();
      const item = tracker.add('INSIGHT', 'Old insight', 'manual');
      // Set createdAt to 100 days ago
      (item as any).createdAt = Date.now() - 100 * 86_400_000;
      tracker.save();

      const removed = tracker.autoDecay(90);
      expect(removed).toBe(1);
      expect(tracker.list()).toHaveLength(0);
    });

    it('should NOT remove PATTERN items regardless of age', () => {
      const tracker = createTracker();
      const item = tracker.add('PATTERN', 'Old pattern', 'manual');
      (item as any).createdAt = Date.now() - 200 * 86_400_000;
      tracker.save();

      const removed = tracker.autoDecay(90);
      expect(removed).toBe(0);
      expect(tracker.list()).toHaveLength(1);
    });

    it('should NOT remove RULE items regardless of age', () => {
      const tracker = createTracker();
      const item = tracker.add('RULE', 'Old rule', 'manual');
      (item as any).createdAt = Date.now() - 200 * 86_400_000;
      tracker.save();

      expect(tracker.autoDecay(90)).toBe(0);
    });

    it('should NOT remove CONTEXT items regardless of age', () => {
      const tracker = createTracker();
      const item = tracker.add('CONTEXT', 'Old context', 'manual');
      (item as any).createdAt = Date.now() - 200 * 86_400_000;
      tracker.save();

      expect(tracker.autoDecay(90)).toBe(0);
    });

    it('should return count of removed items', () => {
      const tracker = createTracker();
      for (let i = 0; i < 5; i++) {
        const item = tracker.add('INSIGHT', `Insight ${i}`, 'manual');
        (item as any).createdAt = Date.now() - 100 * 86_400_000;
      }
      tracker.add('INSIGHT', 'Recent insight', 'manual'); // this one stays
      tracker.save();

      expect(tracker.autoDecay(90)).toBe(5);
      expect(tracker.list()).toHaveLength(1);
    });

    it('should return 0 when no items qualify for decay', () => {
      const tracker = createTracker();
      tracker.add('INSIGHT', 'Fresh insight', 'manual');
      expect(tracker.autoDecay(90)).toBe(0);
    });

    it('should use default 90 days when no argument given', () => {
      const tracker = createTracker();
      const item = tracker.add('INSIGHT', 'Old', 'manual');
      (item as any).createdAt = Date.now() - 91 * 86_400_000;
      tracker.save();

      expect(tracker.autoDecay()).toBe(1);
    });

    it('should not decay items with createdAt=0', () => {
      const tracker = createTracker();
      const item = tracker.add('INSIGHT', 'No timestamp', 'manual');
      (item as any).createdAt = 0;
      tracker.save();

      // createdAt=0 means "unknown" — should not be decayed
      expect(tracker.autoDecay(1)).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // export()
  // --------------------------------------------------------------------------

  describe('export()', () => {
    it('should export as JSON with all fields', () => {
      const tracker = createTracker();
      tracker.add('RULE', 'Always test', 'user_correction', 'TypeScript');
      const json = tracker.export('json');
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].category).toBe('RULE');
      expect(parsed[0].content).toBe('Always test');
      expect(parsed[0].source).toBe('user_correction');
      expect(parsed[0].context).toBe('TypeScript');
    });

    it('should export as CSV with proper header', () => {
      const tracker = createTracker();
      tracker.add('PATTERN', 'Use strict', 'manual', 'TS');
      const csv = tracker.export('csv');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('id,category,source,createdAt,context,content');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('"PATTERN"');
      expect(lines[1]).toContain('"Use strict"');
    });

    it('should handle items with commas and quotes in CSV export', () => {
      const tracker = createTracker();
      tracker.add('INSIGHT', 'Use "strict" mode, always', 'manual');
      const csv = tracker.export('csv');
      // Quotes should be escaped as ""
      expect(csv).toContain('""strict""');
    });

    it('should export as md matching serialise format', () => {
      const tracker = createTracker();
      tracker.add('RULE', 'Test first', 'manual');
      const md = tracker.export('md');
      expect(md).toContain('# Lessons Learned');
      expect(md).toContain('## RULE');
      expect(md).toContain('Test first');
    });

    it('should export empty array as valid JSON "[]"', () => {
      const tracker = createTracker();
      const json = tracker.export('json');
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // getStats()
  // --------------------------------------------------------------------------

  describe('getStats()', () => {
    it('should return correct total count', () => {
      const tracker = createTracker();
      tracker.add('RULE', 'R1', 'manual');
      tracker.add('PATTERN', 'P1', 'self_observed');
      tracker.add('INSIGHT', 'I1', 'user_correction');
      expect(tracker.getStats().total).toBe(3);
    });

    it('should return correct byCategory breakdown', () => {
      const tracker = createTracker();
      tracker.add('RULE', 'R1', 'manual');
      tracker.add('RULE', 'R2', 'manual');
      tracker.add('PATTERN', 'P1', 'manual');
      const stats = tracker.getStats();
      expect(stats.byCategory.RULE).toBe(2);
      expect(stats.byCategory.PATTERN).toBe(1);
      expect(stats.byCategory.CONTEXT).toBe(0);
      expect(stats.byCategory.INSIGHT).toBe(0);
    });

    it('should return correct bySource breakdown', () => {
      const tracker = createTracker();
      tracker.add('RULE', 'R1', 'user_correction');
      tracker.add('RULE', 'R2', 'self_observed');
      tracker.add('RULE', 'R3', 'manual');
      const stats = tracker.getStats();
      expect(stats.bySource.user_correction).toBe(1);
      expect(stats.bySource.self_observed).toBe(1);
      expect(stats.bySource.manual).toBe(1);
    });

    it('should return oldestAt and newestAt timestamps', () => {
      const tracker = createTracker();
      // Add two items — they get real timestamps from Date.now()
      tracker.add('RULE', 'First', 'manual');
      tracker.add('RULE', 'Second', 'manual');
      const stats = tracker.getStats();
      expect(stats.oldestAt).not.toBeNull();
      expect(stats.newestAt).not.toBeNull();
      expect(stats.oldestAt!).toBeLessThanOrEqual(stats.newestAt!);
    });

    it('should return null for oldestAt/newestAt when no items', () => {
      const tracker = createTracker();
      const stats = tracker.getStats();
      expect(stats.oldestAt).toBeNull();
      expect(stats.newestAt).toBeNull();
    });

    it('should initialize all categories to 0 even when empty', () => {
      const tracker = createTracker();
      const stats = tracker.getStats();
      expect(stats.byCategory).toEqual({ PATTERN: 0, RULE: 0, CONTEXT: 0, INSIGHT: 0 });
    });

    it('should initialize all sources to 0 even when empty', () => {
      const tracker = createTracker();
      const stats = tracker.getStats();
      expect(stats.bySource).toEqual({ user_correction: 0, self_observed: 0, manual: 0 });
    });
  });

  // --------------------------------------------------------------------------
  // Merge behavior (global + project)
  // --------------------------------------------------------------------------

  describe('merge behavior', () => {
    it('should prefer project item over global item with same id', () => {
      // Write global
      const globalDir = path.join(_fakeHome, '.codebuddy');
      fs.mkdirpSync(globalDir);
      fs.writeFileSync(
        path.join(globalDir, 'lessons.md'),
        '## RULE\n- [dup1] Global version <!-- 2024-01-01 manual -->\n'
      );

      // Write project
      const projectDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirpSync(projectDir);
      fs.writeFileSync(
        path.join(projectDir, 'lessons.md'),
        '## RULE\n- [dup1] Project version <!-- 2024-01-02 manual -->\n'
      );

      const tracker = createTracker();
      const items = tracker.list();
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Project version');
    });

    it('should warn on duplicate id with different content', () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation();

      const globalDir = path.join(_fakeHome, '.codebuddy');
      fs.mkdirpSync(globalDir);
      fs.writeFileSync(
        path.join(globalDir, 'lessons.md'),
        '## RULE\n- [dup2] Global text <!-- 2024-01-01 manual -->\n'
      );

      const projectDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirpSync(projectDir);
      fs.writeFileSync(
        path.join(projectDir, 'lessons.md'),
        '## RULE\n- [dup2] Different text <!-- 2024-01-02 manual -->\n'
      );

      createTracker().list(); // triggers load

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('duplicate ID "dup2"')
      );
      warnSpy.mockRestore();
    });

    it('should merge items from both global and project files', () => {
      const globalDir = path.join(_fakeHome, '.codebuddy');
      fs.mkdirpSync(globalDir);
      fs.writeFileSync(
        path.join(globalDir, 'lessons.md'),
        '## RULE\n- [g1] Global rule <!-- 2024-01-01 manual -->\n'
      );

      const projectDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirpSync(projectDir);
      fs.writeFileSync(
        path.join(projectDir, 'lessons.md'),
        '## PATTERN\n- [p1] Project pattern <!-- 2024-01-02 manual -->\n'
      );

      const tracker = createTracker();
      expect(tracker.list()).toHaveLength(2);
    });

    it('should not warn when duplicate id has identical content', () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation();

      const globalDir = path.join(_fakeHome, '.codebuddy');
      fs.mkdirpSync(globalDir);
      fs.writeFileSync(
        path.join(globalDir, 'lessons.md'),
        '## RULE\n- [same1] Same text <!-- 2024-01-01 manual -->\n'
      );

      const projectDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirpSync(projectDir);
      fs.writeFileSync(
        path.join(projectDir, 'lessons.md'),
        '## RULE\n- [same1] Same text <!-- 2024-01-02 manual -->\n'
      );

      createTracker().list();

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
