import { ChunkProcessor } from '../../src/streaming/chunk-processor.js';
import { StreamHandler } from '../../src/streaming/stream-handler.js';
import { StreamEvent } from '../../src/streaming/types.js';

describe('ChunkProcessor', () => {
  let processor: ChunkProcessor;

  beforeEach(() => {
    processor = new ChunkProcessor();
  });

  it('should process content deltas', () => {
    const chunk1 = { choices: [{ delta: { content: 'Hello' } }] };
    const chunk2 = { choices: [{ delta: { content: ' world' } }] };

    const events1 = processor.processDelta(chunk1);
    const events2 = processor.processDelta(chunk2);

    expect(events1).toEqual([{ type: 'content', content: 'Hello' }]);
    expect(events2).toEqual([{ type: 'content', content: ' world' }]);
    expect(processor.getAccumulatedContent()).toBe('Hello world');
  });

  it('should accumulate tool calls from deltas', () => {
    const chunk1 = { 
      choices: [{ 
        delta: { 
          tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '{"com' } }] 
        } 
      }] 
    };
    const chunk2 = { 
      choices: [{ 
        delta: { 
          tool_calls: [{ index: 0, function: { arguments: 'mand":"ls"}' } }] 
        } 
      }] 
    };

    processor.processDelta(chunk1);
    processor.processDelta(chunk2);

    const toolCalls = processor.getToolCalls();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('bash');
    expect(toolCalls[0].function.arguments).toBe('{"command":"ls"}');
  });

  it('should extract commentary-style tool calls', () => {
    const chunk = { choices: [{ delta: { content: 'Thinking... commentary to=bash {"command":"ls"}' } }] };
    
    processor.processDelta(chunk);
    const toolCalls = processor.getToolCalls();

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('bash');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ command: 'ls' });
  });

  it('should sanitize content by default', () => {
    const chunk = { choices: [{ delta: { content: '<|thought|>Hello world<|end|>' } }] };
    
    const events = processor.processDelta(chunk);
    expect(events[0].content).toBe('Hello world');
  });
});

describe('StreamHandler', () => {
  let handler: StreamHandler;

  beforeEach(() => {
    handler = new StreamHandler();
  });

  async function* mockStream(chunks: any[]) {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  it('should handle a simple content stream', async () => {
    const stream = mockStream([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' } }] }
    ]);

    const events: StreamEvent[] = [];
    for await (const event of handler.handleStream(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(3); // 'Hello', ' world', 'done'
    expect(events[0]).toEqual({ type: 'content', content: 'Hello' });
    expect(events[1]).toEqual({ type: 'content', content: ' world' });
    expect(events[2]).toEqual({ type: 'done' });
    
    const stats = handler.getStats();
    expect(stats.chunkCount).toBe(2);
    expect(stats.contentLength).toBe(11);
  });

  it('should handle abort signal', async () => {
    const controller = new AbortController();
    const stream = mockStream([
      { choices: [{ delta: { content: 'Start' } }] },
      { choices: [{ delta: { content: 'Cancelled' } }] }
    ]);

    const events: StreamEvent[] = [];
    const generator = handler.handleStream(stream, controller.signal);
    
    // Get first chunk
    const r1 = await generator.next();
    if (!r1.done) events.push(r1.value);
    
    // Abort
    controller.abort();
    
    // Try to get next
    const r2 = await generator.next();
    if (!r2.done) events.push(r2.value);

    expect(events.some(e => e.type === 'error' && e.error?.includes('cancelled'))).toBe(true);
  });
});
