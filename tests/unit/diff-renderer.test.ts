/**
 * Unit tests for DiffRenderer Module
 *
 * Comprehensive tests covering:
 * - Plain mode rendering
 * - Fancy mode rendering with colors
 * - Hunk rendering
 * - Line type handling (add, delete, context)
 * - Stats display
 * - Title and emoji handling
 * - Syntax highlighting for context lines
 * - Edge cases and error handling
 */

// Mock cli-highlight before imports
const mockHighlight = jest.fn().mockImplementation((code: string) => code);

jest.mock('cli-highlight', () => ({
  highlight: mockHighlight,
}));

import { diffRenderer } from '../../src/renderers/diff-renderer';
import { DiffData, DiffHunk, DiffLine, RenderContext } from '../../src/renderers/types';

describe('DiffRenderer Module', () => {
  // ==========================================================================
  // Test Data Fixtures
  // ==========================================================================

  const createRenderContext = (overrides: Partial<RenderContext> = {}): RenderContext => ({
    mode: 'fancy',
    color: true,
    emoji: true,
    width: 120,
    height: 24,
    piped: false,
    ...overrides,
  });

  const createDiffLine = (overrides: Partial<DiffLine> = {}): DiffLine => ({
    type: 'context',
    content: 'line content',
    ...overrides,
  });

  const createDiffHunk = (overrides: Partial<DiffHunk> = {}): DiffHunk => ({
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 4,
    lines: [
      createDiffLine({ type: 'context', content: 'unchanged line', oldLineNumber: 1, newLineNumber: 1 }),
      createDiffLine({ type: 'delete', content: 'removed line', oldLineNumber: 2 }),
      createDiffLine({ type: 'add', content: 'added line', newLineNumber: 2 }),
      createDiffLine({ type: 'add', content: 'another added line', newLineNumber: 3 }),
      createDiffLine({ type: 'context', content: 'final line', oldLineNumber: 3, newLineNumber: 4 }),
    ],
    ...overrides,
  });

  const createDiffData = (overrides: Partial<DiffData> = {}): DiffData => ({
    type: 'diff',
    filePath: 'src/test-file.ts',
    hunks: [createDiffHunk()],
    stats: { additions: 2, deletions: 1 },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Renderer Interface Tests
  // ==========================================================================

  describe('Renderer Interface', () => {
    it('should have correct id', () => {
      expect(diffRenderer.id).toBe('diff');
    });

    it('should have correct name', () => {
      expect(diffRenderer.name).toBe('Diff Renderer');
    });

    it('should have priority of 10', () => {
      expect(diffRenderer.priority).toBe(10);
    });
  });

  // ==========================================================================
  // canRender Tests
  // ==========================================================================

  describe('canRender', () => {
    it('should return true for valid diff data', () => {
      const data = createDiffData();

      expect(diffRenderer.canRender(data)).toBe(true);
    });

    it('should return false for null', () => {
      expect(diffRenderer.canRender(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(diffRenderer.canRender(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(diffRenderer.canRender('string')).toBe(false);
      expect(diffRenderer.canRender(123)).toBe(false);
      expect(diffRenderer.canRender(true)).toBe(false);
    });

    it('should return false for object without type', () => {
      expect(diffRenderer.canRender({ filePath: 'test.ts' })).toBe(false);
    });

    it('should return false for wrong type', () => {
      expect(diffRenderer.canRender({ type: 'table' })).toBe(false);
      expect(diffRenderer.canRender({ type: 'test-results' })).toBe(false);
    });

    it('should return true for minimal diff data', () => {
      const minimalData: DiffData = {
        type: 'diff',
        filePath: 'test.ts',
      };

      expect(diffRenderer.canRender(minimalData)).toBe(true);
    });
  });

  // ==========================================================================
  // Plain Mode Rendering Tests
  // ==========================================================================

  describe('Plain Mode Rendering', () => {
    it('should render basic diff in plain mode', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('Diff: src/test-file.ts');
      expect(result).toContain('+2 -1');
      expect(result).toContain('='.repeat(60));
    });

    it('should render hunk header in plain mode', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('@@ -1,3 +1,4 @@');
    });

    it('should render add lines with + prefix', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('+ added line');
    });

    it('should render delete lines with - prefix', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('- removed line');
    });

    it('should render context lines with space prefix', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('  unchanged line');
    });

    it('should show line numbers for add lines', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      // Line number should be padded to 4 chars
      expect(result).toMatch(/\s+2\s+\+ added line/);
    });

    it('should show line numbers for delete lines', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toMatch(/\s+2\s+- removed line/);
    });

    it('should handle diff without stats', () => {
      const data = createDiffData({ stats: undefined });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      // Should not contain stats line like '+2 -1'
      expect(result).not.toMatch(/^\+\d+ -\d+$/m);
      expect(result).toContain('Diff: src/test-file.ts');
    });

    it('should handle diff without hunks using old/new content', () => {
      const data = createDiffData({
        hunks: undefined,
        oldContent: 'old content',
        newContent: 'new content',
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('--- Old');
      expect(result).toContain('old content');
      expect(result).toContain('+++ New');
      expect(result).toContain('new content');
    });

    it('should show (empty) for empty old content', () => {
      const data = createDiffData({
        hunks: undefined,
        oldContent: '',
        newContent: 'new content',
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('(empty)');
    });

    it('should show (empty) for empty new content', () => {
      const data = createDiffData({
        hunks: undefined,
        oldContent: 'old content',
        newContent: '',
      });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('(empty)');
    });
  });

  // ==========================================================================
  // Fancy Mode Rendering Tests
  // ==========================================================================

  describe('Fancy Mode Rendering', () => {
    it('should render diff in fancy mode with box characters', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('\u250C'); // Top-left corner
      expect(result).toContain('\u2514'); // Bottom-left corner
      expect(result).toContain('\u2500'); // Horizontal line
      expect(result).toContain('\u2502'); // Vertical line
    });

    it('should include emoji in title when emoji is enabled', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', emoji: true });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('\uD83D\uDCDD'); // Memo emoji
    });

    it('should not include emoji when disabled', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', emoji: false });

      const result = diffRenderer.render(data, ctx);

      expect(result).not.toContain('\uD83D\uDCDD');
      expect(result).toContain('DIFF');
    });

    it('should use color codes when color is enabled', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('\x1b[32m'); // Green for additions
      expect(result).toContain('\x1b[31m'); // Red for deletions
      expect(result).toContain('\x1b[0m');  // Reset
    });

    it('should not use color codes when color is disabled', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: false });

      const result = diffRenderer.render(data, ctx);

      expect(result).not.toContain('\x1b[');
    });

    it('should render hunk header in cyan', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('\x1b[36m'); // Cyan
      expect(result).toContain('@@ -1,3 +1,4 @@');
    });

    it('should render additions with green background', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('\x1b[42m\x1b[30m'); // Green bg, black text
    });

    it('should render deletions with red background', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('\x1b[41m\x1b[30m'); // Red bg, black text
    });

    it('should render stats line with colors', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('+2');
      expect(result).toContain('-1');
    });

    it('should limit width to 120 characters', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', width: 200 });

      const result = diffRenderer.render(data, ctx);
      const lines = result.split('\n');

      // Check that box width is limited
      lines.forEach(line => {
        // Remove ANSI codes for length check
        // eslint-disable-next-line no-control-regex
        const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
        // Lines should not exceed 120 chars significantly
        expect(cleanLine.length).toBeLessThanOrEqual(120 + 5); // Some flexibility
      });
    });

    it('should handle narrow terminal width', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', width: 60 });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('src/test-file.ts');
    });

    it('should separate multiple hunks with empty line', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2 }),
          createDiffHunk({ oldStart: 10, oldLines: 2, newStart: 10, newLines: 2 }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('@@ -1,2 +1,2 @@');
      expect(result).toContain('@@ -10,2 +10,2 @@');
    });
  });

  // ==========================================================================
  // Fallback Content Rendering Tests
  // ==========================================================================

  describe('Fallback Content Rendering', () => {
    it('should render old/new content in fancy mode when no hunks', () => {
      const data = createDiffData({
        hunks: undefined,
        oldContent: 'original text',
        newContent: 'modified text',
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('--- Old');
      expect(result).toContain('+++ New');
    });

    it('should truncate long content lines in fancy mode', () => {
      const longContent = 'a'.repeat(200);
      const data = createDiffData({
        hunks: undefined,
        oldContent: longContent,
        newContent: 'short',
      });
      const ctx = createRenderContext({ mode: 'fancy', width: 80 });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('...');
    });

    it('should limit old/new content to 5 lines', () => {
      const multilineContent = Array(10).fill('line').join('\n');
      const data = createDiffData({
        hunks: undefined,
        oldContent: multilineContent,
        newContent: 'new',
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      // Should only show first 5 lines
      const occurrences = (result.match(/line/g) || []).length;
      expect(occurrences).toBeLessThanOrEqual(6); // 5 lines + possible header reference
    });

    it('should show message when no diff details available', () => {
      const data = createDiffData({
        hunks: undefined,
        oldContent: undefined,
        newContent: undefined,
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('No detailed diff available');
    });

    it('should show empty hunks array as no diff available', () => {
      const data = createDiffData({
        hunks: [],
        oldContent: undefined,
        newContent: undefined,
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('No detailed diff available');
    });
  });

  // ==========================================================================
  // Syntax Highlighting Tests
  // ==========================================================================

  describe('Syntax Highlighting', () => {
    it('should highlight TypeScript files', () => {
      const data = createDiffData({ filePath: 'src/file.ts' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'typescript' })
      );
    });

    it('should highlight JavaScript files', () => {
      const data = createDiffData({ filePath: 'src/file.js' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'javascript' })
      );
    });

    it('should highlight JSX files', () => {
      const data = createDiffData({ filePath: 'src/Component.jsx' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'javascript' })
      );
    });

    it('should highlight TSX files', () => {
      const data = createDiffData({ filePath: 'src/Component.tsx' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'typescript' })
      );
    });

    it('should highlight Python files', () => {
      const data = createDiffData({ filePath: 'script.py' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'python' })
      );
    });

    it('should highlight JSON files', () => {
      const data = createDiffData({ filePath: 'config.json' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'json' })
      );
    });

    it('should highlight CSS files', () => {
      const data = createDiffData({ filePath: 'styles.css' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'css' })
      );
    });

    it('should highlight HTML files', () => {
      const data = createDiffData({ filePath: 'index.html' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'html' })
      );
    });

    it('should highlight Bash files', () => {
      const data = createDiffData({ filePath: 'script.sh' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'bash' })
      );
    });

    it('should highlight Markdown files', () => {
      const data = createDiffData({ filePath: 'README.md' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'markdown' })
      );
    });

    it('should highlight YAML files', () => {
      const data = createDiffData({ filePath: 'config.yaml' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'yaml' })
      );
    });

    it('should highlight YML files', () => {
      const data = createDiffData({ filePath: 'config.yml' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'yaml' })
      );
    });

    it('should highlight Go files', () => {
      const data = createDiffData({ filePath: 'main.go' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'go' })
      );
    });

    it('should highlight Rust files', () => {
      const data = createDiffData({ filePath: 'main.rs' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ language: 'rust' })
      );
    });

    it('should not highlight add lines', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'add', content: 'new code', newLineNumber: 1 }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      jest.clearAllMocks();
      diffRenderer.render(data, ctx);

      // Highlight should not be called for add lines
      expect(mockHighlight).not.toHaveBeenCalled();
    });

    it('should not highlight delete lines', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'delete', content: 'old code', oldLineNumber: 1 }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      jest.clearAllMocks();
      diffRenderer.render(data, ctx);

      expect(mockHighlight).not.toHaveBeenCalled();
    });

    it('should only highlight context lines', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'context', content: 'context code', newLineNumber: 1 }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      jest.clearAllMocks();
      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalled();
    });

    it('should skip highlighting when color is disabled', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: false });

      jest.clearAllMocks();
      diffRenderer.render(data, ctx);

      expect(mockHighlight).not.toHaveBeenCalled();
    });

    it('should skip highlighting for unknown extensions', () => {
      const data = createDiffData({ filePath: 'file.xyz' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      jest.clearAllMocks();
      diffRenderer.render(data, ctx);

      expect(mockHighlight).not.toHaveBeenCalled();
    });

    it('should handle highlighting errors gracefully', () => {
      mockHighlight.mockImplementationOnce(() => {
        throw new Error('Highlighting failed');
      });

      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      expect(() => diffRenderer.render(data, ctx)).not.toThrow();
    });

    it('should pass ignoreIllegals option to highlight', () => {
      const data = createDiffData();
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      diffRenderer.render(data, ctx);

      expect(mockHighlight).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ ignoreIllegals: true })
      );
    });
  });

  // ==========================================================================
  // Line Number Tests
  // ==========================================================================

  describe('Line Numbers', () => {
    it('should use newLineNumber for add lines', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'add', content: 'new', newLineNumber: 42 }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('42');
    });

    it('should use oldLineNumber for delete lines', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'delete', content: 'old', oldLineNumber: 37 }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('37');
    });

    it('should use newLineNumber for context lines', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'context', content: 'ctx', newLineNumber: 99 }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('99');
    });

    it('should handle missing line numbers', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'add', content: 'no line num' }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => diffRenderer.render(data, ctx)).not.toThrow();
    });
  });

  // ==========================================================================
  // Content Truncation Tests
  // ==========================================================================

  describe('Content Truncation', () => {
    it('should truncate long lines in fancy mode', () => {
      const longContent = 'x'.repeat(200);
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'context', content: longContent, newLineNumber: 1 }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy', width: 80 });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('...');
    });

    it('should handle empty content', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({ type: 'context', content: '', newLineNumber: 1 }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => diffRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle undefined content', () => {
      const line = createDiffLine({ type: 'context', newLineNumber: 1 });
      // @ts-expect-error Testing undefined content
      line.content = undefined;

      const data = createDiffData({
        hunks: [createDiffHunk({ lines: [line] })],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => diffRenderer.render(data, ctx)).not.toThrow();
    });
  });

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty hunks array', () => {
      const data = createDiffData({ hunks: [] });
      const ctx = createRenderContext({ mode: 'plain' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('Diff:');
    });

    it('should handle hunk with no lines', () => {
      const data = createDiffData({
        hunks: [createDiffHunk({ lines: [] })],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => diffRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle very long file paths', () => {
      const longPath = 'very/long/path/'.repeat(10) + 'file.ts';
      const data = createDiffData({ filePath: longPath });
      const ctx = createRenderContext({ mode: 'fancy', width: 80 });

      expect(() => diffRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle file with no extension', () => {
      const data = createDiffData({ filePath: 'Makefile' });
      const ctx = createRenderContext({ mode: 'fancy', color: true });

      jest.clearAllMocks();
      diffRenderer.render(data, ctx);

      // Should not try to highlight files without recognized extension
      expect(mockHighlight).not.toHaveBeenCalled();
    });

    it('should handle special characters in content', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({
                type: 'context',
                content: 'const x = `${y}` && <div>{z}</div>;',
                newLineNumber: 1,
              }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => diffRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle ANSI codes in content', () => {
      const data = createDiffData({
        hunks: [
          createDiffHunk({
            lines: [
              createDiffLine({
                type: 'context',
                content: '\x1b[31mcolored\x1b[0m text',
                newLineNumber: 1,
              }),
            ],
          }),
        ],
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      expect(() => diffRenderer.render(data, ctx)).not.toThrow();
    });

    it('should handle large stats numbers', () => {
      const data = createDiffData({
        stats: { additions: 10000, deletions: 5000 },
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('10000');
      expect(result).toContain('5000');
    });

    it('should handle zero stats', () => {
      const data = createDiffData({
        stats: { additions: 0, deletions: 0 },
      });
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('+0');
      expect(result).toContain('-0');
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should render complete diff with all features', () => {
      const data: DiffData = {
        type: 'diff',
        filePath: 'src/components/Button.tsx',
        stats: { additions: 15, deletions: 8 },
        hunks: [
          {
            oldStart: 10,
            oldLines: 5,
            newStart: 10,
            newLines: 7,
            lines: [
              { type: 'context', content: 'import React from "react";', oldLineNumber: 10, newLineNumber: 10 },
              { type: 'delete', content: 'const Button = () => {', oldLineNumber: 11 },
              { type: 'add', content: 'interface ButtonProps {', newLineNumber: 11 },
              { type: 'add', content: '  label: string;', newLineNumber: 12 },
              { type: 'add', content: '}', newLineNumber: 13 },
              { type: 'add', content: 'const Button: React.FC<ButtonProps> = ({ label }) => {', newLineNumber: 14 },
              { type: 'context', content: '  return <button>{label}</button>;', oldLineNumber: 12, newLineNumber: 15 },
              { type: 'context', content: '};', oldLineNumber: 13, newLineNumber: 16 },
            ],
          },
        ],
      };
      const ctx = createRenderContext({ mode: 'fancy', color: true, emoji: true });

      const result = diffRenderer.render(data, ctx);

      expect(result).toContain('Button.tsx');
      expect(result).toContain('+15');
      expect(result).toContain('-8');
      expect(result).toContain('@@ -10,5 +10,7 @@');
      expect(result).toContain('+');
      expect(result).toContain('-');
    });

    it('should handle multiple hunks in order', () => {
      const data: DiffData = {
        type: 'diff',
        filePath: 'test.ts',
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              { type: 'context', content: 'first hunk', newLineNumber: 1 },
            ],
          },
          {
            oldStart: 50,
            oldLines: 1,
            newStart: 50,
            newLines: 1,
            lines: [
              { type: 'context', content: 'second hunk', newLineNumber: 50 },
            ],
          },
          {
            oldStart: 100,
            oldLines: 1,
            newStart: 100,
            newLines: 1,
            lines: [
              { type: 'context', content: 'third hunk', newLineNumber: 100 },
            ],
          },
        ],
      };
      const ctx = createRenderContext({ mode: 'fancy' });

      const result = diffRenderer.render(data, ctx);

      const firstIndex = result.indexOf('first hunk');
      const secondIndex = result.indexOf('second hunk');
      const thirdIndex = result.indexOf('third hunk');

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });
  });
});
