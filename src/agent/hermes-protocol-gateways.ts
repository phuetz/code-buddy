import fs from 'fs';
import { createRequire } from 'module';
import { createServer, type Server as HttpServer } from 'http';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import express, { type NextFunction, type Request, type Response } from 'express';

import { MCPManager } from '../mcp/client.js';
import { createA2AProtocolRoutes } from '../server/routes/a2a-protocol.js';
import { createACPRoutes } from '../server/routes/acp.js';

const require = createRequire(import.meta.url);

export type HermesProtocolGatewayStatus = 'available' | 'partial' | 'missing';

export interface HermesProtocolGatewayCapability {
  id: string;
  label: string;
  officialSurface: string;
  status: HermesProtocolGatewayStatus;
  evidence: string[];
  endpoints: string[];
  commands: string[];
  notes: string[];
}

export interface HermesProtocolGatewayReadiness {
  kind: 'hermes_protocol_gateway_readiness';
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  officialSurface: string;
  summary: {
    total: number;
    availableCount: number;
    partialCount: number;
    missingCount: number;
  };
  capabilities: HermesProtocolGatewayCapability[];
  smokeCommand: string;
  recommendations: string[];
}

export interface HermesProtocolGatewaySmokeResult {
  kind: 'hermes_protocol_gateway_smoke';
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  durationMs: number;
  mcpStdio: {
    echoText?: string;
    ok: boolean;
    serverName: string;
    toolCount: number;
    transport?: string;
    error?: string;
  };
  httpRoutes: {
    a2aAgentName?: string;
    acpSessionCount?: number;
    baseUrl?: string;
    ok: boolean;
    routes: Array<{
      ok: boolean;
      path: string;
      status: number;
    }>;
    error?: string;
  };
}

const OFFICIAL_SURFACE = 'Hermes MCP/ACP/A2A protocol gateways and editor/server integration';

