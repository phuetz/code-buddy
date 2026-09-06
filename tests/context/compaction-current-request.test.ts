/**
 * R29 D1 — la compaction ne doit jamais supprimer ni modifier la requête
 * utilisateur courante. Si elle dépasse à elle seule le budget, l'appelant
 * reçoit une erreur typée (pas un tableau « compacté » hors sujet).
 */
import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import {
  ContextCompactionError,
  ContextManagerV2,
} from '../../src/context/context-manager-v2.js';

function createManager(overrides: Record<string, unknown> = {}): ContextManagerV2 {
  return new ContextManagerV2({
    maxContextTokens: 500,
    responseReserveTokens: 25,
    recentMessagesCount: 2,
    enableSummarization: true,
    enableEnhancedCompression: true,
    compressionRatio: 4,
    model: 'gpt-4',
    autoCompactThreshold: 100,
    ...overrides,
  });
}

describe('R29 D1 — requête utilisateur courante inviolable', () => {
  it('throws when the last user message alone exceeds the context window', () => {
    const mgr = createManager();
    const lastUser: CodeBuddyMessage = {
      role: 'user',
      content: `LATEST_REQUEST ${'x'.repeat(5000)}`,
    };
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      lastUser,
    ];

    const lastUserTokens = mgr.countTokens([lastUser]);
    expect(lastUserTokens).toBeGreaterThan(mgr.effectiveLimit);

    let caught: unknown;
    try {
      mgr.prepareMessages(messages);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContextCompactionError);
    const compactionError = caught as ContextCompactionError;
    expect(compactionError.ok).toBe(false);
    expect(compactionError.code).toBe('CURRENT_REQUEST_EXCEEDS_BUDGET');
    expect(compactionError.tokens).toBe(lastUserTokens);
    expect(compactionError.limit).toBe(mgr.effectiveLimit);
    expect(compactionError.message).toMatch(/not sent to the model/i);
    mgr.dispose();
  });

  it('keeps the last user message intact when history is compacted', () => {
    const mgr = createManager({
      maxContextTokens: 800,
      responseReserveTokens: 50,
      recentMessagesCount: 3,
    });
    const lastUser: CodeBuddyMessage = {
      role: 'user',
      content: 'LATEST_REQUEST please answer this exact question',
    };
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'base' },
    ];
    for (let i = 0; i < 24; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}: ${'y'.repeat(180)}`,
      });
    }
    messages.push(lastUser);

    const prepared = mgr.prepareMessages(messages);
    const preserved = prepared.filter(m => m.role === 'user').at(-1);

    expect(prepared.length).toBeLessThan(messages.length);
    expect(preserved?.content).toBe(lastUser.content);
    expect(mgr.countTokens([preserved!])).toBe(mgr.countTokens([lastUser]));
    mgr.dispose();
  });

  it('keeps a multimodal last user message that is followed by tool turns', () => {
    const mgr = createManager({
      maxContextTokens: 2500,
      responseReserveTokens: 100,
      recentMessagesCount: 2,
      autoCompactThreshold: 400,
    });
    const lastUser: CodeBuddyMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'LATEST_REQUEST describe the image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    };
    const messages: CodeBuddyMessage[] = [];
    for (let i = 0; i < 24; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `history ${i}: ${'z'.repeat(280)}`,
      });
    }
    messages.push(lastUser);
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'view_file', arguments: '{}' } }],
    } as CodeBuddyMessage);
    messages.push({
      role: 'tool',
      tool_call_id: 'call_1',
      content: `tool output ${'w'.repeat(400)}`,
    } as CodeBuddyMessage);

    const prepared = mgr.prepareMessages(messages);
    const preserved = [...prepared].reverse().find(m => m.role === 'user');

    expect(JSON.stringify(preserved?.content)).toBe(JSON.stringify(lastUser.content));
    mgr.dispose();
  });
});
