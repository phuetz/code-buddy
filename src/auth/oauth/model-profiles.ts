import { getProviderDefaultModel } from '../../config/model-defaults.js';
/**
 * Model Profile Manager
 *
 * Manages multiple AI provider profiles with failover support.
 * Automatically switches to backup providers when failures occur.
 */

import { getOllamaV1BaseUrl } from '../../utils/ollama-url.js';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type {
  ModelProfile,
  ProfileSelection,
  OAuthProviderId,
  StoredCredential,
} from './types.js';
import { OAuthManager } from './manager.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Profile manager configuration
 */
export interface ProfileManagerConfig {
  /** Maximum consecutive failures before circuit opens */
  circuitBreakerThreshold: number;
  /** Circuit breaker reset time (ms) */
  circuitBreakerResetMs: number;
  /** Half-open test interval (ms) */
  halfOpenIntervalMs: number;
  /** Failure decay time (ms) - failures older than this don't count */
  failureDecayMs: number;
}

/**
 * Default profile manager configuration
 */
export const DEFAULT_PROFILE_MANAGER_CONFIG: ProfileManagerConfig = {
  circuitBreakerThreshold: 3,
  circuitBreakerResetMs: 60 * 1000, // 1 minute
  halfOpenIntervalMs: 30 * 1000, // 30 seconds
  failureDecayMs: 5 * 60 * 1000, // 5 minutes
};

// ============================================================================
// Model Profile Manager
// ============================================================================

/**
 * Model Profile Manager
 *
 * Manages provider profiles and handles automatic failover.
 */
