/**
 * Configuration Schema Definitions
 *
 * Contains all Zod schema definitions, JSON schema definitions, type constants,
 * and inferred TypeScript types for CodeBuddy configuration files.
 */

import { z, ZodSchema } from 'zod';

// ============================================================================
// JSON Schema Types
// ============================================================================

export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  description?: string;
  additionalProperties?: boolean | JSONSchema;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  $ref?: string;
  // Extended schema properties
  examples?: unknown[];
  deprecated?: boolean;
  deprecationMessage?: string;
  sensitive?: boolean; // Marks sensitive fields like API keys
  envVar?: string; // Associated environment variable
  since?: string; // Version when option was added
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  /** Validated and transformed data with defaults applied */
  data?: unknown;
}

// ============================================================================
// Type Constants
// ============================================================================

/**
 * Valid AI provider options
 */
export const AI_PROVIDERS = [
  'grok',
  'xai',
  'claude',
  'anthropic',
  'openai',
  'chatgpt',
  'gemini',
  'google',
  'ollama',
  'ollama-cloud',
  'lmstudio',
  'lm-studio',
  'local',
  'mistral',
  'groq',
  'together',
  'fireworks',
  'openrouter',
  'novita',
  'novita-ai',
  'zai',
  'glm',
  'kimi-coding',
  'kimi',
  'moonshot',
  'kimi-coding-cn',
  'kimi-cn',
  'moonshot-cn',
  'arcee',
  'arcee-ai',
  'gmi',
  'gmi-cloud',
  'gmicloud',
  'minimax',
  'minimax-cn',
  'alibaba',
  'qwen',
  'dashscope',
  'alibaba-coding-plan',
  'alibaba-coding',
  'kilocode',
  'kilo-code',
  'xiaomi',
  'mimo',
  'tencent-tokenhub',
  'tencent',
  'tokenhub',
  'opencode-zen',
  'opencode',
  'opencode-go',
  'deepseek',
  'huggingface',
  'hf',
  'nvidia',
  'nvidia-nim',
  'stepfun',
  'vllm',
  'custom',
  // OmniRoute gateway + 24 free-tier providers imported from its registry (2026-08-22)
  'omniroute',
  'ai21',
  'ant-ling',
  'cerebras',
  'cohere',
  'deepinfra',
  'featherless-ai',
  'friendliai',
  'hyperbolic',
  'inception',
  'inference-net',
  'internlm',
  'liquid',
  'longcat',
  'modelscope',
  'nscale',
  'openadapter',
  'pioneer',
  'reka',
  'sambanova',
  'sarvam',
  'scaleway',
  'tokenrouter',
  'typhoon',
  'zenmux',
  // runtime/plugin ids that were missing from the settings enum (pre-existing gap, fixed 2026-08-22)
  'agy-cli',
  'lemonade',
  'azure',
  'bedrock',
  'copilot',
] as const;
export type AIProvider = typeof AI_PROVIDERS[number];

/**
 * Valid autonomy levels
 */
export const AUTONOMY_LEVELS = ['suggest', 'confirm', 'auto', 'full', 'yolo'] as const;
export type AutonomyLevel = typeof AUTONOMY_LEVELS[number];

/**
 * Valid agent modes
 */
export const AGENT_MODES = ['plan', 'code', 'ask', 'architect'] as const;
export type AgentMode = typeof AGENT_MODES[number];

/**
 * Valid hook events
 */
export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Notification'] as const;
export type HookEvent = typeof HOOK_EVENTS[number];

/**
 * Valid theme options
 */
export const THEMES = ['dark', 'light', 'auto', 'default', 'neon', 'pastel', 'matrix', 'ocean', 'sunset', 'minimal', 'high-contrast'] as const;
export type Theme = typeof THEMES[number];

// ============================================================================
// Zod Schema Definitions
// ============================================================================

// ----------------------------------------------------------------------------
// Settings Schema (project-level .codebuddy/settings.json)
// ----------------------------------------------------------------------------

