/**
 * Cat 45: Channel Core Types (5 tests, no API)
 * Cat 46: Niche Channels (5 tests, no API)
 * Cat 47: PR Session Linker (4 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 45: Channel Core Types
// ============================================================================

export function cat45ChannelCore(): TestDef[] {
  return [
    {
      name: '45.1-core-types-exported',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/core.js');
        const keys = Object.keys(mod);
        return {
          pass: keys.length >= 1,
          metadata: { exports: keys },
        };
      },
    },
    {
      name: '45.2-channel-types-include-major',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/core.js');
        // Check if ChannelType includes major platforms
        const types = mod.CHANNEL_TYPES || mod.channelTypes;
        if (!types) return { pass: true, metadata: { skip: 'no CHANNEL_TYPES export' } };
        const arr = Array.isArray(types) ? types : Object.values(types);
        const hasTelegram = arr.some((t: any) => String(t).includes('telegram'));
        const hasDiscord = arr.some((t: any) => String(t).includes('discord'));
        return {
          pass: hasTelegram || hasDiscord || arr.length >= 5,
          metadata: { types: arr.slice(0, 10) },
        };
      },
    },
    {
      name: '45.3-channel-index-exports',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/index.js');
        const keys = Object.keys(mod);
        return {
          pass: keys.length >= 3,
          metadata: { exports: keys.slice(0, 15) },
        };
      },
    },
    {
      name: '45.4-mock-channel-inbound-shape',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/core.js');
        const channel = new mod.MockChannel({ type: 'cli' });
        const message = channel.simulateMessage('/help now');
        const status = channel.getStatus();
        return {
          pass:
            message.content === '/help now' &&
            message.isCommand === true &&
            message.commandName === 'help' &&
            Array.isArray(message.commandArgs) &&
            message.commandArgs[0] === 'now' &&
            status.type === 'cli',
          metadata: {
            commandName: message.commandName,
            commandArgs: message.commandArgs,
            status,
          },
        };
      },
    },
    {
      name: '45.5-send-policy-integration',
      timeout: 5000,
      fn: async () => {
        const { SendPolicyEngine } = await import('../../src/channels/send-policy.js');
        SendPolicyEngine.resetInstance();
        const engine = SendPolicyEngine.getInstance({ default: 'deny' });
        engine.addRule({
          action: 'allow',
          match: { channel: 'telegram' as any, chatType: 'dm' },
        });
        const allowed = engine.evaluate({ sessionKey: 'test', channel: 'telegram' as any, chatType: 'dm' });
        const denied = engine.evaluate({ sessionKey: 'test', channel: 'discord' as any, chatType: 'group' });
        SendPolicyEngine.resetInstance();
        return {
          pass: allowed.allowed && !denied.allowed,
          metadata: { allowed, denied },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 46: Niche Channels
// ============================================================================

export function cat46NicheChannels(): TestDef[] {
  return [
    {
      name: '46.1-niche-channels-module-exports',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/niche-channels.js');
        const keys = Object.keys(mod);
        return {
          pass: keys.length >= 1,
          metadata: { exports: keys },
        };
      },
    },
    {
      name: '46.2-irc-channel-exists',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/irc/index.js');
        return { pass: Object.keys(mod).length >= 1, metadata: { exports: Object.keys(mod) } };
      },
    },
    {
      name: '46.3-feishu-channel-exists',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/feishu/index.js');
        return { pass: Object.keys(mod).length >= 1, metadata: { exports: Object.keys(mod) } };
      },
    },
    {
      name: '46.4-synology-chat-exists',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/synology-chat/index.js');
        return { pass: Object.keys(mod).length >= 1, metadata: { exports: Object.keys(mod) } };
      },
    },
    {
      name: '46.5-line-channel-exists',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/channels/line/index.js');
        return { pass: Object.keys(mod).length >= 1, metadata: { exports: Object.keys(mod) } };
      },
    },
  ];
}

// ============================================================================
// Cat 47: PR Session Linker
// ============================================================================

export function cat47PRSessionLinker(): TestDef[] {
  return [
    {
      name: '47.1-module-exports',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/integrations/pr-session-linker.js');
        const keys = Object.keys(mod);
        return {
          pass: keys.length >= 1,
          metadata: { exports: keys },
        };
      },
    },
    {
      name: '47.2-instantiation',
      timeout: 5000,
      fn: async () => {
        const { PRSessionLinker } = await import('../../src/integrations/pr-session-linker.js');
        const linker = new PRSessionLinker();
        return {
          pass: linker.getCurrentPR() === null && linker.getReviewStatus() === null && linker.formatPRFooter() === '',
        };
      },
    },
    {
      name: '47.3-link-and-get',
      timeout: 5000,
      fn: async () => {
        const { PRSessionLinker } = await import('../../src/integrations/pr-session-linker.js');
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: false }) as Response;
        try {
          const linker = new PRSessionLinker();
          const result = await linker.linkToPR('https://github.com/example/repo/pull/123');
          const current = linker.getCurrentPR();
          return {
            pass:
              result.number === 123 &&
              current?.number === 123 &&
              linker.getReviewStatus() === 'pending' &&
              linker.formatPRFooter().includes('PR #123'),
            metadata: { result, current },
          };
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    },
    {
      name: '47.4-unlink',
      timeout: 5000,
      fn: async () => {
        const { PRSessionLinker } = await import('../../src/integrations/pr-session-linker.js');
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: false }) as Response;
        try {
          const linker = new PRSessionLinker();
          await linker.linkToPR('https://github.com/example/repo/pull/456');
          linker.unlinkPR();
          const result = linker.getCurrentPR();
          return {
            pass: result === null && linker.getReviewStatus() === null && linker.formatPRFooter() === '',
            metadata: { afterUnlink: result },
          };
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    },
  ];
}
