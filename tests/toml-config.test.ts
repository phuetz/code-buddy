/**
 * TOML Configuration Tests
 */

import {
  parseTOML,
  serializeTOML,
  DEFAULT_CONFIG,
  getConfigManager,
} from '../src/config/toml-config.js';

// ============================================================================
// TOML Parser Tests
// ============================================================================

describe('TOML Parser', () => {
  it('should parse root-level key-value pairs', () => {
    const toml = `
active_model = "grok-3"
max_turns = 100
enabled = true
ratio = 0.75
`;
    const result = parseTOML(toml);

    expect(result.active_model).toBe('grok-3');
    expect(result.max_turns).toBe(100);
    expect(result.enabled).toBe(true);
    expect(result.ratio).toBe(0.75);
  });

  it('should parse sections', () => {
    const toml = `
[ui]
theme = "dark"
show_tokens = true

[agent]
yolo_mode = false
`;
    const result = parseTOML(toml);

    expect(result.ui).toEqual({
      theme: 'dark',
      show_tokens: true,
    });
    expect(result.agent).toEqual({
      yolo_mode: false,
    });
  });

  it('should parse nested sections', () => {
    const toml = `
[providers.xai]
base_url = "https://api.x.ai/v1"
api_key_env = "GROK_API_KEY"
type = "xai"
enabled = true

[providers.anthropic]
api_key_env = "ANTHROPIC_API_KEY"
type = "anthropic"
`;
    const result = parseTOML(toml);

    expect(result.providers).toEqual({
      xai: {
        base_url: 'https://api.x.ai/v1',
        api_key_env: 'GROK_API_KEY',
        type: 'xai',
        enabled: true,
      },
      anthropic: {
        api_key_env: 'ANTHROPIC_API_KEY',
        type: 'anthropic',
      },
    });
  });

  it('should parse arrays', () => {
    const toml = `
[tool_config.bash]
permission = "ask"
allowlist = ["git .*", "npm .*", "cargo .*"]
denylist = ["rm -rf /", "sudo .*"]
`;
    const result = parseTOML(toml);
    const bashConfig = (result.tool_config as Record<string, unknown> | undefined)?.bash as Record<string, unknown> | undefined;

    expect(bashConfig?.permission).toBe('ask');
    expect(bashConfig?.allowlist).toEqual(['git .*', 'npm .*', 'cargo .*']);
    expect(bashConfig?.denylist).toEqual(['rm -rf /', 'sudo .*']);
  });

  it('should skip comments', () => {
    const toml = `
# This is a comment
active_model = "grok-3"
# Another comment
`;
    const result = parseTOML(toml);

    expect(result.active_model).toBe('grok-3');
    expect(Object.keys(result)).toEqual(['active_model']);
  });

  it('should handle empty input', () => {
    const result = parseTOML('');
    expect(result).toEqual({});
  });
});

// ============================================================================
// TOML Serializer Tests
// ============================================================================

describe('TOML Serializer', () => {
  it('should serialize default config', () => {
    const toml = serializeTOML(DEFAULT_CONFIG);

    expect(toml).toContain('active_model = "grok-code-fast"');
    expect(toml).toContain('[providers.xai]');
    expect(toml).toContain('[models.grok-code-fast]');
    expect(toml).toContain('[tool_config.bash]');
    expect(toml).toContain('[middleware]');
    expect(toml).toContain('[ui]');
    expect(toml).toContain('[agent]');
  });

  it('should serialize and parse back correctly', () => {
    const toml = serializeTOML(DEFAULT_CONFIG);
    const parsed = parseTOML(toml);

    expect(parsed.active_model).toBe(DEFAULT_CONFIG.active_model);
    expect((parsed.ui as Record<string, unknown>).streaming).toBe(DEFAULT_CONFIG.ui.streaming);
    expect((parsed.middleware as Record<string, unknown>).max_turns).toBe(DEFAULT_CONFIG.middleware.max_turns);
  });

  it('should include tool allowlist/denylist', () => {
    const toml = serializeTOML(DEFAULT_CONFIG);

    expect(toml).toContain('allowlist = [');
    expect(toml).toContain('denylist = [');
    expect(toml).toContain('"git .*"');
    expect(toml).toContain('"rm -rf /"');
  });
});

// ============================================================================
// Default Configuration Tests
// ============================================================================

