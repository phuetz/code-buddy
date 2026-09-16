import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { MCPManager } from '../../src/mcp/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, '../fixtures/mcp-delay-fixture.mjs');

describe('GK35 real stdio MCP init timeout', () => {
  let manager: MCPManager | null = null;
  const previousTimeout = process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS;

  afterEach(async () => {
    if (previousTimeout === undefined) delete process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS;
    else process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS = previousTimeout;
    await manager?.dispose();
    manager = null;
  });

  it('loads a fast stdio server and late-registers a slow one after the skip', async () => {
    process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS = '400';
    manager = new MCPManager();

    const lateReady = new Promise<string>((resolve) => {
      const onReady = (name: string) => {
        if (name !== 'slow_fixture') return;
        manager!.off('serverLateReady', onReady);
        resolve(name);
      };
      manager!.on('serverLateReady', onReady);
    });

    const started = Date.now();
    await manager.ensureServersInitialized({
      servers: [
        {
          name: 'fast_fixture',
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [fixturePath],
            env: { MCP_FIXTURE_DELAY_MS: '0' },
          },
        },
        {
          name: 'slow_fixture',
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [fixturePath],
            env: { MCP_FIXTURE_DELAY_MS: '1200' },
          },
        },
      ],
    });
    expect(Date.now() - started).toBeLessThan(900);
    expect(manager.getTools().some((tool) => tool.serverName === 'slow_fixture')).toBe(false);
    await expect.poll(() => manager!.getServerStatus('fast_fixture'), {
      timeout: 5000, interval: 20,
    }).toBe('connected');
    expect(manager.getTools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['mcp__fast_fixture__echo_marker']),
    );

    const secondStarted = Date.now();
    await manager.ensureServersInitialized({
      servers: [
        {
          name: 'fast_fixture',
          transport: { type: 'stdio', command: process.execPath, args: [fixturePath] },
        },
        {
          name: 'slow_fixture',
          transport: { type: 'stdio', command: process.execPath, args: [fixturePath] },
        },
      ],
    });
    expect(Date.now() - secondStarted).toBeLessThan(80);

    await expect(lateReady).resolves.toBe('slow_fixture');
    expect(manager.getServerStatus('slow_fixture')).toBe('connected');
    const echo = await manager.callTool('mcp__slow_fixture__echo_marker', { message: 'LATE' });
    expect(echo.content).toEqual([{ type: 'text', text: 'MCP_REAL_FIXTURE:LATE' }]);
  }, 15_000);
});
