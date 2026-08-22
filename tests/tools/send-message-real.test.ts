import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { readSendMessageOutbox } from '../../src/channels/send-message.js';
import { createSendMessageTools } from '../../src/tools/registry/send-message-tools.js';

let tempWorkspace: string;
let originalCwd: string;
let idCounter: number;

function fixedNow(): Date {
  return new Date('2026-05-30T13:00:00.000Z');
}

function nextId(): string {
  idCounter += 1;
  return `msg-test-${idCounter}`;
}

function parseToolOutput(result: { success: boolean; output?: string; error?: string }): Record<string, unknown> {
  expect(result.output).toBeTruthy();
  return JSON.parse(result.output as string) as Record<string, unknown>;
}

describe('send_message real outbox integration', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-send-message-real-'));
    idCounter = 0;
    process.chdir(tempWorkspace);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('previews outbound messages by default and writes a real outbox record', async () => {
    const [tool] = createSendMessageTools({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: nextId,
    });

    const result = await tool!.execute({
      channel: 'telegram',
      channel_id: 'chat-123',
      content: 'Real dry-run preview',
      parse_mode: 'markdown',
      thread_id: 'thread-a',
    });
    expect(result.success, result.error).toBe(true);

    const payload = parseToolOutput(result);
    expect(payload).toMatchObject({
      kind: 'send_message_result',
      ok: true,
      action: 'send_message',
      status: 'preview',
      dryRun: true,
      outboxPath: path.join(tempWorkspace, '.codebuddy', 'messages', 'outbox.jsonl'),
    });

    const outbox = await readSendMessageOutbox(tempWorkspace);
    expect(outbox).toEqual([
      expect.objectContaining({
        id: 'msg-test-1',
        channel: 'telegram',
        channelId: 'chat-123',
        content: 'Real dry-run preview',
        parseMode: 'markdown',
        threadId: 'thread-a',
        status: 'preview',
        dryRun: true,
        createdAt: '2026-05-30T13:00:00.000Z',
      }),
    ]);
    await expect(fs.stat(path.join(tempWorkspace, '.codebuddy', 'messages', 'outbox.jsonl'))).resolves.toBeTruthy();
  });

  it('blocks live delivery without approval and records the blocked attempt', async () => {
    const [tool] = createSendMessageTools({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: nextId,
    });

    const result = await tool!.execute({
      channel: 'slack',
      channel_id: 'C123',
      content: 'This should not leave the machine',
      dry_run: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('approved_by is required');
    const payload = parseToolOutput(result);
    expect(payload).toMatchObject({
      ok: false,
      status: 'blocked',
      dryRun: false,
      error: 'approved_by is required when dry_run is false',
    });

    const outbox = await readSendMessageOutbox(tempWorkspace);
    expect(outbox).toEqual([
      expect.objectContaining({
        channel: 'slack',
        channelId: 'C123',
        status: 'blocked',
        dryRun: false,
        error: 'approved_by is required when dry_run is false',
      }),
    ]);
  });

  it('marks official Hermes send_message as exact local tool parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T13:00:00.000Z');
    expect(manifest.tools).toContainEqual(expect.objectContaining({
      name: 'send_message',
      status: 'exact',
      detectedCodeBuddyTools: ['send_message'],
    }));
  });
});
