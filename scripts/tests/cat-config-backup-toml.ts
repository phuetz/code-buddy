/**
 * Cat 111: ConfigBackupRotation (7 tests, no API)
 * Cat 112: FileSuggestionProvider (5 tests, no API)
 * Cat 113: TOML Roundtrip & ConfigManager (7 tests, no API)
 * Cat 114: Tool Aliases & Normalization (6 tests, no API)
 * Cat 115: AutoCompact Usage Percent (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 111: ConfigBackupRotation
// ============================================================================

export function cat111ConfigBackupRotation(): TestDef[] {
  return [
    {
      name: '111.1-backup-instantiation',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const backupDir = path.join(os.tmpdir(), `backup-test-${Date.now()}`);
        const mgr = new ConfigBackupRotation(backupDir);
        return { pass: mgr !== null && typeof mgr.createBackup === 'function' };
      },
    },
    {
      name: '111.2-backup-create-and-list',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const tmpDir = path.join(os.tmpdir(), `backup-test-${Date.now()}`);
        const backupDir = path.join(tmpDir, 'backups');
        const configFile = path.join(tmpDir, 'config.toml');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(configFile, 'active_model = "test"');
        try {
          const mgr = new ConfigBackupRotation(backupDir);
          const backupPath = mgr.createBackup(configFile);
          const backups = mgr.listBackups('config.toml');
          return {
            pass: backups.length === 1 && backupPath.includes('config.toml'),
            metadata: { backupPath },
          };
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: '111.3-backup-rotation',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const tmpDir = path.join(os.tmpdir(), `backup-rot-${Date.now()}`);
        const backupDir = path.join(tmpDir, 'backups');
        const configFile = path.join(tmpDir, 'config.toml');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(configFile, 'test');
        try {
          const mgr = new ConfigBackupRotation(backupDir, 2);
          mgr.createBackup(configFile);
          await new Promise(r => setTimeout(r, 10));
          mgr.createBackup(configFile);
          await new Promise(r => setTimeout(r, 10));
          mgr.createBackup(configFile);
          const backups = mgr.listBackups('config.toml');
          return { pass: backups.length <= 2, metadata: { count: backups.length } };
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: '111.4-backup-restore',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const tmpDir = path.join(os.tmpdir(), `backup-restore-${Date.now()}`);
        const backupDir = path.join(tmpDir, 'backups');
        const configFile = path.join(tmpDir, 'config.toml');
        const restoreFile = path.join(tmpDir, 'restored.toml');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(configFile, 'original_content = true');
        try {
          const mgr = new ConfigBackupRotation(backupDir);
          const backupPath = mgr.createBackup(configFile);
          const restored = mgr.restoreBackup(backupPath, restoreFile);
          const content = fs.readFileSync(restoreFile, 'utf-8');
          return {
            pass: restored === true && content.includes('original_content'),
          };
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: '111.5-backup-get-latest',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const tmpDir = path.join(os.tmpdir(), `backup-latest-${Date.now()}`);
        const backupDir = path.join(tmpDir, 'backups');
        const configFile = path.join(tmpDir, 'my.conf');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(configFile, 'data');
        try {
          const mgr = new ConfigBackupRotation(backupDir);
          const none = mgr.getLatestBackup('my.conf');
          mgr.createBackup(configFile);
          const latest = mgr.getLatestBackup('my.conf');
          return {
            pass: none === null && latest !== null && latest.includes('my.conf'),
          };
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: '111.6-backup-max-backups',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const mgr = new ConfigBackupRotation(path.join(os.tmpdir(), 'unused'), 10);
        return { pass: mgr.getMaxBackups() === 10 };
      },
    },
    {
      name: '111.7-backup-restore-nonexistent',
      timeout: 5000,
      fn: async () => {
        const { ConfigBackupRotation } = await import('../../src/config/advanced-config.js');
        const os = await import('os');
        const path = await import('path');
        const mgr = new ConfigBackupRotation(path.join(os.tmpdir(), 'x'));
        const result = mgr.restoreBackup('/nonexistent/backup.bak', '/tmp/target.toml');
        return { pass: result === false };
      },
    },
  ];
}

// ============================================================================
// Cat 112: FileSuggestionProvider
// ============================================================================

export function cat112FileSuggestionProvider(): TestDef[] {
  return [
    {
      name: '112.1-provider-instantiation',
      timeout: 5000,
      fn: async () => {
        const { FileSuggestionProvider } = await import('../../src/config/advanced-config.js');
        const provider = new FileSuggestionProvider();
        return { pass: provider !== null && typeof provider.getSuggestions === 'function' };
      },
    },
    {
      name: '112.2-no-custom-provider',
      timeout: 5000,
      fn: async () => {
        const { FileSuggestionProvider } = await import('../../src/config/advanced-config.js');
        const provider = new FileSuggestionProvider();
        return { pass: provider.hasCustomProvider() === false };
      },
    },
    {
      name: '112.3-with-custom-provider',
      timeout: 5000,
      fn: async () => {
        const { FileSuggestionProvider } = await import('../../src/config/advanced-config.js');
        const provider = new FileSuggestionProvider({ script: 'echo test.ts' });
        return { pass: provider.hasCustomProvider() === true };
      },
    },
    {
      name: '112.4-get-config',
      timeout: 5000,
      fn: async () => {
        const { FileSuggestionProvider } = await import('../../src/config/advanced-config.js');
        const provider = new FileSuggestionProvider({ maxResults: 20 });
        const config = provider.getConfig();
        return { pass: config.maxResults === 20 };
      },
    },
    {
      name: '112.5-set-script',
      timeout: 5000,
      fn: async () => {
        const { FileSuggestionProvider } = await import('../../src/config/advanced-config.js');
        const provider = new FileSuggestionProvider();
        provider.setScript('/usr/local/bin/suggest');
        return { pass: provider.hasCustomProvider() === true };
      },
    },
  ];
}

// ============================================================================
// Cat 113: TOML Roundtrip & Comments
// ============================================================================

export function cat113TOMLRoundtrip(): TestDef[] {
  return [
    {
      name: '113.1-toml-parse-comments-skipped',
      timeout: 5000,
      fn: async () => {
        const { parseTOML } = await import('../../src/config/toml-config.js');
        const toml = '# this is a comment\nkey = "value"\n# another comment\n';
        const result = parseTOML(toml) as any;
        return { pass: result.key === 'value' && !result['#'] };
      },
    },
    {
      name: '113.2-toml-parse-boolean',
      timeout: 5000,
      fn: async () => {
        const { parseTOML } = await import('../../src/config/toml-config.js');
        const toml = 'enabled = true\ndisabled = false\n';
        const result = parseTOML(toml) as any;
        return { pass: result.enabled === true && result.disabled === false };
      },
    },
    {
      name: '113.3-toml-parse-arrays',
      timeout: 5000,
      fn: async () => {
        const { parseTOML } = await import('../../src/config/toml-config.js');
        const toml = '[test]\nitems = ["a", "b", "c"]\n';
        const result = parseTOML(toml) as any;
        return {
          pass: Array.isArray(result.test?.items) && result.test.items.length === 3,
          metadata: { items: result.test?.items },
        };
      },
    },
    {
      name: '113.4-toml-parse-subsection',
      timeout: 5000,
      fn: async () => {
        const { parseTOML } = await import('../../src/config/toml-config.js');
        const toml = '[providers.xai]\nbase_url = "https://api.x.ai/v1"\ntype = "xai"\n';
        const result = parseTOML(toml) as any;
        return {
          pass: result.providers?.xai?.type === 'xai' &&
                result.providers?.xai?.base_url === 'https://api.x.ai/v1',
        };
      },
    },
    {
      name: '113.5-serialize-roundtrip',
      timeout: 5000,
      fn: async () => {
        const { serializeTOML, parseTOML, DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const serialized = serializeTOML(DEFAULT_CONFIG);
        const parsed = parseTOML(serialized) as any;
        return {
          pass: parsed.active_model === DEFAULT_CONFIG.active_model,
          metadata: { activeModel: parsed.active_model },
        };
      },
    },
    {
      name: '113.6-default-tool-config',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const toolConfig = DEFAULT_CONFIG.tool_config;
        return {
          pass: toolConfig.bash !== undefined &&
                toolConfig.bash.permission === 'ask' &&
                toolConfig.bash.timeout === 120,
          metadata: { bash: toolConfig.bash },
        };
      },
    },
    {
      name: '113.7-default-middleware-config',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const mw = DEFAULT_CONFIG.middleware;
        return {
          pass: mw.max_turns === 100 && mw.max_cost === 10.0 &&
                typeof mw.turn_warning_threshold === 'number',
          metadata: { middleware: mw },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 114: Tool Aliases & Normalization
// ============================================================================

export function cat114ToolAliases(): TestDef[] {
  return [
    {
      name: '114.1-tool-aliases-defined',
      timeout: 5000,
      fn: async () => {
        const { TOOL_ALIASES } = await import('../../src/security/tool-policy/groups.js');
        const count = Object.keys(TOOL_ALIASES).length;
        return { pass: count >= 10, metadata: { count } };
      },
    },
    {
      name: '114.2-read-alias',
      timeout: 5000,
      fn: async () => {
        const { TOOL_ALIASES } = await import('../../src/security/tool-policy/groups.js');
        return {
          pass: TOOL_ALIASES['Read'] === 'read_file' &&
                TOOL_ALIASES['read'] === 'read_file',
        };
      },
    },
    {
      name: '114.3-bash-alias',
      timeout: 5000,
      fn: async () => {
        const { TOOL_ALIASES } = await import('../../src/security/tool-policy/groups.js');
        return {
          pass: TOOL_ALIASES['Bash'] === 'bash' &&
                TOOL_ALIASES['exec'] === 'bash' &&
                TOOL_ALIASES['shell'] === 'bash',
        };
      },
    },
    {
      name: '114.4-normalize-tool-list',
      timeout: 5000,
      fn: async () => {
        const { normalizeToolList } = await import('../../src/security/tool-policy/groups.js');
        const result = normalizeToolList(['Read', 'read', 'Bash', 'exec']);
        return {
          pass: result.includes('read_file') && result.includes('bash') && result.length === 2,
          metadata: { result },
        };
      },
    },
    {
      name: '114.5-normalize-unknown-tool',
      timeout: 5000,
      fn: async () => {
        const { normalizeToolName } = await import('../../src/security/tool-policy/groups.js');
        const result = normalizeToolName('my_custom_tool');
        return { pass: result === 'my_custom_tool' };
      },
    },
    {
      name: '114.6-task-alias',
      timeout: 5000,
      fn: async () => {
        const { TOOL_ALIASES } = await import('../../src/security/tool-policy/groups.js');
        return { pass: TOOL_ALIASES['Task'] === 'spawn_agent' };
      },
    },
  ];
}

// ============================================================================
// Cat 115: AutoCompact Usage Percent
// ============================================================================

export function cat115AutoCompactUsage(): TestDef[] {
  return [
    {
      name: '115.1-usage-percent-calc',
      timeout: 5000,
      fn: async () => {
        const { AutoCompactConfig } = await import('../../src/config/advanced-config.js');
        const config = new AutoCompactConfig();
        const pct = config.getUsagePercent(75000, 100000);
        return { pass: pct === 75, metadata: { pct } };
      },
    },
    {
      name: '115.2-usage-percent-zero-max',
      timeout: 5000,
      fn: async () => {
        const { AutoCompactConfig } = await import('../../src/config/advanced-config.js');
        const config = new AutoCompactConfig();
        const pct = config.getUsagePercent(100, 0);
        return { pass: pct === 0 };
      },
    },
    {
      name: '115.3-should-compact-boundary',
      timeout: 5000,
      fn: async () => {
        const { AutoCompactConfig } = await import('../../src/config/advanced-config.js');
        const config = new AutoCompactConfig(80);
        const atBoundary = config.shouldCompact(80000, 100000);
        const belowBoundary = config.shouldCompact(79999, 100000);
        return { pass: atBoundary === true && belowBoundary === false };
      },
    },
    {
      name: '115.4-from-env-default',
      timeout: 5000,
      fn: async () => {
        const { AutoCompactConfig } = await import('../../src/config/advanced-config.js');
        const val = AutoCompactConfig.fromEnv();
        return { pass: typeof val === 'number' && val >= 0 && val <= 100 };
      },
    },
    {
      name: '115.5-effort-from-env',
      timeout: 5000,
      fn: async () => {
        const { EffortLevelManager } = await import('../../src/config/advanced-config.js');
        const level = EffortLevelManager.fromEnv();
        return {
          pass: level === 'low' || level === 'medium' || level === 'high',
          metadata: { level },
        };
      },
    },
  ];
}