const CAPABILITIES: HermesProtocolGatewayCapability[] = [
  {
    id: 'mcp-client',
    label: 'MCP client',
    officialSurface: 'Connect to external MCP servers and expose their tools to the agent',
    status: 'available',
    evidence: [
      'src/mcp/client.ts',
      'src/mcp/transports.ts',
      'src/agent/tool-handler.ts',
      'tests/mcp/mcp-stdio-real-fixture.test.ts',
      'tests/mcp/mcp-http-real-fixture.test.ts',
    ],
    endpoints: [],
    commands: [
      'npm test -- tests/mcp/mcp-stdio-real-fixture.test.ts tests/mcp/mcp-http-real-fixture.test.ts --run',
    ],
    notes: [
      'The SDK-backed MCP manager supports stdio and HTTP transports and registers mcp__server__tool schemas.',
    ],
  },
  {
    id: 'mcp-server',
    label: 'Code Buddy MCP server',
    officialSurface: 'Expose Code Buddy capabilities through an MCP server process',
    status: 'available',
    evidence: [
      'src/mcp/mcp-server.ts',
      'src/integrations/mcp/mcp-server.ts',
      'tests/mcp/mcp-server.test.ts',
      'tests/integrations/mcp-server.test.ts',
    ],
    endpoints: [],
    commands: [
      'npm test -- tests/mcp/mcp-server.test.ts tests/integrations/mcp-server.test.ts --run',
    ],
    notes: [
      'Code Buddy exposes file, shell, search, git, session, memory, and agent tools over MCP-compatible server surfaces.',
    ],
  },
  {
    id: 'a2a-http',
    label: 'A2A HTTP gateway',
    officialSurface: 'AgentCard discovery, agent listing, task send/status/cancel, remote agent registration',
    status: 'available',
    evidence: [
      'src/server/routes/a2a-protocol.ts',
      'src/protocols/a2a/index.ts',
      'tests/server/a2a-protocol.test.ts',
      'tests/protocols/a2a.test.ts',
    ],
    endpoints: [
      'GET /api/a2a/.well-known/agent.json',
      'GET /api/a2a/agents',
      'POST /api/a2a/tasks/send',
      'GET /api/a2a/tasks/:id',
      'POST /api/a2a/tasks/:id/cancel',
    ],
    commands: [
      'npm test -- tests/server/a2a-protocol.test.ts tests/protocols/a2a.test.ts --run',
    ],
    notes: [
      'The inbound Code Buddy A2A card intentionally advertises read-only skills by default.',
    ],
  },
  {
    id: 'acp-http',
    label: 'ACP HTTP gateway',
    officialSurface: 'Agent communication transport with named sessions, request/send, yield/resume, cancel and soft-close',
    status: 'available',
    evidence: [
      'src/server/routes/acp.ts',
      'src/acp/protocol.ts',
      'src/protocols/acp/acp-server.ts',
      'tests/server/acp-routes.test.ts',
      'tests/acp/protocol.test.ts',
    ],
    endpoints: [
      'POST /api/acp/send',
      'GET /api/acp/agents',
      'POST /api/acp/request',
      'GET /api/acp/tasks/:id',
      'POST /api/acp/tasks/:id/yield',
      'POST /api/acp/tasks/:id/resume',
      'GET /api/acp/sessions',
      'POST /api/acp/sessions',
    ],
    commands: [
      'npm test -- tests/server/acp-routes.test.ts tests/acp/protocol.test.ts --run',
    ],
    notes: [
      'ACP routes are present as HTTP transport primitives; exact editor packaging remains product-dependent.',
    ],
  },
  {
    id: 'channel-a2a-bridge',
    label: 'Channel to A2A bridge',
    officialSurface: 'Route messaging-channel inbound prompts into the local A2A hub',
    status: 'available',
    evidence: [
      'src/server/channel-a2a-bridge.ts',
      'docs/channel-a2a-bridge.md',
      'tests/server/channel-a2a-bridge.test.ts',
    ],
    endpoints: [
      'POST /api/a2a/tasks/send',
    ],
    commands: [
      'npm test -- tests/server/channel-a2a-bridge.test.ts --run',
    ],
    notes: [
      'The bridge keeps channel ingestion separate from model execution and calls the local hub over HTTP.',
    ],
  },
  {
    id: 'acp-editor-integration',
    label: 'ACP editor integration',
    officialSurface: 'Drop-in Hermes ACP server/editor workflow parity',
    status: 'partial',
    evidence: [
      'src/protocols/acp/acp-stdio-server.ts',
      'src/commands/cli/acp-command.ts',
      'tests/protocols/acp-stdio-server-real.test.ts',
      'src/server/routes/acp.ts',
      'src/protocols/acp/acp-server.ts',
      'docs/commands.md',
    ],
    endpoints: [
      'stdio: buddy acp',
      '/api/acp/*',
    ],
    commands: [
      'npm test -- tests/protocols/acp-stdio-server-real.test.ts --run',
      'npx tsx src/index.ts hermes protocols status --json',
    ],
    notes: [
      'The stdio ACP transport supports initialize, session/new, in-process session/list, session/load replay, session/prompt, session/cancel, and capability-gated agent-to-client JSON-RPC request/response correlation.',
      'Exact upstream Hermes editor packaging and live editor validation are not yet claimed.',
    ],
  },
];

export function buildHermesProtocolGatewayReadiness(): HermesProtocolGatewayReadiness {
  const capabilities = CAPABILITIES.map((capability) => ({ ...capability }));
  const summary = summarizeCapabilities(capabilities);
  return {
    kind: 'hermes_protocol_gateway_readiness',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: summary.missingCount === 0,
    officialSurface: OFFICIAL_SURFACE,
    summary,
    capabilities,
    smokeCommand: 'buddy hermes protocols-smoke local --json',
    recommendations: buildRecommendations(summary),
  };
}

