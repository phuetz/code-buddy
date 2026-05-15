/**
 * Tests for Batch Tool
 *
 * Tests the executeBatch() function, formatBatchResults(),
 * safety guards, and parallel execution behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { executeBatch, formatBatchResults, MAX_BATCH_SIZE, READ_ONLY_TOOLS } from '@/tools/batch-tool.js';
import type { BatchCall } from '@/tools/batch-tool.js';
import { BatchToolExecute, resetBatchInstances, setBatchToolProvider } from '@/tools/registry/batch-tools.js';

describe('Batch Tool', () => {
  let mockExecuteTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetBatchInstances();
    mockExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      output: 'mock output',
    });
  });

  describe('executeBatch', () => {
    it('should execute multiple read-only tools in parallel', async () => {
      const calls: BatchCall[] = [
        { tool: 'view_file', args: { path: 'file1.ts' } },
        { tool: 'search', args: { query: 'hello' } },
        { tool: 'grep', args: { pattern: 'test' } },
      ];

      const result = await executeBatch(calls, mockExecuteTool, false);

      expect(result.results).toHaveLength(3);
      expect(result.results.every(r => r.success)).toBe(true);
      expect(mockExecuteTool).toHaveBeenCalledTimes(3);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return empty result for empty batch', async () => {
      const result = await executeBatch([], mockExecuteTool, false);

      expect(result.results).toHaveLength(0);
      expect(result.summary).toContain('Empty batch');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should reject batches exceeding MAX_BATCH_SIZE', async () => {
      const calls: BatchCall[] = Array.from(
        { length: MAX_BATCH_SIZE + 1 },
        (_, i) => ({ tool: 'view_file', args: { path: `file${i}.ts` } })
      );

      const result = await executeBatch(calls, mockExecuteTool, false);

      expect(result.results).toHaveLength(0);
      expect(result.summary).toContain('Batch too large');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should block recursive batch calls', async () => {
      const calls: BatchCall[] = [
        { tool: 'view_file', args: { path: 'file1.ts' } },
        { tool: 'batch', args: { calls: [] } },
      ];

      const result = await executeBatch(calls, mockExecuteTool, false);

      expect(result.results).toHaveLength(0);
      expect(result.summary).toContain('Recursive batch calls');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should block recursive batch_tools calls', async () => {
      const calls: BatchCall[] = [
        { tool: 'view_file', args: { path: 'file1.ts' } },
        { tool: 'batch_tools', args: { calls: [] } },
      ];

      const result = await executeBatch(calls, mockExecuteTool, false);

      expect(result.results).toHaveLength(0);
      expect(result.summary).toContain('Recursive batch calls');
    });

    it('should block destructive tools in non-YOLO mode', async () => {
      const calls: BatchCall[] = [
        { tool: 'view_file', args: { path: 'file1.ts' } },
        { tool: 'bash', args: { command: 'rm -rf /' } },
      ];

      const result = await executeBatch(calls, mockExecuteTool, false);

      expect(result.results).toHaveLength(0);
      expect(result.summary).toContain('Destructive tools blocked');
      expect(result.summary).toContain('bash');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('should block create_file in non-YOLO mode', async () => {
      const calls: BatchCall[] = [
        { tool: 'create_file', args: { path: 'new.ts', content: 'hello' } },
      ];

      const result = await executeBatch(calls, mockExecuteTool, false);

      expect(result.results).toHaveLength(0);
      expect(result.summary).toContain('Destructive tools blocked');
    });

    it('should allow destructive tools in YOLO mode', async () => {
      const calls: BatchCall[] = [
        { tool: 'bash', args: { command: 'echo hi' } },
        { tool: 'create_file', args: { path: 'new.ts', content: 'hello' } },
      ];

      const result = await executeBatch(calls, mockExecuteTool, true);

      expect(result.results).toHaveLength(2);
      expect(result.results.every(r => r.success)).toBe(true);
      expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    });

    it('should handle individual tool failures gracefully', async () => {
      mockExecuteTool
        .mockResolvedValueOnce({ success: true, output: 'ok' })
        .mockRejectedValueOnce(new Error('Tool crashed'))
        .mockResolvedValueOnce({ success: true, output: 'ok' });

      const calls: BatchCall[] = [
        { tool: 'view_file', args: { path: 'file1.ts' } },
        { tool: 'search', args: { query: 'broken' } },
        { tool: 'grep', args: { pattern: 'test' } },
      ];

      const result = await executeBatch(calls, mockExecuteTool, false);

      expect(result.results).toHaveLength(3);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toContain('Tool crashed');
      expect(result.results[2].success).toBe(true);
      expect(result.summary).toContain('2/3 succeeded');
      expect(result.summary).toContain('1 failed');
    });

    it('should track duration per call', async () => {
      // Introduce a slight delay
      mockExecuteTool.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 10));
        return { success: true, output: 'ok' };
      });

      const calls: BatchCall[] = [
        { tool: 'view_file', args: { path: 'file1.ts' } },
      ];

      const result = await executeBatch(calls, mockExecuteTool, false);

      expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should pass correct args to each tool', async () => {
      const calls: BatchCall[] = [
        { tool: 'view_file', args: { path: 'file1.ts', line_start: 1 } },
        { tool: 'search', args: { query: 'hello', glob: '*.ts' } },
      ];

      await executeBatch(calls, mockExecuteTool, false);

      expect(mockExecuteTool).toHaveBeenCalledWith('view_file', { path: 'file1.ts', line_start: 1 });
      expect(mockExecuteTool).toHaveBeenCalledWith('search', { query: 'hello', glob: '*.ts' });
    });

    it('should execute calls truly in parallel', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      mockExecuteTool.mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(r => setTimeout(r, 50));
        concurrentCount--;
        return { success: true, output: 'ok' };
      });

      const calls: BatchCall[] = [
        { tool: 'view_file', args: { path: 'file1.ts' } },
        { tool: 'view_file', args: { path: 'file2.ts' } },
        { tool: 'view_file', args: { path: 'file3.ts' } },
      ];

      await executeBatch(calls, mockExecuteTool, false);

      // All 3 should have been running concurrently
      expect(maxConcurrent).toBeGreaterThan(1);
    });
  });

  describe('BatchToolExecute adapter', () => {
    it('should fail when every delegated tool call fails', async () => {
      mockExecuteTool.mockResolvedValue({ success: false, error: 'tool unavailable' });
      setBatchToolProvider(mockExecuteTool, () => false);
      const tool = new BatchToolExecute();

      const result = await tool.execute({
        calls: [
          { tool: 'view_file', args: { path: 'missing.ts' } },
          { tool: 'search', args: { query: 'missing' } },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('0/2 succeeded');
      expect(result.output).toContain('[FAIL] view_file');
      expect(result.output).toContain('[FAIL] search');
    });

    it('should keep partial batch results successful with failure details', async () => {
      mockExecuteTool
        .mockResolvedValueOnce({ success: true, output: 'ok' })
        .mockResolvedValueOnce({ success: false, error: 'tool unavailable' });
      setBatchToolProvider(mockExecuteTool, () => false);
      const tool = new BatchToolExecute();

      const result = await tool.execute({
        calls: [
          { tool: 'view_file', args: { path: 'ok.ts' } },
          { tool: 'search', args: { query: 'missing' } },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('1/2 succeeded');
      expect(result.output).toContain('[FAIL] search');
    });
  });

  describe('formatBatchResults', () => {
    it('should format successful results', () => {
      const formatted = formatBatchResults({
        results: [
          { tool: 'view_file', success: true, output: 'file content', durationMs: 10 },
          { tool: 'search', success: true, output: '3 matches', durationMs: 20 },
        ],
        summary: 'Batch complete: 2/2 succeeded in 25ms',
        totalDurationMs: 25,
      });

      expect(formatted).toContain('Batch complete: 2/2 succeeded');
      expect(formatted).toContain('[OK] view_file');
      expect(formatted).toContain('[OK] search');
      expect(formatted).toContain('file content');
      expect(formatted).toContain('3 matches');
    });

    it('should format failures', () => {
      const formatted = formatBatchResults({
        results: [
          { tool: 'view_file', success: false, error: 'File not found', durationMs: 5 },
        ],
        summary: 'Batch complete: 0/1 succeeded, 1 failed in 5ms',
        totalDurationMs: 5,
      });

      expect(formatted).toContain('[FAIL] view_file');
      expect(formatted).toContain('Error: File not found');
    });

    it('should truncate long output', () => {
      const longOutput = 'x'.repeat(1000);
      const formatted = formatBatchResults({
        results: [
          { tool: 'view_file', success: true, output: longOutput, durationMs: 10 },
        ],
        summary: 'Batch complete: 1/1 succeeded in 10ms',
        totalDurationMs: 10,
      });

      expect(formatted.length).toBeLessThan(longOutput.length + 200);
      expect(formatted).toContain('more chars');
    });
  });

  describe('READ_ONLY_TOOLS', () => {
    it('should contain expected read-only tools', () => {
      expect(READ_ONLY_TOOLS.has('view_file')).toBe(true);
      expect(READ_ONLY_TOOLS.has('search')).toBe(true);
      expect(READ_ONLY_TOOLS.has('grep')).toBe(true);
      expect(READ_ONLY_TOOLS.has('glob')).toBe(true);
      expect(READ_ONLY_TOOLS.has('list_files')).toBe(true);
      expect(READ_ONLY_TOOLS.has('find_symbols')).toBe(true);
      expect(READ_ONLY_TOOLS.has('web_search')).toBe(true);
      expect(READ_ONLY_TOOLS.has('codebase_map')).toBe(true);
    });

    it('should not contain destructive tools', () => {
      expect(READ_ONLY_TOOLS.has('bash')).toBe(false);
      expect(READ_ONLY_TOOLS.has('create_file')).toBe(false);
      expect(READ_ONLY_TOOLS.has('str_replace_editor')).toBe(false);
      expect(READ_ONLY_TOOLS.has('apply_patch')).toBe(false);
    });
  });

  describe('MAX_BATCH_SIZE', () => {
    it('should be 25', () => {
      expect(MAX_BATCH_SIZE).toBe(25);
    });
  });
});
