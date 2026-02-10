/**
 * Tests for ConfigResolver
 *
 * Verifies proper priority handling:
 * 1. CLI args (highest)
 * 2. Active profile
 * 3. Environment variables (fallback)
 * 4. Built-in defaults (lowest)
 */

import {
  ConfigResolver,
  getConfigResolver,
  resetConfigResolver,
  initConfigResolver,
} from '../../src/config/config-resolver.js';
import {
  ConnectionConfig,
  ConnectionProfile,
  DEFAULT_PROFILES,
  DEFAULT_CONNECTION_CONFIG,
} from '../../src/config/types.js';

describe('ConfigResolver', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfigResolver();
    // Clear relevant env vars
    delete process.env.GROK_API_KEY;
    delete process.env.GROK_BASE_URL;
    delete process.env.GROK_MODEL;
    delete process.env.XAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  afterEach(() => {
    // Restore original env vars
    process.env = { ...originalEnv };
  });

  describe('Priority Resolution', () => {
    it('should prioritize CLI args over everything', () => {
      // Set up environment
      process.env.GROK_API_KEY = 'env-key';
      process.env.GROK_BASE_URL = 'https://env.api.com/v1';

      const config: ConnectionConfig = {
        profiles: [
          {
            id: 'profile1',
            name: 'Test Profile',
            provider: 'grok',
            baseURL: 'https://profile.api.com/v1',
            apiKey: 'profile-key',
            isDefault: true,
            enabled: true,
          },
        ],
        activeProfileId: 'profile1',
        envVarsFallback: true,
      };

      const resolver = new ConfigResolver(config);

      // CLI should override both profile and env
      const result = resolver.resolve({
        baseURL: 'https://cli.api.com/v1',
        apiKey: 'cli-key',
        model: 'cli-model',
      });

      expect(result.baseURL).toBe('https://cli.api.com/v1');
      expect(result.apiKey).toBe('cli-key');
      expect(result.model).toBe('cli-model');
      expect(result.source).toBe('cli');
    });

    it('should use active profile when no CLI args', () => {
      process.env.GROK_API_KEY = 'env-key';
      process.env.GROK_BASE_URL = 'https://env.api.com/v1';

      const config: ConnectionConfig = {
        profiles: [
          {
            id: 'lmstudio-test',
            name: 'LM Studio Test',
            provider: 'lmstudio',
            baseURL: 'http://localhost:1234/v1',
            apiKey: 'lm-studio',
            model: 'devstral',
            isDefault: true,
            enabled: true,
          },
        ],
        activeProfileId: 'lmstudio-test',
        envVarsFallback: true,
      };

      const resolver = new ConfigResolver(config);
      const result = resolver.resolve();

      // Should use profile, NOT env vars
      expect(result.baseURL).toBe('http://localhost:1234/v1');
      expect(result.apiKey).toBe('lm-studio');
      expect(result.model).toBe('devstral');
      expect(result.source).toBe('profile');
      expect(result.profileId).toBe('lmstudio-test');
    });

    it('should fall back to env vars when no profile active', () => {
      process.env.GROK_API_KEY = 'env-key';
      process.env.GROK_BASE_URL = 'https://env.api.com/v1';
      process.env.GROK_MODEL = 'env-model';

      const config: ConnectionConfig = {
        profiles: [],
        activeProfileId: 'nonexistent',
        envVarsFallback: true,
      };

      const resolver = new ConfigResolver(config);
      const result = resolver.resolve();

      expect(result.baseURL).toBe('https://env.api.com/v1');
      expect(result.apiKey).toBe('env-key');
      expect(result.model).toBe('env-model');
      expect(result.source).toBe('environment');
    });

    it('should use defaults when nothing else available', () => {
      const config: ConnectionConfig = {
        profiles: [],
        activeProfileId: 'nonexistent',
        envVarsFallback: true,
      };

      const resolver = new ConfigResolver(config);
      const result = resolver.resolve();

      expect(result.baseURL).toBe('https://api.x.ai/v1');
      expect(result.model).toBe('grok-code-fast-1');
      expect(result.source).toBe('default');
    });

    it('should NOT use env vars when profile is set (user-first priority)', () => {
      // This is the key test - env vars should NOT override user profile selection
      process.env.GROK_API_KEY = 'env-key';
      process.env.GROK_BASE_URL = 'https://api.x.ai/v1';

      const config: ConnectionConfig = {
        profiles: [
          {
            id: 'local',
            name: 'Local Server',
            provider: 'lmstudio',
            baseURL: 'http://localhost:1234/v1',
            apiKey: 'local-key',
            enabled: true,
          },
        ],
        activeProfileId: 'local',
        envVarsFallback: true, // Even with fallback enabled
      };

      const resolver = new ConfigResolver(config);
      const result = resolver.resolve();

      // Profile should win over env vars
      expect(result.baseURL).toBe('http://localhost:1234/v1');
      expect(result.apiKey).toBe('local-key');
      expect(result.profileId).toBe('local');
    });
  });

  describe('Profile Management', () => {
    it('should list all profiles', () => {
      const resolver = new ConfigResolver();
      const profiles = resolver.getProfiles();

      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles.some(p => p.id === 'grok')).toBe(true);
      expect(profiles.some(p => p.id === 'lmstudio')).toBe(true);
      expect(profiles.some(p => p.id === 'ollama')).toBe(true);
    });

    it('should switch active profile', () => {
      const resolver = new ConfigResolver();

      expect(resolver.getActiveProfileId()).toBe('grok');

      const success = resolver.setActiveProfile('lmstudio');
      expect(success).toBe(true);
      expect(resolver.getActiveProfileId()).toBe('lmstudio');

      const profile = resolver.getActiveProfile();
      expect(profile?.id).toBe('lmstudio');
      expect(profile?.provider).toBe('lmstudio');
    });

    it('should fail to switch to nonexistent profile', () => {
      const resolver = new ConfigResolver();

      const success = resolver.setActiveProfile('nonexistent');
      expect(success).toBe(false);
      expect(resolver.getActiveProfileId()).toBe('grok'); // Unchanged
    });

    it('should add new profile', () => {
      const resolver = new ConfigResolver();

      const newProfile: ConnectionProfile = {
        id: 'custom',
        name: 'Custom Server',
        provider: 'local',
        baseURL: 'http://custom.server:8080/v1',
        apiKey: 'custom-key',
        enabled: true,
      };

      resolver.addProfile(newProfile);

      const profile = resolver.getProfile('custom');
      expect(profile).toBeDefined();
      expect(profile?.name).toBe('Custom Server');
      expect(profile?.createdAt).toBeDefined();
    });

    it('should not add duplicate profile ID', () => {
      const resolver = new ConfigResolver();

      expect(() => {
        resolver.addProfile({
          id: 'grok', // Already exists
          name: 'Duplicate',
          provider: 'grok',
          baseURL: 'https://api.x.ai/v1',
        });
      }).toThrow("Profile 'grok' already exists");
    });

    it('should update existing profile', () => {
      const resolver = new ConfigResolver();

      const success = resolver.updateProfile('lmstudio', {
        baseURL: 'http://192.168.1.100:1234/v1',
        model: 'updated-model',
      });

      expect(success).toBe(true);

      const profile = resolver.getProfile('lmstudio');
      expect(profile?.baseURL).toBe('http://192.168.1.100:1234/v1');
      expect(profile?.model).toBe('updated-model');
      // ID should not change
      expect(profile?.id).toBe('lmstudio');
    });

    it('should remove custom profile', () => {
      const resolver = new ConfigResolver();

      // Add custom profile first
      resolver.addProfile({
        id: 'removable',
        name: 'Removable',
        provider: 'local',
        baseURL: 'http://test/v1',
      });

      const success = resolver.removeProfile('removable');
      expect(success).toBe(true);
      expect(resolver.getProfile('removable')).toBeUndefined();
    });

    it('should not remove built-in profiles', () => {
      const resolver = new ConfigResolver();

      const success = resolver.removeProfile('grok');
      expect(success).toBe(false);
      expect(resolver.getProfile('grok')).toBeDefined();
    });

    it('should filter enabled profiles', () => {
      const config: ConnectionConfig = {
        profiles: [
          { id: 'enabled1', name: 'E1', provider: 'grok', baseURL: 'http://a', enabled: true },
          { id: 'disabled1', name: 'D1', provider: 'grok', baseURL: 'http://b', enabled: false },
          { id: 'enabled2', name: 'E2', provider: 'grok', baseURL: 'http://c', enabled: true },
        ],
        activeProfileId: 'enabled1',
        envVarsFallback: false,
      };

      const resolver = new ConfigResolver(config);
      const enabled = resolver.getEnabledProfiles();

      // Default profiles are also merged in, so we just check the disabled one is excluded
      expect(enabled.some(p => p.id === 'disabled1')).toBe(false);
      expect(enabled.some(p => p.id === 'enabled1')).toBe(true);
      expect(enabled.some(p => p.id === 'enabled2')).toBe(true);
    });
  });

  describe('CLI Profile Selection', () => {
    it('should use profile specified in CLI args', () => {
      const config: ConnectionConfig = {
        profiles: [
          { id: 'p1', name: 'P1', provider: 'grok', baseURL: 'http://p1/v1', apiKey: 'key1' },
          { id: 'p2', name: 'P2', provider: 'lmstudio', baseURL: 'http://p2/v1', apiKey: 'key2' },
        ],
        activeProfileId: 'p1',
        envVarsFallback: false,
      };

      const resolver = new ConfigResolver(config);

      // Select different profile via CLI
      const result = resolver.resolve({ profile: 'p2' });

      expect(result.baseURL).toBe('http://p2/v1');
      expect(result.apiKey).toBe('key2');
      expect(result.profileId).toBe('p2');
      expect(result.source).toBe('cli');
    });

    it('should allow CLI to override profile values', () => {
      const config: ConnectionConfig = {
        profiles: [
          { id: 'p1', name: 'P1', provider: 'grok', baseURL: 'http://p1/v1', apiKey: 'key1', model: 'model1' },
        ],
        activeProfileId: 'p1',
        envVarsFallback: false,
      };

      const resolver = new ConfigResolver(config);

      // Use profile but override model
      const result = resolver.resolve({ profile: 'p1', model: 'override-model' });

      expect(result.baseURL).toBe('http://p1/v1');
      expect(result.model).toBe('override-model');
    });
  });

  describe('Provider Detection', () => {
    it('should detect provider from URL', () => {
      const resolver = new ConfigResolver();

      const testCases = [
        { url: 'https://api.x.ai/v1', expected: 'grok' },
        { url: 'https://api.openai.com/v1', expected: 'openai' },
        { url: 'https://api.anthropic.com/v1', expected: 'claude' },
        { url: 'http://localhost:1234/v1', expected: 'lmstudio' },
        { url: 'http://localhost:11434/v1', expected: 'ollama' },
        // Note: 192.168.x.x is not detected as 'local' by default because
        // detectProvider looks for specific patterns, not generic IPs
      ];

      for (const { url, expected } of testCases) {
        const result = resolver.resolve({ baseURL: url, apiKey: 'test' });
        expect(result.provider).toBe(expected);
      }
    });

    it('should default to grok for unknown URLs', () => {
      const resolver = new ConfigResolver();
      const result = resolver.resolve({ baseURL: 'http://192.168.1.1:8080/v1', apiKey: 'test' });
      // Unknown URLs default to grok
      expect(result.provider).toBe('grok');
    });
  });

  describe('Configuration Export/Import', () => {
    it('should export configuration', () => {
      const resolver = new ConfigResolver();
      resolver.setActiveProfile('lmstudio');

      const config = resolver.toConfig();

      expect(config.activeProfileId).toBe('lmstudio');
      expect(config.profiles.length).toBeGreaterThan(0);
      expect(config.envVarsFallback).toBe(true);
    });

    it('should import configuration', () => {
      const resolver = new ConfigResolver();

      const config: ConnectionConfig = {
        profiles: [
          { id: 'imported', name: 'Imported', provider: 'grok', baseURL: 'http://imported/v1' },
        ],
        activeProfileId: 'imported',
        envVarsFallback: false,
      };

      resolver.fromConfig(config);

      expect(resolver.getActiveProfileId()).toBe('imported');
      expect(resolver.getProfile('imported')).toBeDefined();
      // Should still have default profiles merged in
      expect(resolver.getProfile('grok')).toBeDefined();
    });
  });

  describe('Events', () => {
    it('should emit profile-changed event', () => {
      const resolver = new ConfigResolver();
      const handler = jest.fn();

      resolver.on('profile-changed', handler);
      resolver.setActiveProfile('lmstudio');

      expect(handler).toHaveBeenCalledWith('lmstudio', expect.objectContaining({ id: 'lmstudio' }));
    });

    it('should emit profile-added event', () => {
      const resolver = new ConfigResolver();
      const handler = jest.fn();

      resolver.on('profile-added', handler);
      resolver.addProfile({
        id: 'new-profile',
        name: 'New',
        provider: 'local',
        baseURL: 'http://new/v1',
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-profile' }));
    });
  });

  describe('Singleton', () => {
    it('should return same instance from getConfigResolver', () => {
      const resolver1 = getConfigResolver();
      const resolver2 = getConfigResolver();

      expect(resolver1).toBe(resolver2);
    });

    it('should create new instance after reset', () => {
      const resolver1 = getConfigResolver();
      resetConfigResolver();
      const resolver2 = getConfigResolver();

      expect(resolver1).not.toBe(resolver2);
    });

    it('should initialize with custom config', () => {
      resetConfigResolver();

      const config: ConnectionConfig = {
        profiles: [{ id: 'init', name: 'Init', provider: 'grok', baseURL: 'http://init/v1' }],
        activeProfileId: 'init',
        envVarsFallback: false,
      };

      const resolver = initConfigResolver(config);

      expect(resolver.getActiveProfileId()).toBe('init');
    });
  });
});
