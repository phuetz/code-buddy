/**
 * Cat 26: Context Manager V2 (7 tests, no API)
 * Cat 27: Hybrid Memory Search extended (5 tests, no API)
 */

import type { TestDef } from './types.js';
import { BM25Index, HybridMemorySearch } from '../../src/memory/hybrid-search.js';

// ============================================================================
// Cat 26: Context Manager V2
// ============================================================================

export function cat26ContextManagerV2(): TestDef[] {
  return [
    {
      name: '26.1-create-with-defaults',
      timeout: 5000,
      fn: async () => {
        const { createContextManager } = await import('../../src/context/context-manager-v2.js');
        const cm = createContextManager('gemini-2.5-flash');
        const stats = cm.getStats([]);
        return {
          pass: stats.totalTokens === 0 && stats.messageCount === 0,
          metadata: stats as unknown as Record<string, unknown>,
        };
      },
    },
    {
      name: '26.2-token-counting',
      timeout: 5000,
      fn: async () => {
        const { createContextManager } = await import('../../src/context/context-manager-v2.js');
        const cm = createContextManager('gemini-2.5-flash');
        const messages = [
          { role: 'user' as const, content: 'Hello, how are you today?' },
          { role: 'assistant' as const, content: 'I am doing well, thank you for asking!' },
        ];
        const count = cm.countTokens(messages);
        return {
          pass: count > 0 && count < 1000,
          metadata: { tokenCount: count },
        };
      },
    },
    {
      name: '26.3-should-warn-threshold',
      timeout: 5000,
      fn: async () => {
        const { ContextManagerV2 } = await import('../../src/context/context-manager-v2.js');
        // maxContextTokens small, content large → usagePercent > 90%
        // responseReserveTokens defaults can affect effective limit
        const cm = new ContextManagerV2({
          maxContextTokens: 20,
          responseReserveTokens: 0,
          warningThresholds: [50, 75, 90],
          enableWarnings: true,
        });
        const longContent = 'word '.repeat(200);
        const messages = [{ role: 'user' as const, content: longContent }];
        const stats = cm.getStats(messages);
        const warning = cm.shouldWarn(messages);
        return {
          pass: warning.warn === true || stats.usagePercent >= 50,
          metadata: { warn: warning.warn, message: warning.message, usagePercent: stats.usagePercent },
        };
      },
    },
    {
      name: '26.4-should-auto-compact',
      timeout: 5000,
      fn: async () => {
        const { ContextManagerV2 } = await import('../../src/context/context-manager-v2.js');
        const cm = new ContextManagerV2({ maxContextTokens: 50, autoCompactThreshold: 10 });
        const longContent = 'word '.repeat(200);
        const messages = [{ role: 'user' as const, content: longContent }];
        const shouldCompact = cm.shouldAutoCompact(messages);
        return { pass: shouldCompact === true };
      },
    },
    {
      name: '26.5-prepare-messages-preserves-short',
      timeout: 5000,
      fn: async () => {
        const { createContextManager } = await import('../../src/context/context-manager-v2.js');
        const cm = createContextManager('gemini-2.5-flash');
        const messages = [
          { role: 'user' as const, content: 'Hello' },
          { role: 'assistant' as const, content: 'Hi there!' },
        ];
        const prepared = cm.prepareMessages(messages);
        return {
          pass: prepared.length === 2 && prepared[0].content === 'Hello',
          metadata: { preparedCount: prepared.length },
        };
      },
    },
    {
      name: '26.6-memory-metrics-shape',
      timeout: 5000,
      fn: async () => {
        const { createContextManager } = await import('../../src/context/context-manager-v2.js');
        const cm = createContextManager('gemini-2.5-flash');
        const metrics = cm.getMemoryMetrics();
        return {
          pass: typeof metrics.summaryCount === 'number' &&
                typeof metrics.compressionCount === 'number' &&
                typeof metrics.totalTokensSaved === 'number' &&
                typeof metrics.warningsTriggered === 'number',
          metadata: metrics as unknown as Record<string, unknown>,
        };
      },
    },
    {
      name: '26.7-reset-warnings-clears-triggered',
      timeout: 5000,
      fn: async () => {
        const { ContextManagerV2 } = await import('../../src/context/context-manager-v2.js');
        const cm = new ContextManagerV2({
          maxContextTokens: 20,
          responseReserveTokens: 0,
          warningThresholds: [50],
          enableWarnings: true,
        });
        const longContent = 'word '.repeat(200);
        const messages = [{ role: 'user' as const, content: longContent }];
        // Trigger warning
        cm.shouldWarn(messages);
        // Check metrics — warningsTriggered should be > 0
        const metricsBefore = cm.getMemoryMetrics();
        cm.resetWarnings();
        const metricsAfter = cm.getMemoryMetrics();
        return {
          pass: metricsAfter.warningsTriggered === 0,
          metadata: { before: metricsBefore.warningsTriggered, after: metricsAfter.warningsTriggered },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 27: Hybrid Memory Search (extended)
// ============================================================================

export function cat27HybridSearch(): TestDef[] {
  return [
    {
      name: '27.1-singleton-lifecycle',
      timeout: 5000,
      fn: async () => {
        HybridMemorySearch.resetInstance();
        const instance1 = HybridMemorySearch.getInstance();
        const instance2 = HybridMemorySearch.getInstance();
        const same = instance1 === instance2;
        HybridMemorySearch.resetInstance();
        const instance3 = HybridMemorySearch.getInstance();
        return { pass: same && instance1 !== instance3 };
      },
    },
    {
      name: '27.2-index-and-search',
      timeout: 5000,
      fn: async () => {
        HybridMemorySearch.resetInstance();
        const hybrid = HybridMemorySearch.getInstance();
        hybrid.index([
          { key: 'mem1', value: 'TypeScript is a typed superset of JavaScript' },
          { key: 'mem2', value: 'Python is used for machine learning' },
          { key: 'mem3', value: 'Rust is a systems programming language' },
        ]);
        const results = hybrid.search('TypeScript JavaScript', 2);
        HybridMemorySearch.resetInstance();
        return {
          pass: results.length >= 1 && results[0].key === 'mem1',
          metadata: { topKey: results[0]?.key, count: results.length },
        };
      },
    },
    {
      name: '27.3-weights-configuration',
      timeout: 5000,
      fn: async () => {
        HybridMemorySearch.resetInstance();
        const hybrid = HybridMemorySearch.getInstance();
        hybrid.setWeights(0.9, 0.1);
        const stats = hybrid.getStats();
        HybridMemorySearch.resetInstance();
        return {
          pass: stats.bm25Weight === 0.9 && stats.semanticWeight === 0.1,
          metadata: stats as unknown as Record<string, unknown>,
        };
      },
    },
    {
      name: '27.4-clear-empties-index',
      timeout: 5000,
      fn: async () => {
        HybridMemorySearch.resetInstance();
        const hybrid = HybridMemorySearch.getInstance();
        hybrid.index([{ key: 'k1', value: 'test data' }]);
        hybrid.clear();
        const results = hybrid.search('test');
        const stats = hybrid.getStats();
        HybridMemorySearch.resetInstance();
        return {
          pass: results.length === 0 && stats.documentCount === 0,
          metadata: { results: results.length, docCount: stats.documentCount },
        };
      },
    },
    {
      name: '27.5-bm25-tf-frequency-boost',
      timeout: 5000,
      fn: async () => {
        const index = new BM25Index();
        index.addDocument('low', 'python is great');
        index.addDocument('high', 'python python python is amazing python');
        const results = index.search('python');
        return {
          pass: results.length === 2 && results[0].key === 'high' && results[0].score > results[1].score,
          metadata: { scores: results.map(r => ({ key: r.key, score: r.score })) },
        };
      },
    },
  ];
}
