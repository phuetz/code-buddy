import { describe, expect, it } from 'vitest';

import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { EnhancedContextCompressor } from '../../src/context/enhanced-compression.js';
import { SegmentIntegrityError } from '../../src/context/segment-archive.js';
import { createTokenCounter } from '../../src/context/token-counter.js';

describe('recoverContext hash', () => {
  it('refuses to recover an archive whose messages no longer match the stored hash', () => {
    const compressor = new EnhancedContextCompressor(createTokenCounter('gpt-4'), {
      enableArchiving: true,
      maxArchives: 5,
      slidingWindow: { windowSize: 2, overlapSize: 0, summarizeOldMessages: false },
    });
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'base' },
      { role: 'user', content: 'keep this' },
    ];
    compressor.compress(messages, 1);
    const archives = compressor.listArchives();
    expect(archives.length).toBeGreaterThan(0);
    const latest = (compressor as unknown as {
      archives: Array<{ messages: CodeBuddyMessage[] }>;
    }).archives.at(-1);
    expect(latest).toBeDefined();
    latest!.messages[1] = { role: 'user', content: 'tampered' };
    expect(() => compressor.recoverContext()).toThrow(SegmentIntegrityError);
  });
});
