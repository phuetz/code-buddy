import { describe, it, expect, vi } from 'vitest';
import { createAllToolsAsync, registerBuiltinTools, DOCUMENTED_ASYNC_REGISTRY_DISCREPANCIES } from '../../src/tools/registry/index.js';
import { createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { createMcpTools } from '../../src/tools/registry/mcp-tools.js';

vi.mock('../../src/mcp/mcp-manager.js', () => ({
  getMcpManager: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('Registry Parity', () => {
  it('should have documented parity between createAllToolsAsync and registerBuiltinTools', async () => {
    const asyncTools = await createAllToolsAsync();
    const asyncToolNames = new Set(asyncTools.map(t => t.name).filter(Boolean));

    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const syncToolNames = new Set(registry.getAll().map(t => t.tool.name).filter(Boolean));

    const mcpTools = createMcpTools();
    const mcpToolNames = new Set(mcpTools.map(t => t.name));

    const inSyncNotAsync = [...syncToolNames].filter(name => !asyncToolNames.has(name));
    const inAsyncNotSync = [...asyncToolNames].filter(name => !syncToolNames.has(name));

    const inAsyncNotSyncWithoutMcp = inAsyncNotSync.filter(name => !mcpToolNames.has(name));

    expect(inSyncNotAsync.sort()).toEqual([...DOCUMENTED_ASYNC_REGISTRY_DISCREPANCIES].sort());
    expect(inAsyncNotSyncWithoutMcp).toEqual([]);
  });
});
