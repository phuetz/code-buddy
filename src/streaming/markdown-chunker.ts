/**
 * Block-Aware Markdown Chunker
 *
 * Intelligently chunks streaming markdown content while preserving
 * code fence integrity. Never splits inside code blocks unless forced.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Markdown block state
 */
export interface BlockState {
  /** Whether currently inside a code block */
  inCodeBlock: boolean;
  /** Current fence string (``` or ~~~) */
  fence: string;
  /** Language identifier if any */
  language: string;
  /** Depth of nested blocks (for edge cases) */
  depth: number;
}

/**
 * Chunk result
 */
export interface ChunkResult {
  /** The chunk content */
  content: string;
  /** Whether this chunk was force-split */
  forceSplit: boolean;
  /** Whether fence was closed for force-split */
  fenceClosed: boolean;
  /** Fence to reopen in next chunk */
  reopenFence?: string;
}

/**
 * Chunker configuration
 */
export interface MarkdownChunkerConfig {
  /** Soft maximum chunk size (will try to split at natural breaks) */
  softMaxChars: number;
  /** Hard maximum chunk size (will force split if exceeded) */
  hardMaxChars: number;
  /** Preferred break characters in order of preference */
  preferredBreaks: string[];
  /** Whether to preserve code blocks (avoid splitting inside) */
  preserveCodeBlocks: boolean;
  /** Whether to add continuation markers */
  addContinuationMarkers: boolean;
}

/**
 * Default chunker configuration
 */
export const DEFAULT_CHUNKER_CONFIG: MarkdownChunkerConfig = {
  softMaxChars: 2000,
  hardMaxChars: 4000,
  preferredBreaks: ['\n\n', '\n', '. ', ', ', ' '],
  preserveCodeBlocks: true,
  addContinuationMarkers: false,
};

// ============================================================================
// Block State Tracker
// ============================================================================

/**
 * Create initial block state
 */
export function createBlockState(): BlockState {
  return {
    inCodeBlock: false,
    fence: '',
    language: '',
    depth: 0,
  };
}

/**
 * Detect fence opening/closing in text
 */
