/**
 * R29 D3 — après un repli, les statistiques décrivent le résultat réellement
 * envoyé, pas la tentative enhanced rejetée.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import type { EnhancedCompressionResult } from '../../src/context/types.js';

const REJECTED_STRATEGIES = [
  'sliding_window_overlap',
  'smart_tool_truncation',
  'intelligent_summarization',
  'importance_removal',
];

function rejectedEnhancedResult(): EnhancedCompressionResult {
  return {
    compressed: true,
    messages: [{ role: 'system', content: 'enhanced dropped the current request' }],
    tokensReduced: 1124,
    strategy: 'importance_weighted',
    metrics: {
      originalTokens: 2000,
      finalTokens: 876,
      compressionRatio: 2000 / 876,
      messagesRemoved: 20,
      messagesSummarized: 1,
      toolResultsTruncated: 4,
      compressionTimeMs: 3,
      estimatedRetention: 876 / 2000,
      strategiesApplied: [...REJECTED_STRATEGIES],
    },
    preservedInfo: {
      decisions: [],
      errors: [],
      modifiedFiles: [],
      codeSnippets: [],
      toolCalls: [],
    },
  };
}

describe('R29 D3 — stats du résultat réellement envoyé', () => {
  it('does not keep rejected enhanced metrics after a successful legacy fallback', () => {
    const mgr = new ContextManagerV2({
      maxContextTokens: 800,
      responseReserveTokens: 50,
      recentMessagesCount: 3,
      enableSummarization: true,
      enableEnhancedCompression: true,
      compressionRatio: 4,
      model: 'gpt-4',
      autoCompactThreshold: 100,
    });
    const lastUser: CodeBuddyMessage = { role: 'user', content: 'LATEST_REQUEST keep stats honest' };
    const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'short system' }];
    for (let i = 0; i < 24; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}: ${'x'.repeat(140)}`,
      });
    }
    messages.push(lastUser);

    const host = mgr as unknown as { enhancedCompressor: { compress: (msgs: CodeBuddyMessage[], limit: number) => EnhancedCompressionResult } };
    vi.spyOn(host.enhancedCompressor, 'compress').mockReturnValue(rejectedEnhancedResult());

    const prepared = mgr.prepareMessages(messages);
    const sentTokens = mgr.countTokens(prepared);
    const metrics = mgr.getLastCompressionMetrics();
    const stats = mgr.getCompressionStats();

    expect(prepared.filter(m => m.role === 'user').at(-1)?.content).toBe(lastUser.content);
    expect(sentTokens).toBeLessThanOrEqual(mgr.effectiveLimit);
    expect(metrics?.finalTokens).toBe(sentTokens);
    expect(metrics?.finalTokens).not.toBe(876);
    expect(stats.lastStrategiesUsed).not.toEqual(REJECTED_STRATEGIES);
    expect(stats.lastStrategiesUsed.some(name => REJECTED_STRATEGIES.includes(name))).toBe(false);
    mgr.dispose();
  });
});
