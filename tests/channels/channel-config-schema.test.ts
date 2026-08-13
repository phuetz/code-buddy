import { describe, expect, it } from 'vitest';
import {
  channelSecretStorageName,
  getChannelConfigDefinitions,
  getChannelSecretFields,
  validateChannelConfigPatch,
  validateChannelForEnable,
} from '../../src/channels/channel-config-schema.js';

describe('channel config schema', () => {
  it('covers every concrete channel instantiated by the config loader', () => {
    const types = getChannelConfigDefinitions().map((definition) => definition.type);
    expect(types).toEqual(expect.arrayContaining([
      'telegram',
      'discord',
      'slack',
      'whatsapp',
      'signal',
      'matrix',
      'google-chat',
      'teams',
      'webchat',
      'dingtalk',
      'wecom',
      'weixin',
      'qq',
      'line',
      'nostr',
      'zalo',
      'mattermost',
      'nextcloud-talk',
      'twilio-voice',
      'imessage',
      'irc',
      'feishu',
      'synology-chat',
      'ntfy',
    ]));
    expect(new Set(types).size).toBe(types.length);
  });

  it('validates and normalizes only declared non-secret values', () => {
    const result = validateChannelConfigPatch('matrix', {
      enabled: false,
      token: 'must-not-land-on-disk',
      allowedUsers: [' alice ', 'alice', '', 'bob'],
      options: {
        homeserverUrl: ' https://matrix.example ',
        userId: ' @buddy:matrix.example ',
        accessToken: 'also-must-not-land-on-disk',
        autoJoin: true,
        initialRooms: [' !one:example ', '!one:example', '!two:example'],
        unexpected: 'drop me',
      },
    });

    expect(result).toEqual({
      ok: true,
      patch: {
        enabled: false,
        allowedUsers: ['alice', 'bob'],
        options: {
          homeserverUrl: 'https://matrix.example',
          userId: '@buddy:matrix.example',
          autoJoin: true,
          initialRooms: ['!one:example', '!two:example'],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-land-on-disk');
  });

  it('rejects malformed URLs, numeric bounds and unsupported channel types', () => {
    expect(validateChannelConfigPatch('matrix', {
      options: { homeserverUrl: 'file:///etc/passwd' },
    })).toMatchObject({ ok: false });
    expect(validateChannelConfigPatch('webchat', {
      options: { port: 70_000 },
    })).toMatchObject({ ok: false });
    expect(validateChannelConfigPatch('unknown', {})).toEqual({
      ok: false,
      error: 'unsupported channel type: unknown',
    });
  });

  it('requires channel-specific fields and encrypted secrets before enabling', () => {
    const entry = {
      type: 'matrix',
      enabled: true,
      options: {
        homeserverUrl: 'https://matrix.example',
        userId: '@buddy:matrix.example',
      },
    };
    expect(validateChannelForEnable('matrix', entry, {})).toEqual({
      ok: false,
      error: 'Access token is required before enabling Matrix',
    });
    expect(validateChannelForEnable('matrix', entry, { accessToken: true })).toEqual({ ok: true });
  });

  it('maps primary and secondary secrets to distinct vault keys', () => {
    const slack = getChannelSecretFields('slack');
    expect(channelSecretStorageName(slack.find((field) => field.key === 'token')!)).toBe('token');
    expect(channelSecretStorageName(slack.find((field) => field.key === 'appToken')!)).toBe('appToken');
  });
});
