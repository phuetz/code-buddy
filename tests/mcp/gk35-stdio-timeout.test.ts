import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { MCPManager } from '../../src/mcp/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, '../fixtures/mcp-delay-fixture.mjs');

// Le scénario mesure une SÉQUENCE (le rapide se connecte dans le budget, le
// lent le dépasse, est sauté, puis s'enregistre tard), pas une vitesse absolue.
// Or le budget était figé à 400 ms : sur windows-latest, spawn d'un node +
// poignée de main MCP franchissent parfois ce seuil et le serveur « rapide »
// se retrouvait sauté lui aussi (status 'connecting'). Tous les seuils sont
// donc dérivés d'un budget unique, proportionné à la machine comme le font
// déjà testTimeout/hookTimeout dans vitest.config.ts. Les rapports entre
// seuils — et donc ce que le scénario prouve — sont inchangés.
const SLOW_HOST = process.platform === 'win32' || process.platform === 'darwin';
const INIT_BUDGET_MS = SLOW_HOST ? 1600 : 400;
const SLOW_FIXTURE_DELAY_MS = INIT_BUDGET_MS * 3;
const FIRST_PASS_CEILING_MS = Math.round(INIT_BUDGET_MS * 2.25);
const CACHED_PASS_CEILING_MS = Math.round(INIT_BUDGET_MS * 0.2);

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
    process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS = String(INIT_BUDGET_MS);
    manager = new MCPManager();

    const lateReady = new Promise<string>((resolve) => {
      manager!.once('serverLateReady', (name: string) => resolve(name));
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
            env: { MCP_FIXTURE_DELAY_MS: String(SLOW_FIXTURE_DELAY_MS) },
          },
        },
      ],
    });
    expect(Date.now() - started).toBeLessThan(FIRST_PASS_CEILING_MS);
    expect(manager.getServerStatus('fast_fixture')).toBe('connected');
    expect(manager.getTools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['mcp__fast_fixture__echo_marker']),
    );
    expect(manager.getTools().some((tool) => tool.serverName === 'slow_fixture')).toBe(false);

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
    expect(Date.now() - secondStarted).toBeLessThan(CACHED_PASS_CEILING_MS);

    await expect(lateReady).resolves.toBe('slow_fixture');
    expect(manager.getServerStatus('slow_fixture')).toBe('connected');
    const echo = await manager.callTool('mcp__slow_fixture__echo_marker', { message: 'LATE' });
    expect(echo.content).toEqual([{ type: 'text', text: 'MCP_REAL_FIXTURE:LATE' }]);
  }, 30_000);
});
