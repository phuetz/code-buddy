import { readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  PROVIDER_ENV_MAP,
  PROVIDER_DEFAULT_MODEL,
  buildRecommendedNextCommands,
  getProviderGuide,
  ONBOARDING_PHASES,
  renderOnboardingRoadmap,
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

    it('should treat chatgpt as OAuth instead of an OPENAI_API_KEY setup', () => {
      expect(PROVIDER_ENV_MAP['chatgpt']).toBe('');
    });

    it('should have empty string for local providers', () => {
      expect(PROVIDER_ENV_MAP['ollama']).toBe('');
      expect(PROVIDER_ENV_MAP['lmstudio']).toBe('');
    });

    it('should onboard OpenAI and OpenRouter via their API keys', () => {
      expect(PROVIDER_ENV_MAP['openai']).toBe('OPENAI_API_KEY');
      expect(PROVIDER_ENV_MAP['openrouter']).toBe('OPENROUTER_API_KEY');
      expect(getProviderGuide('openai')).toMatchObject({ authMode: 'api-key' });
      expect(getProviderGuide('openrouter')).toMatchObject({ authMode: 'api-key' });
    });
  });

  describe('PROVIDER_DEFAULT_MODEL', () => {
    it('should have default models for all providers', () => {
      expect(PROVIDER_DEFAULT_MODEL['grok']).toBe('grok-3');
      expect(PROVIDER_DEFAULT_MODEL['claude']).toBe('claude-sonnet-4-20250514');
      expect(PROVIDER_DEFAULT_MODEL['chatgpt']).toBe('gpt-5.6-sol');
      expect(PROVIDER_DEFAULT_MODEL['gemini']).toBe('gemini-2.0-flash');
      expect(PROVIDER_DEFAULT_MODEL['ollama']).toBe('llama3');
    });
  });

  describe('Hermes-style phases', () => {
    it('defines the onboarding phases Code Buddy should walk through', () => {
      expect(ONBOARDING_PHASES.map((phase) => phase.id)).toEqual([
        'install',
        'provider',
        'first-chat',
        'session-resume',
        'next-layer',
      ]);
      expect(ONBOARDING_PHASES[1]?.hermesPhase).toContain('provider');
      expect(ONBOARDING_PHASES[3]?.codeBuddyAction).toContain('buddy --continue');
    });

    it('recommends ChatGPT OAuth commands before the first smoke prompt', () => {
      const commands = buildRecommendedNextCommands({
        provider: 'chatgpt',
        apiKey: '',
        model: 'gpt-5.5',
      });

      expect(getProviderGuide('chatgpt')).toMatchObject({
        authMode: 'oauth',
        setupCommand: 'buddy login',
        verifyCommand: 'buddy whoami',
      });
      expect(commands.slice(0, 2)).toEqual(['buddy login', 'buddy whoami']);
      expect(commands).toContain(
        'buddy --model gpt-5.5 -p "Summarize this repo in 5 bullets and name the main entry point."'
      );
      expect(commands).toContain('buddy --continue');
    });

    it('renders a roadmap with phases and provider-specific next commands', () => {
      const roadmap = renderOnboardingRoadmap({
        provider: 'ollama',
        apiKey: '',
        model: 'llama3',
      });

      expect(roadmap).toContain('Hermes-style onboarding phases');
      expect(roadmap).toContain('Install and diagnose');
      expect(roadmap).toContain('ollama serve');
      expect(roadmap).toContain('buddy --continue');
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
      expect(config.authMode).toBe('api-key');
      expect(config.ttsEnabled).toBe(false);
      expect(config.ttsProvider).toBeUndefined();
      expect(config.onboarding.phases).toEqual(ONBOARDING_PHASES.map((phase) => phase.id));
      expect(config.onboarding.recommendedNextCommands).toContain('buddy doctor');
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

    it('writes chatgpt as an OAuth provider with login-first next steps', () => {
      const result: OnboardingResult = {
        provider: 'chatgpt',
        apiKey: '',
        model: 'gpt-5.5',
        ttsEnabled: false,
      };

      writeConfig(tmpDir, result);

      const config = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      expect(config.provider).toBe('chatgpt');
      expect(config.authMode).toBe('oauth');
      expect(config.onboarding.recommendedNextCommands.slice(0, 2)).toEqual([
        'buddy login',
        'buddy whoami',
      ]);
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