export function renderHermesProtocolGatewayReadiness(readiness: HermesProtocolGatewayReadiness): string {
  const lines = [
    'Hermes protocol gateway readiness:',
    `Status: ${readiness.ok ? 'ok' : 'needs attention'}`,
    `Surface: ${readiness.officialSurface}`,
    `Capabilities: ${readiness.summary.availableCount} available, ${readiness.summary.partialCount} partial, ${readiness.summary.missingCount} missing`,
    `Smoke: ${readiness.smokeCommand}`,
    '',
    'Capabilities:',
  ];

  for (const capability of readiness.capabilities) {
    lines.push(`- ${capability.status.padEnd(9)} ${capability.id}: ${capability.label}`);
    if (capability.endpoints.length > 0) {
      lines.push('  Endpoints:');
      for (const endpoint of capability.endpoints) {
        lines.push(`    - ${endpoint}`);
      }
    }
    lines.push(`  Verify: ${capability.commands[0] ?? 'n/a'}`);
    lines.push(`  Evidence: ${capability.evidence.length} file/test reference(s)`);
    if (capability.notes.length > 0) {
      lines.push(`  Notes: ${capability.notes.join(' ')}`);
    }
  }

  if (readiness.recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const recommendation of readiness.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  return lines.join('\n');
}

export async function runHermesProtocolGatewaySmoke(): Promise<HermesProtocolGatewaySmokeResult> {
  const startedAt = Date.now();
  const [mcpStdio, httpRoutes] = await Promise.all([
    runMcpStdioSmoke(),
    runHttpRoutesSmoke(),
  ]);

  return {
    kind: 'hermes_protocol_gateway_smoke',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: mcpStdio.ok && httpRoutes.ok,
    durationMs: Date.now() - startedAt,
    mcpStdio,
    httpRoutes,
  };
}

export function renderHermesProtocolGatewaySmoke(result: HermesProtocolGatewaySmokeResult): string {
  return [
    'Hermes protocol gateway smoke:',
    `Status: ${result.ok ? 'passed' : 'failed'}`,
    `MCP stdio: ${result.mcpStdio.ok ? 'passed' : 'failed'} (${result.mcpStdio.toolCount} tool(s))`,
    result.mcpStdio.echoText ? `MCP echo: ${result.mcpStdio.echoText}` : undefined,
    `HTTP routes: ${result.httpRoutes.ok ? 'passed' : 'failed'} (${result.httpRoutes.routes.length} route(s))`,
    result.httpRoutes.baseUrl ? `Base URL: ${result.httpRoutes.baseUrl}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

async function runMcpStdioSmoke(): Promise<HermesProtocolGatewaySmokeResult['mcpStdio']> {
  const serverName = 'hermes_protocol_fixture';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-protocol-mcp-'));
  const fixturePath = path.join(tempDir, 'fixture.mjs');
  const manager = new MCPManager();

  try {
    fs.writeFileSync(fixturePath, buildMcpFixtureSource(), 'utf-8');
    await manager.addServer({
      name: serverName,
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [fixturePath],
      },
    });
    const result = await manager.callTool(`mcp__${serverName}__echo_marker`, {
      message: 'OK',
    });
    const echoText = extractTextContent(result.content);
    const toolCount = manager.getTools().length;
    const transport = manager.getTransportType(serverName);
    await manager.removeServer(serverName);
    return {
      echoText,
      ok: echoText === 'HERMES_PROTOCOL_MCP:OK',
      serverName,
      toolCount,
      transport,
    };
  } catch (error) {
    return {
      ok: false,
      serverName,
      toolCount: manager.getTools().length,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await manager.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runHttpRoutesSmoke(): Promise<HermesProtocolGatewaySmokeResult['httpRoutes']> {
  let server: HttpServer | null = null;

  try {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = {
        scopes: ['admin'],
        type: 'api_key',
      };
      next();
    });
    app.use('/api/a2a', createA2AProtocolRoutes());
    app.use('/api/acp', createACPRoutes());

    server = createServer(app);
    const baseUrl = await listenLoopback(server);
    const routes: HermesProtocolGatewaySmokeResult['httpRoutes']['routes'] = [];

    const a2aCard = await fetchJson<{ name?: string }>(`${baseUrl}/api/a2a/.well-known/agent.json`);
    routes.push({ ok: a2aCard.status === 200 && a2aCard.body.name === 'Code Buddy', path: '/api/a2a/.well-known/agent.json', status: a2aCard.status });

    const a2aAgents = await fetchJson<{ agents?: unknown[] }>(`${baseUrl}/api/a2a/agents`);
    routes.push({ ok: a2aAgents.status === 200 && Array.isArray(a2aAgents.body.agents), path: '/api/a2a/agents', status: a2aAgents.status });

    const acpSession = await fetchJson<{ id?: string; name?: string }>(`${baseUrl}/api/acp/sessions`, {
      body: JSON.stringify({ name: 'hermes-protocol-smoke' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    routes.push({ ok: acpSession.status === 201 && acpSession.body.name === 'hermes-protocol-smoke', path: '/api/acp/sessions', status: acpSession.status });

    const acpSessions = await fetchJson<{ sessions?: unknown[] }>(`${baseUrl}/api/acp/sessions`);
    routes.push({ ok: acpSessions.status === 200 && Array.isArray(acpSessions.body.sessions), path: '/api/acp/sessions', status: acpSessions.status });

    return {
      a2aAgentName: a2aCard.body.name,
      acpSessionCount: Array.isArray(acpSessions.body.sessions) ? acpSessions.body.sessions.length : undefined,
      baseUrl,
      ok: routes.every((route) => route.ok),
      routes,
    };
  } catch (error) {
    return {
      ok: false,
      routes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (server) {
      await closeServer(server);
    }
  }
}

function summarizeCapabilities(capabilities: HermesProtocolGatewayCapability[]): HermesProtocolGatewayReadiness['summary'] {
  return {
    total: capabilities.length,
    availableCount: capabilities.filter((capability) => capability.status === 'available').length,
    partialCount: capabilities.filter((capability) => capability.status === 'partial').length,
    missingCount: capabilities.filter((capability) => capability.status === 'missing').length,
  };
}

function buildRecommendations(summary: HermesProtocolGatewayReadiness['summary']): string[] {
  const recommendations = ['Run the local smoke before claiming protocol transport health on a workstation.'];
  if (summary.partialCount > 0) {
    recommendations.push('Keep ACP editor integration partial until a packaged editor workflow is verified end-to-end.');
  }
  if (summary.missingCount > 0) {
    recommendations.push('Implement missing protocol gateways before claiming full Hermes MCP/ACP parity.');
  }
  return recommendations;
}

function buildMcpFixtureSource(): string {
  const mcpServerUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js')).href;
  const stdioTransportUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href;
  const zodUrl = pathToFileURL(require.resolve('zod')).href;

  return [
    `import mcpModule from '${mcpServerUrl}';`,
    `import stdioModule from '${stdioTransportUrl}';`,
    `import zodModule from '${zodUrl}';`,
    '',
    'const { McpServer } = mcpModule;',
    'const { StdioServerTransport } = stdioModule;',
    'const { z } = zodModule;',
    "const server = new McpServer({ name: 'hermes-protocol-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });",
    "server.tool('echo_marker', 'Echo a deterministic Hermes protocol marker.', { message: z.string() }, async ({ message }) => ({ content: [{ type: 'text', text: `HERMES_PROTOCOL_MCP:${message}` }] }));",
    'const transport = new StdioServerTransport();',
    'await server.connect(transport);',
    '',
  ].join('\n');
}

async function listenLoopback(server: HttpServer): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Loopback HTTP server did not expose a port');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ body: T; status: number }> {
  const response = await fetch(url, init);
  const body = await response.json() as T;
  return {
    body,
    status: response.status,
  };
}

function extractTextContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const first = content[0] as { text?: unknown; type?: unknown } | undefined;
  return first?.type === 'text' && typeof first.text === 'string' ? first.text : undefined;
}
