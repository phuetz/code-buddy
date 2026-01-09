/**
 * Tests for ROI Tracker
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies
jest.mock('fs-extra', () => ({
  existsSync: jest.fn(),
  readJsonSync: jest.fn(),
  ensureDirSync: jest.fn(),
  writeJsonSync: jest.fn(),
}));

import {
  ROITracker,
  getROITracker,
  TaskCompletion,
  ROIMetrics,
  ROIReport,
} from '../../src/analytics/roi-tracker';

const mockFs = fs as jest.Mocked<typeof fs>;

describe('ROITracker', () => {
  let tracker: ROITracker;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readJsonSync.mockReturnValue([]);
    tracker = new ROITracker({ hourlyRate: 50 });
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      mockFs.existsSync.mockReturnValue(false);
      const defaultTracker = new ROITracker();
      expect(defaultTracker).toBeDefined();
    });

    it('should accept custom config', () => {
      const customTracker = new ROITracker({
        hourlyRate: 100,
        dataPath: '/custom/path.json',
      });
      expect(customTracker).toBeDefined();
    });

    it('should load existing data on creation', () => {
      // Create a task with a recent timestamp
      const recentDate = new Date();
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync.mockReturnValue([
        {
          id: 'task-1',
          type: 'code_generation',
          description: 'Test task',
          timestamp: recentDate.toISOString(),
          apiCost: 0.05,
          tokensUsed: 1000,
          estimatedManualMinutes: 30,
          actualMinutes: 5,
          success: true,
        },
      ]);

      const loadedTracker = new ROITracker();
      const report = loadedTracker.getReport(30);

      expect(report.metrics.tasksCompleted).toBe(1);
    });

    it('should handle corrupted data gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync.mockImplementation(() => {
        throw new Error('JSON parse error');
      });

      const brokenTracker = new ROITracker();
      const report = brokenTracker.getReport(30);

      expect(report.metrics.tasksCompleted).toBe(0);
    });
  });

  describe('recordTask', () => {
    it('should record a task completion', () => {
      tracker.recordTask({
        type: 'code_generation',
        description: 'Generated user authentication module',
        apiCost: 0.05,
        tokensUsed: 1000,
        actualMinutes: 5,
        linesOfCode: 100,
        filesModified: 3,
        success: true,
      });

      expect(mockFs.writeJsonSync).toHaveBeenCalled();

      const report = tracker.getReport(30);
      expect(report.metrics.tasksCompleted).toBe(1);
    });

    it('should generate task ID and timestamp', () => {
      tracker.recordTask({
        type: 'bug_fix',
        description: 'Fixed login issue',
        apiCost: 0.02,
        tokensUsed: 500,
        actualMinutes: 3,
        success: true,
      });

      const report = tracker.getReport(30);
      expect(report.metrics.tasksCompleted).toBe(1);
    });

    it('should estimate manual time based on task type', () => {
      tracker.recordTask({
        type: 'code_generation',
        description: 'Test',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 2,
        linesOfCode: 50,
        success: true,
      });

      const report = tracker.getReport(30);
      // code_generation: min 15 + 50 * 0.5 = 40 minutes estimated
      expect(report.metrics.totalManualMinutesEstimate).toBeGreaterThan(0);
    });

    it('should save data after recording', () => {
      tracker.recordTask({
        type: 'documentation',
        description: 'Added API docs',
        apiCost: 0.01,
        tokensUsed: 200,
        actualMinutes: 1,
        success: true,
      });

      expect(mockFs.ensureDirSync).toHaveBeenCalled();
      expect(mockFs.writeJsonSync).toHaveBeenCalled();
    });
  });

  describe('estimateManualTime', () => {
    it('should estimate time for code_generation', () => {
      const estimate = tracker.estimateManualTime('code_generation', 100);
      // min 15 + 100 * 0.5 = 65
      expect(estimate).toBe(65);
    });

    it('should estimate time for bug_fix', () => {
      const estimate = tracker.estimateManualTime('bug_fix', 50);
      // min 30 + 50 * 1 = 80
      expect(estimate).toBe(80);
    });

    it('should estimate time for refactoring', () => {
      const estimate = tracker.estimateManualTime('refactoring', 200);
      // min 20 + 200 * 0.3 = 80
      expect(estimate).toBe(80);
    });

    it('should estimate time for documentation', () => {
      const estimate = tracker.estimateManualTime('documentation', 100);
      // min 10 + 100 * 0.2 = 30
      expect(estimate).toBe(30);
    });

    it('should estimate time for testing', () => {
      const estimate = tracker.estimateManualTime('testing', 100);
      // min 20 + 100 * 0.4 = 60
      expect(estimate).toBe(60);
    });

    it('should estimate time for research without lines', () => {
      const estimate = tracker.estimateManualTime('research');
      // min 20 + 0 (no per-line for research) = 20
      expect(estimate).toBe(20);
    });

    it('should handle undefined lines of code', () => {
      const estimate = tracker.estimateManualTime('code_generation');
      expect(estimate).toBe(15); // Just the minimum
    });
  });

  describe('getReport', () => {
    beforeEach(() => {
      // Add some tasks
      tracker.recordTask({
        type: 'code_generation',
        description: 'Task 1',
        apiCost: 0.05,
        tokensUsed: 1000,
        actualMinutes: 5,
        linesOfCode: 100,
        success: true,
      });
      tracker.recordTask({
        type: 'bug_fix',
        description: 'Task 2',
        apiCost: 0.02,
        tokensUsed: 500,
        actualMinutes: 3,
        success: true,
      });
      tracker.recordTask({
        type: 'code_generation',
        description: 'Task 3',
        apiCost: 0.03,
        tokensUsed: 800,
        actualMinutes: 4,
        success: false,
      });
    });

    it('should return report for specified period', () => {
      const report = tracker.getReport(30);

      expect(report.period.days).toBe(30);
      expect(report.period.from).toBeInstanceOf(Date);
      expect(report.period.to).toBeInstanceOf(Date);
    });

    it('should calculate total API cost', () => {
      const report = tracker.getReport(30);

      expect(report.metrics.totalApiCost).toBe(0.10); // 0.05 + 0.02 + 0.03
    });

    it('should calculate success rate', () => {
      const report = tracker.getReport(30);

      expect(report.metrics.successRate).toBeCloseTo(2 / 3); // 2 successful out of 3
    });

    it('should calculate time saved', () => {
      const report = tracker.getReport(30);

      // Total actual: 5 + 3 + 4 = 12 minutes
      // Total estimated: based on task types and lines
      expect(report.metrics.totalActualMinutes).toBe(12);
      expect(report.metrics.totalTimeSavedMinutes).toBe(
        report.metrics.totalManualMinutesEstimate - report.metrics.totalActualMinutes
      );
    });

    it('should calculate productivity multiplier', () => {
      const report = tracker.getReport(30);

      expect(report.metrics.productivityMultiplier).toBe(
        report.metrics.totalManualMinutesEstimate / report.metrics.totalActualMinutes
      );
    });

    it('should calculate net value', () => {
      const report = tracker.getReport(30);

      const hoursSaved = report.metrics.totalTimeSavedMinutes / 60;
      const valueSaved = hoursSaved * 50; // hourly rate is 50
      const expectedNetValue = valueSaved - report.metrics.totalApiCost;

      expect(report.metrics.netValue).toBeCloseTo(expectedNetValue, 2);
    });

    it('should break down by type', () => {
      const report = tracker.getReport(30);

      expect(report.byType.code_generation).toBeDefined();
      expect(report.byType.bug_fix).toBeDefined();
      expect(report.byType.code_generation.tasksCompleted).toBe(2);
      expect(report.byType.bug_fix.tasksCompleted).toBe(1);
    });

    it('should calculate trends', () => {
      const report = tracker.getReport(30);

      expect(report.trends).toBeDefined();
      expect(report.trends.weeklyApiCost).toBeInstanceOf(Array);
      expect(report.trends.weeklyTimeSaved).toBeInstanceOf(Array);
      expect(report.trends.weeklyProductivity).toBeInstanceOf(Array);
    });

    it('should generate recommendations', () => {
      const report = tracker.getReport(30);

      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should include generatedAt timestamp', () => {
      const report = tracker.getReport(30);

      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it('should filter tasks by date range', () => {
      // All tasks were added "now", so 1 day should include them
      const report = tracker.getReport(1);

      expect(report.metrics.tasksCompleted).toBe(3);
    });
  });

  describe('Recommendations', () => {
    it('should congratulate on positive ROI', () => {
      tracker.recordTask({
        type: 'code_generation',
        description: 'Large feature',
        apiCost: 0.10,
        tokensUsed: 2000,
        actualMinutes: 10,
        linesOfCode: 500,
        success: true,
      });

      const report = tracker.getReport(30);

      if (report.metrics.netValue > 0) {
        expect(report.recommendations.some(r => r.includes('Great ROI') || r.includes('saved'))).toBe(true);
      }
    });

    it('should suggest improvement for low productivity', () => {
      // Task with low productivity gain
      tracker.recordTask({
        type: 'research',
        description: 'Quick research',
        apiCost: 0.05,
        tokensUsed: 1000,
        actualMinutes: 15, // Close to estimated time
        success: true,
      });

      const report = tracker.getReport(30);

      // If productivity is low, should get suggestion
      if (report.metrics.productivityMultiplier < 2) {
        expect(report.recommendations.some(r =>
          r.includes('productivity') || r.includes('prompts')
        )).toBe(true);
      }
    });

    it('should suggest breaking down tasks for low success rate', () => {
      // Add multiple failed tasks
      for (let i = 0; i < 5; i++) {
        tracker.recordTask({
          type: 'code_generation',
          description: `Failed task ${i}`,
          apiCost: 0.01,
          tokensUsed: 100,
          actualMinutes: 5,
          success: false,
        });
      }
      tracker.recordTask({
        type: 'code_generation',
        description: 'Success',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 5,
        success: true,
      });

      const report = tracker.getReport(30);

      expect(report.recommendations.some(r =>
        r.includes('Success rate') || r.includes('smaller')
      )).toBe(true);
    });

    it('should identify best performing task type', () => {
      tracker.recordTask({
        type: 'bug_fix',
        description: 'Quick fix',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 1,
        linesOfCode: 50,
        success: true,
      });

      const report = tracker.getReport(30);

      expect(report.recommendations.some(r => r.includes('Best ROI'))).toBe(true);
    });
  });

  describe('formatReport', () => {
    beforeEach(() => {
      tracker.recordTask({
        type: 'code_generation',
        description: 'Test task',
        apiCost: 0.05,
        tokensUsed: 1000,
        actualMinutes: 5,
        linesOfCode: 100,
        success: true,
      });
    });

    it('should format report for display', () => {
      const report = tracker.getReport(30);
      const formatted = tracker.formatReport(report);

      expect(formatted).toContain('ROI ANALYSIS REPORT');
      expect(formatted).toContain('OVERALL METRICS');
      expect(formatted).toContain('VALUE ANALYSIS');
      expect(formatted).toContain('BY TASK TYPE');
    });

    it('should show period information', () => {
      const report = tracker.getReport(30);
      const formatted = tracker.formatReport(report);

      expect(formatted).toContain('Period:');
      expect(formatted).toContain('30 days');
    });

    it('should show task counts', () => {
      const report = tracker.getReport(30);
      const formatted = tracker.formatReport(report);

      expect(formatted).toContain('Tasks Completed:');
      expect(formatted).toContain('Success Rate:');
    });

    it('should show cost information', () => {
      const report = tracker.getReport(30);
      const formatted = tracker.formatReport(report);

      expect(formatted).toContain('Total API Cost:');
      expect(formatted).toContain('$');
    });

    it('should show time savings', () => {
      const report = tracker.getReport(30);
      const formatted = tracker.formatReport(report);

      expect(formatted).toContain('Time Saved:');
      expect(formatted).toContain('hours');
    });

    it('should show productivity multiplier', () => {
      const report = tracker.getReport(30);
      const formatted = tracker.formatReport(report);

      expect(formatted).toContain('Productivity:');
      expect(formatted).toContain('x faster');
    });

    it('should show recommendations', () => {
      const report = tracker.getReport(30);
      const formatted = tracker.formatReport(report);

      expect(formatted).toContain('RECOMMENDATIONS');
    });

    it('should show weekly trends when available', () => {
      // Add tasks over multiple weeks
      const report = tracker.getReport(30);

      if (report.trends.weeklyProductivity.length > 1) {
        const formatted = tracker.formatReport(report);
        expect(formatted).toContain('WEEKLY PRODUCTIVITY TREND');
      }
    });
  });

  describe('exportData', () => {
    it('should export tasks as JSON', () => {
      tracker.recordTask({
        type: 'code_generation',
        description: 'Test',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 2,
        success: true,
      });

      const json = tracker.exportData();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].type).toBe('code_generation');
    });
  });

  describe('setHourlyRate', () => {
    it('should update hourly rate', () => {
      tracker.setHourlyRate(100);

      tracker.recordTask({
        type: 'code_generation',
        description: 'Test',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 2,
        linesOfCode: 100,
        success: true,
      });

      const report = tracker.getReport(30);
      const formatted = tracker.formatReport(report);

      expect(formatted).toContain('$100/hr');
    });
  });

  describe('clear', () => {
    it('should clear all tasks', () => {
      tracker.recordTask({
        type: 'code_generation',
        description: 'Test',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 2,
        success: true,
      });

      tracker.clear();

      const report = tracker.getReport(30);
      expect(report.metrics.tasksCompleted).toBe(0);
    });

    it('should save after clearing', () => {
      tracker.clear();

      expect(mockFs.writeJsonSync).toHaveBeenCalled();
    });
  });

  describe('getROITracker singleton', () => {
    it('should return same instance', () => {
      // Reset module state by clearing the mock
      jest.resetModules();

      // Re-import to get fresh singleton
      const { getROITracker: getTracker1 } = require('../../src/analytics/roi-tracker');
      const { getROITracker: getTracker2 } = require('../../src/analytics/roi-tracker');

      // Note: Due to module caching, these should be the same
      const instance1 = getTracker1();
      const instance2 = getTracker2();

      expect(instance1).toBe(instance2);
    });

    it('should accept config on first call', () => {
      jest.resetModules();
      mockFs.existsSync.mockReturnValue(false);

      const { getROITracker } = require('../../src/analytics/roi-tracker');
      const instance = getROITracker({ hourlyRate: 75 });

      expect(instance).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty task list', () => {
      const report = tracker.getReport(30);

      expect(report.metrics.tasksCompleted).toBe(0);
      expect(report.metrics.successRate).toBe(0);
      expect(report.metrics.productivityMultiplier).toBe(1);
      expect(report.metrics.averageTimeSavings).toBe(0);
    });

    it('should handle zero actual minutes', () => {
      tracker.recordTask({
        type: 'code_generation',
        description: 'Instant task',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 0,
        linesOfCode: 10,
        success: true,
      });

      const report = tracker.getReport(30);
      // Should not divide by zero
      expect(report.metrics.productivityMultiplier).toBe(1);
    });

    it('should handle save errors gracefully', () => {
      mockFs.writeJsonSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      // Should not throw
      expect(() => {
        tracker.recordTask({
          type: 'testing',
          description: 'Test',
          apiCost: 0.01,
          tokensUsed: 100,
          actualMinutes: 2,
          success: true,
        });
      }).not.toThrow();
    });

    it('should handle all task types', () => {
      const types: Array<'code_generation' | 'bug_fix' | 'refactoring' | 'documentation' | 'testing' | 'research' | 'other'> = [
        'code_generation', 'bug_fix', 'refactoring', 'documentation', 'testing', 'research', 'other'
      ];

      types.forEach(type => {
        tracker.recordTask({
          type,
          description: `Task of type ${type}`,
          apiCost: 0.01,
          tokensUsed: 100,
          actualMinutes: 2,
          success: true,
        });
      });

      const report = tracker.getReport(30);
      expect(report.metrics.tasksCompleted).toBe(7);
    });

    it('should calculate trends correctly with no weekly data', () => {
      tracker.recordTask({
        type: 'code_generation',
        description: 'Test',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 2,
        success: true,
      });

      const report = tracker.getReport(1); // Only 1 day

      expect(report.trends.weeklyProductivity.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle negative time savings gracefully', () => {
      // Case where actual time > estimated time
      tracker.recordTask({
        type: 'research', // Low estimated time
        description: 'Long research',
        apiCost: 0.50,
        tokensUsed: 10000,
        actualMinutes: 120, // Much longer than estimated
        success: true,
      });

      const report = tracker.getReport(30);
      // Should handle negative time savings
      expect(report.metrics.totalTimeSavedMinutes).toBeLessThan(0);
    });

    it('should calculate cost per hour saved correctly with zero hours', () => {
      tracker.recordTask({
        type: 'research',
        description: 'Test',
        apiCost: 0.01,
        tokensUsed: 100,
        actualMinutes: 20, // Same as estimated for research
        success: true,
      });

      const report = tracker.getReport(30);
      // When hours saved is 0 or negative, costPerHourSaved should be 0
      if (report.metrics.totalTimeSavedMinutes <= 0) {
        expect(report.metrics.costPerHourSaved).toBe(0);
      }
    });
  });
});
