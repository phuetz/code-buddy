/**
 * Cat 76: Observation Variator (6 tests, no API)
 * Cat 77: Restorable Compression (7 tests, no API)
 * Cat 78: Head-Tail Truncation (7 tests, no API)
 * Cat 79: Stable JSON (5 tests, no API)
 * Cat 80: Context Manager V3 (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 76: Observation Variator
// ============================================================================

export function cat76ObservationVariator(): TestDef[] {
  return [
    {
      name: '76.1-singleton-access',
      timeout: 5000,
      fn: async () => {
        const { getObservationVariator } = await import('../../src/context/observation-variator.js');
        const v1 = getObservationVariator();
        const v2 = getObservationVariator();
        return { pass: v1 === v2 };
      },
    },
    {
      name: '76.2-reset-creates-new',
      timeout: 5000,
      fn: async () => {
        const { getObservationVariator, resetObservationVariator } = await import('../../src/context/observation-variator.js');
        const v1 = getObservationVariator();
        resetObservationVariator();
        const v2 = getObservationVariator();
        return { pass: v1 !== v2 };
      },
    },
    {
      name: '76.3-wrap-tool-result',
      timeout: 5000,
      fn: async () => {
        const { getObservationVariator, resetObservationVariator } = await import('../../src/context/observation-variator.js');
        resetObservationVariator();
        const v = getObservationVariator();
        const wrapped = v.wrapToolResult('bash', 'hello world');
        return {
          pass: typeof wrapped === 'string' && wrapped.includes('hello world'),
          metadata: { len: wrapped.length },
        };
      },
    },
    {
      name: '76.4-wrap-memory-block',
      timeout: 5000,
      fn: async () => {
        const { getObservationVariator, resetObservationVariator } = await import('../../src/context/observation-variator.js');
        resetObservationVariator();
        const v = getObservationVariator();
        const wrapped = v.wrapMemoryBlock('some memory context');
        return {
          pass: typeof wrapped === 'string' && wrapped.includes('some memory context'),
          metadata: { len: wrapped.length },
        };
      },
    },
    {
      name: '76.5-next-turn-changes-template',
      timeout: 5000,
      fn: async () => {
        const { getObservationVariator, resetObservationVariator } = await import('../../src/context/observation-variator.js');
        resetObservationVariator();
        const v = getObservationVariator();
        const wrap1 = v.wrapToolResult('bash', 'output');
        v.nextTurn();
        const wrap2 = v.wrapToolResult('bash', 'output');
        v.nextTurn();
        const wrap3 = v.wrapToolResult('bash', 'output');
        // At least one should differ (3 templates rotate)
        return {
          pass: wrap1 !== wrap2 || wrap2 !== wrap3 || wrap1 !== wrap3,
          metadata: { w1Len: wrap1.length, w2Len: wrap2.length, w3Len: wrap3.length },
        };
      },
    },
    {
      name: '76.6-reset-resets-turn',
      timeout: 5000,
      fn: async () => {
        const { getObservationVariator, resetObservationVariator } = await import('../../src/context/observation-variator.js');
        resetObservationVariator();
        const v = getObservationVariator();
        const initial = v.wrapToolResult('read', 'file content');
        v.nextTurn();
        v.nextTurn();
        v.reset();
        const afterReset = v.wrapToolResult('read', 'file content');
        return {
          pass: initial === afterReset,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 77: Restorable Compression
// ============================================================================

export function cat77RestorableCompression(): TestDef[] {
  return [
    {
      name: '77.1-singleton-access',
      timeout: 5000,
      fn: async () => {
        const { getRestorableCompressor } = await import('../../src/context/restorable-compression.js');
        const c1 = getRestorableCompressor();
        const c2 = getRestorableCompressor();
        return { pass: c1 === c2 };
      },
    },
    {
      name: '77.2-reset-creates-new',
      timeout: 5000,
      fn: async () => {
        const { getRestorableCompressor, resetRestorableCompressor } = await import('../../src/context/restorable-compression.js');
        const c1 = getRestorableCompressor();
        resetRestorableCompressor();
        const c2 = getRestorableCompressor();
        return { pass: c1 !== c2 };
      },
    },
    {
      name: '77.3-compress-empty-messages',
      timeout: 5000,
      fn: async () => {
        const { getRestorableCompressor, resetRestorableCompressor } = await import('../../src/context/restorable-compression.js');
        resetRestorableCompressor();
        const c = getRestorableCompressor();
        const result = c.compress([]);
        return {
          pass: result.messages.length === 0 && result.identifiers.length === 0,
          metadata: { tokensSaved: result.tokensSaved },
        };
      },
    },
    {
      name: '77.4-compress-preserves-short-messages',
      timeout: 5000,
      fn: async () => {
        const { getRestorableCompressor, resetRestorableCompressor } = await import('../../src/context/restorable-compression.js');
        resetRestorableCompressor();
        const c = getRestorableCompressor();
        const msgs = [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ];
        const result = c.compress(msgs);
        return {
          pass: result.messages.length === 2,
          metadata: { msgCount: result.messages.length },
        };
      },
    },
    {
      name: '77.5-list-identifiers-initially-empty',
      timeout: 5000,
      fn: async () => {
        const { getRestorableCompressor, resetRestorableCompressor } = await import('../../src/context/restorable-compression.js');
        resetRestorableCompressor();
        const c = getRestorableCompressor();
        const ids = c.listIdentifiers();
        return {
          pass: Array.isArray(ids) && ids.length === 0,
        };
      },
    },
    {
      name: '77.6-store-size-initially-zero',
      timeout: 5000,
      fn: async () => {
        const { getRestorableCompressor, resetRestorableCompressor } = await import('../../src/context/restorable-compression.js');
        resetRestorableCompressor();
        const c = getRestorableCompressor();
        const size = c.storeSize();
        return {
          pass: size === 0,
          metadata: { size },
        };
      },
    },
    {
      name: '77.7-evict-no-crash',
      timeout: 5000,
      fn: async () => {
        const { getRestorableCompressor, resetRestorableCompressor } = await import('../../src/context/restorable-compression.js');
        resetRestorableCompressor();
        const c = getRestorableCompressor();
        // Should not throw on empty store
        c.evict(0);
        return { pass: c.storeSize() === 0 };
      },
    },
  ];
}

// ============================================================================
// Cat 78: Head-Tail Truncation
// ============================================================================

export function cat78HeadTailTruncation(): TestDef[] {
  return [
    {
      name: '78.1-no-truncation-needed',
      timeout: 5000,
      fn: async () => {
        const { headTailTruncate } = await import('../../src/utils/head-tail-truncation.js');
        const result = headTailTruncate('short text');
        return {
          pass: result.truncated === false && result.output === 'short text',
        };
      },
    },
    {
      name: '78.2-truncation-by-lines',
      timeout: 5000,
      fn: async () => {
        const { headTailTruncate } = await import('../../src/utils/head-tail-truncation.js');
        const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
        const result = headTailTruncate(lines, { headLines: 5, tailLines: 5 });
        return {
          pass: result.truncated === true && result.omittedLines > 0 &&
                result.output.includes('Line 1') && result.output.includes('Line 100'),
          metadata: { omitted: result.omittedLines, originalLines: result.originalLines },
        };
      },
    },
    {
      name: '78.3-needs-truncation-check',
      timeout: 5000,
      fn: async () => {
        const { needsTruncation } = await import('../../src/utils/head-tail-truncation.js');
        const short = 'hello';
        const long = Array.from({ length: 200 }, (_, i) => `Line ${i}`).join('\n');
        return {
          pass: needsTruncation(short) === false && needsTruncation(long, { headLines: 10, tailLines: 10 }) === true,
        };
      },
    },
    {
      name: '78.4-max-chars-truncation',
      timeout: 5000,
      fn: async () => {
        const { headTailTruncate } = await import('../../src/utils/head-tail-truncation.js');
        const text = 'x'.repeat(10000);
        const result = headTailTruncate(text, { maxChars: 500 });
        return {
          pass: result.truncated === true && result.output.length <= 1000,
          metadata: { outputLen: result.output.length },
        };
      },
    },
    {
      name: '78.5-semantic-truncate-basic',
      timeout: 5000,
      fn: async () => {
        const { semanticTruncate } = await import('../../src/utils/head-tail-truncation.js');
        const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
        const result = semanticTruncate(lines, { headLines: 5, tailLines: 5 });
        return {
          pass: result.truncated === true && result.output.includes('Line 1'),
          metadata: { omitted: result.omittedLines },
        };
      },
    },
    {
      name: '78.6-empty-string-no-truncation',
      timeout: 5000,
      fn: async () => {
        const { headTailTruncate } = await import('../../src/utils/head-tail-truncation.js');
        const result = headTailTruncate('');
        return {
          pass: result.truncated === false && result.output === '' && result.originalLines <= 1,
        };
      },
    },
    {
      name: '78.7-original-bytes-tracked',
      timeout: 5000,
      fn: async () => {
        const { headTailTruncate } = await import('../../src/utils/head-tail-truncation.js');
        const text = 'Hello World\nLine 2\nLine 3';
        const result = headTailTruncate(text);
        return {
          pass: result.originalBytes > 0 && result.originalBytes === Buffer.byteLength(text, 'utf-8'),
          metadata: { bytes: result.originalBytes },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 79: Stable JSON
// ============================================================================

export function cat79StableJSON(): TestDef[] {
  return [
    {
      name: '79.1-sorted-keys',
      timeout: 5000,
      fn: async () => {
        const { stableStringify } = await import('../../src/utils/stable-json.js');
        const obj = { z: 1, a: 2, m: 3 };
        const result = stableStringify(obj);
        const keys = Object.keys(JSON.parse(result));
        return {
          pass: keys[0] === 'a' && keys[1] === 'm' && keys[2] === 'z',
          metadata: { keys },
        };
      },
    },
    {
      name: '79.2-deterministic-output',
      timeout: 5000,
      fn: async () => {
        const { stableStringify } = await import('../../src/utils/stable-json.js');
        const obj1 = { b: 2, a: 1, c: 3 };
        const obj2 = { c: 3, a: 1, b: 2 };
        return {
          pass: stableStringify(obj1) === stableStringify(obj2),
        };
      },
    },
    {
      name: '79.3-nested-objects-sorted',
      timeout: 5000,
      fn: async () => {
        const { stableStringify } = await import('../../src/utils/stable-json.js');
        const obj = { z: { y: 1, x: 2 }, a: { d: 3, c: 4 } };
        const result = stableStringify(obj);
        return {
          pass: result.indexOf('"a"') < result.indexOf('"z"') &&
                result.indexOf('"c"') < result.indexOf('"d"'),
        };
      },
    },
    {
      name: '79.4-normalize-json-string',
      timeout: 5000,
      fn: async () => {
        const { normalizeJson } = await import('../../src/utils/stable-json.js');
        const input = '{"b":2,"a":1}';
        const normalized = normalizeJson(input);
        const parsed = JSON.parse(normalized);
        return {
          pass: Object.keys(parsed)[0] === 'a',
          metadata: { normalized: normalized.substring(0, 100) },
        };
      },
    },
    {
      name: '79.5-handles-arrays-and-nulls',
      timeout: 5000,
      fn: async () => {
        const { stableStringify } = await import('../../src/utils/stable-json.js');
        const obj = { arr: [3, 1, 2], nil: null, bool: true };
        const result = stableStringify(obj);
        const parsed = JSON.parse(result);
        return {
          pass: Array.isArray(parsed.arr) && parsed.arr[0] === 3 && parsed.nil === null && parsed.bool === true,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 80: Context Manager V3
// ============================================================================

export function cat80ContextManagerV3(): TestDef[] {
  return [
    {
      name: '80.1-factory-creation',
      timeout: 5000,
      fn: async () => {
        const { createContextManager } = await import('../../src/context/context-manager-v3.js');
        const mgr = createContextManager('gemini-2.5-flash');
        return { pass: mgr !== undefined };
      },
    },
    {
      name: '80.2-constructor-with-config',
      timeout: 5000,
      fn: async () => {
        const { ContextManagerV3 } = await import('../../src/context/context-manager-v3.js');
        const mgr = new ContextManagerV3({});
        return { pass: mgr !== undefined };
      },
    },
    {
      name: '80.3-get-stats-empty',
      timeout: 5000,
      fn: async () => {
        const { createContextManager } = await import('../../src/context/context-manager-v3.js');
        const mgr = createContextManager('gemini-2.5-flash');
        const stats = mgr.getStats([]);
        return {
          pass: stats !== undefined && typeof stats === 'object',
          metadata: { stats: JSON.stringify(stats).substring(0, 200) },
        };
      },
    },
    {
      name: '80.4-should-warn-empty',
      timeout: 5000,
      fn: async () => {
        const { createContextManager } = await import('../../src/context/context-manager-v3.js');
        const mgr = createContextManager('gemini-2.5-flash');
        const warning = mgr.shouldWarn([]);
        return {
          pass: warning !== undefined,
          metadata: { warning: JSON.stringify(warning).substring(0, 200) },
        };
      },
    },
    {
      name: '80.5-dispose-no-crash',
      timeout: 5000,
      fn: async () => {
        const { createContextManager } = await import('../../src/context/context-manager-v3.js');
        const mgr = createContextManager('gemini-2.5-flash');
        mgr.dispose();
        return { pass: true };
      },
    },
  ];
}
