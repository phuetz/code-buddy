/**
 * Tests for Settings Migration
 */

import {
  needsMigration,
  migrateSettings,
  createProfileFromLegacy,
  detectProviderFromSettings,
  mergeWithDefaults,
  validateConnectionConfig,
  cloneProfile,
  createCustomProfile,
  exportProfiles,
  importProfiles,
} from '../../src/config/migration.js';
import {
  LegacyUserSettings,
  ConnectionConfig,
  ConnectionProfile,
  DEFAULT_PROFILES,
} from '../../src/config/types.js';

describe('Settings Migration', () => {
  describe('needsMigration', () => {
    it('should return false for null/undefined', () => {
      expect(needsMigration(null)).toBe(false);
      expect(needsMigration(undefined)).toBe(false);
    });

    it('should return false for empty object', () => {
      expect(needsMigration({})).toBe(false);
    });

    it('should return false if connection config exists', () => {
      expect(needsMigration({ connection: { profiles: [] } })).toBe(false);
    });

    it('should return true if has apiKey without connection', () => {
      expect(needsMigration({ apiKey: 'test-key' })).toBe(true);
    });

    it('should return true if has baseURL without connection', () => {
      expect(needsMigration({ baseURL: 'http://test/v1' })).toBe(true);
    });

    it('should return true if has provider without connection', () => {
      expect(needsMigration({ provider: 'lmstudio' })).toBe(true);
    });
  });

  describe('detectProviderFromSettings', () => {
    it('should use explicit provider', () => {
      expect(detectProviderFromSettings({ provider: 'claude' })).toBe('claude');
    });

    it('should detect grok from URL', () => {
      expect(detectProviderFromSettings({ baseURL: 'https://api.x.ai/v1' })).toBe('grok');
    });

    it('should detect openai from URL', () => {
      expect(detectProviderFromSettings({ baseURL: 'https://api.openai.com/v1' })).toBe('openai');
    });

    it('should detect anthropic from URL', () => {
      expect(detectProviderFromSettings({ baseURL: 'https://api.anthropic.com/v1' })).toBe('claude');
    });

    it('should detect lmstudio from port 1234', () => {
      expect(detectProviderFromSettings({ baseURL: 'http://localhost:1234/v1' })).toBe('lmstudio');
    });

    it('should detect ollama from port 11434', () => {
      expect(detectProviderFromSettings({ baseURL: 'http://localhost:11434/v1' })).toBe('ollama');
    });

    it('should detect local from localhost', () => {
      expect(detectProviderFromSettings({ baseURL: 'http://localhost:8080/v1' })).toBe('local');
    });

    it('should default to grok', () => {
      expect(detectProviderFromSettings({})).toBe('grok');
    });
  });

  describe('createProfileFromLegacy', () => {
    it('should create profile from legacy settings', () => {
      const legacy: LegacyUserSettings = {
        apiKey: 'test-api-key',
        baseURL: 'http://custom-server:8080/v1',
        defaultModel: 'custom-model',
      };

      const profile = createProfileFromLegacy(legacy, 'My Server');

      expect(profile.id).toBe('migrated');
      expect(profile.name).toBe('My Server');
      expect(profile.apiKey).toBe('test-api-key');
      expect(profile.baseURL).toBe('http://custom-server:8080/v1');
      expect(profile.model).toBe('custom-model');
      expect(profile.isDefault).toBe(true);
      expect(profile.enabled).toBe(true);
    });

    it('should use default URL if not provided', () => {
      const profile = createProfileFromLegacy({});
      expect(profile.baseURL).toBe('https://api.x.ai/v1');
    });
  });

  describe('migrateSettings', () => {
    it('should migrate settings with custom config', () => {
      const legacy: LegacyUserSettings = {
        apiKey: 'my-custom-key',
        baseURL: 'http://my-server:1234/v1',
        defaultModel: 'my-model',
        models: ['model1', 'model2'],
      };

      const migrated = migrateSettings(legacy);

      expect(migrated.connection).toBeDefined();
      expect(migrated.connection?.profiles.length).toBeGreaterThan(0);
      expect(migrated.connection?.envVarsFallback).toBe(true);
      expect(migrated.defaultModel).toBe('my-model');
      expect(migrated.models).toEqual(['model1', 'model2']);

      // Should have migrated profile as active
      const activeProfile = migrated.connection?.profiles.find(
        p => p.id === migrated.connection?.activeProfileId
      );
      expect(activeProfile).toBeDefined();
      expect(activeProfile?.apiKey).toBe('my-custom-key');
    });

    it('should add default profiles', () => {
      const migrated = migrateSettings({});

      expect(migrated.connection?.profiles.some(p => p.id === 'grok')).toBe(true);
      expect(migrated.connection?.profiles.some(p => p.id === 'lmstudio')).toBe(true);
      expect(migrated.connection?.profiles.some(p => p.id === 'ollama')).toBe(true);
    });

    it('should not create migrated profile if using same API key as env', () => {
      const originalEnv = process.env.GROK_API_KEY;
      process.env.GROK_API_KEY = 'env-key';

      try {
        const migrated = migrateSettings({ apiKey: 'env-key' });
        // Should use default grok profile
        expect(migrated.connection?.activeProfileId).toBe('grok');
      } finally {
        if (originalEnv) {
          process.env.GROK_API_KEY = originalEnv;
        } else {
          delete process.env.GROK_API_KEY;
        }
      }
    });
  });

  describe('mergeWithDefaults', () => {
    it('should add missing default profiles', () => {
      const config: Partial<ConnectionConfig> = {
        profiles: [
          { id: 'custom', name: 'Custom', provider: 'local', baseURL: 'http://custom/v1' },
        ],
        activeProfileId: 'custom',
        envVarsFallback: true,
      };

      const merged = mergeWithDefaults(config);

      expect(merged.profiles.some(p => p.id === 'custom')).toBe(true);
      expect(merged.profiles.some(p => p.id === 'grok')).toBe(true);
      expect(merged.profiles.some(p => p.id === 'lmstudio')).toBe(true);
    });

    it('should not duplicate existing profiles', () => {
      const config: Partial<ConnectionConfig> = {
        profiles: [
          { id: 'grok', name: 'Custom Grok', provider: 'grok', baseURL: 'http://custom-grok/v1' },
        ],
        activeProfileId: 'grok',
        envVarsFallback: true,
      };

      const merged = mergeWithDefaults(config);

      const grokProfiles = merged.profiles.filter(p => p.id === 'grok');
      expect(grokProfiles.length).toBe(1);
      expect(grokProfiles[0].name).toBe('Custom Grok');
    });
  });

  describe('validateConnectionConfig', () => {
    it('should fix invalid activeProfileId', () => {
      const config: ConnectionConfig = {
        profiles: [
          { id: 'valid', name: 'Valid', provider: 'grok', baseURL: 'http://valid/v1' },
        ],
        activeProfileId: 'nonexistent',
        envVarsFallback: true,
      };

      const validated = validateConnectionConfig(config);

      // Should reset to valid profile or grok
      expect(validated.activeProfileId).not.toBe('nonexistent');
    });

    it('should ensure profiles is array', () => {
      const config = {
        profiles: null as unknown as ConnectionProfile[],
        activeProfileId: 'grok',
        envVarsFallback: true,
      };

      const validated = validateConnectionConfig(config);

      expect(Array.isArray(validated.profiles)).toBe(true);
      expect(validated.profiles.length).toBeGreaterThan(0);
    });

    it('should set default enabled status', () => {
      const config: ConnectionConfig = {
        profiles: [
          { id: 'test', name: 'Test', provider: 'grok', baseURL: 'http://test/v1' },
        ],
        activeProfileId: 'test',
        envVarsFallback: true,
      };

      const validated = validateConnectionConfig(config);

      expect(validated.profiles[0].enabled).toBe(true);
      expect(validated.profiles[0].createdAt).toBeDefined();
    });
  });

  describe('Profile Utilities', () => {
    describe('cloneProfile', () => {
      it('should create a copy with new ID', () => {
        const original: ConnectionProfile = {
          id: 'original',
          name: 'Original',
          provider: 'grok',
          baseURL: 'http://original/v1',
          apiKey: 'key',
          isDefault: true,
        };

        const cloned = cloneProfile(original, 'cloned', 'Cloned Profile');

        expect(cloned.id).toBe('cloned');
        expect(cloned.name).toBe('Cloned Profile');
        expect(cloned.baseURL).toBe(original.baseURL);
        expect(cloned.apiKey).toBe(original.apiKey);
        expect(cloned.isDefault).toBe(false); // Should not copy isDefault
        expect(cloned.createdAt).toBeDefined();
      });
    });

    describe('createCustomProfile', () => {
      it('should create profile with detected provider', () => {
        const profile = createCustomProfile(
          'my-profile',
          'My Profile',
          'http://localhost:1234/v1',
          'my-key'
        );

        expect(profile.id).toBe('my-profile');
        expect(profile.name).toBe('My Profile');
        expect(profile.baseURL).toBe('http://localhost:1234/v1');
        expect(profile.apiKey).toBe('my-key');
        expect(profile.provider).toBe('lmstudio');
        expect(profile.enabled).toBe(true);
      });
    });
  });

  describe('Export/Import', () => {
    describe('exportProfiles', () => {
      it('should redact API keys', () => {
        const profiles: ConnectionProfile[] = [
          { id: 'test', name: 'Test', provider: 'grok', baseURL: 'http://test/v1', apiKey: 'secret-key' },
        ];

        const exported = exportProfiles(profiles);
        const parsed = JSON.parse(exported);

        expect(parsed.profiles[0].apiKey).toBe('***REDACTED***');
      });

      it('should preserve other fields', () => {
        const profiles: ConnectionProfile[] = [
          { id: 'test', name: 'Test', provider: 'grok', baseURL: 'http://test/v1', model: 'grok-4' },
        ];

        const exported = exportProfiles(profiles);
        const parsed = JSON.parse(exported);

        expect(parsed.profiles[0].id).toBe('test');
        expect(parsed.profiles[0].name).toBe('Test');
        expect(parsed.profiles[0].model).toBe('grok-4');
      });
    });

    describe('importProfiles', () => {
      it('should clear redacted API keys', () => {
        const json = JSON.stringify({
          profiles: [
            { id: 'test', name: 'Test', provider: 'grok', baseURL: 'http://test/v1', apiKey: '***REDACTED***' },
          ],
        });

        const imported = importProfiles(json);

        expect(imported[0].apiKey).toBeUndefined();
      });

      it('should preserve non-redacted API keys', () => {
        const json = JSON.stringify({
          profiles: [
            { id: 'test', name: 'Test', provider: 'grok', baseURL: 'http://test/v1', apiKey: 'real-key' },
          ],
        });

        const imported = importProfiles(json);

        expect(imported[0].apiKey).toBe('real-key');
      });

      it('should throw on invalid JSON', () => {
        expect(() => importProfiles('invalid')).toThrow();
      });

      it('should throw on invalid format', () => {
        expect(() => importProfiles('{"notProfiles": []}')).toThrow();
      });
    });
  });
});
