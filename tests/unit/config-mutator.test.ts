/**
 * Unit Tests for Config Mutator
 *
 * Tests cover:
 * - Set with dot-notation key path
 * - Dry-run returns preview without modifying
 * - SecretRef validation (missing env var warning)
 * - Invalid key path rejection
 * - Batch JSON sets multiple values
 * - Nested dot-notation (a.b.c)
 * - Type coercion (string → number, string → boolean)
 * - Type mismatch rejection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the secret-ref module
vi.mock('../../src/config/secret-ref.js', () => ({
  resolveSecretRef: vi.fn(async (value: string) => {
    // Simple mock: replace ${env:NAME} with env value or empty string
    return value.replace(/\$\{env:([^}]+)\}/g, (_match, name) => {
      return process.env[name] || '';
    });
  }),
}));

// Track the saved config for assertions
const savedConfigs: unknown[] = [];

// Mock toml-config with a fresh config per test
vi.mock('../../src/config/toml-config.js', () => {
  let mockConfig: Record<string, unknown> = {};

  return {
    getConfigManager: () => ({
      getConfig: () => mockConfig,
      saveUserConfig: vi.fn(() => {
        savedConfigs.push(JSON.parse(JSON.stringify(mockConfig)));
      }),
      // Expose for test setup
      _setMockConfig: (cfg: Record<string, unknown>) => {
        mockConfig = cfg;
      },
      _getMockConfig: () => mockConfig,
    }),
  };
});

import { setConfigValue, setConfigBatch } from '../../src/config/config-mutator';
import { getConfigManager } from '../../src/config/toml-config';

function resetMockConfig(config: Record<string, unknown>): void {
  const mgr = getConfigManager() as unknown as {
    _setMockConfig: (cfg: Record<string, unknown>) => void;
  };
  mgr._setMockConfig(config);
}

function getMockConfig(): Record<string, unknown> {
  const mgr = getConfigManager() as unknown as {
    _getMockConfig: () => Record<string, unknown>;
  };
  return mgr._getMockConfig();
}

describe('Config Mutator', () => {
  beforeEach(() => {
    savedConfigs.length = 0;
    resetMockConfig({
      active_model: 'grok-code-fast',
      middleware: {
        max_turns: 100,
        turn_warning_threshold: 0.8,
        max_cost: 10.0,
        cost_warning_threshold: 0.8,
        auto_compact_threshold: 80000,
        context_warning_percentage: 0.7,
      },
      ui: {
        vim_keybindings: false,
        theme: 'default',
        show_tokens: true,
        show_cost: true,
        streaming: true,
        sound_effects: false,
      },
      agent: {
        yolo_mode: false,
        parallel_tools: false,
        rag_tool_selection: true,
        self_healing: true,
        default_prompt: 'default',
      },
      integrations: {
        rtk_enabled: true,
        rtk_min_output_length: 500,
        icm_enabled: true,
      },
      providers: {
        xai: {
          base_url: 'https://api.x.ai/v1',
          api_key_env: 'GROK_API_KEY',
          type: 'xai',
          enabled: true,
        },
      },
      models: {},
      tool_config: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Set with dot-notation
  // ==========================================================================

  describe('set with dot-notation', () => {
    it('should set a nested value via dot-notation', async () => {
      const result = await setConfigValue('middleware.max_turns', 200);

      expect(result.success).toBe(true);
      expect(result.key).toBe('middleware.max_turns');
      expect(result.oldValue).toBe(100);
      expect(result.newValue).toBe(200);
      expect(result.dryRun).toBe(false);

      // Verify the config was actually mutated
      const config = getMockConfig();
      expect((config.middleware as Record<string, unknown>).max_turns).toBe(200);
    });

    it('should set a top-level value', async () => {
      const result = await setConfigValue('active_model', 'grok-4');

      expect(result.success).toBe(true);
      expect(result.oldValue).toBe('grok-code-fast');
      expect(result.newValue).toBe('grok-4');

      const config = getMockConfig();
      expect(config.active_model).toBe('grok-4');
    });

    it('should set a boolean value via dot-notation', async () => {
      const result = await setConfigValue('ui.streaming', false);

      expect(result.success).toBe(true);
      expect(result.oldValue).toBe(true);
      expect(result.newValue).toBe(false);
    });

    it('should persist changes via saveUserConfig', async () => {
      await setConfigValue('middleware.max_turns', 300);

      expect(savedConfigs.length).toBe(1);
      const saved = savedConfigs[0] as Record<string, unknown>;
      expect((saved.middleware as Record<string, unknown>).max_turns).toBe(300);
    });
  });

  // ==========================================================================
  // Dry-run mode
  // ==========================================================================

  describe('dry-run mode', () => {
    it('should return preview without modifying config', async () => {
      const result = await setConfigValue('middleware.max_turns', 500, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.oldValue).toBe(100);
      expect(result.newValue).toBe(500);

      // Config should NOT be modified
      const config = getMockConfig();
      expect((config.middleware as Record<string, unknown>).max_turns).toBe(100);

      // saveUserConfig should NOT be called
      expect(savedConfigs.length).toBe(0);
    });

    it('should return preview for boolean change', async () => {
      const result = await setConfigValue('agent.yolo_mode', true, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.oldValue).toBe(false);
      expect(result.newValue).toBe(true);

      // Not modified
      const config = getMockConfig();
      expect((config.agent as Record<string, unknown>).yolo_mode).toBe(false);
    });
  });

  // ==========================================================================
  // SecretRef validation
  // ==========================================================================

  describe('SecretRef validation', () => {
    it('should warn when env var is missing in SecretRef', async () => {
      const originalEnv = process.env.MISSING_VAR;
      delete process.env.MISSING_VAR;

      const result = await setConfigValue(
        'providers.xai.api_key_env',
        '${env:MISSING_VAR}',
      );

      expect(result.success).toBe(true);
      expect(result.warning).toContain('MISSING_VAR');
      expect(result.warning).toContain('not set');

      // Restore
      if (originalEnv !== undefined) {
        process.env.MISSING_VAR = originalEnv;
      }
    });

    it('should keep a SecretRef literal instead of the resolved value', async () => {
      process.env.TEST_CONFIG_VAR = 'resolved-value';

      const result = await setConfigValue(
        'active_model',
        '${env:TEST_CONFIG_VAR}',
      );

      expect(result.success).toBe(true);
      expect(result.newValue).toBe('${env:TEST_CONFIG_VAR}');
      expect(JSON.stringify(result)).not.toContain('resolved-value');

      delete process.env.TEST_CONFIG_VAR;
    });
  });

  // ==========================================================================
  // Invalid key path
  // ==========================================================================

  describe('invalid key path', () => {
    it('should reject empty key path', async () => {
      const result = await setConfigValue('', 'value');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Empty key path');
    });

    it('should reject navigation through non-object value', async () => {
      const result = await setConfigValue('active_model.sub_key', 'value');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot navigate through non-object');
    });
  });

  // ==========================================================================
  // Batch JSON
  // ==========================================================================

  describe('batch JSON', () => {
    it('should set multiple values from a batch object', async () => {
      const results = await setConfigBatch({
        'middleware.max_turns': 250,
        'ui.theme': 'dark',
        'agent.yolo_mode': true,
      });

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);

      const config = getMockConfig();
      expect((config.middleware as Record<string, unknown>).max_turns).toBe(250);
      expect((config.ui as Record<string, unknown>).theme).toBe('dark');
      expect((config.agent as Record<string, unknown>).yolo_mode).toBe(true);
    });

    it('should handle mixed success/failure in batch', async () => {
      const results = await setConfigBatch({
        'middleware.max_turns': 300,
        'active_model.invalid.path': 'bad',
      });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    it('should support dry-run in batch mode', async () => {
      const results = await setConfigBatch(
        { 'middleware.max_turns': 400 },
        { dryRun: true },
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].dryRun).toBe(true);

      // Not modified
      const config = getMockConfig();
      expect((config.middleware as Record<string, unknown>).max_turns).toBe(100);
    });
  });

  // ==========================================================================
  // Nested dot-notation (a.b.c)
  // ==========================================================================

  describe('nested dot-notation', () => {
    it('should handle 3-level nesting (providers.xai.enabled)', async () => {
      const result = await setConfigValue('providers.xai.enabled', false);

      expect(result.success).toBe(true);
      expect(result.oldValue).toBe(true);
      expect(result.newValue).toBe(false);

      const config = getMockConfig();
      const xai = (config.providers as Record<string, Record<string, unknown>>).xai;
      expect(xai.enabled).toBe(false);
    });

    it('should auto-create intermediate objects for new paths', async () => {
      const result = await setConfigValue('agent_defaults.imageGenerationModel', 'dall-e-3');

      expect(result.success).toBe(true);
      expect(result.oldValue).toBeUndefined();
      expect(result.newValue).toBe('dall-e-3');

      const config = getMockConfig();
      const defaults = config.agent_defaults as Record<string, unknown>;
      expect(defaults.imageGenerationModel).toBe('dall-e-3');
    });
  });

  // ==========================================================================
  // Type coercion
  // ==========================================================================

  describe('type coercion', () => {
    it('should coerce string to number when target is number', async () => {
      const result = await setConfigValue('middleware.max_turns', '250');

      expect(result.success).toBe(true);
      expect(result.newValue).toBe(250);
      expect(typeof result.newValue).toBe('number');
    });

    it('should coerce "true" string to boolean when target is boolean', async () => {
      const result = await setConfigValue('agent.yolo_mode', 'true');

      expect(result.success).toBe(true);
      expect(result.newValue).toBe(true);
      expect(typeof result.newValue).toBe('boolean');
    });

    it('should coerce "false" string to boolean when target is boolean', async () => {
      const result = await setConfigValue('ui.streaming', 'false');

      expect(result.success).toBe(true);
      expect(result.newValue).toBe(false);
      expect(typeof result.newValue).toBe('boolean');
    });

    it('should reject non-numeric string for number field', async () => {
      const result = await setConfigValue('middleware.max_turns', 'not-a-number');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Type mismatch');
      expect(result.error).toContain('Expected number');
    });

    it('should reject non-boolean string for boolean field', async () => {
      const result = await setConfigValue('agent.yolo_mode', 'maybe');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Type mismatch');
      expect(result.error).toContain('Expected boolean');
    });
  });

  // ==========================================================================
  // Type mismatch
  // ==========================================================================

  describe('type mismatch', () => {
    it('should reject setting object where string is expected', async () => {
      const result = await setConfigValue('active_model', { foo: 'bar' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Type mismatch');
      expect(result.error).toContain('Expected string');
    });
  });
});
