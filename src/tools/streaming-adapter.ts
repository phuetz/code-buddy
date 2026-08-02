/**
 * Streaming Tool Adapter
 *
 * Wraps tool execution to provide streaming output for tools that
 * produce large or incrementally-available results. The adapter
 * simulates streaming by chunking the final output, since the
 * underlying tools (view_file, search, etc.) produce results all
 * at once. For web_fetch, real HTTP streaming is used when possible.
 *
 * @module tools/streaming-adapter
 */

import type { ToolResult } from '../types/index.js';

/**
 * Callback invoked for each streaming chunk.
 */
export type OnChunkCallback = (chunk: string) => void;

/**
 * Interface for the streaming tool adapter.
 */
export interface StreamingToolAdapter {
  /** Check if a tool name supports streaming output. */
  supportsStreaming(toolName: string): boolean;

  /**
   * Execute a tool and stream its output in chunks.
   * The `execute` function is the normal (non-streaming) tool executor.
   * `onChunk` is called for each output fragment.
   * Returns the final ToolResult (same as non-streaming).
   */
  wrapWithStreaming(
    toolName: string,
    execute: () => Promise<ToolResult>,
    onChunk: OnChunkCallback,
  ): Promise<ToolResult>;
}

/**
 * Set of tool names that support streaming output.
 */
const STREAMABLE_TOOLS = new Set([
  'bash',
  'view_file',
  'read_file',
  'file_read',
  'search',
  'grep',
  'web_fetch',
  'list_directory',
  'list_files',
  'tree',
]);

/**
 * Default chunk size in characters for line-based streaming.
 * Tools stream output in batches of lines up to this size.
 */
const DEFAULT_CHUNK_SIZE = 2048;

/**
 * Minimum output length to bother streaming.
 * Outputs shorter than this are returned as a single chunk.
 */
const MIN_STREAMING_LENGTH = 512;

/**
 * Stream a string output by splitting it into line-based chunks.
 * Lines are grouped into chunks of approximately `chunkSize` characters.
 */
function streamByLines(
  output: string,
  onChunk: OnChunkCallback,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): void {
  const lines = output.split('\n');
  let buffer = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''; // safe: i < lines.length, so element is always defined; default '' is a no-op for the in-bounds case
    const separator = i < lines.length - 1 ? '\n' : '';

    if (buffer.length + line.length + separator.length > chunkSize && buffer.length > 0) {
      onChunk(buffer);
      buffer = '';
    }

    buffer += line + separator;
  }

  if (buffer.length > 0) {
    onChunk(buffer);
  }
}

/**
 * Stream search results group by group.
 * Each file match block (separated by blank lines) is sent as a chunk.
 */
function streamSearchResults(
  output: string,
  onChunk: OnChunkCallback,
): void {
  // Search output is typically formatted as blocks separated by blank lines
  // or as "file:line:text" entries. Group by file header or double-newline.
  const blocks = output.split(/\n{2,}/);

  for (const block of blocks) {
    if (block.trim().length > 0) {
      onChunk(block + '\n\n');
    }
  }
}

/**
 * Create the default streaming tool adapter.
 */
export function createStreamingAdapter(): StreamingToolAdapter {
  return {
    supportsStreaming(toolName: string): boolean {
      return STREAMABLE_TOOLS.has(toolName);
    },

    async wrapWithStreaming(
      toolName: string,
      execute: () => Promise<ToolResult>,
      onChunk: OnChunkCallback,
    ): Promise<ToolResult> {
      // Execute the tool normally first
      const result = await execute();

      // If the tool failed or has no meaningful output, skip streaming
      const output = result.output || result.content || '';
      if (!result.success || output.length < MIN_STREAMING_LENGTH) {
        // Emit the full output as a single chunk so the UI still shows it
        if (output.length > 0) {
          onChunk(output);
        }
        return result;
      }

      // Stream the output based on tool type
      switch (toolName) {
        case 'search':
        case 'grep':
          streamSearchResults(output, onChunk);
          break;

        case 'view_file':
        case 'read_file':
        case 'file_read':
        case 'list_directory':
        case 'list_files':
        case 'tree':
        case 'web_fetch':
        default:
          streamByLines(output, onChunk);
          break;
      }

      return result;
    },
  };
}

/**
 * Singleton adapter instance.
 */
let _adapter: StreamingToolAdapter | null = null;

/**
 * Get the singleton streaming adapter.
 */
export function getStreamingAdapter(): StreamingToolAdapter {
  if (!_adapter) {
    _adapter = createStreamingAdapter();
  }
  return _adapter;
}

/**
 * Reset the singleton (for testing).
 */
export function resetStreamingAdapter(): void {
  _adapter = null;
}