describe('Default Configuration', () => {
  it('should have required providers', () => {
    expect(DEFAULT_CONFIG.providers.xai).toBeDefined();
    expect(DEFAULT_CONFIG.providers.anthropic).toBeDefined();
    expect(DEFAULT_CONFIG.providers.openai).toBeDefined();
    expect(DEFAULT_CONFIG.providers.google).toBeDefined();
  });

  it('should have required models', () => {
    expect(DEFAULT_CONFIG.models['grok-code-fast']).toBeDefined();
    expect(DEFAULT_CONFIG.models['grok-3']).toBeDefined();
    expect(DEFAULT_CONFIG.models['claude-sonnet']).toBeDefined();
    expect(DEFAULT_CONFIG.models['gpt-4o']).toBeDefined();
  });

  it('should have valid model configs', () => {
    const grokModel = DEFAULT_CONFIG.models['grok-code-fast'];

    expect(grokModel.provider).toBe('xai');
    expect(grokModel.price_per_m_input).toBeGreaterThanOrEqual(0);
    expect(grokModel.price_per_m_output).toBeGreaterThanOrEqual(0);
    expect(grokModel.max_context_tokens).toBeGreaterThan(0);
  });

  it('should have bash tool with security patterns', () => {
    const bashConfig = DEFAULT_CONFIG.tool_config.bash;

    expect(bashConfig.permission).toBe('ask');
    expect(bashConfig.allowlist?.length).toBeGreaterThan(0);
    expect(bashConfig.denylist?.length).toBeGreaterThan(0);
    expect(bashConfig.denylist).toContain('sudo .*');
  });

  it('should have sensible middleware defaults', () => {
    expect(DEFAULT_CONFIG.middleware.max_turns).toBe(100);
    expect(DEFAULT_CONFIG.middleware.max_cost).toBe(10.0);
    expect(DEFAULT_CONFIG.middleware.auto_compact_threshold).toBe(80000);
  });
});

// ============================================================================
// Config Manager Tests
// ============================================================================

describe('ConfigManager', () => {
  it('should return singleton instance', () => {
    const manager1 = getConfigManager();
    const manager2 = getConfigManager();

    expect(manager1).toBe(manager2);
  });

  it('should load default config', () => {
    const manager = getConfigManager();
    const config = manager.getConfig();

    expect(config.active_model).toBeDefined();
    expect(config.providers).toBeDefined();
    expect(config.models).toBeDefined();
  });

  it('should get active model', () => {
    const manager = getConfigManager();
    const model = manager.getActiveModel();

    expect(model.name).toBe(DEFAULT_CONFIG.active_model);
    expect(model.provider).toBeDefined();
    expect(model.max_context_tokens).toBeGreaterThan(0);
  });

  it('should get provider for model', () => {
    const manager = getConfigManager();
    const provider = manager.getProviderForModel('grok-code-fast');

    expect(provider.name).toBe('xai');
    expect(provider.api_key_env).toBe('GROK_API_KEY');
    expect(provider.type).toBe('xai');
  });

  it('should throw for unknown model', () => {
    const manager = getConfigManager();

    expect(() => manager.getProviderForModel('unknown-model')).toThrow();
  });

  it('should get tool config', () => {
    const manager = getConfigManager();
    const bashConfig = manager.getToolConfig('bash');

    expect(bashConfig).toBeDefined();
    expect(bashConfig?.permission).toBe('ask');
  });

  it('should return undefined for unknown tool', () => {
    const manager = getConfigManager();
    const config = manager.getToolConfig('unknown-tool');

    expect(config).toBeUndefined();
  });
});

// ============================================================================
// Tool Permission Tests
// ============================================================================

describe('Tool Permission Checking', () => {
  it('should allow commands matching allowlist', () => {
    const manager = getConfigManager();

    const result = manager.isToolCommandAllowed('bash', 'git status');
    expect(result.allowed).toBe(true);
  });

  it('should block commands matching denylist', () => {
    const manager = getConfigManager();

    const result = manager.isToolCommandAllowed('bash', 'rm -rf /');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Blocked');
  });

  it('should block sudo commands', () => {
    const manager = getConfigManager();

    const result = manager.isToolCommandAllowed('bash', 'sudo apt install');
    expect(result.allowed).toBe(false);
  });

  it('should allow tools without config', () => {
    const manager = getConfigManager();

    const result = manager.isToolCommandAllowed('unknown-tool', 'anything');
    expect(result.allowed).toBe(true);
  });

  it('should check denylist before allowlist', () => {
    const manager = getConfigManager();

    // This command matches "git .*" allowlist but should be blocked if it contains dangerous patterns
    const result = manager.isToolCommandAllowed('bash', 'sudo git push');
    expect(result.allowed).toBe(false);
  });
});

// ============================================================================
// Model Configuration Tests
// ============================================================================

describe('Model Configurations', () => {
  it('should have correct xAI model configs', () => {
    const grokFast = DEFAULT_CONFIG.models['grok-code-fast'];
    const grok3 = DEFAULT_CONFIG.models['grok-3'];

    expect(grokFast.provider).toBe('xai');
    expect(grok3.provider).toBe('xai');
    expect(grokFast.max_context_tokens).toBe(256000);
  });

  it('should have correct Anthropic model configs', () => {
    const sonnet = DEFAULT_CONFIG.models['claude-sonnet'];
    const opus = DEFAULT_CONFIG.models['claude-opus'];

    expect(sonnet.provider).toBe('anthropic');
    expect(opus.provider).toBe('anthropic');
    expect(opus.price_per_m_output).toBeGreaterThan(sonnet.price_per_m_output);
  });

  it('should have correct OpenAI model configs', () => {
    const gpt4o = DEFAULT_CONFIG.models['gpt-4o'];

    expect(gpt4o.provider).toBe('openai');
    expect(gpt4o.max_context_tokens).toBe(128000);
  });

  it('should have correct Google model configs', () => {
    const gemini = DEFAULT_CONFIG.models['gemini-2'];

    expect(gemini.provider).toBe('google');
    expect(gemini.price_per_m_input).toBeGreaterThanOrEqual(0);
    expect(gemini.max_context_tokens).toBe(1000000);
  });
});
