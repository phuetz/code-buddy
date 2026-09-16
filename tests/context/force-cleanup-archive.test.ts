/**
 * R29 D4 — forceCleanup() doit réellement lâcher le dernier contexte complet
 * retenu via lastEnhancedResult, pas seulement vider la liste d'archives.
 */
import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';

function retainedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

describe('R29 D4 — forceCleanup libère le dernier contexte complet', () => {
  it('nulls lastEnhancedResult and drops retained archive size', () => {
    const mgr = new ContextManagerV2({
      maxContextTokens: 700,
      responseReserveTokens: 40,
      recentMessagesCount: 4,
      enableSummarization: true,
      enableEnhancedCompression: true,
      compressionRatio: 4,
      model: 'gpt-4',
      autoCompactThreshold: 80,
    });

    const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'base prompt' }];
    for (let i = 0; i < 10; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `msg ${i}: ${'q'.repeat(220)}`,
      });
    }
    expect(messages).toHaveLength(11);

    mgr.prepareMessages(messages);
    const last = mgr.getLastCompressionResult();
    expect(last).not.toBeNull();
    const archivedCount = last?.fullContextArchive?.messages.length
      ?? last?.messages.length
      ?? 0;
    expect(archivedCount).toBeGreaterThanOrEqual(11);

    const sizeBefore = retainedBytes(last);
    expect(sizeBefore).toBeGreaterThan(500);
    expect(mgr.listContextArchives().length).toBeGreaterThan(0);

    const cleanup = mgr.forceCleanup();
    expect(mgr.listContextArchives()).toHaveLength(0);
    expect(mgr.getLastCompressionResult()).toBeNull();
    expect(retainedBytes(mgr.getLastCompressionResult())).toBeLessThan(sizeBefore);
    expect(cleanup.tokensFreed).toBeGreaterThan(0);
    mgr.dispose();
  });
});
