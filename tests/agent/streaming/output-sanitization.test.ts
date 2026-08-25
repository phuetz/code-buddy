import { describe, expect, it } from 'vitest';
import { StreamingHandler, type RawStreamingChunk } from '../../../src/agent/streaming/index.js';

function contentChunk(content: string): RawStreamingChunk {
  return { choices: [{ delta: { content } }] };
}

describe('StreamingHandler incremental output sanitization', () => {
  it('does not expose a think block split across provider chunks', () => {
    const handler = new StreamingHandler({ trackTokens: false });
    const displayed = [
      handler.accumulateChunk(contentChunk('<thi')).displayContent,
      handler.accumulateChunk(contentChunk('nk>secret reasoning')).displayContent,
      handler.accumulateChunk(contentChunk('</think>visible answer')).displayContent,
    ].join('');

    expect(displayed).toBe('visible answer');
  });

  it('does not expose a ChatML token split across provider chunks', () => {
    const handler = new StreamingHandler({ trackTokens: false });
    const displayed = [
      handler.accumulateChunk(contentChunk('<|im_')).displayContent,
      handler.accumulateChunk(contentChunk('start|>visible answer')).displayContent,
    ].join('');

    expect(displayed).toBe('visible answer');
  });

  it('flushes a benign trailing marker prefix when the stream completes', () => {
    const handler = new StreamingHandler({ trackTokens: false });
    const displayed = handler.accumulateChunk(contentChunk('comparison <')).displayContent;

    expect(displayed + handler.flushDisplayContent()).toBe('comparison <');
  });
});
