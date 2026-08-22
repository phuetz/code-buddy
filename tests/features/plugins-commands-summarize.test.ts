/**
 * Tests for Plugins, Commands, and Summarize Features
 *
 * Covers:
 * - Feature 1: Git-Pinned Plugin Marketplace
 * - Feature 2: Keybindings Command
 * - Feature 3: Session Commands (/rename, /tag)
 * - Feature 4: Partial Summarizer
 * - Feature 5: Auth Handler
 * - Feature 6: MCP Connectors
 */

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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Feature 1: Git-Pinned Plugin Marketplace
// ============================================================================

describe('GitPinnedMarketplace', () => {
  let GitPinnedMarketplace: typeof import('../../src/plugins/git-pinned-marketplace').GitPinnedMarketplace;
  let resetGitPinnedMarketplace: typeof import('../../src/plugins/git-pinned-marketplace').resetGitPinnedMarketplace;
  let tmpDir: string;

  beforeEach(async () => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpm-test-'));
    const mod = await import('../../src/plugins/git-pinned-marketplace');
    GitPinnedMarketplace = mod.GitPinnedMarketplace;
    resetGitPinnedMarketplace = mod.resetGitPinnedMarketplace;
    resetGitPinnedMarketplace();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('should install a plugin from org/repo spec', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    const plugin = mp.install('acme/cool-plugin');
    expect(plugin.name).toBe('acme/cool-plugin');
    expect(plugin.repo).toBe('https://github.com/acme/cool-plugin');
    expect(plugin.commitSha).toBe('HEAD');
    expect(plugin.verified).toBe(false);
    expect(plugin.installedAt).toBeGreaterThan(0);
  });

  it('should install a plugin with SHA pinning', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    const plugin = mp.install('acme/cool-plugin@abc123def');
    expect(plugin.commitSha).toBe('abc123def');
  });

  it('should throw on invalid repo spec', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    expect(() => mp.install('invalid')).toThrow('Invalid repo spec');
    expect(() => mp.install('')).toThrow('Invalid repo spec');
    expect(() => mp.install('a/b/c')).toThrow('Invalid repo spec');
  });

  it('should uninstall a plugin', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    mp.install('acme/cool-plugin');
    expect(mp.uninstall('acme/cool-plugin')).toBe(true);
    expect(mp.isInstalled('acme/cool-plugin')).toBe(false);
  });

  it('should return false when uninstalling non-existent plugin', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    expect(mp.uninstall('nonexistent/plugin')).toBe(false);
  });

  it('should list all installed plugins', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    mp.install('acme/plugin-a');
    mp.install('acme/plugin-b');
    const list = mp.list();
    expect(list).toHaveLength(2);
    expect(list.map(p => p.name)).toContain('acme/plugin-a');
    expect(list.map(p => p.name)).toContain('acme/plugin-b');
  });

  it('should verify a SHA-pinned plugin', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    mp.install('acme/plugin@abc123');
    expect(mp.verify('acme/plugin')).toBe(true);
    expect(mp.getPlugin('acme/plugin')?.verified).toBe(true);
  });

  it('should not verify a HEAD plugin', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    mp.install('acme/plugin');
    expect(mp.verify('acme/plugin')).toBe(false);
  });

  it('should return false verifying non-existent plugin', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    expect(mp.verify('nonexistent/plugin')).toBe(false);
  });

  it('should update a plugin', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    mp.install('acme/plugin@abc123');
    const updated = mp.update('acme/plugin');
    expect(updated).not.toBeNull();
    expect(updated!.commitSha).not.toBe('abc123');
    expect(updated!.commitSha).toMatch(/^updated-/);
    expect(updated!.verified).toBe(false);
  });

  it('should return null updating non-existent plugin', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    expect(mp.update('nonexistent/plugin')).toBeNull();
  });

  it('should get plugin info', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    mp.install('acme/plugin@sha256');
    const plugin = mp.getPlugin('acme/plugin');
    expect(plugin).toBeDefined();
    expect(plugin!.commitSha).toBe('sha256');
  });

  it('should return undefined for non-existent plugin', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    expect(mp.getPlugin('nonexistent')).toBeUndefined();
  });

  it('should generate trust warning', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    const warning = mp.getTrustWarning('acme/untrusted');
    expect(warning).toContain('WARNING');
    expect(warning).toContain('acme/untrusted');
    expect(warning).toContain('not verified');
  });

  it('should check isInstalled correctly', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    expect(mp.isInstalled('acme/plugin')).toBe(false);
    mp.install('acme/plugin');
    expect(mp.isInstalled('acme/plugin')).toBe(true);
  });

  it('should persist plugins to disk', () => {
    const mp = new GitPinnedMarketplace(tmpDir);
    mp.install('acme/persist-test@sha1');
    
    // Create new instance reading from same dir
    const mp2 = new GitPinnedMarketplace(tmpDir);
    expect(mp2.isInstalled('acme/persist-test')).toBe(true);
    expect(mp2.getPlugin('acme/persist-test')?.commitSha).toBe('sha1');
  });

  it('should use singleton pattern', () => {
    const a = GitPinnedMarketplace.getInstance(tmpDir);
    const b = GitPinnedMarketplace.getInstance(tmpDir);
    expect(a).toBe(b);
  });
});

