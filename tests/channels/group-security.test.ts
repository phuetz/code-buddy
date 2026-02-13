/**
 * Group Security Module Tests
 *
 * Tests the GroupSecurityManager: mention-gating, activation modes,
 * allowlist/blocklist, rate limiting, and DM pass-through.
 */

import {
  GroupSecurityManager,
  getGroupSecurity,
  resetGroupSecurity,
  type GroupConfig,
  type GroupSecurityConfig,
} from '../../src/channels/group-security.js';
import type { InboundMessage } from '../../src/channels/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGroupMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    channel: {
      id: 'group-123',
      type: 'telegram',
      name: 'Test Group',
      isGroup: true,
      isDM: false,
    },
    sender: {
      id: 'user-42',
      username: 'alice',
      displayName: 'Alice',
    },
    content: 'Hello everyone',
    contentType: 'text',
    timestamp: new Date(),
    ...overrides,
  };
}

function makeDMMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-2',
    channel: {
      id: 'dm-456',
      type: 'telegram',
      name: 'DM',
      isDM: true,
      isGroup: false,
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

describe('GroupSecurityManager', () => {
  let manager: GroupSecurityManager;

  beforeEach(() => {
    manager = new GroupSecurityManager({
      enabled: true,
      defaultMode: 'mention-only',
      mentionPatterns: ['@buddy', '@codebuddy', '@bot'],
      requireMentionInGroups: true,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  // =========================================================================
  // DM Pass-through
  // =========================================================================

  describe('DM pass-through', () => {
    it('should always allow DM messages', () => {
      const message = makeDMMessage();
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('direct message');
    });

    it('should allow DM messages even when security is enabled', () => {
      const message = makeDMMessage({ content: 'no mention here' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
    });

    it('should allow messages that are neither DM nor group (non-group channels)', () => {
      const message = makeGroupMessage({
        channel: { id: 'ch-1', type: 'web', isDM: false, isGroup: false },
      });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('direct message');
    });
  });

  // =========================================================================
  // Disabled Mode
  // =========================================================================

  describe('disabled mode', () => {
    it('should allow all messages when security is disabled', () => {
      const disabled = new GroupSecurityManager({ enabled: false });

      const message = makeGroupMessage();
      const result = disabled.shouldProcess(message);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('group security disabled');

      disabled.dispose();
    });
  });

  // =========================================================================
  // Mention-Gating
  // =========================================================================

  describe('mention-gating', () => {
    it('should block group messages without a mention (default mention-only mode)', () => {
      const message = makeGroupMessage({ content: 'Hello everyone' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('no mention detected');
    });

    it('should allow group messages with @buddy mention', () => {
      const message = makeGroupMessage({ content: 'Hey @buddy can you help?' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
    });

    it('should allow group messages with @codebuddy mention', () => {
      const message = makeGroupMessage({ content: '@codebuddy run tests' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
    });

    it('should allow group messages with @bot mention', () => {
      const message = makeGroupMessage({ content: 'yo @bot do something' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
    });

    it('should be case-insensitive for mention matching', () => {
      const message = makeGroupMessage({ content: 'Hey @BUDDY help me' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
    });

    it('should use custom mention patterns for a specific group', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'mention-only',
        mentionPatterns: ['@mybot'],
      });

      // Default pattern should not match
      const msg1 = makeGroupMessage({ content: 'Hey @buddy' });
      const result1 = manager.shouldProcess(msg1);
      expect(result1.allowed).toBe(false);

      // Custom pattern should match
      const msg2 = makeGroupMessage({ content: 'Hey @mybot' });
      const result2 = manager.shouldProcess(msg2);
      expect(result2.allowed).toBe(true);
    });

    it('should skip mention check when requireMention is false for a group', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'mention-only',
        requireMention: false,
      });

      const message = makeGroupMessage({ content: 'Hello no mention' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
    });
  });

  // =========================================================================
  // Activation Modes
  // =========================================================================

  describe('activation modes', () => {
    it('should process all messages in active mode', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });

      const message = makeGroupMessage({ content: 'No mention needed' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
    });

    it('should block all messages in inactive mode', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'inactive',
      });

      const message = makeGroupMessage({ content: '@buddy please help' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('group is inactive');
    });

    it('should only allow allowlisted users in allowlist-only mode', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'allowlist-only',
        allowedUsers: ['user-1', 'user-2'],
      });

      // Non-allowlisted user
      const msg1 = makeGroupMessage({
        sender: { id: 'user-42', username: 'alice' },
      });
      const result1 = manager.shouldProcess(msg1);
      expect(result1.allowed).toBe(false);
      expect(result1.reason).toBe('user not on allowlist');

      // Allowlisted user
      const msg2 = makeGroupMessage({
        sender: { id: 'user-1', username: 'bob' },
      });
      const result2 = manager.shouldProcess(msg2);
      expect(result2.allowed).toBe(true);
    });

    it('should allow globally allowlisted users in allowlist-only mode', () => {
      const secManager = new GroupSecurityManager({
        enabled: true,
        defaultMode: 'mention-only',
        globalAllowlist: ['user-42'],
      });

      secManager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'allowlist-only',
        allowedUsers: [],
      });

      const message = makeGroupMessage({
        sender: { id: 'user-42', username: 'alice' },
      });
      const result = secManager.shouldProcess(message);

      expect(result.allowed).toBe(true);

      secManager.dispose();
    });

    it('should use default mode for unconfigured groups', () => {
      // Default mode is 'mention-only'
      const message = makeGroupMessage({ content: 'No mention here' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('no mention detected');
    });
  });

  // =========================================================================
  // Blocklist
  // =========================================================================

  describe('blocklist', () => {
    it('should block users on the global blocklist', () => {
      manager.addToBlocklist('user-42');

      const message = makeGroupMessage({ content: '@buddy help' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user is on global blocklist');
    });

    it('should block users even in active mode groups', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });
      manager.addToBlocklist('user-42');

      const message = makeGroupMessage({ content: 'Hello' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user is on global blocklist');
    });

    it('should allow previously blocked users after removal', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });

      manager.addToBlocklist('user-42');
      manager.removeFromBlocklist('user-42');

      const message = makeGroupMessage({ content: 'Hello' });
      const result = manager.shouldProcess(message);

      expect(result.allowed).toBe(true);
    });

    it('should return false when removing a user not on the blocklist', () => {
      const result = manager.removeFromBlocklist('nonexistent');
      expect(result).toBe(false);
    });

    it('should not add duplicate entries to the blocklist', () => {
      manager.addToBlocklist('user-42');
      manager.addToBlocklist('user-42');

      // Remove once should clear them
      manager.removeFromBlocklist('user-42');

      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });

      const message = makeGroupMessage({ content: 'Hello' });
      const result = manager.shouldProcess(message);
      expect(result.allowed).toBe(true);
    });
  });

  // =========================================================================
  // Allowlist Management
  // =========================================================================

  describe('allowlist management', () => {
    it('should add a user to a group allowlist', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'allowlist-only',
        allowedUsers: [],
      });

      const added = manager.addToAllowlist('group-123', 'user-42');
      expect(added).toBe(true);

      const message = makeGroupMessage({
        sender: { id: 'user-42', username: 'alice' },
      });
      const result = manager.shouldProcess(message);
      expect(result.allowed).toBe(true);
    });

    it('should remove a user from a group allowlist', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'allowlist-only',
        allowedUsers: ['user-42'],
      });

      const removed = manager.removeFromAllowlist('group-123', 'user-42');
      expect(removed).toBe(true);

      const message = makeGroupMessage({
        sender: { id: 'user-42', username: 'alice' },
      });
      const result = manager.shouldProcess(message);
      expect(result.allowed).toBe(false);
    });

    it('should return false when adding to a non-existent group', () => {
      const result = manager.addToAllowlist('nonexistent', 'user-42');
      expect(result).toBe(false);
    });

    it('should return false when removing from a non-existent group', () => {
      const result = manager.removeFromAllowlist('nonexistent', 'user-42');
      expect(result).toBe(false);
    });

    it('should return false when removing a user not on the allowlist', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'allowlist-only',
        allowedUsers: ['user-1'],
      });

      const result = manager.removeFromAllowlist('group-123', 'user-99');
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // Rate Limiting
  // =========================================================================

  describe('rate limiting', () => {
    it('should enforce maxMessagesPerMinute', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
        maxMessagesPerMinute: 3,
      });

      // First 3 messages should pass
      for (let i = 0; i < 3; i++) {
        const message = makeGroupMessage({ id: `msg-${i}` });
        const result = manager.shouldProcess(message);
        expect(result.allowed).toBe(true);
      }

      // 4th message should be rate limited
      const message = makeGroupMessage({ id: 'msg-4' });
      const result = manager.shouldProcess(message);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rate limit exceeded');
    });

    it('should enforce cooldown between messages', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
        cooldownMs: 5000,
      });

      // First message should pass
      const msg1 = makeGroupMessage({ id: 'msg-1' });
      const result1 = manager.shouldProcess(msg1);
      expect(result1.allowed).toBe(true);

      // Immediate second message should be rate limited (cooldown active)
      const msg2 = makeGroupMessage({ id: 'msg-2' });
      const result2 = manager.shouldProcess(msg2);
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain('cooldown active');
    });

    it('should not rate limit groups without rate limit config', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });

      // Many messages should all pass
      for (let i = 0; i < 20; i++) {
        const message = makeGroupMessage({ id: `msg-${i}` });
        const result = manager.shouldProcess(message);
        expect(result.allowed).toBe(true);
      }
    });

    it('should emit message:rate-limited event', () => {
      const events: unknown[] = [];
      manager.on('message:rate-limited', (msg, reason) => events.push({ msg, reason }));

      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
        maxMessagesPerMinute: 1,
      });

      // First message passes
      manager.shouldProcess(makeGroupMessage({ id: 'msg-1' }));

      // Second triggers rate limit event
      manager.shouldProcess(makeGroupMessage({ id: 'msg-2' }));

      expect(events.length).toBe(1);
    });
  });

  // =========================================================================
  // Events
  // =========================================================================

  describe('events', () => {
    it('should emit message:allowed when a message passes', () => {
      const events: unknown[] = [];
      manager.on('message:allowed', (msg) => events.push(msg));

      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });

      manager.shouldProcess(makeGroupMessage());

      expect(events.length).toBe(1);
    });

    it('should emit message:blocked when a message is denied', () => {
      const events: Array<{ msg: unknown; reason: string }> = [];
      manager.on('message:blocked', (msg, reason) => events.push({ msg, reason }));

      // No group config, default is mention-only, no mention in content
      manager.shouldProcess(makeGroupMessage({ content: 'no mention here' }));

      expect(events.length).toBe(1);
      expect(events[0].reason).toBe('no mention detected');
    });

    it('should emit message:blocked for blocklisted users', () => {
      const events: Array<{ msg: unknown; reason: string }> = [];
      manager.on('message:blocked', (msg, reason) => events.push({ msg, reason }));

      manager.addToBlocklist('user-42');
      manager.shouldProcess(makeGroupMessage());

      expect(events.length).toBe(1);
      expect(events[0].reason).toBe('user is on global blocklist');
    });
  });

  // =========================================================================
  // Group Management
  // =========================================================================

  describe('group management', () => {
    it('should add and retrieve a group config', () => {
      const config: GroupConfig = {
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      };
      manager.addGroup(config);

      const retrieved = manager.getGroupConfig('group-123');
      expect(retrieved).toBeDefined();
      expect(retrieved!.activationMode).toBe('active');
    });

    it('should return undefined for non-existent group', () => {
      const result = manager.getGroupConfig('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should list all groups', () => {
      manager.addGroup({
        groupId: 'group-1',
        channelType: 'telegram',
        activationMode: 'active',
      });
      manager.addGroup({
        groupId: 'group-2',
        channelType: 'discord',
        activationMode: 'inactive',
      });

      const groups = manager.listGroups();
      expect(groups.length).toBe(2);
    });

    it('should remove a group', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });

      const removed = manager.removeGroup('group-123');
      expect(removed).toBe(true);
      expect(manager.getGroupConfig('group-123')).toBeUndefined();
    });

    it('should return false when removing a non-existent group', () => {
      const result = manager.removeGroup('nonexistent');
      expect(result).toBe(false);
    });

    it('should update a group config', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });

      const updated = manager.updateGroup('group-123', { activationMode: 'inactive' });
      expect(updated).toBe(true);

      const config = manager.getGroupConfig('group-123');
      expect(config!.activationMode).toBe('inactive');
    });

    it('should return false when updating a non-existent group', () => {
      const result = manager.updateGroup('nonexistent', { activationMode: 'active' });
      expect(result).toBe(false);
    });

    it('should return a copy from getGroupConfig (not a reference)', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });

      const config = manager.getGroupConfig('group-123');
      config!.activationMode = 'inactive';

      // Original should be unchanged
      const original = manager.getGroupConfig('group-123');
      expect(original!.activationMode).toBe('active');
    });
  });

  // =========================================================================
  // Statistics
  // =========================================================================

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      manager.addGroup({
        groupId: 'group-1',
        channelType: 'telegram',
        activationMode: 'active',
      });
      manager.addGroup({
        groupId: 'group-2',
        channelType: 'discord',
        activationMode: 'mention-only',
      });
      manager.addGroup({
        groupId: 'group-3',
        channelType: 'slack',
        activationMode: 'active',
      });
      manager.addToBlocklist('bad-user');

      const stats = manager.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.totalGroups).toBe(3);
      expect(stats.defaultMode).toBe('mention-only');
      expect(stats.blocklistSize).toBe(1);
      expect(stats.groupsByMode['active']).toBe(2);
      expect(stats.groupsByMode['mention-only']).toBe(1);
    });
  });

  // =========================================================================
  // Dispose
  // =========================================================================

  describe('dispose', () => {
    it('should clear all internal state', () => {
      manager.addGroup({
        groupId: 'group-123',
        channelType: 'telegram',
        activationMode: 'active',
      });
      manager.addToBlocklist('user-42');

      manager.dispose();

      expect(manager.listGroups().length).toBe(0);
      expect(manager.getStats().blocklistSize).toBe(0);
    });
  });
});

// ===========================================================================
// Singleton
// ===========================================================================

describe('getGroupSecurity / resetGroupSecurity', () => {
  afterEach(() => {
    resetGroupSecurity();
  });

  it('should return the same instance', () => {
    const a = getGroupSecurity();
    const b = getGroupSecurity();
    expect(a).toBe(b);
  });

  it('should return a new instance after reset', () => {
    const a = getGroupSecurity();
    resetGroupSecurity();
    const b = getGroupSecurity();
    expect(a).not.toBe(b);
  });
});
