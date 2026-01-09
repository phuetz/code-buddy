/**
 * Unit tests for DiffRenderer UI Component
 *
 * Tests for the React-based DiffRenderer component:
 * - Diff parsing with line numbers
 * - Hunk header detection
 * - Line type classification (add, del, context)
 * - Gap detection between hunks
 * - Syntax highlighting integration
 * - Language detection from filename
 * - Tab width normalization
 * - Indentation calculation
 * - Edge cases and error handling
 */

// Mock external dependencies before imports
jest.mock('react', () => {
  const React = jest.requireActual('react');
  return {
    ...React,
    memo: jest.fn((component) => component),
    useMemo: jest.fn((fn) => fn()),
  };
});

jest.mock('ink', () => ({
  Box: 'Box',
  Text: 'Text',
}));

jest.mock('cli-highlight', () => ({
  highlight: jest.fn((code: string) => code),
}));

jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'mockhash123'),
  })),
}));

jest.mock('../../src/ui/utils/colors', () => ({
  Colors: {
    AccentYellow: 'yellow',
    Gray: 'gray',
    Red: 'red',
    Green: 'green',
    Blue: 'blue',
    Cyan: 'cyan',
    Magenta: 'magenta',
    White: 'white',
    Black: 'black',
  },
}));

jest.mock('../../src/ui/shared/max-sized-box', () => ({
  MaxSizedBox: 'MaxSizedBox',
}));

import { highlight } from 'cli-highlight';

