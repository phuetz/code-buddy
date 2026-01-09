/**
 * Chunk Handler
 *
 * Handles different types of stream chunks with type-safe processing
 * and content accumulation.
 */

import { EventEmitter } from 'events';

export type ChunkType = 'content' | 'tool_call' | 'tool_result' | 'token_count' | 'error' | 'done';

export interface Chunk {
  type: ChunkType;
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  toolResult?: {
    id: string;
    success: boolean;
    output?: string;
    error?: string;
  };
  tokenCount?: number;
  error?: string;
}

export interface ChunkHandlerOptions {
  /** Maximum content length to accumulate */
  maxContentLength?: number;
  /** Whether to validate chunk structure */
  validateChunks?: boolean;
  /** Custom chunk type handlers */
  typeHandlers?: Partial<Record<ChunkType, (chunk: Chunk) => void>>;
}

export interface AccumulatedContent {
  content: string;
  chunks: Chunk[];
  toolCalls: Chunk['toolCall'][];
  toolResults: Chunk['toolResult'][];
  tokenCount: number;
  errors: string[];
}

export class ChunkHandler extends EventEmitter {
  private options: Required<Omit<ChunkHandlerOptions, 'typeHandlers'>> & { typeHandlers: ChunkHandlerOptions['typeHandlers'] };
  private accumulated: AccumulatedContent;
  private chunkCount: number = 0;

  constructor(options: ChunkHandlerOptions = {}) {
    super();
    this.options = {
      maxContentLength: options.maxContentLength ?? 1000000, // 1MB default
      validateChunks: options.validateChunks ?? true,
      typeHandlers: options.typeHandlers,
    };
    this.accumulated = this.createEmptyAccumulator();
  }

  private createEmptyAccumulator(): AccumulatedContent {
    return {
      content: '',
      chunks: [],
      toolCalls: [],
      toolResults: [],
      tokenCount: 0,
      errors: [],
    };
  }

  /**
   * Handle a single chunk
   */
  handle(chunk: Chunk): void {
    // Validate if enabled
    if (this.options.validateChunks) {
      const validation = this.validateChunk(chunk);
      if (!validation.valid) {
        this.emit('validationError', { chunk, errors: validation.errors });
        return;
      }
    }

    this.chunkCount++;
    this.accumulated.chunks.push(chunk);

    // Process by type
    switch (chunk.type) {
      case 'content':
        this.handleContentChunk(chunk);
        break;
      case 'tool_call':
        this.handleToolCallChunk(chunk);
        break;
      case 'tool_result':
        this.handleToolResultChunk(chunk);
        break;
      case 'token_count':
        this.handleTokenCountChunk(chunk);
        break;
      case 'error':
        this.handleErrorChunk(chunk);
        break;
      case 'done':
        this.handleDoneChunk(chunk);
        break;
    }

    // Call custom handler if defined
    const customHandler = this.options.typeHandlers?.[chunk.type];
    if (customHandler) {
      customHandler(chunk);
    }

    this.emit('chunk', { chunk, accumulated: this.getAccumulated() });
  }

  /**
   * Handle multiple chunks
   */
  handleMany(chunks: Chunk[]): void {
    for (const chunk of chunks) {
      this.handle(chunk);
    }
  }

  /**
   * Process an async iterable of chunks
   */
  async *process(source: AsyncIterable<Chunk>): AsyncGenerator<Chunk, void, unknown> {
    for await (const chunk of source) {
      this.handle(chunk);
      yield chunk;
    }
  }

  private handleContentChunk(chunk: Chunk): void {
    if (chunk.content) {
      // Check max length
      if (this.accumulated.content.length + chunk.content.length > this.options.maxContentLength) {
        this.emit('contentOverflow', {
          currentLength: this.accumulated.content.length,
          chunkLength: chunk.content.length,
          maxLength: this.options.maxContentLength,
        });
        // Truncate to fit
        const remaining = this.options.maxContentLength - this.accumulated.content.length;
        if (remaining > 0) {
          this.accumulated.content += chunk.content.slice(0, remaining);
        }
        return;
      }
      this.accumulated.content += chunk.content;
    }
    this.emit('content', { content: chunk.content, total: this.accumulated.content });
  }