// ============================================================================
// Feature 2: Keybindings Command
// ============================================================================

describe('KeybindingsManager', () => {
  let KeybindingsManager: typeof import('../../src/commands/handlers/keybindings-handler').KeybindingsManager;
  let resetKeybindingsManager: typeof import('../../src/commands/handlers/keybindings-handler').resetKeybindingsManager;
  let tmpDir: string;

  beforeEach(async () => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
    const mod = await import('../../src/commands/handlers/keybindings-handler');
    KeybindingsManager = mod.KeybindingsManager;
    resetKeybindingsManager = mod.resetKeybindingsManager;
    resetKeybindingsManager();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('should load defaults when no config file exists', () => {
    const mgr = new KeybindingsManager(tmpDir);
    const bindings = mgr.loadKeybindings();
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.find(b => b.key === 'ctrl+c')).toBeDefined();
  });

  it('should save and load keybindings', () => {
    const mgr = new KeybindingsManager(tmpDir);
    mgr.loadKeybindings();
    mgr.setBinding('ctrl+k', 'kill-line');
    mgr.saveKeybindings();

    const mgr2 = new KeybindingsManager(tmpDir);
    const loaded = mgr2.loadKeybindings();
    expect(loaded.find(b => b.key === 'ctrl+k')?.action).toBe('kill-line');
  });

  it('should set a binding with context', () => {
    const mgr = new KeybindingsManager(tmpDir);
    mgr.setBinding('ctrl+p', 'palette', 'editor');
    const binding = mgr.getBinding('ctrl+p');
    expect(binding).toBeDefined();
    expect(binding!.action).toBe('palette');
    expect(binding!.context).toBe('editor');
  });

  it('should remove a binding', () => {
    const mgr = new KeybindingsManager(tmpDir);
    mgr.loadKeybindings();
    expect(mgr.removeBinding('ctrl+c')).toBe(true);
    expect(mgr.getBinding('ctrl+c')).toBeUndefined();
  });

  it('should return false removing non-existent binding', () => {
    const mgr = new KeybindingsManager(tmpDir);
    expect(mgr.removeBinding('nonexistent')).toBe(false);
  });

  it('should list all bindings', () => {
    const mgr = new KeybindingsManager(tmpDir);
    mgr.setBinding('a', 'action-a');
    mgr.setBinding('b', 'action-b');
    const list = mgr.listBindings();
    expect(list).toHaveLength(2);
  });

  it('should return defaults', () => {
    const mgr = new KeybindingsManager(tmpDir);
    const defaults = mgr.getDefaults();
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults.find(b => b.key === 'ctrl+c')).toBeDefined();
  });

  it('should reset to defaults', () => {
    const mgr = new KeybindingsManager(tmpDir);
    mgr.setBinding('custom', 'custom-action');
    mgr.resetToDefaults();
    expect(mgr.getBinding('custom')).toBeUndefined();
    expect(mgr.getBinding('ctrl+c')).toBeDefined();
  });

  it('should format bindings table', () => {
    const mgr = new KeybindingsManager(tmpDir);
    mgr.loadKeybindings();
    const table = mgr.formatBindingsTable();
    expect(table).toContain('Key Bindings:');
    expect(table).toContain('ctrl+c');
    expect(table).toContain('cancel');
  });

  it('should format empty table', () => {
    const mgr = new KeybindingsManager(tmpDir);
    const table = mgr.formatBindingsTable();
    expect(table).toContain('No keybindings configured');
  });

  it('should use singleton pattern', () => {
    const a = KeybindingsManager.getInstance(tmpDir);
    const b = KeybindingsManager.getInstance(tmpDir);
    expect(a).toBe(b);
  });
});

