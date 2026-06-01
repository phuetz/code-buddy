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
      expect(report.hermes.officialPlatformCount).toBeGreaterThan(0);
      expect(report.hermes.locallyCoveredCount).toBeGreaterThan(0);
      expect(report.hermes.configuredPlatformCount).toBeGreaterThanOrEqual(2);
      expect(report.hermes.runtimePlatformCount).toBeGreaterThanOrEqual(1);
      expect(report.hermes.missingPlatformCount).toBeGreaterThan(0);
      expect(report.hermes.platforms).toEqual(expect.arrayContaining([
        expect.objectContaining({
          channelTypes: ['telegram'],
          localSurface: 'channel',
          platform: 'Telegram',
          status: 'runtime',
        }),
        expect.objectContaining({
          channelTypes: ['discord'],
          localSurface: 'channel',
          platform: 'Discord',
          status: 'configured',
        }),
        expect.objectContaining({
          localSurface: 'prompt-tool',
          platform: 'Yuanbao',
          status: 'available',
        }),
        expect.objectContaining({
          channelTypes: ['dingtalk'],
          localSurface: 'channel',
          platform: 'DingTalk',
          status: 'available',
        }),
        expect.objectContaining({
          channelTypes: ['wecom'],
          localSurface: 'channel',
          platform: 'WeCom',
          status: 'available',
        }),
        expect.objectContaining({
          channelTypes: ['ntfy'],
          localSurface: 'channel',
          platform: 'ntfy',
          status: 'available',
        }),
      ]));
      expect(report.recommendations).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('explains missing config and empty runtime state', () => {
    const report = buildChannelStatusReport({}, path.join(os.tmpdir(), 'missing-channels.json'), '2026-05-30T10:00:01.000Z');

    expect(report.config.configuredCount).toBe(0);
    expect(report.hermes.configuredPlatformCount).toBe(0);
    expect(report.runtime.registeredCount).toBe(0);
    expect(report.recommendations).toEqual(expect.arrayContaining([
      expect.stringContaining('Create .codebuddy/channels.json'),
      expect.stringContaining('No runtime channels'),
    ]));
  });

  it('marks ntfy as configured and runtime when a real channel is present', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-status-ntfy-'));
    const configPath = path.join(tempDir, 'channels.json');
    fs.writeFileSync(configPath, JSON.stringify({
      channels: [
        {
          type: 'ntfy',
          enabled: true,
          token: 'ntfy-secret-token',
          webhookUrl: 'http://127.0.0.1:8080/tenant',
          options: { topic: 'alerts' },
        },
      ],
    }), 'utf-8');

    try {
      const report = buildChannelStatusReport({
        ntfy: {
          type: 'ntfy',
          connected: true,
          authenticated: true,
          lastActivity: new Date('2026-05-30T11:00:00.000Z'),
          info: { serverUrl: 'http://127.0.0.1:8080/tenant', topic: 'alerts' },
        },
      } as Record<string, ChannelStatus>, configPath, '2026-05-30T11:00:01.000Z');

      const ntfy = report.hermes.platforms.find((platform) => platform.platform === 'ntfy');
      expect(ntfy).toEqual(expect.objectContaining({
        channelTypes: ['ntfy'],
        configured: true,
        localSurface: 'channel',
        runtimeRegistered: true,
        status: 'runtime',
      }));
      expect(report.config.channels[0]).toEqual(expect.objectContaining({
        hasToken: true,
        hasWebhookUrl: true,
        optionKeys: ['topic'],
        type: 'ntfy',
      }));
      expect(JSON.stringify(report)).not.toContain('ntfy-secret-token');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('marks DingTalk as configured without exposing webhook secrets', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-status-dingtalk-'));
    const configPath = path.join(tempDir, 'channels.json');
    fs.writeFileSync(configPath, JSON.stringify({
      channels: [
        {
          type: 'dingtalk',
          enabled: true,
          token: 'dingtalk-token',
          webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=dingtalk-token',
          options: { secret: 'SEC-test', msgType: 'markdown' },
        },
      ],
    }), 'utf-8');

    try {
      const report = buildChannelStatusReport({}, configPath, '2026-05-30T12:00:01.000Z');
      const dingtalk = report.hermes.platforms.find((platform) => platform.platform === 'DingTalk');
      expect(dingtalk).toEqual(expect.objectContaining({
        channelTypes: ['dingtalk'],
        configured: true,
        localSurface: 'channel',
        runtimeRegistered: false,
        status: 'configured',
      }));
      expect(report.config.channels[0]).toEqual(expect.objectContaining({
        hasToken: true,
        hasWebhookUrl: true,
        optionKeys: ['msgType', 'secret'],
        type: 'dingtalk',
      }));
      expect(JSON.stringify(report)).not.toContain('dingtalk-token');
      expect(JSON.stringify(report)).not.toContain('SEC-test');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('marks WeCom as configured without exposing webhook keys', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-status-wecom-'));
    const configPath = path.join(tempDir, 'channels.json');
    fs.writeFileSync(configPath, JSON.stringify({
      channels: [
        {
          type: 'wecom',
          enabled: true,
          token: 'wecom-key',
          webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-key',
          options: { msgType: 'markdown', mentionedList: ['@all'] },
        },
      ],
    }), 'utf-8');

    try {
      const report = buildChannelStatusReport({}, configPath, '2026-05-30T12:30:01.000Z');
      const wecom = report.hermes.platforms.find((platform) => platform.platform === 'WeCom');
      expect(wecom).toEqual(expect.objectContaining({
        channelTypes: ['wecom'],
        configured: true,
        localSurface: 'channel',
        runtimeRegistered: false,
        status: 'configured',
      }));
      expect(report.config.channels[0]).toEqual(expect.objectContaining({
        hasToken: true,
        hasWebhookUrl: true,
        optionKeys: ['mentionedList', 'msgType'],
        type: 'wecom',
      }));
      expect(JSON.stringify(report)).not.toContain('wecom-key');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
