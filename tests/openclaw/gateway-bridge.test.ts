import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  attachOpenClawGateway,
  buildOpenClawNodeDescriptor,
  buildOpenClawResponsePreview,
  discoverOpenClawGateway,
  mapOpenClawChannelToCodeBuddy,
  prepareOpenClawFleetHandoffDraft,
} from '../../src/openclaw/gateway-bridge.js';

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
});