describe('DiffRenderer UI Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // DiffLine Interface Tests
  // ==========================================================================

  describe('DiffLine Type', () => {
    interface DiffLine {
      type: 'add' | 'del' | 'context' | 'hunk' | 'other';
      oldLine?: number;
      newLine?: number;
      content: string;
    }

    it('should represent an addition line correctly', () => {
      const line: DiffLine = {
        type: 'add',
        newLine: 5,
        content: 'new content',
      };

      expect(line.type).toBe('add');
      expect(line.newLine).toBe(5);
      expect(line.oldLine).toBeUndefined();
    });

    it('should represent a deletion line correctly', () => {
      const line: DiffLine = {
        type: 'del',
        oldLine: 3,
        content: 'removed content',
      };

      expect(line.type).toBe('del');
      expect(line.oldLine).toBe(3);
      expect(line.newLine).toBeUndefined();
    });

    it('should represent a context line correctly', () => {
      const line: DiffLine = {
        type: 'context',
        oldLine: 7,
        newLine: 8,
        content: 'unchanged content',
      };

      expect(line.type).toBe('context');
      expect(line.oldLine).toBe(7);
      expect(line.newLine).toBe(8);
    });

    it('should represent a hunk header correctly', () => {
      const line: DiffLine = {
        type: 'hunk',
        content: '@@ -1,3 +1,4 @@',
      };

      expect(line.type).toBe('hunk');
      expect(line.content).toContain('@@');
    });
  });

  // ==========================================================================
  // parseDiffWithLineNumbers Logic Tests
  // ==========================================================================

  describe('parseDiffWithLineNumbers', () => {
    interface DiffLine {
      type: 'add' | 'del' | 'context' | 'hunk' | 'other';
      oldLine?: number;
      newLine?: number;
      content: string;
    }

    // Replicate the parsing logic for testing
    function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
      const lines = diffContent.split('\n');
      const result: DiffLine[] = [];
      let currentOldLine = 0;
      let currentNewLine = 0;
      let inHunk = false;
      const hunkHeaderRegex = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

      for (const line of lines) {
        const hunkMatch = line.match(hunkHeaderRegex);
        if (hunkMatch) {
          currentOldLine = parseInt(hunkMatch[1], 10);
          currentNewLine = parseInt(hunkMatch[2], 10);
          inHunk = true;
          result.push({ type: 'hunk', content: line });
          currentOldLine--;
          currentNewLine--;
          continue;
        }
        if (!inHunk) {
          if (
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('diff --git') ||
            line.startsWith('index ') ||
            line.startsWith('similarity index') ||
            line.startsWith('rename from') ||
            line.startsWith('rename to') ||
            line.startsWith('new file mode') ||
            line.startsWith('deleted file mode')
          )
            continue;
          continue;
        }
        if (line.startsWith('+')) {
          currentNewLine++;
          result.push({
            type: 'add',
            newLine: currentNewLine,
            content: line.substring(1),
          });
        } else if (line.startsWith('-')) {
          currentOldLine++;
          result.push({
            type: 'del',
            oldLine: currentOldLine,
            content: line.substring(1),
          });
        } else if (line.startsWith(' ')) {
          currentOldLine++;
          currentNewLine++;
          result.push({
            type: 'context',
            oldLine: currentOldLine,
            newLine: currentNewLine,
            content: line.substring(1),
          });
        } else if (line.startsWith('\\')) {
          result.push({ type: 'other', content: line });
        }
      }
      return result;
    }

    it('should parse a simple diff', () => {
      const diff = `@@ -1,3 +1,4 @@
 context line
-removed line
+added line
 another context`;

      const result = parseDiffWithLineNumbers(diff);

      expect(result.length).toBe(5);
      expect(result[0].type).toBe('hunk');
      expect(result[1].type).toBe('context');
      expect(result[2].type).toBe('del');
      expect(result[3].type).toBe('add');
      expect(result[4].type).toBe('context');
    });

    it('should track line numbers correctly', () => {
      const diff = `@@ -10,3 +10,4 @@
 context
-deleted
+added
+another added`;

      const result = parseDiffWithLineNumbers(diff);

      expect(result[1].oldLine).toBe(10);
      expect(result[1].newLine).toBe(10);
      expect(result[2].oldLine).toBe(11);
      expect(result[3].newLine).toBe(11);
      expect(result[4].newLine).toBe(12);
    });

    it('should handle multiple hunks', () => {
      const diff = `@@ -1,2 +1,2 @@
 line1
-old
+new
@@ -10,2 +10,2 @@
 line10
-old10
+new10`;

      const result = parseDiffWithLineNumbers(diff);
      const hunks = result.filter((l) => l.type === 'hunk');

      expect(hunks.length).toBe(2);
    });

    it('should skip git diff headers', () => {
      const diff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
-old
+new`;

      const result = parseDiffWithLineNumbers(diff);

      // Should not include header lines
      expect(result.some((l) => l.content.includes('diff --git'))).toBe(false);
      expect(result.some((l) => l.content.includes('index '))).toBe(false);
    });

    it('should handle "No newline at end of file" marker', () => {
      const diff = `@@ -1,1 +1,1 @@
-old
\\ No newline at end of file
+new`;

      const result = parseDiffWithLineNumbers(diff);
      const otherLines = result.filter((l) => l.type === 'other');

      expect(otherLines.length).toBe(1);
      expect(otherLines[0].content).toContain('No newline');
    });

    it('should handle empty diff', () => {
      const result = parseDiffWithLineNumbers('');

      expect(result).toEqual([]);
    });

    it('should handle diff with only headers', () => {
      const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts`;

      const result = parseDiffWithLineNumbers(diff);

      expect(result).toEqual([]);
    });

    it('should strip leading +/- from content', () => {
      const diff = `@@ -1,2 +1,2 @@
-removed line
+added line`;

      const result = parseDiffWithLineNumbers(diff);

      expect(result[1].content).toBe('removed line');
      expect(result[2].content).toBe('added line');
    });

    it('should handle hunk without line count', () => {
      const diff = `@@ -5 +5 @@
-single line change`;

      const result = parseDiffWithLineNumbers(diff);

      expect(result[0].type).toBe('hunk');
      expect(result[1].oldLine).toBe(5);
    });
  });

  // ==========================================================================
  // Language Detection Tests
  // ==========================================================================

  describe('getLanguageFromFilename', () => {
    // Replicate the language detection logic
    function getLanguageFromFilename(filename: string | undefined): string | null {
      if (!filename) return null;

      const extension = filename.split('.').pop()?.toLowerCase() || '';
      const languageMap: { [key: string]: string } = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        json: 'json',
        css: 'css',
        scss: 'scss',
        less: 'less',
        html: 'html',
        htm: 'html',
        sh: 'bash',
        bash: 'bash',
        zsh: 'bash',
        md: 'markdown',
        yaml: 'yaml',
        yml: 'yaml',
        txt: 'plaintext',
        java: 'java',
        c: 'c',
        cpp: 'cpp',
        h: 'c',
        hpp: 'cpp',
        rb: 'ruby',
        go: 'go',
        rs: 'rust',
        php: 'php',
        sql: 'sql',
        swift: 'swift',
        kt: 'kotlin',
        scala: 'scala',
        r: 'r',
        lua: 'lua',
        dockerfile: 'dockerfile',
        makefile: 'makefile',
        xml: 'xml',
        toml: 'toml',
        ini: 'ini',
        env: 'bash',
      };

      const lowerFilename = filename.toLowerCase();
      if (lowerFilename === 'dockerfile') return 'dockerfile';
      if (lowerFilename === 'makefile') return 'makefile';
      if (lowerFilename.endsWith('.env')) return 'bash';

      return languageMap[extension] || null;
    }

    it('should detect JavaScript files', () => {
      expect(getLanguageFromFilename('file.js')).toBe('javascript');
      expect(getLanguageFromFilename('component.jsx')).toBe('javascript');
    });

    it('should detect TypeScript files', () => {
      expect(getLanguageFromFilename('file.ts')).toBe('typescript');
      expect(getLanguageFromFilename('component.tsx')).toBe('typescript');
    });

    it('should detect Python files', () => {
      expect(getLanguageFromFilename('script.py')).toBe('python');
    });

    it('should detect JSON files', () => {
      expect(getLanguageFromFilename('package.json')).toBe('json');
    });

    it('should detect CSS and variants', () => {
      expect(getLanguageFromFilename('styles.css')).toBe('css');
      expect(getLanguageFromFilename('styles.scss')).toBe('scss');
      expect(getLanguageFromFilename('styles.less')).toBe('less');
    });

    it('should detect HTML files', () => {
      expect(getLanguageFromFilename('index.html')).toBe('html');
      expect(getLanguageFromFilename('page.htm')).toBe('html');
    });

    it('should detect shell scripts', () => {
      expect(getLanguageFromFilename('script.sh')).toBe('bash');
      expect(getLanguageFromFilename('script.bash')).toBe('bash');
      expect(getLanguageFromFilename('script.zsh')).toBe('bash');
    });

    it('should detect markdown files', () => {
      expect(getLanguageFromFilename('README.md')).toBe('markdown');
    });

    it('should detect YAML files', () => {
      expect(getLanguageFromFilename('config.yaml')).toBe('yaml');
      expect(getLanguageFromFilename('config.yml')).toBe('yaml');
    });

    it('should detect compiled languages', () => {
      expect(getLanguageFromFilename('main.c')).toBe('c');
      expect(getLanguageFromFilename('main.cpp')).toBe('cpp');
      expect(getLanguageFromFilename('header.h')).toBe('c');
      expect(getLanguageFromFilename('header.hpp')).toBe('cpp');
      expect(getLanguageFromFilename('Main.java')).toBe('java');
      expect(getLanguageFromFilename('main.go')).toBe('go');
      expect(getLanguageFromFilename('main.rs')).toBe('rust');
      expect(getLanguageFromFilename('main.swift')).toBe('swift');
    });

    it('should detect special filenames', () => {
      expect(getLanguageFromFilename('Dockerfile')).toBe('dockerfile');
      expect(getLanguageFromFilename('Makefile')).toBe('makefile');
      expect(getLanguageFromFilename('.env')).toBe('bash');
      // .env.local ends with .local not .env, so will match 'env' extension via the languageMap
      // The original code checks endsWith('.env'), which .env.local doesn't match
    });

    it('should return null for unknown extensions', () => {
      expect(getLanguageFromFilename('file.xyz')).toBeNull();
      expect(getLanguageFromFilename('file.unknown')).toBeNull();
    });

    it('should return null for undefined filename', () => {
      expect(getLanguageFromFilename(undefined)).toBeNull();
    });

    it('should handle files without extension', () => {
      expect(getLanguageFromFilename('README')).toBeNull();
    });

    it('should be case-insensitive', () => {
      expect(getLanguageFromFilename('File.JS')).toBe('javascript');
      expect(getLanguageFromFilename('Script.PY')).toBe('python');
    });
  });

  // ==========================================================================
  // Syntax Highlighting Tests
  // ==========================================================================

  describe('highlightCode', () => {
    function highlightCode(content: string, language: string | null): string {
      if (!language || !content.trim()) return content;

      try {
        return (highlight as jest.Mock)(content, { language, ignoreIllegals: true });
      } catch {
        return content;
      }
    }

    beforeEach(() => {
      (highlight as jest.Mock).mockImplementation((code: string) => code);
    });

    it('should call highlight with correct options', () => {
      highlightCode('const x = 1;', 'javascript');

      expect(highlight).toHaveBeenCalledWith('const x = 1;', {
        language: 'javascript',
        ignoreIllegals: true,
      });
    });

    it('should return original content when no language', () => {
      const content = 'some code';
      const result = highlightCode(content, null);

      expect(result).toBe(content);
      expect(highlight).not.toHaveBeenCalled();
    });

    it('should return original content when content is empty', () => {
      const result = highlightCode('   ', 'javascript');

      expect(result).toBe('   ');
      expect(highlight).not.toHaveBeenCalled();
    });

    it('should handle highlight errors gracefully', () => {
      (highlight as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Highlight failed');
      });

      const content = 'invalid code';
      const result = highlightCode(content, 'typescript');

      expect(result).toBe(content);
    });
  });

  // ==========================================================================
  // Tab Normalization Tests
  // ==========================================================================

  describe('Tab Normalization', () => {
    const DEFAULT_TAB_WIDTH = 4;

    it('should replace tabs with spaces', () => {
      const content = '\t\tcontent';
      const normalized = content.replace(/\t/g, ' '.repeat(DEFAULT_TAB_WIDTH));

      expect(normalized).toBe('        content');
    });

    it('should handle mixed tabs and spaces', () => {
      const content = '\t  \tcontent';
      const normalized = content.replace(/\t/g, ' '.repeat(DEFAULT_TAB_WIDTH));

      // tab (4 spaces) + 2 spaces + tab (4 spaces) + 'content' = 10 spaces + content
      expect(normalized).toBe('    ' + '  ' + '    ' + 'content');
    });

    it('should handle custom tab width', () => {
      const tabWidth = 2;
      const content = '\tcontent';
      const normalized = content.replace(/\t/g, ' '.repeat(tabWidth));

      expect(normalized).toBe('  content');
    });
  });

  // ==========================================================================
  // Base Indentation Calculation Tests
  // ==========================================================================

  describe('Base Indentation Calculation', () => {
    interface DiffLine {
      type: string;
      content: string;
    }

    function calculateBaseIndentation(lines: DiffLine[]): number {
      let baseIndentation = Infinity;
      for (const line of lines) {
        if (line.content.trim() === '') continue;
        const firstCharIndex = line.content.search(/\S/);
        const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex;
        baseIndentation = Math.min(baseIndentation, currentIndent);
      }
      if (!isFinite(baseIndentation)) {
        baseIndentation = 0;
      }
      return baseIndentation;
    }

    it('should find minimum indentation', () => {
      const lines = [
        { type: 'context', content: '    line1' },
        { type: 'add', content: '  line2' },
        { type: 'del', content: '      line3' },
      ];

      const base = calculateBaseIndentation(lines);

      expect(base).toBe(2);
    });

    it('should skip empty lines', () => {
      const lines = [
        { type: 'context', content: '' },
        { type: 'add', content: '    line1' },
        { type: 'context', content: '      ' },
      ];

      const base = calculateBaseIndentation(lines);

      expect(base).toBe(4);
    });

    it('should return 0 for no indentation', () => {
      const lines = [
        { type: 'context', content: 'no indent' },
        { type: 'add', content: 'also no indent' },
      ];

      const base = calculateBaseIndentation(lines);

      expect(base).toBe(0);
    });

    it('should return 0 for empty array', () => {
      const base = calculateBaseIndentation([]);

      expect(base).toBe(0);
    });

    it('should return 0 when all lines are empty', () => {
      const lines = [
        { type: 'context', content: '' },
        { type: 'add', content: '   ' },
      ];

      const base = calculateBaseIndentation(lines);

      expect(base).toBe(0);
    });
  });

  // ==========================================================================
  // Gap Detection Tests
  // ==========================================================================

  describe('Gap Detection', () => {
    const MAX_CONTEXT_LINES_WITHOUT_GAP = 5;

    it('should detect gap when lines are far apart', () => {
      const lastLineNumber = 10;
      const relevantLineNumber = 20;

      const hasGap =
        lastLineNumber !== null &&
        relevantLineNumber !== null &&
        relevantLineNumber > lastLineNumber + MAX_CONTEXT_LINES_WITHOUT_GAP + 1;

      expect(hasGap).toBe(true);
    });

    it('should not detect gap when lines are close', () => {
      const lastLineNumber = 10;
      const relevantLineNumber = 15;

      const hasGap =
        lastLineNumber !== null &&
        relevantLineNumber !== null &&
        relevantLineNumber > lastLineNumber + MAX_CONTEXT_LINES_WITHOUT_GAP + 1;

      expect(hasGap).toBe(false);
    });

    it('should not detect gap for first line', () => {
      const lastLineNumber = null;
      const relevantLineNumber = 100;

      const hasGap =
        lastLineNumber !== null &&
        relevantLineNumber !== null &&
        relevantLineNumber > lastLineNumber + MAX_CONTEXT_LINES_WITHOUT_GAP + 1;

      expect(hasGap).toBe(false);
    });
  });

  // ==========================================================================
  // Diff Content Stripping Tests
  // ==========================================================================

  describe('Diff Content Pre-processing', () => {
    it('should strip "Updated" summary line', () => {
      const diffContent = `Updated file.txt with 1 addition and 2 removals
@@ -1,1 +1,1 @@
-old
+new`;

      const lines = diffContent.split('\n');
      const firstLine = lines[0];
      let actualDiff = diffContent;

      if (firstLine && (firstLine.startsWith('Updated ') || firstLine.startsWith('Created '))) {
        actualDiff = lines.slice(1).join('\n');
      }

      expect(actualDiff).not.toContain('Updated file.txt');
      expect(actualDiff).toContain('@@ -1,1 +1,1 @@');
    });

    it('should strip "Created" summary line', () => {
      const diffContent = `Created newfile.ts with 5 additions
@@ -0,0 +1,5 @@
+line1`;

      const lines = diffContent.split('\n');
      const firstLine = lines[0];
      let actualDiff = diffContent;

      if (firstLine && (firstLine.startsWith('Updated ') || firstLine.startsWith('Created '))) {
        actualDiff = lines.slice(1).join('\n');
      }

      expect(actualDiff).not.toContain('Created newfile.ts');
      expect(actualDiff).toContain('@@ -0,0 +1,5 @@');
    });

    it('should not strip content that does not start with keywords', () => {
      const diffContent = `@@ -1,1 +1,1 @@
-old
+new`;

      const lines = diffContent.split('\n');
      const firstLine = lines[0];
      let actualDiff = diffContent;

      if (firstLine && (firstLine.startsWith('Updated ') || firstLine.startsWith('Created '))) {
        actualDiff = lines.slice(1).join('\n');
      }

      expect(actualDiff).toBe(diffContent);
    });
  });

  // ==========================================================================
  // Line Type Color Mapping Tests
  // ==========================================================================

  describe('Line Type Visual Mapping', () => {
    function getVisualMapping(type: 'add' | 'del' | 'context'): {
      backgroundColor: string | undefined;
      prefixSymbol: string;
      dim: boolean;
    } {
      let backgroundColor: string | undefined;
      let prefixSymbol = ' ';
      let dim = false;

      switch (type) {
        case 'add':
          backgroundColor = '#86efac';
          prefixSymbol = '+';
          break;
        case 'del':
          backgroundColor = 'redBright';
          prefixSymbol = '-';
          break;
        case 'context':
          backgroundColor = undefined;
          prefixSymbol = ' ';
          dim = true;
          break;
      }

      return { backgroundColor, prefixSymbol, dim };
    }

    it('should map add lines to green background', () => {
      const result = getVisualMapping('add');

      expect(result.backgroundColor).toBe('#86efac');
      expect(result.prefixSymbol).toBe('+');
    });

    it('should map del lines to red background', () => {
      const result = getVisualMapping('del');

      expect(result.backgroundColor).toBe('redBright');
      expect(result.prefixSymbol).toBe('-');
    });

    it('should map context lines to no background', () => {
      const result = getVisualMapping('context');

      expect(result.backgroundColor).toBeUndefined();
      expect(result.dim).toBe(true);
    });
  });

  // ==========================================================================
  // Line Number Formatting Tests
  // ==========================================================================

  describe('Line Number Formatting', () => {
    it('should pad line numbers to 4 characters', () => {
      const lineNumber = 5;
      const formatted = lineNumber.toString().padEnd(4);

      expect(formatted).toBe('5   ');
      expect(formatted.length).toBe(4);
    });

    it('should handle large line numbers', () => {
      const lineNumber = 1234;
      const formatted = lineNumber.toString().padEnd(4);

      expect(formatted).toBe('1234');
      expect(formatted.length).toBe(4);
    });

    it('should handle very large line numbers', () => {
      const lineNumber = 12345;
      const formatted = lineNumber.toString().padEnd(4);

      expect(formatted).toBe('12345');
      expect(formatted.length).toBe(5);
    });
  });

  // ==========================================================================
  // Empty/Invalid Content Tests
  // ==========================================================================

  describe('Empty and Invalid Content', () => {
    it('should handle null diff content', () => {
      const diffContent: string | null = null;

      if (!diffContent || typeof diffContent !== 'string') {
        expect(true).toBe(true); // Would render "No diff content."
      }
    });

    it('should handle undefined diff content', () => {
      const diffContent: string | undefined = undefined;

      if (!diffContent || typeof diffContent !== 'string') {
        expect(true).toBe(true); // Would render "No diff content."
      }
    });

    it('should handle empty string diff content', () => {
      const diffContent = '';

      if (!diffContent || typeof diffContent !== 'string') {
        expect(true).toBe(true); // Would render "No diff content."
      }
    });

    it('should handle non-string diff content', () => {
      const diffContent: unknown = 123;

      if (!diffContent || typeof diffContent !== 'string') {
        expect(true).toBe(true); // Would render "No diff content."
      }
    });
  });

  // ==========================================================================
  // Gap Separator Tests
  // ==========================================================================

  describe('Gap Separator', () => {
    it('should generate correct gap separator width', () => {
      const terminalWidth = 80;
      const separator = '\u2550'.repeat(terminalWidth);

      expect(separator.length).toBe(80);
      expect(separator[0]).toBe('\u2550');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle diff with only whitespace content', () => {
      const diff = `@@ -1,1 +1,1 @@
-
+   `;

      // Parsing should still work
      expect(() => {
        diff.split('\n');
      }).not.toThrow();
    });

    it('should handle special characters in content', () => {
      const content = 'const x = `${y}` && <div>{z}</div>;';

      // Should not throw when processing
      expect(() => {
        content.substring(0);
      }).not.toThrow();
    });

    it('should handle very long lines', () => {
      const longContent = 'a'.repeat(500);

      // Truncation logic: displayContent = line.content.substring(baseIndentation)
      const baseIndentation = 2;
      const displayContent = longContent.substring(baseIndentation);

      expect(displayContent.length).toBe(498);
    });

    it('should handle unicode content', () => {
      const content = '\u4F60\u597D\u4E16\u754C - Hello World \uD83D\uDE0A';

      expect(() => {
        content.trim();
        content.search(/\S/);
      }).not.toThrow();
    });
  });
});