export class ModelProfileManager extends EventEmitter {
  private config: ProfileManagerConfig;
  private profiles: Map<string, ModelProfile> = new Map();
  private oauthManager: OAuthManager | null = null;
  private halfOpenTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<ProfileManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PROFILE_MANAGER_CONFIG, ...config };
    this.initializeDefaultProfiles();
  }

  /**
   * Set OAuth manager for OAuth-authenticated profiles
   */
  setOAuthManager(manager: OAuthManager): void {
    this.oauthManager = manager;
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /**
   * Add or update a profile
   */
  addProfile(profile: Omit<ModelProfile, 'failureCount' | 'circuitState'>): void {
    const fullProfile: ModelProfile = {
      ...profile,
      failureCount: 0,
      circuitState: 'closed',
    };
    this.profiles.set(profile.id, fullProfile);
  }

  /**
   * Get profile by ID
   */
  getProfile(id: string): ModelProfile | undefined {
    return this.profiles.get(id);
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): ModelProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get enabled profiles sorted by priority
   */
  getEnabledProfiles(): ModelProfile[] {
    return this.getAllProfiles()
      .filter(p => p.enabled)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a profile
   */
  removeProfile(id: string): boolean {
    const timer = this.halfOpenTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.halfOpenTimers.delete(id);
    }
    return this.profiles.delete(id);
  }

  /**
   * Enable a profile
   */
  enableProfile(id: string): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;
    profile.enabled = true;
    return true;
  }

  /**
   * Disable a profile
   */
  disableProfile(id: string): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;
    profile.enabled = false;
    return true;
  }

  // ============================================================================
  // Profile Selection
  // ============================================================================

  /**
   * Get the best available profile for a model
   */
  selectProfile(preferredModel?: string): ProfileSelection | null {
    const enabledProfiles = this.getEnabledProfiles();

    for (const profile of enabledProfiles) {
      // Skip if circuit is open
      if (profile.circuitState === 'open') {
        continue;
      }

      // Check if profile supports the model
      if (preferredModel && !this.profileSupportsModel(profile, preferredModel)) {
        continue;
      }

      // Check if profile is ready
      if (!this.isProfileReady(profile)) {
        continue;
      }

      const model = preferredModel || profile.defaultModel || profile.models[0];
      // Skip profiles with no resolvable model (empty models[] and no default)
      if (model === undefined) {
        continue;
      }
      const selection: ProfileSelection = {
        profile,
        model,
        reason: profile.circuitState === 'half-open' ? 'testing' : 'primary',
      };

      this.emit('profile:selected', selection);
      return selection;
    }

    return null;
  }

  /**
   * Get next available profile after a failure
   */
  async getNextAvailableProfile(
    failedProfileId: string,
    preferredModel?: string
  ): Promise<ProfileSelection | null> {
    // Record the failure first
    this.recordFailure(failedProfileId);

    // Get all enabled profiles except the failed one
    const candidates = this.getEnabledProfiles()
      .filter(p => p.id !== failedProfileId && p.circuitState !== 'open');

    for (const profile of candidates) {
      if (preferredModel && !this.profileSupportsModel(profile, preferredModel)) {
        continue;
      }

      if (!this.isProfileReady(profile)) {
        continue;
      }

      const model = preferredModel || profile.defaultModel || profile.models[0];
      // Skip profiles with no resolvable model (empty models[] and no default)
      if (model === undefined) {
        continue;
      }
      const selection: ProfileSelection = {
        profile,
        model,
        reason: 'failover',
      };

      this.emit('profile:failover', failedProfileId, profile.id);
      this.emit('profile:selected', selection);
      return selection;
    }

    return null;
  }

  // ============================================================================
  // Failure Tracking
  // ============================================================================

  /**
   * Record a failure for a profile
   */
  recordFailure(profileId: string, error?: Error): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;

    profile.failureCount++;
    profile.lastFailureAt = new Date();

    // Check if we should open the circuit
    if (profile.failureCount >= this.config.circuitBreakerThreshold) {
      this.openCircuit(profileId);
    }

    this.emit('profile:failure', profileId, error);
  }

  /**
   * Record a success for a profile
   */
  recordSuccess(profileId: string): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;

    // Reset failure count
    profile.failureCount = 0;

    // If half-open, close the circuit
    if (profile.circuitState === 'half-open') {
      profile.circuitState = 'closed';
      this.emit('profile:circuit-closed', profileId);
    }
  }

  /**
   * Open the circuit breaker for a profile
   */
  private openCircuit(profileId: string): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;

    profile.circuitState = 'open';
    this.emit('profile:circuit-opened', profileId);

    // Schedule half-open check
    this.scheduleHalfOpen(profileId);
  }

  /**
   * Schedule transition to half-open state
   */
  private scheduleHalfOpen(profileId: string): void {
    // Cancel existing timer
    const existing = this.halfOpenTimers.get(profileId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      const profile = this.profiles.get(profileId);
      if (profile && profile.circuitState === 'open') {
        profile.circuitState = 'half-open';
        profile.failureCount = 0;
        this.emit('profile:circuit-half-open', profileId);
      }
      this.halfOpenTimers.delete(profileId);
    }, this.config.circuitBreakerResetMs);

    this.halfOpenTimers.set(profileId, timer);
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Get access token for a profile
   */
  async getAccessToken(profileId: string): Promise<string | null> {
    const profile = this.profiles.get(profileId);
    if (!profile) return null;

    if (profile.authType === 'api_key') {
      return profile.apiKey || null;
    }

    if (profile.authType === 'oauth' && this.oauthManager && profile.credentialId) {
      try {
        return await this.oauthManager.getAccessToken(profile.credentialId);
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Check if a profile is ready to use
   */
  isProfileReady(profile: ModelProfile): boolean {
    if (profile.authType === 'api_key') {
      return !!profile.apiKey;
    }

    if (profile.authType === 'oauth') {
      if (!this.oauthManager || !profile.credentialId) return false;
      const credential = this.oauthManager.getCredential(profile.credentialId);
      return !!credential && !this.oauthManager.isTokenExpired(credential);
    }

    return false;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Check if a profile supports a specific model
   */
  private profileSupportsModel(profile: ModelProfile, model: string): boolean {
    // Check exact match
    if (profile.models.includes(model)) return true;

    // Check pattern match (e.g., 'gpt-4*' matches 'gpt-4-turbo')
    for (const supportedModel of profile.models) {
      if (supportedModel.endsWith('*')) {
        const prefix = supportedModel.slice(0, -1);
        if (model.startsWith(prefix)) return true;
      }
    }

    return false;
  }

  /**
   * Initialize default profiles
   */
  private initializeDefaultProfiles(): void {
    // Grok profile (default)
    this.addProfile({
      id: 'grok-default',
      name: 'Grok (xAI)',
      providerId: 'grok',
      authType: 'api_key',
      apiKey: process.env.GROK_API_KEY,
      baseUrl: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
      priority: 100,
      models: ['grok-4-latest', 'grok-3', 'grok-code-fast-1', 'grok-*'],
      defaultModel: getProviderDefaultModel('xai'),
      enabled: !!process.env.GROK_API_KEY,
    });

    // OpenAI profile
    this.addProfile({
      id: 'openai-default',
      name: 'OpenAI (ChatGPT)',
      providerId: 'openai',
      authType: 'api_key',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
      priority: 80,
      models: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'gpt-*'],
      defaultModel: getProviderDefaultModel('openai'),
      enabled: !!process.env.OPENAI_API_KEY,
    });

    // Anthropic profile
    this.addProfile({
      id: 'anthropic-default',
      name: 'Anthropic (Claude)',
      providerId: 'anthropic',
      authType: 'api_key',
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: 'https://api.anthropic.com',
      priority: 90,
      models: ['claude-sonnet-4', 'claude-opus-4', 'claude-3-opus', 'claude-3-sonnet', 'claude-*'],
      defaultModel: getProviderDefaultModel('anthropic'),
      enabled: !!process.env.ANTHROPIC_API_KEY,
    });

    // Google profile
    this.addProfile({
      id: 'google-default',
      name: 'Google (Gemini)',
      providerId: 'google',
      authType: 'api_key',
      apiKey: process.env.GOOGLE_API_KEY,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      priority: 70,
      models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-*'],
      defaultModel: getProviderDefaultModel('google'),
      enabled: !!process.env.GOOGLE_API_KEY,
    });

    // Ollama profile
    this.addProfile({
      id: 'ollama-local',
      name: 'Ollama (Local)',
      providerId: 'ollama',
      authType: 'api_key',
      apiKey: 'ollama',
      baseUrl: getOllamaV1BaseUrl(),
      priority: 50,
      models: ['llama3.2', 'codellama', 'mistral', 'mixtral', '*'],
      enabled: false, // Enable manually if Ollama is running
    });
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalProfiles: number;
    enabledProfiles: number;
    openCircuits: number;
    halfOpenCircuits: number;
  } {
    const profiles = this.getAllProfiles();
    return {
      totalProfiles: profiles.length,
      enabledProfiles: profiles.filter(p => p.enabled).length,
      openCircuits: profiles.filter(p => p.circuitState === 'open').length,
      halfOpenCircuits: profiles.filter(p => p.circuitState === 'half-open').length,
    };
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    for (const timer of this.halfOpenTimers.values()) {
      clearTimeout(timer);
    }
    this.halfOpenTimers.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let profileManagerInstance: ModelProfileManager | null = null;

/**
 * Get model profile manager instance
 */
export function getModelProfileManager(config?: Partial<ProfileManagerConfig>): ModelProfileManager {
  if (!profileManagerInstance) {
    profileManagerInstance = new ModelProfileManager(config);
  }
  return profileManagerInstance;
}

/**
 * Reset model profile manager instance
 */
export function resetModelProfileManager(): void {
  if (profileManagerInstance) {
    profileManagerInstance.shutdown();
    profileManagerInstance = null;
  }
}

export default ModelProfileManager;
