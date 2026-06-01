/**
 * Tests for the lesson candidate review queue (Hermes parity TODO item 7).
 *
 * The central guarantee under test is "no silent procedural memory mutation":
 * proposing a lesson must never write lessons.md, and only an explicit human
 * approval may promote a candidate into a real lesson.
 *
 * Each test uses a unique temp workDir so the per-workDir singletons never
 * bleed. os.homedir() is mocked so the global ~/.codebuddy/lessons.md is never
 * read or written.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  LessonCandidateQueue,
  getLessonCandidateQueue,
  resetLessonCandidateQueues,
} from '../../src/agent/lesson-candidate-queue.js';
import { getLessonsTracker } from '../../src/agent/lessons-tracker.js';
import {
  getLessonProvenanceIndex,
  resetLessonProvenanceIndex,
} from '../../src/agent/lesson-provenance.js';

let _fakeHome = '/tmp/lesson-candidate-test-home-placeholder';
jest.mock('os', () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: jest.fn(() => _fakeHome) };
});

describe('LessonCandidateQueue', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-candidate-test-'));
    _fakeHome = path.join(tmpDir, 'fake-home');
    resetLessonCandidateQueues();
    resetLessonProvenanceIndex();
  });

  afterEach(async () => {
    resetLessonCandidateQueues();
    resetLessonProvenanceIndex();
    await fs.remove(tmpDir);
  });

  const lessonsMdPath = () => path.join(tmpDir, '.codebuddy', 'lessons.md');

  describe('propose', () => {
    it('enqueues a pending candidate without writing lessons.md', () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate, deduped } = queue.propose({
        category: 'PATTERN',
        content: 'Always run tsc before marking a task done.',
        context: 'TypeScript',
      });

      expect(deduped).toBe(false);
      expect(candidate.status).toBe('pending');
      expect(candidate.category).toBe('PATTERN');
      expect(candidate.source).toBe('self_observed');
      expect(candidate.approvedLessonId).toBeUndefined();
      // The critical guarantee: proposing must not write a lesson.
      expect(fs.existsSync(lessonsMdPath())).toBe(false);
      // But the candidate side-car is persisted.
      expect(fs.existsSync(path.join(tmpDir, '.codebuddy', 'lesson-candidates.json'))).toBe(true);
    });

    it('de-duplicates identical pending proposals (case-insensitive)', () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const first = queue.propose({ category: 'RULE', content: 'Prefer the dedicated tool.' });
      const second = queue.propose({ category: 'RULE', content: 'prefer the dedicated tool.  ' });

      expect(second.deduped).toBe(true);
      expect(second.candidate.id).toBe(first.candidate.id);
      expect(queue.list('pending')).toHaveLength(1);
    });

    it('does not enqueue a new candidate for an already recorded lesson', async () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const first = queue.propose({
        category: 'RULE',
        content: 'Do not re-review lessons that are already recorded.',
      });

      const { lesson } = await queue.approve(first.candidate.id, { reviewedBy: 'Patrice' });
      const second = queue.propose({
        category: 'RULE',
        content: 'do not re-review lessons that are already recorded.  ',
      });

      expect(second.deduped).toBe(true);
      expect(second.alreadyRecorded).toBe(true);
      expect(second.existingLesson?.id).toBe(lesson.id);
      expect(second.candidate).toBeUndefined();
      expect(queue.list('pending')).toHaveLength(0);
    });

    it('throws on empty content and on an invalid category', () => {
      const queue = new LessonCandidateQueue(tmpDir);
      expect(() => queue.propose({ category: 'RULE', content: '   ' })).toThrow(/content is required/i);
      expect(() =>
        queue.propose({ category: 'NONSENSE' as never, content: 'x' }),
      ).toThrow(/category must be one of/i);
    });
  });

  describe('list', () => {
    it('filters by status and returns newest first', () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const a = queue.propose({ category: 'INSIGHT', content: 'first' }).candidate;
      // Force a distinct, later timestamp for the second candidate.
      const b = queue.propose({ category: 'INSIGHT', content: 'second' }).candidate;
      b.createdAt = a.createdAt + 1000;

      const pending = queue.list('pending');
      expect(pending.map((c) => c.content)).toEqual(['second', 'first']);
      expect(queue.list('approved')).toHaveLength(0);
    });
  });

  describe('approve', () => {
    it('requires an explicit human reviewer', async () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({ category: 'PATTERN', content: 'p' });
      await expect(queue.approve(candidate.id, { reviewedBy: '   ' })).rejects.toThrow(
        /human approval/i,
      );
      // Still pending, still no lesson written.
      expect(queue.get(candidate.id)?.status).toBe('pending');
      expect(fs.existsSync(lessonsMdPath())).toBe(false);
    });

    it('writes the lesson, links the lesson id, and marks the candidate approved', async () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({
        category: 'PATTERN',
        content: 'Bash tests need ConfirmationService.setSessionFlag first.',
        context: 'testing',
      });

      const { candidate: approved, lesson } = await queue.approve(candidate.id, {
        reviewedBy: 'Patrice',
      });

      expect(approved.status).toBe('approved');
      expect(approved.reviewedBy).toBe('Patrice');
      expect(approved.approvedLessonId).toBe(lesson.id);

      // The lesson is now persisted in lessons.md and visible via the tracker.
      const tracked = getLessonsTracker(tmpDir).list();
      expect(tracked.some((l) => l.id === lesson.id && l.source === 'self_observed')).toBe(true);
      const md = await fs.readFile(lessonsMdPath(), 'utf-8');
      expect(md).toContain('Bash tests need ConfirmationService');
    });

    it('applies inline reviewer edits before writing the lesson', async () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({ category: 'INSIGHT', content: 'rough draft' });

      const { lesson } = await queue.approve(candidate.id, {
        reviewedBy: 'reviewer',
        content: 'Polished, edited lesson text.',
        category: 'RULE',
        context: 'workflow',
      });

      expect(lesson.category).toBe('RULE');
      expect(lesson.content).toBe('Polished, edited lesson text.');
      expect(lesson.context).toBe('workflow');
    });

    it('carries provenance into the lesson provenance index', async () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({
        category: 'PATTERN',
        content: 'lesson with provenance',
        provenance: { runId: 'run-123', note: 'after a complex success' },
      });

      const { lesson } = await queue.approve(candidate.id, { reviewedBy: 'reviewer' });

      const record = getLessonProvenanceIndex(tmpDir).getProvenance(lesson.id);
      expect(record?.createdBy?.runId).toBe('run-123');
    });

    it('refuses to approve a non-pending candidate', async () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({ category: 'RULE', content: 'once' });
      await queue.approve(candidate.id, { reviewedBy: 'reviewer' });
      await expect(queue.approve(candidate.id, { reviewedBy: 'reviewer' })).rejects.toThrow(
        /already approved/i,
      );
    });
  });

  describe('discard', () => {
    it('marks a pending candidate discarded with a reason', () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({ category: 'INSIGHT', content: 'noise' });
      const discarded = queue.discard(candidate.id, { reviewedBy: 'reviewer', reason: 'not useful' });
      expect(discarded.status).toBe('discarded');
      expect(discarded.reviewNote).toBe('not useful');
    });

    it('refuses to discard an already-approved candidate', async () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({ category: 'RULE', content: 'kept' });
      await queue.approve(candidate.id, { reviewedBy: 'reviewer' });
      expect(() => queue.discard(candidate.id)).toThrow(/already approved/i);
    });

    it('refuses to discard an already-discarded candidate', () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({ category: 'RULE', content: 'discard once' });
      queue.discard(candidate.id, { reviewedBy: 'reviewer', reason: 'first reason' });

      expect(() =>
        queue.discard(candidate.id, { reviewedBy: 'reviewer', reason: 'second reason' }),
      ).toThrow(/already discarded/i);
      expect(queue.get(candidate.id)?.reviewNote).toBe('first reason');
    });
  });

  describe('persistence', () => {
    it('reloads queue state from disk across instances', async () => {
      const queue = new LessonCandidateQueue(tmpDir);
      const { candidate } = queue.propose({ category: 'PATTERN', content: 'persist me' });
      await queue.approve(candidate.id, { reviewedBy: 'reviewer' });
      queue.propose({ category: 'INSIGHT', content: 'still pending' });

      const reloaded = new LessonCandidateQueue(tmpDir);
      const stats = reloaded.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byStatus.approved).toBe(1);
      expect(stats.byStatus.pending).toBe(1);
      expect(reloaded.get(candidate.id)?.approvedLessonId).toBeDefined();
    });
  });

  describe('singleton accessor', () => {
    it('returns the same instance for the same workDir', () => {
      const a = getLessonCandidateQueue(tmpDir);
      const b = getLessonCandidateQueue(tmpDir);
      expect(a).toBe(b);
    });
  });
});
