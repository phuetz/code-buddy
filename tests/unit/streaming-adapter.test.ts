import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createStreamingAdapter,
  getStreamingAdapter,
  resetStreamingAdapter,
  type StreamingToolAdapter,
  type OnChunkCallback,
} from '../../src/tools/streaming-adapter.js';
import type { ToolResult } from '../../src/types/index.js';

describe('StreamingToolAdapter', () => {
  let adapter: StreamingToolAdapter;

  beforeEach(() => {
    resetStreamingAdapter();
    adapter = createStreamingAdapter();
  });

  describe('supportsStreaming', () => {
    it('should return true for view_file', () => {
      expect(adapter.supportsStreaming('view_file')).toBe(true);
    });

    it('should return true for read_file', () => {
      expect(adapter.supportsStreaming('read_file')).toBe(true);
    });

    it('should return true for file_read', () => {
      expect(adapter.supportsStreaming('file_read')).toBe(true);
    });

    it('should return true for search', () => {
      expect(adapter.supportsStreaming('search')).toBe(true);
    });

    it('should return true for grep', () => {
      expect(adapter.supportsStreaming('grep')).toBe(true);
    });

    it('should return true for web_fetch', () => {
      expect(adapter.supportsStreaming('web_fetch')).toBe(true);
    });

    it('should return true for list_directory', () => {
      expect(adapter.supportsStreaming('list_directory')).toBe(true);
    });

    it('should return true for list_files', () => {
      expect(adapter.supportsStreaming('list_files')).toBe(true);
    });

    it('should return true for tree', () => {
      expect(adapter.supportsStreaming('tree')).toBe(true);
    });

    it('should return true for guarded bash output', () => {
      expect(adapter.supportsStreaming('bash')).toBe(true);
    });

    it('should return false for non-streaming tools', () => {
      expect(adapter.supportsStreaming('reason')).toBe(false);
      expect(adapter.supportsStreaming('create_file')).toBe(false);
      expect(adapter.supportsStreaming('str_replace_editor')).toBe(false);
      expect(adapter.supportsStreaming('unknown_tool')).toBe(false);
    });
  });

  describe('wrapWithStreaming', () => {
    it('should emit completed bash output after guarded execution', async () => {
      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        output: 'command output',
      });
      const chunks: string[] = [];

      const result = await adapter.wrapWithStreaming('bash', execute, chunk => chunks.push(chunk));

      expect(execute).toHaveBeenCalledOnce();
      expect(result).toEqual({ success: true, output: 'command output' });
      expect(chunks).toEqual(['command output']);
    });

    it('should stream file content in chunks', async () => {
      // Create a large file content (~2000 chars)
      const lines: string[] = [];
      for (let i = 1; i <= 100; i++) {
        lines.push(`${i}\tconst line${i} = 'some content for line ${i}';`);
      }
      const bigOutput = lines.join('\n');

      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        output: bigOutput,
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      const result = await adapter.wrapWithStreaming('view_file', execute, onChunk);

      // The execute function should have been called exactly once
      expect(execute).toHaveBeenCalledOnce();

      // The result should match the original
      expect(result.success).toBe(true);
      expect(result.output).toBe(bigOutput);

      // There should be multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Concatenating all chunks should produce the original output
      const reassembled = chunks.join('');
      expect(reassembled).toBe(bigOutput);
    });

    it('should stream search results group by group', async () => {
      const searchOutput = [
        'src/foo.ts:10: const foo = 1;',
        'src/foo.ts:20: const bar = 2;',
        '',
        'src/bar.ts:5: import { foo } from "./foo";',
        'src/bar.ts:15: export const baz = foo;',
        '',
        'src/baz.ts:1: // This is baz',
        'src/baz.ts:2: export default {};',
      ].join('\n');

      // Pad to pass minimum length threshold
      const padding = 'x'.repeat(600);
      const paddedOutput = searchOutput + '\n\n' + padding;

      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        output: paddedOutput,
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      const result = await adapter.wrapWithStreaming('search', execute, onChunk);

      expect(result.success).toBe(true);
      expect(execute).toHaveBeenCalledOnce();

      // Search results should be chunked by groups (separated by blank lines)
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should emit single chunk for small output', async () => {
      const smallOutput = 'just a tiny result';

      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        output: smallOutput,
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      const result = await adapter.wrapWithStreaming('view_file', execute, onChunk);

      expect(result.success).toBe(true);
      // Small output should be emitted as a single chunk
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe(smallOutput);
    });

    it('should handle failed tool execution', async () => {
      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: false,
        error: 'File not found: /no/such/file',
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      const result = await adapter.wrapWithStreaming('view_file', execute, onChunk);

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found: /no/such/file');
      // No output to stream on failure
      expect(chunks.length).toBe(0);
    });

    it('should handle empty output gracefully', async () => {
      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        output: '',
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      const result = await adapter.wrapWithStreaming('view_file', execute, onChunk);

      expect(result.success).toBe(true);
      expect(chunks.length).toBe(0);
    });

    it('should handle errors thrown during execution', async () => {
      const execute = vi.fn<() => Promise<ToolResult>>().mockRejectedValue(
        new Error('Unexpected crash'),
      );

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      await expect(
        adapter.wrapWithStreaming('view_file', execute, onChunk),
      ).rejects.toThrow('Unexpected crash');
    });

    it('should stream list_directory output in line chunks', async () => {
      const entries: string[] = [];
      for (let i = 0; i < 50; i++) {
        entries.push(`drwxr-xr-x  4096  2026-01-01  directory_${i}/`);
      }
      const output = entries.join('\n');

      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        output,
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      const result = await adapter.wrapWithStreaming('list_directory', execute, onChunk);

      expect(result.success).toBe(true);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(output);
    });

    it('should stream web_fetch output in line chunks', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 60; i++) {
        lines.push(`Paragraph ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`);
      }
      const output = lines.join('\n');

      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        output,
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      const result = await adapter.wrapWithStreaming('web_fetch', execute, onChunk);

      expect(result.success).toBe(true);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(output);
    });

    it('should use content field when output is absent', async () => {
      const largeContent = 'a'.repeat(1000);

      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        content: largeContent,
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      const result = await adapter.wrapWithStreaming('view_file', execute, onChunk);

      expect(result.success).toBe(true);
      // Content should be streamed
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.join('')).toBe(largeContent);
    });
  });

  describe('getStreamingAdapter singleton', () => {
    it('should return the same instance on multiple calls', () => {
      resetStreamingAdapter();
      const a = getStreamingAdapter();
      const b = getStreamingAdapter();
      expect(a).toBe(b);
    });

    it('should return a fresh instance after reset', () => {
      const a = getStreamingAdapter();
      resetStreamingAdapter();
      const b = getStreamingAdapter();
      expect(a).not.toBe(b);
    });
  });

  describe('grep tool streaming', () => {
    it('should stream grep results by groups', async () => {
      const output = [
        'src/a.ts:1: match line 1',
        'src/a.ts:2: match line 2',
        '',
        'src/b.ts:10: another match',
      ].join('\n');

      // Pad to exceed minimum streaming length
      const padding = '\n\n' + 'y'.repeat(600);
      const paddedOutput = output + padding;

      const execute = vi.fn<() => Promise<ToolResult>>().mockResolvedValue({
        success: true,
        output: paddedOutput,
      });

      const chunks: string[] = [];
      const onChunk: OnChunkCallback = (chunk) => chunks.push(chunk);

      await adapter.wrapWithStreaming('grep', execute, onChunk);

      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});
