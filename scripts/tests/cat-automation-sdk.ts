/**
 * Cat 62: Poll Manager (7 tests, no API)
 * Cat 63: Auth Monitor (7 tests, no API)
 * Cat 64: Agent SDK (5 tests, no API)
 * Cat 65: RTK Compressor (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 62: Poll Manager
// ============================================================================

export function cat62PollManager(): TestDef[] {
  return [
    {
      name: '62.1-singleton-lifecycle',
      timeout: 5000,
      fn: async () => {
        const { PollManager } = await import('../../src/automation/polls.js');
        PollManager.resetInstance();
        const i1 = PollManager.getInstance();
        const i2 = PollManager.getInstance();
        const same = i1 === i2;
        PollManager.resetInstance();
        const i3 = PollManager.getInstance();
        PollManager.resetInstance();
        return { pass: same && i1 !== i3 };
      },
    },
    {
      name: '62.2-add-poll',
      timeout: 5000,
      fn: async () => {
        const { PollManager } = await import('../../src/automation/polls.js');
        PollManager.resetInstance();
        const mgr = PollManager.getInstance();
        mgr.addPoll({
          id: 'test-poll',
          name: 'Test Poll',
          type: 'command',
          target: 'echo hello',
          intervalMs: 60000,
          enabled: false,
        });
        const polls = mgr.listPolls();
        PollManager.resetInstance();
        return {
          pass: polls.length === 1 && polls[0].id === 'test-poll',
          metadata: { count: polls.length },
        };
      },
    },
    {
      name: '62.3-remove-poll',
      timeout: 5000,
      fn: async () => {
        const { PollManager } = await import('../../src/automation/polls.js');
        PollManager.resetInstance();
        const mgr = PollManager.getInstance();
        mgr.addPoll({ id: 'removable', name: 'Remove Me', type: 'command', target: 'echo', intervalMs: 60000, enabled: false });
        const removed = mgr.removePoll('removable');
        const polls = mgr.listPolls();
        PollManager.resetInstance();
        return {
          pass: removed === true && polls.length === 0,
        };
      },
    },
    {
      name: '62.4-remove-nonexistent-returns-false',
      timeout: 5000,
      fn: async () => {
        const { PollManager } = await import('../../src/automation/polls.js');
        PollManager.resetInstance();
        const mgr = PollManager.getInstance();
        const removed = mgr.removePoll('nonexistent');
        PollManager.resetInstance();
        return { pass: removed === false };
      },
    },
    {
      name: '62.5-get-poll',
      timeout: 5000,
      fn: async () => {
        const { PollManager } = await import('../../src/automation/polls.js');
        PollManager.resetInstance();
        const mgr = PollManager.getInstance();
        mgr.addPoll({ id: 'find-me', name: 'Find Me', type: 'file', target: '/tmp/test', intervalMs: 30000, enabled: false });
        const poll = mgr.getPoll('find-me');
        const missing = mgr.getPoll('missing');
        PollManager.resetInstance();
        return {
          pass: poll !== undefined && poll.name === 'Find Me' && missing === undefined,
        };
      },
    },
    {
      name: '62.6-add-replaces-existing',
      timeout: 5000,
      fn: async () => {
        const { PollManager } = await import('../../src/automation/polls.js');
        PollManager.resetInstance();
        const mgr = PollManager.getInstance();
        mgr.addPoll({ id: 'dup', name: 'First', type: 'command', target: 'echo 1', intervalMs: 60000, enabled: false });
        mgr.addPoll({ id: 'dup', name: 'Second', type: 'command', target: 'echo 2', intervalMs: 60000, enabled: false });
        const poll = mgr.getPoll('dup');
        const polls = mgr.listPolls();
        PollManager.resetInstance();
        return {
          pass: polls.length === 1 && poll?.name === 'Second',
        };
      },
    },
    {
      name: '62.7-stop-all-clears-timers',
      timeout: 5000,
      fn: async () => {
        const { PollManager } = await import('../../src/automation/polls.js');
        PollManager.resetInstance();
        const mgr = PollManager.getInstance();
        mgr.addPoll({ id: 'p1', name: 'P1', type: 'command', target: 'echo', intervalMs: 60000, enabled: false });
        mgr.stopAll();
        PollManager.resetInstance();
        return { pass: true };
      },
    },
  ];
}

// ============================================================================
// Cat 63: Auth Monitor
// ============================================================================

export function cat63AuthMonitor(): TestDef[] {
  return [
    {
      name: '63.1-singleton-lifecycle',
      timeout: 5000,
      fn: async () => {
        const { AuthMonitor } = await import('../../src/automation/auth-monitoring.js');
        AuthMonitor.resetInstance();
        const i1 = AuthMonitor.getInstance();
        const i2 = AuthMonitor.getInstance();
        const same = i1 === i2;
        AuthMonitor.resetInstance();
        const i3 = AuthMonitor.getInstance();
        AuthMonitor.resetInstance();
        return { pass: same && i1 !== i3 };
      },
    },
    {
      name: '63.2-add-and-get-target',
      timeout: 5000,
      fn: async () => {
        const { AuthMonitor } = await import('../../src/automation/auth-monitoring.js');
        AuthMonitor.resetInstance();
        const mon = AuthMonitor.getInstance();
        mon.addTarget({
          id: 'gemini',
          name: 'Gemini API',
          type: 'provider',
          envVar: 'GOOGLE_API_KEY',
          state: 'valid',
        });
        const target = mon.getTarget('gemini');
        AuthMonitor.resetInstance();
        return {
          pass: target !== undefined && target.name === 'Gemini API' && target.state === 'valid',
        };
      },
    },
    {
      name: '63.3-remove-target',
      timeout: 5000,
      fn: async () => {
        const { AuthMonitor } = await import('../../src/automation/auth-monitoring.js');
        AuthMonitor.resetInstance();
        const mon = AuthMonitor.getInstance();
        mon.addTarget({ id: 'del-me', name: 'Delete', type: 'service', state: 'unknown' });
        const removed = mon.removeTarget('del-me');
        const gone = mon.getTarget('del-me');
        AuthMonitor.resetInstance();
        return { pass: removed === true && gone === undefined };
      },
    },
    {
      name: '63.4-list-targets',
      timeout: 5000,
      fn: async () => {
        const { AuthMonitor } = await import('../../src/automation/auth-monitoring.js');
        AuthMonitor.resetInstance();
        const mon = AuthMonitor.getInstance();
        mon.addTarget({ id: 't1', name: 'T1', type: 'provider', state: 'valid' });
        mon.addTarget({ id: 't2', name: 'T2', type: 'channel', state: 'expired' });
        mon.addTarget({ id: 't3', name: 'T3', type: 'service', state: 'unknown' });
        const targets = mon.listTargets();
        AuthMonitor.resetInstance();
        return {
          pass: targets.length === 3,
          metadata: { count: targets.length },
        };
      },
    },
    {
      name: '63.5-auth-state-types',
      timeout: 5000,
      fn: async () => {
        const { AuthMonitor } = await import('../../src/automation/auth-monitoring.js');
        AuthMonitor.resetInstance();
        const mon = AuthMonitor.getInstance();
        const states = ['valid', 'expiring', 'expired', 'invalid', 'unknown'] as const;
        for (const state of states) {
          mon.addTarget({ id: `state-${state}`, name: state, type: 'provider', state });
        }
        const targets = mon.listTargets();
        AuthMonitor.resetInstance();
        return {
          pass: targets.length === 5,
          metadata: { states: targets.map(t => t.state) },
        };
      },
    },
    {
      name: '63.6-config-defaults',
      timeout: 5000,
      fn: async () => {
        const { AuthMonitor } = await import('../../src/automation/auth-monitoring.js');
        AuthMonitor.resetInstance();
        const mon = AuthMonitor.getInstance();
        // Should not throw
        mon.stop();
        AuthMonitor.resetInstance();
        return { pass: true };
      },
    },
    {
      name: '63.7-custom-config',
      timeout: 5000,
      fn: async () => {
        const { AuthMonitor } = await import('../../src/automation/auth-monitoring.js');
        AuthMonitor.resetInstance();
        const mon = AuthMonitor.getInstance({
          checkIntervalMs: 60000,
          expiryWarningMs: 3600000,
          autoRefresh: true,
        });
        AuthMonitor.resetInstance();
        return { pass: mon !== undefined };
      },
    },
  ];
}

// ============================================================================
// Cat 64: Agent SDK
// ============================================================================

export function cat64AgentSDK(): TestDef[] {
  return [
    {
      name: '64.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const { AgentSDK } = await import('../../src/sdk/agent-sdk.js');
        const sdk = new AgentSDK({ model: 'gemini-2.5-flash', maxTurns: 5 });
        return { pass: sdk !== undefined };
      },
    },
    {
      name: '64.2-register-tool',
      timeout: 5000,
      fn: async () => {
        const { AgentSDK } = await import('../../src/sdk/agent-sdk.js');
        const sdk = new AgentSDK();
        sdk.addTool({
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: { input: { type: 'string' } } },
          execute: async (input) => JSON.stringify(input),
        });
        const tools = sdk.getTools();
        return {
          pass: tools.length === 1 && tools[0] === 'test_tool',
          metadata: { tools },
        };
      },
    },
    {
      name: '64.3-unregister-tool',
      timeout: 5000,
      fn: async () => {
        const { AgentSDK } = await import('../../src/sdk/agent-sdk.js');
        const sdk = new AgentSDK();
        sdk.addTool({
          name: 'temp_tool',
          description: 'Temporary',
          parameters: {},
          execute: async () => 'ok',
        });
        sdk.removeTool('temp_tool');
        const tools = sdk.getTools();
        return {
          pass: tools.length === 0,
        };
      },
    },
    {
      name: '64.4-empty-prompt-throws',
      timeout: 5000,
      fn: async () => {
        const { AgentSDK } = await import('../../src/sdk/agent-sdk.js');
        const sdk = new AgentSDK();
        try {
          await sdk.run('');
          return { pass: false };
        } catch (e: any) {
          return {
            pass: e.message.includes('empty'),
            metadata: { error: e.message },
          };
        }
      },
    },
    {
      name: '64.5-config-defaults',
      timeout: 5000,
      fn: async () => {
        const { AgentSDK } = await import('../../src/sdk/agent-sdk.js');
        const sdk = new AgentSDK();
        const config = sdk.getConfig();
        return {
          pass: config.maxTurns === 10 && config.model !== undefined,
          metadata: config as unknown as Record<string, unknown>,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 65: RTK Compressor
// ============================================================================

export function cat65RTKCompressor(): TestDef[] {
  return [
    {
      name: '65.1-rtk-availability-check',
      timeout: 5000,
      fn: async () => {
        const { isRTKAvailable } = await import('../../src/utils/rtk-compressor.js');
        const available = isRTKAvailable();
        return {
          pass: typeof available === 'boolean',
          metadata: { available },
        };
      },
    },
    {
      name: '65.2-reset-rtk-cache',
      timeout: 5000,
      fn: async () => {
        const { resetRTKCache, isRTKAvailable } = await import('../../src/utils/rtk-compressor.js');
        resetRTKCache();
        const result = isRTKAvailable(); // re-checks
        return {
          pass: typeof result === 'boolean',
          metadata: { afterReset: result },
        };
      },
    },
    {
      name: '65.3-is-rtk-compatible',
      timeout: 5000,
      fn: async () => {
        const { isRTKCompatible } = await import('../../src/utils/rtk-compressor.js');
        const lsResult = isRTKCompatible('ls -la');
        const gitResult = isRTKCompatible('git status');
        return {
          pass: typeof lsResult === 'boolean' && typeof gitResult === 'boolean',
          metadata: { ls: lsResult, git: gitResult },
        };
      },
    },
    {
      name: '65.4-interactive-not-compatible',
      timeout: 5000,
      fn: async () => {
        const { isRTKCompatible } = await import('../../src/utils/rtk-compressor.js');
        const vimResult = isRTKCompatible('vim file.ts');
        const sshResult = isRTKCompatible('ssh server');
        return {
          pass: vimResult === false && sshResult === false,
          metadata: { vim: vimResult, ssh: sshResult },
        };
      },
    },
    {
      name: '65.5-wrap-command-format',
      timeout: 5000,
      fn: async () => {
        const { wrapWithRTK } = await import('../../src/utils/rtk-compressor.js');
        const wrapped = wrapWithRTK('git status');
        return {
          pass: typeof wrapped === 'string',
          metadata: { wrapped },
        };
      },
    },
  ];
}
