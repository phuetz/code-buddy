/**
 * TOML Configuration System
 *
 * Hierarchical configuration using TOML format (mistral-vibe style).
 * Supports providers, models, tool configs, and user preferences.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Base URL for the API */
  base_url?: string;
  /** Environment variable name for API key */
  api_key_env: string;
  /** Provider type */
  type: 'openai' | 'anthropic' | 'google' | 'xai' | 'custom';
  /** Whether this provider is enabled */
  enabled?: boolean;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Provider to use */
  provider: string;
  /** Actual model ID to send to API */
  model_id?: string;
  /** Price per million input tokens (USD) */
  price_per_m_input: number;
  /** Price per million output tokens (USD) */
  price_per_m_output: number;
  /** Maximum context window */
  max_context_tokens: number;
  /** Description */
  description?: string;
}

/**
 * Tool permission level
 */
export type ToolPermission = 'always' | 'ask' | 'never';

/**
 * Tool configuration
 */
export interface ToolConfig {
  /** Permission level */
  permission: ToolPermission;
  /** Timeout in seconds */
  timeout?: number;
  /** Allowed patterns (regex) */
  allowlist?: string[];
  /** Blocked patterns (regex) */
  denylist?: string[];
  /** Tool-specific settings */
  settings?: Record<string, unknown>;
}

/**
 * Middleware configuration
 */
export interface MiddlewareConfigOptions {
  /** Maximum conversation turns */
  max_turns?: number;
  /** Turn warning threshold (percentage) */
  turn_warning_threshold?: number;
  /** Maximum session cost (USD) */
  max_cost?: number;
  /** Cost warning threshold (percentage) */
  cost_warning_threshold?: number;
  /** Auto-compact token threshold */
  auto_compact_threshold?: number;
  /** Context warning percentage */
  context_warning_percentage?: number;
}

/**
 * UI/UX preferences
 */
export interface UIConfig {
  /** Enable vim keybindings */
  vim_keybindings?: boolean;
  /** Theme name */
  theme?: string;
  /** Show token count */
  show_tokens?: boolean;
  /** Show cost estimate */
  show_cost?: boolean;
  /** Enable streaming */
  streaming?: boolean;
  /** Enable sound effects */
  sound_effects?: boolean;
}

/**
 * Agent behavior configuration
 */
export interface AgentBehaviorConfig {
  /** Enable YOLO mode */
  yolo_mode?: boolean;
  /** Enable parallel tool execution */
  parallel_tools?: boolean;
  /** Enable RAG-based tool selection */
  rag_tool_selection?: boolean;
  /** Enable self-healing */
  self_healing?: boolean;
  /** Default system prompt ID */
  default_prompt?: string;
}

/**
 * External integrations configuration
 */
export interface IntegrationsConfig {
  /** Enable RTK output compression for bash results */
  rtk_enabled?: boolean;
  /** Minimum output length (chars) before RTK compression kicks in */
  rtk_min_output_length?: number;
  /** Enable ICM MCP server for persistent memory */
  icm_enabled?: boolean;
}

/**
 * Named configuration profile — a subset of config keys applied on top of the base config.
 * Activate with: `buddy --profile <name>`
 *
 * Example in .codebuddy/config.toml:
 *   [profiles.deep-review]
 *   active_model = "claude-opus"
 *   [profiles.deep-review.agent]
 *   yolo_mode = false
 *   [profiles.deep-review.middleware]
 *   max_turns = 200
 */
export type ProfileConfig = Partial<Omit<CodeBuddyConfig, 'profiles'>>;

/**
 * Full configuration structure
 */
