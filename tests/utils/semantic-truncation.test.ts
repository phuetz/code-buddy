import {
  headTailTruncate,
  needsTruncation,
  semanticTruncate,
} from '../../src/utils/head-tail-truncation.js';

describe('Semantic Truncation', () => {
  const makeLongOutput = (lines: number, includeErrors = false) => {
    const result: string[] = [];
    for (let i = 0; i < lines; i++) {
      if (includeErrors && i === Math.floor(lines / 2)) {
        result.push('Error: something went wrong');
        result.push('  at Function.execute (/app/src/index.ts:42:10)');
        result.push('TypeError: Cannot read property of undefined');
      }
      result.push(`line ${i + 1}: normal output content here`);
    }
    return result.join('\n');
  };

  describe('semanticTruncate', () => {
    it('should not truncate small output', () => {
      const text = 'line 1\nline 2\nline 3';
      const result = semanticTruncate(text);
      expect(result.truncated).toBe(false);
      expect(result.output).toBe(text);
    });

    it('should preserve error lines in middle', () => {
      const text = makeLongOutput(500, true);
      const result = semanticTruncate(text, {
        headLines: 10,
        tailLines: 10,
        preserveErrors: true,
      });
      expect(result.truncated).toBe(true);
      expect(result.output).toContain('Error: something went wrong');
      expect(result.output).toContain('TypeError');
      expect(result.output).toContain('important lines preserved');
    });

    it('should include omitted lines count', () => {
      const text = makeLongOutput(500);
      const result = semanticTruncate(text, {
        headLines: 10,
        tailLines: 10,
      });
      expect(result.output).toContain('lines omitted');
      expect(result.omittedLines).toBeGreaterThan(0);
    });

    it('should note incomplete JSON structure', () => {
      const jsonLines = ['{\n  "data": ['];
      for (let i = 0; i < 500; i++) {
        jsonLines.push(`    {"id": ${i}},`);
      }
      jsonLines.push('  ]\n}');
      const text = jsonLines.join('\n');

      const result = semanticTruncate(text, {
        headLines: 10,
        tailLines: 10,
        preserveJson: true,
      });
      expect(result.truncated).toBe(true);
    });

    it('should respect custom preserve patterns', () => {
      const lines: string[] = [];
      for (let i = 0; i < 300; i++) {
        if (i === 150) {
          lines.push('CUSTOM_MARKER: important data here');
        }
        lines.push(`line ${i}`);
      }
      const text = lines.join('\n');

      const result = semanticTruncate(text, {
        headLines: 10,
        tailLines: 10,
        preservePatterns: [/CUSTOM_MARKER/],
      });
      expect(result.output).toContain('CUSTOM_MARKER');
    });
  });

  describe('headTailTruncate', () => {
    it('should keep head and tail', () => {
      const text = makeLongOutput(500);
      const result = headTailTruncate(text, { headLines: 5, tailLines: 5 });
      expect(result.truncated).toBe(true);
      expect(result.output).toContain('line 1');
      expect(result.output).toContain('lines omitted');
    });
  });

  describe('needsTruncation', () => {
    it('should return false for small text', () => {
      expect(needsTruncation('hello\nworld')).toBe(false);
    });

    it('should return true for large text', () => {
      expect(needsTruncation(makeLongOutput(500))).toBe(true);
    });
  });
});
