/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesProtocolGatewaysStrip,
  type HermesProtocolGatewayReadiness,
} from '../src/renderer/components/hermes-protocol-gateways-strip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) =>
          value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template,
      );
    },
  }),
}));

const readyProtocolGateways: HermesProtocolGatewayReadiness = {
  capabilities: [
    {
      commands: ['npm test -- tests/mcp/mcp-stdio-real-fixture.test.ts --run'],
      endpoints: [],
      evidence: ['src/mcp/client.ts'],
      id: 'mcp-client',
      label: 'MCP client',
      notes: ['The SDK-backed MCP manager supports stdio and HTTP transports.'],
      officialSurface: 'Connect to external MCP servers and expose their tools to the agent',
      status: 'available',
    },
    {
      commands: ['npm test -- tests/server/a2a-protocol.test.ts --run'],
      endpoints: ['/api/a2a/.well-known/agent.json', '/api/a2a/agents'],
      evidence: ['src/server/routes/a2a-protocol.ts'],
      id: 'a2a-http',
      label: 'A2A HTTP gateway',
      notes: ['AgentCard discovery and task routes.'],
      officialSurface: 'AgentCard discovery, agent listing, task send/status/cancel',
      status: 'available',
    },
    {
      commands: ['npx tsx src/index.ts hermes protocols status --json'],
      endpoints: ['/api/acp/*'],
      evidence: ['src/server/routes/acp.ts'],
      id: 'acp-editor-integration',
      label: 'ACP editor integration',
      notes: ['Packaged editor integration remains partial.'],
      officialSurface: 'Drop-in Hermes ACP server/editor workflow parity',
      status: 'partial',
    },
  ],
  generatedAt: '2026-05-31T16:30:00.000Z',
  kind: 'hermes_protocol_gateway_readiness',
  officialSurface: 'Hermes MCP/ACP/A2A protocol gateways and editor/server integration',
  ok: true,
  recommendations: ['Run the local smoke before claiming protocol transport health on a workstation.'],
  schemaVersion: 1,
  smokeCommand: 'buddy hermes protocols-smoke local --json',
  summary: {
    availableCount: 2,
    missingCount: 0,
    partialCount: 1,
    total: 3,
  },
};

describe('HermesProtocolGatewaysStrip', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('renders protocol readiness and the real smoke command', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(HermesProtocolGatewaysStrip, { readiness: readyProtocolGateways }));
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-protocol-gateways"]');
    expect(strip?.textContent).toContain('Hermes protocol gateways');
    expect(strip?.textContent).toContain('protocols ready');
    expect(strip?.textContent).toContain('MCP client');
    expect(strip?.textContent).toContain('A2A HTTP gateway');
    expect(strip?.textContent).toContain('ACP editor integration');
    expect(strip?.textContent).toContain('buddy hermes protocols-smoke local --json');
  });

  it('loads protocol readiness from the Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(readyProtocolGateways);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesProtocolGateways?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesProtocolGateways: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesProtocolGatewaysStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('MCP client');
  });

  it('runs an opt-in protocol smoke through the Electron bridge', async () => {
    const target = container();
    const smoke = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        durationMs: 64,
        generatedAt: '2026-05-31T16:31:00.064Z',
        httpRoutes: {
          a2aAgentName: 'Code Buddy',
          acpSessionCount: 1,
          baseUrl: 'http://127.0.0.1:54321',
          ok: true,
          routes: [
            { ok: true, path: '/api/a2a/.well-known/agent.json', status: 200 },
            { ok: true, path: '/api/a2a/agents', status: 200 },
            { ok: true, path: '/api/acp/sessions', status: 201 },
            { ok: true, path: '/api/acp/sessions', status: 200 },
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
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesProtocolGateways?: {
            smoke: typeof smoke;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesProtocolGateways: {
          smoke,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesProtocolGatewaysStrip, { readiness: readyProtocolGateways }));
      await Promise.resolve();
    });

    const button = target.querySelector('[data-testid="hermes-protocol-gateways-smoke"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(smoke).toHaveBeenCalledWith();
    const result = target.querySelector('[data-testid="hermes-protocol-gateways-smoke-result"]');
    expect(result?.textContent).toContain('smoke passed');
    expect(result?.textContent).toContain('HERMES_PROTOCOL_MCP:OK');
    expect(result?.textContent).toContain('HTTP 4 routes');
  });
});