// ============================================================================
// Feature 3: Session Commands
// ============================================================================

describe('SessionCommandHandler', () => {
  let SessionCommandHandler: typeof import('../../src/commands/handlers/session-commands').SessionCommandHandler;
  let handler: InstanceType<typeof import('../../src/commands/handlers/session-commands').SessionCommandHandler>;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/commands/handlers/session-commands');
    SessionCommandHandler = mod.SessionCommandHandler;
    handler = new SessionCommandHandler();
  });

  it('should rename a session with a provided name', () => {
    const name = handler.renameSession('sess-001', 'My Project');
    expect(name).toBe('My Project');
  });

  it('should auto-generate a name when none provided', () => {
    const name = handler.renameSession('sess-001');
    expect(name).toContain('session-');
    expect(name).toContain('sess-001'.substring(0, 8));
  });

  it('should tag a session', () => {
    const tags = handler.tagSession('sess-001', ['bug', 'urgent']);
    expect(tags).toContain('bug');
    expect(tags).toContain('urgent');
  });

  it('should normalize tags to lowercase', () => {
    const tags = handler.tagSession('sess-001', ['BUG', 'Urgent']);
    expect(tags).toContain('bug');
    expect(tags).toContain('urgent');
  });

  it('should not add duplicate tags', () => {
    handler.tagSession('sess-001', ['bug']);
    const tags = handler.tagSession('sess-001', ['bug', 'fix']);
    expect(tags.filter(t => t === 'bug')).toHaveLength(1);
    expect(tags).toContain('fix');
  });

  it('should remove a tag', () => {
    handler.tagSession('sess-001', ['bug', 'fix']);
    expect(handler.removeTag('sess-001', 'bug')).toBe(true);
    expect(handler.getSessionTags('sess-001')).not.toContain('bug');
  });

  it('should return false removing non-existent tag', () => {
    handler.tagSession('sess-001', ['bug']);
    expect(handler.removeTag('sess-001', 'nonexistent')).toBe(false);
  });

  it('should return false removing tag from non-existent session', () => {
    expect(handler.removeTag('nonexistent', 'bug')).toBe(false);
  });

  it('should get session tags', () => {
    handler.tagSession('sess-001', ['a', 'b', 'c']);
    expect(handler.getSessionTags('sess-001')).toEqual(['a', 'b', 'c']);
  });

  it('should return empty tags for unknown session', () => {
    expect(handler.getSessionTags('unknown')).toEqual([]);
  });

  it('should search by tag', () => {
    handler.tagSession('sess-001', ['bug']);
    handler.tagSession('sess-002', ['bug', 'fix']);
    handler.tagSession('sess-003', ['feature']);
    const results = handler.searchByTag('bug');
    expect(results).toContain('sess-001');
    expect(results).toContain('sess-002');
    expect(results).not.toContain('sess-003');
  });

  it('should generate session name from messages', () => {
    const messages = [
      { role: 'user', content: 'Fix the authentication module login flow' },
      { role: 'assistant', content: 'I will fix the authentication module login flow for you' },
    ];
    const name = handler.generateSessionName(messages);
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toBe('empty-session');
  });

  it('should return empty-session for no messages', () => {
    expect(handler.generateSessionName([])).toBe('empty-session');
  });

  it('should return unnamed-session for messages with no keywords', () => {
    const name = handler.generateSessionName([{ content: 'a b c' }]);
    expect(name).toBe('unnamed-session');
  });

  it('should format session info', () => {
    handler.renameSession('sess-001', 'My Session');
    handler.tagSession('sess-001', ['bug', 'fix']);
    const info = handler.formatSessionInfo('sess-001');
    expect(info).toContain('sess-001');
    expect(info).toContain('My Session');
    expect(info).toContain('bug');
    expect(info).toContain('fix');
  });

  it('should format info for unknown session', () => {
    const info = handler.formatSessionInfo('unknown');
    expect(info).toContain('unknown');
    expect(info).toContain('no metadata');
  });
});

