/**
 * Progress Tracker Tests
 */

import {
  ProgressTracker,
  createSimpleTracker,
  calculateIterationProgress,
} from '../../src/streaming/progress-tracker.js';
import type { ProgressUpdate } from '../../src/streaming/progress-tracker.js';

describe('Progress Tracker', () => {
  describe('ProgressTracker', () => {
    describe('single stage', () => {
      let tracker: ProgressTracker;

      beforeEach(() => {
        tracker = new ProgressTracker({
          stages: [{ name: 'main', weight: 1 }],
        });
      });

      it('should start with 0 progress', () => {
        tracker.start();
        const update = tracker.getUpdate();

        expect(update.totalProgress).toBe(0);
        expect(update.currentStage).toBe('main');
        expect(update.stageProgress).toBe(0);
      });

      it('should update progress', () => {
        tracker.start();
        tracker.updateProgress(50, undefined, 'Half done');

        const update = tracker.getUpdate();
        expect(update.totalProgress).toBe(50);
        expect(update.stageProgress).toBe(50);
        expect(update.message).toBe('Half done');
      });

      it('should complete stage', () => {
        tracker.start();
        tracker.completeStage();

        const update = tracker.getUpdate();
        expect(update.totalProgress).toBe(100);
        expect(tracker.isCompleted()).toBe(true);
      });

      it('should emit progress events', () => {
        const updates: ProgressUpdate[] = [];
        tracker.on('progress', (u) => updates.push(u));

        tracker.start();
        tracker.updateProgress(50);

        expect(updates.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('multiple stages', () => {
      let tracker: ProgressTracker;

      beforeEach(() => {
        tracker = new ProgressTracker({
          stages: [
            { name: 'prepare', weight: 1 },
            { name: 'process', weight: 3 },
            { name: 'finalize', weight: 1 },
          ],
        });
      });

      it('should calculate weighted progress', () => {
        tracker.start();

        // Complete prepare (1/5 total weight = 20%)
        tracker.updateProgress(100, 'prepare');

        const update = tracker.getUpdate();
        expect(update.totalProgress).toBe(20);
      });

      it('should advance to next stage', () => {
        tracker.start();
        tracker.completeStage('prepare');

        const update = tracker.getUpdate();
        expect(update.currentStage).toBe('process');
      });

      it('should handle partial progress in weighted stage', () => {
        tracker.start();
        tracker.completeStage('prepare'); // 20%
        tracker.updateProgress(50, 'process'); // 50% of 60% = 30% more

        const update = tracker.getUpdate();
        // 20% (prepare) + 30% (half of process) = 50%
        expect(update.totalProgress).toBe(50);
      });
    });

    describe('failure handling', () => {
      let tracker: ProgressTracker;

      beforeEach(() => {
        tracker = new ProgressTracker({
          stages: [{ name: 'main', weight: 1 }],
        });
      });

      it('should mark stage as failed', () => {
        tracker.start();
        tracker.failStage(undefined, 'Something went wrong');

        expect(tracker.hasFailed()).toBe(true);
        expect(tracker.isCompleted()).toBe(false);
      });
    });

    describe('time estimation', () => {
      let tracker: ProgressTracker;

      beforeEach(() => {
        tracker = new ProgressTracker({
          stages: [{ name: 'main', weight: 1 }],
          estimateTime: true,
          updateIntervalMs: 0, // No throttling for tests
        });
      });

      it('should track elapsed time', () => {
        tracker.start();

        const update = tracker.getUpdate();
        expect(update.elapsedTime).toBeGreaterThanOrEqual(0);
      });

      it('should return undefined for insufficient history', () => {
        tracker.start();

        const update = tracker.getUpdate();
        expect(update.estimatedTimeRemaining).toBeUndefined();
      });
    });

    describe('reset', () => {
      it('should reset tracker state', () => {
        const tracker = new ProgressTracker({
          stages: [{ name: 'main', weight: 1 }],
        });

        tracker.start();
        tracker.updateProgress(50);
        tracker.reset();

        const update = tracker.getUpdate();
        expect(update.totalProgress).toBe(0);
        expect(update.stageProgress).toBe(0);
      });
    });
  });

  describe('createSimpleTracker', () => {
    it('should call callback on update', () => {
      const updates: Array<{ progress: number; message?: string }> = [];
      const tracker = createSimpleTracker((p, m) => updates.push({ progress: p, message: m }));

      tracker.update(50, 'Half way');

      expect(updates.length).toBe(1);
      expect(updates[0].progress).toBe(50);
      expect(updates[0].message).toBe('Half way');
    });

    it('should clamp progress to 0-100', () => {
      const updates: number[] = [];
      const tracker = createSimpleTracker((p) => updates.push(p));

      tracker.update(-10);
      expect(updates[0]).toBe(0);

      tracker.update(150);
      expect(updates[1]).toBe(100);
    });

    it('should complete with 100% progress', () => {
      const updates: number[] = [];
      const tracker = createSimpleTracker((p) => updates.push(p));

      tracker.complete();

      expect(updates[0]).toBe(100);
    });

    it('should fail and report message', () => {
      const updates: Array<{ progress: number; message?: string }> = [];
      const tracker = createSimpleTracker((p, m) => updates.push({ progress: p, message: m }));

      tracker.update(30);
      tracker.fail('Error occurred');

      expect(updates[1].progress).toBe(30);
      expect(updates[1].message).toBe('Error occurred');
    });
  });

  describe('calculateIterationProgress', () => {
    it('should calculate progress for iteration', () => {
      expect(calculateIterationProgress(0, 10)).toBe(0);
      expect(calculateIterationProgress(5, 10)).toBe(50);
      expect(calculateIterationProgress(10, 10)).toBe(100);
    });

    it('should handle custom range', () => {
      // Progress from 20% to 80% (60% range)
      expect(calculateIterationProgress(0, 10, 20, 80)).toBe(20);
      expect(calculateIterationProgress(5, 10, 20, 80)).toBe(50);
      expect(calculateIterationProgress(10, 10, 20, 80)).toBe(80);
    });

    it('should handle zero total', () => {
      expect(calculateIterationProgress(0, 0)).toBe(100);
    });

    it('should handle negative total', () => {
      expect(calculateIterationProgress(5, -1)).toBe(100);
    });
  });
});
