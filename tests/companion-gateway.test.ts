import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ChannelManager, MockChannel } from '../src/channels/core.js';
import { readSendMessageOutbox } from '../src/channels/send-message.js';
import {
  buildCompanionGatewayAdminPlan,
  buildCompanionGatewayLifecycleReport,
  executeCompanionGatewayAdminAction,
  formatCompanionGatewayMessageResult,
  formatCompanionGatewayProfile,
  getCompanionGatewayProfilePath,
  readCompanionGatewayProfile,
  recordCompanionGatewayMessage,
  updateCompanionGatewayChannel,
} from '../src/companion/gateway.js';
import {
  draftCompanionGatewayOutboundReply,
  draftCompanionGatewayInboxItem,
  getCompanionGatewayInboxPath,
  readCompanionGatewayInbox,
  recordCompanionGatewayInboxItem,
  routeCompanionGatewayDraftToFleet,
  sendCompanionGatewayOutboundReply,
} from '../src/companion/gateway-inbox.js';
import { readRecentCompanionPercepts } from '../src/companion/percepts.js';
import { readRecentCompanionSafetyEvents } from '../src/companion/safety-ledger.js';

describe('companion gateway', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-gateway-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

  it('routes a prepared gateway draft into a safe Fleet dispatch draft without running it', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T13:00:00.000Z'),
    });

    const result = await recordCompanionGatewayMessage({
      channel: 'telegram',
      senderId: 'lead',
      senderName: 'Lead',
      threadId: 'dm-fleet',
      messageId: 'm-fleet',
      text: 'Please prepare a safe fleet review today. access_token=secret-fleet-fixture',
      contentType: 'text',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T13:01:00.000Z'),
    });
    await draftCompanionGatewayInboxItem(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T13:02:00.000Z'),
    });

    const fleetDraft = await routeCompanionGatewayDraftToFleet(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T13:03:00.000Z'),
    });

    expect(fleetDraft).toMatchObject({
      kind: 'fleet_dispatch_draft',
      autoDispatch: false,
      requiresLocalApproval: true,
      dispatchInput: {
        parallelism: 1,
        privacyTag: 'sensitive',
        dispatchProfile: 'safe',
        deliveryChannel: 'companion-gateway:telegram',
      },
      safety: {
        rawTextStored: false,
        previewOnly: true,
        autoDispatch: false,
        outboundChannelReply: false,
      },
    });
    expect(fleetDraft.dispatchInput.goal).toContain('[redacted]');
    expect(JSON.stringify(fleetDraft)).not.toContain('secret-fleet-fixture');

    const fleetFile = JSON.parse(await readFile(fleetDraft.draftFile, 'utf8')) as {
      dispatchInput: { goal: string; dispatchProfile: string; privacyTag: string };
      safety: { autoDispatch: boolean };
    };
    expect(fleetFile.dispatchInput.dispatchProfile).toBe('safe');
    expect(fleetFile.dispatchInput.privacyTag).toBe('sensitive');
    expect(fleetFile.dispatchInput.goal).not.toContain('secret-fleet-fixture');
    expect(fleetFile.safety.autoDispatch).toBe(false);

    const inbox = await readCompanionGatewayInbox({ cwd: tempDir });
    expect(inbox.items[0]?.draft?.fleet).toMatchObject({
      id: fleetDraft.id,
      draftFile: fleetDraft.draftFile,
      autoDispatch: false,
    });
  });

  it('drafts an approved outbound reply after Fleet review without storing raw content or sending', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T14:00:00.000Z'),
    });

    const result = await recordCompanionGatewayMessage({
      channel: 'telegram',
      senderId: 'lead',
      senderName: 'Lead',
      threadId: 'dm-reply',
      messageId: 'm-reply',
      text: 'Please prepare a reviewed outbound reply.',
      contentType: 'text',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T14:01:00.000Z'),
    });
    await draftCompanionGatewayInboxItem(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T14:02:00.000Z'),
    });
    await routeCompanionGatewayDraftToFleet(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T14:03:00.000Z'),
    });

    const replyDraft = await draftCompanionGatewayOutboundReply(result.inboxItem!.id, {
      text: 'Approved response for the sender. access_token=reply-secret-fixture',
      reviewedBy: 'Patrice',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T14:04:00.000Z'),
    });

    expect(replyDraft).toMatchObject({
      kind: 'outbound_reply_draft',
      sourceItemId: result.inboxItem!.id,
      channel: 'telegram',
      channelId: 'dm-reply',
      threadId: 'dm-reply',
      replyTo: 'm-reply',
      reviewedBy: 'Patrice',
      autoDispatch: false,
      requiresLocalApproval: true,
      readyToSend: false,
      sendPreview: {
        channel: 'telegram',
        channelId: 'dm-reply',
        threadId: 'dm-reply',
        replyTo: 'm-reply',
        sessionKey: 'companion:telegram:dm-reply',
        dryRun: true,
      },
      safety: {
        rawTextStored: false,
        previewOnly: true,
        autoDispatch: false,
        outboundChannelReply: false,
      },
    });
    expect(replyDraft.contentPreview).toContain('access_token=[redacted]');
    expect(JSON.stringify(replyDraft)).not.toContain('reply-secret-fixture');

    const replyFile = JSON.parse(await readFile(replyDraft.draftFile, 'utf8')) as {
      contentPreview: string;
      safety: { rawTextStored: boolean; outboundChannelReply: boolean };
    };
    expect(replyFile.contentPreview).toContain('access_token=[redacted]');
    expect(JSON.stringify(replyFile)).not.toContain('reply-secret-fixture');
    expect(replyFile.safety.rawTextStored).toBe(false);
    expect(replyFile.safety.outboundChannelReply).toBe(false);

    const inbox = await readCompanionGatewayInbox({ cwd: tempDir });
    expect(inbox.items[0]?.draft?.fleet?.outboundReply).toMatchObject({
      id: replyDraft.id,
      draftFile: replyDraft.draftFile,
      reviewedBy: 'Patrice',
      autoDispatch: false,
      readyToSend: false,
    });
  });

  it('sends a reviewed outbound reply through the send outbox only with explicit approval', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T15:00:00.000Z'),
    });

    const result = await recordCompanionGatewayMessage({
      channel: 'telegram',
      senderId: 'lead',
      senderName: 'Lead',
      threadId: 'dm-send',
      messageId: 'm-send',
      text: 'Please prepare and send a reviewed reply.',
      contentType: 'text',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T15:01:00.000Z'),
    });
    await draftCompanionGatewayInboxItem(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T15:02:00.000Z'),
    });
    await routeCompanionGatewayDraftToFleet(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T15:03:00.000Z'),
    });
    await draftCompanionGatewayOutboundReply(result.inboxItem!.id, {
      text: 'Approved preview for the sender.',
      reviewedBy: 'Patrice',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T15:04:00.000Z'),
    });

    await expect(sendCompanionGatewayOutboundReply(result.inboxItem!.id, {
      text: 'Final approved response.',
      approvedBy: 'Patrice',
      dryRun: false,
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T15:05:00.000Z'),
    })).rejects.toThrow(/liveDeliveryConfirmed is required/);

    const sendResult = await sendCompanionGatewayOutboundReply(result.inboxItem!.id, {
      text: 'Final approved response.',
      approvedBy: 'Patrice',
      dryRun: true,
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T15:06:00.000Z'),
      sendMessage: {
        createId: () => 'outbox-gateway-reply-1',
      },
    });

    expect(sendResult).toMatchObject({
      kind: 'companion_gateway_outbound_reply_send_result',
      sourceItemId: result.inboxItem!.id,
      approvedBy: 'Patrice',
      dryRun: true,
      send: {
        ok: true,
        status: 'preview',
        dryRun: true,
        entry: {
          id: 'outbox-gateway-reply-1',
          channel: 'telegram',
          channelId: 'dm-send',
          threadId: 'dm-send',
          replyTo: 'm-send',
          approvedBy: 'Patrice',
          content: 'Final approved response.',
        },
      },
    });

    const outbox = await readSendMessageOutbox(tempDir);
    expect(outbox).toEqual([
      expect.objectContaining({
        id: 'outbox-gateway-reply-1',
        channel: 'telegram',
        channelId: 'dm-send',
        status: 'preview',
        dryRun: true,
        approvedBy: 'Patrice',
        content: 'Final approved response.',
      }),
    ]);

    const inbox = await readCompanionGatewayInbox({ cwd: tempDir });
    expect(inbox.items[0]?.draft?.fleet?.outboundReply?.lastSend).toMatchObject({
      id: 'outbox-gateway-reply-1',
      kind: 'outbound_reply_send',
      status: 'preview',
      dryRun: true,
      approvedBy: 'Patrice',
      autoDispatch: false,
      requiresLocalApproval: true,
    });
  });

  it('builds a secret-safe lifecycle report across profile inbox drafts and outbox', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T16:00:00.000Z'),
    });

    const result = await recordCompanionGatewayMessage({
      channel: 'telegram',
      senderId: 'lead',
      senderName: 'Lead',
      threadId: 'dm-lifecycle',
      messageId: 'm-lifecycle',
      text: 'Please prepare lifecycle diagnostics. password=profile-secret-fixture',
      contentType: 'text',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T16:01:00.000Z'),
    });
    await draftCompanionGatewayInboxItem(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T16:02:00.000Z'),
    });
    await routeCompanionGatewayDraftToFleet(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T16:03:00.000Z'),
    });
    await draftCompanionGatewayOutboundReply(result.inboxItem!.id, {
      text: 'Reviewed reply. secret=reply-secret-fixture',
      reviewedBy: 'Patrice',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T16:04:00.000Z'),
    });
    await sendCompanionGatewayOutboundReply(result.inboxItem!.id, {
      text: 'Final approved lifecycle reply.',
      approvedBy: 'Patrice',
      dryRun: true,
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T16:05:00.000Z'),
      sendMessage: {
        createId: () => 'outbox-lifecycle-1',
      },
    });

    const report = await buildCompanionGatewayLifecycleReport({
      cwd: tempDir,
      now: new Date('2026-05-24T16:06:00.000Z'),
    });

    expect(report).toMatchObject({
      kind: 'companion_gateway_lifecycle',
      schemaVersion: 1,
      cwd: tempDir,
      summary: {
        enabledCount: 1,
        queuedCount: 0,
        ignoredCount: 0,
        draftCount: 1,
        fleetDraftCount: 1,
        replyDraftCount: 1,
        outboundSendCount: 1,
        failedSendCount: 0,
        blockedSendCount: 0,
        readyChannelCount: 1,
        attentionChannelCount: 0,
      },
      safety: {
        autoDispatch: false,
        rawTextStored: false,
        localApprovalRequired: true,
        sendPolicyRequired: true,
      },
    });
    expect(report.channels.find(channel => channel.channel === 'telegram')).toMatchObject({
      state: 'ready',
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      queueCount: 0,
      draftCount: 1,
      fleetDraftCount: 1,
      replyDraftCount: 1,
      lastSendStatus: 'preview',
      issues: [],
    });
    expect(JSON.stringify(report)).not.toContain('profile-secret-fixture');
    expect(JSON.stringify(report)).not.toContain('reply-secret-fixture');
    expect(JSON.stringify(report)).not.toContain('Final approved lifecycle reply');
  });

  it('builds a secret-safe admin plan with replayable delivery diagnostics', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T17:00:00.000Z'),
    });
    const result = await recordCompanionGatewayMessage({
      channel: 'telegram',
      senderId: 'user-admin',
      senderName: 'Admin',
      threadId: 'dm-admin',
      messageId: 'm-admin',
      text: 'Please prepare admin diagnostics. token=admin-secret-fixture',
      contentType: 'text',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T17:01:00.000Z'),
    });
    await draftCompanionGatewayInboxItem(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T17:02:00.000Z'),
    });
    await routeCompanionGatewayDraftToFleet(result.inboxItem!.id, {
      cwd: tempDir,
      now: new Date('2026-05-24T17:02:30.000Z'),
    });
    await draftCompanionGatewayOutboundReply(result.inboxItem!.id, {
      text: 'Reviewed admin reply. secret=admin-reply-secret',
      reviewedBy: 'Patrice',
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T17:03:00.000Z'),
    });
    await sendCompanionGatewayOutboundReply(result.inboxItem!.id, {
      text: 'Final approved admin reply.',
      approvedBy: 'Patrice',
      dryRun: true,
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T17:04:00.000Z'),
      sendMessage: {
        createId: () => 'outbox-admin-1',
      },
    });

    const plan = await buildCompanionGatewayAdminPlan({
      cwd: tempDir,
      channel: 'telegram',
      now: new Date('2026-05-24T17:05:00.000Z'),
    });

    expect(plan).toMatchObject({
      kind: 'companion_gateway_admin_plan',
      schemaVersion: 1,
      cwd: tempDir,
      safety: {
        dryRun: true,
        requiresLocalApproval: true,
        secretsIncluded: false,
        rawMessageContentIncluded: false,
        executesChannelAdmin: false,
      },
      summary: {
        channelCount: 1,
        enabledCount: 1,
        replayablePreviewCount: 1,
        failedSendCount: 0,
        blockedSendCount: 0,
      },
      deliveryDiagnostics: {
        counts: {
          preview: 1,
          sent: 0,
          failed: 0,
          blocked: 0,
        },
        replayablePreviews: [
          {
            id: 'outbox-admin-1',
            channel: 'telegram',
            status: 'preview',
            dryRun: true,
            approved: true,
            hasError: false,
          },
        ],
      },
    });
    expect(plan.actions.map(action => action.action)).toEqual(expect.arrayContaining([
      'start',
      'reconnect',
      'stop',
      'send_reply',
      'inspect_outbox',
      'replay_preview',
    ]));
    expect(plan.actions.find(action => action.action === 'reconnect')?.command).toEqual([
      'buddy',
      'channels',
      'stop',
      '--type',
      'telegram',
      '&&',
      'buddy',
      'channels',
      'start',
      '--type',
      'telegram',
    ]);
    expect(JSON.stringify(plan)).not.toContain('admin-secret-fixture');
    expect(JSON.stringify(plan)).not.toContain('admin-reply-secret');
    expect(JSON.stringify(plan)).not.toContain('Final approved admin reply');
  });

  it('blocks gateway admin execution without explicit live confirmation', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T18:00:00.000Z'),
    });
    const manager = new ChannelManager();

    const result = await executeCompanionGatewayAdminAction({
      action: 'start',
      channel: 'telegram',
      approvedBy: 'Patrice',
      liveAdminConfirmed: false,
    }, {
      cwd: tempDir,
      channelManager: manager,
      createId: () => 'admin-exec-blocked-1',
      now: new Date('2026-05-24T18:01:00.000Z'),
      startConfiguredChannels: async () => {
        throw new Error('should not start without live confirmation');
      },
    });

    expect(result.ok).toBe(false);
    expect(result.record).toMatchObject({
      id: 'admin-exec-blocked-1',
      status: 'blocked',
      action: 'start',
      channel: 'telegram',
      approvedBy: 'Patrice',
      liveAdminConfirmed: false,
      result: {
        error: 'live_admin_confirmed is required for companion gateway admin execution',
      },
    });
    const rawLog = await readFile(result.adminLogPath, 'utf8');
    expect(rawLog).toContain('admin-exec-blocked-1');
    expect(rawLog).not.toContain('BOT_TOKEN');
  });

  it('executes and logs a confirmed gateway admin stop action', async () => {
    await updateCompanionGatewayChannel('telegram', {
      cwd: tempDir,
      enabled: true,
      mode: 'act',
      allowOutbound: true,
      now: new Date('2026-05-24T18:10:00.000Z'),
    });
    const manager = new ChannelManager();
    const channel = new MockChannel({ type: 'telegram', enabled: true });
    manager.registerChannel(channel);
    await channel.connect();

    const result = await executeCompanionGatewayAdminAction({
      action: 'stop',
      channel: 'telegram',
      approvedBy: 'Patrice',
      liveAdminConfirmed: true,
    }, {
      cwd: tempDir,
      channelManager: manager,
      createId: () => 'admin-exec-stop-1',
      now: new Date('2026-05-24T18:11:00.000Z'),
    });

    expect(result.ok).toBe(true);
    expect(manager.getChannel('telegram')).toBeUndefined();
    expect(result.record).toMatchObject({
      id: 'admin-exec-stop-1',
      status: 'completed',
      action: 'stop',
      channel: 'telegram',
      approvedBy: 'Patrice',
      liveAdminConfirmed: true,
      result: {
        stopped: true,
        runtimeBefore: {
          registered: true,
          connected: true,
          authenticated: true,
        },
        runtimeAfter: {
          registered: false,
        },
      },
    });
    const rawLog = await readFile(result.adminLogPath, 'utf8');
    expect(rawLog).toContain('admin-exec-stop-1');
    expect(rawLog).not.toContain('Final approved admin reply');
  });

  it('does not treat a corrupt gateway profile as empty defaults (D4)', async () => {
    const profilePath = getCompanionGatewayProfilePath(tempDir);
    await mkdir(path.dirname(profilePath), { recursive: true });
    await writeFile(profilePath, '{this is not json', 'utf8');

    await expect(readCompanionGatewayProfile({ cwd: tempDir })).rejects.toThrow();
    await expect(
      updateCompanionGatewayChannel('slack', { cwd: tempDir, enabled: true }),
    ).rejects.toThrow();
    expect(await readFile(profilePath, 'utf8')).toBe('{this is not json');
  });

  it('does not treat a corrupt gateway inbox as empty (D5)', async () => {
    const inboxPath = getCompanionGatewayInboxPath(tempDir);
    await mkdir(path.dirname(inboxPath), { recursive: true });
    await writeFile(inboxPath, '{this is not json', 'utf8');

    await expect(readCompanionGatewayInbox({ cwd: tempDir })).rejects.toThrow();
    await expect(
      recordCompanionGatewayInboxItem({
        accepted: true,
        channel: 'slack',
        mode: 'assist',
        text: 'hello',
        senderId: 'u1',
        sessionKey: 'companion:slack:u1',
      }, { cwd: tempDir }),
    ).rejects.toThrow();
    expect(await readFile(inboxPath, 'utf8')).toBe('{this is not json');
  });
});