export const SettingsSchema = z.object({
  // `model` is intentionally optional with NO default. The auto-detect
  // chain in src/index.ts (`loadModel()` → `getDetectedProvider()`)
  // resolves the right model based on the active provider (ChatGPT
  // OAuth → gpt-5.5, Ollama → qwen2.5-coder:7b, Grok → grok-3-fast,
  // etc.). A hardcoded default here used to write `'grok-3-latest'`
  // into every project's settings.json on first load, which then
  // hijacked the auto-detect on later runs — the ChatGPT provider
  // would route correctly but the request body still carried
  // `grok-3-latest` in the `model` field, getting rejected by the
  // Codex backend.
  model: z.string()
    .min(1, 'Model name cannot be empty')
    .max(100, 'Model name too long')
    .optional()
    .describe('AI model to use (auto-detected from provider when unset)'),

  maxRounds: z.number()
    .int('Must be an integer')
    .min(1, 'Minimum 1 round')
    .max(500, 'Maximum 500 rounds')
    .default(30)
    .describe('Maximum tool execution rounds per request'),

  autonomyLevel: z.enum(AUTONOMY_LEVELS)
    .default('confirm')
    .describe('Level of autonomous operation'),

  enableRAG: z.boolean()
    .default(true)
    .describe('Enable RAG-based tool selection'),

  parallelTools: z.boolean()
    .default(true)
    .describe('Enable parallel tool execution'),

  temperature: z.number()
    .min(0, 'Temperature cannot be negative')
    .max(2, 'Temperature cannot exceed 2')
    .default(0.7)
    .describe('Model temperature for response variation'),

  maxTokens: z.number()
    .int('Must be an integer')
    .min(100, 'Minimum 100 tokens')
    .max(200000, 'Maximum 200000 tokens')
    .optional()
    .describe('Maximum tokens per request'),

  agentMode: z.enum(AGENT_MODES)
    .optional()
    .describe('Default agent mode'),

  contextWindow: z.number()
    .int()
    .min(1000)
    .max(200000)
    .optional()
    .describe('Context window size in tokens'),

  enableCheckpoints: z.boolean()
    .default(true)
    .describe('Enable automatic checkpoints for file changes'),

  enableTelemetry: z.boolean()
    .default(false)
    .describe('Enable anonymous usage telemetry'),

  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high'])
    .optional()
    .describe('Gemini 3.x thinking/reasoning depth level'),

  goals: z.object({
    maxTurns: z.number()
      .int('Must be an integer')
      .min(1, 'Minimum 1 turn')
      .max(1000, 'Maximum 1000 turns')
      .optional()
      .describe('Maximum continuation turns for persistent goals'),
    judgeModel: z.string()
      .trim()
      .min(1, 'Judge model cannot be empty')
      .max(100, 'Judge model name too long')
      .optional()
      .describe('Optional model override used to judge goal completion'),
    plannerModel: z.string()
      .trim()
      .min(1, 'Planner model cannot be empty')
      .max(100, 'Planner model name too long')
      .optional()
      .describe('Optional model override used to decompose complex goals'),
    judgeMaxTokens: z.number()
      .int('Must be an integer')
      .min(1, 'Minimum 1 token')
      .max(200000, 'Maximum 200000 tokens')
      .optional()
      .describe('Maximum output tokens for the goal judge'),
    judgeTimeoutMs: z.number()
      .int('Must be an integer')
      .min(1000, 'Minimum 1000ms')
      .max(600000, 'Maximum 600000ms')
      .optional()
      .describe('Timeout for goal judging requests'),
  }).strict().optional()
    .describe('Persistent goal continuation and judging settings'),

  turboquant: z.object({
    vllmEndpoint: z.string().url().optional()
      .describe('vLLM endpoint URL, e.g. http://192.168.1.50:8000'),
    ollamaEndpoint: z.string().url().optional()
      .describe('Ollama endpoint URL, e.g. http://localhost:11434'),
    turboquant: z.object({
      enabled: z.boolean().default(true),
      nbits: z.union([z.literal(2), z.literal(4)]).default(4)
        .describe('KV cache quantization bits: 2 = higher compression, 4 = balanced'),
      residualLength: z.number().int().min(0).default(128)
        .describe('Tokens kept at full precision'),
      mode: z.enum(['mse', 'prod']).default('mse'),
      rotation: z.enum(['dense_gaussian', 'walsh_hadamard']).default('walsh_hadamard'),
      skipLayers: z.union([z.array(z.number().int()), z.literal('auto')]).default('auto'),
    }).optional(),
    modelRouting: z.object({
      lightweight: z.string().default('llama3.2')
        .describe('Ollama model for short/simple requests'),
      heavy: z.string().default('qwen2.5-72b-instruct')
        .describe('vLLM model for long/complex requests'),
      complexityThreshold: z.union([z.literal('auto'), z.number().int().positive()])
        .default('auto')
        .describe('Token count above which requests go to vLLM'),
    }).optional(),
  }).optional()
    .describe('TurboQuant local inference routing (Ollama + vLLM with KV cache quantization)'),
}).strict();

