/**
 * Configuration Resolver
 *
 * Resolves configuration with the correct priority:
 * 1. CLI Arguments (highest priority)
 * 2. Active Profile (user selection)
 * 3. Environment Variables (fallback)
 * 4. Defaults (lowest priority)
 *
 * This replaces the old system where env vars always overrode user settings.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import {
  ConnectionConfig,
  ConnectionProfile,
  ResolvedConfig,
  CLIOverrides,
  ServerDetectionResult,
  DEFAULT_PROFILES,
  DEFAULT_CONNECTION_CONFIG,
  ProviderType,
  ProfileEvents,
} from './types.js';

// ============================================================================
// Config Resolver
// ============================================================================

/**
 * Resolves configuration with proper priority handling
 */
export class ConfigResolver extends EventEmitter {
  private profiles: Map<string, ConnectionProfile>;
  private activeProfileId: string;
  private envVarsFallback: boolean;
  private autoSwitchLocal: boolean;

  constructor(config?: Partial<ConnectionConfig>) {
    super();

    const mergedConfig = {
      ...DEFAULT_CONNECTION_CONFIG,
      ...config,
      profiles: config?.profiles || [...DEFAULT_PROFILES],
    };

    this.profiles = new Map(mergedConfig.profiles.map(p => [p.id, p]));
    this.activeProfileId = mergedConfig.activeProfileId || 'grok';
    this.envVarsFallback = mergedConfig.envVarsFallback ?? true;
    this.autoSwitchLocal = mergedConfig.autoSwitchLocal ?? false;

    // Ensure default profiles are always available
    this.ensureDefaultProfiles();
  }

  /**
   * Ensure default profiles exist
   */
  private ensureDefaultProfiles(): void {
    for (const profile of DEFAULT_PROFILES) {
      if (!this.profiles.has(profile.id)) {
        this.profiles.set(profile.id, profile);
      }
    }
  }

  /**
   * Resolve configuration with proper priority
   *
   * Priority order (highest to lowest):
   * 1. CLI overrides
   * 2. Active profile
   * 3. Environment variables (if envVarsFallback is true)
   * 4. Built-in defaults
   */
  resolve(cliOverrides?: CLIOverrides): ResolvedConfig {
    // 1. If CLI specifies a profile, use that
    if (cliOverrides?.profile) {
      const profile = this.profiles.get(cliOverrides.profile);
      if (profile) {
        return this.resolveFromProfile(profile, cliOverrides, 'cli');
      }
      logger.warn(`Profile '${cliOverrides.profile}' not found, falling back`);
    }

    // 2. If CLI provides direct config values, use those
    if (cliOverrides?.baseURL || cliOverrides?.apiKey) {
      return this.resolveFromCLI(cliOverrides);
    }

    // 3. Try active profile
    const activeProfile = this.profiles.get(this.activeProfileId);
    if (activeProfile && activeProfile.enabled !== false) {
      return this.resolveFromProfile(activeProfile, cliOverrides, 'profile');
    }

    // 4. Environment variables as fallback (if enabled)
    if (this.envVarsFallback) {
      const envConfig = this.resolveFromEnv();
      if (envConfig.apiKey) {
        return envConfig;
      }
    }

    // 5. Default profile
    const defaultProfile = [...this.profiles.values()].find(p => p.isDefault);
    if (defaultProfile) {
      return this.resolveFromProfile(defaultProfile, cliOverrides, 'default');
    }

    // 6. Built-in fallback
    return this.getBuiltinDefault();
  }

  /**
   * Resolve from CLI arguments
   */
  private resolveFromCLI(cli: CLIOverrides): ResolvedConfig {
    return {
      baseURL: cli.baseURL || process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
      apiKey: cli.apiKey || process.env.GROK_API_KEY || '',
      model: cli.model || process.env.GROK_MODEL || 'grok-code-fast-1',
      provider: cli.provider || this.detectProvider(cli.baseURL) || 'grok',
      source: 'cli',
    };
  }

  /**
   * Resolve from a profile, applying any CLI overrides
   */
  private resolveFromProfile(
    profile: ConnectionProfile,
    cli?: CLIOverrides,
    source: 'cli' | 'profile' | 'default' = 'profile'
  ): ResolvedConfig {
    // Update last used timestamp
    profile.lastUsedAt = new Date().toISOString();

    return {
      baseURL: cli?.baseURL || profile.baseURL,
      apiKey: cli?.apiKey || profile.apiKey || '',
      model: cli?.model || profile.model || 'grok-code-fast-1',
      provider: cli?.provider || profile.provider,
      profileId: profile.id,
      profileName: profile.name,
      timeout: profile.options?.timeout as number | undefined,
      source,
      options: profile.options,
    };
  }

  /**
   * Resolve from environment variables
   * Priority: Gemini > Grok > OpenAI > Anthropic
   */
  private resolveFromEnv(): ResolvedConfig {
    // Check Gemini first (preferred)
    const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      return {
        baseURL: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: geminiKey,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        provider: 'gemini',
        source: 'environment',
      };
    }

