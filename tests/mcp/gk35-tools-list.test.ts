import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleTools } from '../../src/commands/handlers/vibe-handlers.js';
import { resetMCPManager } from '../../src/codebuddy/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, '../fixtures/mcp-delay-fixture.mjs');
const workRoot = path.resolve(__dirname, '../../_qa/gk35/tools-list');

describe('GK35 /tools lists MCP tools', () => {
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  const previousDisable = process.env.CODEBUDDY_DISABLE_MCP;
  const previousHeadless = process.env.CODEBUDDY_HEADLESS;
  const previousTimeout = process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS;

  beforeEach(async () => {
    await fs.mkdir(workRoot, { recursive: true });
    await fs.mkdir(path.join(workRoot, '.codebuddy'), { recursive: true });
    await fs.mkdir(path.join(workRoot, 'home'), { recursive: true });
    await fs.writeFile(
      path.join(workRoot, '.codebuddy', 'mcp.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            gk35_tools: {
              name: 'gk35_tools',
              type: 'stdio',
              command: process.execPath,
              args: [fixturePath],
              env: { MCP_FIXTURE_DELAY_MS: '250' },
              enabled: true,
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    process.chdir(workRoot);
    process.env.HOME = path.join(workRoot, 'home');
    delete process.env.CODEBUDDY_DISABLE_MCP;
    delete process.env.CODEBUDDY_HEADLESS;
    process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS = '2000';
    await resetMCPManager();
  });

  afterEach(async () => {
    await resetMCPManager();
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousDisable === undefined) delete process.env.CODEBUDDY_DISABLE_MCP;
    else process.env.CODEBUDDY_DISABLE_MCP = previousDisable;
    if (previousHeadless === undefined) delete process.env.CODEBUDDY_HEADLESS;
    else process.env.CODEBUDDY_HEADLESS = previousHeadless;
    if (previousTimeout === undefined) delete process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS;
    else process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS = previousTimeout;
  });

  it('waits for a slow-but-alive stdio server so /tools shows mcp__ tools', async () => {
    const result = await handleTools(['list']);
    const content = String(result.entry?.content ?? '');
    expect(content).toContain('mcp__gk35_tools__echo_marker');
    expect(content).toMatch(/MCP/i);
  }, 15_000);
});
