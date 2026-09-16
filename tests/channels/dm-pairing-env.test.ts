/**
 * A-3 — DM_PAIRING_ENABLED is actually read. Default: pairing required.
 * The one-time code is journaled and listed by `buddy channels pairing`,
 * never interpolated into the user-facing line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DMPairingManager,
  getDMPairing,
  isDmPairingEnvEnabled,
  resetDMPairing,
  UNPAIRED_SENDER_REPLY,
} from '../../src/channels/dm-pairing.js';
import { handleChannels } from '../../src/commands/handlers/channel-handlers.js';
import { logger } from '../../src/utils/logger.js';
import type { InboundMessage } from '../../src/channels/core.js';

function makeMessage(senderId = 'user-99'): InboundMessage {
  return {
    id: 'msg-1',
    channel: { id: 'chat-1', type: 'telegram', name: 'DM', isDM: true },
    sender: { id: senderId, username: 'inconnu' },
    content: 'hello',
    contentType: 'text',
    timestamp: new Date(),
  };
}

describe('DM_PAIRING_ENABLED', () => {
  const previous = process.env.DM_PAIRING_ENABLED;

  afterEach(() => {
    if (previous === undefined) delete process.env.DM_PAIRING_ENABLED;
    else process.env.DM_PAIRING_ENABLED = previous;
    resetDMPairing();
  });

  it('defaults to required when the env is unset', () => {
    delete process.env.DM_PAIRING_ENABLED;
    expect(isDmPairingEnvEnabled({})).toBe(true);
    const manager = new DMPairingManager({ allowlistPath: undefined });
    expect(manager.requiresPairing('telegram')).toBe(true);
    manager.dispose();
  });

  it('honours an explicit false', () => {
    expect(isDmPairingEnvEnabled({ DM_PAIRING_ENABLED: 'false' })).toBe(false);
    const manager = new DMPairingManager({
      enabled: false,
      allowlistPath: undefined,
    });
    expect(manager.requiresPairing('telegram')).toBe(false);
    manager.dispose();
  });

  it('lets a constructor boolean win over the env', () => {
    process.env.DM_PAIRING_ENABLED = 'false';
    const manager = new DMPairingManager({ enabled: true, allowlistPath: undefined });
    expect(manager.requiresPairing('telegram')).toBe(true);
    manager.dispose();
  });
});

describe('one-time pairing code is server-side only', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetDMPairing();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    resetDMPairing();
  });

  it('logs the code, keeps it out of the user line, and consumes it on approve', async () => {
    const pairing = getDMPairing({ enabled: true, allowlistPath: undefined });
    const status = await pairing.checkSender(makeMessage());
    expect(status.approved).toBe(false);
    expect(status.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(pairing.getPairingMessage(status)).toBe(UNPAIRED_SENDER_REPLY);
    expect(pairing.getPairingMessage(status)).not.toContain(status.code);
    expect(warnSpy.mock.calls.some((call) => {
      const extra = call[1] as { code?: string } | undefined;
      return String(call[0]).includes('one-time pairing code') && extra?.code === status.code;
    })).toBe(true);

    const approved = await pairing.approve('telegram', status.code!);
    expect(approved?.senderId).toBe('user-99');
    expect(pairing.listPending().some((row) => row.code === status.code)).toBe(false);
    const again = await pairing.checkSender(makeMessage());
    expect(again.approved).toBe(true);
  });

  it('buddy channels pairing prints pending codes', async () => {
    const pairing = getDMPairing({ enabled: true, allowlistPath: undefined });
    const status = await pairing.checkSender(makeMessage('user-7'));
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    try {
      await handleChannels('pairing', {});
    } finally {
      log.mockRestore();
    }
    const dumped = lines.join('\n');
    expect(dumped).toMatch(/DM pairing: on/i);
    expect(dumped).toContain(status.code);
    expect(dumped).toContain('user-7');
  });
});
