/**
 * DM Pairing Integration Tests
 *
 * Tests the end-to-end pairing flow as wired into the channel
 * infrastructure: checkDMPairing helper, channel handler gating,
 * and the /pairing command handler.
 */

import {
  MockChannel,
  ChannelManager,
  checkDMPairing,
  getDMPairing,
  resetDMPairing,
  DMPairingManager,
  type InboundMessage,
} from '../../src/channels/index.js';
import { handlePairing } from '../../src/commands/handlers/security-handlers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDMMessage(
  channelType: 'telegram' | 'discord' | 'slack',
  senderId: string,
  content = 'Hello bot'
): InboundMessage {
  return {
    id: `msg-${Date.now()}`,
    channel: {
      id: `${channelType}-dm-${senderId}`,
      type: channelType,
      name: 'DM',
      isDM: true,
    },
    sender: {
      id: senderId,
      username: `user-${senderId}`,
      displayName: `User ${senderId}`,
    },
    content,
    contentType: 'text',
    timestamp: new Date(),
  };
}

function makeGroupMessage(
  channelType: 'telegram' | 'discord' | 'slack',
  senderId: string,
  content = 'Hello group'
): InboundMessage {
  return {
    id: `msg-${Date.now()}`,
    channel: {
      id: `${channelType}-group-1`,
      type: channelType,
      name: 'General',
      isDM: false,
      isGroup: true,
    },
    sender: {
      id: senderId,
      username: `user-${senderId}`,
      displayName: `User ${senderId}`,
    },
    content,
    contentType: 'text',
    timestamp: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DM Pairing Integration', () => {
  let pairing: DMPairingManager;

  beforeEach(() => {
    resetDMPairing();
    // Get a fresh instance with pairing enabled
    pairing = getDMPairing({
      enabled: true,
      pairingChannels: ['telegram', 'discord', 'slack'],
      allowlistPath: undefined,
    });
  });

  afterEach(() => {
    resetDMPairing();
  });

  // =========================================================================
  // checkDMPairing helper
  // =========================================================================

  describe('checkDMPairing helper', () => {
    it('should reject unknown DM senders on pairing-enabled channels', async () => {
      const message = makeDMMessage('telegram', 'unknown-user');
      const status = await checkDMPairing(message);

      expect(status.approved).toBe(false);
      expect(status.code).toBeDefined();
    });

    it('should approve DM senders who have been paired', async () => {
      const message = makeDMMessage('telegram', 'user-1');

      // First check generates a code
      const first = await checkDMPairing(message);
      expect(first.approved).toBe(false);

      // Owner approves via the pairing manager
      await pairing.approve('telegram', first.code!);

      // Subsequent check should pass
      const second = await checkDMPairing(message);
      expect(second.approved).toBe(true);
    });

    it('should always approve group messages (not DMs)', async () => {
      const message = makeGroupMessage('telegram', 'unknown-user');
      const status = await checkDMPairing(message);

      expect(status.approved).toBe(true);
    });

    it('should always approve channels that do not require pairing', async () => {
      const message: InboundMessage = {
        id: 'msg-1',
        channel: { id: 'web-1', type: 'web', isDM: true },
        sender: { id: 'web-user' },
        content: 'Hello',
        contentType: 'text',
        timestamp: new Date(),
      };

      const status = await checkDMPairing(message);
      expect(status.approved).toBe(true);
    });

    it('should always approve when pairing is disabled', async () => {
      resetDMPairing();
      getDMPairing({ enabled: false });

      const message = makeDMMessage('telegram', 'any-user');
      const status = await checkDMPairing(message);

      expect(status.approved).toBe(true);
    });
  });

  // =========================================================================
  // End-to-end pairing flow
  // =========================================================================

  describe('end-to-end flow', () => {
    it('should complete a full pairing lifecycle', async () => {
      // Step 1: Unknown user sends a DM
      const message = makeDMMessage('discord', 'new-user-123');
      const check1 = await checkDMPairing(message);

      expect(check1.approved).toBe(false);
      expect(check1.code).toBeDefined();
      const code = check1.code!;

      // Step 2: Verify the pairing message contains the code
      const pairingMsg = pairing.getPairingMessage(check1);
      expect(pairingMsg).toContain(code);
      expect(pairingMsg).toContain('discord');

      // Step 3: The code appears in pending list
      const pending = pairing.listPending();
      expect(pending.some(r => r.code === code)).toBe(true);

      // Step 4: Owner approves via CLI command handler
      const approveResult = await handlePairing(['approve', 'discord', code]);
      expect(approveResult.handled).toBe(true);
      expect(approveResult.entry?.content).toContain('approved');

      // Step 5: User is now approved
      const check2 = await checkDMPairing(message);
      expect(check2.approved).toBe(true);

      // Step 6: Verify user appears in approved list
      const listResult = await handlePairing(['list']);
      expect(listResult.entry?.content).toContain('new-user-123');

      // Step 7: Owner revokes access
      const revokeResult = await handlePairing(['revoke', 'discord', 'new-user-123']);
      expect(revokeResult.entry?.content).toContain('revoked');

      // Step 8: User is no longer approved
      const check3 = await checkDMPairing(message);
      expect(check3.approved).toBe(false);
    });
  });

  // =========================================================================
  // /pairing command handler
  // =========================================================================

  describe('handlePairing command', () => {
    it('should show help with no arguments', async () => {
      const result = await handlePairing([]);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Commands');
      expect(result.entry?.content).toContain('/pairing approve');
    });

    it('should show help with "help" argument', async () => {
      const result = await handlePairing(['help']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('DM Pairing');
    });

    it('should show status', async () => {
      await pairing.approveDirectly('telegram', 'user-1');

      const result = await handlePairing(['status']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Enabled: Yes');
      expect(result.entry?.content).toContain('Approved: 1');
    });

    it('should list approved senders', async () => {
      await pairing.approveDirectly('telegram', 'user-1', 'owner', 'Alice');
      await pairing.approveDirectly('discord', 'user-2', 'owner', 'Bob');

      const result = await handlePairing(['list']);
      expect(result.entry?.content).toContain('Alice');
      expect(result.entry?.content).toContain('Bob');
      expect(result.entry?.content).toContain('Approved Senders (2)');
    });

    it('should list empty approved senders', async () => {
      const result = await handlePairing(['list']);
      expect(result.entry?.content).toContain('No approved senders');
    });

    it('should list pending requests', async () => {
      const message = makeDMMessage('telegram', 'pending-user');
      await pairing.checkSender(message);

      const result = await handlePairing(['pending']);
      expect(result.entry?.content).toContain('Pending Pairing Requests');
      expect(result.entry?.content).toContain('pending-user');
    });

    it('should list empty pending requests', async () => {
      const result = await handlePairing(['pending']);
      expect(result.entry?.content).toContain('No pending pairing requests');
    });

    it('should approve with valid code', async () => {
      const message = makeDMMessage('telegram', 'user-to-approve');
      const status = await pairing.checkSender(message);

      const result = await handlePairing(['approve', 'telegram', status.code!]);
      expect(result.entry?.content).toContain('approved');
      expect(result.entry?.content).toContain('user-to-approve');
    });

    it('should fail to approve with invalid code', async () => {
      const result = await handlePairing(['approve', 'telegram', 'BADCODE']);
      expect(result.entry?.content).toContain('failed');
    });

    it('should fail to approve with invalid channel', async () => {
      const result = await handlePairing(['approve', 'invalid_channel', 'CODE']);
      expect(result.entry?.content).toContain('Invalid channel');
    });

    it('should show usage for approve without arguments', async () => {
      const result = await handlePairing(['approve']);
      expect(result.entry?.content).toContain('Usage');
    });

    it('should revoke an approved sender', async () => {
      await pairing.approveDirectly('slack', 'user-to-revoke');

      const result = await handlePairing(['revoke', 'slack', 'user-to-revoke']);
      expect(result.entry?.content).toContain('revoked');
    });

    it('should fail to revoke unknown sender', async () => {
      const result = await handlePairing(['revoke', 'slack', 'unknown']);
      expect(result.entry?.content).toContain('No approved sender');
    });

    it('should fail to revoke with invalid channel', async () => {
      const result = await handlePairing(['revoke', 'invalid_channel', 'user-1']);
      expect(result.entry?.content).toContain('Invalid channel');
    });

    it('should show usage for revoke without arguments', async () => {
      const result = await handlePairing(['revoke']);
      expect(result.entry?.content).toContain('Usage');
    });
  });

  // =========================================================================
  // Multi-channel scenarios
  // =========================================================================

  describe('multi-channel scenarios', () => {
    it('should isolate approval per channel', async () => {
      // Approve on telegram
      await pairing.approveDirectly('telegram', 'user-42');

      // Same user should still be unapproved on discord
      const discordMsg = makeDMMessage('discord', 'user-42');
      const status = await checkDMPairing(discordMsg);

      expect(status.approved).toBe(false);
    });

    it('should allow same user approved on multiple channels', async () => {
      await pairing.approveDirectly('telegram', 'user-42');
      await pairing.approveDirectly('discord', 'user-42');

      expect(pairing.isApproved('telegram', 'user-42')).toBe(true);
      expect(pairing.isApproved('discord', 'user-42')).toBe(true);
    });

    it('should revoke only the specified channel', async () => {
      await pairing.approveDirectly('telegram', 'user-42');
      await pairing.approveDirectly('discord', 'user-42');

      await pairing.revoke('telegram', 'user-42');

      expect(pairing.isApproved('telegram', 'user-42')).toBe(false);
      expect(pairing.isApproved('discord', 'user-42')).toBe(true);
    });
  });

  // =========================================================================
  // ChannelManager integration
  // =========================================================================

  describe('ChannelManager message handler with pairing', () => {
    it('should not block CLI channel messages', async () => {
      const manager = new ChannelManager();
      const mockChannel = new MockChannel({ type: 'cli', enabled: true });
      manager.registerChannel(mockChannel);
      await mockChannel.connect();

      const received: InboundMessage[] = [];
      manager.onMessage(async (msg) => {
        const status = await checkDMPairing(msg);
        if (status.approved) {
          received.push(msg);
        }
      });

      mockChannel.simulateMessage('Hello from CLI');

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(received.length).toBe(1);

      await manager.shutdown();
    });
  });
});
