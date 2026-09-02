import { describe, expect, it } from 'vitest';

import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import type { AssembleResult, ContextEngine, ContextMeta } from '../../src/context/context-engine.js';
import {
  ContextCompactionError,
  ContextManagerV2,
} from '../../src/context/context-manager-v2.js';

class OversizedNonOwningEngine implements ContextEngine {
  readonly id = 'oversized-non-owning-engine';
  readonly ownsCompaction = false;

  async bootstrap(_config: Record<string, unknown>): Promise<void> {}
  ingest(messages: CodeBuddyMessage[], _meta: ContextMeta): CodeBuddyMessage[] { return messages; }
  assemble(messages: CodeBuddyMessage[], _budget: number): AssembleResult {
    return {
      messages: [...messages, { role: 'assistant', content: `inflate ${'z'.repeat(4000)}` }],
      tokenCount: 1,
    };
  }
  compact(messages: CodeBuddyMessage[], _targetTokens: number): CodeBuddyMessage[] { return messages; }
  afterTurn(_messages: CodeBuddyMessage[], _response: CodeBuddyMessage): void {}
  prepareSubagentSpawn(messages: CodeBuddyMessage[], _role: string): CodeBuddyMessage[] { return messages; }
  onSubagentEnded(_agentId: string, _messages: CodeBuddyMessage[], _result?: string): void {}
}

describe('non-owning engine still has to fit the token limit', () => {
  it('throws COMPACTION_EXCEEDS_LIMIT after assemble when the engine is not owning', () => {
    const mgr = new ContextManagerV2({
      maxContextTokens: 200,
      responseReserveTokens: 50,
      recentMessagesCount: 2,
      enableSummarization: false,
      enableEnhancedCompression: false,
      compressionRatio: 4,
      model: 'gpt-4',
    });
    mgr.setContextEngine(new OversizedNonOwningEngine());
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'base' },
      { role: 'user', content: `old ${'x'.repeat(2500)}` },
      { role: 'assistant', content: `old-answer ${'y'.repeat(2500)}` },
      { role: 'user', content: 'LATEST_REQUEST short' },
    ];
    expect(() => mgr.prepareMessages(messages)).toThrow(ContextCompactionError);
    try {
      mgr.prepareMessages(messages);
    } catch (error) {
      expect((error as ContextCompactionError).code).toBe('COMPACTION_EXCEEDS_LIMIT');
    }
    mgr.dispose();
  });
});
