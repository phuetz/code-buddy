/**
 * Tests for Advanced Config and CLI Enhancements
 *
 * Covers:
 * - Feature 1: Custom File Suggestion Provider
 * - Feature 2: Effort Level Control
 * - Feature 3: Auto-Compact Threshold
 * - Feature 4: Fallback Model Config
 * - Feature 5: Config Backup Rotation
 * - Feature 6: Devcontainer Support
 * - Feature 7: Setting Sources Control
 * - Feature 8: Debug Command
 * - Feature 9: Company Announcements
 * - Feature 10: Attribution Customization
 * - Feature 11: PR Status Indicator
 * - Feature 12: Max Turns Flag
 * - Feature 13: No Session Persistence Flag
 * - Feature 14: History Bash Autocomplete
 * - Feature 15: Strict MCP Config Flag
 * - Feature 16: Prompt Stash (Ctrl+S)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ============================================================================
// Imports
// ============================================================================

import {
  FileSuggestionProvider,
  EffortLevelManager,
  AutoCompactConfig,
  FallbackModelManager,
  ConfigBackupRotation,
  DevcontainerManager,
  SettingSourceManager,
} from '../../src/config/advanced-config.js';

import {
  DebugCommand,
  AnnouncementManager,
  AttributionManager,
  PRStatusIndicator,
  MaxTurnsManager,
  SessionPersistenceConfig,
  BashHistoryAutocomplete,
  StrictMCPConfig,
  PromptStash,
} from '../../src/ui/cli-enhancements.js';

import type { DebugInfo, PRStatusInfo } from '../../src/ui/cli-enhancements.js';

// ============================================================================
// Helpers
// ============================================================================

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-test-'));
}

function cleanTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // ignore
  }
}

function makeDebugInfo(overrides?: Partial<DebugInfo>): DebugInfo {
  return {
    session: { id: 'sess-123', messageCount: 10, tokenUsage: 5000 },
    model: { name: 'grok-3', provider: 'xai', contextWindow: 131072 },
    hooks: { registered: 5, fired: 20, errors: 1 },
    plugins: { loaded: 3, active: 2 },
    mcp: { servers: 2, connected: 1 },
    performance: { avgResponseMs: 450, totalCost: 0.0512 },
    ...overrides,
  };
}

// ============================================================================
// Feature 1: Custom File Suggestion Provider
// ============================================================================

describe('FileSuggestionProvider', () => {
  it('should create with default config', () => {
    const provider = new FileSuggestionProvider();
    expect(provider.getConfig().maxResults).toBe(15);
    expect(provider.getConfig().script).toBeUndefined();
  });

  it('should create with custom config', () => {
    const provider = new FileSuggestionProvider({ maxResults: 10, script: '/usr/bin/suggest' });
    expect(provider.getConfig().maxResults).toBe(10);
    expect(provider.getConfig().script).toBe('/usr/bin/suggest');
  });

  it('should report hasCustomProvider correctly', () => {
    const noScript = new FileSuggestionProvider();
    expect(noScript.hasCustomProvider()).toBe(false);

    const withScript = new FileSuggestionProvider({ script: '/bin/test' });
    expect(withScript.hasCustomProvider()).toBe(true);
  });

  it('should return empty array when no script configured', async () => {
    const provider = new FileSuggestionProvider();
    const results = await provider.getSuggestions('test');
    expect(results).toEqual([]);
  });

  it('should set script path', () => {
    const provider = new FileSuggestionProvider();
    provider.setScript('/usr/local/bin/suggest.sh');
    expect(provider.hasCustomProvider()).toBe(true);
    expect(provider.getConfig().script).toBe('/usr/local/bin/suggest.sh');
  });

  it('should return empty array when script execution fails', async () => {
    const provider = new FileSuggestionProvider({ script: '/nonexistent/script' });
    const results = await provider.getSuggestions('query');
    expect(results).toEqual([]);
  });
});

// ============================================================================
// Feature 2: Effort Level Control
// ============================================================================

describe('EffortLevelManager', () => {
  it('should default to medium level', () => {
    const mgr = new EffortLevelManager();
    expect(mgr.getLevel()).toBe('medium');
  });

  it('should accept initial level', () => {
    const mgr = new EffortLevelManager('high');
    expect(mgr.getLevel()).toBe('high');
  });

  it('should set level', () => {
    const mgr = new EffortLevelManager();
    mgr.setLevel('low');
    expect(mgr.getLevel()).toBe('low');
    mgr.setLevel('high');
    expect(mgr.getLevel()).toBe('high');
  });

  it('should return low effort params', () => {
    const mgr = new EffortLevelManager('low');
    const params = mgr.getModelParams();
    expect(params.temperature).toBe(0.3);
    expect(params.maxTokens).toBe(1024);
    expect(params.topP).toBe(0.8);
  });

  it('should return medium effort params', () => {
    const mgr = new EffortLevelManager('medium');
    const params = mgr.getModelParams();
    expect(params.temperature).toBe(0.7);
    expect(params.maxTokens).toBe(4096);
    expect(params.topP).toBe(0.9);
  });

  it('should return high effort params', () => {
    const mgr = new EffortLevelManager('high');
    const params = mgr.getModelParams();
    expect(params.temperature).toBe(1.0);
    expect(params.maxTokens).toBe(16384);
    expect(params.topP).toBe(1.0);
  });

  it('should read from env', () => {
    const original = process.env.EFFORT_LEVEL;
    process.env.EFFORT_LEVEL = 'high';
    expect(EffortLevelManager.fromEnv()).toBe('high');
    process.env.EFFORT_LEVEL = 'invalid';
    expect(EffortLevelManager.fromEnv()).toBe('medium');
    delete process.env.EFFORT_LEVEL;
    expect(EffortLevelManager.fromEnv()).toBe('medium');
    if (original !== undefined) process.env.EFFORT_LEVEL = original;
  });
});

// ============================================================================
// Feature 3: Auto-Compact Threshold
// ============================================================================

describe('AutoCompactConfig', () => {
  it('should default to 80%', () => {
    const config = new AutoCompactConfig();
    expect(config.getThreshold()).toBe(80);
  });

  it('should accept custom threshold', () => {
    const config = new AutoCompactConfig(90);
    expect(config.getThreshold()).toBe(90);
  });

  it('should set threshold', () => {
    const config = new AutoCompactConfig();
    config.setThreshold(50);
    expect(config.getThreshold()).toBe(50);
  });

  it('should reject invalid thresholds', () => {
    const config = new AutoCompactConfig();
    expect(() => config.setThreshold(-1)).toThrow('Threshold must be between 0 and 100');
    expect(() => config.setThreshold(101)).toThrow('Threshold must be between 0 and 100');
  });

  it('should determine when to compact', () => {
    const config = new AutoCompactConfig(80);
    expect(config.shouldCompact(80, 100)).toBe(true);
    expect(config.shouldCompact(79, 100)).toBe(false);
    expect(config.shouldCompact(100, 100)).toBe(true);
    expect(config.shouldCompact(0, 100)).toBe(false);
  });

  it('should handle zero max capacity', () => {
    const config = new AutoCompactConfig(80);
    expect(config.shouldCompact(50, 0)).toBe(false);
  });

  it('should calculate usage percent', () => {
    const config = new AutoCompactConfig();
    expect(config.getUsagePercent(50, 100)).toBe(50);
    expect(config.getUsagePercent(0, 100)).toBe(0);
    expect(config.getUsagePercent(100, 100)).toBe(100);
    expect(config.getUsagePercent(10, 0)).toBe(0);
  });

  it('should read from env', () => {
    const original = process.env.AUTO_COMPACT_THRESHOLD;
    process.env.AUTO_COMPACT_THRESHOLD = '70';
    expect(AutoCompactConfig.fromEnv()).toBe(70);
    process.env.AUTO_COMPACT_THRESHOLD = 'invalid';
    expect(AutoCompactConfig.fromEnv()).toBe(80);
    delete process.env.AUTO_COMPACT_THRESHOLD;
    expect(AutoCompactConfig.fromEnv()).toBe(80);
    if (original !== undefined) process.env.AUTO_COMPACT_THRESHOLD = original;
  });
});

// ============================================================================
// Feature 4: Fallback Model Config
// ============================================================================

describe('FallbackModelManager', () => {
  it('should create with defaults', () => {
    const mgr = new FallbackModelManager();
    const config = mgr.getConfig();
    expect(config.primaryModel).toBe('grok-3');
    expect(config.fallbackModel).toBe('grok-3-mini');
    expect(config.triggerOnOverload).toBe(true);
    expect(config.triggerOnError).toBe(true);
    expect(config.triggerOnTimeout).toBe(true);
  });

  it('should create with custom config', () => {
    const mgr = new FallbackModelManager({ primaryModel: 'claude-4', fallbackModel: 'claude-3.5' });
    expect(mgr.getConfig().primaryModel).toBe('claude-4');
    expect(mgr.getConfig().fallbackModel).toBe('claude-3.5');
  });

  it('should return primary model when fallback inactive', () => {
    const mgr = new FallbackModelManager();
    expect(mgr.getCurrentModel()).toBe('grok-3');
    expect(mgr.isFallbackActive()).toBe(false);
  });

  it('should activate and deactivate fallback', () => {
    const mgr = new FallbackModelManager();
    mgr.activateFallback();
    expect(mgr.isFallbackActive()).toBe(true);
    expect(mgr.getCurrentModel()).toBe('grok-3-mini');
    expect(mgr.getFallbackCount()).toBe(1);

    mgr.deactivateFallback();
    expect(mgr.isFallbackActive()).toBe(false);
    expect(mgr.getCurrentModel()).toBe('grok-3');
  });

  it('should trigger fallback on rate limit (429)', () => {
    const mgr = new FallbackModelManager();
    expect(mgr.shouldFallback({ status: 429 })).toBe(true);
    expect(mgr.shouldFallback({ code: 'rate_limit_exceeded' })).toBe(true);
  });

  it('should trigger fallback on server error (5xx)', () => {
    const mgr = new FallbackModelManager();
    expect(mgr.shouldFallback({ status: 500 })).toBe(true);
    expect(mgr.shouldFallback({ status: 503 })).toBe(true);
  });

  it('should trigger fallback on timeout', () => {
    const mgr = new FallbackModelManager();
    expect(mgr.shouldFallback({ code: 'ETIMEDOUT' })).toBe(true);
    expect(mgr.shouldFallback({ message: 'Request timeout exceeded' })).toBe(true);
  });

  it('should not trigger fallback when already active', () => {
    const mgr = new FallbackModelManager();
    mgr.activateFallback();
    expect(mgr.shouldFallback({ status: 429 })).toBe(false);
  });

  it('should not trigger on non-matching errors', () => {
    const mgr = new FallbackModelManager();
    expect(mgr.shouldFallback({ status: 400 })).toBe(false);
    expect(mgr.shouldFallback({ message: 'invalid request' })).toBe(false);
  });

  it('should respect disabled triggers', () => {
    const mgr = new FallbackModelManager({ triggerOnOverload: false });
    expect(mgr.shouldFallback({ status: 429 })).toBe(false);
  });

  it('should count multiple fallback activations', () => {
    const mgr = new FallbackModelManager();
    mgr.activateFallback();
    mgr.deactivateFallback();
    mgr.activateFallback();
    expect(mgr.getFallbackCount()).toBe(2);
  });
});

// ============================================================================
// Feature 5: Config Backup Rotation
// ============================================================================

describe('ConfigBackupRotation', () => {
  let tempDir: string;
  let backupDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    backupDir = path.join(tempDir, 'backups');
  });

  afterEach(() => {
    cleanTempDir(tempDir);
  });

  it('should create backup of config file', () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, '{"key":"value"}');

    const rotation = new ConfigBackupRotation(backupDir, 5);
    const backupPath = rotation.createBackup(configPath);

    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, 'utf-8')).toBe('{"key":"value"}');
  });

  it('should list backups sorted by timestamp desc', () => {
    const rotation = new ConfigBackupRotation(backupDir, 5);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'config.json.1000.bak'), 'old');
    fs.writeFileSync(path.join(backupDir, 'config.json.2000.bak'), 'new');

    const backups = rotation.listBackups('config.json');
    expect(backups.length).toBe(2);
    expect(backups[0].timestamp).toBe(2000);
    expect(backups[1].timestamp).toBe(1000);
  });

  it('should rotate excess backups', () => {
    const rotation = new ConfigBackupRotation(backupDir, 2);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'config.json.1000.bak'), 'a');
    fs.writeFileSync(path.join(backupDir, 'config.json.2000.bak'), 'b');
    fs.writeFileSync(path.join(backupDir, 'config.json.3000.bak'), 'c');

    const deleted = rotation.rotateBackups('config.json');
    expect(deleted).toBe(1);
    expect(rotation.listBackups('config.json').length).toBe(2);
  });

  it('should restore backup to target path', () => {
    const rotation = new ConfigBackupRotation(backupDir, 5);
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, 'config.json.1000.bak');
    fs.writeFileSync(backupPath, '{"restored":true}');

    const targetPath = path.join(tempDir, 'restored-config.json');
    const success = rotation.restoreBackup(backupPath, targetPath);
    expect(success).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('{"restored":true}');
  });

  it('should return false when restoring non-existent backup', () => {
    const rotation = new ConfigBackupRotation(backupDir, 5);
    const success = rotation.restoreBackup('/nonexistent/file.bak', '/tmp/target');
    expect(success).toBe(false);
  });

  it('should get latest backup', () => {
    const rotation = new ConfigBackupRotation(backupDir, 5);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'config.json.1000.bak'), 'a');
    fs.writeFileSync(path.join(backupDir, 'config.json.3000.bak'), 'c');

    const latest = rotation.getLatestBackup('config.json');
    expect(latest).toContain('3000.bak');
  });

  it('should return null when no backups exist', () => {
    const rotation = new ConfigBackupRotation(backupDir, 5);
    expect(rotation.getLatestBackup('config.json')).toBeNull();
  });

  it('should return max backups', () => {
    expect(new ConfigBackupRotation(backupDir).getMaxBackups()).toBe(5);
    expect(new ConfigBackupRotation(backupDir, 10).getMaxBackups()).toBe(10);
  });

  it('should return empty list for non-existent backup dir', () => {
    const rotation = new ConfigBackupRotation('/nonexistent/dir');
    expect(rotation.listBackups('config.json')).toEqual([]);
  });
});

// ============================================================================
// Feature 6: Devcontainer Support
// ============================================================================

describe('DevcontainerManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    cleanTempDir(tempDir);
  });

  it('should generate config with defaults', () => {
    const mgr = new DevcontainerManager();
    const config = mgr.generateConfig({});
    expect(config.name).toBe('code-buddy-dev');
    expect(config.remoteUser).toBe('node');
    expect(config.features).toEqual({});
    expect(config.forwardPorts).toEqual([]);
  });

  it('should generate config with custom options', () => {
    const mgr = new DevcontainerManager();
    const config = mgr.generateConfig({
      name: 'my-project',
      image: 'node:20',
      forwardPorts: [3000, 8080],
      postCreateCommand: 'npm install',
    });
    expect(config.name).toBe('my-project');
    expect(config.image).toBe('node:20');
    expect(config.forwardPorts).toEqual([3000, 8080]);
    expect(config.postCreateCommand).toBe('npm install');
  });

  it('should load config from file', () => {
    const configDir = path.join(tempDir, '.devcontainer');
    fs.mkdirSync(configDir);
    const configPath = path.join(configDir, 'devcontainer.json');
    fs.writeFileSync(configPath, JSON.stringify({
      name: 'test-container',
      image: 'ubuntu:22.04',
      forwardPorts: [5000],
      remoteUser: 'vscode',
    }));

    const mgr = new DevcontainerManager();
    const config = mgr.loadConfig(configPath);
    expect(config).not.toBeNull();
    expect(config!.name).toBe('test-container');
    expect(config!.image).toBe('ubuntu:22.04');
    expect(config!.forwardPorts).toEqual([5000]);
    expect(config!.remoteUser).toBe('vscode');
  });

  it('should return null for non-existent config', () => {
    const mgr = new DevcontainerManager();
    const config = mgr.loadConfig('/nonexistent/path.json');
    expect(config).toBeNull();
  });

  it('should detect devcontainer environment via env vars', () => {
    const mgr = new DevcontainerManager();
    const originalRC = process.env.REMOTE_CONTAINERS;
    const originalCS = process.env.CODESPACES;

    delete process.env.REMOTE_CONTAINERS;
    delete process.env.CODESPACES;
    delete process.env.REMOTE_CONTAINERS_IPC;
    expect(mgr.isInsideDevcontainer()).toBe(false);

    process.env.REMOTE_CONTAINERS = 'true';
    expect(mgr.isInsideDevcontainer()).toBe(true);

    delete process.env.REMOTE_CONTAINERS;
    if (originalRC !== undefined) process.env.REMOTE_CONTAINERS = originalRC;
    if (originalCS !== undefined) process.env.CODESPACES = originalCS;
  });

  it('should get container name after config load', () => {
    const mgr = new DevcontainerManager();
    expect(mgr.getContainerName()).toBeNull();

    mgr.generateConfig({ name: 'my-container' });
    expect(mgr.getContainerName()).toBe('my-container');
  });

  it('should get forwarded ports', () => {
    const mgr = new DevcontainerManager();
    expect(mgr.getForwardedPorts()).toEqual([]);

    mgr.generateConfig({ forwardPorts: [3000, 5432] });
    expect(mgr.getForwardedPorts()).toEqual([3000, 5432]);
  });

  it('should serialize config to JSON', () => {
    const mgr = new DevcontainerManager();
    const config = mgr.generateConfig({
      name: 'test',
      image: 'node:20',
      forwardPorts: [3000],
    });
    const serialized = mgr.serializeConfig(config);
    const parsed = JSON.parse(serialized);
    expect(parsed.name).toBe('test');
    expect(parsed.image).toBe('node:20');
    expect(parsed.forwardPorts).toEqual([3000]);
  });

  it('should omit empty fields in serialized config', () => {
    const mgr = new DevcontainerManager();
    const config = mgr.generateConfig({ name: 'minimal' });
    const serialized = mgr.serializeConfig(config);
    const parsed = JSON.parse(serialized);
    expect(parsed.image).toBeUndefined();
    expect(parsed.features).toBeUndefined();
    expect(parsed.forwardPorts).toBeUndefined();
  });
});

// ============================================================================
// Feature 7: Setting Sources Control
// ============================================================================

describe('SettingSourceManager', () => {
  it('should enable all sources by default', () => {
    const mgr = new SettingSourceManager();
    expect(mgr.getEnabledSources()).toEqual(['user', 'project', 'local', 'enterprise', 'env']);
  });

  it('should accept specific sources', () => {
    const mgr = new SettingSourceManager(['user', 'env']);
    expect(mgr.getEnabledSources()).toEqual(['user', 'env']);
  });

  it('should check if source is enabled', () => {
    const mgr = new SettingSourceManager(['user', 'project']);
    expect(mgr.isSourceEnabled('user')).toBe(true);
    expect(mgr.isSourceEnabled('env')).toBe(false);
  });

  it('should enable and disable sources', () => {
    const mgr = new SettingSourceManager(['user']);
    mgr.enableSource('env');
    expect(mgr.isSourceEnabled('env')).toBe(true);

    mgr.disableSource('user');
    expect(mgr.isSourceEnabled('user')).toBe(false);
  });

  it('should parse from comma-separated flag', () => {
    const mgr = SettingSourceManager.fromFlag('user,project,env');
    expect(mgr.getEnabledSources()).toEqual(['user', 'project', 'env']);
  });

  it('should handle invalid sources in flag', () => {
    const mgr = SettingSourceManager.fromFlag('user,invalid,env');
    expect(mgr.isSourceEnabled('user')).toBe(true);
    expect(mgr.isSourceEnabled('env')).toBe(true);
  });

  it('should fall back to all sources for empty flag', () => {
    const mgr = SettingSourceManager.fromFlag('');
    expect(mgr.getEnabledSources().length).toBe(5);
  });

  it('should serialize to flag string', () => {
    const mgr = new SettingSourceManager(['user', 'env']);
    expect(mgr.toFlag()).toBe('user,env');
  });

  it('should return all sources', () => {
    const mgr = new SettingSourceManager(['user']);
    expect(mgr.getAllSources()).toEqual(['user', 'project', 'local', 'enterprise', 'env']);
  });
});

// ============================================================================
// Feature 8: Debug Command
// ============================================================================

describe('DebugCommand', () => {
  it('should return default debug info', () => {
    const cmd = new DebugCommand();
    const info = cmd.getDebugInfo();
    expect(info.session.id).toBe('none');
    expect(info.model.name).toBe('unknown');
    expect(info.hooks.registered).toBe(0);
    expect(info.plugins.loaded).toBe(0);
    expect(info.mcp.servers).toBe(0);
    expect(info.performance.avgResponseMs).toBe(0);
  });

  it('should format debug output', () => {
    const cmd = new DebugCommand();
    const info = makeDebugInfo();
    const output = cmd.formatDebugOutput(info);
    expect(output).toContain('=== Debug Info ===');
    expect(output).toContain('sess-123');
    expect(output).toContain('grok-3');
    expect(output).toContain('xai');
    expect(output).toContain('131072');
    expect(output).toContain('450ms');
    expect(output).toContain('$0.0512');
  });

  it('should parse include filter', () => {
    const cmd = new DebugCommand();
    const result = cmd.parseFilter('session,model');
    expect(result.include).toEqual(['session', 'model']);
    expect(result.exclude).toEqual([]);
  });

  it('should parse exclude filter', () => {
    const cmd = new DebugCommand();
    const result = cmd.parseFilter('!hooks,!plugins');
    expect(result.include).toEqual([]);
    expect(result.exclude).toEqual(['hooks', 'plugins']);
  });

  it('should filter categories by include', () => {
    const cmd = new DebugCommand();
    const info = makeDebugInfo();
    const filtered = cmd.filterCategories(info, 'session,model');
    expect(filtered.session).toBeDefined();
    expect(filtered.model).toBeDefined();
    expect(filtered.hooks).toBeUndefined();
    expect(filtered.plugins).toBeUndefined();
  });

  it('should filter categories by exclude', () => {
    const cmd = new DebugCommand();
    const info = makeDebugInfo();
    const filtered = cmd.filterCategories(info, '!hooks,!plugins');
    expect(filtered.session).toBeDefined();
    expect(filtered.model).toBeDefined();
    expect(filtered.hooks).toBeUndefined();
    expect(filtered.plugins).toBeUndefined();
  });
});

// ============================================================================
// Feature 9: Company Announcements
// ============================================================================

describe('AnnouncementManager', () => {
  it('should add announcements', () => {
    const mgr = new AnnouncementManager();
    const ann = mgr.addAnnouncement('Hello world');
    expect(ann.message).toBe('Hello world');
    expect(ann.priority).toBe('info');
    expect(ann.dismissible).toBe(true);
    expect(mgr.getCount()).toBe(1);
  });

  it('should add with custom priority', () => {
    const mgr = new AnnouncementManager();
    const ann = mgr.addAnnouncement('Critical issue', 'critical');
    expect(ann.priority).toBe('critical');
  });

  it('should add with custom id', () => {
    const mgr = new AnnouncementManager();
    const ann = mgr.addAnnouncement('Test', 'info', { id: 'custom-id' });
    expect(ann.id).toBe('custom-id');
  });

  it('should get active announcements excluding dismissed', () => {
    const mgr = new AnnouncementManager();
    const a1 = mgr.addAnnouncement('One');
    mgr.addAnnouncement('Two');
    mgr.dismiss(a1.id);
    expect(mgr.getActiveAnnouncements().length).toBe(1);
    expect(mgr.getCount()).toBe(1);
  });

  it('should not dismiss non-dismissible announcements', () => {
    const mgr = new AnnouncementManager();
    const ann = mgr.addAnnouncement('Mandatory', 'critical', { dismissible: false });
    const result = mgr.dismiss(ann.id);
    expect(result).toBe(false);
    expect(mgr.getCount()).toBe(1);
  });

  it('should filter expired announcements', () => {
    const mgr = new AnnouncementManager();
    mgr.addAnnouncement('Expired', 'info', { expiresAt: Date.now() - 1000 });
    mgr.addAnnouncement('Active', 'info', { expiresAt: Date.now() + 100000 });
    expect(mgr.getActiveAnnouncements().length).toBe(1);
  });

  it('should clear expired announcements', () => {
    const mgr = new AnnouncementManager();
    mgr.addAnnouncement('Expired', 'info', { expiresAt: Date.now() - 1000 });
    mgr.addAnnouncement('Active', 'info');
    const cleared = mgr.clearExpired();
    expect(cleared).toBe(1);
  });

  it('should format announcements sorted by priority', () => {
    const mgr = new AnnouncementManager();
    mgr.addAnnouncement('Info msg', 'info');
    mgr.addAnnouncement('Critical msg', 'critical');
    mgr.addAnnouncement('Warning msg', 'warning');
    const formatted = mgr.formatAnnouncements();
    const lines = formatted.split('\n');
    expect(lines[0]).toContain('[!]');
    expect(lines[1]).toContain('[*]');
    expect(lines[2]).toContain('[i]');
  });

  it('should return empty string when no announcements', () => {
    const mgr = new AnnouncementManager();
    expect(mgr.formatAnnouncements()).toBe('');
  });

  it('should return false when dismissing non-existent announcement', () => {
    const mgr = new AnnouncementManager();
    expect(mgr.dismiss('nonexistent')).toBe(false);
  });
});

// ============================================================================
// Feature 10: Attribution Customization
// ============================================================================

describe('AttributionManager', () => {
  it('should create with defaults', () => {
    const mgr = new AttributionManager();
    expect(mgr.getCommitFooter()).toContain('Co-Authored-By');
    expect(mgr.getPRFooter()).toContain('Code Buddy');
    expect(mgr.isEnabled()).toBe(true);
  });

  it('should create with custom config', () => {
    const mgr = new AttributionManager({
      commitFooter: 'Custom Footer',
      prFooter: 'Custom PR',
    });
    expect(mgr.getCommitFooter()).toBe('Custom Footer');
    expect(mgr.getPRFooter()).toBe('Custom PR');
  });

  it('should format commit message with footer', () => {
    const mgr = new AttributionManager({ commitFooter: 'Signed-off-by: Bot' });
    const formatted = mgr.formatCommitMessage('feat: add feature');
    expect(formatted).toContain('feat: add feature');
    expect(formatted).toContain('Signed-off-by: Bot');
  });

  it('should format PR body with footer', () => {
    const mgr = new AttributionManager({ prFooter: 'AI Generated' });
    const formatted = mgr.formatPRBody('## Summary\nChanges');
    expect(formatted).toContain('## Summary');
    expect(formatted).toContain('AI Generated');
  });

  it('should return raw message when disabled', () => {
    const mgr = new AttributionManager({ enabled: false });
    expect(mgr.formatCommitMessage('hello')).toBe('hello');
    expect(mgr.formatPRBody('body')).toBe('body');
    expect(mgr.getCommitFooter()).toBe('');
    expect(mgr.getPRFooter()).toBe('');
  });

  it('should set and get enabled state', () => {
    const mgr = new AttributionManager();
    mgr.setEnabled(false);
    expect(mgr.isEnabled()).toBe(false);
    mgr.setEnabled(true);
    expect(mgr.isEnabled()).toBe(true);
  });

  it('should set custom footers', () => {
    const mgr = new AttributionManager();
    mgr.setCommitFooter('New commit footer');
    mgr.setPRFooter('New PR footer');
    expect(mgr.getCommitFooter()).toBe('New commit footer');
    expect(mgr.getPRFooter()).toBe('New PR footer');
  });

  it('should return config copy', () => {
    const mgr = new AttributionManager();
    const config = mgr.getConfig();
    config.enabled = false;
    expect(mgr.isEnabled()).toBe(true);
  });
});

// ============================================================================
// Feature 11: PR Status Indicator
// ============================================================================

describe('PRStatusIndicator', () => {
  const samplePR: PRStatusInfo = {
    number: 42,
    status: 'pending',
    title: 'Add new feature',
    reviewers: ['alice', 'bob'],
    checks: { passed: 3, failed: 1, pending: 2 },
  };

  it('should start with no PR', () => {
    const indicator = new PRStatusIndicator();
    expect(indicator.hasPR()).toBe(false);
    expect(indicator.getPR()).toBeNull();
    expect(indicator.formatPromptIndicator()).toBe('');
  });

  it('should set and get PR', () => {
    const indicator = new PRStatusIndicator();
    indicator.setPR(samplePR);
    expect(indicator.hasPR()).toBe(true);
    expect(indicator.getPR()!.number).toBe(42);
  });

  it('should clear PR', () => {
    const indicator = new PRStatusIndicator();
    indicator.setPR(samplePR);
    indicator.clearPR();
    expect(indicator.hasPR()).toBe(false);
  });

  it('should return status icons', () => {
    const indicator = new PRStatusIndicator();
    expect(indicator.getStatusIcon('draft')).toBe('o');
    expect(indicator.getStatusIcon('approved')).toBe('+');
    expect(indicator.getStatusIcon('merged')).toBe('M');
    expect(indicator.getStatusIcon('closed')).toBe('X');
    expect(indicator.getStatusIcon('changes-requested')).toBe('!');
    expect(indicator.getStatusIcon('pending')).toBe('?');
  });

  it('should return status colors', () => {
    const indicator = new PRStatusIndicator();
    expect(indicator.getStatusColor('approved')).toBe('green');
    expect(indicator.getStatusColor('merged')).toBe('purple');
    expect(indicator.getStatusColor('draft')).toBe('gray');
  });

  it('should format prompt indicator', () => {
    const indicator = new PRStatusIndicator();
    indicator.setPR(samplePR);
    const prompt = indicator.formatPromptIndicator();
    expect(prompt).toContain('PR#42');
    expect(prompt).toContain('?');
    expect(prompt).toContain('3/6');
  });
});

// ============================================================================
// Feature 12: Max Turns Flag
// ============================================================================

describe('MaxTurnsManager', () => {
  it('should default to unlimited', () => {
    const mgr = new MaxTurnsManager();
    expect(mgr.getMaxTurns()).toBeNull();
    expect(mgr.hasReachedLimit()).toBe(false);
    expect(mgr.getRemainingTurns()).toBeNull();
  });

  it('should accept initial max', () => {
    const mgr = new MaxTurnsManager(10);
    expect(mgr.getMaxTurns()).toBe(10);
  });

  it('should increment turns', () => {
    const mgr = new MaxTurnsManager(5);
    mgr.increment();
    mgr.increment();
    expect(mgr.getCurrentTurn()).toBe(2);
    expect(mgr.getRemainingTurns()).toBe(3);
  });

  it('should detect limit reached', () => {
    const mgr = new MaxTurnsManager(2);
    mgr.increment();
    expect(mgr.hasReachedLimit()).toBe(false);
    mgr.increment();
    expect(mgr.hasReachedLimit()).toBe(true);
  });

  it('should reset turns', () => {
    const mgr = new MaxTurnsManager(5);
    mgr.increment();
    mgr.increment();
    mgr.reset();
    expect(mgr.getCurrentTurn()).toBe(0);
  });

  it('should set max turns', () => {
    const mgr = new MaxTurnsManager();
    mgr.setMaxTurns(20);
    expect(mgr.getMaxTurns()).toBe(20);
    mgr.setMaxTurns(null);
    expect(mgr.getMaxTurns()).toBeNull();
  });

  it('should format status with limit', () => {
    const mgr = new MaxTurnsManager(10);
    mgr.increment();
    expect(mgr.formatStatus()).toBe('Turn 1/10');
  });

  it('should format status without limit', () => {
    const mgr = new MaxTurnsManager();
    mgr.increment();
    expect(mgr.formatStatus()).toBe('Turn 1 (unlimited)');
  });

  it('should clamp remaining to zero', () => {
    const mgr = new MaxTurnsManager(1);
    mgr.increment();
    mgr.increment();
    expect(mgr.getRemainingTurns()).toBe(0);
  });
});

// ============================================================================
// Feature 13: No Session Persistence Flag
// ============================================================================

describe('SessionPersistenceConfig', () => {
  it('should default to enabled', () => {
    const config = new SessionPersistenceConfig();
    expect(config.isEnabled()).toBe(true);
    expect(config.shouldSave()).toBe(true);
    expect(config.shouldLoad()).toBe(true);
    expect(config.getMode()).toBe('persistent');
  });

  it('should create as disabled', () => {
    const config = new SessionPersistenceConfig(false);
    expect(config.isEnabled()).toBe(false);
    expect(config.shouldSave()).toBe(false);
    expect(config.shouldLoad()).toBe(false);
    expect(config.getMode()).toBe('ephemeral');
  });

  it('should toggle persistence', () => {
    const config = new SessionPersistenceConfig();
    config.setEnabled(false);
    expect(config.getMode()).toBe('ephemeral');
    config.setEnabled(true);
    expect(config.getMode()).toBe('persistent');
  });
});

// ============================================================================
// Feature 14: History Bash Autocomplete
// ============================================================================

describe('BashHistoryAutocomplete', () => {
  it('should start with empty history', () => {
    const hist = new BashHistoryAutocomplete();
    expect(hist.getHistorySize()).toBe(0);
    expect(hist.getHistory()).toEqual([]);
  });

  it('should add commands', () => {
    const hist = new BashHistoryAutocomplete();
    hist.addCommand('ls -la');
    hist.addCommand('git status');
    expect(hist.getHistorySize()).toBe(2);
  });

  it('should ignore empty commands', () => {
    const hist = new BashHistoryAutocomplete();
    hist.addCommand('');
    hist.addCommand('   ');
    expect(hist.getHistorySize()).toBe(0);
  });

  it('should deduplicate commands (move to end)', () => {
    const hist = new BashHistoryAutocomplete();
    hist.addCommand('ls');
    hist.addCommand('pwd');
    hist.addCommand('ls');
    expect(hist.getHistorySize()).toBe(2);
    expect(hist.getHistory()).toEqual(['pwd', 'ls']);
  });

  it('should get completions by prefix', () => {
    const hist = new BashHistoryAutocomplete();
    hist.addCommand('git status');
    hist.addCommand('git commit -m "fix"');
    hist.addCommand('grep -r pattern');
    const completions = hist.getCompletions('git');
    expect(completions.length).toBe(2);
    expect(completions).toContain('git status');
    expect(completions).toContain('git commit -m "fix"');
  });

  it('should return empty for empty prefix', () => {
    const hist = new BashHistoryAutocomplete();
    hist.addCommand('test');
    expect(hist.getCompletions('')).toEqual([]);
  });

  it('should enforce max history', () => {
    const hist = new BashHistoryAutocomplete(3);
    hist.addCommand('a');
    hist.addCommand('b');
    hist.addCommand('c');
    hist.addCommand('d');
    expect(hist.getHistorySize()).toBe(3);
    expect(hist.getHistory()).toEqual(['b', 'c', 'd']);
  });

  it('should clear history', () => {
    const hist = new BashHistoryAutocomplete();
    hist.addCommand('test');
    hist.clearHistory();
    expect(hist.getHistorySize()).toBe(0);
  });

  it('should simulate loadFromFile returning 0', () => {
    const hist = new BashHistoryAutocomplete();
    const count = hist.loadFromFile('/some/path/.bash_history');
    expect(count).toBe(0);
  });
});

// ============================================================================
// Feature 15: Strict MCP Config Flag
// ============================================================================

describe('StrictMCPConfig', () => {
  it('should default to non-strict', () => {
    const config = new StrictMCPConfig();
    expect(config.isStrict()).toBe(false);
    expect(config.getConfigPath()).toBeNull();
  });

  it('should create as strict', () => {
    const config = new StrictMCPConfig(true, '/path/to/mcp.json');
    expect(config.isStrict()).toBe(true);
    expect(config.getConfigPath()).toBe('/path/to/mcp.json');
  });

  it('should allow all servers when non-strict', () => {
    const config = new StrictMCPConfig(false);
    expect(config.isServerAllowed('any-server')).toBe(true);
  });

  it('should restrict servers when strict', () => {
    const config = new StrictMCPConfig(true);
    config.addAllowedServer('brave-search');
    expect(config.isServerAllowed('brave-search')).toBe(true);
    expect(config.isServerAllowed('unknown-server')).toBe(false);
  });

  it('should toggle strict mode', () => {
    const config = new StrictMCPConfig();
    config.setStrict(true);
    expect(config.isStrict()).toBe(true);
    config.setStrict(false);
    expect(config.isStrict()).toBe(false);
  });

  it('should set config path', () => {
    const config = new StrictMCPConfig();
    config.setConfigPath('/new/path.json');
    expect(config.getConfigPath()).toBe('/new/path.json');
  });

  it('should list allowed servers', () => {
    const config = new StrictMCPConfig(true);
    config.addAllowedServer('server-a');
    config.addAllowedServer('server-b');
    expect(config.getAllowedServers()).toEqual(['server-a', 'server-b']);
  });
});

// ============================================================================
// Feature 16: Prompt Stash (Ctrl+S)
// ============================================================================

describe('PromptStash', () => {
  it('should start empty', () => {
    const stash = new PromptStash();
    expect(stash.isEmpty()).toBe(true);
    expect(stash.getSize()).toBe(0);
    expect(stash.getMaxStash()).toBe(20);
  });

  it('should push and pop prompts', () => {
    const stash = new PromptStash();
    stash.push('hello world');
    expect(stash.getSize()).toBe(1);

    const popped = stash.pop();
    expect(popped).not.toBeNull();
    expect(popped!.content).toBe('hello world');
    expect(stash.isEmpty()).toBe(true);
  });

  it('should preserve cursor position', () => {
    const stash = new PromptStash();
    const item = stash.push('hello', 3);
    expect(item.cursorPosition).toBe(3);
  });

  it('should default cursor to end of content', () => {
    const stash = new PromptStash();
    const item = stash.push('hello');
    expect(item.cursorPosition).toBe(5);
  });

  it('should peek without removing', () => {
    const stash = new PromptStash();
    stash.push('first');
    stash.push('second');

    const peeked = stash.peek();
    expect(peeked!.content).toBe('second');
    expect(stash.getSize()).toBe(2);
  });

  it('should return null on pop from empty stash', () => {
    const stash = new PromptStash();
    expect(stash.pop()).toBeNull();
  });

  it('should return null on peek from empty stash', () => {
    const stash = new PromptStash();
    expect(stash.peek()).toBeNull();
  });

  it('should get all stashed items', () => {
    const stash = new PromptStash();
    stash.push('a');
    stash.push('b');
    stash.push('c');
    const all = stash.getAll();
    expect(all.length).toBe(3);
    expect(all[0].content).toBe('a');
    expect(all[2].content).toBe('c');
  });

  it('should clear stash', () => {
    const stash = new PromptStash();
    stash.push('a');
    stash.push('b');
    stash.clear();
    expect(stash.isEmpty()).toBe(true);
  });

  it('should enforce max stash size', () => {
    const stash = new PromptStash(3);
    stash.push('a');
    stash.push('b');
    stash.push('c');
    stash.push('d');
    expect(stash.getSize()).toBe(3);
    expect(stash.getAll()[0].content).toBe('b');
  });

  it('should have unique IDs and timestamps', () => {
    const stash = new PromptStash();
    const a = stash.push('a');
    const b = stash.push('b');
    expect(a.id).not.toBe(b.id);
    expect(a.timestamp).toBeLessThanOrEqual(b.timestamp);
  });
});
