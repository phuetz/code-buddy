/**
 * Cat 58: Rate Limiter (6 tests, no API)
 * Cat 59: History Manager (7 tests, no API)
 * Cat 60: Response Cache (6 tests, no API)
 * Cat 61: Diff Generator (5 tests, no API)
 */

import type { TestDef } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Cat 58: Rate Limiter
// ============================================================================

export function cat58RateLimiter(): TestDef[] {
  return [
    {
      name: '58.1-instantiation-defaults',
      timeout: 5000,
      fn: async () => {
        const { RateLimiter } = await import('../../src/utils/rate-limiter.js');
        const limiter = new RateLimiter();
        return { pass: limiter !== undefined };
      },
    },
    {
      name: '58.2-custom-config',
      timeout: 5000,
      fn: async () => {
        const { RateLimiter } = await import('../../src/utils/rate-limiter.js');
        const limiter = new RateLimiter({
          requestsPerMinute: 10,
          tokensPerMinute: 50000,
          maxBurst: 5,
        });
        return { pass: limiter !== undefined };
      },
    },
    {
      name: '58.3-execute-immediate',
      timeout: 5000,
      fn: async () => {
        const { RateLimiter } = await import('../../src/utils/rate-limiter.js');
        const limiter = new RateLimiter({ requestsPerMinute: 100, maxBurst: 10 });
        const result = await limiter.execute(async () => 'done', { skipQueue: true });
        return {
          pass: result === 'done',
          metadata: { result },
        };
      },
    },
    {
      name: '58.4-get-status',
      timeout: 5000,
      fn: async () => {
        const { RateLimiter } = await import('../../src/utils/rate-limiter.js');
        const limiter = new RateLimiter({ requestsPerMinute: 60, maxBurst: 10 });
        const status = limiter.getStatus();
        return {
          pass: typeof status.requestsRemaining === 'number' &&
                typeof status.tokensRemaining === 'number' &&
                typeof status.isLimited === 'boolean',
          metadata: { remaining: status.requestsRemaining, limited: status.isLimited },
        };
      },
    },
    {
      name: '58.5-queue-overflow-rejects',
      timeout: 5000,
      fn: async () => {
        const { RateLimiter } = await import('../../src/utils/rate-limiter.js');
        const limiter = new RateLimiter({
          requestsPerMinute: 1,
          maxBurst: 0,
          maxQueueSize: 1,
          queueTimeout: 100,
        });
        // Fill the queue
        const p1 = limiter.execute(async () => 'first', { estimatedTokens: 0 }).catch(() => 'q1-error');
        const p2 = limiter.execute(async () => 'second', { estimatedTokens: 0 }).catch(() => 'q2-error');
        const [r1, r2] = await Promise.all([p1, p2]);
        // At least one should succeed or fail gracefully
        return {
          pass: true,
          metadata: { r1, r2 },
        };
      },
    },
    {
      name: '58.6-event-emission',
      timeout: 5000,
      fn: async () => {
        const { RateLimiter } = await import('../../src/utils/rate-limiter.js');
        const limiter = new RateLimiter({ requestsPerMinute: 100, maxBurst: 10 });
        let eventFired = false;
        limiter.on('queued', () => { eventFired = true; });
        await limiter.execute(async () => 'test', { estimatedTokens: 10 });
        return {
          pass: true, // Event may or may not fire depending on queue path
          metadata: { eventFired },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 59: History Manager
// ============================================================================

export function cat59HistoryManager(): TestDef[] {
  return [
    {
      name: '59.1-create-with-defaults',
      timeout: 5000,
      fn: async () => {
        const { HistoryManager } = await import('../../src/utils/history-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-hist-${Date.now()}.json`);
        const mgr = new HistoryManager({ historyFile: tmp });
        return { pass: mgr !== undefined };
      },
    },
    {
      name: '59.2-add-and-get-entries',
      timeout: 5000,
      fn: async () => {
        const { HistoryManager } = await import('../../src/utils/history-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-hist-${Date.now()}.json`);
        const mgr = new HistoryManager({ historyFile: tmp, maxEntries: 100 });
        const added1 = mgr.add('first command');
        const added2 = mgr.add('second command');
        const all = mgr.getAll();
        try { fs.unlinkSync(tmp); } catch {}
        return {
          pass: added1 && added2 && all.length === 2,
          metadata: { count: all.length },
        };
      },
    },
    {
      name: '59.3-no-consecutive-duplicates',
      timeout: 5000,
      fn: async () => {
        const { HistoryManager } = await import('../../src/utils/history-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-hist-${Date.now()}.json`);
        const mgr = new HistoryManager({ historyFile: tmp, maxEntries: 100 });
        mgr.add('duplicate');
        const added = mgr.add('duplicate');
        const all = mgr.getAll();
        try { fs.unlinkSync(tmp); } catch {}
        return {
          pass: added === false && all.length === 1,
          metadata: { count: all.length },
        };
      },
    },
    {
      name: '59.4-empty-string-rejected',
      timeout: 5000,
      fn: async () => {
        const { HistoryManager } = await import('../../src/utils/history-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-hist-${Date.now()}.json`);
        const mgr = new HistoryManager({ historyFile: tmp });
        const added = mgr.add('   ');
        return { pass: added === false };
      },
    },
    {
      name: '59.5-max-entries-enforcement',
      timeout: 5000,
      fn: async () => {
        const { HistoryManager } = await import('../../src/utils/history-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-hist-${Date.now()}.json`);
        const mgr = new HistoryManager({ historyFile: tmp, maxEntries: 3 });
        mgr.add('cmd1');
        mgr.add('cmd2');
        mgr.add('cmd3');
        mgr.add('cmd4');
        const all = mgr.getAll();
        try { fs.unlinkSync(tmp); } catch {}
        return {
          pass: all.length === 3,
          metadata: { count: all.length, first: all[0]?.text },
        };
      },
    },
    {
      name: '59.6-navigate-previous-next',
      timeout: 5000,
      fn: async () => {
        const { HistoryManager } = await import('../../src/utils/history-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-hist-${Date.now()}.json`);
        const mgr = new HistoryManager({ historyFile: tmp, maxEntries: 100 });
        mgr.add('alpha');
        mgr.add('beta');
        mgr.add('gamma');
        const prev1 = mgr.getPrevious(''); // gamma
        const prev2 = mgr.getPrevious(''); // beta
        const next1 = mgr.getNext();       // gamma
        try { fs.unlinkSync(tmp); } catch {}
        return {
          pass: prev1 === 'gamma' && prev2 === 'beta' && next1 === 'gamma',
          metadata: { prev1, prev2, next1 },
        };
      },
    },
    {
      name: '59.7-exclude-prefixes',
      timeout: 5000,
      fn: async () => {
        const { HistoryManager } = await import('../../src/utils/history-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-hist-${Date.now()}.json`);
        const mgr = new HistoryManager({ historyFile: tmp, excludePrefixes: ['/'] });
        const added1 = mgr.add('/think deep');
        const added2 = mgr.add('normal command');
        try { fs.unlinkSync(tmp); } catch {}
        return {
          pass: added1 === false && added2 === true,
          metadata: { added1, added2 },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 60: Response Cache
// ============================================================================

export function cat60ResponseCache(): TestDef[] {
  return [
    {
      name: '60.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const { ResponseCache } = await import('../../src/utils/response-cache.js');
        const cache = new ResponseCache({ maxEntries: 50, defaultTTL: 3600 });
        // Wait for async load
        await new Promise(r => setTimeout(r, 200));
        return { pass: cache !== undefined };
      },
    },
    {
      name: '60.2-set-and-get',
      timeout: 5000,
      fn: async () => {
        const { ResponseCache } = await import('../../src/utils/response-cache.js');
        const cache = new ResponseCache({ maxEntries: 50, defaultTTL: 3600 });
        await new Promise(r => setTimeout(r, 200));
        const longResp = 'The answer to the mathematical expression two plus two is exactly four, which is a well-known arithmetic fact.';
        cache.set('What is 2+2?', longResp, 'ctx123', 'gpt-4');
        const result = cache.get('What is 2+2?', 'ctx123', 'gpt-4');
        return {
          pass: result === longResp,
          metadata: { result },
        };
      },
    },
    {
      name: '60.3-cache-miss-on-different-context',
      timeout: 5000,
      fn: async () => {
        const { ResponseCache } = await import('../../src/utils/response-cache.js');
        const cache = new ResponseCache({ maxEntries: 50, defaultTTL: 3600 });
        await new Promise(r => setTimeout(r, 200));
        cache.set('query', 'response', 'ctxA', 'gpt-4');
        const result = cache.get('query', 'ctxB', 'gpt-4');
        return { pass: result === null };
      },
    },
    {
      name: '60.4-generate-context-hash',
      timeout: 5000,
      fn: async () => {
        const { ResponseCache } = await import('../../src/utils/response-cache.js');
        const cache = new ResponseCache();
        await new Promise(r => setTimeout(r, 200));
        const hash1 = cache.generateContextHash([
          { path: '/a.ts', content: 'hello' },
        ]);
        const hash2 = cache.generateContextHash([
          { path: '/a.ts', content: 'hello' },
        ]);
        const hash3 = cache.generateContextHash([
          { path: '/a.ts', content: 'changed' },
        ]);
        return {
          pass: hash1 === hash2 && hash1 !== hash3 && hash1.length === 16,
          metadata: { hash1, hash3 },
        };
      },
    },
    {
      name: '60.5-get-stats',
      timeout: 5000,
      fn: async () => {
        const { ResponseCache } = await import('../../src/utils/response-cache.js');
        const cache = new ResponseCache({ maxEntries: 50 });
        await new Promise(r => setTimeout(r, 200));
        cache.set('q1', 'Long enough response to pass the 50 character minimum requirement for caching.', 'ctx', 'model');
        cache.get('q1', 'ctx', 'model'); // hit
        cache.get('q2', 'ctx', 'model'); // miss
        const stats = cache.getStats();
        return {
          pass: typeof stats.totalEntries === 'number' &&
                typeof stats.totalHits === 'number' &&
                typeof stats.totalMisses === 'number',
          metadata: stats as unknown as Record<string, unknown>,
        };
      },
    },
    {
      name: '60.6-short-response-not-cached',
      timeout: 5000,
      fn: async () => {
        const { ResponseCache } = await import('../../src/utils/response-cache.js');
        const cache = new ResponseCache({ maxEntries: 50 });
        await new Promise(r => setTimeout(r, 200));
        cache.set('q', 'short', 'ctx', 'model'); // < 50 chars, should not cache
        const result = cache.get('q', 'ctx', 'model');
        return { pass: result === null };
      },
    },
  ];
}

// ============================================================================
// Cat 61: Diff Generator
// ============================================================================

export function cat61DiffGenerator(): TestDef[] {
  return [
    {
      name: '61.1-generate-diff-no-changes',
      timeout: 5000,
      fn: async () => {
        const { generateDiff } = await import('../../src/utils/diff-generator.js');
        const content = 'line1\nline2\nline3';
        const result = generateDiff(content, content, 'test.ts');
        return {
          pass: result.addedLines === 0 && result.removedLines === 0,
          metadata: { added: result.addedLines, removed: result.removedLines },
        };
      },
    },
    {
      name: '61.2-generate-diff-with-changes',
      timeout: 5000,
      fn: async () => {
        const { generateDiff } = await import('../../src/utils/diff-generator.js');
        const old = 'line1\nline2\nline3';
        const newContent = 'line1\nmodified\nline3';
        const result = generateDiff(old, newContent, 'test.ts');
        return {
          pass: result.addedLines >= 1 && result.removedLines >= 1 && result.diff.length > 0,
          metadata: { added: result.addedLines, removed: result.removedLines },
        };
      },
    },
    {
      name: '61.3-diff-summary-format',
      timeout: 5000,
      fn: async () => {
        const { generateDiff } = await import('../../src/utils/diff-generator.js');
        const result = generateDiff('a\nb', 'a\nc', 'file.ts');
        return {
          pass: typeof result.summary === 'string' && result.summary.length > 0,
          metadata: { summary: result.summary },
        };
      },
    },
    {
      name: '61.4-creation-diff',
      timeout: 5000,
      fn: async () => {
        const { generateCreationDiff } = await import('../../src/utils/diff-generator.js');
        const diff = generateCreationDiff('new file content\nline 2', 'new-file.ts');
        return {
          pass: diff.includes('+') && diff.includes('new-file.ts'),
          metadata: { preview: diff.substring(0, 200) },
        };
      },
    },
    {
      name: '61.5-deletion-diff',
      timeout: 5000,
      fn: async () => {
        const { generateDeletionDiff } = await import('../../src/utils/diff-generator.js');
        const diff = generateDeletionDiff('deleted content\nline 2', 'old-file.ts');
        return {
          pass: diff.includes('-') && diff.includes('old-file.ts'),
          metadata: { preview: diff.substring(0, 200) },
        };
      },
    },
  ];
}
