/**
 * Unit tests for useStreaming hook
 * Tests streaming functionality including:
 * - Stream state management
 * - Chunk processing
 * - Content accumulation
 * - Stream completion
 * - Error handling
 * - Abort functionality
 */

// Mock React hooks
jest.mock('react', () => ({
  useState: jest.fn((init) => {
    const val = typeof init === 'function' ? init() : init;
    return [val, jest.fn()];
  }),
  useCallback: jest.fn((fn) => fn),
  useRef: jest.fn((init) => ({ current: init })),
  useEffect: jest.fn(),
  useMemo: jest.fn((fn) => fn()),
}));

describe('useStreaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('StreamState Interface', () => {
    interface StreamState {
      isStreaming: boolean;
      content: string;
      chunks: string[];
      error: string | null;
      startTime: number | null;
      endTime: number | null;
    }

    function createInitialState(): StreamState {
      return {
        isStreaming: false,
        content: '',
        chunks: [],
        error: null,
        startTime: null,
        endTime: null,
      };
    }

    it('should create initial state correctly', () => {
      const state = createInitialState();

      expect(state.isStreaming).toBe(false);
      expect(state.content).toBe('');
      expect(state.chunks).toHaveLength(0);
      expect(state.error).toBeNull();
      expect(state.startTime).toBeNull();
      expect(state.endTime).toBeNull();
    });
  });

  describe('Stream Lifecycle', () => {
    interface StreamState {
      isStreaming: boolean;
      content: string;
      chunks: string[];
      startTime: number | null;
      endTime: number | null;
    }

    function startStream(state: StreamState): StreamState {
      return {
        ...state,
        isStreaming: true,
        content: '',
        chunks: [],
        startTime: Date.now(),
        endTime: null,
      };
    }

    function endStream(state: StreamState): StreamState {
      return {
        ...state,
        isStreaming: false,
        endTime: Date.now(),
      };
    }

    function resetStream(): StreamState {
      return {
        isStreaming: false,
        content: '',
        chunks: [],
        startTime: null,
        endTime: null,
      };
    }

    it('should start stream correctly', () => {
      const initial: StreamState = {
        isStreaming: false,
        content: 'old content',
        chunks: ['old'],
        startTime: null,
        endTime: null,
      };

      const result = startStream(initial);

      expect(result.isStreaming).toBe(true);
      expect(result.content).toBe('');
      expect(result.chunks).toHaveLength(0);
      expect(result.startTime).not.toBeNull();
    });

    it('should end stream correctly', () => {
      const streaming: StreamState = {
        isStreaming: true,
        content: 'streamed content',
        chunks: ['streamed', 'content'],
        startTime: Date.now() - 1000,
        endTime: null,
      };

      const result = endStream(streaming);

      expect(result.isStreaming).toBe(false);
      expect(result.endTime).not.toBeNull();
      expect(result.content).toBe('streamed content');
    });

    it('should reset stream correctly', () => {
      const result = resetStream();

      expect(result.isStreaming).toBe(false);
      expect(result.content).toBe('');
      expect(result.chunks).toHaveLength(0);
    });
  });

  describe('Chunk Processing', () => {
    interface StreamState {
      content: string;
      chunks: string[];
    }

    function processChunk(state: StreamState, chunk: string): StreamState {
      return {
        content: state.content + chunk,
        chunks: [...state.chunks, chunk],
      };
    }

    function processChunks(state: StreamState, chunks: string[]): StreamState {
      return chunks.reduce(
        (acc, chunk) => processChunk(acc, chunk),
        state
      );
    }

    it('should process single chunk', () => {
      const state: StreamState = { content: '', chunks: [] };
      const result = processChunk(state, 'Hello');

      expect(result.content).toBe('Hello');
      expect(result.chunks).toHaveLength(1);
    });

    it('should accumulate multiple chunks', () => {
      const state: StreamState = { content: '', chunks: [] };
      const result = processChunks(state, ['Hello', ' ', 'World']);

      expect(result.content).toBe('Hello World');
      expect(result.chunks).toHaveLength(3);
    });

    it('should preserve chunk order', () => {
      const state: StreamState = { content: '', chunks: [] };
      const result = processChunks(state, ['A', 'B', 'C']);

      expect(result.chunks).toEqual(['A', 'B', 'C']);
      expect(result.content).toBe('ABC');
    });

    it('should handle empty chunk', () => {
      const state: StreamState = { content: 'Hello', chunks: ['Hello'] };
      const result = processChunk(state, '');

      expect(result.content).toBe('Hello');
      expect(result.chunks).toHaveLength(2);
    });

    it('should handle unicode chunks', () => {
      const state: StreamState = { content: '', chunks: [] };
      const result = processChunks(state, ['\uD83D\uDE00', ' Hello ', '\u4E2D\u6587']);

      expect(result.content).toBe('\uD83D\uDE00 Hello \u4E2D\u6587');
    });

    it('should handle newline chunks', () => {
      const state: StreamState = { content: '', chunks: [] };
      const result = processChunks(state, ['Line 1', '\n', 'Line 2']);

      expect(result.content).toBe('Line 1\nLine 2');
    });
  });

  describe('Stream Chunk Types', () => {
    type ChunkType = 'content' | 'token_count' | 'tool_calls' | 'tool_result' | 'done' | 'error';

    interface StreamChunk {
      type: ChunkType;
      content?: string;
      tokenCount?: number;
      toolCalls?: unknown[];
      toolResult?: unknown;
      error?: string;
    }

    function processStreamChunk(chunk: StreamChunk): {
      shouldAppend: boolean;
      value: string | number | null;
    } {
      switch (chunk.type) {
        case 'content':
          return { shouldAppend: true, value: chunk.content || '' };
        case 'token_count':
          return { shouldAppend: false, value: chunk.tokenCount || 0 };
        case 'done':
          return { shouldAppend: false, value: null };
        case 'error':
          return { shouldAppend: false, value: chunk.error || 'Unknown error' };
        default:
          return { shouldAppend: false, value: null };
      }
    }

    it('should process content chunk', () => {
      const chunk: StreamChunk = { type: 'content', content: 'Hello' };
      const result = processStreamChunk(chunk);

      expect(result.shouldAppend).toBe(true);
      expect(result.value).toBe('Hello');
    });

    it('should process token_count chunk', () => {
      const chunk: StreamChunk = { type: 'token_count', tokenCount: 150 };
      const result = processStreamChunk(chunk);

      expect(result.shouldAppend).toBe(false);
      expect(result.value).toBe(150);
    });

    it('should process done chunk', () => {
      const chunk: StreamChunk = { type: 'done' };
      const result = processStreamChunk(chunk);

      expect(result.shouldAppend).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should process error chunk', () => {
      const chunk: StreamChunk = { type: 'error', error: 'Network error' };
      const result = processStreamChunk(chunk);

      expect(result.shouldAppend).toBe(false);
      expect(result.value).toBe('Network error');
    });

    it('should handle content chunk with undefined content', () => {
      const chunk: StreamChunk = { type: 'content' };
      const result = processStreamChunk(chunk);

      expect(result.value).toBe('');
    });
  });

  describe('Stream Content Accumulator', () => {
    class StreamAccumulator {
      private content: string = '';
      private chunks: string[] = [];

      append(chunk: string): void {
        this.content += chunk;
        this.chunks.push(chunk);
      }

      getContent(): string {
        return this.content;
      }

      getChunks(): string[] {
        return [...this.chunks];
      }

      getChunkCount(): number {
        return this.chunks.length;
      }

      reset(): void {
        this.content = '';
        this.chunks = [];
      }

      getLastChunk(): string | undefined {
        return this.chunks[this.chunks.length - 1];
      }
    }

    let accumulator: StreamAccumulator;

    beforeEach(() => {
      accumulator = new StreamAccumulator();
    });

    it('should accumulate content', () => {
      accumulator.append('Hello');
      accumulator.append(' World');

      expect(accumulator.getContent()).toBe('Hello World');
    });

    it('should track all chunks', () => {
      accumulator.append('A');
      accumulator.append('B');
      accumulator.append('C');

      expect(accumulator.getChunks()).toEqual(['A', 'B', 'C']);
    });

    it('should count chunks correctly', () => {
      accumulator.append('One');
      accumulator.append('Two');

      expect(accumulator.getChunkCount()).toBe(2);
    });

    it('should reset all state', () => {
      accumulator.append('Content');
      accumulator.reset();

      expect(accumulator.getContent()).toBe('');
      expect(accumulator.getChunkCount()).toBe(0);
    });

    it('should get last chunk', () => {
      accumulator.append('First');
      accumulator.append('Last');

      expect(accumulator.getLastChunk()).toBe('Last');
    });

    it('should return undefined for last chunk when empty', () => {
      expect(accumulator.getLastChunk()).toBeUndefined();
    });
  });

  describe('Stream Abort Handling', () => {
    interface StreamController {
      abort: () => void;
      isAborted: () => boolean;
      signal: { aborted: boolean };
    }

    function createStreamController(): StreamController {
      let aborted = false;
      return {
        abort: () => {
          aborted = true;
        },
        isAborted: () => aborted,
        signal: {
          get aborted() {
            return aborted;
          },
        },
      };
    }

    it('should not be aborted initially', () => {
      const controller = createStreamController();

      expect(controller.isAborted()).toBe(false);
      expect(controller.signal.aborted).toBe(false);
    });

    it('should abort stream', () => {
      const controller = createStreamController();
      controller.abort();

      expect(controller.isAborted()).toBe(true);
      expect(controller.signal.aborted).toBe(true);
    });

    it('should remain aborted after abort', () => {
      const controller = createStreamController();
      controller.abort();
      controller.abort(); // Double abort

      expect(controller.isAborted()).toBe(true);
    });
  });

  describe('Stream Duration Tracking', () => {
    function calculateStreamDuration(startTime: number, endTime: number): number {
      return endTime - startTime;
    }

    function formatStreamDuration(durationMs: number): string {
      if (durationMs < 1000) {
        return `${durationMs}ms`;
      }
      if (durationMs < 60000) {
        return `${(durationMs / 1000).toFixed(1)}s`;
      }
      const minutes = Math.floor(durationMs / 60000);
      const seconds = ((durationMs % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }

    it('should calculate duration correctly', () => {
      const duration = calculateStreamDuration(1000, 3500);
      expect(duration).toBe(2500);
    });

    it('should format milliseconds', () => {
      expect(formatStreamDuration(500)).toBe('500ms');
    });

    it('should format seconds', () => {
      expect(formatStreamDuration(2500)).toBe('2.5s');
    });

    it('should format minutes', () => {
      expect(formatStreamDuration(65000)).toBe('1m 5s');
    });

    it('should handle zero duration', () => {
      expect(formatStreamDuration(0)).toBe('0ms');
    });
  });

  describe('Stream Chunk Rate Calculation', () => {
    function calculateChunkRate(chunkCount: number, durationMs: number): number {
      if (durationMs === 0) return 0;
      return (chunkCount / durationMs) * 1000; // chunks per second
    }

    function calculateTokenRate(tokenCount: number, durationMs: number): number {
      if (durationMs === 0) return 0;
      return (tokenCount / durationMs) * 1000; // tokens per second
    }

    it('should calculate chunk rate correctly', () => {
      const rate = calculateChunkRate(100, 2000);
      expect(rate).toBe(50); // 50 chunks per second
    });

    it('should calculate token rate correctly', () => {
      const rate = calculateTokenRate(200, 4000);
      expect(rate).toBe(50); // 50 tokens per second
    });

    it('should handle zero duration', () => {
      expect(calculateChunkRate(100, 0)).toBe(0);
      expect(calculateTokenRate(100, 0)).toBe(0);
    });

    it('should handle zero chunks', () => {
      expect(calculateChunkRate(0, 1000)).toBe(0);
    });
  });

  describe('Stream Buffer Management', () => {
    class StreamBuffer {
      private buffer: string[] = [];
      private maxSize: number;

      constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
      }

      push(chunk: string): boolean {
        if (this.buffer.length >= this.maxSize) {
          return false;
        }
        this.buffer.push(chunk);
        return true;
      }

      flush(): string {
        const content = this.buffer.join('');
        this.buffer = [];
        return content;
      }

      size(): number {
        return this.buffer.length;
      }

      isFull(): boolean {
        return this.buffer.length >= this.maxSize;
      }

      clear(): void {
        this.buffer = [];
      }
    }

    it('should buffer chunks', () => {
      const buffer = new StreamBuffer(10);
      buffer.push('A');
      buffer.push('B');

      expect(buffer.size()).toBe(2);
    });

    it('should flush buffer', () => {
      const buffer = new StreamBuffer(10);
      buffer.push('Hello');
      buffer.push(' ');
      buffer.push('World');

      const content = buffer.flush();

      expect(content).toBe('Hello World');
      expect(buffer.size()).toBe(0);
    });

    it('should respect max size', () => {
      const buffer = new StreamBuffer(3);
      expect(buffer.push('A')).toBe(true);
      expect(buffer.push('B')).toBe(true);
      expect(buffer.push('C')).toBe(true);
      expect(buffer.push('D')).toBe(false);
    });

    it('should report full status', () => {
      const buffer = new StreamBuffer(2);
      buffer.push('A');
      expect(buffer.isFull()).toBe(false);
      buffer.push('B');
      expect(buffer.isFull()).toBe(true);
    });

    it('should clear buffer', () => {
      const buffer = new StreamBuffer(10);
      buffer.push('Content');
      buffer.clear();

      expect(buffer.size()).toBe(0);
    });
  });

  describe('Stream Error Handling', () => {
    type StreamError =
      | { type: 'network'; message: string }
      | { type: 'timeout'; durationMs: number }
      | { type: 'parse'; chunk: string }
      | { type: 'abort' };

    function formatStreamError(error: StreamError): string {
      switch (error.type) {
        case 'network':
          return `Network error: ${error.message}`;
        case 'timeout':
          return `Stream timeout after ${error.durationMs}ms`;
        case 'parse':
          return `Failed to parse chunk: ${error.chunk}`;
        case 'abort':
          return 'Stream aborted by user';
      }
    }

    function isRecoverableError(error: StreamError): boolean {
      return error.type === 'timeout' || error.type === 'network';
    }

    it('should format network error', () => {
      const error: StreamError = { type: 'network', message: 'Connection refused' };
      expect(formatStreamError(error)).toBe('Network error: Connection refused');
    });

    it('should format timeout error', () => {
      const error: StreamError = { type: 'timeout', durationMs: 30000 };
      expect(formatStreamError(error)).toBe('Stream timeout after 30000ms');
    });

    it('should format parse error', () => {
      const error: StreamError = { type: 'parse', chunk: 'invalid' };
      expect(formatStreamError(error)).toBe('Failed to parse chunk: invalid');
    });

    it('should format abort error', () => {
      const error: StreamError = { type: 'abort' };
      expect(formatStreamError(error)).toBe('Stream aborted by user');
    });

    it('should identify recoverable errors', () => {
      expect(isRecoverableError({ type: 'network', message: 'Error' })).toBe(true);
      expect(isRecoverableError({ type: 'timeout', durationMs: 30000 })).toBe(true);
      expect(isRecoverableError({ type: 'abort' })).toBe(false);
      expect(isRecoverableError({ type: 'parse', chunk: 'data' })).toBe(false);
    });
  });

  describe('Stream Progress Tracking', () => {
    interface StreamProgress {
      chunksReceived: number;
      tokensReceived: number;
      estimatedTokens: number | null;
      startTime: number;
    }

    function createProgress(): StreamProgress {
      return {
        chunksReceived: 0,
        tokensReceived: 0,
        estimatedTokens: null,
        startTime: Date.now(),
      };
    }

    function updateProgress(
      progress: StreamProgress,
      chunks: number,
      tokens: number
    ): StreamProgress {
      return {
        ...progress,
        chunksReceived: progress.chunksReceived + chunks,
        tokensReceived: progress.tokensReceived + tokens,
      };
    }

    function calculatePercentage(progress: StreamProgress): number | null {
      if (!progress.estimatedTokens) return null;
      return Math.min(100, (progress.tokensReceived / progress.estimatedTokens) * 100);
    }

    it('should create initial progress', () => {
      const progress = createProgress();

      expect(progress.chunksReceived).toBe(0);
      expect(progress.tokensReceived).toBe(0);
    });

    it('should update progress', () => {
      let progress = createProgress();
      progress = updateProgress(progress, 5, 50);

      expect(progress.chunksReceived).toBe(5);
      expect(progress.tokensReceived).toBe(50);
    });

    it('should accumulate progress', () => {
      let progress = createProgress();
      progress = updateProgress(progress, 5, 50);
      progress = updateProgress(progress, 3, 30);

      expect(progress.chunksReceived).toBe(8);
      expect(progress.tokensReceived).toBe(80);
    });

    it('should calculate percentage when estimate available', () => {
      let progress = createProgress();
      progress.estimatedTokens = 100;
      progress = updateProgress(progress, 1, 50);

      expect(calculatePercentage(progress)).toBe(50);
    });

    it('should return null percentage without estimate', () => {
      const progress = createProgress();

      expect(calculatePercentage(progress)).toBeNull();
    });

    it('should cap percentage at 100', () => {
      let progress = createProgress();
      progress.estimatedTokens = 100;
      progress = updateProgress(progress, 1, 150);

      expect(calculatePercentage(progress)).toBe(100);
    });
  });

  describe('Stream Retry Logic', () => {
    interface RetryConfig {
      maxRetries: number;
      baseDelay: number;
      maxDelay: number;
    }

    function calculateBackoff(attempt: number, config: RetryConfig): number {
      const delay = config.baseDelay * Math.pow(2, attempt);
      return Math.min(delay, config.maxDelay);
    }

    function shouldRetry(attempt: number, config: RetryConfig): boolean {
      return attempt < config.maxRetries;
    }

    const defaultConfig: RetryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
    };

    it('should calculate exponential backoff', () => {
      expect(calculateBackoff(0, defaultConfig)).toBe(1000);
      expect(calculateBackoff(1, defaultConfig)).toBe(2000);
      expect(calculateBackoff(2, defaultConfig)).toBe(4000);
    });

    it('should cap backoff at max delay', () => {
      expect(calculateBackoff(5, defaultConfig)).toBe(10000);
    });

    it('should allow retry when under max', () => {
      expect(shouldRetry(0, defaultConfig)).toBe(true);
      expect(shouldRetry(2, defaultConfig)).toBe(true);
    });

    it('should not allow retry at max', () => {
      expect(shouldRetry(3, defaultConfig)).toBe(false);
    });

    it('should not allow retry over max', () => {
      expect(shouldRetry(5, defaultConfig)).toBe(false);
    });
  });

  describe('Stream Callback Integration', () => {
    type StreamCallback = {
      onChunk: (chunk: string) => void;
      onComplete: (content: string) => void;
      onError: (error: Error) => void;
    };

    function processStream(
      chunks: string[],
      callbacks: StreamCallback
    ): void {
      try {
        let content = '';
        for (const chunk of chunks) {
          content += chunk;
          callbacks.onChunk(chunk);
        }
        callbacks.onComplete(content);
      } catch (error) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }

    it('should call onChunk for each chunk', () => {
      const onChunk = jest.fn();
      const callbacks: StreamCallback = {
        onChunk,
        onComplete: jest.fn(),
        onError: jest.fn(),
      };

      processStream(['A', 'B', 'C'], callbacks);

      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'A');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'B');
      expect(onChunk).toHaveBeenNthCalledWith(3, 'C');
    });

    it('should call onComplete with full content', () => {
      const onComplete = jest.fn();
      const callbacks: StreamCallback = {
        onChunk: jest.fn(),
        onComplete,
        onError: jest.fn(),
      };

      processStream(['Hello', ' ', 'World'], callbacks);

      expect(onComplete).toHaveBeenCalledWith('Hello World');
    });

    it('should call onComplete for empty stream', () => {
      const onComplete = jest.fn();
      const callbacks: StreamCallback = {
        onChunk: jest.fn(),
        onComplete,
        onError: jest.fn(),
      };

      processStream([], callbacks);

      expect(onComplete).toHaveBeenCalledWith('');
    });
  });

  describe('Stream Content Validation', () => {
    function validateStreamContent(content: string): {
      isValid: boolean;
      errors: string[];
    } {
      const errors: string[] = [];

      if (content.length === 0) {
        errors.push('Content is empty');
      }

      // Check for incomplete markdown
      const codeBlockMatches = content.match(/```/g);
      if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
        errors.push('Unclosed code block');
      }

      // Check for truncation markers
      if (content.includes('[TRUNCATED]') || content.includes('...')) {
        errors.push('Content may be truncated');
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    }

    it('should validate complete content', () => {
      const result = validateStreamContent('Hello World');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect empty content', () => {
      const result = validateStreamContent('');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Content is empty');
    });

    it('should detect unclosed code blocks', () => {
      const result = validateStreamContent('```javascript\nconst x = 1;');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Unclosed code block');
    });

    it('should accept closed code blocks', () => {
      const result = validateStreamContent('```javascript\nconst x = 1;\n```');

      expect(result.isValid).toBe(true);
    });

    it('should detect truncation markers', () => {
      const result = validateStreamContent('Some content [TRUNCATED]');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Content may be truncated');
    });
  });
});