// ============================================================================
// Feature 4: Partial Summarizer
// ============================================================================

describe('PartialSummarizer', () => {
  let PartialSummarizer: typeof import('../../src/context/partial-summarizer').PartialSummarizer;
  let resetPartialSummarizer: typeof import('../../src/context/partial-summarizer').resetPartialSummarizer;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/context/partial-summarizer');
    PartialSummarizer = mod.PartialSummarizer;
    resetPartialSummarizer = mod.resetPartialSummarizer;
    resetPartialSummarizer();
  });

  it('should summarize from a given index', () => {
    const summarizer = new PartialSummarizer();
    const messages = [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'How can I help you today?' },
      { role: 'user', content: 'Fix the authentication module' },
      { role: 'assistant', content: 'I will fix the authentication module now' },
    ];
    const summary = summarizer.summarizeFrom(messages, 2);
    expect(summary).toContain('Summary of 2 messages');
  });

  it('should return empty for out-of-bounds fromIndex', () => {
    const summarizer = new PartialSummarizer();
    expect(summarizer.summarizeFrom([{ content: 'test' }], 5)).toBe('');
    expect(summarizer.summarizeFrom([{ content: 'test' }], -1)).toBe('');
  });

  it('should summarize a specific range', () => {
    const summarizer = new PartialSummarizer();
    const messages = [
      { role: 'user', content: 'message one' },
      { role: 'user', content: 'message two about authentication' },
      { role: 'assistant', content: 'message three about authentication fix' },
      { role: 'user', content: 'message four' },
    ];
    const summary = summarizer.summarizeRange(messages, 1, 3);
    expect(summary).toContain('Summary of 2 messages');
  });

  it('should return empty for invalid range', () => {
    const summarizer = new PartialSummarizer();
    expect(summarizer.summarizeRange([{ content: 'test' }], 5, 3)).toBe('');
  });

  it('should generate summary with key topics', () => {
    const summarizer = new PartialSummarizer();
    const messages = [
      { role: 'user', content: 'authentication authentication authentication login login module' },
      { role: 'assistant', content: 'authentication module login implementation ready' },
    ];
    const summary = summarizer.generateSummary(messages);
    expect(summary).toContain('Key topics:');
    expect(summary).toContain('authentication');
  });

  it('should return empty for no messages', () => {
    const summarizer = new PartialSummarizer();
    expect(summarizer.generateSummary([])).toBe('');
  });

  it('should track message count', () => {
    const summarizer = new PartialSummarizer();
    const messages = [
      { role: 'user', content: 'message one about testing' },
      { role: 'assistant', content: 'message two about testing' },
      { role: 'user', content: 'message three about testing' },
    ];
    summarizer.generateSummary(messages);
    expect(summarizer.getMessageCount()).toBe(3);
  });

  it('should track tokens saved', () => {
    const summarizer = new PartialSummarizer();
    const messages = [
      { role: 'user', content: 'This is a fairly long message about authentication modules and login flows that should result in some token savings when summarized into key topics' },
      { role: 'assistant', content: 'Another fairly long message about implementing the authentication module with proper validation and error handling for all edge cases' },
    ];
    summarizer.generateSummary(messages);
    expect(summarizer.getTokensSaved()).toBeGreaterThan(0);
  });

  it('should handle string messages', () => {
    const summarizer = new PartialSummarizer();
    const summary = summarizer.generateSummary(['hello world testing', 'another testing message here']);
    expect(summary).toContain('Summary of 2 messages');
  });

  it('should use singleton pattern', () => {
    const a = PartialSummarizer.getInstance();
    const b = PartialSummarizer.getInstance();
    expect(a).toBe(b);
  });

  it('should include role groups in summary', () => {
    const summarizer = new PartialSummarizer();
    const messages = [
      { role: 'user', content: 'testing user message here' },
      { role: 'assistant', content: 'testing assistant response here' },
    ];
    const summary = summarizer.generateSummary(messages);
    expect(summary).toContain('user: 1 message(s)');
    expect(summary).toContain('assistant: 1 message(s)');
  });
});