export interface CodeBuddyConfig {
  /** Active model name (key from models section) */
  active_model: string;
  /** Provider configurations */
  providers: Record<string, ProviderConfig>;
  /** Model configurations */
  models: Record<string, ModelConfig>;
  /** Tool configurations */
  tool_config: Record<string, ToolConfig>;
  /** Middleware settings */
  middleware: MiddlewareConfigOptions;
  /** UI preferences */
  ui: UIConfig;
  /** Agent behavior */
  agent: AgentBehaviorConfig;
  /** External integrations */
  integrations: IntegrationsConfig;
  /** Named configuration profiles (activated via --profile <name>) */
  profiles?: Record<string, ProfileConfig>;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: CodeBuddyConfig = {
  active_model: 'grok-code-fast',

  providers: {
    xai: {
      base_url: 'https://api.x.ai/v1',
      api_key_env: 'GROK_API_KEY',
      type: 'xai',
      enabled: true,
    },
    anthropic: {
      base_url: 'https://api.anthropic.com/v1',
      api_key_env: 'ANTHROPIC_API_KEY',
      type: 'anthropic',
      enabled: true,
    },
    openai: {
      base_url: 'https://api.openai.com/v1',
      api_key_env: 'OPENAI_API_KEY',
      type: 'openai',
      enabled: true,
    },
    google: {
      base_url: 'https://generativelanguage.googleapis.com/v1beta',
      api_key_env: 'GOOGLE_API_KEY',
      type: 'google',
      enabled: true,
    },
  },

  models: {
    'grok-4-fast': {
      provider: 'xai',
      model_id: 'grok-4-1-fast',
      price_per_m_input: 2.0,
      price_per_m_output: 10.0,
      max_context_tokens: 2000000,
      description: 'Grok 4.1 Fast (2M context)',
    },
    'grok-4': {
      provider: 'xai',
      model_id: 'grok-4-latest',
      price_per_m_input: 6.0,
      price_per_m_output: 18.0,
      max_context_tokens: 256000,
      description: 'Grok 4 (256K context)',
    },
    'grok-code-fast': {
      provider: 'xai',
      model_id: 'grok-code-fast-1',
      price_per_m_input: 0.15,
      price_per_m_output: 0.60,
      max_context_tokens: 256000,
      description: 'Fast Grok model optimized for code',
    },
    'grok-3': {
      provider: 'xai',
      model_id: 'grok-3-latest',
      price_per_m_input: 3.0,
      price_per_m_output: 15.0,
      max_context_tokens: 131072,
      description: 'Full Grok 3 model',
    },
    'claude-opus': {
      provider: 'anthropic',
      model_id: 'claude-opus-4-6',
      price_per_m_input: 5.0,
      price_per_m_output: 25.0,
      max_context_tokens: 200000,
      description: 'Claude Opus 4.6 (128K output)',
    },
    'claude-sonnet': {
      provider: 'anthropic',
      model_id: 'claude-sonnet-4-5-20250929',
      price_per_m_input: 3.0,
      price_per_m_output: 15.0,
      max_context_tokens: 200000,
      description: 'Claude Sonnet 4.5 (64K output)',
    },
    'claude-haiku': {
      provider: 'anthropic',
      model_id: 'claude-haiku-4-5-20251001',
      price_per_m_input: 1.0,
      price_per_m_output: 5.0,
      max_context_tokens: 200000,
      description: 'Claude Haiku 4.5 (64K output, fastest)',
    },
    'gpt-5': {
      provider: 'openai',
      model_id: 'gpt-5',
      price_per_m_input: 10.0,
      price_per_m_output: 30.0,
      max_context_tokens: 400000,
      description: 'GPT-5 (400K context, 128K output)',
    },
    'gpt-4o': {
      provider: 'openai',
      model_id: 'gpt-4o',
      price_per_m_input: 2.5,
      price_per_m_output: 10.0,
      max_context_tokens: 128000,
      description: 'GPT-4o',
    },
    'gemini-2.5': {
      provider: 'google',
      model_id: 'gemini-2.5-flash',
      price_per_m_input: 0.15,
      price_per_m_output: 0.60,
      max_context_tokens: 1000000,
      description: 'Gemini 2.5 Flash (1M context, 65K output)',
    },
    'gemini-2': {
      provider: 'google',
      model_id: 'gemini-2.0-flash',
      price_per_m_input: 0.10,
      price_per_m_output: 0.40,
      max_context_tokens: 1000000,
      description: 'Gemini 2.0 Flash (1M context)',
    },
  },

  tool_config: {
    bash: {
      permission: 'ask',
      timeout: 120,
      allowlist: [
        'git .*',
        'npm .*',
        'npx .*',
        'yarn .*',
        'pnpm .*',
        'cargo .*',
        'python .*',
        'node .*',
        'ls.*',
        'cat.*',
        'head.*',
        'tail.*',
        'grep.*',
        'find.*',
        'which.*',
        'pwd',
        'echo.*',
      ],
      denylist: [
        'rm -rf /',
        'rm -rf ~',
        'rm -rf \\*',
        'sudo .*',
        'chmod 777.*',
        'curl.*\\| ?sh',
        'wget.*\\| ?sh',
        ':(){ :\\|:& };:',
      ],
    },
    str_replace_editor: {
      permission: 'ask',
      timeout: 30,
    },
    create_file: {
      permission: 'ask',
      timeout: 10,
    },
    view_file: {
      permission: 'always',
      timeout: 10,
    },
    search: {
      permission: 'always',
      timeout: 30,
    },
    web_search: {
      permission: 'always',
      timeout: 30,
    },
    web_fetch: {
      permission: 'ask',
      timeout: 60,
    },
  },

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
};

// ============================================================================
// TOML Parser/Serializer (Simple Implementation)
// ============================================================================

/**
 * Simple TOML parser for our config format
 * Note: This is a minimal implementation. For full TOML support, consider using a library.
 */
export function parseTOML(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  let currentSection = '';
  let currentSubSection = '';

  for (let line of lines) {
    line = line.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Section header [section] or [section.subsection]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const parts = sectionMatch[1].split('.');
      currentSection = parts[0];
      currentSubSection = parts.slice(1).join('.');

      // Initialize section if needed
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      if (currentSubSection) {
        const sectionObj = result[currentSection] as Record<string, unknown>;
        if (!sectionObj[currentSubSection]) {
          sectionObj[currentSubSection] = {};
        }
      }
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: unknown = kvMatch[2].trim();

      // Parse value type
      if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        value = parseInt(value, 10);
      } else if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) {
        value = parseFloat(value);
      } else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        // Parse array
        const arrayContent = value.slice(1, -1);
        value = arrayContent.split(',').map(item => {
          item = item.trim();
          if (item.startsWith('"') && item.endsWith('"')) {
            return item.slice(1, -1);
          }
          return item;
        }).filter(item => item !== '');
      }

      // Store value
      if (currentSubSection) {
        const sectionObj = result[currentSection] as Record<string, unknown>;
        const subSectionObj = sectionObj[currentSubSection] as Record<string, unknown>;
        subSectionObj[key] = value;
      } else if (currentSection) {
        (result[currentSection] as Record<string, unknown>)[key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Serialize config to TOML format
 */
export function serializeTOML(config: CodeBuddyConfig): string {
  const lines: string[] = [
    '# Code Buddy Configuration',
    '# See https://github.com/phuetz/code-buddy for documentation',
    '',
  ];

  // Root level
  lines.push(`active_model = "${config.active_model}"`);
  lines.push('');

  // Providers
  for (const [name, provider] of Object.entries(config.providers)) {
    lines.push(`[providers.${name}]`);
    if (provider.base_url) lines.push(`base_url = "${provider.base_url}"`);
    lines.push(`api_key_env = "${provider.api_key_env}"`);
    lines.push(`type = "${provider.type}"`);
    if (provider.enabled !== undefined) lines.push(`enabled = ${provider.enabled}`);
    lines.push('');
  }

  // Models
  for (const [name, model] of Object.entries(config.models)) {
    lines.push(`[models.${name}]`);
    lines.push(`provider = "${model.provider}"`);
    if (model.model_id) lines.push(`model_id = "${model.model_id}"`);
    lines.push(`price_per_m_input = ${model.price_per_m_input}`);
    lines.push(`price_per_m_output = ${model.price_per_m_output}`);
    lines.push(`max_context_tokens = ${model.max_context_tokens}`);
    if (model.description) lines.push(`description = "${model.description}"`);
    lines.push('');
  }

  // Tool config
  for (const [name, tool] of Object.entries(config.tool_config)) {
    lines.push(`[tool_config.${name}]`);
    lines.push(`permission = "${tool.permission}"`);
    if (tool.timeout) lines.push(`timeout = ${tool.timeout}`);
    if (tool.allowlist?.length) {
      lines.push(`allowlist = [${tool.allowlist.map(p => `"${p}"`).join(', ')}]`);
    }
    if (tool.denylist?.length) {
      lines.push(`denylist = [${tool.denylist.map(p => `"${p}"`).join(', ')}]`);
    }
    lines.push('');
  }

  // Middleware
  lines.push('[middleware]');
  if (config.middleware.max_turns) lines.push(`max_turns = ${config.middleware.max_turns}`);
  if (config.middleware.turn_warning_threshold) lines.push(`turn_warning_threshold = ${config.middleware.turn_warning_threshold}`);
  if (config.middleware.max_cost) lines.push(`max_cost = ${config.middleware.max_cost}`);
  if (config.middleware.cost_warning_threshold) lines.push(`cost_warning_threshold = ${config.middleware.cost_warning_threshold}`);
  if (config.middleware.auto_compact_threshold) lines.push(`auto_compact_threshold = ${config.middleware.auto_compact_threshold}`);
  if (config.middleware.context_warning_percentage) lines.push(`context_warning_percentage = ${config.middleware.context_warning_percentage}`);
  lines.push('');

  // UI
  lines.push('[ui]');
  if (config.ui.vim_keybindings !== undefined) lines.push(`vim_keybindings = ${config.ui.vim_keybindings}`);
  if (config.ui.theme) lines.push(`theme = "${config.ui.theme}"`);
  if (config.ui.show_tokens !== undefined) lines.push(`show_tokens = ${config.ui.show_tokens}`);
  if (config.ui.show_cost !== undefined) lines.push(`show_cost = ${config.ui.show_cost}`);
  if (config.ui.streaming !== undefined) lines.push(`streaming = ${config.ui.streaming}`);
  if (config.ui.sound_effects !== undefined) lines.push(`sound_effects = ${config.ui.sound_effects}`);
  lines.push('');

  // Agent
  lines.push('[agent]');
  if (config.agent.yolo_mode !== undefined) lines.push(`yolo_mode = ${config.agent.yolo_mode}`);
  if (config.agent.parallel_tools !== undefined) lines.push(`parallel_tools = ${config.agent.parallel_tools}`);
  if (config.agent.rag_tool_selection !== undefined) lines.push(`rag_tool_selection = ${config.agent.rag_tool_selection}`);
  if (config.agent.self_healing !== undefined) lines.push(`self_healing = ${config.agent.self_healing}`);
  if (config.agent.default_prompt) lines.push(`default_prompt = "${config.agent.default_prompt}"`);
  lines.push('');

  // Integrations
  if (config.integrations) {
    lines.push('[integrations]');
    if (config.integrations.rtk_enabled !== undefined) lines.push(`rtk_enabled = ${config.integrations.rtk_enabled}`);
    if (config.integrations.rtk_min_output_length !== undefined) lines.push(`rtk_min_output_length = ${config.integrations.rtk_min_output_length}`);
    if (config.integrations.icm_enabled !== undefined) lines.push(`icm_enabled = ${config.integrations.icm_enabled}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Configuration Manager
// ============================================================================

const CONFIG_DIR = join(homedir(), '.codebuddy');
const CONFIG_FILE = join(CONFIG_DIR, 'config.toml');
const PROJECT_CONFIG_FILE = '.codebuddy/config.toml';

/**
 * Configuration manager singleton
 */
class ConfigManager {
  private config: CodeBuddyConfig;
  private loaded = false;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Load configuration from files
   * Priority: project > user > defaults
   */
  load(): CodeBuddyConfig {
    if (this.loaded) return this.config;

    // Start with defaults
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

    // Load user config
    if (existsSync(CONFIG_FILE)) {
      try {
        const content = readFileSync(CONFIG_FILE, 'utf-8');
        const userConfig = parseTOML(content) as Partial<CodeBuddyConfig>;
        this.mergeConfig(userConfig);
      } catch (error) {
        logger.warn(`Warning: Failed to parse user config: ${error}`, { source: 'ConfigManager' });
      }
    }

    // Load project config (overrides user config)
    if (existsSync(PROJECT_CONFIG_FILE)) {
      try {
        const content = readFileSync(PROJECT_CONFIG_FILE, 'utf-8');
        const projectConfig = parseTOML(content) as Partial<CodeBuddyConfig>;
        this.mergeConfig(projectConfig);
      } catch (error) {
        logger.warn(`Warning: Failed to parse project config: ${error}`, { source: 'ConfigManager' });
      }
    }

    this.loaded = true;
    return this.config;
  }

  /**
   * Deep merge config
   */
  private mergeConfig(partial: Partial<CodeBuddyConfig>): void {
    if (partial.active_model) {
      this.config.active_model = partial.active_model;
    }
    if (partial.providers) {
      this.config.providers = { ...this.config.providers, ...partial.providers };
    }
    if (partial.models) {
      this.config.models = { ...this.config.models, ...partial.models };
    }
    if (partial.tool_config) {
      for (const [name, toolConfig] of Object.entries(partial.tool_config)) {
        this.config.tool_config[name] = {
          ...this.config.tool_config[name],
          ...toolConfig,
        };
      }
    }
    if (partial.middleware) {
      this.config.middleware = { ...this.config.middleware, ...partial.middleware };
    }
    if (partial.ui) {
      this.config.ui = { ...this.config.ui, ...partial.ui };
    }
    if (partial.agent) {
      this.config.agent = { ...this.config.agent, ...partial.agent };
    }
    if (partial.integrations) {
      this.config.integrations = { ...this.config.integrations, ...partial.integrations };
    }
  }

  /**
   * Get current config
   */
  getConfig(): Readonly<CodeBuddyConfig> {
    if (!this.loaded) this.load();
    return this.config;
  }

  /**
   * Get active model config
   */
  getActiveModel(): ModelConfig & { name: string } {
    const config = this.getConfig();
    const model = config.models[config.active_model];
    if (!model) {
      throw new Error(`Model "${config.active_model}" not found in config`);
    }
    return { ...model, name: config.active_model };
  }

  /**
   * Get provider config for a model
   */
  getProviderForModel(modelName: string): ProviderConfig & { name: string } {
    const config = this.getConfig();
    const model = config.models[modelName];
    if (!model) {
      throw new Error(`Model "${modelName}" not found in config`);
    }
    const provider = config.providers[model.provider];
    if (!provider) {
      throw new Error(`Provider "${model.provider}" not found in config`);
    }
    return { ...provider, name: model.provider };
  }

  /**
   * Get tool config
   */
  getToolConfig(toolName: string): ToolConfig | undefined {
    return this.getConfig().tool_config[toolName];
  }

  /**
   * Check if tool command is allowed
   */
  isToolCommandAllowed(toolName: string, command: string): { allowed: boolean; reason?: string } {
    const toolConfig = this.getToolConfig(toolName);
    if (!toolConfig) return { allowed: true };

    // Check denylist first
    if (toolConfig.denylist?.length) {
      for (const pattern of toolConfig.denylist) {
        try {
          const regex = new RegExp(pattern);
          if (regex.test(command)) {
            return { allowed: false, reason: `Blocked by pattern: ${pattern}` };
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }

    // Check allowlist (if defined, command must match)
    if (toolConfig.allowlist?.length) {
      for (const pattern of toolConfig.allowlist) {
        try {
          const regex = new RegExp(`^${pattern}$`);
          if (regex.test(command)) {
            return { allowed: true };
          }
        } catch {
          // Invalid regex, skip
        }
      }
      return { allowed: false, reason: 'Command not in allowlist' };
    }

    return { allowed: true };
  }

  /**
   * Save user config
   */
  saveUserConfig(): void {
    const dir = dirname(CONFIG_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, serializeTOML(this.config));
  }

  /**
   * Set active model
   */
  setActiveModel(modelName: string): void {
    if (!this.config.models[modelName]) {
      throw new Error(`Model "${modelName}" not found`);
    }
    this.config.active_model = modelName;
  }

  /**
   * Apply a named profile on top of the current config.
   * Profile keys are deep-merged the same way as file configs.
   * Throws if the profile name is not defined.
   */
  applyProfile(profileName: string): void {
    const cfg = this.getConfig();
    const profile = cfg.profiles?.[profileName];
    if (!profile) {
      throw new Error(
        `Profile "${profileName}" not found. ` +
        `Available profiles: ${Object.keys(cfg.profiles ?? {}).join(', ') || '(none defined)'}`
      );
    }
    this.mergeConfig(profile);
    logger.info(`Applied config profile: ${profileName}`, { source: 'ConfigManager' });
  }

  /**
   * Reload configuration
   */
  reload(): CodeBuddyConfig {
    this.loaded = false;
    return this.load();
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return CONFIG_FILE;
  }

  /**
   * Check if config file exists
   */
  configExists(): boolean {
    return existsSync(CONFIG_FILE);
  }

  /**
   * Initialize config file with defaults
   */
  initConfig(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    if (!existsSync(CONFIG_FILE)) {
      writeFileSync(CONFIG_FILE, serializeTOML(DEFAULT_CONFIG));
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let configManagerInstance: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager();
  }
  return configManagerInstance;
}

// Re-export types
export type { ConfigManager };
