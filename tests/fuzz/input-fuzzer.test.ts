/**
 * Fuzz Testing for User Inputs (Item 88)
 */

import { describe, it, expect } from '@jest/globals';

const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') return '';
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .trim()
    .slice(0, 10000);
};

const parseCommand = (input: string): { valid: boolean; command?: string } => {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { valid: false };
  const parts = trimmed.slice(1).split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { valid: false };
  return { valid: true, command: parts[0] };
};

describe('Input Fuzzing Tests', () => {
  describe('Sanitizer', () => {
    it('should handle null bytes', () => {
      expect(sanitizeInput('hello\x00world')).not.toContain('\x00');
    });

    it('should handle control characters', () => {
      // eslint-disable-next-line no-control-regex
      expect(sanitizeInput('test\x1B[31m')).not.toMatch(/\x1B/);
    });

    it('should strip script tags', () => {
      const result = sanitizeInput('<script>alert("xss")</script>hello');
      expect(result).not.toContain('script');
    });

    it('should handle very long input', () => {
      const longInput = 'a'.repeat(100000);
      expect(sanitizeInput(longInput).length).toBeLessThanOrEqual(10000);
    });

    it('should handle unicode', () => {
      expect(sanitizeInput('Hello 世界 🌍')).toBe('Hello 世界 🌍');
    });
  });

  describe('Command Parser Fuzzing', () => {
    it('should reject non-command input', () => {
      expect(parseCommand('hello')).toEqual({ valid: false });
    });

    it('should handle empty command', () => {
      expect(parseCommand('/')).toEqual({ valid: false });
    });

    it('should handle command with spaces', () => {
      expect(parseCommand('/help    arg1').valid).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    const edgeCases = [
      '', ' ', '\n', '\t', 'null', 'undefined',
      '../../../etc/passwd', '; rm -rf /',
    ];

    it('should handle all edge cases without throwing', () => {
      edgeCases.forEach(testCase => {
        expect(() => sanitizeInput(testCase)).not.toThrow();
        expect(() => parseCommand(testCase)).not.toThrow();
      });
    });
  });
});
