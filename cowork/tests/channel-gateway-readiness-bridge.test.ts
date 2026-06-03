import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getChannelGatewayStatusForReview } from '../src/main/tools/channel-gateway-readiness-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltCore =
  fs.existsSync(path.join(distRoot, 'channels', 'core.js')) &&
  fs.existsSync(path.join(distRoot, 'commands', 'handlers', 'channel-handlers.js'));

describe.skipIf(!hasBuiltCore)('channel gateway readiness bridge real core integration', () => {
  const originalEnginePath = process.env.CODEBUDDY_ENGINE_PATH;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-channel-gateway-'));
    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
    if (originalEnginePath === undefined) delete process.env.CODEBUDDY_ENGINE_PATH;
    else process.env.CODEBUDDY_ENGINE_PATH = originalEnginePath;
  });

  it('loads the real CLI channel report shape without leaking config secrets', async () => {
    const configPath = path.join(tempDir, 'channels.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        channels: [
          {
            allowedUsers: ['patrice'],
            enabled: true,
            options: { parseMode: 'markdown' },
            token: 'secret-telegram-token',
            type: 'telegram',
          },
          {
            enabled: false,
            webhookUrl: 'https://example.invalid/secret-webhook',
            type: 'discord',
          },
        ],
      }),
      'utf8',
    );

    const payload = await getChannelGatewayStatusForReview(configPath);

    expect(payload.ok).toBe(true);
    expect(payload.report).toMatchObject({
      config: {
        configuredCount: 2,
        disabledCount: 1,
        enabledCount: 1,
        path: configPath,
      },
      kind: 'codebuddy_channel_status',
      schemaVersion: 1,
    });
    expect(payload.report?.config.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          allowedUsersCount: 1,
          enabled: true,
          hasToken: true,
          optionKeys: ['parseMode'],
          type: 'telegram',
        }),
        expect.objectContaining({
          enabled: false,
          hasWebhookUrl: true,
          type: 'discord',
        }),
      ]),
    );
    expect(payload.report?.operatorCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'messaging-status',
          command: expect.stringContaining('buddy hermes messaging status --json'),
        }),
        expect.objectContaining({
          id: 'messaging-start',
          command: expect.stringContaining('buddy hermes messaging start --json'),
        }),
      ]),
    );
    expect(JSON.stringify(payload)).not.toContain('secret-telegram-token');
    expect(JSON.stringify(payload)).not.toContain('secret-webhook');
  });
});
