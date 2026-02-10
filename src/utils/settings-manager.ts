import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "./logger.js";
import {
  getZodConfigValidator,
  UserSettingsSchema as _UserSettingsSchema,
  SettingsSchema as _SettingsSchema,
  AI_PROVIDERS,
  type UserSettings as ZodUserSettings,
  type Settings as ZodSettings,
} from "./config-validator.js";
import {
  ConfigResolver,
  getConfigResolver,
} from "../config/config-resolver.js";
import {
  ConnectionConfig,
  ConnectionProfile,
  ResolvedConfig,
  CLIOverrides,
  ModernUserSettings,
  needsMigration,
  migrateSettings,
  mergeWithDefaults,
  validateConnectionConfig,
} from "../config/index.js";

/**
 * User-level settings stored in ~/.codebuddy/user-settings.json
 * These are global settings that apply across all projects
 */
export interface UserSettings {
  apiKey?: string; // CodeBuddy API key
  baseURL?: string; // API base URL
  defaultModel?: string; // User's preferred default model
  models?: string[]; // Available models list
  provider?: string; // Active AI provider (grok, claude, openai, gemini)
  model?: string; // Current model override
  connection?: ConnectionConfig; // Connection profiles configuration
}

/**
 * Project-level settings stored in .codebuddy/settings.json
 * These are project-specific settings
 */
export interface ProjectSettings {
  model?: string; // Current model for this project
  mcpServers?: Record<string, unknown>; // MCP server configurations
}

/**
 * Default values for user settings
 */
const DEFAULT_USER_SETTINGS: Partial<UserSettings> = {
  baseURL: "https://api.x.ai/v1",
  defaultModel: "grok-code-fast-1",
  models: [
    "grok-code-fast-1",
    "grok-4-latest",
    "grok-3-latest",
    "grok-3-fast",
    "grok-3-mini-fast",
  ],
};

/**
 * Default values for project settings
 */
const DEFAULT_PROJECT_SETTINGS: Partial<ProjectSettings> = {
  model: "grok-code-fast-1",
};

/**
 * Unified settings manager that handles both user-level and project-level settings
 */
export class SettingsManager {
  private static instance: SettingsManager;

  private userSettingsPath: string;
  private projectSettingsPath: string;
  private configResolver: ConfigResolver | null = null;

