/**
 * Unit tests for streaming functionality
 * Tests stream processing, chunk handling, stream transformations,
 * backpressure handling, and error recovery
 */

import { StreamProcessor } from '../../src/streaming/stream-processor';
import { ChunkHandler, Chunk } from '../../src/streaming/chunk-handler';
import { StreamTransformer } from '../../src/streaming/stream-transformer';
import { BackpressureController, withBackpressure } from '../../src/streaming/backpressure';

// Helper to create async generator from array
async function* arrayToAsyncGenerator<T>(arr: T[]): AsyncGenerator<T, void, unknown> {
  for (const item of arr) {
    yield item;
  }
}

// Helper to collect async generator to array
async function collectAsync<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) {
    result.push(item);
  }
  return result;
}

describe('StreamProcessor', () => {
  describe('Basic Processing', () => {
    it('should process chunks from async iterable', async () => {
      const processor = new StreamProcessor<string>();
      const source = arrayToAsyncGenerator(['a', 'b', 'c']);

      const result = await collectAsync(processor.process(source));

      expect(result).toEqual(['a', 'b', 'c']);
      expect(processor.getState()).toBe('completed');
    });

    it('should track processing stats', async () => {
      const processor = new StreamProcessor<string>();
      const source = arrayToAsyncGenerator(['hello', 'world']);

      await collectAsync(processor.process(source));

      const stats = processor.getStats();
      expect(stats.chunksProcessed).toBe(2);
      expect(stats.bytesProcessed).toBe(10); // 'hello' + 'world'
      expect(stats.startTime).toBeGreaterThan(0);
      expect(stats.endTime).toBeGreaterThanOrEqual(stats.startTime);
    });

    it('should apply transform function to chunks', async () => {
      const processor = new StreamProcessor<number>();
      const source = arrayToAsyncGenerator([1, 2, 3]);

      const result = await collectAsync(
        processor.process(source, (n) => n * 2)
      );

      expect(result).toEqual([2, 4, 6]);
    });

    it('should handle async transform function', async () => {
      const processor = new StreamProcessor<number>();
      const source = arrayToAsyncGenerator([1, 2, 3]);

      const result = await collectAsync(
        processor.process(source, async (n) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          return n + 10;
        })
      );

      expect(result).toEqual([11, 12, 13]);
    });

    it('should handle empty stream', async () => {
      const processor = new StreamProcessor<string>();
      const source = arrayToAsyncGenerator([]);

      const result = await collectAsync(processor.process(source));

      expect(result).toEqual([]);
      expect(processor.getState()).toBe('completed');
    });
  });

  describe('Pause and Resume', () => {
    it('should pause and resume processing', async () => {
      const processor = new StreamProcessor<number>();
      const chunks = [1, 2, 3, 4, 5];
      const source = arrayToAsyncGenerator(chunks);
      const collected: number[] = [];

      const iterator = processor.process(source)[Symbol.asyncIterator]();

      // Get first chunk
      const r1 = await iterator.next();
      if (!r1.done) collected.push(r1.value);

      // Pause
      processor.pause();
      expect(processor.getState()).toBe('streaming'); // Will be paused on next iteration

      // Schedule resume
      setTimeout(() => processor.resume(), 10);

      // Continue collecting
      let result = await iterator.next();
      while (!result.done) {
        collected.push(result.value);
        result = await iterator.next();
      }

      expect(collected).toEqual(chunks);
    });
  });

  describe('Abort', () => {
    it('should abort processing', async () => {
      const processor = new StreamProcessor<number>();
      const chunks = [1, 2, 3, 4, 5];
      const collected: number[] = [];

      async function* slowGenerator() {
        for (const chunk of chunks) {
          await new Promise(resolve => setTimeout(resolve, 10));
          yield chunk;
        }
      }

      const iterator = processor.process(slowGenerator())[Symbol.asyncIterator]();

      // Get first chunk
      const r1 = await iterator.next();
      if (!r1.done) collected.push(r1.value);

      // Abort
      processor.abort();

      // Try to get more
      const r2 = await iterator.next();
      expect(r2.done).toBe(true);
      expect(processor.getState()).toBe('aborted');
    });
  });

  describe('Error Handling', () => {
    it('should handle transform errors gracefully', async () => {
      const processor = new StreamProcessor<number>();
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const errors: unknown[] = [];

      processor.on('transformError', (e) => errors.push(e));

      const result = await collectAsync(
        processor.process(source, (n) => {
          if (n === 2) throw new Error('Transform error');
          return n;
        })
      );

      expect(result).toEqual([1, 3]); // 2 was skipped
      expect(errors).toHaveLength(1);
    });

    it('should propagate source errors', async () => {
      const processor = new StreamProcessor<number>();

      async function* errorGenerator() {
        yield 1;
        throw new Error('Source error');
      }

      await expect(async () => {
        await collectAsync(processor.process(errorGenerator()));
      }).rejects.toThrow('Source error');

      expect(processor.getState()).toBe('error');
    });
  });

  describe('Collect and Reduce', () => {
    it('should collect all chunks', async () => {
      const processor = new StreamProcessor<number>();
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);

      const result = await processor.collect(source);

      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should reduce stream to single value', async () => {
      const processor = new StreamProcessor<number>();
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);

      const sum = await processor.reduce(
        source,
        (acc, n) => acc + n,
        0
      );

      expect(sum).toBe(15);
    });
  });

  describe('Reset', () => {
    it('should reset processor state', async () => {
      const processor = new StreamProcessor<string>();
      const source1 = arrayToAsyncGenerator(['a', 'b']);

      await collectAsync(processor.process(source1));
      expect(processor.getState()).toBe('completed');

      processor.reset();

      expect(processor.getState()).toBe('idle');
      expect(processor.getStats().chunksProcessed).toBe(0);
    });
  });

  describe('Buffer Management', () => {
    it('should track buffer size', async () => {
      const processor = new StreamProcessor<string>({ maxBufferSize: 5 });
      expect(processor.getBufferSize()).toBe(0);
    });

    it('should report active state correctly', async () => {
      const processor = new StreamProcessor<string>();
      expect(processor.isActive()).toBe(false);

      // Note: isActive becomes true during processing
      const source = arrayToAsyncGenerator(['a', 'b']);
      await collectAsync(processor.process(source));

      expect(processor.isActive()).toBe(false); // Completed
    });
  });
});

