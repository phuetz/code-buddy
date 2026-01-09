/**
 * Comprehensive Unit Tests for Config Module
 *
 * Tests cover:
 * - Configuration loading from files
 * - Environment variable handling
 * - Default configuration values
 * - Configuration validation
 * - Provider-specific settings
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import config modules
import {
  parseTOML,
  serializeTOML,
  DEFAULT_CONFIG,
  getConfigManager,
  CodeBuddyConfig,
  ProviderConfig,
  ModelConfig,
  ToolConfig,
  MiddlewareConfigOptions,
  UIConfig,
  AgentBehaviorConfig,
} from '../../src/config/toml-config';

import {
  AGENT_CONFIG,
  SEARCH_CONFIG,
  TEXT_EDITOR_CONFIG,
  BASH_CONFIG,
  UI_CONFIG,
  API_CONFIG,
  PATHS,
  SUPPORTED_MODELS,
  TOKEN_LIMITS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../../src/config/constants';

import {
  FeatureFlagsManager,
  getFeatureFlags,
  resetFeatureFlags,
  isFeatureEnabled,
  enableFeature,
  disableFeature,
  FeatureFlag,
  FeatureCategory,
} from '../../src/config/feature-flags';

import {
  CodeBuddyRulesManager,
  getCodeBuddyRulesManager,
  initializeCodeBuddyRules,
  resetCodeBuddyRulesManager,
  CodeBuddyRules,
} from '../../src/config/codebuddyrules';

// ============================================================================
// Test Setup and Helpers
// ============================================================================

describe('Config Module', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Create temp directory for file-based tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));

    // Reset singletons
    resetFeatureFlags();
    resetCodeBuddyRulesManager();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Reset singletons
    resetFeatureFlags();
    resetCodeBuddyRulesManager();
  });

  // ============================================================================
  // TOML Configuration Tests
  // ============================================================================

  describe('TOML Configuration', () => {
    describe('parseTOML', () => {
      it('should parse empty input', () => {
        const result = parseTOML('');
        expect(result).toEqual({});
      });

      it('should parse root-level string values', () => {
        const toml = 'active_model = "grok-3"';
        const result = parseTOML(toml);
        expect(result.active_model).toBe('grok-3');
      });

      it('should parse integer values', () => {
        const toml = 'max_turns = 100';
        const result = parseTOML(toml);
        expect(result.max_turns).toBe(100);
      });

      it('should parse negative integer values', () => {
        const toml = 'offset = -10';
        const result = parseTOML(toml);
        expect(result.offset).toBe(-10);
      });

      it('should parse float values', () => {
        const toml = 'ratio = 0.75';
        const result = parseTOML(toml);
        expect(result.ratio).toBe(0.75);
      });

      it('should parse negative float values', () => {
        const toml = 'delta = -3.14';
        const result = parseTOML(toml);
        expect(result.delta).toBe(-3.14);
      });

      it('should parse boolean true', () => {
        const toml = 'enabled = true';
        const result = parseTOML(toml);
        expect(result.enabled).toBe(true);
      });

      it('should parse boolean false', () => {
        const toml = 'disabled = false';
        const result = parseTOML(toml);
        expect(result.disabled).toBe(false);
      });

      it('should parse simple arrays', () => {
        const toml = 'items = ["a", "b", "c"]';
        const result = parseTOML(toml);
        expect(result.items).toEqual(['a', 'b', 'c']);
      });

      it('should parse empty arrays', () => {
        const toml = 'items = []';
        const result = parseTOML(toml);
        expect(result.items).toEqual([]);
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

      it('should skip empty lines', () => {
        const toml = `
active_model = "grok-3"

enabled = true
`;
        const result = parseTOML(toml);
        expect(result.active_model).toBe('grok-3');
        expect(result.enabled).toBe(true);
      });

      it('should parse simple sections', () => {
        const toml = `
[ui]
theme = "dark"
show_tokens = true
`;
        const result = parseTOML(toml);
        expect(result.ui).toEqual({
          theme: 'dark',
          show_tokens: true,
        });
      });

      it('should parse multiple sections', () => {
        const toml = `
[ui]
theme = "dark"

[agent]
yolo_mode = false
`;
        const result = parseTOML(toml);
        expect(result.ui).toEqual({ theme: 'dark' });
        expect(result.agent).toEqual({ yolo_mode: false });
      });

      it('should parse nested sections with dot notation', () => {
        const toml = `
[providers.xai]
base_url = "https://api.x.ai/v1"
api_key_env = "GROK_API_KEY"
type = "xai"
enabled = true
`;
        const result = parseTOML(toml);
        expect(result.providers).toEqual({
          xai: {
            base_url: 'https://api.x.ai/v1',
            api_key_env: 'GROK_API_KEY',
            type: 'xai',
            enabled: true,
          },
        });
      });

      it('should parse multiple nested sections', () => {
        const toml = `
[providers.xai]
type = "xai"

[providers.anthropic]
type = "anthropic"
`;
        const result = parseTOML(toml);
        const providers = result.providers as Record<string, unknown>;
        expect(providers.xai).toEqual({ type: 'xai' });
        expect(providers.anthropic).toEqual({ type: 'anthropic' });
      });

      it('should parse arrays within sections', () => {
        const toml = `
[tool_config.bash]
permission = "ask"
allowlist = ["git .*", "npm .*"]
denylist = ["rm -rf /", "sudo .*"]
`;
        const result = parseTOML(toml);
        const toolConfig = result.tool_config as Record<string, Record<string, unknown>>;
        expect(toolConfig.bash.permission).toBe('ask');
        expect(toolConfig.bash.allowlist).toEqual(['git .*', 'npm .*']);
        expect(toolConfig.bash.denylist).toEqual(['rm -rf /', 'sudo .*']);
      });
    });

    describe('serializeTOML', () => {
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

      it('should include header comment', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);

        expect(toml).toContain('# Grok CLI Configuration');
      });

      it('should serialize provider configurations', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);

        expect(toml).toContain('base_url = "https://api.x.ai/v1"');
        expect(toml).toContain('api_key_env = "GROK_API_KEY"');
        expect(toml).toContain('type = "xai"');
      });

      it('should serialize model configurations', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);

        expect(toml).toContain('provider = "xai"');
        expect(toml).toContain('price_per_m_input');
        expect(toml).toContain('max_context_tokens');
      });

      it('should serialize tool allowlist and denylist', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);

        expect(toml).toContain('allowlist = [');
        expect(toml).toContain('denylist = [');
        expect(toml).toContain('"git .*"');
      });

      it('should serialize middleware settings', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);

        expect(toml).toContain('max_turns = 100');
        expect(toml).toContain('max_cost = 10');
      });

      it('should serialize UI settings', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);

        expect(toml).toContain('vim_keybindings = false');
        expect(toml).toContain('theme = "default"');
        expect(toml).toContain('streaming = true');
      });

      it('should serialize agent settings', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);

        expect(toml).toContain('yolo_mode = false');
        expect(toml).toContain('parallel_tools = false');
        expect(toml).toContain('rag_tool_selection = true');
      });

      it('should produce parseable output', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);
        const parsed = parseTOML(toml);

        expect(parsed.active_model).toBe(DEFAULT_CONFIG.active_model);
      });
    });

    describe('Round-trip serialization', () => {
      it('should preserve active_model through round-trip', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);
        const parsed = parseTOML(toml);

        expect(parsed.active_model).toBe(DEFAULT_CONFIG.active_model);
      });

      it('should preserve UI settings through round-trip', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);
        const parsed = parseTOML(toml);
        const ui = parsed.ui as Record<string, unknown>;

        expect(ui.streaming).toBe(DEFAULT_CONFIG.ui.streaming);
        expect(ui.show_tokens).toBe(DEFAULT_CONFIG.ui.show_tokens);
      });

      it('should preserve middleware settings through round-trip', () => {
        const toml = serializeTOML(DEFAULT_CONFIG);
        const parsed = parseTOML(toml);
        const middleware = parsed.middleware as Record<string, unknown>;

        expect(middleware.max_turns).toBe(DEFAULT_CONFIG.middleware.max_turns);
        expect(middleware.max_cost).toBe(DEFAULT_CONFIG.middleware.max_cost);
      });
    });
  });

  // ============================================================================
  // Default Configuration Tests
  // ============================================================================

  describe('Default Configuration Values', () => {
    describe('Provider defaults', () => {
      it('should have xAI provider configured', () => {
        expect(DEFAULT_CONFIG.providers.xai).toBeDefined();
        expect(DEFAULT_CONFIG.providers.xai.type).toBe('xai');
        expect(DEFAULT_CONFIG.providers.xai.api_key_env).toBe('GROK_API_KEY');
        expect(DEFAULT_CONFIG.providers.xai.base_url).toBe('https://api.x.ai/v1');
        expect(DEFAULT_CONFIG.providers.xai.enabled).toBe(true);
      });

      it('should have Anthropic provider configured', () => {
        expect(DEFAULT_CONFIG.providers.anthropic).toBeDefined();
        expect(DEFAULT_CONFIG.providers.anthropic.type).toBe('anthropic');
        expect(DEFAULT_CONFIG.providers.anthropic.api_key_env).toBe('ANTHROPIC_API_KEY');
      });

      it('should have OpenAI provider configured', () => {
        expect(DEFAULT_CONFIG.providers.openai).toBeDefined();
        expect(DEFAULT_CONFIG.providers.openai.type).toBe('openai');
        expect(DEFAULT_CONFIG.providers.openai.api_key_env).toBe('OPENAI_API_KEY');
      });

      it('should have Google provider configured', () => {
        expect(DEFAULT_CONFIG.providers.google).toBeDefined();
        expect(DEFAULT_CONFIG.providers.google.type).toBe('google');
        expect(DEFAULT_CONFIG.providers.google.api_key_env).toBe('GOOGLE_API_KEY');
      });

      it('should have all providers enabled by default', () => {
        Object.values(DEFAULT_CONFIG.providers).forEach(provider => {
          expect(provider.enabled).toBe(true);
        });
      });
    });

    describe('Model defaults', () => {
      it('should have grok-code-fast as default active model', () => {
        expect(DEFAULT_CONFIG.active_model).toBe('grok-code-fast');
      });

      it('should have grok-code-fast model configured', () => {
        const model = DEFAULT_CONFIG.models['grok-code-fast'];
        expect(model).toBeDefined();
        expect(model.provider).toBe('xai');
        expect(model.price_per_m_input).toBeGreaterThanOrEqual(0);
        expect(model.price_per_m_output).toBeGreaterThanOrEqual(0);
        expect(model.max_context_tokens).toBeGreaterThan(0);
      });

      it('should have grok-3 model configured', () => {
        expect(DEFAULT_CONFIG.models['grok-3']).toBeDefined();
        expect(DEFAULT_CONFIG.models['grok-3'].provider).toBe('xai');
      });

      it('should have claude-sonnet model configured', () => {
        expect(DEFAULT_CONFIG.models['claude-sonnet']).toBeDefined();
        expect(DEFAULT_CONFIG.models['claude-sonnet'].provider).toBe('anthropic');
      });

      it('should have claude-opus model configured', () => {
        expect(DEFAULT_CONFIG.models['claude-opus']).toBeDefined();
        expect(DEFAULT_CONFIG.models['claude-opus'].provider).toBe('anthropic');
      });

      it('should have gpt-4o model configured', () => {
        expect(DEFAULT_CONFIG.models['gpt-4o']).toBeDefined();
        expect(DEFAULT_CONFIG.models['gpt-4o'].provider).toBe('openai');
      });

      it('should have gemini-2 model configured', () => {
        expect(DEFAULT_CONFIG.models['gemini-2']).toBeDefined();
        expect(DEFAULT_CONFIG.models['gemini-2'].provider).toBe('google');
      });

      it('should have valid pricing for all models', () => {
        Object.values(DEFAULT_CONFIG.models).forEach(model => {
          expect(model.price_per_m_input).toBeGreaterThanOrEqual(0);
          expect(model.price_per_m_output).toBeGreaterThanOrEqual(0);
        });
      });

      it('should have valid context limits for all models', () => {
        Object.values(DEFAULT_CONFIG.models).forEach(model => {
          expect(model.max_context_tokens).toBeGreaterThan(0);
        });
      });
    });

    describe('Tool config defaults', () => {
      it('should have bash tool configured with ask permission', () => {
        expect(DEFAULT_CONFIG.tool_config.bash).toBeDefined();
        expect(DEFAULT_CONFIG.tool_config.bash.permission).toBe('ask');
      });

      it('should have bash tool with allowlist', () => {
        expect(DEFAULT_CONFIG.tool_config.bash.allowlist).toBeDefined();
        expect(DEFAULT_CONFIG.tool_config.bash.allowlist!.length).toBeGreaterThan(0);
      });

      it('should have bash tool with denylist', () => {
        expect(DEFAULT_CONFIG.tool_config.bash.denylist).toBeDefined();
        expect(DEFAULT_CONFIG.tool_config.bash.denylist!.length).toBeGreaterThan(0);
      });

      it('should block dangerous commands in bash denylist', () => {
        const denylist = DEFAULT_CONFIG.tool_config.bash.denylist!;
        expect(denylist).toContain('rm -rf /');
        expect(denylist).toContain('sudo .*');
      });

      it('should have view_file tool with always permission', () => {
        expect(DEFAULT_CONFIG.tool_config.view_file).toBeDefined();
        expect(DEFAULT_CONFIG.tool_config.view_file.permission).toBe('always');
      });

      it('should have search tool with always permission', () => {
        expect(DEFAULT_CONFIG.tool_config.search).toBeDefined();
        expect(DEFAULT_CONFIG.tool_config.search.permission).toBe('always');
      });

      it('should have str_replace_editor tool with ask permission', () => {
        expect(DEFAULT_CONFIG.tool_config.str_replace_editor).toBeDefined();
        expect(DEFAULT_CONFIG.tool_config.str_replace_editor.permission).toBe('ask');
      });
    });

    describe('Middleware defaults', () => {
      it('should have max_turns of 100', () => {
        expect(DEFAULT_CONFIG.middleware.max_turns).toBe(100);
      });

      it('should have max_cost of 10.0', () => {
        expect(DEFAULT_CONFIG.middleware.max_cost).toBe(10.0);
      });

      it('should have auto_compact_threshold of 80000', () => {
        expect(DEFAULT_CONFIG.middleware.auto_compact_threshold).toBe(80000);
      });

      it('should have warning thresholds set', () => {
        expect(DEFAULT_CONFIG.middleware.turn_warning_threshold).toBe(0.8);
        expect(DEFAULT_CONFIG.middleware.cost_warning_threshold).toBe(0.8);
        expect(DEFAULT_CONFIG.middleware.context_warning_percentage).toBe(0.7);
      });
    });

    describe('UI defaults', () => {
      it('should have vim_keybindings disabled by default', () => {
        expect(DEFAULT_CONFIG.ui.vim_keybindings).toBe(false);
      });

      it('should have default theme set', () => {
        expect(DEFAULT_CONFIG.ui.theme).toBe('default');
      });

      it('should have show_tokens enabled', () => {
        expect(DEFAULT_CONFIG.ui.show_tokens).toBe(true);
      });

      it('should have show_cost enabled', () => {
        expect(DEFAULT_CONFIG.ui.show_cost).toBe(true);
      });

      it('should have streaming enabled', () => {
        expect(DEFAULT_CONFIG.ui.streaming).toBe(true);
      });

      it('should have sound_effects disabled', () => {
        expect(DEFAULT_CONFIG.ui.sound_effects).toBe(false);
      });
    });

    describe('Agent defaults', () => {
      it('should have yolo_mode disabled', () => {
        expect(DEFAULT_CONFIG.agent.yolo_mode).toBe(false);
      });

      it('should have parallel_tools disabled', () => {
        expect(DEFAULT_CONFIG.agent.parallel_tools).toBe(false);
      });

      it('should have rag_tool_selection enabled', () => {
        expect(DEFAULT_CONFIG.agent.rag_tool_selection).toBe(true);
      });

      it('should have self_healing enabled', () => {
        expect(DEFAULT_CONFIG.agent.self_healing).toBe(true);
      });

      it('should have default_prompt set to default', () => {
        expect(DEFAULT_CONFIG.agent.default_prompt).toBe('default');
      });
    });
  });

  // ============================================================================
  // Constants Tests
  // ============================================================================

  describe('Configuration Constants', () => {
    describe('AGENT_CONFIG', () => {
      it('should have MAX_TOOL_ROUNDS defined', () => {
        expect(AGENT_CONFIG.MAX_TOOL_ROUNDS).toBeDefined();
        expect(AGENT_CONFIG.MAX_TOOL_ROUNDS).toBeGreaterThan(0);
      });

      it('should have DEFAULT_TEMPERATURE defined', () => {
        expect(AGENT_CONFIG.DEFAULT_TEMPERATURE).toBeDefined();
        expect(AGENT_CONFIG.DEFAULT_TEMPERATURE).toBeGreaterThan(0);
        expect(AGENT_CONFIG.DEFAULT_TEMPERATURE).toBeLessThanOrEqual(2);
      });

      it('should have AGENT_TIMEOUT defined', () => {
        expect(AGENT_CONFIG.AGENT_TIMEOUT).toBeDefined();
        expect(AGENT_CONFIG.AGENT_TIMEOUT).toBeGreaterThan(0);
      });
    });

    describe('SEARCH_CONFIG', () => {
      it('should have MAX_DEPTH defined', () => {
        expect(SEARCH_CONFIG.MAX_DEPTH).toBeDefined();
        expect(SEARCH_CONFIG.MAX_DEPTH).toBeGreaterThan(0);
      });

      it('should have context line settings', () => {
        expect(SEARCH_CONFIG.CONTEXT_BEFORE).toBeDefined();
        expect(SEARCH_CONFIG.CONTEXT_AFTER).toBeDefined();
      });

      it('should have MAX_RESULTS defined', () => {
        expect(SEARCH_CONFIG.MAX_RESULTS).toBeDefined();
        expect(SEARCH_CONFIG.MAX_RESULTS).toBeGreaterThan(0);
      });
    });

    describe('TEXT_EDITOR_CONFIG', () => {
      it('should have SIMILARITY_THRESHOLD between 0 and 1', () => {
        expect(TEXT_EDITOR_CONFIG.SIMILARITY_THRESHOLD).toBeGreaterThan(0);
        expect(TEXT_EDITOR_CONFIG.SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
      });

      it('should have MAX_FILE_SIZE defined', () => {
        expect(TEXT_EDITOR_CONFIG.MAX_FILE_SIZE).toBeDefined();
        expect(TEXT_EDITOR_CONFIG.MAX_FILE_SIZE).toBeGreaterThan(0);
      });
    });

    describe('BASH_CONFIG', () => {
      it('should have COMMAND_TIMEOUT defined', () => {
        expect(BASH_CONFIG.COMMAND_TIMEOUT).toBeDefined();
        expect(BASH_CONFIG.COMMAND_TIMEOUT).toBeGreaterThan(0);
      });

      it('should have DANGEROUS_COMMANDS list', () => {
        expect(BASH_CONFIG.DANGEROUS_COMMANDS).toBeDefined();
        expect(BASH_CONFIG.DANGEROUS_COMMANDS.length).toBeGreaterThan(0);
        expect(BASH_CONFIG.DANGEROUS_COMMANDS).toContain('rm');
      });

      it('should have BLOCKED_COMMANDS list', () => {
        expect(BASH_CONFIG.BLOCKED_COMMANDS).toBeDefined();
        expect(BASH_CONFIG.BLOCKED_COMMANDS.length).toBeGreaterThan(0);
      });
    });

    describe('API_CONFIG', () => {
      it('should have DEFAULT_BASE_URL defined', () => {
        expect(API_CONFIG.DEFAULT_BASE_URL).toBeDefined();
        expect(API_CONFIG.DEFAULT_BASE_URL).toContain('x.ai');
      });

      it('should have DEFAULT_MODEL defined', () => {
        expect(API_CONFIG.DEFAULT_MODEL).toBeDefined();
      });

      it('should have REQUEST_TIMEOUT defined', () => {
        expect(API_CONFIG.REQUEST_TIMEOUT).toBeDefined();
        expect(API_CONFIG.REQUEST_TIMEOUT).toBeGreaterThan(0);
      });

      it('should have retry settings', () => {
        expect(API_CONFIG.MAX_RETRIES).toBeDefined();
        expect(API_CONFIG.RETRY_DELAY).toBeDefined();
      });

      it('should have local provider URLs', () => {
        expect(API_CONFIG.LMSTUDIO_BASE_URL).toBeDefined();
        expect(API_CONFIG.OLLAMA_BASE_URL).toBeDefined();
      });
    });

    describe('PATHS', () => {
      it('should have SETTINGS_DIR defined', () => {
        expect(PATHS.SETTINGS_DIR).toBeDefined();
        expect(PATHS.SETTINGS_DIR).toBe('.codebuddy');
      });

      it('should have SETTINGS_FILE defined', () => {
        expect(PATHS.SETTINGS_FILE).toBeDefined();
      });

      it('should have CUSTOM_INSTRUCTIONS_FILE defined', () => {
        expect(PATHS.CUSTOM_INSTRUCTIONS_FILE).toBeDefined();
      });

      it('should have CACHE_DIR defined', () => {
        expect(PATHS.CACHE_DIR).toBeDefined();
      });
    });

    describe('SUPPORTED_MODELS', () => {
      it('should have grok-beta model', () => {
        expect(SUPPORTED_MODELS['grok-beta']).toBeDefined();
        expect(SUPPORTED_MODELS['grok-beta'].provider).toBe('xai');
      });

      it('should have grok-3-latest model', () => {
        expect(SUPPORTED_MODELS['grok-3-latest']).toBeDefined();
      });

      it('should have Claude models', () => {
        expect(SUPPORTED_MODELS['claude-sonnet-4-20250514']).toBeDefined();
        expect(SUPPORTED_MODELS['claude-opus-4-20250514']).toBeDefined();
      });

      it('should have Gemini models', () => {
        expect(SUPPORTED_MODELS['gemini-2.5-pro']).toBeDefined();
        expect(SUPPORTED_MODELS['gemini-2.5-flash']).toBeDefined();
      });

      it('should have local LLM support', () => {
        expect(SUPPORTED_MODELS['lmstudio']).toBeDefined();
        expect(SUPPORTED_MODELS['ollama']).toBeDefined();
      });

      it('should have maxTokens for all models', () => {
        Object.values(SUPPORTED_MODELS).forEach(model => {
          expect(model.maxTokens).toBeDefined();
          expect(model.maxTokens).toBeGreaterThan(0);
        });
      });
    });

    describe('ERROR_MESSAGES', () => {
      it('should have NO_API_KEY message', () => {
        expect(ERROR_MESSAGES.NO_API_KEY).toBeDefined();
        expect(ERROR_MESSAGES.NO_API_KEY.length).toBeGreaterThan(0);
      });

      it('should have common error messages', () => {
        expect(ERROR_MESSAGES.TOOL_EXECUTION_FAILED).toBeDefined();
        expect(ERROR_MESSAGES.FILE_NOT_FOUND).toBeDefined();
        expect(ERROR_MESSAGES.NETWORK_ERROR).toBeDefined();
        expect(ERROR_MESSAGES.TIMEOUT_ERROR).toBeDefined();
      });
    });

    describe('SUCCESS_MESSAGES', () => {
      it('should have file operation messages', () => {
        expect(SUCCESS_MESSAGES.FILE_CREATED).toBeDefined();
        expect(SUCCESS_MESSAGES.FILE_UPDATED).toBeDefined();
        expect(SUCCESS_MESSAGES.FILE_DELETED).toBeDefined();
      });

      it('should have command execution message', () => {
        expect(SUCCESS_MESSAGES.COMMAND_EXECUTED).toBeDefined();
      });
    });
  });

  // ============================================================================
  // ConfigManager Tests
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

    describe('getActiveModel', () => {
      it('should get active model', () => {
        const manager = getConfigManager();
        const model = manager.getActiveModel();

        expect(model.name).toBe(DEFAULT_CONFIG.active_model);
        expect(model.provider).toBeDefined();
        expect(model.max_context_tokens).toBeGreaterThan(0);
      });
    });

    describe('getProviderForModel', () => {
      it('should get provider for valid model', () => {
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
    });

    describe('getToolConfig', () => {
      it('should get tool config for known tool', () => {
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

    describe('isToolCommandAllowed', () => {
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

      it('should allow commands for tools without config', () => {
        const manager = getConfigManager();
        const result = manager.isToolCommandAllowed('unknown-tool', 'anything');

        expect(result.allowed).toBe(true);
      });

      it('should check denylist before allowlist', () => {
        const manager = getConfigManager();
        const result = manager.isToolCommandAllowed('bash', 'sudo git push');

        expect(result.allowed).toBe(false);
      });
    });

    describe('setActiveModel', () => {
      it('should set active model for valid model', () => {
        const manager = getConfigManager();
        manager.setActiveModel('grok-3');

        const config = manager.getConfig();
        expect(config.active_model).toBe('grok-3');

        // Reset to default
        manager.setActiveModel('grok-code-fast');
      });

      it('should throw for unknown model', () => {
        const manager = getConfigManager();

        expect(() => manager.setActiveModel('unknown-model')).toThrow();
      });
    });

    describe('reload', () => {
      it('should reload configuration', () => {
        const manager = getConfigManager();
        const config1 = manager.getConfig();

        const config2 = manager.reload();

        expect(config2).toBeDefined();
        expect(config2.active_model).toBe(config1.active_model);
      });
    });
  });

  // ============================================================================
  // Feature Flags Tests
  // ============================================================================

  describe('Feature Flags', () => {
    describe('FeatureFlagsManager', () => {
      it('should create manager with default flags', () => {
        const manager = new FeatureFlagsManager(tempDir);
        const flags = manager.getAllFlags();

        expect(flags.size).toBeGreaterThan(0);
      });

      it('should check if feature is enabled', () => {
        const manager = new FeatureFlagsManager(tempDir);

        const performanceCache = manager.isEnabled('PERFORMANCE_CACHE');
        expect(typeof performanceCache).toBe('boolean');
      });

      it('should get feature flag details', () => {
        const manager = new FeatureFlagsManager(tempDir);
        const flag = manager.getFlag('YOLO_MODE');

        expect(flag).toBeDefined();
        expect(flag?.name).toBe('YOLO_MODE');
        expect(flag?.enabled).toBe(false);
        expect(flag?.description).toBeDefined();
        expect(flag?.category).toBeDefined();
      });

      it('should enable a flag', () => {
        const manager = new FeatureFlagsManager(tempDir);

        manager.enableFlag('YOLO_MODE');

        expect(manager.isEnabled('YOLO_MODE')).toBe(true);
      });

      it('should disable a flag', () => {
        const manager = new FeatureFlagsManager(tempDir);
        manager.enableFlag('YOLO_MODE');

        manager.disableFlag('YOLO_MODE');

        expect(manager.isEnabled('YOLO_MODE')).toBe(false);
      });

      it('should toggle a flag', () => {
        const manager = new FeatureFlagsManager(tempDir);
        const initial = manager.isEnabled('YOLO_MODE');

        const toggled = manager.toggleFlag('YOLO_MODE');

        expect(toggled).toBe(!initial);
        expect(manager.isEnabled('YOLO_MODE')).toBe(!initial);
      });

      it('should return flags by category', () => {
        const manager = new FeatureFlagsManager(tempDir);
        const aiFlags = manager.getFlagsByCategory('ai');

        expect(Array.isArray(aiFlags)).toBe(true);
        aiFlags.forEach(flag => {
          expect(flag.category).toBe('ai');
        });
      });

      it('should return experimental flags', () => {
        const manager = new FeatureFlagsManager(tempDir);
        const experimental = manager.getExperimentalFlags();

        expect(Array.isArray(experimental)).toBe(true);
        experimental.forEach(flag => {
          expect(flag.experimental).toBe(true);
        });
      });

      it('should get summary', () => {
        const manager = new FeatureFlagsManager(tempDir);
        const summary = manager.getSummary();

        expect(summary.total).toBeGreaterThan(0);
        expect(summary.enabled).toBeDefined();
        expect(summary.disabled).toBeDefined();
        expect(summary.byCategory).toBeDefined();
      });

      it('should register new flag', () => {
        const manager = new FeatureFlagsManager(tempDir);
        const newFlag: FeatureFlag = {
          name: 'TEST_FLAG',
          enabled: true,
          description: 'Test flag',
          category: 'experimental',
        };

        manager.registerFlag(newFlag);

        expect(manager.isEnabled('TEST_FLAG')).toBe(true);
      });

      it('should emit events', () => {
        const manager = new FeatureFlagsManager(tempDir);
        const enableHandler = jest.fn();
        const disableHandler = jest.fn();

        manager.on('flag:enabled', enableHandler);
        manager.on('flag:disabled', disableHandler);

        manager.enableFlag('YOLO_MODE');
        manager.disableFlag('YOLO_MODE');

        expect(enableHandler).toHaveBeenCalledWith('YOLO_MODE');
        expect(disableHandler).toHaveBeenCalledWith('YOLO_MODE');
      });
    });

    describe('Environment variable overrides', () => {
      it('should override flag via environment variable', () => {
        process.env.YOLO_MODE = 'true';

        const manager = new FeatureFlagsManager(tempDir);

        expect(manager.isEnabled('YOLO_MODE')).toBe(true);
      });

      it('should handle env var value "1" as true', () => {
        process.env.YOLO_MODE = '1';

        const manager = new FeatureFlagsManager(tempDir);

        expect(manager.isEnabled('YOLO_MODE')).toBe(true);
      });

      it('should handle env var value "false" as false', () => {
        process.env.GROK_PERFORMANCE_CACHE = 'false';

        const manager = new FeatureFlagsManager(tempDir);

        expect(manager.isEnabled('PERFORMANCE_CACHE')).toBe(false);
      });
    });

    describe('Singleton functions', () => {
      it('should return same instance via getFeatureFlags', () => {
        const instance1 = getFeatureFlags();
        const instance2 = getFeatureFlags();

        expect(instance1).toBe(instance2);
      });

      it('should check feature via isFeatureEnabled', () => {
        const result = isFeatureEnabled('PERFORMANCE_CACHE');

        expect(typeof result).toBe('boolean');
      });

      it('should enable feature via enableFeature', () => {
        enableFeature('YOLO_MODE');

        expect(isFeatureEnabled('YOLO_MODE')).toBe(true);
      });

      it('should disable feature via disableFeature', () => {
        enableFeature('YOLO_MODE');
        disableFeature('YOLO_MODE');

        expect(isFeatureEnabled('YOLO_MODE')).toBe(false);
      });
    });

    describe('Config file loading', () => {
      it('should load flags from config file', () => {
        const configDir = path.join(tempDir, '.codebuddy');
        fs.mkdirSync(configDir, { recursive: true });

        const config = {
          version: '1.0.0',
          flags: {
            YOLO_MODE: {
              name: 'YOLO_MODE',
              enabled: true,
              description: 'Test',
              category: 'core',
            },
          },
        };
        fs.writeFileSync(
          path.join(configDir, 'feature-flags.json'),
          JSON.stringify(config)
        );

        const manager = new FeatureFlagsManager(tempDir);

        expect(manager.isEnabled('YOLO_MODE')).toBe(true);
      });
    });
  });

  // ============================================================================
  // CodeBuddyRules Tests
  // ============================================================================

  describe('CodeBuddyRules', () => {
    describe('CodeBuddyRulesManager', () => {
      let manager: CodeBuddyRulesManager;

      beforeEach(() => {
        resetCodeBuddyRulesManager();
        manager = new CodeBuddyRulesManager({
          enableGlobalRules: false,
          inheritFromParent: false,
        });
      });

      it('should initialize with default rules', async () => {
        await manager.initialize(tempDir);
        const rules = manager.getRules();

        expect(rules).toBeDefined();
        expect(rules.version).toBeDefined();
      });

      it('should report initialization status', async () => {
        expect(manager.isInitialized()).toBe(false);

        await manager.initialize(tempDir);

        expect(manager.isInitialized()).toBe(true);
      });

      it('should load YAML rules file', async () => {
        const rulesContent = `
description: Test Project
languages:
  - typescript
instructions:
  - Use strict mode
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);
        const rules = manager.getRules();

        expect(rules.description).toBe('Test Project');
        expect(rules.languages).toContain('typescript');
        expect(rules.instructions).toContain('Use strict mode');
      });

      it('should load JSON rules file', async () => {
        const rulesContent: CodeBuddyRules = {
          description: 'JSON Project',
          frameworks: ['react', 'next'],
        };
        fs.writeFileSync(
          path.join(tempDir, '.codebuddyrules.json'),
          JSON.stringify(rulesContent)
        );

        await manager.initialize(tempDir);
        const rules = manager.getRules();

        expect(rules.description).toBe('JSON Project');
        expect(rules.frameworks).toContain('react');
      });

      it('should track loaded files', async () => {
        fs.writeFileSync(
          path.join(tempDir, '.codebuddyrules'),
          'description: Test'
        );

        await manager.initialize(tempDir);
        const files = manager.getLoadedFiles();

        expect(files.length).toBe(1);
        expect(files[0]).toContain('.codebuddyrules');
      });

      it('should load style preferences', async () => {
        const rulesContent = `
style:
  indentation: tabs
  indentSize: 4
  quotes: double
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);
        const rules = manager.getRules();

        expect(rules.style?.indentation).toBe('tabs');
        expect(rules.style?.indentSize).toBe(4);
        expect(rules.style?.quotes).toBe('double');
      });

      it('should check allowed commands', async () => {
        const rulesContent = `
security:
  allowedCommands:
    - ls
    - cat
  blockedCommands:
    - rm -rf /
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);

        expect(manager.isCommandAllowed('ls -la')).toBe(true);
        expect(manager.isCommandAllowed('rm -rf /')).toBe(false);
      });

      it('should check blocked paths', async () => {
        const rulesContent = `
security:
  blockedPaths:
    - /etc
    - /usr
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);

        expect(manager.isPathAllowed('/etc/passwd')).toBe(false);
        expect(manager.isPathAllowed('/home/user')).toBe(true);
      });

      it('should return ignore patterns', async () => {
        const rulesContent = `
ignore:
  - node_modules/**
  - dist/**
exclude:
  - coverage/**
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);
        const patterns = manager.getIgnorePatterns();

        expect(patterns).toContain('node_modules/**');
        expect(patterns).toContain('coverage/**');
      });

      it('should return include patterns', async () => {
        const rulesContent = `
include:
  - src/**/*.ts
  - README.md
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);
        const patterns = manager.getIncludePatterns();

        expect(patterns).toContain('src/**/*.ts');
        expect(patterns).toContain('README.md');
      });

      it('should generate system prompt additions', async () => {
        const rulesContent = `
description: My Awesome Project
languages:
  - typescript
frameworks:
  - express
instructions:
  - Always write tests
style:
  quotes: single
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);
        const prompt = manager.getSystemPromptAdditions();

        expect(prompt).toContain('My Awesome Project');
        expect(prompt).toContain('typescript');
        expect(prompt).toContain('Always write tests');
      });

      it('should get custom prompts', async () => {
        const rulesContent = `
prompts:
  review: "Review this code for best practices"
  debug: "Help me debug this issue"
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);

        expect(manager.getCustomPrompt('review')).toBe(
          'Review this code for best practices'
        );
        expect(manager.getCustomPrompt('debug')).toBe(
          'Help me debug this issue'
        );
        expect(manager.getCustomPrompt('nonexistent')).toBeUndefined();
      });

      it('should create default rules file', async () => {
        const rulesPath = await manager.createDefaultRules(tempDir);

        expect(fs.existsSync(rulesPath)).toBe(true);

        const content = fs.readFileSync(rulesPath, 'utf-8');
        expect(content).toContain('description');
        expect(content).toContain('languages');
        expect(content).toContain('style');
      });

      it('should format summary', async () => {
        const rulesContent = `
description: Test Project
languages:
  - typescript
`;
        fs.writeFileSync(path.join(tempDir, '.codebuddyrules'), rulesContent);

        await manager.initialize(tempDir);
        const summary = manager.formatSummary();

        expect(summary).toContain('Grok Rules');
        expect(summary).toContain('Test Project');
      });

      it('should emit events', async () => {
        const handler = jest.fn();
        manager.on('initialized', handler);

        await manager.initialize(tempDir);

        expect(handler).toHaveBeenCalled();
      });
    });

    describe('Rule inheritance', () => {
      it('should inherit rules from parent directories', async () => {
        const inheritManager = new CodeBuddyRulesManager({
          enableGlobalRules: false,
          inheritFromParent: true,
        });

        const parentDir = tempDir;
        const childDir = path.join(tempDir, 'child');
        fs.mkdirSync(childDir);

        // Parent rules
        fs.writeFileSync(
          path.join(parentDir, '.codebuddyrules'),
          'description: Parent\nlanguages:\n  - javascript'
        );

        // Child rules
        fs.writeFileSync(
          path.join(childDir, '.codebuddyrules'),
          'frameworks:\n  - react'
        );

        await inheritManager.initialize(childDir);
        const rules = inheritManager.getRules();

        expect(rules.languages).toContain('javascript');
        expect(rules.frameworks).toContain('react');
      });
    });

    describe('Singleton pattern', () => {
      it('should return same instance', () => {
        const instance1 = getCodeBuddyRulesManager();
        const instance2 = getCodeBuddyRulesManager();

        expect(instance1).toBe(instance2);
      });

      it('should initialize via helper function', async () => {
        fs.writeFileSync(
          path.join(tempDir, '.codebuddyrules'),
          'description: Init Test'
        );

        const initialized = await initializeCodeBuddyRules(tempDir);

        expect(initialized.isInitialized()).toBe(true);
      });
    });
  });

  // ============================================================================
  // Provider-Specific Settings Tests
  // ============================================================================

  describe('Provider-Specific Settings', () => {
    describe('xAI Provider', () => {
      it('should have correct base URL', () => {
        expect(DEFAULT_CONFIG.providers.xai.base_url).toBe('https://api.x.ai/v1');
      });

      it('should use GROK_API_KEY environment variable', () => {
        expect(DEFAULT_CONFIG.providers.xai.api_key_env).toBe('GROK_API_KEY');
      });

      it('should have correct provider type', () => {
        expect(DEFAULT_CONFIG.providers.xai.type).toBe('xai');
      });
    });

    describe('Anthropic Provider', () => {
      it('should have correct base URL', () => {
        expect(DEFAULT_CONFIG.providers.anthropic.base_url).toBe('https://api.anthropic.com/v1');
      });

      it('should use ANTHROPIC_API_KEY environment variable', () => {
        expect(DEFAULT_CONFIG.providers.anthropic.api_key_env).toBe('ANTHROPIC_API_KEY');
      });

      it('should have correct provider type', () => {
        expect(DEFAULT_CONFIG.providers.anthropic.type).toBe('anthropic');
      });
    });

    describe('OpenAI Provider', () => {
      it('should have correct base URL', () => {
        expect(DEFAULT_CONFIG.providers.openai.base_url).toBe('https://api.openai.com/v1');
      });

      it('should use OPENAI_API_KEY environment variable', () => {
        expect(DEFAULT_CONFIG.providers.openai.api_key_env).toBe('OPENAI_API_KEY');
      });

      it('should have correct provider type', () => {
        expect(DEFAULT_CONFIG.providers.openai.type).toBe('openai');
      });
    });

    describe('Google Provider', () => {
      it('should have correct base URL', () => {
        expect(DEFAULT_CONFIG.providers.google.base_url).toContain('googleapis.com');
      });

      it('should use GOOGLE_API_KEY environment variable', () => {
        expect(DEFAULT_CONFIG.providers.google.api_key_env).toBe('GOOGLE_API_KEY');
      });

      it('should have correct provider type', () => {
        expect(DEFAULT_CONFIG.providers.google.type).toBe('google');
      });
    });

    describe('Model-Provider associations', () => {
      it('should associate grok models with xAI provider', () => {
        expect(DEFAULT_CONFIG.models['grok-code-fast'].provider).toBe('xai');
        expect(DEFAULT_CONFIG.models['grok-3'].provider).toBe('xai');
      });

      it('should associate Claude models with Anthropic provider', () => {
        expect(DEFAULT_CONFIG.models['claude-sonnet'].provider).toBe('anthropic');
        expect(DEFAULT_CONFIG.models['claude-opus'].provider).toBe('anthropic');
      });

      it('should associate GPT models with OpenAI provider', () => {
        expect(DEFAULT_CONFIG.models['gpt-4o'].provider).toBe('openai');
      });

      it('should associate Gemini models with Google provider', () => {
        expect(DEFAULT_CONFIG.models['gemini-2'].provider).toBe('google');
      });
    });

    describe('Provider pricing differences', () => {
      it('should have different pricing for different providers', () => {
        const grokPricing = DEFAULT_CONFIG.models['grok-code-fast'];
        const claudePricing = DEFAULT_CONFIG.models['claude-opus'];
        const geminiPricing = DEFAULT_CONFIG.models['gemini-2'];

        // Gemini should be cheaper (free tier)
        expect(geminiPricing.price_per_m_input).toBeLessThanOrEqual(grokPricing.price_per_m_input);

        // Claude Opus should be more expensive
        expect(claudePricing.price_per_m_output).toBeGreaterThanOrEqual(grokPricing.price_per_m_output);
      });
    });

    describe('Provider context limits', () => {
      it('should have correct context limits for xAI models', () => {
        expect(DEFAULT_CONFIG.models['grok-code-fast'].max_context_tokens).toBe(131072);
      });

      it('should have correct context limits for Anthropic models', () => {
        expect(DEFAULT_CONFIG.models['claude-sonnet'].max_context_tokens).toBe(200000);
      });

      it('should have correct context limits for OpenAI models', () => {
        expect(DEFAULT_CONFIG.models['gpt-4o'].max_context_tokens).toBe(128000);
      });

      it('should have correct context limits for Google models', () => {
        expect(DEFAULT_CONFIG.models['gemini-2'].max_context_tokens).toBe(1000000);
      });
    });
  });

  // ============================================================================
  // Configuration Validation Tests
  // ============================================================================

  describe('Configuration Validation', () => {
    describe('Provider validation', () => {
      it('should require api_key_env for providers', () => {
        Object.values(DEFAULT_CONFIG.providers).forEach(provider => {
          expect(provider.api_key_env).toBeDefined();
          expect(provider.api_key_env.length).toBeGreaterThan(0);
        });
      });

      it('should require type for providers', () => {
        Object.values(DEFAULT_CONFIG.providers).forEach(provider => {
          expect(provider.type).toBeDefined();
          expect(['openai', 'anthropic', 'google', 'xai', 'custom']).toContain(provider.type);
        });
      });
    });

    describe('Model validation', () => {
      it('should require provider for models', () => {
        Object.values(DEFAULT_CONFIG.models).forEach(model => {
          expect(model.provider).toBeDefined();
          expect(model.provider.length).toBeGreaterThan(0);
        });
      });

      it('should require pricing for models', () => {
        Object.values(DEFAULT_CONFIG.models).forEach(model => {
          expect(model.price_per_m_input).toBeDefined();
          expect(model.price_per_m_output).toBeDefined();
        });
      });

      it('should require max_context_tokens for models', () => {
        Object.values(DEFAULT_CONFIG.models).forEach(model => {
          expect(model.max_context_tokens).toBeDefined();
          expect(model.max_context_tokens).toBeGreaterThan(0);
        });
      });

      it('should have valid provider references', () => {
        Object.values(DEFAULT_CONFIG.models).forEach(model => {
          expect(DEFAULT_CONFIG.providers[model.provider]).toBeDefined();
        });
      });
    });

    describe('Tool config validation', () => {
      it('should require permission for tools', () => {
        Object.values(DEFAULT_CONFIG.tool_config).forEach(tool => {
          expect(tool.permission).toBeDefined();
          expect(['always', 'ask', 'never']).toContain(tool.permission);
        });
      });

      it('should have valid regex patterns in allowlist', () => {
        const bashConfig = DEFAULT_CONFIG.tool_config.bash;
        bashConfig.allowlist?.forEach(pattern => {
          expect(() => new RegExp(pattern)).not.toThrow();
        });
      });

      it('should have valid regex patterns in denylist', () => {
        const bashConfig = DEFAULT_CONFIG.tool_config.bash;
        bashConfig.denylist?.forEach(pattern => {
          expect(() => new RegExp(pattern)).not.toThrow();
        });
      });
    });

    describe('Middleware validation', () => {
      it('should have positive max_turns', () => {
        expect(DEFAULT_CONFIG.middleware.max_turns).toBeGreaterThan(0);
      });

      it('should have positive max_cost', () => {
        expect(DEFAULT_CONFIG.middleware.max_cost).toBeGreaterThan(0);
      });

      it('should have warning thresholds between 0 and 1', () => {
        expect(DEFAULT_CONFIG.middleware.turn_warning_threshold).toBeGreaterThan(0);
        expect(DEFAULT_CONFIG.middleware.turn_warning_threshold).toBeLessThanOrEqual(1);
        expect(DEFAULT_CONFIG.middleware.cost_warning_threshold).toBeGreaterThan(0);
        expect(DEFAULT_CONFIG.middleware.cost_warning_threshold).toBeLessThanOrEqual(1);
      });
    });

    describe('Active model validation', () => {
      it('should have active_model reference a valid model', () => {
        expect(DEFAULT_CONFIG.models[DEFAULT_CONFIG.active_model]).toBeDefined();
      });
    });
  });
});