  private constructor() {
    // User settings path: ~/.codebuddy/user-settings.json
    this.userSettingsPath = path.join(
      os.homedir(),
      ".codebuddy",
      "user-settings.json"
    );

    // Project settings path: .codebuddy/settings.json (in current working directory)
    this.projectSettingsPath = path.join(
      process.cwd(),
      ".codebuddy",
      "settings.json"
    );
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * Ensure directory exists for a given file path
   */
  private ensureDirectoryExists(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Load user settings from ~/.codebuddy/user-settings.json
   * Uses Zod validation for type safety and defaults
   */
  public loadUserSettings(): UserSettings {
    try {
      if (!fs.existsSync(this.userSettingsPath)) {
        // Create default user settings if file doesn't exist
        this.saveUserSettings(DEFAULT_USER_SETTINGS);
        return { ...DEFAULT_USER_SETTINGS };
      }

      const content = fs.readFileSync(this.userSettingsPath, "utf-8");
      let rawSettings: unknown;

      try {
        rawSettings = JSON.parse(content);
      } catch (parseError) {
        logger.error("Invalid JSON in user settings file", {
          path: this.userSettingsPath,
          error: parseError instanceof Error ? parseError.message : "Parse error"
        });
        return { ...DEFAULT_USER_SETTINGS };
      }

      // Validate with Zod schema
      const validator = getZodConfigValidator();
      const result = validator.validate<ZodUserSettings>(rawSettings, 'user-settings.json');

      if (result.valid && result.data) {
        // Ensure legacy defaults remain populated (baseURL isn't defaulted in schema).
        return {
          apiKey: result.data.apiKey,
          baseURL: result.data.baseURL ?? DEFAULT_USER_SETTINGS.baseURL,
          defaultModel: result.data.defaultModel ?? DEFAULT_USER_SETTINGS.defaultModel,
          models: result.data.models ?? DEFAULT_USER_SETTINGS.models,
          provider: result.data.provider,
          model: result.data.model,
        };
      }

      // Log validation errors but still use the file with defaults
      for (const err of result.errors) {
        logger.warn(`User settings validation: ${err.path}: ${err.message}`);
      }

      // Merge with defaults to ensure all required fields exist
      const merged = { ...DEFAULT_USER_SETTINGS, ...(rawSettings as object) };
      return merged as UserSettings;
    } catch (error) {
      logger.warn(
        "Failed to load user settings",
        { error: error instanceof Error ? error.message : "Unknown error" }
      );
      return { ...DEFAULT_USER_SETTINGS };
    }
  }

  /**
   * Save user settings to ~/.codebuddy/user-settings.json
   */
  public saveUserSettings(settings: Partial<UserSettings>): void {
    try {
      this.ensureDirectoryExists(this.userSettingsPath);

      // Read existing settings directly to avoid recursion
      let existingSettings: UserSettings = { ...DEFAULT_USER_SETTINGS };
      if (fs.existsSync(this.userSettingsPath)) {
        try {
          const content = fs.readFileSync(this.userSettingsPath, "utf-8");
          const parsed = JSON.parse(content);
          existingSettings = { ...DEFAULT_USER_SETTINGS, ...parsed };
        } catch (_error) {
          // If file is corrupted, use defaults
          logger.warn("Corrupted user settings file, using defaults");
        }
      }

      const mergedSettings = { ...existingSettings, ...settings };

      fs.writeFileSync(
        this.userSettingsPath,
        JSON.stringify(mergedSettings, null, 2),
        { mode: 0o600 } // Secure permissions for API key
      );
    } catch (error) {
      logger.error(
        "Failed to save user settings:",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Update a specific user setting
   */
  public updateUserSetting<K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ): void {
    // Validate key
    if (!key || typeof key !== 'string') {
      throw new Error('Setting key is required and must be a non-empty string');
    }
    const validKeys: (keyof UserSettings)[] = ['apiKey', 'baseURL', 'defaultModel', 'models', 'provider', 'model'];
    if (!validKeys.includes(key)) {
      throw new Error(`Invalid setting key '${key}'. Valid keys are: ${validKeys.join(', ')}`);
    }

    // Type-specific validation
    if (key === 'apiKey' && value !== undefined && value !== null) {
      if (typeof value !== 'string') {
        throw new Error('API key must be a string. Got: ' + (typeof value));
      }
    }
    if (key === 'baseURL' && value !== undefined && value !== null) {
      if (typeof value !== 'string') {
        throw new Error('Base URL must be a string. Got: ' + (typeof value));
      }
      if ((value as string).trim().length > 0 && !(value as string).match(/^https?:\/\//i)) {
        throw new Error('Base URL must start with http:// or https://');
      }
    }
    if ((key === 'defaultModel' || key === 'model') && value !== undefined && value !== null) {
      if (typeof value !== 'string') {
        throw new Error('Model name must be a string');
      }
    }
    if (key === 'models' && value !== undefined && value !== null) {
      if (!Array.isArray(value)) {
        throw new Error('Models must be an array of strings');
      }
      for (const model of value as string[]) {
        if (typeof model !== 'string') {
          throw new Error('Each model in the models array must be a string');
        }
      }
    }
    if (key === 'provider' && value !== undefined && value !== null) {
      if (typeof value !== 'string') {
        throw new Error('Provider must be a string. Got: ' + (typeof value));
      }
      // Use the validated provider list from config-validator
      if (!AI_PROVIDERS.includes(value as typeof AI_PROVIDERS[number])) {
        throw new Error(`Invalid provider '${value}'. Valid providers are: ${AI_PROVIDERS.join(', ')}`);
      }
    }

    const settings = { [key]: value } as Partial<UserSettings>;
    this.saveUserSettings(settings);
  }

  /**
   * Get a specific user setting
   */
  public getUserSetting<K extends keyof UserSettings>(key: K): UserSettings[K] {
    const settings = this.loadUserSettings();
    return settings[key];
  }

  /**
   * Load project settings from .codebuddy/settings.json
   * Uses Zod validation for type safety and defaults
   */
  public loadProjectSettings(): ProjectSettings {
    try {
      if (!fs.existsSync(this.projectSettingsPath)) {
        // Create default project settings if file doesn't exist
        this.saveProjectSettings(DEFAULT_PROJECT_SETTINGS);
        return { ...DEFAULT_PROJECT_SETTINGS };
      }

      const content = fs.readFileSync(this.projectSettingsPath, "utf-8");
      let rawSettings: unknown;

      try {
        rawSettings = JSON.parse(content);
      } catch (parseError) {
        logger.error("Invalid JSON in project settings file", {
          path: this.projectSettingsPath,
          error: parseError instanceof Error ? parseError.message : "Parse error"
        });
        return { ...DEFAULT_PROJECT_SETTINGS };
      }

      // Validate with Zod schema
      const validator = getZodConfigValidator();
      const result = validator.validate<ZodSettings>(rawSettings, 'settings.json');

      if (result.valid && result.data) {
        // Zod applies defaults
        return {
          model: result.data.model,
          // Include any additional fields from raw settings not in Zod schema
          ...(rawSettings as object),
        };
      }

      // Log validation errors but still use the file with defaults
      for (const err of result.errors) {
        logger.warn(`Project settings validation: ${err.path}: ${err.message}`);
      }

      // Merge with defaults
      return { ...DEFAULT_PROJECT_SETTINGS, ...(rawSettings as object) };
    } catch (error) {
      logger.warn(
        "Failed to load project settings",
        { error: error instanceof Error ? error.message : "Unknown error" }
      );
      return { ...DEFAULT_PROJECT_SETTINGS };
    }
  }

  /**
   * Save project settings to .codebuddy/settings.json
   */
  public saveProjectSettings(settings: Partial<ProjectSettings>): void {
    try {
      this.ensureDirectoryExists(this.projectSettingsPath);

      // Read existing settings directly to avoid recursion
      let existingSettings: ProjectSettings = { ...DEFAULT_PROJECT_SETTINGS };
      if (fs.existsSync(this.projectSettingsPath)) {
        try {
          const content = fs.readFileSync(this.projectSettingsPath, "utf-8");
          const parsed = JSON.parse(content);
          existingSettings = { ...DEFAULT_PROJECT_SETTINGS, ...parsed };
        } catch (_error) {
          // If file is corrupted, use defaults
          logger.warn("Corrupted project settings file, using defaults");
        }
      }

      const mergedSettings = { ...existingSettings, ...settings };

      fs.writeFileSync(
        this.projectSettingsPath,
        JSON.stringify(mergedSettings, null, 2)
      );
    } catch (error) {
      logger.error(
        "Failed to save project settings:",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Update a specific project setting
   */
  public updateProjectSetting<K extends keyof ProjectSettings>(
    key: K,
    value: ProjectSettings[K]
  ): void {
    const settings = { [key]: value } as Partial<ProjectSettings>;
    this.saveProjectSettings(settings);
  }

  /**
   * Get a specific project setting
   */
  public getProjectSetting<K extends keyof ProjectSettings>(
    key: K
  ): ProjectSettings[K] {
    const settings = this.loadProjectSettings();
    return settings[key];
  }

  /**
   * Get the current model with proper fallback logic:
   * 1. Project-specific model setting
   * 2. User's default model
   * 3. System default
   */
  public getCurrentModel(): string {
    const projectModel = this.getProjectSetting("model");
    if (projectModel) {
      return projectModel;
    }

    const userDefaultModel = this.getUserSetting("defaultModel");
    if (userDefaultModel) {
      return userDefaultModel;
    }

    return DEFAULT_PROJECT_SETTINGS.model || "grok-code-fast-1";
  }

  /**
   * Set the current model for the project
   */
  public setCurrentModel(model: string): void {
    // Validate model
    if (!model || typeof model !== 'string') {
      throw new Error('Model name is required and must be a non-empty string');
    }
    if (model.trim().length === 0) {
      throw new Error('Model name cannot be empty or whitespace only');
    }
    if (model.length > 100) {
      throw new Error('Model name must not exceed 100 characters');
    }
    this.updateProjectSetting("model", model);
  }

  /**
   * Get available models list from user settings
   */
  public getAvailableModels(): string[] {
    const models = this.getUserSetting("models");
    return models || DEFAULT_USER_SETTINGS.models || [];
  }

  /**
   * Get API key from user settings or environment
   * @deprecated Use getResolvedConfig() instead for proper priority handling
   */
  public getApiKey(): string | undefined {
    // First check environment variable
    const envApiKey = process.env.GROK_API_KEY;
    if (envApiKey) {
      return envApiKey;
    }

    // Then check user settings
    return this.getUserSetting("apiKey");
  }

  /**
   * Get base URL from user settings or environment
   * @deprecated Use getResolvedConfig() instead for proper priority handling
   */
  public getBaseURL(): string {
    // First check environment variable
    const envBaseURL = process.env.GROK_BASE_URL;
    if (envBaseURL) {
      return envBaseURL;
    }

    // Then check user settings
    const userBaseURL = this.getUserSetting("baseURL");
    return (
      userBaseURL || DEFAULT_USER_SETTINGS.baseURL || "https://api.x.ai/v1"
    );
  }

  // ============================================================================
  // Connection Profile Methods (Phase 7)
  // ============================================================================

  /**
   * Get or initialize the ConfigResolver
   */
  private getResolver(): ConfigResolver {
    if (!this.configResolver) {
      const settings = this.loadUserSettings();

      // Check if migration is needed
      if (needsMigration(settings) && !settings.connection) {
        logger.info("Migrating settings to new profile format...");
        const migrated = migrateSettings(settings);
        this.saveUserSettings(migrated);
        this.configResolver = getConfigResolver();
        if (migrated.connection) {
          this.configResolver.fromConfig(migrated.connection);
        }
      } else if (settings.connection) {
        // Use existing connection config
        const validatedConfig = validateConnectionConfig(
          mergeWithDefaults(settings.connection)
        );
        this.configResolver = getConfigResolver();
        this.configResolver.fromConfig(validatedConfig);
      } else {
        // No connection config, use defaults
        this.configResolver = getConfigResolver();
      }
    }
    return this.configResolver;
  }

  /**
   * Get resolved configuration with proper priority handling
   *
   * Priority (highest to lowest):
   * 1. CLI arguments
   * 2. Active profile
   * 3. Environment variables (fallback)
   * 4. Built-in defaults
   */
  public getResolvedConfig(cliOverrides?: CLIOverrides): ResolvedConfig {
    return this.getResolver().resolve(cliOverrides);
  }

  /**
   * Get all available connection profiles
   */
  public getProfiles(): ConnectionProfile[] {
    return this.getResolver().getProfiles();
  }

  /**
   * Get enabled connection profiles only
   */
  public getEnabledProfiles(): ConnectionProfile[] {
    return this.getResolver().getEnabledProfiles();
  }

  /**
   * Get the active profile
   */
  public getActiveProfile(): ConnectionProfile | undefined {
    return this.getResolver().getActiveProfile();
  }

  /**
   * Get the active profile ID
   */
  public getActiveProfileId(): string {
    return this.getResolver().getActiveProfileId();
  }

  /**
   * Switch to a different connection profile
   */
  public setActiveProfile(profileId: string): boolean {
    const resolver = this.getResolver();
    const success = resolver.setActiveProfile(profileId);

    if (success) {
      // Persist to user settings
      const settings = this.loadUserSettings();
      if (!settings.connection) {
        settings.connection = resolver.toConfig();
      } else {
        settings.connection.activeProfileId = profileId;
      }
      this.saveUserSettings(settings);
    }

    return success;
  }

  /**
   * Add a new connection profile
   */
  public addProfile(profile: ConnectionProfile): void {
    const resolver = this.getResolver();
    resolver.addProfile(profile);

    // Persist to user settings
    const settings = this.loadUserSettings();
    settings.connection = resolver.toConfig();
    this.saveUserSettings(settings);
  }

  /**
   * Update an existing profile
   */
  public updateProfile(profileId: string, updates: Partial<ConnectionProfile>): boolean {
    const resolver = this.getResolver();
    const success = resolver.updateProfile(profileId, updates);

    if (success) {
      // Persist to user settings
      const settings = this.loadUserSettings();
      settings.connection = resolver.toConfig();
      this.saveUserSettings(settings);
    }

    return success;
  }

  /**
   * Remove a connection profile
   */
  public removeProfile(profileId: string): boolean {
    const resolver = this.getResolver();
    const success = resolver.removeProfile(profileId);

    if (success) {
      // Persist to user settings
      const settings = this.loadUserSettings();
      settings.connection = resolver.toConfig();
      this.saveUserSettings(settings);
    }

    return success;
  }

  /**
   * Auto-detect available local servers
   */
  public async detectLocalServers(): Promise<Array<{ profileId: string; available: boolean; error?: string }>> {
    return this.getResolver().autoDetectLocalServers();
  }

  /**
   * Test connection for the active profile
   */
  public async testConnection(): Promise<{ available: boolean; error?: string; responseTime?: number }> {
    return this.getResolver().testConnection();
  }

  /**
   * Get connection configuration
   */
  public getConnectionConfig(): ConnectionConfig {
    return this.getResolver().toConfig();
  }

  /**
   * Update connection configuration
   */
  public updateConnectionConfig(config: Partial<ConnectionConfig>): void {
    const resolver = this.getResolver();
    const currentConfig = resolver.toConfig();
    const mergedConfig = {
      ...currentConfig,
      ...config,
      profiles: config.profiles || currentConfig.profiles,
    };
    resolver.fromConfig(mergedConfig);

    // Persist to user settings
    const settings = this.loadUserSettings();
    settings.connection = mergedConfig;
    this.saveUserSettings(settings);
  }

  /**
   * Reset connection config to defaults
   */
  public resetConnectionConfig(): void {
    this.configResolver = null; // Force re-initialization
    const settings = this.loadUserSettings();
    delete settings.connection;
    this.saveUserSettings(settings);
  }
}

/**
 * Convenience function to get the singleton instance
 */
export function getSettingsManager(): SettingsManager {
  return SettingsManager.getInstance();
}
