import { describe, it, expect } from 'vitest';
import { StreamingChunker } from '../../src/channels/streaming-policy.js';

describe('StreamingChunker Surrogates handling', () => {
  it('should not split surrogate pairs across chunks when maxChunkSize is hit', async () => {
    const received: string[] = [];
    const cb = async (chunk: string) => { received.push(chunk); };
    const chunker = new StreamingChunker('x', cb, {
      mode: 'full',
      maxChunkSize: 5,
      chunkDelayMs: 0,
      maxTotalLength: 0,
      stripCodeBlocks: false
    });

    await chunker.write('ab😀😀😀cd');
    await chunker.flush();

    // The text 'ab😀😀😀cd' is:
    // a (1)
    // b (1)
    // 😀 (2 - D83D DE00)
    // 😀 (2 - D83D DE00)
    // 😀 (2 - D83D DE00)
    // c (1)
    // d (1)
    // Length: 10
    //
    // A chunk size of 5 means we'd split at index 5.
    // Index 0: a
    // Index 1: b
    // Index 2: \uD83D (High)
    // Index 3: \uDE00 (Low)
    // Index 4: \uD83D (High) -> End of chunk 1
    // Index 5: \uDE00 (Low) -> Start of chunk 2

    // Check for orphaned surrogates using RegExp
    // High surrogate: \ud800-\udbff
    // Low surrogate: \udc00-\udfff
    const hasOrphanedHigh = /[\ud800-\udbff](?![\udc00-\udfff])/;
    const hasOrphanedLow = /(?<![\ud800-\udbff])[\udc00-\udfff]/;

    for (const chunk of received) {
      expect(hasOrphanedHigh.test(chunk)).toBe(false);
      expect(hasOrphanedLow.test(chunk)).toBe(false);
    }

    // Full string check
    expect(received.join('')).toBe('ab😀😀😀cd');
  });

  it('should fallback properly for truncation at maxTotalLength', async () => {
    const received: string[] = [];
    const cb = async (chunk: string) => { received.push(chunk); };
    const chunker = new StreamingChunker('x', cb, {
      mode: 'full',
      maxChunkSize: 0,
      chunkDelayMs: 0,
      maxTotalLength: 5,
      stripCodeBlocks: false
    });

    await chunker.write('ab😀😀😀cd');
    await chunker.flush();

    const hasOrphanedHigh = /[\ud800-\udbff](?![\udc00-\udfff])/;
    const hasOrphanedLow = /(?<![\ud800-\udbff])[\udc00-\udfff]/;

    for (const chunk of received) {
      expect(hasOrphanedHigh.test(chunk)).toBe(false);
      expect(hasOrphanedLow.test(chunk)).toBe(false);
    }
  });

  it('should leave pure ASCII text unaffected for chunk size', async () => {
    const received: string[] = [];
    const cb = async (chunk: string) => { received.push(chunk); };
    const chunker = new StreamingChunker('x', cb, {
      mode: 'full',
      maxChunkSize: 5,
      chunkDelayMs: 0,
      maxTotalLength: 0,
      stripCodeBlocks: false
    });

    await chunker.write('123456789012'); // 12 chars
    await chunker.flush();

    expect(received).toEqual(['12345', '67890', '12']);
  });
});
