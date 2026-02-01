/**
 * Settings Migration
 *
 * Handles migration from old settings format to the new connection profiles system.
 */

import { logger } from '../utils/logger.js';
import {
  ConnectionConfig,
  ConnectionProfile,
  LegacyUserSettings,
  ModernUserSettings,
  DEFAULT_PROFILES,
  DEFAULT_CONNECTION_CONFIG,
  ProviderType,
} from './types.js';

// ============================================================================
// Migration Utilities
// ============================================================================

/**
 * Detect provider type from various hints
 */
export function detectProviderFromSettings(settings: LegacyUserSettings): ProviderType {
  // Check explicit provider
  if (settings.provider) {
    return settings.provider as ProviderType;
  }

  // Detect from baseURL
  const url = settings.baseURL?.toLowerCase() || '';

  if (url.includes('api.x.ai') || url.includes('xai')) return 'grok';
  if (url.includes('openai.com')) return 'openai';
  if (url.includes('anthropic.com')) return 'claude';
  if (url.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (url.includes(':1234')) return 'lmstudio';
  if (url.includes(':11434')) return 'ollama';
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'local';

  // Default
  return 'grok';
}

/**
 * Generate a unique profile ID
 */
function generateProfileId(baseName: string, existingIds: Set<string>): string {
  let id = baseName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  let counter = 1;

  while (existingIds.has(id)) {
    id = `${baseName}-${counter}`;
    counter++;
  }

  return id;
}

/**
 * Create a profile from legacy settings
 */
export function createProfileFromLegacy(
  settings: LegacyUserSettings,
  name: string = 'Migrated Configuration'
): ConnectionProfile {
  const provider = detectProviderFromSettings(settings);

  return {
    id: 'migrated',
    name,
    provider,
    baseURL: settings.baseURL || 'https://api.x.ai/v1',
    apiKey: settings.apiKey,
    model: settings.model || settings.defaultModel,
    isDefault: true,
    enabled: true,
    description: 'Automatically migrated from previous configuration',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Check if settings need migration
 */
export function needsMigration(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  const s = settings as Record<string, unknown>;

  // Already has connection config
  if (s.connection && typeof s.connection === 'object') {
    return false;
  }

  // Has old-style settings that should be migrated
  return !!(s.apiKey || s.baseURL || s.provider);
}

/**
 * Migrate legacy settings to modern format with connection profiles
 */
export function migrateSettings(oldSettings: LegacyUserSettings): ModernUserSettings {
  const profiles: ConnectionProfile[] = [];
  const addedIds = new Set<string>();
  let activeProfileId = 'grok'; // Default

  // Check if there's meaningful custom configuration
  const hasCustomConfig = !!(
    (oldSettings.apiKey && oldSettings.apiKey !== process.env.GROK_API_KEY) ||
    (oldSettings.baseURL && !oldSettings.baseURL.includes('api.x.ai'))
  );

  if (hasCustomConfig) {
    // Create a profile from the old settings
    const provider = detectProviderFromSettings(oldSettings);
    const defaultIds = new Set<string>(DEFAULT_PROFILES.map(p => p.id));
    const profileId = generateProfileId(provider, defaultIds);

    const migratedProfile: ConnectionProfile = {
      id: profileId,
      name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} (Migrated)`,
      provider,
      baseURL: oldSettings.baseURL || 'https://api.x.ai/v1',
      apiKey: oldSettings.apiKey,
      model: oldSettings.model || oldSettings.defaultModel,
      isDefault: true,
      enabled: true,
      description: 'Automatically migrated from previous configuration',
      createdAt: new Date().toISOString(),
    };

    profiles.push(migratedProfile);
    addedIds.add(profileId);
    activeProfileId = profileId;

    logger.info(`Migrated settings to new profile: ${migratedProfile.name}`);
  }

  // Add default profiles
  for (const defaultProfile of DEFAULT_PROFILES) {
    if (!addedIds.has(defaultProfile.id)) {
      // If we have a migrated profile, mark default profiles as not default
      const profile = { ...defaultProfile };
      if (hasCustomConfig) {
        profile.isDefault = false;
      }
      profiles.push(profile);
      addedIds.add(profile.id);
    }
  }

  // Build the modern settings
  const modernSettings: ModernUserSettings = {
    // Preserve non-connection settings
    defaultModel: oldSettings.defaultModel,
    models: oldSettings.models,

    // Add connection configuration
    connection: {
      profiles,
      activeProfileId,
      envVarsFallback: true,
      autoSwitchLocal: false,
      rememberPerProject: false,
    },
  };

  return modernSettings;
}

/**
 * Merge default profiles with user profiles
 */
export function mergeWithDefaults(userConfig: Partial<ConnectionConfig>): ConnectionConfig {
  const existingIds = new Set(userConfig.profiles?.map(p => p.id) || []);

  // Add missing default profiles
  const mergedProfiles = [...(userConfig.profiles || [])];

  for (const defaultProfile of DEFAULT_PROFILES) {
    if (!existingIds.has(defaultProfile.id)) {
      mergedProfiles.push(defaultProfile);
    }
  }

  return {
    ...DEFAULT_CONNECTION_CONFIG,
    ...userConfig,
    profiles: mergedProfiles,
  };
}

/**
 * Validate and fix connection config
 */
export function validateConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  const validated = { ...config };

  // Ensure profiles is an array
  if (!Array.isArray(validated.profiles)) {
    validated.profiles = [...DEFAULT_PROFILES];
  }

  // Ensure activeProfileId exists in profiles
  const profileIds = new Set(validated.profiles.map(p => p.id));
  if (!profileIds.has(validated.activeProfileId)) {
    // Find a default profile or use 'grok'
    const defaultProfile = validated.profiles.find(p => p.isDefault);
    validated.activeProfileId = defaultProfile?.id || 'grok';

    // Ensure grok exists
    if (!profileIds.has('grok')) {
      const grokProfile = DEFAULT_PROFILES.find(p => p.id === 'grok');
      if (grokProfile) {
        validated.profiles.push(grokProfile);
        validated.activeProfileId = 'grok';
      }
    }
  }

  // Ensure each profile has required fields
  validated.profiles = validated.profiles.map(profile => ({
    ...profile,
    enabled: profile.enabled ?? true,
    createdAt: profile.createdAt || new Date().toISOString(),
  }));

  return validated;
}

// ============================================================================
// Profile Utilities
// ============================================================================

/**
 * Clone a profile with a new ID
 */
export function cloneProfile(
  profile: ConnectionProfile,
  newId: string,
  newName?: string
): ConnectionProfile {
  return {
    ...profile,
    id: newId,
    name: newName || `${profile.name} (Copy)`,
    isDefault: false,
    createdAt: new Date().toISOString(),
    lastUsedAt: undefined,
  };
}

/**
 * Create a custom profile
 */
export function createCustomProfile(
  id: string,
  name: string,
  baseURL: string,
  apiKey?: string,
  options?: Partial<ConnectionProfile>
): ConnectionProfile {
  const provider = detectProviderFromBaseURL(baseURL);

  return {
    id,
    name,
    provider,
    baseURL,
    apiKey,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...options,
  };
}

/**
 * Detect provider from base URL
 */
function detectProviderFromBaseURL(url: string): ProviderType {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('api.x.ai')) return 'grok';
  if (urlLower.includes('openai.com')) return 'openai';
  if (urlLower.includes('anthropic.com')) return 'claude';
  if (urlLower.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (urlLower.includes(':1234')) return 'lmstudio';
  if (urlLower.includes(':11434')) return 'ollama';
  if (urlLower.includes('localhost') || urlLower.includes('127.0.0.1')) return 'local';

  return 'grok';
}

/**
 * Export profiles to JSON for backup
 */
export function exportProfiles(profiles: ConnectionProfile[]): string {
  // Remove sensitive data before export
  const sanitized = profiles.map(p => ({
    ...p,
    apiKey: p.apiKey ? '***REDACTED***' : undefined,
  }));

  return JSON.stringify({ profiles: sanitized }, null, 2);
}

/**
 * Import profiles from JSON
 */
export function importProfiles(json: string): ConnectionProfile[] {
  try {
    const data = JSON.parse(json);
    if (!data.profiles || !Array.isArray(data.profiles)) {
      throw new Error('Invalid profiles format');
    }

    return data.profiles.map((p: ConnectionProfile) => ({
      ...p,
      // Clear redacted API keys
      apiKey: p.apiKey === '***REDACTED***' ? undefined : p.apiKey,
      // Update timestamps
      createdAt: p.createdAt || new Date().toISOString(),
    }));
  } catch (error) {
    logger.error('Failed to import profiles:', error instanceof Error ? error : undefined);
    throw new Error('Failed to parse profiles JSON');
  }
}
