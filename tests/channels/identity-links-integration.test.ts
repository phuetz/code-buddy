/**
 * Identity Links Integration Tests
 *
 * Tests the identity linking flow through the channel infrastructure:
 * - getCanonicalIdentity helper
 * - IdentityLinker singleton lifecycle
 * - /identity command handler subcommands
 */

import {
  getIdentityLinker,
  resetIdentityLinker,
  getCanonicalIdentity,
  type InboundMessage,
  type ChannelType,
} from '../../src/channels/index.js';
import { handleIdentity } from '../../src/commands/handlers/security-handlers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  channelType: ChannelType,
  channelId: string,
  senderId: string,
  content = 'test message'
): InboundMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    channel: {
      id: channelId,
      type: channelType,
    },
    sender: {
      id: senderId,
    },
    content,
    contentType: 'text',
    timestamp: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Identity Links Integration', () => {
  beforeEach(() => {
    resetIdentityLinker();
    // Pre-create the singleton with autoPersist off: the default persistPath
    // is the REAL ~/.codebuddy/identity-links.json, and this suite never
    // asserts on-disk state. Without this, every run of this file fired
    // unawaited writes at the user's actual home directory (see
    // docs/reports/2026-09/REPARATION-IDLINKS1.md). getIdentityLinker() only
    // honours a config argument the first time it creates the singleton, so
    // this must run before any test calls getIdentityLinker()/getCanonicalIdentity().
    getIdentityLinker({ autoPersist: false });
  });

  afterEach(() => {
    resetIdentityLinker();
  });

  // =========================================================================
  // getCanonicalIdentity helper
  // =========================================================================

  describe('getCanonicalIdentity helper', () => {
    it('should return null when no identity is linked', () => {
      const message = makeMessage('telegram', 'chat-1', 'user-123');
      const canonical = getCanonicalIdentity(message);

      expect(canonical).toBeNull();
    });

    it('should return the canonical identity when linked', () => {
      const linker = getIdentityLinker();
      linker.link(
        { channelType: 'telegram', peerId: 'user-123' },
        { channelType: 'discord', peerId: 'user#6789' }
      );

      const telegramMsg = makeMessage('telegram', 'chat-1', 'user-123');
      const canonical = getCanonicalIdentity(telegramMsg);

      expect(canonical).not.toBeNull();
      expect(canonical!.identities).toHaveLength(2);
      expect(canonical!.identities.some(
        i => i.channelType === 'telegram' && i.peerId === 'user-123'
      )).toBe(true);
      expect(canonical!.identities.some(
        i => i.channelType === 'discord' && i.peerId === 'user#6789'
      )).toBe(true);
    });

    it('should return the same canonical for both linked identities', () => {
      const linker = getIdentityLinker();
      linker.link(
        { channelType: 'telegram', peerId: 'user-123' },
        { channelType: 'discord', peerId: 'user#6789' }
      );

      const telegramMsg = makeMessage('telegram', 'chat-1', 'user-123');
      const discordMsg = makeMessage('discord', 'guild-1', 'user#6789');

      const canonical1 = getCanonicalIdentity(telegramMsg);
      const canonical2 = getCanonicalIdentity(discordMsg);

      expect(canonical1).not.toBeNull();
      expect(canonical2).not.toBeNull();
      expect(canonical1!.id).toBe(canonical2!.id);
    });
  });

  // =========================================================================
  // IdentityLinker singleton lifecycle
  // =========================================================================

  describe('singleton lifecycle', () => {
    it('should return the same instance on repeated calls', () => {
      const linker1 = getIdentityLinker();
      const linker2 = getIdentityLinker();

      expect(linker1).toBe(linker2);
    });

    it('should return a fresh instance after reset', () => {
      const linker1 = getIdentityLinker();
      linker1.link(
        { channelType: 'telegram', peerId: 'a' },
        { channelType: 'discord', peerId: 'b' }
      );

      resetIdentityLinker();

      const linker2 = getIdentityLinker();
      expect(linker2).not.toBe(linker1);
      expect(linker2.listAll()).toHaveLength(0);
    });
  });

  // =========================================================================
  // Linking and unlinking
  // =========================================================================

  describe('link and unlink operations', () => {
    it('should link two identities and resolve them', () => {
      const linker = getIdentityLinker();

      const canonical = linker.link(
        { channelType: 'telegram', peerId: '111' },
        { channelType: 'slack', peerId: 'U222' }
      );

      expect(canonical.identities).toHaveLength(2);
      expect(linker.areSamePerson(
        { channelType: 'telegram', peerId: '111' },
        { channelType: 'slack', peerId: 'U222' }
      )).toBe(true);
    });

    it('should merge canonicals when both identities are already linked to different groups', () => {
      const linker = getIdentityLinker();

      // Create two separate canonical identities
      linker.link(
        { channelType: 'telegram', peerId: 'a' },
        { channelType: 'discord', peerId: 'b' }
      );
      linker.link(
        { channelType: 'slack', peerId: 'c' },
        { channelType: 'matrix', peerId: 'd' }
      );

      expect(linker.listAll()).toHaveLength(2);

      // Now link across the two groups
      linker.link(
        { channelType: 'telegram', peerId: 'a' },
        { channelType: 'slack', peerId: 'c' }
      );

      // Should merge into one canonical
      expect(linker.listAll()).toHaveLength(1);

      const merged = linker.listAll()[0];
      expect(merged.identities).toHaveLength(4);
    });

    it('should unlink an identity from its canonical', () => {
      const linker = getIdentityLinker();

      linker.link(
        { channelType: 'telegram', peerId: '111' },
        { channelType: 'discord', peerId: '222' }
      );

      const result = linker.unlink({ channelType: 'discord', peerId: '222' });
      expect(result).toBe(true);

      // telegram identity should still exist
      const canonical = linker.resolve({ channelType: 'telegram', peerId: '111' });
      expect(canonical).not.toBeNull();
      expect(canonical!.identities).toHaveLength(1);

      // discord identity should be gone
      const discordCanonical = linker.resolve({ channelType: 'discord', peerId: '222' });
      expect(discordCanonical).toBeNull();
    });

    it('should return false when unlinking a non-existent identity', () => {
      const linker = getIdentityLinker();
      const result = linker.unlink({ channelType: 'telegram', peerId: 'nonexistent' });
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // /identity command handler
  // =========================================================================

  describe('handleIdentity command', () => {
    it('should show help with no arguments', () => {
      const result = handleIdentity([]);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Commands');
      expect(result.entry?.content).toContain('/identity link');
    });

    it('should show help with "help" argument', () => {
      const result = handleIdentity(['help']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Identity Links');
    });

    it('should link two identities', () => {
      const result = handleIdentity(['link', 'telegram', '12345', 'discord', 'user#6789']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Identity linked!');
      expect(result.entry?.content).toContain('telegram');
      expect(result.entry?.content).toContain('discord');
    });

    it('should show usage for link without enough arguments', () => {
      const result = handleIdentity(['link', 'telegram']);
      expect(result.entry?.content).toContain('Usage');
    });

    it('should reject link with invalid channel', () => {
      const result = handleIdentity(['link', 'invalid_channel', '123', 'discord', '456']);
      expect(result.entry?.content).toContain('Invalid channel');
    });

    it('should reject link with invalid second channel', () => {
      const result = handleIdentity(['link', 'telegram', '123', 'invalid_channel', '456']);
      expect(result.entry?.content).toContain('Invalid channel');
    });

    it('should list linked identities', () => {
      const linker = getIdentityLinker();
      linker.link(
        { channelType: 'telegram', peerId: 'user-1' },
        { channelType: 'discord', peerId: 'user-2' }
      );

      const result = handleIdentity(['list']);
      expect(result.entry?.content).toContain('Identity Links (1)');
      expect(result.entry?.content).toContain('telegram');
      expect(result.entry?.content).toContain('discord');
    });

    it('should list empty identities', () => {
      const result = handleIdentity(['list']);
      expect(result.entry?.content).toContain('No identity links configured');
    });

    it('should unlink an identity', () => {
      const linker = getIdentityLinker();
      linker.link(
        { channelType: 'telegram', peerId: 'user-1' },
        { channelType: 'discord', peerId: 'user-2' }
      );

      const result = handleIdentity(['unlink', 'discord', 'user-2']);
      expect(result.entry?.content).toContain('Identity unlinked');
    });

    it('should show usage for unlink without arguments', () => {
      const result = handleIdentity(['unlink']);
      expect(result.entry?.content).toContain('Usage');
    });

    it('should reject unlink with invalid channel', () => {
      const result = handleIdentity(['unlink', 'invalid_channel', 'user-1']);
      expect(result.entry?.content).toContain('Invalid channel');
    });

    it('should fail to unlink non-existent identity', () => {
      const result = handleIdentity(['unlink', 'telegram', 'nonexistent']);
      expect(result.entry?.content).toContain('No identity link found');
    });

    it('should show status', () => {
      const linker = getIdentityLinker();
      linker.link(
        { channelType: 'telegram', peerId: 'user-1' },
        { channelType: 'discord', peerId: 'user-2' }
      );

      const result = handleIdentity(['status']);
      expect(result.entry?.content).toContain('Identity Linker Status');
      expect(result.entry?.content).toContain('Canonical identities: 1');
      expect(result.entry?.content).toContain('Total linked: 2');
      expect(result.entry?.content).toContain('Multi-channel: 1');
    });
  });

  // =========================================================================
  // End-to-end identity flow
  // =========================================================================

  describe('end-to-end identity flow', () => {
    it('should complete a full identity lifecycle via command handler', () => {
      // Step 1: Link two identities
      const linkResult = handleIdentity(['link', 'telegram', 'tg-user', 'discord', 'dc-user']);
      expect(linkResult.entry?.content).toContain('Identity linked!');

      // Step 2: Verify via list command
      const listResult = handleIdentity(['list']);
      expect(listResult.entry?.content).toContain('tg-user');
      expect(listResult.entry?.content).toContain('dc-user');

      // Step 3: Verify via getCanonicalIdentity helper
      const tgMsg = makeMessage('telegram', 'chat-1', 'tg-user');
      const dcMsg = makeMessage('discord', 'guild-1', 'dc-user');
      const canonical1 = getCanonicalIdentity(tgMsg);
      const canonical2 = getCanonicalIdentity(dcMsg);
      expect(canonical1).not.toBeNull();
      expect(canonical1!.id).toBe(canonical2!.id);

      // Step 4: Check status
      const statusResult = handleIdentity(['status']);
      expect(statusResult.entry?.content).toContain('Canonical identities: 1');

      // Step 5: Unlink one identity
      const unlinkResult = handleIdentity(['unlink', 'discord', 'dc-user']);
      expect(unlinkResult.entry?.content).toContain('Identity unlinked');

      // Step 6: Verify discord identity is gone
      const dcCanonical = getCanonicalIdentity(dcMsg);
      expect(dcCanonical).toBeNull();

      // Step 7: Telegram identity should still exist
      const tgCanonical = getCanonicalIdentity(tgMsg);
      expect(tgCanonical).not.toBeNull();
    });
  });
});
