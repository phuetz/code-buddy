/**
 * Cat 86: Send Policy Engine (7 tests, no API)
 * Cat 87: DM Pairing Manager (7 tests, no API)
 * Cat 88: Reconnection Manager (6 tests, no API)
 * Cat 89: Offline Queue (6 tests, no API)
 * Cat 90: Plugin Manifest Manager (6 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 86: Send Policy Engine
// ============================================================================

export function cat86SendPolicyEngine(): TestDef[] {
  return [
    {
      name: '86.1-singleton-access',
      timeout: 5000,
      fn: async () => {
        const { SendPolicyEngine } = await import('../../src/channels/send-policy.js');
        SendPolicyEngine.resetInstance();
        const e1 = SendPolicyEngine.getInstance();
        const e2 = SendPolicyEngine.getInstance();
        SendPolicyEngine.resetInstance();
        return { pass: e1 === e2 };
      },
    },
    {
      name: '86.2-default-allows',
      timeout: 5000,
      fn: async () => {
        const { SendPolicyEngine } = await import('../../src/channels/send-policy.js');
        SendPolicyEngine.resetInstance();
        const engine = SendPolicyEngine.getInstance();
        const result = engine.evaluate({ sessionKey: 'test-session' });
        SendPolicyEngine.resetInstance();
        return {
          pass: result.allowed === true,
          metadata: { reason: result.reason },
        };
      },
    },
    {
      name: '86.3-add-deny-rule',
      timeout: 5000,
      fn: async () => {
        const { SendPolicyEngine } = await import('../../src/channels/send-policy.js');
        SendPolicyEngine.resetInstance();
        const engine = SendPolicyEngine.getInstance();
        engine.addRule({ action: 'deny', match: { channel: 'discord' }, reason: 'blocked' });
        const rules = engine.getRules();
        SendPolicyEngine.resetInstance();
        return {
          pass: rules.length >= 1,
          metadata: { ruleCount: rules.length },
        };
      },
    },
    {
      name: '86.4-set-override',
      timeout: 5000,
      fn: async () => {
        const { SendPolicyEngine } = await import('../../src/channels/send-policy.js');
        SendPolicyEngine.resetInstance();
        const engine = SendPolicyEngine.getInstance();
        engine.setOverride('sess-1', 'off');
        const override = engine.getOverride('sess-1');
        SendPolicyEngine.resetInstance();
        return {
          pass: override === 'off',
          metadata: { override },
        };
      },
    },
    {
      name: '86.5-clear-overrides',
      timeout: 5000,
      fn: async () => {
        const { SendPolicyEngine } = await import('../../src/channels/send-policy.js');
        SendPolicyEngine.resetInstance();
        const engine = SendPolicyEngine.getInstance();
        engine.setOverride('sess-2', 'on');
        engine.clearOverrides();
        const override = engine.getOverride('sess-2');
        SendPolicyEngine.resetInstance();
        return {
          pass: override === 'inherit',
        };
      },
    },
    {
      name: '86.6-remove-rule',
      timeout: 5000,
      fn: async () => {
        const { SendPolicyEngine } = await import('../../src/channels/send-policy.js');
        SendPolicyEngine.resetInstance();
        const engine = SendPolicyEngine.getInstance();
        engine.addRule({ action: 'deny', match: { channel: 'test' } });
        const before = engine.getRules().length;
        const removed = engine.removeRule(0);
        const after = engine.getRules().length;
        SendPolicyEngine.resetInstance();
        return {
          pass: removed === true && after === before - 1,
        };
      },
    },
    {
      name: '86.7-get-config',
      timeout: 5000,
      fn: async () => {
        const { SendPolicyEngine } = await import('../../src/channels/send-policy.js');
        SendPolicyEngine.resetInstance();
        const engine = SendPolicyEngine.getInstance();
        const config = engine.getConfig();
        SendPolicyEngine.resetInstance();
        return {
          pass: config !== undefined && 'rules' in config && 'default' in config,
          metadata: { keys: Object.keys(config) },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 87: DM Pairing Manager
// ============================================================================

export function cat87DMPairing(): TestDef[] {
  return [
    {
      name: '87.1-singleton-access',
      timeout: 5000,
      fn: async () => {
        const { getDMPairing, resetDMPairing } = await import('../../src/channels/dm-pairing.js');
        resetDMPairing();
        const p1 = getDMPairing();
        const p2 = getDMPairing();
        const same = p1 === p2;
        resetDMPairing();
        return { pass: same };
      },
    },
    {
      name: '87.2-approve-directly',
      timeout: 5000,
      fn: async () => {
        const { getDMPairing, resetDMPairing } = await import('../../src/channels/dm-pairing.js');
        resetDMPairing();
        const mgr = getDMPairing({ enabled: true });
        const approved = mgr.approveDirectly('telegram', 'user123', 'admin', 'TestUser');
        resetDMPairing();
        return {
          pass: approved !== null && approved.senderId === 'user123',
          metadata: { approved: approved ? { senderId: approved.senderId } : null },
        };
      },
    },
    {
      name: '87.3-is-approved-check',
      timeout: 5000,
      fn: async () => {
        const { getDMPairing, resetDMPairing } = await import('../../src/channels/dm-pairing.js');
        resetDMPairing();
        const mgr = getDMPairing({ enabled: true });
        mgr.approveDirectly('discord', 'user456', 'admin');
        const isApproved = mgr.isApproved('discord', 'user456');
        const notApproved = mgr.isApproved('discord', 'unknown');
        resetDMPairing();
        return {
          pass: isApproved === true && notApproved === false,
        };
      },
    },
    {
      name: '87.4-revoke-approval',
      timeout: 5000,
      fn: async () => {
        const { getDMPairing, resetDMPairing } = await import('../../src/channels/dm-pairing.js');
        resetDMPairing();
        const mgr = getDMPairing({ enabled: true });
        mgr.approveDirectly('slack', 'user789', 'admin');
        const revoked = mgr.revoke('slack', 'user789');
        const isApproved = mgr.isApproved('slack', 'user789');
        resetDMPairing();
        return {
          pass: revoked === true && isApproved === false,
        };
      },
    },
    {
      name: '87.5-list-approved',
      timeout: 5000,
      fn: async () => {
        const { getDMPairing, resetDMPairing } = await import('../../src/channels/dm-pairing.js');
        resetDMPairing();
        const mgr = getDMPairing({ enabled: true });
        mgr.approveDirectly('telegram', 'a1', 'admin');
        mgr.approveDirectly('discord', 'a2', 'admin');
        const all = mgr.listApproved();
        resetDMPairing();
        return {
          pass: all.length === 2,
          metadata: { count: all.length },
        };
      },
    },
    {
      name: '87.6-list-pending-empty',
      timeout: 5000,
      fn: async () => {
        const { getDMPairing, resetDMPairing } = await import('../../src/channels/dm-pairing.js');
        resetDMPairing();
        const mgr = getDMPairing({ enabled: true });
        const pending = mgr.listPending();
        resetDMPairing();
        return {
          pass: pending.length === 0,
        };
      },
    },
    {
      name: '87.7-get-stats',
      timeout: 5000,
      fn: async () => {
        const { getDMPairing, resetDMPairing } = await import('../../src/channels/dm-pairing.js');
        resetDMPairing();
        const mgr = getDMPairing({ enabled: true });
        mgr.approveDirectly('telegram', 's1', 'admin');
        const stats = mgr.getStats();
        resetDMPairing();
        return {
          pass: stats.enabled === true && stats.totalApproved === 1 && stats.totalPending === 0,
          metadata: { stats },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 88: Reconnection Manager
// ============================================================================

export function cat88ReconnectionManager(): TestDef[] {
  return [
    {
      name: '88.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const { ReconnectionManager } = await import('../../src/channels/reconnection-manager.js');
        const mgr = new ReconnectionManager('test-channel');
        return { pass: mgr.getName() === 'test-channel' };
      },
    },
    {
      name: '88.2-not-exhausted-initially',
      timeout: 5000,
      fn: async () => {
        const { ReconnectionManager } = await import('../../src/channels/reconnection-manager.js');
        const mgr = new ReconnectionManager('chan', { maxRetries: 5 });
        return {
          pass: mgr.isExhausted() === false && mgr.getRetryCount() === 0,
        };
      },
    },
    {
      name: '88.3-on-connected-resets',
      timeout: 5000,
      fn: async () => {
        const { ReconnectionManager } = await import('../../src/channels/reconnection-manager.js');
        const mgr = new ReconnectionManager('chan', { maxRetries: 5, initialDelayMs: 10 });
        // Simulate a reconnect attempt then connect
        mgr.scheduleReconnect(async () => {});
        mgr.onConnected();
        return {
          pass: mgr.getRetryCount() === 0 && mgr.isExhausted() === false,
        };
      },
    },
    {
      name: '88.4-cancel-stops-reconnect',
      timeout: 5000,
      fn: async () => {
        const { ReconnectionManager } = await import('../../src/channels/reconnection-manager.js');
        const mgr = new ReconnectionManager('chan', { maxRetries: 3, initialDelayMs: 50 });
        mgr.scheduleReconnect(async () => {});
        mgr.cancel();
        return {
          pass: mgr.isPending() === false,
        };
      },
    },
    {
      name: '88.5-get-current-delay',
      timeout: 5000,
      fn: async () => {
        const { ReconnectionManager } = await import('../../src/channels/reconnection-manager.js');
        const mgr = new ReconnectionManager('chan', { initialDelayMs: 100 });
        const delay = mgr.getCurrentDelay();
        return {
          pass: delay >= 100,
          metadata: { delay },
        };
      },
    },
    {
      name: '88.6-get-config',
      timeout: 5000,
      fn: async () => {
        const { ReconnectionManager } = await import('../../src/channels/reconnection-manager.js');
        const mgr = new ReconnectionManager('chan', { maxRetries: 7, initialDelayMs: 200, backoffMultiplier: 2 });
        const config = mgr.getConfig();
        return {
          pass: config.maxRetries === 7 && config.initialDelayMs === 200 && config.backoffMultiplier === 2,
          metadata: { config: config as unknown as Record<string, unknown> },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 89: Offline Queue
// ============================================================================

export function cat89OfflineQueue(): TestDef[] {
  return [
    {
      name: '89.1-empty-queue',
      timeout: 5000,
      fn: async () => {
        const { OfflineQueue } = await import('../../src/channels/offline-queue.js');
        const q = new OfflineQueue(10);
        return {
          pass: q.isEmpty() === true && q.size() === 0 && q.getMaxSize() === 10,
        };
      },
    },
    {
      name: '89.2-enqueue-and-size',
      timeout: 5000,
      fn: async () => {
        const { OfflineQueue } = await import('../../src/channels/offline-queue.js');
        const q = new OfflineQueue(10);
        q.enqueue({ channelId: 'ch1', content: 'hello' });
        q.enqueue({ channelId: 'ch2', content: 'world' });
        return {
          pass: q.size() === 2 && q.isEmpty() === false,
        };
      },
    },
    {
      name: '89.3-drain-returns-all',
      timeout: 5000,
      fn: async () => {
        const { OfflineQueue } = await import('../../src/channels/offline-queue.js');
        const q = new OfflineQueue(10);
        q.enqueue({ channelId: 'ch1', content: 'msg1' });
        q.enqueue({ channelId: 'ch2', content: 'msg2' });
        const drained = q.drain();
        return {
          pass: drained.length === 2 && q.isEmpty() === true,
          metadata: { drainedCount: drained.length },
        };
      },
    },
    {
      name: '89.4-peek-does-not-remove',
      timeout: 5000,
      fn: async () => {
        const { OfflineQueue } = await import('../../src/channels/offline-queue.js');
        const q = new OfflineQueue(10);
        q.enqueue({ channelId: 'ch1', content: 'peek-msg' });
        const peeked = q.peek();
        return {
          pass: peeked !== undefined && peeked.content === 'peek-msg' && q.size() === 1,
        };
      },
    },
    {
      name: '89.5-max-size-enforced',
      timeout: 5000,
      fn: async () => {
        const { OfflineQueue } = await import('../../src/channels/offline-queue.js');
        const q = new OfflineQueue(3);
        q.enqueue({ channelId: 'c1', content: 'm1' });
        q.enqueue({ channelId: 'c2', content: 'm2' });
        q.enqueue({ channelId: 'c3', content: 'm3' });
        const added = q.enqueue({ channelId: 'c4', content: 'm4' });
        return {
          pass: added === false && q.isFull() === true && q.size() === 3,
        };
      },
    },
    {
      name: '89.6-clear-empties',
      timeout: 5000,
      fn: async () => {
        const { OfflineQueue } = await import('../../src/channels/offline-queue.js');
        const q = new OfflineQueue(10);
        q.enqueue({ channelId: 'c1', content: 'x' });
        q.enqueue({ channelId: 'c2', content: 'y' });
        q.clear();
        return {
          pass: q.isEmpty() === true && q.size() === 0,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 90: Plugin Manifest Manager
// ============================================================================

export function cat90PluginManifest(): TestDef[] {
  return [
    {
      name: '90.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const { PluginManifestManager } = await import('../../src/plugins/plugin-manifest.js');
        const mgr = new PluginManifestManager([]);
        return { pass: mgr !== undefined };
      },
    },
    {
      name: '90.2-list-plugins-empty',
      timeout: 5000,
      fn: async () => {
        const { PluginManifestManager } = await import('../../src/plugins/plugin-manifest.js');
        const mgr = new PluginManifestManager([]);
        const plugins = mgr.listPlugins();
        return {
          pass: plugins.length === 0,
        };
      },
    },
    {
      name: '90.3-get-nonexistent-plugin',
      timeout: 5000,
      fn: async () => {
        const { PluginManifestManager } = await import('../../src/plugins/plugin-manifest.js');
        const mgr = new PluginManifestManager([]);
        const plugin = mgr.getPlugin('nonexistent');
        return { pass: plugin === null };
      },
    },
    {
      name: '90.4-validate-manifest-valid',
      timeout: 5000,
      fn: async () => {
        const { PluginManifestManager } = await import('../../src/plugins/plugin-manifest.js');
        const mgr = new PluginManifestManager([]);
        const result = mgr.validateManifest({
          name: 'test-plugin',
          version: '1.0.0',
          components: {},
        });
        return {
          pass: result.valid === true && result.errors.length === 0,
        };
      },
    },
    {
      name: '90.5-validate-manifest-invalid',
      timeout: 5000,
      fn: async () => {
        const { PluginManifestManager } = await import('../../src/plugins/plugin-manifest.js');
        const mgr = new PluginManifestManager([]);
        const result = mgr.validateManifest({} as any);
        return {
          pass: result.valid === false && result.errors.length > 0,
          metadata: { errors: result.errors },
        };
      },
    },
    {
      name: '90.6-plugin-count-and-enabled',
      timeout: 5000,
      fn: async () => {
        const { PluginManifestManager } = await import('../../src/plugins/plugin-manifest.js');
        const mgr = new PluginManifestManager([]);
        return {
          pass: mgr.getPluginCount() === 0 && mgr.getEnabledCount() === 0,
        };
      },
    },
  ];
}
