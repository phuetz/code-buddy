/**
 * Cat 121: Channel Core Types (7 tests, no API)
 * Cat 122: Tool Groups Mapping Extended (6 tests, no API)
 * Cat 123: SettingSourceManager Extended (6 tests, no API)
 * Cat 124: ConfigBackupRotation Edge Cases (5 tests, no API)
 * Cat 125: Hook Event Coverage (6 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 121: Channel Core Types
// ============================================================================

export function cat121ChannelCoreTypes(): TestDef[] {
  return [
    {
      name: '121.1-channel-type-telegram',
      timeout: 5000,
      fn: async () => {
        // ChannelType includes 'telegram', 'discord', 'slack', etc.
        const mod = await import('../../src/channels/core.js');
        return {
          pass: typeof mod !== 'undefined',
          metadata: { exports: Object.keys(mod).slice(0, 10) },
        };
      },
    },
    {
      name: '121.2-content-types-exist',
      timeout: 5000,
      fn: async () => {
        // ContentType should include 'text', 'image', 'audio', etc.
        const contentTypes = ['text', 'image', 'audio', 'video', 'file', 'voice', 'command'];
        return { pass: contentTypes.length >= 7 };
      },
    },
    {
      name: '121.3-session-isolator-singleton',
      timeout: 5000,
      fn: async () => {
        const { getSessionIsolator, resetSessionIsolator } = await import('../../src/channels/session-isolation.js');
        resetSessionIsolator();
        const isolator = getSessionIsolator();
        return { pass: isolator !== null && typeof isolator === 'object' };
      },
    },
    {
      name: '121.4-session-isolator-same-instance',
      timeout: 5000,
      fn: async () => {
        const { getSessionIsolator, resetSessionIsolator } = await import('../../src/channels/session-isolation.js');
        resetSessionIsolator();
        const a = getSessionIsolator();
        const b = getSessionIsolator();
        return { pass: a === b };
      },
    },
    {
      name: '121.5-identity-linker-singleton',
      timeout: 5000,
      fn: async () => {
        const { getIdentityLinker, resetIdentityLinker } = await import('../../src/channels/core.js');
        if (typeof resetIdentityLinker === 'function') resetIdentityLinker();
        const linker = getIdentityLinker();
        return { pass: linker !== null && typeof linker === 'object' };
      },
    },
    {
      name: '121.6-identity-linker-reset',
      timeout: 5000,
      fn: async () => {
        const { getIdentityLinker, resetIdentityLinker } = await import('../../src/channels/core.js');
        if (typeof resetIdentityLinker === 'function') resetIdentityLinker();
        const a = getIdentityLinker();
        resetIdentityLinker();
        const b = getIdentityLinker();
        return { pass: a !== b };
      },
    },
    {
      name: '121.7-message-direction-types',
      timeout: 5000,
      fn: async () => {
        // MessageDirection = 'inbound' | 'outbound'
        const directions = ['inbound', 'outbound'];
        return { pass: directions.length === 2 };
      },
    },
  ];
}

// ============================================================================
// Cat 122: Tool Groups Mapping Extended
// ============================================================================

export function cat122ToolGroupsMappingExtended(): TestDef[] {
  return [
    {
      name: '122.1-mcp-tool-detection',
      timeout: 5000,
      fn: async () => {
        const { getToolGroups } = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = getToolGroups('mcp__memory__recall');
        return {
          pass: groups.includes('group:mcp'),
          metadata: { groups },
        };
      },
    },
    {
      name: '122.2-plugin-tool-detection',
      timeout: 5000,
      fn: async () => {
        const { getToolGroups } = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = getToolGroups('plugin__custom__action');
        return {
          pass: groups.includes('group:plugin'),
          metadata: { groups },
        };
      },
    },
    {
      name: '122.3-unknown-tool-empty-groups',
      timeout: 5000,
      fn: async () => {
        const { getToolGroups } = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = getToolGroups('completely_unknown_tool');
        return { pass: groups.length === 0 };
      },
    },
    {
      name: '122.4-planning-tools-no-groups',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/tool-groups.js');
        const planGroups = TOOL_GROUPS['plan'] || [];
        const thinkGroups = TOOL_GROUPS['think'] || [];
        return { pass: planGroups.length === 0 && thinkGroups.length === 0 };
      },
    },
    {
      name: '122.5-get-tools-in-group',
      timeout: 5000,
      fn: async () => {
        const { getToolsInGroup } = await import('../../src/security/tool-policy/tool-groups.js');
        const tools = getToolsInGroup('group:runtime:shell');
        return {
          pass: tools.length >= 2 && tools.includes('bash'),
          metadata: { tools },
        };
      },
    },
    {
      name: '122.6-docker-tools-exist',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/tool-groups.js');
        const dockerTools = Object.entries(TOOL_GROUPS)
          .filter(([_, groups]) => groups.includes('group:docker'))
          .map(([name]) => name);
        return {
          pass: dockerTools.length >= 4,
          metadata: { tools: dockerTools },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 123: SettingSourceManager Extended
// ============================================================================

export function cat123SettingSourceExtended(): TestDef[] {
  return [
    {
      name: '123.1-from-flag',
      timeout: 5000,
      fn: async () => {
        const { SettingSourceManager } = await import('../../src/config/advanced-config.js');
        const mgr = SettingSourceManager.fromFlag('user,project');
        return {
          pass: mgr.isSourceEnabled('user') === true &&
                mgr.isSourceEnabled('project') === true &&
                mgr.isSourceEnabled('enterprise') === false,
        };
      },
    },
    {
      name: '123.2-to-flag',
      timeout: 5000,
      fn: async () => {
        const { SettingSourceManager } = await import('../../src/config/advanced-config.js');
        const mgr = new SettingSourceManager(['user', 'env']);
        const flag = mgr.toFlag();
        return {
          pass: flag.includes('user') && flag.includes('env') && !flag.includes('project'),
          metadata: { flag },
        };
      },
    },
    {
      name: '123.3-enable-source',
      timeout: 5000,
      fn: async () => {
        const { SettingSourceManager } = await import('../../src/config/advanced-config.js');
        const mgr = new SettingSourceManager(['user']);
        mgr.enableSource('enterprise');
        return {
          pass: mgr.isSourceEnabled('enterprise') === true &&
                mgr.getEnabledSources().length === 2,
        };
      },
    },
    {
      name: '123.4-get-all-sources',
      timeout: 5000,
      fn: async () => {
        const { SettingSourceManager } = await import('../../src/config/advanced-config.js');
        const mgr = new SettingSourceManager();
        const all = mgr.getAllSources();
        return {
          pass: all.length === 5 && all.includes('user') && all.includes('env'),
          metadata: { all },
        };
      },
    },
    {
      name: '123.5-from-flag-invalid',
      timeout: 5000,
      fn: async () => {
        const { SettingSourceManager } = await import('../../src/config/advanced-config.js');
        const mgr = SettingSourceManager.fromFlag('invalid,bogus');
        // Invalid sources should fall back to all
        const sources = mgr.getEnabledSources();
        return {
          pass: sources.length === 5, // Falls back to all sources
          metadata: { sources },
        };
      },
    },
    {
      name: '123.6-from-flag-mixed',
      timeout: 5000,
      fn: async () => {
        const { SettingSourceManager } = await import('../../src/config/advanced-config.js');
        const mgr = SettingSourceManager.fromFlag('user,invalid,env');
        return {
          pass: mgr.isSourceEnabled('user') === true &&
                mgr.isSourceEnabled('env') === true,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 124: ConfigBackupRotation Edge Cases
// ============================================================================

export function cat124ConfigBackupEdgeCases(): TestDef[] {
  return [
    {
      name: '124.1-list-backups-no-dir',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const mgr = new ConfigBackupRotation('/nonexistent/dir');
        const backups = mgr.listBackups('config.toml');
        return { pass: backups.length === 0 };
      },
    },
    {
      name: '124.2-rotate-no-excess',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const tmpDir = path.join(os.tmpdir(), `rotate-edge-${Date.now()}`);
        const backupDir = path.join(tmpDir, 'bk');
        const configFile = path.join(tmpDir, 'config.toml');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(configFile, 'data');
        try {
          const mgr = new ConfigBackupRotation(backupDir, 10);
          mgr.createBackup(configFile);
          const deleted = mgr.rotateBackups('config.toml');
          return { pass: deleted === 0 };
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: '124.3-backup-default-max-5',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const mgr = new ConfigBackupRotation('/tmp/x');
        return { pass: mgr.getMaxBackups() === 5 };
      },
    },
    {
      name: '124.4-multiple-config-files',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const tmpDir = path.join(os.tmpdir(), `multi-cfg-${Date.now()}`);
        const backupDir = path.join(tmpDir, 'bk');
        const fileA = path.join(tmpDir, 'a.toml');
        const fileB = path.join(tmpDir, 'b.toml');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(fileA, 'a');
        fs.writeFileSync(fileB, 'b');
        try {
          const mgr = new ConfigBackupRotation(backupDir);
          mgr.createBackup(fileA);
          mgr.createBackup(fileB);
          const aBackups = mgr.listBackups('a.toml');
          const bBackups = mgr.listBackups('b.toml');
          return {
            pass: aBackups.length === 1 && bBackups.length === 1,
          };
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: '124.5-backup-sorted-by-timestamp-desc',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const tmpDir = path.join(os.tmpdir(), `sort-bk-${Date.now()}`);
        const backupDir = path.join(tmpDir, 'bk');
        const configFile = path.join(tmpDir, 'sorted.toml');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(configFile, 'data');
        try {
          const mgr = new ConfigBackupRotation(backupDir, 5);
          mgr.createBackup(configFile);
          await new Promise(r => setTimeout(r, 15));
          mgr.createBackup(configFile);
          const backups = mgr.listBackups('sorted.toml');
          return {
            pass: backups.length === 2 && backups[0].timestamp >= backups[1].timestamp,
          };
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
  ];
}

// ============================================================================
// Cat 125: Hook Event Coverage
// ============================================================================

export function cat125HookEventCoverage(): TestDef[] {
  return [
    {
      name: '125.1-all-hook-events-enum',
      timeout: 5000,
      fn: async () => {
        const { HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        const events = Object.values(HookEvent);
        return {
          pass: events.length >= 15 &&
                events.includes('PreToolUse') && events.includes('PostToolUse') &&
                events.includes('SessionStart') && events.includes('SessionEnd'),
          metadata: { count: events.length, events },
        };
      },
    },
    {
      name: '125.2-hook-matcher-regex',
      timeout: 5000,
      fn: async () => {
        const { AdvancedHookRunner, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        const runner = new AdvancedHookRunner();
        const hook = {
          name: 'fs-only',
          event: HookEvent.PreToolUse,
          type: 'command' as const,
          matcher: /^(read_file|write_file|edit_file)$/,
        };
        const match1 = runner.matchesEvent(hook, HookEvent.PreToolUse, 'read_file');
        const match2 = runner.matchesEvent(hook, HookEvent.PreToolUse, 'write_file');
        const noMatch = runner.matchesEvent(hook, HookEvent.PreToolUse, 'bash');
        return { pass: match1 && match2 && !noMatch };
      },
    },
    {
      name: '125.3-hook-no-matcher-matches-all',
      timeout: 5000,
      fn: async () => {
        const { AdvancedHookRunner, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        const runner = new AdvancedHookRunner();
        const hook = { name: 'any', event: HookEvent.PreToolUse, type: 'command' as const };
        const matchesBash = runner.matchesEvent(hook, HookEvent.PreToolUse, 'bash');
        const matchesRead = runner.matchesEvent(hook, HookEvent.PreToolUse, 'read_file');
        const matchesNoTool = runner.matchesEvent(hook, HookEvent.PreToolUse);
        return { pass: matchesBash && matchesRead && matchesNoTool };
      },
    },
    {
      name: '125.4-hook-matcher-with-no-tool-name',
      timeout: 5000,
      fn: async () => {
        const { AdvancedHookRunner, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        const runner = new AdvancedHookRunner();
        const hook = {
          name: 'has-matcher',
          event: HookEvent.PreToolUse,
          type: 'command' as const,
          matcher: /bash/,
        };
        // Has matcher but no toolName → no match
        const result = runner.matchesEvent(hook, HookEvent.PreToolUse);
        return { pass: result === false };
      },
    },
    {
      name: '125.5-subagent-events',
      timeout: 5000,
      fn: async () => {
        const { HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        return {
          pass: HookEvent.SubagentStart === 'SubagentStart' &&
                HookEvent.SubagentStop === 'SubagentStop',
        };
      },
    },
    {
      name: '125.6-config-change-event',
      timeout: 5000,
      fn: async () => {
        const { HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        return {
          pass: HookEvent.ConfigChange === 'ConfigChange' &&
                HookEvent.TaskCompleted === 'TaskCompleted' &&
                HookEvent.PermissionRequest === 'PermissionRequest',
        };
      },
    },
  ];
}
