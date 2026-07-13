import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  servers: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  savedServers: [] as Array<Record<string, unknown>>,
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0-test' },
}));

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    getAll: () => mocks.config,
    update: (value: Record<string, unknown>) => mocks.updates.push(value),
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getServers: () => mocks.servers,
    saveServer: (value: Record<string, unknown>) => mocks.savedServers.push(value),
  },
}));

import {
  ConfigExportService,
  type ConfigExportBundle,
} from '../src/main/config/config-export-service';

function service() {
  return new ConfigExportService({
    list: () => [],
    create: vi.fn(),
    update: vi.fn(),
  } as never);
}

function bundle(overrides: Partial<ConfigExportBundle> = {}): ConfigExportBundle {
  return {
    version: 1,
    exportedAt: '2026-07-12T00:00:00.000Z',
    source: 'test',
    app: { api: {} },
    projects: [],
    mcpServers: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.config = {};
  mocks.servers = [];
  mocks.updates.length = 0;
  mocks.savedServers.length = 0;
});

describe('ConfigExportService security', () => {
  it('recursively redacts API profiles, MCP env, headers, arguments and credential URLs', () => {
    mocks.config = {
      apiKey: 'top-secret',
      activeProfileKey: 'openrouter',
      profiles: {
        openrouter: { apiKey: 'nested-secret', model: 'free-model' },
      },
      configSets: [{
        id: 'set-1',
        profiles: { grok: { apiKey: 'set-secret', model: 'grok' } },
      }],
    };
    mocks.servers = [{
      id: 'mcp-private',
      name: 'Private MCP',
      type: 'stdio',
      command: 'node',
      args: ['server.js', '--api-key', 'argument-secret', '--url=https://example.test?token=query-secret'],
      env: { NOTION_TOKEN: 'notion-secret', TEST_ENV: 'development' },
      headers: { Authorization: 'Bearer header-secret', 'X-Trace': 'visible' },
      url: 'https://user:password@example.test/path',
      enabled: true,
    }];

    const exported = service().exportBundle();
    const serialized = JSON.stringify(exported);

    for (const secret of [
      'top-secret', 'nested-secret', 'set-secret', 'argument-secret',
      'query-secret', 'notion-secret', 'header-secret', 'user:password',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('[REDACTED]');
    expect(exported.app.api.activeProfileKey).toBe('openrouter');
    expect((exported.mcpServers[0]?.env as Record<string, string>).TEST_ENV).toBe('development');
    expect((exported.mcpServers[0]?.headers as Record<string, string>)['X-Trace']).toBe('visible');
  });

  it('preserves existing local API secrets when applying a redacted bundle', () => {
    mocks.config = {
      apiKey: 'local-top-secret',
      profiles: { openrouter: { apiKey: 'local-profile-secret', model: 'old' } },
    };
    const incoming = bundle({
      app: {
        api: {
          apiKey: '[REDACTED]',
          profiles: { openrouter: { apiKey: '[REDACTED]', model: 'new' } },
        },
      },
    });

    const result = service().importBundle(incoming);

    expect(result.success).toBe(true);
    expect(mocks.updates[0]).toMatchObject({
      apiKey: 'local-top-secret',
      profiles: { openrouter: { apiKey: 'local-profile-secret', model: 'new' } },
    });
  });

  it('forces imported MCP commands disabled and rejects malformed bundles', () => {
    const incoming = bundle({
      mcpServers: [{
        id: 'mcp-imported',
        name: 'Imported command',
        type: 'stdio',
        command: 'bash',
        args: ['-c', 'touch /tmp/should-not-run'],
        enabled: true,
      }],
    });

    const imported = service().importBundle(incoming);

    expect(imported.success).toBe(true);
    expect(mocks.savedServers[0]).toMatchObject({
      id: 'mcp-imported',
      command: 'bash',
      enabled: false,
    });

    const malformed = service().importBundle({ version: 1 } as never);
    expect(malformed.success).toBe(false);
    expect(malformed.errors[0]).toContain('app.api');
  });
});
