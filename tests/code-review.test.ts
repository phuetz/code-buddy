/**
 * Tests for Code Review Tool
 */

import { CodeReviewTool, getCodeReviewTool, resetCodeReviewTool } from '../src/tools/code-review';

// Mock dependencies
jest.mock('../src/grok/client', () => ({
  GrokClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            issues: [
              {
                severity: 'medium',
                category: 'best_practice',
                line: 10,
                message: 'Consider using const instead of let',
                suggestion: 'Change let to const',
                autoFixable: true,
              },
            ],
            passedChecks: ['No security issues'],
            score: 85,
          }),
        },
      }],
    }),
  })),
}));

jest.mock('../src/tools/bash', () => ({
  BashTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      success: true,
      output: 'mock output',
    }),
  })),
}));

describe('CodeReviewTool', () => {
  let reviewer: CodeReviewTool;

  beforeEach(() => {
    resetCodeReviewTool();
    reviewer = new CodeReviewTool();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(reviewer).toBeDefined();
      const config = reviewer.getConfig();
      expect(config.checkBugs).toBe(true);
      expect(config.checkSecurity).toBe(true);
    });

    it('should accept custom config', () => {
      const customReviewer = new CodeReviewTool({
        checkDocumentation: true,
        maxComplexity: 15,
      });

      const config = customReviewer.getConfig();
      expect(config.checkDocumentation).toBe(true);
      expect(config.maxComplexity).toBe(15);
    });
  });

  describe('formatResult', () => {
    it('should format review result for display', () => {
      const result = {
        files: ['test.ts'],
        issues: [
          {
            id: 'issue_1',
            severity: 'high' as const,
            category: 'security' as const,
            file: 'test.ts',
            line: 10,
            message: 'Potential XSS vulnerability',
            suggestion: 'Sanitize user input',
            fixAvailable: true,
          },
        ],
        summary: {
          totalIssues: 1,
          bySeverity: { high: 1 },
          byCategory: { security: 1 },
          passedChecks: [],
          score: 70,
        },
        timestamp: new Date(),
        duration: 1000,
      };

      const formatted = reviewer.formatResult(result);

      expect(formatted).toContain('AI CODE REVIEW REPORT');
      expect(formatted).toContain('Score:');
      expect(formatted).toContain('70/100');
      expect(formatted).toContain('Potential XSS vulnerability');
    });

    it('should show passed checks', () => {
      const result = {
        files: ['test.ts'],
        issues: [],
        summary: {
          totalIssues: 0,
          bySeverity: {},
          byCategory: {},
          passedChecks: ['No security issues', 'No bugs detected'],
          score: 100,
        },
        timestamp: new Date(),
        duration: 500,
      };

      const formatted = reviewer.formatResult(result);

      expect(formatted).toContain('Passed Checks');
      expect(formatted).toContain('No security issues');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      reviewer.updateConfig({ maxComplexity: 20 });

      const config = reviewer.getConfig();
      expect(config.maxComplexity).toBe(20);
    });
  });

  describe('events', () => {
    it('should emit review:start event', (done) => {
      reviewer.on('review:start', (data) => {
        expect(data.type).toBeDefined();
        done();
      });

      reviewer.reviewFiles(['nonexistent.ts']);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getCodeReviewTool();
      const instance2 = getCodeReviewTool();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getCodeReviewTool();
      resetCodeReviewTool();
      const instance2 = getCodeReviewTool();
      expect(instance1).not.toBe(instance2);
    });
  });
});