describe('ChunkHandler', () => {
  describe('Content Chunks', () => {
    it('should accumulate content from content chunks', () => {
      const handler = new ChunkHandler();

      handler.handle({ type: 'content', content: 'Hello' });
      handler.handle({ type: 'content', content: ' ' });
      handler.handle({ type: 'content', content: 'World' });

      expect(handler.getContent()).toBe('Hello World');
      expect(handler.getChunkCount()).toBe(3);
    });

    it('should handle empty content', () => {
      const handler = new ChunkHandler();

      handler.handle({ type: 'content', content: '' });
      handler.handle({ type: 'content', content: 'test' });

      expect(handler.getContent()).toBe('test');
    });

    it('should respect max content length', () => {
      const handler = new ChunkHandler({ maxContentLength: 10 });
      let overflowed = false;

      handler.on('contentOverflow', () => { overflowed = true; });

      handler.handle({ type: 'content', content: 'Hello World!' }); // 12 chars

      expect(handler.getContent()).toBe('Hello Worl'); // Truncated to 10
      expect(overflowed).toBe(true);
    });

    it('should handle unicode content', () => {
      const handler = new ChunkHandler();

      handler.handle({ type: 'content', content: 'Hello ' });
      handler.handle({ type: 'content', content: '\u4E2D\u6587' }); // Chinese

      expect(handler.getContent()).toBe('Hello \u4E2D\u6587');
    });
  });

  describe('Tool Call Chunks', () => {
    it('should accumulate tool calls', () => {
      const handler = new ChunkHandler();

      handler.handle({
        type: 'tool_call',
        toolCall: { id: 'call_1', name: 'bash', arguments: '{"cmd":"ls"}' },
      });
      handler.handle({
        type: 'tool_call',
        toolCall: { id: 'call_2', name: 'view_file', arguments: '{"path":"test.txt"}' },
      });

      const accumulated = handler.getAccumulated();
      expect(accumulated.toolCalls).toHaveLength(2);
      expect(handler.hasToolCalls()).toBe(true);
    });

    it('should emit toolCall event', () => {
      const handler = new ChunkHandler();
      let emittedToolCall: unknown = null;

      handler.on('toolCall', (data) => { emittedToolCall = data; });

      handler.handle({
        type: 'tool_call',
        toolCall: { id: 'call_1', name: 'bash', arguments: '{}' },
      });

      expect(emittedToolCall).not.toBeNull();
    });
  });

  describe('Tool Result Chunks', () => {
    it('should accumulate tool results', () => {
      const handler = new ChunkHandler();

      handler.handle({
        type: 'tool_result',
        toolResult: { id: 'call_1', success: true, output: 'file1.txt' },
      });

      const accumulated = handler.getAccumulated();
      expect(accumulated.toolResults).toHaveLength(1);
      expect(accumulated.toolResults[0]?.success).toBe(true);
    });

    it('should handle failed tool results', () => {
      const handler = new ChunkHandler();

      handler.handle({
        type: 'tool_result',
        toolResult: { id: 'call_1', success: false, error: 'Command failed' },
      });

      const accumulated = handler.getAccumulated();
      expect(accumulated.toolResults[0]?.success).toBe(false);
      expect(accumulated.toolResults[0]?.error).toBe('Command failed');
    });
  });

  describe('Token Count Chunks', () => {
    it('should update token count', () => {
      const handler = new ChunkHandler();

      handler.handle({ type: 'token_count', tokenCount: 100 });
      handler.handle({ type: 'token_count', tokenCount: 150 });

      const accumulated = handler.getAccumulated();
      expect(accumulated.tokenCount).toBe(150); // Latest value
    });

    it('should emit tokenCount event', () => {
      const handler = new ChunkHandler();
      let tokenCount = 0;

      handler.on('tokenCount', (data) => { tokenCount = data.tokenCount; });

      handler.handle({ type: 'token_count', tokenCount: 100 });

      expect(tokenCount).toBe(100);
    });
  });

  describe('Error Chunks', () => {
    it('should accumulate errors', () => {
      const handler = new ChunkHandler();

      // Add error listener to prevent unhandled error
      handler.on('error', () => { /* ignore */ });

      handler.handle({ type: 'error', error: 'Error 1' });
      handler.handle({ type: 'error', error: 'Error 2' });

      expect(handler.hasErrors()).toBe(true);
      expect(handler.getAccumulated().errors).toEqual(['Error 1', 'Error 2']);
    });
  });

  describe('Done Chunks', () => {
    it('should emit done event', () => {
      const handler = new ChunkHandler();
      let doneEmitted = false;

      handler.on('done', () => { doneEmitted = true; });

      handler.handle({ type: 'content', content: 'Hello' });
      handler.handle({ type: 'done' });

      expect(doneEmitted).toBe(true);
    });

    it('should provide accumulated content in done event', () => {
      const handler = new ChunkHandler();
      let doneData: { accumulated: unknown } | null = null;

      handler.on('done', (data) => { doneData = data; });

      handler.handle({ type: 'content', content: 'test' });
      handler.handle({ type: 'done' });

      expect(doneData).not.toBeNull();
    });
  });

  describe('Chunk Validation', () => {
    it('should validate chunk structure', () => {
      const handler = new ChunkHandler({ validateChunks: true });

      const validResult = handler.validateChunk({ type: 'content', content: 'test' });
      expect(validResult.valid).toBe(true);

      const invalidResult = handler.validateChunk({ type: 'invalid' as any });
      expect(invalidResult.valid).toBe(false);
    });

    it('should emit validation errors', () => {
      const handler = new ChunkHandler({ validateChunks: true });
      let validationError = false;

      handler.on('validationError', () => { validationError = true; });

      handler.handle({ type: 'invalid' as any });

      expect(validationError).toBe(true);
    });

    it('should validate content type', () => {
      const handler = new ChunkHandler();

      const result = handler.validateChunk({ type: 'content', content: 123 as any });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Content chunk must have string content');
    });

    it('should validate tool call structure', () => {
      const handler = new ChunkHandler();

      const result = handler.validateChunk({
        type: 'tool_call',
        toolCall: { id: 123 as any, name: 'test', arguments: '{}' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool call must have string id');
    });
  });

  describe('Static Chunk Creators', () => {
    it('should create content chunk', () => {
      const chunk = ChunkHandler.createContentChunk('Hello');
      expect(chunk).toEqual({ type: 'content', content: 'Hello' });
    });

    it('should create tool call chunk', () => {
      const chunk = ChunkHandler.createToolCallChunk('id1', 'bash', '{}');
      expect(chunk.type).toBe('tool_call');
      expect(chunk.toolCall?.name).toBe('bash');
      expect(chunk.toolCall?.id).toBe('id1');
      expect(chunk.toolCall?.arguments).toBe('{}');
    });

    it('should create tool result chunk', () => {
      const chunk = ChunkHandler.createToolResultChunk('id1', true, 'output');
      expect(chunk.type).toBe('tool_result');
      expect(chunk.toolResult?.success).toBe(true);
      expect(chunk.toolResult?.output).toBe('output');
    });

    it('should create error chunk', () => {
      const chunk = ChunkHandler.createErrorChunk('Something went wrong');
      expect(chunk).toEqual({ type: 'error', error: 'Something went wrong' });
    });

    it('should create done chunk', () => {
      const chunk = ChunkHandler.createDoneChunk();
      expect(chunk).toEqual({ type: 'done' });
    });

    it('should create token count chunk', () => {
      const chunk = ChunkHandler.createTokenCountChunk(500);
      expect(chunk).toEqual({ type: 'token_count', tokenCount: 500 });
    });
  });

  describe('Reset', () => {
    it('should reset handler state', () => {
      const handler = new ChunkHandler();

      // Add error listener to prevent unhandled error
      handler.on('error', () => { /* ignore */ });

      handler.handle({ type: 'content', content: 'test' });
      handler.handle({ type: 'error', error: 'error' });

      handler.reset();

      expect(handler.getContent()).toBe('');
      expect(handler.getChunkCount()).toBe(0);
      expect(handler.hasErrors()).toBe(false);
    });
  });

  describe('Process Async Iterable', () => {
    it('should process chunks from async iterable', async () => {
      const handler = new ChunkHandler();
      const chunks: Chunk[] = [
        { type: 'content', content: 'Hello' },
        { type: 'content', content: ' World' },
        { type: 'done' },
      ];

      const source = arrayToAsyncGenerator(chunks);
      const processed = await collectAsync(handler.process(source));

      expect(processed).toHaveLength(3);
      expect(handler.getContent()).toBe('Hello World');
    });

    it('should handle many chunks', () => {
      const handler = new ChunkHandler();
      const chunks: Chunk[] = [
        { type: 'content', content: 'A' },
        { type: 'content', content: 'B' },
        { type: 'content', content: 'C' },
      ];

      handler.handleMany(chunks);

      expect(handler.getContent()).toBe('ABC');
      expect(handler.getChunkCount()).toBe(3);
    });
  });

  describe('Custom Type Handlers', () => {
    it('should call custom type handlers', () => {
      let customHandlerCalled = false;

      const handler = new ChunkHandler({
        typeHandlers: {
          content: () => { customHandlerCalled = true; },
        },
      });

      handler.handle({ type: 'content', content: 'test' });

      expect(customHandlerCalled).toBe(true);
    });
  });
});

describe('StreamTransformer', () => {
  describe('map', () => {
    it('should map each chunk', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const result = await collectAsync(
        StreamTransformer.map(source, (n) => n * 2)
      );
      expect(result).toEqual([2, 4, 6]);
    });

    it('should handle async transform', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const result = await collectAsync(
        StreamTransformer.map(source, async (n) => {
          await new Promise(r => setTimeout(r, 1));
          return n.toString();
        })
      );
      expect(result).toEqual(['1', '2', '3']);
    });
  });

  describe('filter', () => {
    it('should filter chunks by predicate', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);
      const result = await collectAsync(
        StreamTransformer.filter(source, (n) => n % 2 === 0)
      );
      expect(result).toEqual([2, 4]);
    });

    it('should handle async predicate', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const result = await collectAsync(
        StreamTransformer.filter(source, async (n) => n > 1)
      );
      expect(result).toEqual([2, 3]);
    });

    it('should handle all filtered out', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const result = await collectAsync(
        StreamTransformer.filter(source, () => false)
      );
      expect(result).toEqual([]);
    });
  });

  describe('take', () => {
    it('should take first n chunks', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);
      const result = await collectAsync(StreamTransformer.take(source, 3));
      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle taking more than available', async () => {
      const source = arrayToAsyncGenerator([1, 2]);
      const result = await collectAsync(StreamTransformer.take(source, 5));
      expect(result).toEqual([1, 2]);
    });

    it('should handle taking zero', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const result = await collectAsync(StreamTransformer.take(source, 0));
      expect(result).toEqual([]);
    });
  });

  describe('skip', () => {
    it('should skip first n chunks', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);
      const result = await collectAsync(StreamTransformer.skip(source, 2));
      expect(result).toEqual([3, 4, 5]);
    });

    it('should handle skipping all', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const result = await collectAsync(StreamTransformer.skip(source, 5));
      expect(result).toEqual([]);
    });
  });

  describe('takeWhile', () => {
    it('should take while predicate is true', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);
      const result = await collectAsync(
        StreamTransformer.takeWhile(source, (n) => n < 4)
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it('should stop at first false', async () => {
      const source = arrayToAsyncGenerator([1, 2, 10, 3, 4]);
      const result = await collectAsync(
        StreamTransformer.takeWhile(source, (n) => n < 5)
      );
      expect(result).toEqual([1, 2]);
    });
  });

  describe('skipWhile', () => {
    it('should skip while predicate is true', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);
      const result = await collectAsync(
        StreamTransformer.skipWhile(source, (n) => n < 3)
      );
      expect(result).toEqual([3, 4, 5]);
    });

    it('should not resume skipping after false', async () => {
      const source = arrayToAsyncGenerator([1, 5, 2, 3]);
      const result = await collectAsync(
        StreamTransformer.skipWhile(source, (n) => n < 3)
      );
      expect(result).toEqual([5, 2, 3]);
    });
  });

  describe('batch', () => {
    it('should batch chunks into arrays', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);
      const result = await collectAsync(StreamTransformer.batch(source, 2));
      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should handle exact batch size', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4]);
      const result = await collectAsync(StreamTransformer.batch(source, 2));
      expect(result).toEqual([[1, 2], [3, 4]]);
    });

    it('should handle single item batches', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const result = await collectAsync(StreamTransformer.batch(source, 1));
      expect(result).toEqual([[1], [2], [3]]);
    });
  });

  describe('throttle', () => {
    it('should throttle chunks', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);
      const result = await collectAsync(
        StreamTransformer.throttle(source, 0) // No delay for testing
      );
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('delay', () => {
    it('should add delay between chunks', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const start = Date.now();
      const result = await collectAsync(StreamTransformer.delay(source, 10));
      const duration = Date.now() - start;

      expect(result).toEqual([1, 2, 3]);
      expect(duration).toBeGreaterThanOrEqual(20); // 2 delays of 10ms each
    });
  });

  describe('concat', () => {
    it('should concatenate multiple streams', async () => {
      const s1 = arrayToAsyncGenerator([1, 2]);
      const s2 = arrayToAsyncGenerator([3, 4]);
      const s3 = arrayToAsyncGenerator([5]);

      const result = await collectAsync(StreamTransformer.concat(s1, s2, s3));
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle empty streams', async () => {
      const s1 = arrayToAsyncGenerator([1, 2]);
      const s2 = arrayToAsyncGenerator<number>([]);
      const s3 = arrayToAsyncGenerator([3]);

      const result = await collectAsync(StreamTransformer.concat(s1, s2, s3));
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('zip', () => {
    it('should zip multiple streams', async () => {
      const s1 = arrayToAsyncGenerator([1, 2, 3]);
      const s2 = arrayToAsyncGenerator([4, 5, 6]);

      const result = await collectAsync(StreamTransformer.zip(s1, s2));
      expect(result).toEqual([[1, 4], [2, 5], [3, 6]]);
    });

    it('should stop at shortest stream', async () => {
      const s1 = arrayToAsyncGenerator([1, 2, 3, 4]);
      const s2 = arrayToAsyncGenerator([10, 20]);

      const result = await collectAsync(StreamTransformer.zip(s1, s2));
      expect(result).toEqual([[1, 10], [2, 20]]);
    });
  });

  describe('tee', () => {
    it('should duplicate stream for multiple consumers', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const [s1, s2] = StreamTransformer.tee(source, 2);

      const r1 = await collectAsync(s1);
      const r2 = await collectAsync(s2);

      expect(r1).toEqual([1, 2, 3]);
      expect(r2).toEqual([1, 2, 3]);
    });

    it('should create multiple copies', async () => {
      const source = arrayToAsyncGenerator([1, 2]);
      const copies = StreamTransformer.tee(source, 3);

      expect(copies).toHaveLength(3);
    });
  });

  describe('buffer', () => {
    it('should buffer chunks based on condition', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5, 6]);
      const result = await collectAsync(
        StreamTransformer.buffer(source, (buffer) => buffer.length >= 2)
      );
      expect(result).toEqual([[1, 2], [3, 4], [5, 6]]);
    });
  });

  describe('flatten', () => {
    it('should flatten nested arrays', async () => {
      const source = arrayToAsyncGenerator([[1, 2], [3], [4, 5]]);
      const result = await collectAsync(StreamTransformer.flatten(source));
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('Terminal Operations', () => {
    it('should reduce stream', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4]);
      const sum = await StreamTransformer.reduce(source, (a, b) => a + b, 0);
      expect(sum).toBe(10);
    });

    it('should collect stream', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const result = await StreamTransformer.collect(source);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should get first element', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const first = await StreamTransformer.first(source);
      expect(first).toBe(1);
    });

    it('should return undefined for first of empty', async () => {
      const source = arrayToAsyncGenerator<number>([]);
      const first = await StreamTransformer.first(source);
      expect(first).toBeUndefined();
    });

    it('should get last element', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const last = await StreamTransformer.last(source);
      expect(last).toBe(3);
    });

    it('should return undefined for last of empty', async () => {
      const source = arrayToAsyncGenerator<number>([]);
      const last = await StreamTransformer.last(source);
      expect(last).toBeUndefined();
    });

    it('should count elements', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);
      const count = await StreamTransformer.count(source);
      expect(count).toBe(5);
    });

    it('should count empty stream', async () => {
      const source = arrayToAsyncGenerator<number>([]);
      const count = await StreamTransformer.count(source);
      expect(count).toBe(0);
    });

    it('should check if some match predicate', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4]);
      const hasEven = await StreamTransformer.some(source, (n) => n % 2 === 0);
      expect(hasEven).toBe(true);
    });

    it('should return false for some when none match', async () => {
      const source = arrayToAsyncGenerator([1, 3, 5]);
      const hasEven = await StreamTransformer.some(source, (n) => n % 2 === 0);
      expect(hasEven).toBe(false);
    });

    it('should check if all match predicate', async () => {
      const source = arrayToAsyncGenerator([2, 4, 6]);
      const allEven = await StreamTransformer.every(source, (n) => n % 2 === 0);
      expect(allEven).toBe(true);
    });

    it('should return false for every when one doesnt match', async () => {
      const source = arrayToAsyncGenerator([2, 3, 4]);
      const allEven = await StreamTransformer.every(source, (n) => n % 2 === 0);
      expect(allEven).toBe(false);
    });

    it('should find first matching element', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3, 4]);
      const found = await StreamTransformer.find(source, (n) => n > 2);
      expect(found).toBe(3);
    });

    it('should return undefined when find has no match', async () => {
      const source = arrayToAsyncGenerator([1, 2, 3]);
      const found = await StreamTransformer.find(source, (n) => n > 10);
      expect(found).toBeUndefined();
    });
  });
});

