/**
 * R29 D2 — une compaction qui ne tient pas sous la limite doit échouer
 * explicitement (ok: false), jamais renvoyer un tableau encore trop grand
 * en prétendant que l'auto-compact a réussi.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import {
  ContextCompactionError,
  ContextManagerV2,
} from '../../src/context/context-manager-v2.js';
import { logger } from '../../src/utils/logger.js';

function createManager(overrides: Record<string, unknown> = {}): ContextManagerV2 {
  return new ContextManagerV2({
    maxContextTokens: 500,
    responseReserveTokens: 25,
    recentMessagesCount: 2,
    enableSummarization: true,
    enableEnhancedCompression: false,
    compressionRatio: 4,
    model: 'gpt-4',
    autoCompactThreshold: 80,
    ...overrides,
  });
}

describe('R29 D2 — compaction hors limite refusée', () => {
  it('throws when even the pinned request plus system prompts exceed the budget', () => {
    const mgr = createManager();
    const lastUser: CodeBuddyMessage = { role: 'user', content: 'LATEST_REQUEST' };
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: `SYS_A ${'a'.repeat(1200)}` },
      { role: 'system', content: `SYS_B ${'b'.repeat(1200)}` },
    ];
    for (let i = 0; i < 12; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i} ${'c'.repeat(80)}`,
      });
    }
    messages.push(lastUser);

    const irreducible = mgr.countTokens([
      messages[0]!,
      messages[1]!,
      lastUser,
    ]);
    expect(irreducible).toBeGreaterThan(mgr.effectiveLimit);
    expect(mgr.countTokens([lastUser])).toBeLessThanOrEqual(mgr.effectiveLimit);

    const infoSpy = vi.spyOn(logger, 'info');
    let caught: unknown;
    try {
      mgr.prepareMessages(messages);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContextCompactionError);
    const compactionError = caught as ContextCompactionError;
    expect(compactionError.ok).toBe(false);
    expect(compactionError.code).toBe('COMPACTION_EXCEEDS_LIMIT');
    expect(compactionError.tokens).toBeGreaterThan(compactionError.limit);
    expect(compactionError.message).toMatch(/not sent to the model/i);
    expect(infoSpy.mock.calls.some(call => String(call[0]).includes('Auto-compact: Reduced'))).toBe(false);
    mgr.dispose();
  });

  it('keeps the result at or under the limit when a valid reduction exists', () => {
    const mgr = createManager({
      maxContextTokens: 800,
      responseReserveTokens: 50,
      recentMessagesCount: 3,
    });
    const lastUser: CodeBuddyMessage = { role: 'user', content: 'LATEST_REQUEST please keep me' };
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'short system' },
      { role: 'system', content: 'lessons' },
    ];
    for (let i = 0; i < 30; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}: ${'x'.repeat(160)}`,
      });
    }
    messages.push(lastUser);

    expect(mgr.getStats(messages).totalTokens).toBeGreaterThan(mgr.effectiveLimit);

    const prepared = mgr.prepareMessages(messages);
    expect(mgr.countTokens(prepared)).toBeLessThanOrEqual(mgr.effectiveLimit);
    expect(prepared.filter(m => m.role === 'user').at(-1)?.content).toBe(lastUser.content);
    mgr.dispose();
  });
});
