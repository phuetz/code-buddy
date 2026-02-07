import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  PROVIDER_ENV_MAP,
  PROVIDER_DEFAULT_MODEL,
  writeConfig,
  OnboardingResult,
} from '../../src/wizard/onboarding.js';

describe('onboarding', () => {
  describe('PROVIDER_ENV_MAP', () => {
    it('should map grok to GROK_API_KEY', () => {
      expect(PROVIDER_ENV_MAP['grok']).toBe('GROK_API_KEY');
    });

    it('should map claude to ANTHROPIC_API_KEY', () => {
      expect(PROVIDER_ENV_MAP['claude']).toBe('ANTHROPIC_API_KEY');
    });

    it('should map chatgpt to OPENAI_API_KEY', () => {
      expect(PROVIDER_ENV_MAP['chatgpt']).toBe('OPENAI_API_KEY');
    });

    it('should have empty string for local providers', () => {
      expect(PROVIDER_ENV_MAP['ollama']).toBe('');
      expect(PROVIDER_ENV_MAP['lmstudio']).toBe('');
    });
  });

  describe('PROVIDER_DEFAULT_MODEL', () => {
    it('should have default models for all providers', () => {
      expect(PROVIDER_DEFAULT_MODEL['grok']).toBe('grok-3');
      expect(PROVIDER_DEFAULT_MODEL['claude']).toBe('claude-sonnet-4-20250514');
      expect(PROVIDER_DEFAULT_MODEL['chatgpt']).toBe('gpt-4o');
      expect(PROVIDER_DEFAULT_MODEL['gemini']).toBe('gemini-2.0-flash');
      expect(PROVIDER_DEFAULT_MODEL['ollama']).toBe('llama3');
    });
  });

  describe('writeConfig', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `onboarding-test-${Date.now()}`);
    });

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    });

    it('should write config.json with correct content', () => {
      const result: OnboardingResult = {
        provider: 'grok',
        apiKey: 'test-key',
        model: 'grok-3',
        ttsEnabled: false,
      };

      writeConfig(tmpDir, result);

      const config = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      expect(config.provider).toBe('grok');
      expect(config.model).toBe('grok-3');
      expect(config.ttsEnabled).toBe(false);
      expect(config.ttsProvider).toBeUndefined();
    });

    it('should include ttsProvider when tts is enabled', () => {
      const result: OnboardingResult = {
        provider: 'claude',
        apiKey: '',
        model: 'claude-sonnet-4-20250514',
        ttsEnabled: true,
        ttsProvider: 'edge-tts',
      };

      writeConfig(tmpDir, result);

      const config = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      expect(config.ttsEnabled).toBe(true);
      expect(config.ttsProvider).toBe('edge-tts');
    });

    it('should not include apiKey in config file', () => {
      const result: OnboardingResult = {
        provider: 'grok',
        apiKey: 'secret-key',
        model: 'grok-3',
        ttsEnabled: false,
      };

      writeConfig(tmpDir, result);

      const config = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      expect(config.apiKey).toBeUndefined();
    });

    it('should create directory if it does not exist', () => {
      const nested = join(tmpDir, 'nested', 'dir');
      const result: OnboardingResult = {
        provider: 'ollama',
        apiKey: '',
        model: 'llama3',
        ttsEnabled: false,
      };

      writeConfig(nested, result);

      const config = JSON.parse(readFileSync(join(nested, 'config.json'), 'utf-8'));
      expect(config.provider).toBe('ollama');
    });
  });
});
