import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getHermesProtocolGatewaysForReview,
  runHermesProtocolGatewaysSmokeForReview,
} from '../src/main/tools/hermes-protocol-gateways-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltProtocolCore = fs.existsSync(path.join(distRoot, 'agent', 'hermes-protocol-gateways.js'));

const envKeys = ['CODEBUDDY_ENGINE_PATH', 'OPENAI_API_KEY', 'GROK_API_KEY'] as const;

type EnvKey = typeof envKeys[number];

describe.skipIf(!hasBuiltProtocolCore)('Hermes protocol gateways bridge real core integration', () => {
  let originalEnv: Partial<Record<EnvKey, string | undefined>>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]])
    ) as Partial<Record<EnvKey, string | undefined>>;
    for (const key of envKeys) {
      delete process.env[key];
    }

    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
    process.env.OPENAI_API_KEY = 'secret-openai-key';
    process.env.GROK_API_KEY = 'secret-grok-key';
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('loads the real compiled MCP/A2A/ACP readiness and runs local protocol smoke', async () => {
    const summary = await getHermesProtocolGatewaysForReview();
    const smoke = await runHermesProtocolGatewaysSmokeForReview();

    expect(summary).toMatchObject({
      kind: 'hermes_protocol_gateway_readiness',
      ok: true,
      schemaVersion: 1,
      smokeCommand: 'buddy hermes protocols-smoke local --json',
      summary: {
        availableCount: 5,
        missingCount: 0,
        partialCount: 1,
        total: 6,
      },
    });
    expect(summary?.capabilities.map((capability) => capability.id)).toEqual(
      expect.arrayContaining([
        'mcp-client',
        'mcp-server',
        'a2a-http',
        'acp-http',
        'channel-a2a-bridge',
        'acp-editor-integration',
      ])
    );
    expect(smoke).toMatchObject({
      kind: 'hermes_protocol_gateway_smoke',
      ok: true,
      mcpStdio: {
        echoText: 'HERMES_PROTOCOL_MCP:OK',
        ok: true,
        transport: 'stdio',
      },
      httpRoutes: {
        a2aAgentName: 'Code Buddy',
        ok: true,
      },
    });
    expect(smoke.httpRoutes.routes).toHaveLength(4);
    expect(JSON.stringify(summary)).not.toContain('secret-openai-key');
    expect(JSON.stringify(summary)).not.toContain('secret-grok-key');
    expect(JSON.stringify(smoke)).not.toContain('secret-openai-key');
    expect(JSON.stringify(smoke)).not.toContain('secret-grok-key');
  });
});