// ============================================================================
// Feature 5: Auth Handler
// ============================================================================

describe('AuthHandler', () => {
  let AuthHandler: typeof import('../../src/commands/handlers/auth-handler').AuthHandler;
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
    const mod = await import('../../src/commands/handlers/auth-handler');
    AuthHandler = mod.AuthHandler;

    // Save and clear env vars
    for (const key of ['GROK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) {
        process.env[key] = val;
      } else {
        delete process.env[key];
      }
    }
  });

  it('should login with env var present', () => {
    process.env.GROK_API_KEY = 'xai-test-key-12345';
    const handler = new AuthHandler(tmpDir);
    const result = handler.login('grok');
    expect(result.success).toBe(true);
    expect(result.provider).toBe('grok');
    expect(result.message).toContain('Successfully authenticated');
  });

  it('should fail login without env var', () => {
    const handler = new AuthHandler(tmpDir);
    const result = handler.login('grok');
    expect(result.success).toBe(false);
    expect(result.message).toContain('GROK_API_KEY');
  });

  it('should fail login for unknown provider', () => {
    const handler = new AuthHandler(tmpDir);
    const result = handler.login('unknown-provider');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown provider');
  });

  it('should default to grok provider', () => {
    process.env.GROK_API_KEY = 'xai-test-key-12345';
    const handler = new AuthHandler(tmpDir);
    const result = handler.login();
    expect(result.provider).toBe('grok');
    expect(result.success).toBe(true);
  });

  it('should logout from specific provider', () => {
    process.env.GROK_API_KEY = 'xai-test-key-12345';
    const handler = new AuthHandler(tmpDir);
    handler.login('grok');
    const result = handler.logout('grok');
    expect(result.success).toBe(true);
    expect(result.message).toContain('Logged out from grok');
  });

  it('should fail logout for non-authenticated provider', () => {
    const handler = new AuthHandler(tmpDir);
    const result = handler.logout('grok');
    expect(result.success).toBe(false);
  });

  it('should logout from all providers', () => {
    process.env.GROK_API_KEY = 'xai-test-key-12345';
    process.env.OPENAI_API_KEY = 'sk-test-12345';
    const handler = new AuthHandler(tmpDir);
    handler.login('grok');
    handler.login('openai');
    const result = handler.logout();
    expect(result.success).toBe(true);
    expect(result.message).toContain('2 provider(s)');
  });

  it('should return status for all providers', () => {
    const handler = new AuthHandler(tmpDir);
    const statuses = handler.status();
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every(s => 'authenticated' in s && 'provider' in s)).toBe(true);
  });

  it('should get provider status with key prefix', () => {
    process.env.GROK_API_KEY = 'xai-test-key-12345';
    const handler = new AuthHandler(tmpDir);
    handler.login('grok');
    const status = handler.getProviderStatus('grok');
    expect(status.authenticated).toBe(true);
    expect(status.keyPrefix).toContain('xai-test');
    expect(status.keyPrefix).toContain('...');
  });

  it('should list known providers', () => {
    const handler = new AuthHandler(tmpDir);
    const providers = handler.listProviders();
    expect(providers).toContain('grok');
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
  });

  it('should format status table', () => {
    const handler = new AuthHandler(tmpDir);
    const table = handler.formatStatusTable();
    expect(table).toContain('Authentication Status:');
    expect(table).toContain('Provider');
    expect(table).toContain('grok');
  });

  it('should persist credentials to disk', () => {
    process.env.GROK_API_KEY = 'xai-test-key-12345';
    const handler1 = new AuthHandler(tmpDir);
    handler1.login('grok');

    const handler2 = new AuthHandler(tmpDir);
    const status = handler2.getProviderStatus('grok');
    expect(status.authenticated).toBe(true);
  });
});

