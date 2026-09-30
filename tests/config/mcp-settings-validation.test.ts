import { describe, expect, it } from 'vitest';
import { SettingsSchema } from '../../src/utils/config-validation/schema.js';

describe('persisted MCP settings', () => {
  it('accepts and preserves the server map written by buddy mcp add', () => {
    const mcpServers = {
      local: {
        name: 'local',
        transport: { type: 'stdio', command: 'node', args: ['server.mjs'], env: {} },
      },
    };
    const parsed = SettingsSchema.safeParse({ mcpServers });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toHaveProperty('mcpServers', mcpServers);
  });

  it('rejects server maps or entries that are not objects', () => {
    expect(SettingsSchema.safeParse({ mcpServers: [] }).success).toBe(false);
    expect(SettingsSchema.safeParse({ mcpServers: { local: 'node server.mjs' } }).success).toBe(false);
  });
});
