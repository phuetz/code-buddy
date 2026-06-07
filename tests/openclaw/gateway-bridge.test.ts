import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createServer, type Server } from 'http';
import * as os from 'os';
import * as path from 'path';
import { WebSocketServer } from 'ws';
import {
  attachOpenClawGateway,
  approveOpenClawPendingNode,
  buildOpenClawNodeDescriptor,
  buildOpenClawResponsePreview,
  callOpenClawGatewayWebSocket,
  discoverOpenClawGateway,
  listOpenClawPendingNodes,
  mapOpenClawChannelToCodeBuddy,
  prepareOpenClawFleetHandoffDraft,
  probeOpenClawGatewayWebSocket,
  sendOpenClawResponse,
  validateOpenClawUpstreamCompatibility,
} from '../../src/openclaw/gateway-bridge.js';

async function startOpenClawContractServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  requests: Array<{ path: string; authorization?: string; body: unknown }>;
}> {
  const requests: Array<{ path: string; authorization?: string; body: unknown }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) as unknown : null;
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      requests.push({
        path: url.pathname,
        authorization: req.headers.authorization,
        body,
      });
      res.setHeader('content-type', 'application/json');
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ accepted: false, error: 'method not allowed' }));
        return;
      }
      if (url.pathname === '/rpc/nodes/register') {
        res.end(JSON.stringify({ accepted: true, nodeId: 'codebuddy-contract-node' }));
        return;
      }
      if (url.pathname === '/rpc/messages/reply') {
        res.end(JSON.stringify({ accepted: true, messageId: 'openclaw-contract-reply-1' }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ accepted: false, error: 'not found' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind OpenClaw contract server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function startOpenClawWebSocketContractServer(): Promise<{
  wsUrl: string;
  close: () => Promise<void>;
  frames: unknown[];
}> {
  const frames: unknown[] = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      frames.push(frame);
      if (frame.type === 'connect') {
        socket.send(JSON.stringify({
          type: 'hello-ok',
          gatewayId: 'openclaw-ws-contract-gateway',
          uptimeMs: 1234,
          features: {
            methods: ['status', 'logs.tail', 'nodes.pending', 'nodes.approve'],
          },
        }));
        return;
      }
      if (frame.type === 'req' && frame.method === 'status') {
        socket.send(JSON.stringify({
          type: 'res',
          id: frame.id,
          ok: true,
          payload: {
            status: 'ok',
            tokenEcho: 'oc_ws_contract_secret_fixture',
          },
        }));
        return;
      }
      if (frame.type === 'req' && frame.method === 'logs.tail') {
        socket.send(JSON.stringify({
          type: 'res',
          id: frame.id,
          ok: true,
          payload: {
            lines: ['secret=oc_ws_call_payload_secret'],
          },
        }));
        return;
      }
      if (frame.type === 'req' && frame.method === 'nodes.pending') {
        socket.send(JSON.stringify({
          type: 'res',
          id: frame.id,
          ok: true,
          payload: {
            nodes: [
              {
                nodeId: 'pending-node-1',
                displayName: 'Dev Laptop',
                code: 'PAIR-SECRET-123',
                token: 'pending-node-token-secret',
              },
            ],
          },
        }));
        return;
      }
      if (frame.type === 'req' && frame.method === 'nodes.approve') {
        const params = frame.params && typeof frame.params === 'object'
          ? frame.params as Record<string, unknown>
          : {};
        socket.send(JSON.stringify({
          type: 'res',
          id: frame.id,
          ok: true,
          payload: {
            approved: true,
            nodeId: typeof params.nodeId === 'string' ? params.nodeId : 'approved-by-code-node',
            code: 'APPROVE-CODE-ECHO-SECRET',
            token: 'approve-token-secret',
          },
        }));
      }
    });
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind OpenClaw WebSocket contract server');
  }
  return {
    wsUrl: `ws://127.0.0.1:${address.port}`,
    frames,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

describe('OpenClaw gateway bridge compatibility', () => {
  let tempDir: string;
  let openclawHome: string;
  let workspace: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'openclaw-bridge-'));
    openclawHome = path.join(tempDir, '.openclaw');
    workspace = path.join(tempDir, 'workspace');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers an OpenClaw gateway lockfile without exposing secrets', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      nodeId: 'openclaw-node-1',
      pid: 4242,
      wsUrl: 'ws://127.0.0.1:4150/ws',
      workspace: '/tmp/openclaw-workspace',
      methods: ['node.describe', 'message.send'],
      token: 'oc_secret_token_fixture',
    }, null, 2), 'utf8');

    const discovery = await discoverOpenClawGateway({
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(discovery).toMatchObject({
      kind: 'openclaw_gateway_discovery',
      found: true,
      cwd: workspace,
      daemon: {
        nodeId: 'openclaw-node-1',
        pid: 4242,
        wsUrl: 'ws://127.0.0.1:4150/ws',
        methods: ['message.send', 'node.describe'],
      },
      safety: {
        secretsIncluded: false,
        tokenPresent: true,
        networkContacted: false,
      },
    });
    expect(JSON.stringify(discovery)).not.toContain('oc_secret_token_fixture');
  });

  it('discovers OpenClaw node host metadata from node.json without exposing pairing tokens', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_gateway_secret_fixture',
    }, null, 2), 'utf8');
    await writeFile(path.join(openclawHome, 'node.json'), JSON.stringify({
      nodeId: 'openclaw-node-host-1',
      displayName: 'Build Server Node',
      gatewayHost: '127.0.0.1',
      gatewayPort: 18789,
      tls: false,
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_node_pairing_secret_fixture',
      capabilities: ['system.run', 'system.which', 'browser.proxy'],
    }, null, 2), 'utf8');

    const discovery = await discoverOpenClawGateway({
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:02:00.000Z'),
    });

    expect(discovery.nodeHost).toMatchObject({
      found: true,
      nodeId: 'openclaw-node-host-1',
      displayName: 'Build Server Node',
      gatewayHost: '127.0.0.1',
      gatewayPort: 18789,
      tls: false,
      wsUrl: 'ws://127.0.0.1:18789',
      capabilities: ['browser.proxy', 'system.run', 'system.which'],
    });
    expect(discovery.safety).toMatchObject({
      secretsIncluded: false,
      tokenPresent: true,
      nodeTokenPresent: true,
      networkContacted: false,
    });
    expect(JSON.stringify(discovery)).not.toContain('oc_gateway_secret_fixture');
    expect(JSON.stringify(discovery)).not.toContain('oc_node_pairing_secret_fixture');
  });

  it('advertises a safe Code Buddy node descriptor for OpenClaw', () => {
    const descriptor = buildOpenClawNodeDescriptor({
      nodeId: 'codebuddy-node-1',
      extraMethods: ['openclaw.custom.echo'],
    });

    expect(descriptor).toMatchObject({
      kind: 'openclaw_node_descriptor',
      nodeId: 'codebuddy-node-1',
      role: 'codebuddy-fleet-bridge',
      capabilities: {
        fleetDispatchDraft: true,
        directGatewaySend: false,
        rawTextStorage: false,
      },
      safety: {
        localOnly: true,
        requiresLocalApproval: true,
        autoDispatch: false,
        secretsIncluded: false,
      },
    });
    expect(descriptor.methods).toEqual(expect.arrayContaining([
      'openclaw.message.ingest',
      'openclaw.message.reply.preview',
      'peer.describe',
      'peer.tool.invoke',
      'openclaw.custom.echo',
    ]));
  });

  it('prepares a redacted Fleet handoff draft from an OpenClaw message', async () => {
    const draft = await prepareOpenClawFleetHandoffDraft({
      id: 'oc-msg-1',
      channel: 'telegram',
      senderId: 'u-1',
      senderName: 'Patrice',
      threadId: 'thread-1',
      messageId: 'telegram-42',
      text: 'Please investigate the incident. password=openclaw-secret-fixture',
      attachmentCount: 1,
    }, {
      cwd: workspace,
      now: new Date('2026-06-07T12:05:00.000Z'),
      createId: () => 'openclaw-handoff-1',
    });

    expect(draft).toMatchObject({
      kind: 'openclaw_fleet_handoff_draft',
      id: 'openclaw-handoff-1',
      cwd: workspace,
      source: {
        openclawMessageId: 'oc-msg-1',
        channel: 'telegram',
        senderId: 'u-1',
        threadId: 'thread-1',
        messageId: 'telegram-42',
        attachmentCount: 1,
      },
      dispatchInput: {
        parallelism: 1,
        privacyTag: 'sensitive',
        dispatchProfile: 'safe',
        deliveryChannel: 'openclaw:telegram',
        sourceSessionId: 'openclaw:telegram:thread-1',
      },
      safety: {
        rawTextStored: false,
        previewOnly: true,
        autoDispatch: false,
        requiresLocalApproval: true,
        directGatewaySend: false,
      },
    });
    expect(draft.dispatchInput.goal).toContain('password=[redacted]');
    expect(JSON.stringify(draft)).not.toContain('openclaw-secret-fixture');
    const rawDraft = await readFile(draft.draftFile, 'utf8');
    expect(rawDraft).toContain('openclaw-handoff-1');
    expect(rawDraft).not.toContain('openclaw-secret-fixture');
  });

  it('builds response previews without live OpenClaw sends', () => {
    const preview = buildOpenClawResponsePreview({
      openclawMessageId: 'oc-msg-2',
      channel: 'discord',
      threadId: 'thread-2',
      text: 'Here is the reviewed reply. secret=response-secret-fixture',
      now: new Date('2026-06-07T12:10:00.000Z'),
    });

    expect(preview).toMatchObject({
      kind: 'openclaw_bridge_response_preview',
      openclawMessageId: 'oc-msg-2',
      channel: 'discord',
      threadId: 'thread-2',
      dryRun: true,
      requiresLocalApproval: true,
      safety: {
        directGatewaySend: false,
        secretsIncluded: false,
      },
    });
    expect(preview.textPreview).toContain('secret=[redacted]');
    expect(JSON.stringify(preview)).not.toContain('response-secret-fixture');
  });

  it('maps known OpenClaw channel names onto Code Buddy channel types', () => {
    expect(mapOpenClawChannelToCodeBuddy('telegram')).toBe('telegram');
    expect(mapOpenClawChannelToCodeBuddy('email')).toBe('gmail');
    expect(mapOpenClawChannelToCodeBuddy('unknown-openclaw-channel')).toBe('webchat');
  });

  it('previews OpenClaw gateway attach without contacting the daemon', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      nodeId: 'openclaw-node-attach',
      httpUrl: 'http://127.0.0.1:4150/',
      token: 'oc_attach_secret_fixture',
    }, null, 2), 'utf8');
    let contacted = false;

    const result = await attachOpenClawGateway({
      dryRun: true,
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:15:00.000Z'),
      createId: () => 'attach-preview-1',
      transport: async () => {
        contacted = true;
        return { ok: true, status: 200 };
      },
    });

    expect(result.ok).toBe(true);
    expect(contacted).toBe(false);
    expect(result.record).toMatchObject({
      id: 'attach-preview-1',
      status: 'preview',
      dryRun: true,
      endpoint: 'http://127.0.0.1:4150/nodes/register',
      safety: {
        tokenPresent: true,
        tokenSent: false,
        networkContacted: false,
        secretsIncluded: false,
      },
    });
    const rawLog = await readFile(result.attachLogPath, 'utf8');
    expect(rawLog).toContain('attach-preview-1');
    expect(rawLog).not.toContain('oc_attach_secret_fixture');
  });

  it('previews the OpenClaw WebSocket probe without contacting the gateway', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_ws_preview_secret_fixture',
    }, null, 2), 'utf8');

    const result = await probeOpenClawGatewayWebSocket({
      dryRun: true,
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:17:00.000Z'),
      createId: () => 'ws-preview-1',
    });

    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({
      id: 'ws-preview-1',
      status: 'preview',
      wsUrl: 'ws://127.0.0.1:18789/',
      dryRun: true,
      safety: {
        tokenPresent: true,
        tokenSent: false,
        networkContacted: false,
        secretsIncluded: false,
      },
    });
    const rawLog = await readFile(result.probeLogPath, 'utf8');
    expect(rawLog).toContain('ws-preview-1');
    expect(rawLog).not.toContain('oc_ws_preview_secret_fixture');
  });

  it('blocks live OpenClaw WebSocket probes without explicit confirmation', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      wsUrl: 'ws://127.0.0.1:18789',
    }, null, 2), 'utf8');

    const result = await probeOpenClawGatewayWebSocket({
      dryRun: false,
      approvedBy: 'Patrice',
      liveProbeConfirmed: false,
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:18:00.000Z'),
      createId: () => 'ws-blocked-1',
    });

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('blocked');
    expect(result.error).toBe('liveProbeConfirmed is required for live OpenClaw WebSocket probe');
    expect(result.record.safety.networkContacted).toBe(false);
  });

  it('validates the OpenClaw WebSocket connect and status contract against a local gateway fixture', async () => {
    const server = await startOpenClawWebSocketContractServer();
    try {
      await mkdir(openclawHome, { recursive: true });
      await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
        nodeId: 'openclaw-ws-contract-daemon',
        wsUrl: server.wsUrl,
        token: 'oc_ws_contract_secret_fixture',
      }, null, 2), 'utf8');

      const result = await probeOpenClawGatewayWebSocket({
        approvedBy: 'Patrice',
        dryRun: false,
        liveProbeConfirmed: true,
        timeoutMs: 2000,
      }, {
        home: openclawHome,
        cwd: workspace,
        now: new Date('2026-06-07T12:19:00.000Z'),
        createId: () => 'ws-contract-1',
      });

      expect(result.ok).toBe(true);
      expect(result.record).toMatchObject({
        id: 'ws-contract-1',
        status: 'connected',
        approvedBy: 'Patrice',
        liveProbeConfirmed: true,
        response: {
          helloOk: true,
          statusResponseOk: true,
          gatewayId: 'openclaw-ws-contract-gateway',
          uptimeMs: 1234,
          methodCount: 4,
          methodSample: ['logs.tail', 'nodes.approve', 'nodes.pending', 'status'],
          frameTypes: ['hello-ok', 'res'],
        },
        safety: {
          tokenPresent: true,
          tokenSent: true,
          networkContacted: true,
          secretsIncluded: false,
        },
      });
      expect(server.frames).toHaveLength(2);
      expect(server.frames[0]).toMatchObject({
        type: 'connect',
        auth: {
          token: 'oc_ws_contract_secret_fixture',
        },
      });
      expect(server.frames[1]).toMatchObject({
        type: 'req',
        id: 'ws-contract-1',
        method: 'status',
      });
      expect(JSON.stringify(result)).not.toContain('oc_ws_contract_secret_fixture');
      const rawLog = await readFile(result.probeLogPath, 'utf8');
      expect(rawLog).toContain('ws-contract-1');
      expect(rawLog).not.toContain('oc_ws_contract_secret_fixture');
    } finally {
      await server.close();
    }
  });

  it('previews OpenClaw WebSocket RPC calls without contacting the gateway', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      wsUrl: 'ws://127.0.0.1:18789',
      token: 'oc_ws_call_preview_secret_fixture',
    }, null, 2), 'utf8');

    const result = await callOpenClawGatewayWebSocket({
      method: 'logs.tail',
      params: { sinceMs: 60000, secret: 'params-preview-secret' },
      dryRun: true,
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:21:00.000Z'),
      createId: () => 'ws-call-preview-1',
    });

    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({
      id: 'ws-call-preview-1',
      status: 'preview',
      wsUrl: 'ws://127.0.0.1:18789/',
      request: {
        method: 'logs.tail',
        paramKeys: ['secret', 'sinceMs'],
      },
      safety: {
        tokenPresent: true,
        tokenSent: false,
        networkContacted: false,
        rawPayloadsStored: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('params-preview-secret');
    const rawLog = await readFile(result.callLogPath, 'utf8');
    expect(rawLog).toContain('ws-call-preview-1');
    expect(rawLog).not.toContain('oc_ws_call_preview_secret_fixture');
    expect(rawLog).not.toContain('params-preview-secret');
  });

  it('validates guarded live OpenClaw WebSocket RPC calls without logging params or payloads', async () => {
    const server = await startOpenClawWebSocketContractServer();
    try {
      await mkdir(openclawHome, { recursive: true });
      await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
        wsUrl: server.wsUrl,
        token: 'oc_ws_call_secret_fixture',
      }, null, 2), 'utf8');

      const result = await callOpenClawGatewayWebSocket({
        approvedBy: 'Patrice',
        dryRun: false,
        liveCallConfirmed: true,
        method: 'logs.tail',
        params: {
          sinceMs: 60000,
          secret: 'params-live-secret',
        },
        timeoutMs: 2000,
      }, {
        home: openclawHome,
        cwd: workspace,
        now: new Date('2026-06-07T12:22:00.000Z'),
        createId: () => 'ws-call-contract-1',
      });

      expect(result.ok).toBe(true);
      expect(result.record).toMatchObject({
        id: 'ws-call-contract-1',
        status: 'called',
        approvedBy: 'Patrice',
        liveCallConfirmed: true,
        request: {
          method: 'logs.tail',
          paramKeys: ['secret', 'sinceMs'],
        },
        response: {
          helloOk: true,
          rpcOk: true,
          frameTypes: ['hello-ok', 'res'],
        },
        safety: {
          tokenPresent: true,
          tokenSent: true,
          networkContacted: true,
          rawPayloadsStored: false,
        },
      });
      expect(server.frames).toHaveLength(2);
      expect(server.frames[0]).toMatchObject({
        type: 'connect',
        auth: { token: 'oc_ws_call_secret_fixture' },
      });
      expect(server.frames[1]).toMatchObject({
        type: 'req',
        id: 'ws-call-contract-1',
        method: 'logs.tail',
        params: {
          sinceMs: 60000,
          secret: 'params-live-secret',
        },
      });
      expect(JSON.stringify(result)).not.toContain('oc_ws_call_secret_fixture');
      expect(JSON.stringify(result)).not.toContain('params-live-secret');
      expect(JSON.stringify(result)).not.toContain('oc_ws_call_payload_secret');
      const rawLog = await readFile(result.callLogPath, 'utf8');
      expect(rawLog).toContain('ws-call-contract-1');
      expect(rawLog).not.toContain('oc_ws_call_secret_fixture');
      expect(rawLog).not.toContain('params-live-secret');
      expect(rawLog).not.toContain('oc_ws_call_payload_secret');
    } finally {
      await server.close();
    }
  });

  it('summarizes pending OpenClaw node pairing requests without exposing codes or tokens', async () => {
    const server = await startOpenClawWebSocketContractServer();
    try {
      await mkdir(openclawHome, { recursive: true });
      await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
        wsUrl: server.wsUrl,
        token: 'oc_pairing_pending_gateway_secret',
      }, null, 2), 'utf8');

      const result = await listOpenClawPendingNodes({
        approvedBy: 'Patrice',
        dryRun: false,
        liveCallConfirmed: true,
        timeoutMs: 2000,
      }, {
        home: openclawHome,
        cwd: workspace,
        now: new Date('2026-06-07T12:23:00.000Z'),
        createId: () => 'ws-nodes-pending-1',
      });

      expect(result.ok).toBe(true);
      expect(result.record).toMatchObject({
        id: 'ws-nodes-pending-1',
        status: 'called',
        request: {
          method: 'nodes.pending',
          paramKeys: [],
        },
        response: {
          helloOk: true,
          rpcOk: true,
          summary: {
            pendingCount: 1,
            nodes: [
              {
                nodeId: 'pending-node-1',
                displayName: 'Dev Laptop',
                pairingCodePresent: true,
              },
            ],
          },
        },
      });
      expect(JSON.stringify(result)).not.toContain('PAIR-SECRET-123');
      expect(JSON.stringify(result)).not.toContain('pending-node-token-secret');
      const rawLog = await readFile(result.callLogPath, 'utf8');
      expect(rawLog).toContain('ws-nodes-pending-1');
      expect(rawLog).not.toContain('PAIR-SECRET-123');
      expect(rawLog).not.toContain('pending-node-token-secret');
      expect(rawLog).not.toContain('oc_pairing_pending_gateway_secret');
    } finally {
      await server.close();
    }
  });

  it('approves OpenClaw node pairing requests without logging supplied codes', async () => {
    const server = await startOpenClawWebSocketContractServer();
    try {
      await mkdir(openclawHome, { recursive: true });
      await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
        wsUrl: server.wsUrl,
        token: 'oc_pairing_approve_gateway_secret',
      }, null, 2), 'utf8');

      const result = await approveOpenClawPendingNode({
        code: 'CLI-PAIRING-CODE-SECRET',
        approvedBy: 'Patrice',
        dryRun: false,
        liveCallConfirmed: true,
        timeoutMs: 2000,
      }, {
        home: openclawHome,
        cwd: workspace,
        now: new Date('2026-06-07T12:24:00.000Z'),
        createId: () => 'ws-node-approve-1',
      });

      expect(result.ok).toBe(true);
      expect(result.record).toMatchObject({
        id: 'ws-node-approve-1',
        status: 'called',
        request: {
          method: 'nodes.approve',
          paramKeys: ['code'],
        },
        response: {
          helloOk: true,
          rpcOk: true,
          summary: {
            approved: true,
            nodeId: 'approved-by-code-node',
          },
        },
      });
      expect(server.frames[1]).toMatchObject({
        type: 'req',
        id: 'ws-node-approve-1',
        method: 'nodes.approve',
        params: {
          code: 'CLI-PAIRING-CODE-SECRET',
        },
      });
      expect(JSON.stringify(result)).not.toContain('CLI-PAIRING-CODE-SECRET');
      expect(JSON.stringify(result)).not.toContain('APPROVE-CODE-ECHO-SECRET');
      expect(JSON.stringify(result)).not.toContain('approve-token-secret');
      const rawLog = await readFile(result.callLogPath, 'utf8');
      expect(rawLog).toContain('ws-node-approve-1');
      expect(rawLog).not.toContain('CLI-PAIRING-CODE-SECRET');
      expect(rawLog).not.toContain('APPROVE-CODE-ECHO-SECRET');
      expect(rawLog).not.toContain('approve-token-secret');
      expect(rawLog).not.toContain('oc_pairing_approve_gateway_secret');
    } finally {
      await server.close();
    }
  });

  it('runs a read-only upstream OpenClaw validation checklist against a local gateway fixture', async () => {
    const server = await startOpenClawWebSocketContractServer();
    try {
      await mkdir(openclawHome, { recursive: true });
      await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
        wsUrl: server.wsUrl,
        token: 'oc_upstream_validation_gateway_secret',
      }, null, 2), 'utf8');
      await writeFile(path.join(openclawHome, 'node.json'), JSON.stringify({
        nodeId: 'validation-node',
        token: 'oc_upstream_validation_node_secret',
      }, null, 2), 'utf8');
      const openclawBin = path.join(tempDir, 'openclaw');
      await writeFile(openclawBin, '#!/usr/bin/env sh\nexit 0\n', 'utf8');
      await chmod(openclawBin, 0o755);
      let id = 0;

      const result = await validateOpenClawUpstreamCompatibility({
        approvedBy: 'Patrice',
        dryRun: false,
        liveValidationConfirmed: true,
        openclawBinaryPath: openclawBin,
        timeoutMs: 2000,
      }, {
        home: openclawHome,
        cwd: workspace,
        now: new Date('2026-06-07T12:26:00.000Z'),
        createId: () => `ws-upstream-validation-${++id}`,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe('validated');
      expect(result.safety).toMatchObject({
        readOnly: true,
        networkContacted: true,
        rawPayloadsStored: false,
        secretsIncluded: false,
      });
      expect(result.checks.map((check) => [check.name, check.status])).toEqual([
        ['openclaw-cli', 'passed'],
        ['gateway-lockfile', 'passed'],
        ['websocket-endpoint', 'passed'],
        ['node-lockfile', 'passed'],
        ['secret-redaction', 'passed'],
        ['websocket-probe', 'passed'],
        ['pending-node-list', 'passed'],
      ]);
      expect(result.probe?.record.status).toBe('connected');
      expect(result.pendingNodes?.record.request.method).toBe('nodes.pending');
      expect(JSON.stringify(result)).not.toContain('oc_upstream_validation_gateway_secret');
      expect(JSON.stringify(result)).not.toContain('oc_upstream_validation_node_secret');
      expect(JSON.stringify(result)).not.toContain('PAIR-SECRET-123');
    } finally {
      await server.close();
    }
  });

  it('blocks live OpenClaw gateway attach without explicit confirmation', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      httpUrl: 'http://127.0.0.1:4150/',
    }, null, 2), 'utf8');

    const result = await attachOpenClawGateway({
      dryRun: false,
      approvedBy: 'Patrice',
      liveAttachConfirmed: false,
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:20:00.000Z'),
      createId: () => 'attach-blocked-1',
      transport: async () => {
        throw new Error('should not contact OpenClaw without confirmation');
      },
    });

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('blocked');
    expect(result.error).toBe('liveAttachConfirmed is required for live OpenClaw gateway attach');
  });

  it('attaches to OpenClaw gateway through an injected transport without logging tokens', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      rpcUrl: 'http://127.0.0.1:4150/rpc/',
      token: 'oc_live_attach_secret_fixture',
    }, null, 2), 'utf8');
    const seen: Array<{ url: string; authorization?: string; body: string }> = [];

    const result = await attachOpenClawGateway({
      dryRun: false,
      approvedBy: 'Patrice',
      liveAttachConfirmed: true,
      descriptor: buildOpenClawNodeDescriptor({ nodeId: 'codebuddy-live-node' }),
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:25:00.000Z'),
      createId: () => 'attach-live-1',
      transport: async (url, init) => {
        seen.push({
          url,
          authorization: init.headers.authorization,
          body: init.body,
        });
        return {
          ok: true,
          status: 200,
          json: {
            accepted: true,
            nodeId: 'codebuddy-live-node',
            tokenEcho: 'oc_live_attach_secret_fixture',
          },
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: 'http://127.0.0.1:4150/rpc/nodes/register',
      authorization: 'Bearer oc_live_attach_secret_fixture',
    });
    expect(seen[0]?.body).toContain('codebuddy-live-node');
    expect(result.record).toMatchObject({
      id: 'attach-live-1',
      status: 'attached',
      approvedBy: 'Patrice',
      liveAttachConfirmed: true,
      safety: {
        tokenPresent: true,
        tokenSent: true,
        networkContacted: true,
        secretsIncluded: false,
      },
      response: {
        status: 200,
        ok: true,
        accepted: true,
        nodeId: 'codebuddy-live-node',
      },
    });
    expect(JSON.stringify(result)).not.toContain('oc_live_attach_secret_fixture');
    const rawLog = await readFile(result.attachLogPath, 'utf8');
    expect(rawLog).toContain('attach-live-1');
    expect(rawLog).not.toContain('oc_live_attach_secret_fixture');
  });

  it('previews OpenClaw response sends without contacting the daemon', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      httpUrl: 'http://127.0.0.1:4150/',
      token: 'oc_send_preview_secret_fixture',
    }, null, 2), 'utf8');
    let contacted = false;

    const result = await sendOpenClawResponse({
      openclawMessageId: 'oc-msg-preview',
      channel: 'telegram',
      threadId: 'thread-preview',
      text: 'Preview reply with password=send-preview-secret',
      dryRun: true,
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:30:00.000Z'),
      createId: () => 'send-preview-1',
      transport: async () => {
        contacted = true;
        return { ok: true, status: 200 };
      },
    });

    expect(result.ok).toBe(true);
    expect(contacted).toBe(false);
    expect(result.record).toMatchObject({
      id: 'send-preview-1',
      status: 'preview',
      dryRun: true,
      textPreview: 'Preview reply with password=[redacted]',
      endpoint: 'http://127.0.0.1:4150/messages/reply',
      safety: {
        tokenPresent: true,
        tokenSent: false,
        networkContacted: false,
      },
    });
    const rawLog = await readFile(result.sendLogPath, 'utf8');
    expect(rawLog).toContain('send-preview-1');
    expect(rawLog).not.toContain('send-preview-secret');
    expect(rawLog).not.toContain('oc_send_preview_secret_fixture');
  });

  it('blocks live OpenClaw response sends without explicit confirmation', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      httpUrl: 'http://127.0.0.1:4150/',
    }, null, 2), 'utf8');

    const result = await sendOpenClawResponse({
      openclawMessageId: 'oc-msg-blocked',
      channel: 'telegram',
      threadId: 'thread-blocked',
      text: 'Blocked reply',
      approvedBy: 'Patrice',
      dryRun: false,
      liveSendConfirmed: false,
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:35:00.000Z'),
      createId: () => 'send-blocked-1',
      transport: async () => {
        throw new Error('should not contact OpenClaw without send confirmation');
      },
    });

    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('blocked');
    expect(result.error).toBe('liveSendConfirmed is required for live OpenClaw response send');
  });

  it('sends approved OpenClaw responses through an injected transport without logging secrets', async () => {
    await mkdir(openclawHome, { recursive: true });
    await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
      rpcUrl: 'http://127.0.0.1:4150/rpc/',
      token: 'oc_live_send_secret_fixture',
    }, null, 2), 'utf8');
    const seen: Array<{ url: string; authorization?: string; body: string }> = [];

    const result = await sendOpenClawResponse({
      openclawMessageId: 'oc-msg-live',
      channel: 'discord',
      threadId: 'thread-live',
      text: 'Live approved reply. secret=live-send-secret',
      approvedBy: 'Patrice',
      dryRun: false,
      liveSendConfirmed: true,
    }, {
      home: openclawHome,
      cwd: workspace,
      now: new Date('2026-06-07T12:40:00.000Z'),
      createId: () => 'send-live-1',
      transport: async (url, init) => {
        seen.push({
          url,
          authorization: init.headers.authorization,
          body: init.body,
        });
        return {
          ok: true,
          status: 200,
          json: {
            accepted: true,
            messageId: 'openclaw-sent-1',
            tokenEcho: 'oc_live_send_secret_fixture',
          },
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: 'http://127.0.0.1:4150/rpc/messages/reply',
      authorization: 'Bearer oc_live_send_secret_fixture',
    });
    expect(seen[0]?.body).toContain('Live approved reply. secret=live-send-secret');
    expect(result.record).toMatchObject({
      id: 'send-live-1',
      status: 'sent',
      approvedBy: 'Patrice',
      liveSendConfirmed: true,
      textPreview: 'Live approved reply. secret=[redacted]',
      safety: {
        tokenPresent: true,
        tokenSent: true,
        networkContacted: true,
        secretsIncluded: false,
      },
      response: {
        status: 200,
        ok: true,
        accepted: true,
        messageId: 'openclaw-sent-1',
      },
    });
    expect(JSON.stringify(result)).not.toContain('oc_live_send_secret_fixture');
    expect(JSON.stringify(result)).not.toContain('live-send-secret');
    const rawLog = await readFile(result.sendLogPath, 'utf8');
    expect(rawLog).toContain('send-live-1');
    expect(rawLog).not.toContain('oc_live_send_secret_fixture');
    expect(rawLog).not.toContain('live-send-secret');
  });

  it('validates the live OpenClaw HTTP attach and reply contract against a local daemon fixture', async () => {
    const server = await startOpenClawContractServer();
    try {
      await mkdir(openclawHome, { recursive: true });
      await writeFile(path.join(openclawHome, 'gateway.json'), JSON.stringify({
        nodeId: 'openclaw-contract-daemon',
        rpcUrl: `${server.baseUrl}/rpc/`,
        token: 'oc_contract_http_secret_fixture',
      }, null, 2), 'utf8');

      const attach = await attachOpenClawGateway({
        approvedBy: 'Patrice',
        descriptor: buildOpenClawNodeDescriptor({ nodeId: 'codebuddy-contract-node' }),
        dryRun: false,
        liveAttachConfirmed: true,
      }, {
        home: openclawHome,
        cwd: workspace,
        now: new Date('2026-06-07T12:45:00.000Z'),
        createId: () => 'attach-contract-1',
      });
      expect(attach.ok).toBe(true);
      expect(attach.record).toMatchObject({
        id: 'attach-contract-1',
        status: 'attached',
        response: {
          status: 200,
          ok: true,
          accepted: true,
          nodeId: 'codebuddy-contract-node',
        },
        safety: {
          tokenSent: true,
          networkContacted: true,
          secretsIncluded: false,
        },
      });

      const send = await sendOpenClawResponse({
        approvedBy: 'Patrice',
        channel: 'telegram',
        dryRun: false,
        liveSendConfirmed: true,
        openclawMessageId: 'oc-contract-msg-1',
        text: 'Contract reply. password=contract-send-secret',
        threadId: 'thread-contract',
      }, {
        home: openclawHome,
        cwd: workspace,
        now: new Date('2026-06-07T12:50:00.000Z'),
        createId: () => 'send-contract-1',
      });

      expect(send.ok).toBe(true);
      expect(send.record).toMatchObject({
        id: 'send-contract-1',
        status: 'sent',
        response: {
          status: 200,
          ok: true,
          accepted: true,
          messageId: 'openclaw-contract-reply-1',
        },
        textPreview: 'Contract reply. password=[redacted]',
        safety: {
          tokenSent: true,
          networkContacted: true,
          secretsIncluded: false,
        },
      });

      expect(server.requests).toHaveLength(2);
      expect(server.requests[0]).toMatchObject({
        path: '/rpc/nodes/register',
        authorization: 'Bearer oc_contract_http_secret_fixture',
      });
      expect(server.requests[1]).toMatchObject({
        path: '/rpc/messages/reply',
        authorization: 'Bearer oc_contract_http_secret_fixture',
      });
      expect(JSON.stringify(server.requests[0]?.body)).toContain('codebuddy-contract-node');
      expect(JSON.stringify(server.requests[1]?.body)).toContain('Contract reply. password=contract-send-secret');
      expect(JSON.stringify(attach)).not.toContain('oc_contract_http_secret_fixture');
      expect(JSON.stringify(send)).not.toContain('contract-send-secret');
      const rawAttachLog = await readFile(attach.attachLogPath, 'utf8');
      const rawSendLog = await readFile(send.sendLogPath, 'utf8');
      expect(rawAttachLog).not.toContain('oc_contract_http_secret_fixture');
      expect(rawSendLog).not.toContain('oc_contract_http_secret_fixture');
      expect(rawSendLog).not.toContain('contract-send-secret');
    } finally {
      await server.close();
    }
  });
});
