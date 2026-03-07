/**
 * Cat 38: Tool Registry (7 tests, no API)
 * Cat 39: Tool Metadata Extended (5 tests, no API)
 */

import type { TestDef } from './types.js';
import { TOOL_METADATA, CATEGORY_KEYWORDS } from '../../src/tools/metadata.js';

// ============================================================================
// Cat 38: Tool Registry (FormalToolRegistry)
// API: register(), get(), has(), getAll(), getNames(), getStats(), query()
// createTestToolRegistry() returns an EMPTY registry
// ============================================================================

export function cat38ToolRegistry(): TestDef[] {
  return [
    {
      name: '38.1-create-test-registry',
      timeout: 5000,
      fn: async () => {
        const { createTestToolRegistry } = await import('../../src/tools/registry/index.js');
        const registry = createTestToolRegistry();
        return { pass: registry !== undefined, metadata: { type: typeof registry } };
      },
    },
    {
      name: '38.2-empty-registry-stats',
      timeout: 5000,
      fn: async () => {
        const { createTestToolRegistry } = await import('../../src/tools/registry/index.js');
        const registry = createTestToolRegistry();
        const stats = registry.getStats();
        return {
          pass: stats.totalTools === 0 && stats.enabledTools === 0,
          metadata: stats as unknown as Record<string, unknown>,
        };
      },
    },
    {
      name: '38.3-register-and-get',
      timeout: 5000,
      fn: async () => {
        const { createTestToolRegistry } = await import('../../src/tools/registry/index.js');
        const registry = createTestToolRegistry();
        registry.register({
          name: 'test_tool_1',
          description: 'A test tool',
          category: 'utility',
          execute: async () => ({ success: true, output: 'ok' }),
        } as any);
        const found = registry.get('test_tool_1');
        return {
          pass: found !== undefined && found.tool.name === 'test_tool_1',
          metadata: { name: found?.tool.name },
        };
      },
    },
    {
      name: '38.4-has-checks-existence',
      timeout: 5000,
      fn: async () => {
        const { createTestToolRegistry } = await import('../../src/tools/registry/index.js');
        const registry = createTestToolRegistry();
        registry.register({
          name: 'existing_tool',
          description: 'Exists',
          category: 'utility',
          execute: async () => ({ success: true, output: '' }),
        } as any);
        return {
          pass: registry.has('existing_tool') && !registry.has('nonexistent_tool'),
        };
      },
    },
    {
      name: '38.5-get-all-and-get-names',
      timeout: 5000,
      fn: async () => {
        const { createTestToolRegistry } = await import('../../src/tools/registry/index.js');
        const registry = createTestToolRegistry();
        registry.register({ name: 'tool_a', description: 'A', category: 'utility', execute: async () => ({ success: true, output: '' }) } as any);
        registry.register({ name: 'tool_b', description: 'B', category: 'system', execute: async () => ({ success: true, output: '' }) } as any);
        const all = registry.getAll();
        const names = registry.getNames();
        return {
          pass: all.length === 2 && names.length === 2 && names.includes('tool_a') && names.includes('tool_b'),
          metadata: { allLen: all.length, names },
        };
      },
    },
    {
      name: '38.6-stats-after-registration',
      timeout: 5000,
      fn: async () => {
        const { createTestToolRegistry } = await import('../../src/tools/registry/index.js');
        const registry = createTestToolRegistry();
        registry.register({ name: 'st1', description: 'Test', category: 'utility', execute: async () => ({ success: true, output: '' }) } as any);
        registry.register({ name: 'st2', description: 'Test2', category: 'utility', execute: async () => ({ success: true, output: '' }) } as any);
        const stats = registry.getStats();
        return {
          pass: stats.totalTools === 2,
          metadata: stats as unknown as Record<string, unknown>,
        };
      },
    },
    {
      name: '38.7-unregister-tool',
      timeout: 5000,
      fn: async () => {
        const { createTestToolRegistry } = await import('../../src/tools/registry/index.js');
        const registry = createTestToolRegistry();
        registry.register({ name: 'to_remove', description: 'Remove me', category: 'utility', execute: async () => ({ success: true, output: '' }) } as any);
        const hadBefore = registry.has('to_remove');
        registry.unregister('to_remove');
        const hadAfter = registry.has('to_remove');
        return { pass: hadBefore && !hadAfter };
      },
    },
  ];
}

// ============================================================================
// Cat 39: Tool Metadata Extended
// ============================================================================

export function cat39ToolMetadata(): TestDef[] {
  return [
    {
      name: '39.1-metadata-has-many-tools',
      timeout: 5000,
      fn: async () => {
        const count = Object.keys(TOOL_METADATA).length;
        return { pass: count >= 20, metadata: { toolCount: count } };
      },
    },
    {
      name: '39.2-all-tools-have-keywords',
      timeout: 5000,
      fn: async () => {
        const entries = Object.entries(TOOL_METADATA);
        const allHaveKeywords = entries.every(([_, meta]) =>
          Array.isArray((meta as any).keywords) && (meta as any).keywords.length > 0
        );
        const withoutKeywords = entries.filter(([_, meta]) =>
          !Array.isArray((meta as any).keywords) || (meta as any).keywords.length === 0
        ).map(([k]) => k);
        return { pass: allHaveKeywords, metadata: { total: entries.length, missing: withoutKeywords } };
      },
    },
    {
      name: '39.3-all-tools-have-priority',
      timeout: 5000,
      fn: async () => {
        const entries = Object.entries(TOOL_METADATA);
        const allHavePriority = entries.every(([_, meta]) => typeof (meta as any).priority === 'number');
        return { pass: allHavePriority, metadata: { total: entries.length } };
      },
    },
    {
      name: '39.4-category-keywords-coverage',
      timeout: 5000,
      fn: async () => {
        const catCount = Object.keys(CATEGORY_KEYWORDS).length;
        return { pass: catCount >= 5, metadata: { categoryCount: catCount, categories: Object.keys(CATEGORY_KEYWORDS) } };
      },
    },
    {
      name: '39.5-search-keyword-relevance',
      timeout: 5000,
      fn: async () => {
        const matches = Object.entries(TOOL_METADATA).filter(([_, meta]) =>
          (meta as any).keywords?.some((kw: string) => kw.includes('file') || kw.includes('read') || kw.includes('write'))
        );
        return { pass: matches.length >= 3, metadata: { matchCount: matches.length, tools: matches.slice(0, 5).map(([k]) => k) } };
      },
    },
  ];
}