// ============================================================================
// Feature 6: MCP Connectors
// ============================================================================

describe('ConnectorRegistry', () => {
  let ConnectorRegistry: typeof import('../../src/mcp/connectors').ConnectorRegistry;
  let resetConnectorRegistry: typeof import('../../src/mcp/connectors').resetConnectorRegistry;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/mcp/connectors');
    ConnectorRegistry = mod.ConnectorRegistry;
    resetConnectorRegistry = mod.resetConnectorRegistry;
    resetConnectorRegistry();

    // Clear connector env vars
    for (const key of ['GITHUB_TOKEN', 'SLACK_BOT_TOKEN', 'LINEAR_API_KEY', 'NOTION_API_KEY', 'ASANA_ACCESS_TOKEN', 'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) {
        process.env[key] = val;
      } else {
        delete process.env[key];
      }
    }
  });

  it('should return all available connectors', () => {
    const registry = new ConnectorRegistry();
    const connectors = registry.getAvailableConnectors();
    expect(connectors.length).toBe(6);
    const names = connectors.map(c => c.name);
    expect(names).toContain('google-calendar');
    expect(names).toContain('linear');
    expect(names).toContain('notion');
    expect(names).toContain('asana');
    expect(names).toContain('github');
    expect(names).toContain('slack');
  });

  it('should get a specific connector', () => {
    const registry = new ConnectorRegistry();
    const connector = registry.getConnector('github');
    expect(connector).toBeDefined();
    expect(connector!.name).toBe('github');
    expect(connector!.type).toBe('version-control');
    expect(connector!.requiredEnvVars).toContain('GITHUB_TOKEN');
  });

  it('should return undefined for unknown connector', () => {
    const registry = new ConnectorRegistry();
    expect(registry.getConnector('nonexistent')).toBeUndefined();
  });

  it('should check if connector is configured', () => {
    const registry = new ConnectorRegistry();
    expect(registry.isConfigured('github')).toBe(false);

    process.env.GITHUB_TOKEN = 'ghp_test123';
    expect(registry.isConfigured('github')).toBe(true);
  });

  it('should return false for unknown connector isConfigured', () => {
    const registry = new ConnectorRegistry();
    expect(registry.isConfigured('nonexistent')).toBe(false);
  });

  it('should require all env vars for multi-var connector', () => {
    const registry = new ConnectorRegistry();
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'id123';
    expect(registry.isConfigured('google-calendar')).toBe(false);

    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'secret456';
    expect(registry.isConfigured('google-calendar')).toBe(true);
  });

  it('should get setup instructions', () => {
    const registry = new ConnectorRegistry();
    const instructions = registry.getSetupInstructions('github');
    expect(instructions).toBeDefined();
    expect(instructions).toContain('GITHUB_TOKEN');
  });

  it('should return undefined instructions for unknown connector', () => {
    const registry = new ConnectorRegistry();
    expect(registry.getSetupInstructions('nonexistent')).toBeUndefined();
  });

  it('should list configured connectors', () => {
    const registry = new ConnectorRegistry();
    expect(registry.listConfigured()).toHaveLength(0);

    process.env.GITHUB_TOKEN = 'ghp_test123';
    const configured = registry.listConfigured();
    expect(configured).toHaveLength(1);
    expect(configured[0].name).toBe('github');
  });

  it('should list unconfigured connectors', () => {
    const registry = new ConnectorRegistry();
    const unconfigured = registry.listUnconfigured();
    expect(unconfigured).toHaveLength(6);

    process.env.GITHUB_TOKEN = 'ghp_test123';
    expect(registry.listUnconfigured()).toHaveLength(5);
  });

  it('should have valid mcpServerConfig for all connectors', () => {
    const registry = new ConnectorRegistry();
    for (const connector of registry.getAvailableConnectors()) {
      expect(connector.mcpServerConfig).toBeDefined();
      expect(connector.mcpServerConfig.command).toBe('npx');
      expect(connector.description.length).toBeGreaterThan(0);
    }
  });

  it('should use singleton pattern', () => {
    const a = ConnectorRegistry.getInstance();
    const b = ConnectorRegistry.getInstance();
    expect(a).toBe(b);
  });
});
