/**
 * DM Pairing Module Tests
 *
 * Tests the DMPairingManager directly: pairing codes, approval,
 * revocation, blocking, persistence, and configuration.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DMPairingManager,
  getDMPairing,
  resetDMPairing,
  type DMPairingConfig,
  type PairingStatus,
} from '../../src/channels/dm-pairing.js';
import type { InboundMessage, ChannelType } from '../../src/channels/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    channel: {
      id: 'chat-1',
      type: 'telegram',
      name: 'DM',
      isDM: true,
    },
    sender: {
      id: 'user-42',
      username: 'alice',
      displayName: 'Alice',
    },
    content: 'Hello bot',
    contentType: 'text',
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DMPairingManager', () => {
  let manager: DMPairingManager;

  beforeEach(() => {
    manager = new DMPairingManager({
      enabled: true,
      pairingChannels: ['telegram', 'discord', 'slack'],
      codeLength: 6,
      codeExpiryMs: 15 * 60 * 1000,
      maxPending: 100,
      maxAttempts: 5,
      blockDurationMs: 60 * 60 * 1000,
      autoApproveCli: true,
      // Disable persistence for tests
      allowlistPath: undefined,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  // =========================================================================
  // checkSender
  // =========================================================================

  describe('checkSender', () => {
    it('should return unapproved with a pairing code for unknown sender', async () => {
      const message = makeMessage();
      const status = await manager.checkSender(message);

      expect(status.approved).toBe(false);
      expect(status.code).toBeDefined();
      expect(status.code!.length).toBe(6);
      expect(status.senderId).toBe('user-42');
      expect(status.channelType).toBe('telegram');
    });

    it('should return the same code on repeated checks within expiry', async () => {
      const message = makeMessage();
      const first = await manager.checkSender(message);
      const second = await manager.checkSender(message);

      expect(first.code).toBe(second.code);
    });

    it('should auto-approve CLI channel when autoApproveCli is true', async () => {
      const message = makeMessage({
        channel: { id: 'cli-1', type: 'cli', isDM: true },
      });

      const status = await manager.checkSender(message);

      expect(status.approved).toBe(true);
    });

    it('should approve already-approved senders', async () => {
      const message = makeMessage();

      // First check to generate a code
      const first = await manager.checkSender(message);
      expect(first.approved).toBe(false);

      // Approve the sender
      await manager.approve('telegram', first.code!);

      // Next check should be approved
      const second = await manager.checkSender(message);
      expect(second.approved).toBe(true);
    });

    it('should skip pairing for non-pairing channels', async () => {
      const message = makeMessage({
        channel: { id: 'web-1', type: 'web', isDM: true },
      });

      const status = await manager.checkSender(message);

      expect(status.approved).toBe(true);
    });
  });

  // =========================================================================
  // getPairingMessage
  // =========================================================================

  describe('getPairingMessage', () => {
    it('should return a formatted pairing message with code and channel', async () => {
      const message = makeMessage();
      const status = await manager.checkSender(message);
      const text = manager.getPairingMessage(status);

      expect(text).toContain(status.code!);
      expect(text).toContain('telegram');
    });

    it('should return empty string for approved status', () => {
      const status: PairingStatus = {
        approved: true,
        senderId: 'user-42',
        channelType: 'telegram',
      };

      expect(manager.getPairingMessage(status)).toBe('');
    });
  });

  // =========================================================================
  // approve
  // =========================================================================

  describe('approve', () => {
    it('should approve a pending request with valid code', async () => {
      const message = makeMessage();
      const status = await manager.checkSender(message);

      const sender = await manager.approve('telegram', status.code!);

      expect(sender).not.toBeNull();
      expect(sender!.channelType).toBe('telegram');
      expect(sender!.senderId).toBe('user-42');
      expect(sender!.displayName).toBe('Alice');
    });

    it('should return null for invalid code', async () => {
      const result = await manager.approve('telegram', 'BADCODE');
      expect(result).toBeNull();
    });

    it('should return null for wrong channel', async () => {
      const message = makeMessage();
      const status = await manager.checkSender(message);

      const result = await manager.approve('discord', status.code!);
      expect(result).toBeNull();
    });

    it('should emit pairing:approved event', async () => {
      const events: unknown[] = [];
      manager.on('pairing:approved', (sender) => events.push(sender));

      const message = makeMessage();
      const status = await manager.checkSender(message);
      await manager.approve('telegram', status.code!);

      expect(events.length).toBe(1);
    });

    it('should remove pending request after approval', async () => {
      const message = makeMessage();
      const status = await manager.checkSender(message);
      await manager.approve('telegram', status.code!);

      const pending = manager.listPending();
      expect(pending.length).toBe(0);
    });
  });

  // =========================================================================
  // approveDirectly
  // =========================================================================

  describe('approveDirectly', () => {
    it('should approve a sender without a pairing code', async () => {
      const sender = await manager.approveDirectly('discord', 'user-99', 'owner', 'Bob');

      expect(sender.channelType).toBe('discord');
      expect(sender.senderId).toBe('user-99');
      expect(sender.displayName).toBe('Bob');
    });

    it('should make the sender approved for subsequent checks', async () => {
      await manager.approveDirectly('telegram', 'user-42');

      const message = makeMessage();
      const status = await manager.checkSender(message);

      expect(status.approved).toBe(true);
    });
  });

  // =========================================================================
  // revoke
  // =========================================================================

  describe('revoke', () => {
    it('should revoke an approved sender', async () => {
      await manager.approveDirectly('telegram', 'user-42');
      const revoked = await manager.revoke('telegram', 'user-42');

      expect(revoked).toBe(true);
      expect(manager.isApproved('telegram', 'user-42')).toBe(false);
    });

    it('should return false for unknown sender', async () => {
      const result = await manager.revoke('telegram', 'unknown');
      expect(result).toBe(false);
    });

    it('should emit pairing:revoked event', async () => {
      const events: unknown[] = [];
      manager.on('pairing:revoked', (sender) => events.push(sender));

      await manager.approveDirectly('telegram', 'user-42');
      await manager.revoke('telegram', 'user-42');

      expect(events.length).toBe(1);
    });
  });

  // =========================================================================
  // Blocking
  // =========================================================================

  describe('blocking', () => {
    it('should block sender after max attempts', async () => {
      const shortManager = new DMPairingManager({
        enabled: true,
        pairingChannels: ['telegram'],
        maxAttempts: 2,
        blockDurationMs: 60 * 1000,
        allowlistPath: undefined,
      });

      const message = makeMessage();

      // Exhaust attempts (1 to create + maxAttempts to trigger block)
      for (let i = 0; i < 3; i++) {
        await shortManager.checkSender(message);
      }

      expect(shortManager.isBlocked('telegram:user-42')).toBe(true);

      shortManager.dispose();
    });

    it('should return unapproved for blocked senders without a code', async () => {
      const shortManager = new DMPairingManager({
        enabled: true,
        pairingChannels: ['telegram'],
        maxAttempts: 1,
        blockDurationMs: 60 * 1000,
        allowlistPath: undefined,
      });

      const message = makeMessage();

      // Trigger blocking
      await shortManager.checkSender(message);
      await shortManager.checkSender(message);

      const status = await shortManager.checkSender(message);
      expect(status.approved).toBe(false);

      shortManager.dispose();
    });
  });

  // =========================================================================
  // Query methods
  // =========================================================================

  describe('query methods', () => {
    it('should list approved senders', async () => {
      await manager.approveDirectly('telegram', 'user-1');
      await manager.approveDirectly('discord', 'user-2');

      const approved = manager.listApproved();
      expect(approved.length).toBe(2);
    });

    it('should list approved senders for a specific channel', async () => {
      await manager.approveDirectly('telegram', 'user-1');
      await manager.approveDirectly('discord', 'user-2');
      await manager.approveDirectly('telegram', 'user-3');

      const telegramApproved = manager.listApprovedForChannel('telegram');
      expect(telegramApproved.length).toBe(2);
    });

    it('should list pending requests', async () => {
      await manager.checkSender(makeMessage());
      await manager.checkSender(makeMessage({
        sender: { id: 'user-99', username: 'bob' },
      }));

      const pending = manager.listPending();
      expect(pending.length).toBe(2);
    });

    it('should check requiresPairing', () => {
      expect(manager.requiresPairing('telegram')).toBe(true);
      expect(manager.requiresPairing('discord')).toBe(true);
      expect(manager.requiresPairing('web')).toBe(false);
    });

    it('should check isApproved', async () => {
      await manager.approveDirectly('telegram', 'user-42');

      expect(manager.isApproved('telegram', 'user-42')).toBe(true);
      expect(manager.isApproved('telegram', 'user-99')).toBe(false);
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      await manager.approveDirectly('telegram', 'user-1');
      await manager.approveDirectly('discord', 'user-2');
      await manager.checkSender(makeMessage({
        sender: { id: 'user-99', username: 'pending' },
      }));

      const stats = manager.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.totalApproved).toBe(2);
      expect(stats.totalPending).toBe(1);
      expect(stats.approvedByChannel['telegram']).toBe(1);
      expect(stats.approvedByChannel['discord']).toBe(1);
    });
  });

  // =========================================================================
  // Configuration: disabled
  // =========================================================================

  describe('disabled mode', () => {
    it('should always approve when disabled', async () => {
      const disabled = new DMPairingManager({
        enabled: false,
        allowlistPath: undefined,
      });

      const status = await disabled.checkSender(makeMessage());

      expect(status.approved).toBe(true);

      disabled.dispose();
    });

    it('should report requiresPairing as false when disabled', () => {
      const disabled = new DMPairingManager({
        enabled: false,
        allowlistPath: undefined,
      });

      expect(disabled.requiresPairing('telegram')).toBe(false);

      disabled.dispose();
    });
  });

  // =========================================================================
  // dispose
  // =========================================================================

  describe('dispose', () => {
    it('should clear all data', async () => {
      await manager.approveDirectly('telegram', 'user-1');

      manager.dispose();

      expect(manager.listApproved().length).toBe(0);
      expect(manager.listPending().length).toBe(0);
    });
  });

  // =========================================================================
  // Persistence — D2 (mutation confirmée seulement après écriture durable)
  // =========================================================================

  describe('persistence D2', () => {
    let allowlistDir: string;

    beforeEach(async () => {
      const tmpRoot = path.join(process.cwd(), 'tmp');
      await fs.mkdir(tmpRoot, { recursive: true });
      allowlistDir = await fs.mkdtemp(path.join(tmpRoot, 'r3-pairing-'));
    });

    afterEach(async () => {
      await fs.rm(allowlistDir, { recursive: true, force: true });
    });

    it('D2: approve n\'est pas confirmé si persistAllowlist échoue', async () => {
      const pairing = new DMPairingManager({
        enabled: true,
        pairingChannels: ['telegram'],
        allowlistPath: allowlistDir,
      });
      const status = await pairing.checkSender(makeMessage());
      pairing.persistAllowlist = async () => {
        throw new Error('ENOSPC');
      };

      await expect(pairing.approve('telegram', status.code!)).rejects.toThrow(/ENOSPC/);
      expect(pairing.isApproved('telegram', 'user-42')).toBe(false);

      pairing.dispose();
    });

    it('D2: le fichier allowlist est un fichier régulier non vide après approve', async () => {
      const pairing = new DMPairingManager({
        enabled: true,
        pairingChannels: ['telegram'],
        allowlistPath: allowlistDir,
      });
      const status = await pairing.checkSender(makeMessage());
      const sender = await pairing.approve('telegram', status.code!);

      expect(sender).not.toBeNull();
      const filePath = path.join(allowlistDir, 'telegram-allowFrom.json');
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(0);
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Array<{ senderId: string }>;
      expect(parsed[0]?.senderId).toBe('user-42');
      const leftovers = (await fs.readdir(allowlistDir)).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);

      pairing.dispose();
    });
  });
});

// ===========================================================================
// Singleton
// ===========================================================================

describe('getDMPairing / resetDMPairing', () => {
  afterEach(() => {
    resetDMPairing();
  });

  it('should return the same instance', () => {
    const a = getDMPairing();
    const b = getDMPairing();
    expect(a).toBe(b);
  });

  it('should return a new instance after reset', () => {
    const a = getDMPairing();
    resetDMPairing();
    const b = getDMPairing();
    expect(a).not.toBe(b);
  });
});