    // Check Grok
    const grokKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
    if (grokKey) {
      const baseURL = process.env.GROK_BASE_URL || 'https://api.x.ai/v1';
      return {
        baseURL,
        apiKey: grokKey,
        model: process.env.GROK_MODEL || 'grok-code-fast-1',
        provider: 'grok',
        source: 'environment',
      };
    }

    // Check OpenAI
    if (process.env.OPENAI_API_KEY) {
      return {
        baseURL: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        provider: 'openai',
        source: 'environment',
      };
    }

    // Check Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      return {
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        provider: 'claude',
        source: 'environment',
      };
    }

    // Fallback to Grok defaults (no key)
    const baseURL = process.env.GROK_BASE_URL || 'https://api.x.ai/v1';
    return {
      baseURL,
      apiKey: '',
      model: process.env.GROK_MODEL || 'grok-code-fast-1',
      provider: this.detectProvider(baseURL) || 'grok',
      source: 'environment',
    };
  }

  /**
   * Get built-in default configuration
   */
  private getBuiltinDefault(): ResolvedConfig {
    return {
      baseURL: 'https://api.x.ai/v1',
      apiKey: '',
      model: 'grok-code-fast-1',
      provider: 'grok',
      source: 'default',
    };
  }

  /**
   * Detect provider from URL
   */
  private detectProvider(url?: string): ProviderType | null {
    if (!url) return null;

    const urlLower = url.toLowerCase();

    // Cloud providers
    if (urlLower.includes('api.x.ai') || urlLower.includes('xai')) return 'grok';
    if (urlLower.includes('openai.com')) return 'openai';
    if (urlLower.includes('anthropic.com')) return 'claude';
    if (urlLower.includes('generativelanguage.googleapis.com') || urlLower.includes('gemini')) return 'gemini';
    if (urlLower.includes('deepseek')) return 'deepseek';
    if (urlLower.includes('mistral.ai')) return 'mistral';
    if (urlLower.includes('groq.com')) return 'groq';
    if (urlLower.includes('together.xyz') || urlLower.includes('together.ai')) return 'together';
    if (urlLower.includes('fireworks.ai')) return 'fireworks';

    // Local providers (by port)
    if (urlLower.includes(':1234')) return 'lmstudio';
    if (urlLower.includes(':11434')) return 'ollama';

    // Generic local
    if (urlLower.includes('localhost') || urlLower.includes('127.0.0.1')) return 'local';

    return null;
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /**
   * Get the active profile
   */
  getActiveProfile(): ConnectionProfile | undefined {
    return this.profiles.get(this.activeProfileId);
  }

  /**
   * Get active profile ID
   */
  getActiveProfileId(): string {
    return this.activeProfileId;
  }

  /**
   * Set the active profile
   */
  setActiveProfile(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      logger.warn(`Profile '${profileId}' not found`);
      return false;
    }

    if (profile.enabled === false) {
      logger.warn(`Profile '${profileId}' is disabled`);
      return false;
    }

    const oldId = this.activeProfileId;
    this.activeProfileId = profileId;

    if (oldId !== profileId) {
      this.emit('profile-changed', profileId, profile);
      logger.info(`Switched to profile: ${profile.name} (${profileId})`);
    }

    return true;
  }

  /**
   * Get all profiles
   */
  getProfiles(): ConnectionProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get enabled profiles only
   */
  getEnabledProfiles(): ConnectionProfile[] {
    return this.getProfiles().filter(p => p.enabled !== false);
  }

  /**
   * Get a profile by ID
   */
  getProfile(profileId: string): ConnectionProfile | undefined {
    return this.profiles.get(profileId);
  }

  /**
   * Add a new profile
   */
  addProfile(profile: ConnectionProfile): void {
    if (this.profiles.has(profile.id)) {
      throw new Error(`Profile '${profile.id}' already exists`);
    }

    profile.createdAt = new Date().toISOString();
    profile.enabled = profile.enabled ?? true;
    this.profiles.set(profile.id, profile);
    this.emit('profile-added', profile);
    logger.info(`Added profile: ${profile.name} (${profile.id})`);
  }

  /**
   * Update an existing profile
   */
  updateProfile(profileId: string, updates: Partial<ConnectionProfile>): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }

    // Don't allow changing the ID
    const { id: _id, ...safeUpdates } = updates;
    Object.assign(profile, safeUpdates);
    this.emit('profile-updated', profile);
    logger.info(`Updated profile: ${profile.name} (${profileId})`);
    return true;
  }

  /**
   * Remove a profile
   */
  removeProfile(profileId: string): boolean {
    // Don't allow removing default profiles
    if (DEFAULT_PROFILES.some(p => p.id === profileId)) {
      logger.warn(`Cannot remove built-in profile: ${profileId}`);
      return false;
    }

    if (!this.profiles.has(profileId)) {
      return false;
    }

    this.profiles.delete(profileId);

    // If we removed the active profile, switch to default
    if (this.activeProfileId === profileId) {
      this.activeProfileId = 'grok';
    }

    this.emit('profile-removed', profileId);
    logger.info(`Removed profile: ${profileId}`);
    return true;
  }

  // ============================================================================
  // Server Detection
  // ============================================================================

  /**
   * Auto-detect available local servers
   */
  async autoDetectLocalServers(): Promise<ServerDetectionResult[]> {
    const results: ServerDetectionResult[] = [];
    const localProfiles = this.getProfiles().filter(p => p.autoDetect);

    const detectionPromises = localProfiles.map(async (profile) => {
      const result = await this.detectServer(profile);
      results.push(result);
      this.emit('server-detected', result);
      return result;
    });

    await Promise.all(detectionPromises);
    return results;
  }

  /**
   * Detect if a specific server is available
   */
  async detectServer(profile: ConnectionProfile): Promise<ServerDetectionResult> {
    if (!profile.autoDetect) {
      return {
        profileId: profile.id,
        available: false,
        error: 'No auto-detect configuration',
      };
    }

    const { ports, healthEndpoint, timeout = 2000 } = profile.autoDetect;

    for (const port of ports) {
      try {
        const baseUrl = profile.baseURL.replace(/:\d+/, `:${port}`);
        const url = `${baseUrl.replace(/\/v1$/, '')}${healthEndpoint || '/v1/models'}`;

        const startTime = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${profile.apiKey || 'test'}`,
          },
        });

        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        if (response.ok) {
          let models: string[] | undefined;
          try {
            const data = await response.json() as { data?: Array<{ id: string }> };
            if (data.data && Array.isArray(data.data)) {
              models = data.data.map((m: { id: string }) => m.id);
            }
          } catch {
            // Ignore JSON parse errors
          }

          return {
            profileId: profile.id,
            available: true,
            responseTime,
            models,
          };
        }
      } catch (error) {
        // Server not available on this port, try next
        continue;
      }
    }

    return {
      profileId: profile.id,
      available: false,
      error: `Server not responding on ports: ${ports.join(', ')}`,
    };
  }

  /**
   * Test connection for the active profile
   */
  async testConnection(): Promise<ServerDetectionResult> {
    const profile = this.getActiveProfile();
    if (!profile) {
      return {
        profileId: this.activeProfileId,
        available: false,
        error: 'No active profile',
      };
    }

    // For cloud providers, make a simple API call
    if (!profile.autoDetect) {
      try {
        const startTime = Date.now();
        const url = `${profile.baseURL}/models`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${profile.apiKey || ''}`,
            'Content-Type': 'application/json',
          },
        });

        const responseTime = Date.now() - startTime;

        if (response.ok || response.status === 401) {
          // 401 means server is reachable but auth failed
          return {
            profileId: profile.id,
            available: response.ok,
            responseTime,
            error: response.status === 401 ? 'Invalid API key' : undefined,
          };
        }

        return {
          profileId: profile.id,
          available: false,
          responseTime,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      } catch (error) {
        return {
          profileId: profile.id,
          available: false,
          error: error instanceof Error ? error.message : 'Connection failed',
        };
      }
    }

    // For local servers, use the auto-detect logic
    return this.detectServer(profile);
  }

  // ============================================================================
  // Configuration Export
  // ============================================================================

  /**
   * Export current configuration
   */
  toConfig(): ConnectionConfig {
    return {
      profiles: this.getProfiles(),
      activeProfileId: this.activeProfileId,
      envVarsFallback: this.envVarsFallback,
      autoSwitchLocal: this.autoSwitchLocal,
    };
  }

  /**
   * Import configuration
   */
  fromConfig(config: ConnectionConfig): void {
    this.profiles.clear();
    for (const profile of config.profiles) {
      this.profiles.set(profile.id, profile);
    }
    this.activeProfileId = config.activeProfileId;
    this.envVarsFallback = config.envVarsFallback;
    this.autoSwitchLocal = config.autoSwitchLocal ?? false;

    // Ensure default profiles exist
    this.ensureDefaultProfiles();
  }

  // ============================================================================
  // Type Declarations for EventEmitter
  // ============================================================================

  on<K extends keyof ProfileEvents>(event: K, listener: ProfileEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof ProfileEvents>(event: K, ...args: Parameters<ProfileEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let resolverInstance: ConfigResolver | null = null;

/**
 * Get the singleton ConfigResolver instance
 */
export function getConfigResolver(): ConfigResolver {
  if (!resolverInstance) {
    resolverInstance = new ConfigResolver();
  }
  return resolverInstance;
}

/**
 * Initialize ConfigResolver with custom configuration
 */
export function initConfigResolver(config: ConnectionConfig): ConfigResolver {
  resolverInstance = new ConfigResolver(config);
  return resolverInstance;
}

/**
 * Reset the ConfigResolver singleton (for testing)
 */
export function resetConfigResolver(): void {
  resolverInstance = null;
}