export function detectFence(
  text: string,
  state: BlockState
): { newState: BlockState; fencePositions: Array<{ index: number; isOpen: boolean; fence: string; language: string }> } {
  const fencePositions: Array<{ index: number; isOpen: boolean; fence: string; language: string }> = [];
  const newState = { ...state };

  // Match both ``` and ~~~ fences at start of line or after newline
  // Also match fences that might be at the end (without trailing newline)
  const fenceRegex = /(?:^|\n)(```|~~~)(\w*)?(?:\n|$)/g;
  let match;

  while ((match = fenceRegex.exec(text)) !== null) {
    const fence = match[1];
    const language = match[2] || '';
    const index = match.index + (match[0].startsWith('\n') ? 1 : 0);

    if (!newState.inCodeBlock) {
      // Opening fence
      newState.inCodeBlock = true;
      newState.fence = fence;
      newState.language = language;
      newState.depth++;
      fencePositions.push({
        index,
        isOpen: true,
        fence,
        language,
      });
    } else if (fence === newState.fence) {
      // Closing fence (must match opening fence type)
      newState.inCodeBlock = false;
      newState.depth--;
      fencePositions.push({
        index,
        isOpen: false,
        fence,
        language: '',
      });
    }
  }

  return { newState, fencePositions };
}

/**
 * Update block state with new content
 */
export function updateBlockState(text: string, state: BlockState): BlockState {
  return detectFence(text, state).newState;
}

// ============================================================================
// Markdown Chunker
// ============================================================================

/**
 * Block-aware markdown chunker
 */
export class MarkdownChunker extends EventEmitter {
  private config: MarkdownChunkerConfig;
  private buffer: string = '';
  private blockState: BlockState;
  private chunks: ChunkResult[] = [];

  constructor(config: Partial<MarkdownChunkerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CHUNKER_CONFIG, ...config };
    this.blockState = createBlockState();
  }

  /**
   * Add text to the buffer
   */
  write(text: string): ChunkResult[] {
    this.buffer += text;
    return this.processBuffer(false);
  }

  /**
   * Flush remaining buffer
   */
  flush(): ChunkResult[] {
    const results = this.processBuffer(true);

    // Add any remaining content as final chunk
    if (this.buffer.length > 0) {
      results.push({
        content: this.buffer,
        forceSplit: false,
        fenceClosed: false,
      });
      this.buffer = '';
    }

    return results;
  }

  /**
   * Process the buffer and extract chunks
   */
  private processBuffer(isFlush: boolean): ChunkResult[] {
    const results: ChunkResult[] = [];

    while (this.buffer.length >= this.config.softMaxChars ||
           (isFlush && this.buffer.length > 0)) {
      const chunk = this.extractChunk();
      if (!chunk) break;

      results.push(chunk);
      this.chunks.push(chunk);
      this.emit('chunk', chunk);

      // If we're flushing and buffer is small, stop processing
      if (isFlush && this.buffer.length < this.config.softMaxChars) {
        break;
      }
    }

    return results;
  }

  /**
   * Extract a chunk from the buffer
   */
  private extractChunk(): ChunkResult | null {
    if (this.buffer.length === 0) {
      return null;
    }

    // Update block state for current buffer
    const { newState, fencePositions } = detectFence(this.buffer, this.blockState);

    // Find the best split point
    let splitIndex = this.findSplitPoint(fencePositions);

    // If we couldn't find a good split point and we're under soft max, wait for more data
    if (splitIndex === -1 && this.buffer.length < this.config.hardMaxChars) {
      return null;
    }

    // Force split if we're at hard max
    if (splitIndex === -1 || splitIndex > this.config.hardMaxChars) {
      return this.forceSplit();
    }

    // Extract the chunk
    const content = this.buffer.slice(0, splitIndex);
    this.buffer = this.buffer.slice(splitIndex);

    // Update state for the extracted content
    this.blockState = updateBlockState(content, this.blockState);

    return {
      content,
      forceSplit: false,
      fenceClosed: false,
    };
  }

  /**
   * Find the best split point
   */
  private findSplitPoint(
    fencePositions: Array<{ index: number; isOpen: boolean; fence: string; language: string }>
  ): number {
    const softMax = this.config.softMaxChars;

    // If we're in a code block and preserving them, try to find the closing fence
    if (this.blockState.inCodeBlock && this.config.preserveCodeBlocks) {
      // Find the first closing fence after the current position
      for (const pos of fencePositions) {
        if (!pos.isOpen && pos.index >= softMax * 0.5 && pos.index <= this.config.hardMaxChars) {
          // Split right after the closing fence (include the newline)
          const afterFence = pos.index + pos.fence.length;
          const nextNewline = this.buffer.indexOf('\n', afterFence);
          return nextNewline !== -1 ? nextNewline + 1 : afterFence;
        }
      }
    }

    // If not in a code block, find a natural break point
    if (!this.blockState.inCodeBlock) {
      for (const breakChar of this.config.preferredBreaks) {
        // Search backwards from soft max
        let searchStart = Math.min(softMax, this.buffer.length);
        let breakIndex = this.buffer.lastIndexOf(breakChar, searchStart);

        // Make sure we're not too close to the start
        if (breakIndex > softMax * 0.3) {
          return breakIndex + breakChar.length;
        }
      }
    }

    return -1;
  }

  /**
   * Force split the buffer (used when hard max is reached)
   */
  private forceSplit(): ChunkResult {
    const hardMax = this.config.hardMaxChars;
    let content: string;
    let fenceClosed = false;
    let reopenFence: string | undefined;

    if (this.blockState.inCodeBlock && this.config.preserveCodeBlocks) {
      // We're in a code block and must split
      // Close the fence, split, and prepare to reopen
      const splitPoint = Math.min(hardMax - this.blockState.fence.length - 1, this.buffer.length);
      content = this.buffer.slice(0, splitPoint);

      // Close the fence
      content += '\n' + this.blockState.fence;
      fenceClosed = true;
      reopenFence = this.blockState.fence + this.blockState.language;

      this.buffer = this.buffer.slice(splitPoint);

      // Prepend the reopening fence to the buffer
      this.buffer = reopenFence + '\n' + this.buffer;
    } else {
      // Not in a code block, just split at hard max
      content = this.buffer.slice(0, hardMax);
      this.buffer = this.buffer.slice(hardMax);
    }

    // Update state
    this.blockState = updateBlockState(content, this.blockState);

    return {
      content,
      forceSplit: true,
      fenceClosed,
      reopenFence,
    };
  }

  /**
   * Get current block state
   */
  getBlockState(): BlockState {
    return { ...this.blockState };
  }

  /**
   * Get all chunks generated so far
   */
  getChunks(): ChunkResult[] {
    return [...this.chunks];
  }

  /**
   * Get current buffer content
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Reset the chunker
   */
  reset(): void {
    this.buffer = '';
    this.blockState = createBlockState();
    this.chunks = [];
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Chunk a complete markdown string
 */
export function chunkMarkdown(
  text: string,
  config?: Partial<MarkdownChunkerConfig>
): ChunkResult[] {
  const chunker = new MarkdownChunker(config);
  chunker.write(text);
  return chunker.flush();
}

/**
 * Check if text contains unclosed code blocks
 */
export function hasUnclosedCodeBlock(text: string): boolean {
  const state = updateBlockState(text, createBlockState());
  return state.inCodeBlock;
}

/**
 * Count code blocks in text
 */
export function countCodeBlocks(text: string): { open: number; closed: number } {
  const { fencePositions } = detectFence(text, createBlockState());
  let open = 0;
  let closed = 0;

  for (const pos of fencePositions) {
    if (pos.isOpen) open++;
    else closed++;
  }

  return { open, closed };
}

/**
 * Fix unclosed code blocks in text
 */
export function fixUnclosedCodeBlocks(text: string): string {
  let state = createBlockState();
  state = updateBlockState(text, state);

  if (state.inCodeBlock) {
    return text + '\n' + state.fence;
  }

  return text;
}

/**
 * Create a streaming chunker with callback
 */
export function createStreamingChunker(
  onChunk: (chunk: ChunkResult) => void,
  config?: Partial<MarkdownChunkerConfig>
): {
  write: (text: string) => void;
  flush: () => void;
  reset: () => void;
} {
  const chunker = new MarkdownChunker(config);
  chunker.on('chunk', onChunk);

  return {
    write: (text: string) => chunker.write(text),
    flush: () => chunker.flush(),
    reset: () => chunker.reset(),
  };
}
