import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompactionSafeguard, extractCompactionRequirements, structuredCompactionSummary } from '../../src/context/compaction-safeguard.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

const source: CodeBuddyMessage[] = [
  { role: 'system', content: 'base' },
  { role: 'assistant', content: 'Decision: use atomic saves\nModified: src/store.ts\nTODO: test restart' },
  { role: 'user', content: 'Finish durable storage' },
];
afterEach(() => vi.unstubAllEnvs());

describe('compaction safeguard', () => {
  for (const field of ['objective', 'modifiedFiles', 'decisions', 'openTasks'] as const) {
    it(`rejects a false summarizer that omits ${field}, then accepts the structured retry`, () => {
      const guard = new CompactionSafeguard();
      const summarize = vi.fn((required, structured) => {
        const degraded = { ...required, [field]: [] };
        return [{ role: 'system', content: structuredCompactionSummary(structured ? required : degraded) }] as CodeBuddyMessage[];
      });
      const truncate = vi.fn(() => source.slice(-1));
      const result = guard.protect(source, summarize, truncate, () => true);
      expect(summarize.mock.calls.map(c => c[1])).toEqual([false, true]);
      expect(JSON.stringify(result)).toContain(extractCompactionRequirements(source)[field][0]);
      expect(truncate).not.toHaveBeenCalled();
      expect(guard.getStats()).toMatchObject({ failures: 0, rejected: 1, retries: 1 });
    });
  }

  it('opens the circuit after N failed compactions and uses safe truncation without another attempt', () => {
    const guard = new CompactionSafeguard(2);
    const summarize = vi.fn(() => [{ role: 'system', content: 'everything is done' }] as CodeBuddyMessage[]);
    const truncate = vi.fn(() => source.slice(-1));
    for (let n = 0; n < 3; n++) expect(guard.protect(source, summarize, truncate, () => true)).toEqual(source.slice(-1));
    expect(summarize).toHaveBeenCalledTimes(4);
    expect(truncate).toHaveBeenCalledTimes(3);
    expect(guard.getStats()).toMatchObject({ failures: 2, circuitOpen: true });
  });

  it('rejects oversized and throwing summaries too', () => {
    const guard = new CompactionSafeguard();
    const summarize = vi.fn(() => { throw new Error('broken'); });
    expect(guard.protect(source, summarize, () => source.slice(-1), () => false)).toEqual(source.slice(-1));
    expect(guard.getStats().rejected).toBe(2);
  });

  it('preserves facts lost by the real ContextManagerV2 default compression', () => {
    const manager = new ContextManagerV2({ maxContextTokens: 900, responseReserveTokens: 50,
      recentMessagesCount: 2, enableEnhancedCompression: false, autoCompactThreshold: 100 });
    const history: CodeBuddyMessage[] = [source[0]!, { ...source[1]!, content: `${'preface '.repeat(25)}\n${source[1]!.content}` },
      ...Array.from({ length: 28 }, (_, i) => ({ role: 'assistant' as const, content: `old ${i}: ${'noise '.repeat(35)}` })), source[2]!];
    try {
      const baseline = manager.prepareMessages(history);
      expect(JSON.stringify(baseline)).not.toContain('src/store.ts');
      vi.stubEnv('CODEBUDDY_COMPACTION_SAFEGUARD', 'true');
      const protectedMessages = manager.prepareMessages(history);
      const text = JSON.stringify(protectedMessages);
      expect(text).toContain('src/store.ts');
      expect(text).toContain('test restart');
      expect(text).toContain('use atomic saves');
      expect(text).toContain('Finish durable storage');
      expect(manager.countTokens(protectedMessages)).toBeLessThanOrEqual(manager.effectiveLimit);
      expect(manager.getCompactionSafeguardStats()).toMatchObject({ retries: 1, fallbacks: 0 });
    } finally { manager.dispose(); }
  });
});

it('the real manager falls back safely and stops retrying after two oversized structured summaries', () => {
  vi.stubEnv('CODEBUDDY_COMPACTION_SAFEGUARD', 'true');
  const manager = new ContextManagerV2({ maxContextTokens: 500, responseReserveTokens: 50,
    recentMessagesCount: 2, enableEnhancedCompression: false, autoCompactThreshold: 100 });
  const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'base' },
    { role: 'assistant', content: `${'preface '.repeat(25)}\nDecision: ${'durable '.repeat(900)}` },
    ...Array.from({ length: 12 }, () => ({ role: 'assistant' as const, content: 'temporary '.repeat(30) })),
    { role: 'user', content: 'Current request' }];
  try {
    for (let n = 0; n < 3; n++) {
      const compacted = manager.prepareMessages(messages);
      expect(compacted.at(-1)?.content).toBe('Current request');
      expect(manager.countTokens(compacted)).toBeLessThanOrEqual(manager.effectiveLimit);
    }
    expect(manager.getCompactionSafeguardStats()).toMatchObject({ failures: 2, retries: 2, fallbacks: 3, circuitOpen: true });
    expect(manager.getMemoryMetrics().summaryCount).toBe(0);
  } finally { manager.dispose(); }
});

it('exports and restores circuit state per conversation, without contaminating another session', () => {
  vi.stubEnv('CODEBUDDY_COMPACTION_SAFEGUARD', 'true');
  const manager = new ContextManagerV2({ maxContextTokens: 500, responseReserveTokens: 50,
    recentMessagesCount: 2, enableEnhancedCompression: false, autoCompactThreshold: 100 });
  const otherSession = manager.exportConversationState();
  const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'base' },
    { role: 'assistant', content: `${'preface '.repeat(25)}\nDecision: ${'durable '.repeat(900)}` },
    { role: 'user', content: 'Current request' }];
  try {
    manager.prepareMessages(messages);
    manager.prepareMessages(messages);
    const state = manager.exportConversationState();
    expect(state.compactionSafeguard?.failures).toBe(2);
    manager.importConversationState(otherSession);
    expect(manager.getCompactionSafeguardStats()).toBeNull();
    manager.importConversationState(state);
    expect(manager.getCompactionSafeguardStats()?.circuitOpen).toBe(true);
  } finally { manager.dispose(); }
});
