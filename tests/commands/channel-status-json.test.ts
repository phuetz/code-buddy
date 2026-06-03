import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildChannelStatusReport } from '../../src/commands/handlers/channel-handlers.js';
import type { ChannelStatus } from '../../src/channels/index.js';

describe('buildChannelStatusReport', () => {
  it('summarizes runtime and configured channels without exposing secrets', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-status-json-'));
    const configPath = path.join(tempDir, 'channels.json');
    fs.writeFileSync(configPath, JSON.stringify({
      channels: [
        {
          type: 'telegram',
          enabled: true,
          token: 'secret-token',
          allowedUsers: ['patrice'],
          options: { parseMode: 'markdown' },
        },
        {
          type: 'discord',
          enabled: false,
          webhookUrl: 'https://example.invalid/webhook',
        },
      ],
    }), 'utf-8');

    try {
      const report = buildChannelStatusReport({
        telegram: {
          type: 'telegram',
          connected: true,
          authenticated: true,
          lastActivity: new Date('2026-05-30T10:00:00.000Z'),
        },
      } as Record<string, ChannelStatus>, configPath, '2026-05-30T10:00:01.000Z');

      expect(report.kind).toBe('codebuddy_channel_status');
      expect(report.schemaVersion).toBe(1);
      expect(report.generatedAt).toBe('2026-05-30T10:00:01.000Z');
      expect(report.config.path).toBe(configPath);
      expect(report.config.configuredCount).toBe(2);
      expect(report.config.enabledCount).toBe(1);
      expect(report.config.disabledCount).toBe(1);
      expect(report.config.channels).toEqual([
        expect.objectContaining({
          type: 'telegram',
          enabled: true,
          hasToken: true,
          hasWebhookUrl: false,
          allowedUsersCount: 1,
          optionKeys: ['parseMode'],
        }),
        expect.objectContaining({
          type: 'discord',
          enabled: false,
          hasToken: false,
          hasWebhookUrl: true,
        }),
      ]);
      expect(JSON.stringify(report)).not.toContain('secret-token');
      expect(report.runtime.registeredCount).toBe(1);
      expect(report.runtime.connectedCount).toBe(1);
      expect(report.runtime.authenticatedCount).toBe(1);
      expect(report.runtime.channels[0]).toEqual(expect.objectContaining({
        type: 'telegram',
        connected: true,
        authenticated: true,
        lastActivity: '2026-05-30T10:00:00.000Z',
      }));
      expect(report.operatorCommands).toEqual([
        expect.objectContaining({
          id: 'messaging-status',
          command: expect.stringContaining('buddy hermes messaging status --json'),
        }),
        expect.objectContaining({
          id: 'messaging-start',
          command: expect.stringContaining('buddy hermes messaging start --json'),
        }),
        expect.objectContaining({
          id: 'messaging-stop',
          command: 'buddy hermes messaging stop --json',
        }),
      ]);
      expect(JSON.stringify(report.operatorCommands)).not.toContain('secret-token');
      expect(JSON.stringify(report.operatorCommands)).not.toContain('example.invalid/webhook');
      expect(report.recommendations).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('explains missing config and empty runtime state', () => {
    const report = buildChannelStatusReport({}, path.join(os.tmpdir(), 'missing-channels.json'), '2026-05-30T10:00:01.000Z');

    expect(report.config.configuredCount).toBe(0);
    expect(report.runtime.registeredCount).toBe(0);
    expect(report.recommendations).toEqual(expect.arrayContaining([
      expect.stringContaining('Create .codebuddy/channels.json'),
      expect.stringContaining('No runtime channels'),
    ]));
    expect(report.operatorCommands).toEqual([
      expect.objectContaining({
        id: 'messaging-status',
        command: expect.stringContaining('buddy hermes messaging status --json'),
      }),
    ]);
  });
});
