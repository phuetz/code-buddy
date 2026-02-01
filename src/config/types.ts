/**
 * Configuration Types
 *
 * Types for connection profiles and configuration resolution.
 * Part of the Phase 7: Connection Profiles System.
 */

import { AIProvider } from '../utils/config-validator.js';

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Extended provider type including local inference servers
 */
export type ProviderType = AIProvider | 'anthropic' | 'deepseek' | 'mistral' | 'groq' | 'together' | 'fireworks';

/**
 * Auto-detection configuration for local servers
 */
export interface AutoDetectConfig {
  /** Ports to check for this server type */
  ports: number[];
  /** Health check endpoint path */
  healthEndpoint?: string;
  /** Expected response substring to validate server */
  expectedResponse?: string;
  /** Timeout for health check in ms */
  timeout?: number;
}

// ============================================================================
// Connection Profile
// ============================================================================

/**
 * A connection profile represents a configured AI provider
 */
export interface ConnectionProfile {
  /** Unique identifier for the profile */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider type */
  provider: ProviderType;
  /** API base URL */
  baseURL: string;
  /** API key (can be empty for local servers) */
  apiKey?: string;
  /** Default model for this profile */
  model?: string;
  /** Is this the default profile */
  isDefault?: boolean;
  /** Auto-detection config for local servers */
  autoDetect?: AutoDetectConfig;
  /** Additional provider-specific options */
  options?: Record<string, unknown>;
  /** Profile description */
  description?: string;
  /** Profile icon/emoji */
  icon?: string;
  /** Is this profile enabled */
  enabled?: boolean;
  /** Created timestamp */
  createdAt?: string;
  /** Last used timestamp */
  lastUsedAt?: string;
}

// ============================================================================
// Connection Config
// ============================================================================

/**
 * Connection configuration containing profiles and settings
 */
export interface ConnectionConfig {
  /** Available connection profiles */
  profiles: ConnectionProfile[];
  /** Currently active profile ID */
  activeProfileId: string;
  /** Use environment variables as fallback (not override) */
  envVarsFallback: boolean;
  /** Auto-switch to available local server */
  autoSwitchLocal?: boolean;
  /** Remember last used profile per project */
  rememberPerProject?: boolean;
}

// ============================================================================
// Resolved Config
// ============================================================================

/**
 * Final resolved configuration after applying priority rules
 */
export interface ResolvedConfig {
  /** Effective API base URL */
  baseURL: string;
  /** Effective API key */
  apiKey: string;
  /** Effective model */
  model: string;
  /** Provider type */
  provider: ProviderType;
  /** Profile ID that was resolved (if any) */
  profileId?: string;
  /** Profile name */
  profileName?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Source of the configuration */
  source: ConfigSource;
  /** Additional provider options */
  options?: Record<string, unknown>;
}

/**
 * Source of configuration values
 */
export type ConfigSource =
  | 'cli'           // CLI arguments (highest priority)
  | 'profile'       // User profile selection
  | 'environment'   // Environment variables
  | 'default';      // Built-in defaults

// ============================================================================
// CLI Overrides
// ============================================================================

/**
 * CLI argument overrides for configuration
 */
export interface CLIOverrides {
  /** Base URL override */
  baseURL?: string;
  /** API key override */
  apiKey?: string;
  /** Model override */
  model?: string;
  /** Profile ID to use */
  profile?: string;
  /** Provider override */
  provider?: ProviderType;
}

// ============================================================================
// Server Detection
// ============================================================================

/**
 * Result of server auto-detection
 */
export interface ServerDetectionResult {
  /** Profile ID */
  profileId: string;
  /** Whether server is available */
  available: boolean;
  /** Response time in ms */
  responseTime?: number;
  /** Server version if detected */
  version?: string;
  /** Available models */
  models?: string[];
  /** Error if not available */
  error?: string;
}

// ============================================================================
// Default Profiles
// ============================================================================

/**
 * Built-in default profiles
 */
export const DEFAULT_PROFILES: ConnectionProfile[] = [
  {
    id: 'grok',
    name: 'Grok API (xAI)',
    provider: 'grok',
    baseURL: 'https://api.x.ai/v1',
    model: 'grok-code-fast-1',
    isDefault: true,
    icon: '🤖',
    description: 'xAI Grok API - production-ready AI inference',
    enabled: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio Local',
    provider: 'lmstudio',
    baseURL: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
    icon: '🏠',
    description: 'LM Studio local inference server',
    enabled: true,
    autoDetect: {
      ports: [1234],
      healthEndpoint: '/v1/models',
      timeout: 2000,
    },
  },
  {
    id: 'ollama',
    name: 'Ollama Local',
    provider: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    icon: '🦙',
    description: 'Ollama local inference server',
    enabled: true,
    autoDetect: {
      ports: [11434],
      healthEndpoint: '/api/tags',
      timeout: 2000,
    },
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    icon: '🧠',
    description: 'OpenAI GPT models',
    enabled: true,
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    provider: 'claude',
    baseURL: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    icon: '🎭',
    description: 'Anthropic Claude models',
    enabled: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash',
    icon: '💎',
    description: 'Google Gemini models',
    enabled: true,
  },
];

/**
 * Default connection configuration
 */
export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
  profiles: [...DEFAULT_PROFILES],
  activeProfileId: 'grok',
  envVarsFallback: true,
  autoSwitchLocal: false,
  rememberPerProject: false,
};

// ============================================================================
// Profile Events
// ============================================================================

/**
 * Events emitted by profile manager
 */
export interface ProfileEvents {
  'profile-changed': (profileId: string, profile: ConnectionProfile) => void;
  'profile-added': (profile: ConnectionProfile) => void;
  'profile-removed': (profileId: string) => void;
  'profile-updated': (profile: ConnectionProfile) => void;
  'server-detected': (result: ServerDetectionResult) => void;
  'connection-error': (profileId: string, error: Error) => void;
}

// ============================================================================
// Migration Types
// ============================================================================

/**
 * Old settings format (for migration)
 */
export interface LegacyUserSettings {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  models?: string[];
  provider?: string;
  model?: string;
}

/**
 * New settings format with connection profiles
 */
export interface ModernUserSettings extends LegacyUserSettings {
  connection?: ConnectionConfig;
}
