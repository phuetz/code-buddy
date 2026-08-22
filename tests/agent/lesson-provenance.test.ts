import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  LessonProvenanceIndex,
  getLessonProvenanceIndex,
  resetLessonProvenanceIndex,
} from '../../src/agent/lesson-provenance.js';
import { LessonsTracker } from '../../src/agent/lessons-tracker.js';

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-prov-'));
  fs.mkdirSync(path.join(dir, '.codebuddy'), { recursive: true });
  return dir;
}

describe('LessonProvenanceIndex', () => {
  let workDir: string;

  beforeEach(() => {
    resetLessonProvenanceIndex();
    workDir = makeWorkDir();
  });

  afterEach(() => {
    resetLessonProvenanceIndex();
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  it('records and returns creation provenance', () => {
    const index = new LessonProvenanceIndex(workDir);
    index.recordCreated('lesson-1', { runId: 'run_a', outcomeId: 'out_1', note: 'from review' });

    const record = index.getProvenance('lesson-1');
    expect(record?.createdBy?.runId).toBe('run_a');
    expect(record?.createdBy?.outcomeId).toBe('out_1');
    expect(record?.createdBy?.note).toBe('from review');
    expect(typeof record?.createdBy?.at).toBe('number');
    expect(record?.usedBy).toEqual([]);
  });

  it('records usage idempotently per (lesson, run)', () => {
    const index = new LessonProvenanceIndex(workDir);
    index.recordUsage('lesson-1', 'run_a');
    index.recordUsage('lesson-1', 'run_a'); // duplicate — ignored
    index.recordUsage('lesson-1', 'run_b');

    const record = index.getProvenance('lesson-1');
    expect(record?.usedBy.map((u) => u.runId)).toEqual(['run_a', 'run_b']);
  });

  it('returns null for an unknown lesson', () => {
    const index = new LessonProvenanceIndex(workDir);
    expect(index.getProvenance('missing')).toBeNull();
  });

  it('persists across instances', () => {
    const first = new LessonProvenanceIndex(workDir);
    first.recordCreated('lesson-1', { runId: 'run_a' });
    first.recordUsage('lesson-1', 'run_b');

    const second = new LessonProvenanceIndex(workDir);
    const record = second.getProvenance('lesson-1');
    expect(record?.createdBy?.runId).toBe('run_a');
    expect(record?.usedBy.map((u) => u.runId)).toEqual(['run_b']);
  });

  it('prunes provenance for lessons that no longer exist', () => {
    const index = new LessonProvenanceIndex(workDir);
    index.recordUsage('keep', 'run_a');
    index.recordUsage('drop', 'run_b');

    const removed = index.prune(['keep']);
    expect(removed).toBe(1);
    expect(index.getProvenance('drop')).toBeNull();
    expect(index.getProvenance('keep')).not.toBeNull();
  });

  it('LessonsTracker.add records created-by provenance when provided', () => {
    const tracker = new LessonsTracker(workDir);
    const lesson = tracker.add('PATTERN', 'always run tests', 'self_observed', 'testing', {
      runId: 'run_x',
      outcomeId: 'out_9',
    });

    const record = getLessonProvenanceIndex(workDir).getProvenance(lesson.id);
    expect(record?.createdBy?.runId).toBe('run_x');
    expect(record?.createdBy?.outcomeId).toBe('out_9');
  });

  it('LessonsTracker.add without provenance does not create a record', () => {
    const tracker = new LessonsTracker(workDir);
    const lesson = tracker.add('INSIGHT', 'a plain lesson', 'manual');
    expect(getLessonProvenanceIndex(workDir).getProvenance(lesson.id)).toBeNull();
  });
});