describe('BackpressureController', () => {
  describe('Basic Operations', () => {
    it('should buffer and retrieve chunks', async () => {
      const controller = new BackpressureController<number>();

      await controller.push(1);
      await controller.push(2);

      expect(controller.getBufferSize()).toBe(2);
      expect(controller.pull()).toBe(1);
      expect(controller.pull()).toBe(2);
      expect(controller.isEmpty()).toBe(true);
    });

    it('should pull all chunks at once', async () => {
      const controller = new BackpressureController<number>();

      await controller.push(1);
      await controller.push(2);
      await controller.push(3);

      const all = controller.pullAll();
      expect(all).toEqual([1, 2, 3]);
      expect(controller.isEmpty()).toBe(true);
    });

    it('should return undefined when pulling from empty buffer', () => {
      const controller = new BackpressureController<number>();

      expect(controller.pull()).toBeUndefined();
    });
  });

  describe('Backpressure', () => {
    it('should pause when buffer is full', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 3,
        lowWaterMark: 1,
      });
      let paused = false;

      controller.on('pause', () => { paused = true; });

      await controller.push(1);
      await controller.push(2);
      await controller.push(3);

      expect(paused).toBe(true);
      expect(controller.isPaused()).toBe(true);
    });

    it('should resume when buffer drains below low water mark', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 3,
        lowWaterMark: 1,
      });
      let resumed = false;

      controller.on('resume', () => { resumed = true; });

      await controller.push(1);
      await controller.push(2);
      await controller.push(3);

      // Drain buffer
      controller.pull();
      controller.pull();
      controller.pull();

      expect(resumed).toBe(true);
      expect(controller.isPaused()).toBe(false);
    });

    it('should report fill percentage', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 4,
      });

      await controller.push(1);
      await controller.push(2);

      expect(controller.getFillPercentage()).toBe(50);
    });

    it('should report isFull correctly', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 2,
      });

      await controller.push(1);
      expect(controller.isFull()).toBe(false);

      await controller.push(2);
      expect(controller.isFull()).toBe(true);
    });

    it('should emit drain event when buffer empties after being paused', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 2,
        lowWaterMark: 1,
      });

      const drainPromise = new Promise<void>((resolve) => {
        controller.on('drain', () => resolve());
      });

      // Fill buffer to trigger pause
      await controller.push(1);
      await controller.push(2);

      // Drain completely
      controller.pull();
      controller.pull();

      // Wait for drain event with timeout
      await Promise.race([
        drainPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Drain timeout')), 100))
      ]);

      expect(controller.getBufferSize()).toBe(0);
    });
  });

  describe('Overflow Strategies', () => {
    it('should drop chunks with drop strategy', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 2,
        overflowStrategy: 'drop',
      });
      let dropped = false;

      controller.on('drop', () => { dropped = true; });

      await controller.push(1);
      await controller.push(2);
      const accepted = await controller.push(3);

      expect(accepted).toBe(false);
      expect(dropped).toBe(true);
      expect(controller.getBufferSize()).toBe(2);
    });

    it('should throw with error strategy', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 2,
        overflowStrategy: 'error',
      });

      await controller.push(1);
      await controller.push(2);

      await expect(controller.push(3)).rejects.toThrow('Buffer overflow');
    });

    it('should emit overflow event', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 2,
        overflowStrategy: 'drop',
      });
      let overflowed = false;

      controller.on('overflow', () => { overflowed = true; });

      await controller.push(1);
      await controller.push(2);
      await controller.push(3);

      expect(overflowed).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track statistics', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 3,
        lowWaterMark: 1,
      });

      await controller.push(1);
      await controller.push(2);
      await controller.push(3);
      controller.pull();
      controller.pull();
      controller.pull();

      const stats = controller.getStats();
      expect(stats.totalChunks).toBe(3);
      expect(stats.pauseCount).toBe(1);
      expect(stats.resumeCount).toBe(1);
    });

    it('should track dropped chunks', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 1,
        overflowStrategy: 'drop',
      });

      await controller.push(1);
      await controller.push(2);
      await controller.push(3);

      const stats = controller.getStats();
      expect(stats.droppedChunks).toBe(2);
    });

    it('should track overflow count', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 1,
        overflowStrategy: 'drop',
      });

      await controller.push(1);
      await controller.push(2);

      const stats = controller.getStats();
      expect(stats.overflowCount).toBe(1);
    });
  });

  describe('Reset and Clear', () => {
    it('should reset controller state', async () => {
      const controller = new BackpressureController<number>();

      await controller.push(1);
      await controller.push(2);

      controller.reset();

      expect(controller.isEmpty()).toBe(true);
      expect(controller.getState()).toBe('flowing');
      expect(controller.getStats().totalChunks).toBe(0);
    });

    it('should clear buffer without resetting stats', async () => {
      const controller = new BackpressureController<number>();

      await controller.push(1);
      await controller.push(2);

      controller.clear();

      expect(controller.isEmpty()).toBe(true);
      expect(controller.getStats().totalChunks).toBe(2);
    });
  });

  describe('Dynamic Options', () => {
    it('should update options dynamically', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 10,
      });

      await controller.push(1);
      await controller.push(2);
      await controller.push(3);

      controller.updateOptions({ highWaterMark: 3 });

      expect(controller.isFull()).toBe(true);
    });

    it('should resume if new options allow it', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 2,
        lowWaterMark: 1,
      });

      await controller.push(1);
      await controller.push(2);
      expect(controller.isPaused()).toBe(true);

      controller.updateOptions({ highWaterMark: 10, lowWaterMark: 5 });

      expect(controller.isPaused()).toBe(false);
    });
  });

  describe('State Transitions', () => {
    it('should report correct states during lifecycle', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 2,
        lowWaterMark: 1,
      });

      expect(controller.getState()).toBe('flowing');

      await controller.push(1);
      await controller.push(2);

      expect(controller.getState()).toBe('paused');

      controller.pull();
      controller.pull();

      // After draining, state returns to flowing or drained depending on implementation
      expect(['flowing', 'drained']).toContain(controller.getState());
    });

    it('should transition from paused to flowing when buffer drains', async () => {
      const controller = new BackpressureController<number>({
        highWaterMark: 3,
        lowWaterMark: 1,
      });

      // Fill buffer
      await controller.push(1);
      await controller.push(2);
      await controller.push(3);
      expect(controller.isPaused()).toBe(true);

      // Drain to low water mark
      controller.pull();
      controller.pull();
      expect(controller.isPaused()).toBe(false);
    });
  });
});

describe('withBackpressure helper', () => {
  it('should apply backpressure to stream', async () => {
    const source = arrayToAsyncGenerator([1, 2, 3, 4, 5]);

    const result = await collectAsync(
      withBackpressure(source, { highWaterMark: 10 })
    );

    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle empty stream', async () => {
    const source = arrayToAsyncGenerator<number>([]);

    const result = await collectAsync(
      withBackpressure(source, { highWaterMark: 10 })
    );

    expect(result).toEqual([]);
  });
});
