/**
 * Pattern Matcher Tests
 */

import {
  matchPattern,
  matchApprovalPattern,
  findBestMatch,
  validatePattern,
  suggestPattern,
  extractBaseCommand,
  isPatternDangerous,
} from '../../../src/security/bash-allowlist/pattern-matcher.js';
import type { ApprovalPattern } from '../../../src/security/bash-allowlist/types.js';

describe('Pattern Matcher', () => {
  describe('matchPattern', () => {
    describe('exact matching', () => {
      it('should match exact strings', () => {
        expect(matchPattern('git status', 'git status', 'exact')).toBe(true);
      });

      it('should not match different strings', () => {
        expect(matchPattern('git status', 'git log', 'exact')).toBe(false);
      });

      it('should be case-sensitive for exact', () => {
        expect(matchPattern('Git Status', 'git status', 'exact')).toBe(false);
      });
    });

    describe('prefix matching', () => {
      it('should match commands starting with pattern', () => {
        expect(matchPattern('npm install lodash', 'npm install', 'prefix')).toBe(true);
      });

      it('should not match if pattern is not prefix', () => {
        expect(matchPattern('git status', 'npm', 'prefix')).toBe(false);
      });

      it('should match exact as prefix', () => {
        expect(matchPattern('ls', 'ls', 'prefix')).toBe(true);
      });
    });

    describe('glob matching', () => {
      it('should match * as any characters', () => {
        expect(matchPattern('npm install lodash', 'npm install *', 'glob')).toBe(true);
      });

      it('should match ** as any including spaces', () => {
        expect(matchPattern('npm run build --watch', 'npm run **', 'glob')).toBe(true);
      });

      it('should match ? as single character', () => {
        expect(matchPattern('ls -la', 'ls -l?', 'glob')).toBe(true);
      });

      it('should handle multiple wildcards', () => {
        expect(matchPattern('git commit -m "message"', 'git commit *', 'glob')).toBe(true);
      });

      it('should escape special regex characters', () => {
        expect(matchPattern('npm run test.js', 'npm run test.js', 'glob')).toBe(true);
      });
    });

    describe('regex matching', () => {
      it('should match regex patterns', () => {
        expect(matchPattern('npm install', '^npm.*', 'regex')).toBe(true);
      });

      it('should handle complex regex', () => {
        expect(matchPattern('git commit -m "fix: bug"', 'git commit.*', 'regex')).toBe(true);
      });

      it('should return false for invalid regex', () => {
        expect(matchPattern('test', '[invalid', 'regex')).toBe(false);
      });
    });
  });

  describe('matchApprovalPattern', () => {
    const createPattern = (overrides: Partial<ApprovalPattern> = {}): ApprovalPattern => ({
      id: 'test-id',
      pattern: 'npm *',
      type: 'glob',
      decision: 'allow',
      useCount: 0,
      createdAt: new Date(),
      enabled: true,
      source: 'user',
      ...overrides,
    });

    it('should match enabled patterns', () => {
      const pattern = createPattern();
      expect(matchApprovalPattern('npm install', pattern)).toBe(true);
    });

    it('should not match disabled patterns', () => {
      const pattern = createPattern({ enabled: false });
      expect(matchApprovalPattern('npm install', pattern)).toBe(false);
    });

    it('should not match expired patterns', () => {
      const pattern = createPattern({
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });
      expect(matchApprovalPattern('npm install', pattern)).toBe(false);
    });

    it('should match patterns with future expiration', () => {
      const pattern = createPattern({
        expiresAt: new Date(Date.now() + 100000), // Expires in the future
      });
      expect(matchApprovalPattern('npm install', pattern)).toBe(true);
    });
  });

  describe('findBestMatch', () => {
    const patterns: ApprovalPattern[] = [
      {
        id: '1',
        pattern: 'npm *',
        type: 'glob',
        decision: 'allow',
        useCount: 10,
        createdAt: new Date(),
        enabled: true,
        source: 'system',
      },
      {
        id: '2',
        pattern: 'npm install *',
        type: 'glob',
        decision: 'allow',
        useCount: 5,
        createdAt: new Date(),
        enabled: true,
        source: 'user',
      },
      {
        id: '3',
        pattern: 'npm install lodash',
        type: 'exact',
        decision: 'deny',
        useCount: 0,
        createdAt: new Date(),
        enabled: true,
        source: 'user',
      },
    ];

    it('should prefer deny patterns', () => {
      const match = findBestMatch('npm install lodash', patterns);
      expect(match?.decision).toBe('deny');
    });

    it('should prefer more specific patterns', () => {
      const match = findBestMatch('npm install express', patterns);
      expect(match?.pattern).toBe('npm install *');
    });

    it('should return undefined for no match', () => {
      const match = findBestMatch('git status', patterns);
      expect(match).toBeUndefined();
    });
  });

  describe('validatePattern', () => {
    it('should accept valid glob patterns', () => {
      expect(validatePattern('npm *', 'glob')).toEqual({ valid: true });
    });

    it('should reject empty patterns', () => {
      const result = validatePattern('', 'glob');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject overly broad patterns', () => {
      expect(validatePattern('*', 'glob').valid).toBe(false);
      expect(validatePattern('.*', 'regex').valid).toBe(false);
    });

    it('should validate regex syntax', () => {
      expect(validatePattern('^valid$', 'regex').valid).toBe(true);
      expect(validatePattern('[invalid', 'regex').valid).toBe(false);
    });
  });

  describe('suggestPattern', () => {
    it('should suggest exact match for single commands', () => {
      const suggestion = suggestPattern('ls');
      expect(suggestion.type).toBe('exact');
      expect(suggestion.pattern).toBe('ls');
    });

    it('should suggest glob for npm commands', () => {
      const suggestion = suggestPattern('npm install lodash');
      expect(suggestion.type).toBe('glob');
      expect(suggestion.pattern).toContain('npm install');
    });

    it('should suggest glob for git commands', () => {
      const suggestion = suggestPattern('git commit -m "test"');
      expect(suggestion.type).toBe('glob');
      expect(suggestion.pattern).toContain('git commit');
    });
  });

  describe('extractBaseCommand', () => {
    it('should extract first word', () => {
      expect(extractBaseCommand('npm install')).toBe('npm');
    });

    it('should handle single command', () => {
      expect(extractBaseCommand('ls')).toBe('ls');
    });

    it('should trim whitespace', () => {
      expect(extractBaseCommand('  git status  ')).toBe('git');
    });
  });

  describe('isPatternDangerous', () => {
    it('should detect dangerous patterns', () => {
      expect(isPatternDangerous('rm *', 'glob')).toBe(true);
      expect(isPatternDangerous('sudo *', 'glob')).toBe(true);
    });

    it('should accept safe patterns', () => {
      expect(isPatternDangerous('npm *', 'glob')).toBe(false);
      expect(isPatternDangerous('git *', 'glob')).toBe(false);
    });
  });
});
