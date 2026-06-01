import { describe, expect, it } from 'vitest';

import {
  buildHermesProtocolGatewayReadiness,
  renderHermesProtocolGatewayReadiness,
  runHermesProtocolGatewaySmoke,
} from '../../src/agent/hermes-protocol-gateways.js';

describe('Hermes protocol gateway readiness', () => {
  it('reports MCP, A2A, ACP, and bridge capabilities without claiming editor packaging parity', () => {
    const readiness = buildHermesProtocolGatewayReadiness();

    expect(readiness).toMatchObject({
      kind: 'hermes_protocol_gateway_readiness',
      schemaVersion: 1,
      ok: true,
      summary: {
        missingCount: 0,
      },
      smokeCommand: 'buddy hermes protocols-smoke local --json',
    });
    expect(readiness.summary.availableCount).toBeGreaterThanOrEqual(5);
    expect(readiness.summary.partialCount).toBeGreaterThanOrEqual(1);
    expect(readiness.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mcp-client', status: 'available' }),
        expect.objectContaining({ id: 'mcp-server', status: 'available' }),
        expect.objectContaining({ id: 'a2a-http', status: 'available' }),
        expect.objectContaining({ id: 'acp-http', status: 'available' }),
        expect.objectContaining({ id: 'acp-editor-integration', status: 'partial' }),
      ]),
    );
    const rendered = renderHermesProtocolGatewayReadiness(readiness);
    expect(rendered).toContain('Hermes protocol gateway readiness:');
    expect(rendered).toContain('    - POST /api/a2a/tasks/:id/cancel');
    expect(rendered).toContain('    - POST /api/acp/tasks/:id/resume');
    expect(rendered).toContain('    - stdio: buddy acp');
    expect(rendered).toContain('Evidence: 6 file/test reference(s)');
    expect(rendered).toContain('Notes: The stdio ACP transport supports initialize, session/new, in-process session/load replay, session/prompt, session/cancel, and capability-gated agent-to-client JSON-RPC request/response correlation.');
  });

  it('runs a real MCP stdio and loopback A2A/ACP HTTP smoke', async () => {
    const result = await runHermesProtocolGatewaySmoke();

    expect(result).toMatchObject({
      kind: 'hermes_protocol_gateway_smoke',
      schemaVersion: 1,
      ok: true,
      mcpStdio: {
        ok: true,
        echoText: 'HERMES_PROTOCOL_MCP:OK',
        serverName: 'hermes_protocol_fixture',
        toolCount: 1,
        transport: 'stdio',
      },
      httpRoutes: {
        ok: true,
        a2aAgentName: 'Code Buddy',
      },
    });
    expect(result.httpRoutes.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(result.httpRoutes.acpSessionCount).toBe(1);
    expect(result.httpRoutes.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/api/a2a/.well-known/agent.json', ok: true, status: 200 }),
        expect.objectContaining({ path: '/api/a2a/agents', ok: true, status: 200 }),
        expect.objectContaining({ path: '/api/acp/sessions', ok: true, status: 201 }),
        expect.objectContaining({ path: '/api/acp/sessions', ok: true, status: 200 }),
      ]),
    );
  }, 20_000);
});
