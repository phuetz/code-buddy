import { describe, expect, it, vi } from 'vitest';

import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';

describe('enhanced compression stats', () => {
  it('recounts tokens with countTokens after accepting an enhanced result', () => {
    const mgr = new ContextManagerV2({
      maxContextTokens: 4000,
      responseReserveTokens: 100,
      recentMessagesCount: 2,
      enableSummarization: true,
      enableEnhancedCompression: true,
      compressionRatio: 4,
      model: 'gpt-4',
      autoCompactThreshold: 100,
    });
    const compressor = mgr['enhancedCompressor'];
    expect(compressor).toBeTruthy();
    const original = compressor!.compress.bind(compressor);
    vi.spyOn(compressor!, 'compress').mockImplementation((messages, tokenLimit, sessionId) => {
      const result = original(messages, tokenLimit, sessionId);
      return {
        ...result,
        metrics: {
          ...result.metrics,
          finalTokens: 1,
        },
      };
    });

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
    ];
    for (let i = 0; i < 20; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i} ${'y'.repeat(220)}`,
      });
    }
    messages.push({ role: 'user', content: 'LATEST_REQUEST please keep this' });

    const prepared = mgr.prepareMessages(messages);
    const recounted = mgr.countTokens(prepared);
    expect(mgr.getLastCompressionResult()?.metrics.finalTokens).toBe(recounted);
    expect(recounted).toBeGreaterThan(1);
    mgr.dispose();
  });
});
