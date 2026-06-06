import { mkdtemp, readFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  formatCompanionGatewayMessageResult,
  formatCompanionGatewayProfile,
  getCompanionGatewayProfilePath,
  readCompanionGatewayProfile,
  recordCompanionGatewayMessage,
  updateCompanionGatewayChannel,
} from '../src/companion/gateway.js';
import {
  draftCompanionGatewayInboxItem,
  readCompanionGatewayInbox,
} from '../src/companion/gateway-inbox.js';
import { readRecentCompanionPercepts } from '../src/companion/percepts.js';
import { readRecentCompanionSafetyEvents } from '../src/companion/safety-ledger.js';

describe('companion gateway', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-gateway-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads a disabled default profile for common channels', async () => {
    const profile = await readCompanionGatewayProfile({
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(profile.storePath).toBe(getCompanionGatewayProfilePath(tempDir));
    expect(profile.channels.find(channel => channel.channel === 'telegram')).toMatchObject({
      enabled: false,
      mode: 'observe',
      allowOutbound: false,
      requireApprovalForTools: true,
    });
    expect(formatCompanionGatewayProfile(profile)).toContain('Buddy Companion Gateway Profile');
  });

  it('enables a channel and records inbound messages as percepts plus safety events', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'assist',
      allowOutbound: false,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    const result = await recordCompanionGatewayMessage({
      channel: 'telegram',
      senderId: 'patrice',
      senderName: 'Patrice',
      threadId: 'dm-1',
      messageId: 'm-1',
      text: 'Buddy, prepare a voice check-in.',
      contentType: 'text',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:01:00.000Z'),
    });

    expect(result.accepted).toBe(true);
    expect(result.sessionKey).toBe('companion:telegram:dm-1');
    expect(result.percept?.source).toBe('companion_gateway:telegram');
    expect(result.inboxItem).toMatchObject({
      channel: 'telegram',
      priority: 'normal',
      status: 'queued',
      proposedAction: {
        canAutoDispatch: false,
        requiresLocalApproval: true,
        type: 'draft_reply',
      },
      safety: {
        rawTextStored: false,
        secretRedaction: 'preview_only',
      },
    });
    expect(formatCompanionGatewayMessageResult(result)).toContain('message accepted');
    expect(formatCompanionGatewayMessageResult(result)).toContain('Inbox item:');

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir, modality: 'hearing' });
    expect(percepts[0]).toMatchObject({
      source: 'companion_gateway:telegram',
      tags: expect.arrayContaining(['gateway', 'telegram', 'assist', 'text']),
    });

    const safety = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'data' });
    expect(safety[0]).toMatchObject({
      action: 'companion_gateway_ingest',
      status: 'completed',
      source: 'companion_gateway',
    });

    const inbox = await readCompanionGatewayInbox({ cwd: tempDir });
    expect(inbox).toMatchObject({
      kind: 'companion_gateway_inbox',
      counts: {
        queued: 1,
        ignored: 0,
        total: 1,
      },
      safety: {
        autoDispatch: false,
        rawTextStored: false,
      },
    });
    expect(inbox.items[0]?.content.preview).toBe('Buddy, prepare a voice check-in.');
  });

  it('denies disabled channels while still recording an audit event', async () => {
    const result = await recordCompanionGatewayMessage({
      channel: 'discord',
      senderId: 'user-1',
      text: 'hello',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:02:00.000Z'),
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('disabled');
    expect(result.percept).toBeUndefined();
    expect(result.inboxItem).toMatchObject({
      channel: 'discord',
      status: 'ignored',
      proposedAction: {
        canAutoDispatch: false,
        type: 'observe',
      },
    });

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(percepts).toEqual([]);

    const safety = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'data' });
    expect(safety[0]).toMatchObject({
      action: 'companion_gateway_ingest_denied',
      status: 'denied',
    });

    const inbox = await readCompanionGatewayInbox({ cwd: tempDir });
    expect(inbox.counts).toMatchObject({
      ignored: 1,
      queued: 0,
      total: 1,
    });
  });

  it('queues urgent cross-channel requests for local approval without storing raw text', async () => {
    await updateCompanionGatewayChannel('slack', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T11:00:00.000Z'),
    });

    const result = await recordCompanionGatewayMessage({
      channel: 'slack',
      senderId: 'ops-user',
      senderName: 'Ops',
      threadId: 'incident-1',
      messageId: 'm-urgent',
      text: `URGENT production down. Token-like text sk-fixture-redaction-token should remain preview-only. ${'details '.repeat(80)}`,
      contentType: 'text',
      attachmentCount: 1,
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T11:01:00.000Z'),
    });

    expect(result.accepted).toBe(true);
    expect(result.inboxItem).toMatchObject({
      priority: 'urgent',
      status: 'queued',
      proposedAction: {
        canAutoDispatch: false,
        requiresLocalApproval: true,
        type: 'request_local_approval',
      },
      safety: {
        outboundDisabled: true,
        localApprovalRequired: true,
        rawTextStored: false,
      },
    });

    const inbox = await readCompanionGatewayInbox({ cwd: tempDir });
    expect(inbox.counts).toMatchObject({
      highPriority: 1,
      queued: 1,
      total: 1,
    });
    expect(inbox.items[0]?.content.preview).toContain('[truncated]');
    expect(inbox.items[0]?.content.preview.length).toBeLessThanOrEqual(220);
    expect(inbox.items[0]?.content.preview).toContain('[redacted-token]');
    expect(JSON.stringify(inbox)).not.toContain('sk-fixture-redaction-token');
  });

  it('drafts queued gateway inbox items into autonomous-code tasks without dispatching', async () => {
    await updateCompanionGatewayChannel('slack', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T12:00:00.000Z'),
    });

    const result = await recordCompanionGatewayMessage({
      channel: 'slack',
      senderId: 'ops-user',
      senderName: 'Ops',
      threadId: 'incident-2',
      messageId: 'm-draft',
      text: 'Please investigate failing tests today. password=super-secret-fixture',
      contentType: 'text',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T12:01:00.000Z'),
    });

    const draft = await draftCompanionGatewayInboxItem(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T12:02:00.000Z'),
    });

    expect(draft).toMatchObject({
      sourceItemId: result.inboxItem!.id,
      kind: 'autonomous_code_task',
      autoDispatch: false,
      requiresLocalApproval: true,
      safety: {
        rawTextStored: false,
        previewOnly: true,
        autoDispatch: false,
      },
    });
    expect(draft.command).toEqual([
      'buddy',
      'autonomous-code',
      '--task-file',
      draft.taskFile,
      '--require-approval',
      '--json',
    ]);
    expect(draft.task).toMatchObject({
      repo: tempDir,
      allowedPaths: ['docs/...'],
      verification: ['npm run typecheck'],
      riskLevel: 'low',
      fleetPolicy: 'none',
    });
    expect(draft.task.task).toContain('[redacted]');
    expect(JSON.stringify(draft)).not.toContain('super-secret-fixture');

    const taskFile = JSON.parse(await readFile(draft.taskFile, 'utf8')) as { task: string; repo: string };
    expect(taskFile.repo).toBe(tempDir);
    expect(taskFile.task).toContain('[redacted]');
    expect(taskFile.task).not.toContain('super-secret-fixture');

    const inbox = await readCompanionGatewayInbox({ cwd: tempDir });
    expect(inbox.counts).toMatchObject({
      queued: 0,
      ignored: 0,
      total: 1,
    });
    expect(inbox.items[0]).toMatchObject({
      id: result.inboxItem!.id,
      status: 'drafted',
      draft: {
        id: draft.id,
        taskFile: draft.taskFile,
        autoDispatch: false,
      },
    });
  });
});