export type Settings = z.infer<typeof SettingsSchema>;

// ----------------------------------------------------------------------------
// User Settings Schema (global ~/.codebuddy/user-settings.json)
// ----------------------------------------------------------------------------

export const UserSettingsSchema = z.object({
  apiKey: z.string()
    .min(1, 'API key cannot be empty')
    .optional()
    .describe('API key for the AI provider'),

  baseURL: z.string()
    .url('Must be a valid URL')
    .regex(/^https?:\/\//, 'URL must start with http:// or https://')
    .optional()
    .describe('Custom API base URL'),

  defaultModel: z.string()
    .min(1)
    .max(100)
    .default('grok-code-fast-1')
    .describe('Default model for all sessions'),

  models: z.array(z.string().min(1))
    .default(['grok-code-fast-1', 'grok-4-latest', 'grok-3-latest', 'grok-3-fast', 'grok-3-mini-fast'])
    .describe('List of available models'),

  provider: z.enum(AI_PROVIDERS)
    .default('grok')
    .describe('Active AI provider'),

  model: z.string()
    .optional()
    .describe('Current model override'),

  theme: z.enum(THEMES)
    .default('auto')
    .describe('UI color theme'),

  editor: z.string()
    .optional()
    .describe('Preferred text editor command'),

  shell: z.string()
    .optional()
    .describe('Preferred shell'),

  language: z.string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Invalid language code (e.g., en, en-US)')
    .default('en')
    .describe('Preferred language'),
}).strict();

export type UserSettings = z.infer<typeof UserSettingsSchema>;

// ----------------------------------------------------------------------------
// Hooks Schema (.codebuddy/hooks.json)
// ----------------------------------------------------------------------------

export const HookSchema = z.object({
  event: z.enum(HOOK_EVENTS)
    .describe('Hook trigger event'),

  pattern: z.string()
    .optional()
    .describe('Regex pattern to match tool names'),

  command: z.string()
    .min(1, 'Command cannot be empty')
    .describe('Shell command to execute'),

  description: z.string()
    .optional()
    .describe('Human-readable description'),

  timeout: z.number()
    .int()
    .min(1000, 'Minimum 1 second timeout')
    .max(300000, 'Maximum 5 minute timeout')
    .default(30000)
    .describe('Command timeout in milliseconds'),

  continueOnError: z.boolean()
    .default(false)
    .describe('Continue if hook fails'),

  enabled: z.boolean()
    .default(true)
    .describe('Whether hook is active'),
});

export const HooksConfigSchema = z.object({
  hooks: z.array(HookSchema)
    .default([])
    .describe('List of lifecycle hooks'),
}).strict();

export type HookConfig = z.infer<typeof HookSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;

// ----------------------------------------------------------------------------
// MCP Server Schema (.codebuddy/mcp.json)
// ----------------------------------------------------------------------------

export const MCPServerSchema = z.object({
  command: z.string()
    .min(1, 'Command is required')
    .describe('Command to start the MCP server'),

  args: z.array(z.string())
    .default([])
    .describe('Command arguments'),

  env: z.record(z.string())
    .default({})
    .describe('Environment variables'),

  enabled: z.boolean()
    .default(true)
    .describe('Whether server is enabled'),

  alwaysAllow: z.array(z.string())
    .default([])
    .describe('Tools always allowed without confirmation'),

  autoStart: z.boolean()
    .default(true)
    .describe('Auto-start with session'),

  timeout: z.number()
    .int()
    .min(1000)
    .max(60000)
    .default(10000)
    .describe('Connection timeout in ms'),
});

export const MCPConfigSchema = z.object({
  servers: z.record(MCPServerSchema)
    .default({})
    .describe('MCP server configurations'),

  defaultTimeout: z.number()
    .int()
    .min(1000)
    .max(60000)
    .default(10000)
    .describe('Default server timeout'),
}).strict();

export type MCPServerConfig = z.infer<typeof MCPServerSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;

// ----------------------------------------------------------------------------
// YOLO Mode Schema (.codebuddy/yolo.json)
// ----------------------------------------------------------------------------

export const YoloConfigSchema = z.object({
  enabled: z.boolean()
    .default(false)
    .describe('Enable YOLO mode'),

  allowList: z.array(z.string())
    .default([])
    .describe('Commands that can be auto-executed'),

  denyList: z.array(z.string())
    .default(['rm -rf', 'sudo rm', 'dd', 'mkfs', ':(){', 'chmod -R 777'])
    .describe('Commands that are always blocked'),

  maxAutoEdits: z.number()
    .int()
    .min(0)
    .max(100)
    .default(5)
    .describe('Maximum auto file edits per session'),

  maxAutoCommands: z.number()
    .int()
    .min(0)
    .max(100)
    .default(10)
    .describe('Maximum auto shell commands per session'),

  safeMode: z.boolean()
    .default(true)
    .describe('Extra safety checks in YOLO mode'),

  allowFileCreation: z.boolean()
    .default(true)
    .describe('Allow auto file creation'),

  allowFileDeletion: z.boolean()
    .default(false)
    .describe('Allow auto file deletion'),

  allowGitOperations: z.boolean()
    .default(false)
    .describe('Allow auto git commits/pushes'),

  maxCostPerSession: z.number()
    .min(0)
    .max(100)
    .default(10)
    .describe('Maximum cost per session in dollars'),
}).strict();

export type YoloConfig = z.infer<typeof YoloConfigSchema>;

// ----------------------------------------------------------------------------
// Environment Variables Schema
// ----------------------------------------------------------------------------

export const EnvVarsSchema = z.object({
  GROK_API_KEY: z.string()
    .min(1, 'API key cannot be empty')
    .optional()
    .describe('Grok API key from x.ai'),

  MORPH_API_KEY: z.string()
    .optional()
    .describe('Morph API key for fast file editing'),

  GROK_BASE_URL: z.string()
    .url()
    .optional()
    .describe('Custom API endpoint'),

  GROK_MODEL: z.string()
    .optional()
    .describe('Default model to use'),

  YOLO_MODE: z.enum(['true', 'false', '1', '0'])
    .transform(v => v === 'true' || v === '1')
    .optional()
    .describe('Enable YOLO mode'),

  MAX_COST: z.string()
    .transform(v => parseFloat(v))
    .pipe(z.number().min(0).max(1000))
    .optional()
    .describe('Session cost limit in dollars'),

  DEBUG: z.enum(['true', 'false', '1', '0'])
    .transform(v => v === 'true' || v === '1')
    .optional()
    .describe('Enable debug logging'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error'])
    .optional()
    .describe('Log verbosity level'),

  CODEBUDDY_CONFIG_DIR: z.string()
    .optional()
    .describe('Custom config directory path'),

  NO_COLOR: z.string()
    .optional()
    .describe('Disable colored output'),

  FORCE_COLOR: z.string()
    .optional()
    .describe('Force colored output'),
});

export type EnvVars = z.infer<typeof EnvVarsSchema>;

// ----------------------------------------------------------------------------
// Schema Registry
// ----------------------------------------------------------------------------

/**
 * Map of schema names to their Zod schemas
 */
export const ZOD_SCHEMAS: Record<string, ZodSchema> = {
  'settings.json': SettingsSchema,
  'user-settings.json': UserSettingsSchema,
  'hooks.json': HooksConfigSchema,
  'mcp.json': MCPConfigSchema,
  'yolo.json': YoloConfigSchema,
  'env': EnvVarsSchema,
};

// ============================================================================
// Legacy JSON Schema Definitions (for backwards compatibility)
// ============================================================================

// Schema definitions for all config files
export const SCHEMAS: Record<string, JSONSchema> = {
  'settings.json': {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Default AI model to use',
        default: 'grok-3-latest',
      },
      maxRounds: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        default: 30,
        description: 'Maximum tool execution rounds',
      },
      autonomyLevel: {
        type: 'string',
        enum: ['suggest', 'confirm', 'auto', 'full'],
        default: 'confirm',
        description: 'Level of autonomous operation',
      },
      enableRAG: {
        type: 'boolean',
        default: true,
        description: 'Enable RAG-based tool selection',
      },
      parallelTools: {
        type: 'boolean',
        default: true,
        description: 'Enable parallel tool execution',
      },
      temperature: {
        type: 'number',
        minimum: 0,
        maximum: 2,
        default: 0.7,
        description: 'Model temperature',
      },
      maxTokens: {
        type: 'number',
        minimum: 100,
        maximum: 200000,
        description: 'Maximum tokens per request',
      },
      goals: {
        type: 'object',
        description: 'Persistent goal continuation and judging settings',
        properties: {
          maxTurns: {
            type: 'number',
            minimum: 1,
            maximum: 1000,
            description: 'Maximum continuation turns for persistent goals',
          },
          judgeModel: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Optional model override used to judge goal completion',
          },
          plannerModel: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Optional model override used to decompose complex goals',
          },
          judgeMaxTokens: {
            type: 'number',
            minimum: 1,
            maximum: 200000,
            description: 'Maximum output tokens for the goal judge',
          },
          judgeTimeoutMs: {
            type: 'number',
            minimum: 1000,
            maximum: 600000,
            description: 'Timeout for goal judging requests',
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },

  'user-settings.json': {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        minLength: 1,
        description: 'API key for Grok',
      },
      baseURL: {
        type: 'string',
        pattern: '^https?://',
        description: 'Custom API base URL',
      },
      defaultModel: {
        type: 'string',
        description: 'Default model for all sessions',
      },
      theme: {
        type: 'string',
        enum: ['dark', 'light', 'auto'],
        default: 'auto',
      },
    },
    additionalProperties: false,
  },

  'hooks.json': {
    type: 'object',
    properties: {
      hooks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event: {
              type: 'string',
              enum: ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Notification'],
              description: 'Hook trigger event',
            },
            pattern: {
              type: 'string',
              description: 'Regex pattern to match tool names',
            },
            command: {
              type: 'string',
              minLength: 1,
              description: 'Shell command to execute',
            },
            description: {
              type: 'string',
              description: 'Human-readable description',
            },
            timeout: {
              type: 'number',
              minimum: 1000,
              maximum: 300000,
              default: 30000,
              description: 'Command timeout in milliseconds',
            },
            continueOnError: {
              type: 'boolean',
              default: false,
              description: 'Continue if hook fails',
            },
          },
          required: ['event', 'command'],
        },
      },
    },
    required: ['hooks'],
    additionalProperties: false,
  },

  'mcp.json': {
    type: 'object',
    properties: {
      servers: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              minLength: 1,
              description: 'Command to start the MCP server',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command arguments',
            },
            env: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Environment variables',
            },
            enabled: {
              type: 'boolean',
              default: true,
            },
          },
          required: ['command'],
        },
      },
    },
    required: ['servers'],
    additionalProperties: false,
  },

  'yolo.json': {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable YOLO mode',
      },
      allowList: {
        type: 'array',
        items: { type: 'string' },
        description: 'Commands that can be auto-executed',
      },
      denyList: {
        type: 'array',
        items: { type: 'string' },
        description: 'Commands that are always blocked',
      },
      maxAutoEdits: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        default: 5,
        description: 'Maximum auto file edits per session',
      },
      maxAutoCommands: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        default: 10,
        description: 'Maximum auto shell commands per session',
      },
      safeMode: {
        type: 'boolean',
        default: true,
        description: 'Extra safety checks in YOLO mode',
      },
    },
    additionalProperties: false,
  },
};
