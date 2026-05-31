import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  getHermesProtocolGatewaysForReview,
  runHermesProtocolGatewaysSmokeForReview,
} from '../src/main/tools/hermes-protocol-gateways-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes protocol gateways bridge', () => {
  it('summarizes protocol gateway readiness from the core module', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesProtocolGatewayReadiness: () => ({
        capabilities: [
          {
            commands: ['npm test -- tests/mcp/mcp-stdio-real-fixture.test.ts --run'],
            endpoints: [],
            evidence: ['src/mcp/client.ts'],
            id: 'mcp-client',
            label: 'MCP client',
            notes: ['stdio and HTTP transports'],
            officialSurface: 'external MCP servers',
            status: 'available',
          },
          {
            commands: ['npx tsx src/index.ts hermes protocols status --json'],
            endpoints: ['/api/acp/*'],
            evidence: ['src/server/routes/acp.ts'],
            id: 'acp-editor-integration',
            label: 'ACP editor integration',
            notes: ['Editor packaging remains partial.'],
            officialSurface: 'drop-in Hermes ACP editor workflow',
            status: 'partial',
          },
        ],
        generatedAt: '2026-05-31T16:20:00.000Z',
        kind: 'hermes_protocol_gateway_readiness',
        officialSurface: 'Hermes MCP/ACP/A2A protocol gateways and editor/server integration',
        ok: true,
        recommendations: ['Run the local smoke.'],
        schemaVersion: 1,
        smokeCommand: 'buddy hermes protocols-smoke local --json',
        summary: {
          availableCount: 1,
          missingCount: 0,
          partialCount: 1,
          total: 2,
        },
      }),
    });

    const summary = await getHermesProtocolGatewaysForReview();

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-protocol-gateways.js');
    expect(summary).toMatchObject({
      kind: 'hermes_protocol_gateway_readiness',
      ok: true,
      smokeCommand: 'buddy hermes protocols-smoke local --json',
      summary: {
        availableCount: 1,
        partialCount: 1,
        total: 2,
      },
      capabilities: [
        expect.objectContaining({
          id: 'mcp-client',
          status: 'available',
        }),
        expect.objectContaining({
          id: 'acp-editor-integration',
          status: 'partial',
        }),
      ],
    });
  });

  it('degrades to null when the core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesProtocolGatewaysForReview()).resolves.toBeNull();
  });

  it('runs the real protocol smoke through the core module hook', async () => {
    const runHermesProtocolGatewaySmoke = vi.fn(async () => ({
      durationMs: 55,
      generatedAt: '2026-05-31T16:21:00.055Z',
      httpRoutes: {
        a2aAgentName: 'Code Buddy',
        acpSessionCount: 1,
        baseUrl: 'http://127.0.0.1:12345',
        ok: true,
        routes: [
          { ok: true, path: '/api/a2a/.well-known/agent.json', status: 200 },
          { ok: true, path: '/api/acp/sessions', status: 201 },
        ],
      },
      kind: 'hermes_protocol_gateway_smoke',
      mcpStdio: {
        echoText: 'HERMES_PROTOCOL_MCP:OK',
        ok: true,
        serverName: 'hermes_protocol_fixture',
        toolCount: 1,
        transport: 'stdio',
      },
      ok: true,
      schemaVersion: 1,
    }));
    mockedLoadCoreModule.mockResolvedValue({
      runHermesProtocolGatewaySmoke,
    });

    const result = await runHermesProtocolGatewaysSmokeForReview();

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-protocol-gateways.js');
    expect(runHermesProtocolGatewaySmoke).toHaveBeenCalledWith();
    expect(result).toMatchObject({
      ok: true,
      mcpStdio: {
        echoText: 'HERMES_PROTOCOL_MCP:OK',
        transport: 'stdio',
      },
      httpRoutes: {
        a2aAgentName: 'Code Buddy',
        ok: true,
      },
    });
  });
});