  private handleToolCallChunk(chunk: Chunk): void {
    if (chunk.toolCall) {
      this.accumulated.toolCalls.push(chunk.toolCall);
      this.emit('toolCall', { toolCall: chunk.toolCall });
    }
  }

  private handleToolResultChunk(chunk: Chunk): void {
    if (chunk.toolResult) {
      this.accumulated.toolResults.push(chunk.toolResult);
      this.emit('toolResult', { toolResult: chunk.toolResult });
    }
  }

  private handleTokenCountChunk(chunk: Chunk): void {
    if (chunk.tokenCount !== undefined) {
      this.accumulated.tokenCount = chunk.tokenCount;
      this.emit('tokenCount', { tokenCount: chunk.tokenCount });
    }
  }

  private handleErrorChunk(chunk: Chunk): void {
    if (chunk.error) {
      this.accumulated.errors.push(chunk.error);
      this.emit('error', { error: chunk.error });
    }
  }

  private handleDoneChunk(_chunk: Chunk): void {
    this.emit('done', { accumulated: this.getAccumulated() });
  }

  /**
   * Validate a chunk structure
   */
  validateChunk(chunk: Chunk): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!chunk || typeof chunk !== 'object') {
      errors.push('Chunk must be an object');
      return { valid: false, errors };
    }

    if (!chunk.type) {
      errors.push('Chunk must have a type');
    } else if (!this.isValidChunkType(chunk.type)) {
      errors.push(`Invalid chunk type: ${chunk.type}`);
    }

    // Type-specific validation
    switch (chunk.type) {
      case 'content':
        if (chunk.content !== undefined && typeof chunk.content !== 'string') {
          errors.push('Content chunk must have string content');
        }
        break;
      case 'tool_call':
        if (chunk.toolCall) {
          if (!chunk.toolCall.id || typeof chunk.toolCall.id !== 'string') {
            errors.push('Tool call must have string id');
          }
          if (!chunk.toolCall.name || typeof chunk.toolCall.name !== 'string') {
            errors.push('Tool call must have string name');
          }
        }
        break;
      case 'token_count':
        if (chunk.tokenCount !== undefined && typeof chunk.tokenCount !== 'number') {
          errors.push('Token count must be a number');
        }
        break;
      case 'error':
        if (chunk.error !== undefined && typeof chunk.error !== 'string') {
          errors.push('Error must be a string');
        }
        break;
    }

    return { valid: errors.length === 0, errors };
  }

  private isValidChunkType(type: string): type is ChunkType {
    return ['content', 'tool_call', 'tool_result', 'token_count', 'error', 'done'].includes(type);
  }

  /**
   * Get accumulated content
   */
  getAccumulated(): AccumulatedContent {
    return { ...this.accumulated };
  }

  /**
   * Get content string
   */
  getContent(): string {
    return this.accumulated.content;
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.chunkCount;
  }

  /**
   * Check if stream has errors
   */
  hasErrors(): boolean {
    return this.accumulated.errors.length > 0;
  }

  /**
   * Check if stream has tool calls
   */
  hasToolCalls(): boolean {
    return this.accumulated.toolCalls.length > 0;
  }

  /**
   * Reset handler state
   */
  reset(): void {
    this.accumulated = this.createEmptyAccumulator();
    this.chunkCount = 0;
  }

  /**
   * Create a content chunk
   */
  static createContentChunk(content: string): Chunk {
    return { type: 'content', content };
  }

  /**
   * Create a tool call chunk
   */
  static createToolCallChunk(id: string, name: string, args: string): Chunk {
    return {
      type: 'tool_call',
      toolCall: { id, name, arguments: args },
    };
  }

  /**
   * Create a tool result chunk
   */
  static createToolResultChunk(
    id: string,
    success: boolean,
    output?: string,
    error?: string
  ): Chunk {
    return {
      type: 'tool_result',
      toolResult: { id, success, output, error },
    };
  }

  /**
   * Create a token count chunk
   */
  static createTokenCountChunk(count: number): Chunk {
    return { type: 'token_count', tokenCount: count };
  }

  /**
   * Create an error chunk
   */
  static createErrorChunk(error: string): Chunk {
    return { type: 'error', error };
  }

  /**
   * Create a done chunk
   */
  static createDoneChunk(): Chunk {
    return { type: 'done' };
  }
}
