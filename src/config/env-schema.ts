/**
 * Environment Variable Schema & Validation
 *
 * Central registry of all environment variables used by Code Buddy.
 * Provides validation, documentation, and a CLI summary.
 */

export interface EnvVarDef {
  /** Environment variable name */
  name: string;
  /** Expected value type */
  type: 'string' | 'number' | 'boolean';
  /** Default value (as string, since env vars are always strings) */
  default?: string;
  /** Human-readable description */
  description: string;
  /** Whether the app cannot function without this variable */
  required?: boolean;
  /** Whether the value should be masked in output (API keys, secrets) */
  sensitive?: boolean;
  /** Category for grouping in CLI output */
  category: EnvCategory;
  /** Minimum value for numbers */
  min?: number;
  /** Maximum value for numbers */
  max?: number;
  /** Regex pattern for string validation */
  pattern?: RegExp;
}

export type EnvCategory =
  | 'core'
  | 'provider'
  | 'server'
  | 'security'
  | 'debug'
  | 'voice'
  | 'search'
  | 'cache'
  | 'metrics'
  | 'display';

function providerStringEnv(
  name: string,
  description: string,
  options: Pick<EnvVarDef, 'default' | 'sensitive'> = {},
): EnvVarDef {
  return {
    name,
    type: 'string',
    description,
    category: 'provider',
    ...options,
  };
}

function providerNumberEnv(
  name: string,
  description: string,
  options: Pick<EnvVarDef, 'default' | 'min' | 'max'> = {},
): EnvVarDef {
  return {
    name,
    type: 'number',
    description,
    category: 'provider',
    ...options,
  };
}

/**
 * Complete schema of all environment variables used across the codebase.
 */
export const ENV_SCHEMA: EnvVarDef[] = [
  // ---- Core ----
  {
    name: 'GROK_API_KEY',
    type: 'string',
    description: 'Primary API key (xAI / Grok)',
    required: true,
    sensitive: true,
    category: 'core',
  },
  {
    name: 'GROK_BASE_URL',
    type: 'string',
    default: 'https://api.x.ai/v1',
    description: 'Custom API endpoint for Grok',
    category: 'core',
  },
  {
    name: 'GROK_MODEL',
    type: 'string',
    default: 'grok-3-fast',
    description: 'Default LLM model to use',
    category: 'core',
  },
  {
    name: 'YOLO_MODE',
    type: 'boolean',
    default: 'false',
    description: 'Full autonomy mode (400 tool rounds, higher cost limit)',
    category: 'core',
  },
  {
    name: 'MAX_COST',
    type: 'number',
    default: '10',
    description: 'Session cost limit in dollars',
    category: 'core',
    min: 0,
    max: 10000,
  },
  {
    name: 'MORPH_API_KEY',
    type: 'string',
    description: 'Morph API key for fast file editing',
    sensitive: true,
    category: 'core',
  },
  {
    name: 'CODEBUDDY_MAX_TOKENS',
    type: 'number',
    description: 'Override max output tokens for LLM responses',
    category: 'core',
    min: 1,
    max: 1000000,
  },
  {
    name: 'CODEBUDDY_MAX_CONTEXT',
    type: 'number',
    description: 'Override max context window size',
    category: 'core',
    min: 1000,
  },
  {
    name: 'CODEBUDDY_MIN_FREE_MB',
    type: 'number',
    default: '500',
    description: 'disk-guard: min free space (MB) before a guarded write/launch is refused',
    category: 'core',
    min: 0,
    max: 1000000,
  },
  {
    name: 'CODEBUDDY_DISK_QUOTA_MB',
    type: 'number',
    default: '0',
    description: 'disk-guard: per-session byte budget (MB); 0 = unlimited',
    category: 'core',
    min: 0,
    max: 100000000,
  },
  {
    name: 'CODEBUDDY_TEMP_MAX_AGE_MS',
    type: 'number',
    default: '0',
    description: 'disk-guard: orphan-sweep age cutoff (ms); 0 = presence-based',
    category: 'core',
    min: 0,
  },
  {
    name: 'CODEBUDDY_LOG_MAX_MB',
    type: 'number',
    default: '10',
    description: 'disk-guard: append-log rotation size (MB)',
    category: 'core',
    min: 1,
    max: 100000,
  },
  {
    name: 'CODEBUDDY_LOG_MAX_FILES',
    type: 'number',
    default: '5',
    description: 'disk-guard: append-log retention count',
    category: 'core',
    min: 1,
    max: 1000,
  },
  {
    name: 'CODEBUDDY_GOAL_MAX_TURNS',
    type: 'number',
    description: 'Turn budget for /goal auto-continue loops (default 20)',
    category: 'core',
    min: 1,
    max: 1000,
  },
  {
    name: 'CODEBUDDY_GOAL_JUDGE_MODEL',
    type: 'string',
    description: 'Model used by the /goal judge (default: current session model)',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_RTK',
    type: 'boolean',
    default: 'false',
    description: 'Enable RTK shell command rewriting for token-optimized command output',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_RTK_REWRITE',
    type: 'boolean',
    default: 'false',
    description: 'Alias flag for enabling RTK shell command rewriting',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_RTK_TIMEOUT_MS',
    type: 'number',
    default: '1000',
    description: 'Timeout for rtk rewrite calls before falling back to the original command',
    category: 'core',
    min: 50,
    max: 10000,
  },
  {
    name: 'CODEBUDDY_LM_RESIZER',
    type: 'boolean',
    default: 'false',
    description: 'Enable lm-resizer post-execution context compression for large tool outputs',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_LM_RESIZER_BIN',
    type: 'string',
    description: 'Path to the lm-resizer binary (local release build and PATH remain fallbacks)',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_LM_RESIZER_STORE',
    type: 'string',
    description: 'Path to the lm-resizer CCR SQLite store used by Code Buddy',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_LM_RESIZER_URL',
    type: 'string',
    default: 'http://127.0.0.1:8787',
    description: 'Local lm-resizer HTTP sidecar URL (preferred low-latency transport)',
    category: 'core',
  },
  {
    name: 'LM_RESIZER_URL',
    type: 'string',
    description: 'Compatibility alias for CODEBUDDY_LM_RESIZER_URL',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_LM_RESIZER_TOKEN_FILE',
    type: 'string',
    description: 'Private file containing the lm-resizer sidecar token (mode 0600 on Unix)',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_LM_RESIZER_SERVER_TOKEN',
    type: 'string',
    description: 'Direct lm-resizer sidecar token override; prefer TOKEN_FILE',
    sensitive: true,
    category: 'core',
  },
  {
    name: 'CODEBUDDY_LM_RESIZER_TOKEN',
    type: 'string',
    description: 'Compatibility alias for CODEBUDDY_LM_RESIZER_SERVER_TOKEN',
    sensitive: true,
    category: 'core',
  },
  {
    name: 'CODEBUDDY_FALLBACK_PROVIDERS',
    type: 'string',
    description: 'Comma-separated provider[:model] fallbacks tried when the primary LLM chat call fails',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_FALLBACK_PROVIDER',
    type: 'string',
    description: 'Single fallback provider id or alias, optionally paired with CODEBUDDY_FALLBACK_MODEL',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_FALLBACK_MODEL',
    type: 'string',
    description: 'Fallback model used with CODEBUDDY_FALLBACK_PROVIDER',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_MEMORY_ENFORCE_LIMITS',
    type: 'boolean',
    default: 'true',
    description: 'Reject persistent-memory writes that exceed Hermes-style character budgets',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_MEMORY_PROJECT_CHAR_LIMIT',
    type: 'number',
    default: '2200',
    description: 'Character budget for project persistent memory',
    category: 'core',
    min: 1,
  },
  {
    name: 'CODEBUDDY_MEMORY_USER_CHAR_LIMIT',
    type: 'number',
    default: '1375',
    description: 'Character budget for user persistent memory',
    category: 'core',
    min: 1,
  },
  {
    name: 'CODEBUDDY_MEMORY_SECURITY_SCAN',
    type: 'boolean',
    default: 'true',
    description: 'Reject prompt-injection, exfiltration, private-key, and invisible-Unicode memory writes',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_MEMORY_REJECT_DUPLICATES',
    type: 'boolean',
    default: 'true',
    description: 'Return success without writing when a persistent memory entry is an exact duplicate',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_MEMORY_AUTO_PROPOSE',
    type: 'boolean',
    default: 'true',
    description: 'At session end, enqueue review-gated long-term memory candidates from the transcript',
    category: 'core',
  },
  {
    name: 'GROK_FORCE_TOOLS',
    type: 'boolean',
    default: 'false',
    description: 'Force function calling mode for local models',
    category: 'core',
  },
  {
    name: 'GROK_CONVERT_TOOL_MESSAGES',
    type: 'boolean',
    default: 'false',
    description: 'Convert tool messages for providers that lack native support',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_HOME',
    type: 'string',
    description: 'Custom home directory for Code Buddy config/data',
    category: 'core',
  },
  {
    name: 'GROK_HOME',
    type: 'string',
    description: 'Legacy alias for CODEBUDDY_HOME from the historical grok-cli name',
    category: 'core',
  },
  {
    name: 'GROK_VIM_MODE',
    type: 'boolean',
    default: 'false',
    description: 'Enable vim-style key bindings in the terminal UI',
    category: 'core',
  },
  {
    name: 'GROK_SKIP_PERMISSIONS',
    type: 'boolean',
    default: 'false',
    description: 'Bypass all permission checks (dangerous, containers only)',
    category: 'core',
  },
  {
    name: 'CODEBUDDY_SESSIONS_DIR',
    type: 'string',
    description: 'Custom directory for session persistence files',
    category: 'core',
  },

  // ---- Provider API Keys ----
  {
    name: 'XAI_API_KEY',
    type: 'string',
    description: 'Alias for GROK_API_KEY (xAI provider)',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'CODEBUDDY_PROVIDER',
    type: 'string',
    description: 'Force the runtime provider id (for example chatgpt, ollama, openrouter, groq)',
    category: 'provider',
  },
  {
    name: 'CHATGPT_MODEL',
    type: 'string',
    default: 'gpt-5.6-sol',
    description: 'Default model for ChatGPT OAuth / Codex Responses backend',
    category: 'provider',
  },
  {
    name: 'OPENAI_API_KEY',
    type: 'string',
    description: 'OpenAI API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'OPENAI_BASE_URL',
    type: 'string',
    default: 'https://api.openai.com/v1',
    description: 'Custom OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'OPENAI_MODEL',
    type: 'string',
    default: 'gpt-4o',
    description: 'Default OpenAI model',
    category: 'provider',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    type: 'string',
    description: 'Anthropic API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'ANTHROPIC_MODEL',
    type: 'string',
    default: 'claude-sonnet-4-20250514',
    description: 'Default Anthropic model',
    category: 'provider',
  },
  {
    name: 'GOOGLE_API_KEY',
    type: 'string',
    description: 'Google AI API key (Gemini)',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'GEMINI_API_KEY',
    type: 'string',
    description: 'Alias for GOOGLE_API_KEY',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'GEMINI_MODEL',
    type: 'string',
    default: 'gemini-2.5-flash',
    description: 'Default Gemini model',
    category: 'provider',
  },
  {
    name: 'OLLAMA_HOST',
    type: 'string',
    default: 'http://localhost:11434',
    description: 'Ollama host; normalized to /v1 for OpenAI-compatible calls',
    category: 'provider',
  },
  {
    name: 'OLLAMA_MODEL',
    type: 'string',
    default: 'qwen2.5-coder:7b',
    description: 'Default Ollama model',
    category: 'provider',
  },
  {
    name: 'LMSTUDIO_HOST',
    type: 'string',
    default: 'http://localhost:1234',
    description: 'LM Studio local server host; normalized to /v1',
    category: 'provider',
  },
  {
    name: 'LM_STUDIO_HOST',
    type: 'string',
    default: 'http://localhost:1234',
    description: 'Alias for LMSTUDIO_HOST',
    category: 'provider',
  },
  {
    name: 'LMSTUDIO_MODEL',
    type: 'string',
    default: 'local-model',
    description: 'Default LM Studio model',
    category: 'provider',
  },
  {
    name: 'MISTRAL_API_KEY',
    type: 'string',
    description: 'Mistral API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'MISTRAL_MODEL',
    type: 'string',
    default: 'mistral-large-latest',
    description: 'Default Mistral model',
    category: 'provider',
  },
  {
    name: 'GROQ_API_KEY',
    type: 'string',
    description: 'Groq API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'GROQ_MODEL',
    type: 'string',
    default: 'llama-3.3-70b-versatile',
    description: 'Default Groq model',
    category: 'provider',
  },
  {
    name: 'TOGETHER_API_KEY',
    type: 'string',
    description: 'Together AI API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'TOGETHER_MODEL',
    type: 'string',
    default: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    description: 'Default Together AI model',
    category: 'provider',
  },
  {
    name: 'FIREWORKS_API_KEY',
    type: 'string',
    description: 'Fireworks AI API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'FIREWORKS_MODEL',
    type: 'string',
    default: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    description: 'Default Fireworks model',
    category: 'provider',
  },
  {
    name: 'OPENROUTER_MODEL',
    type: 'string',
    default: 'openai/gpt-4o',
    description: 'Default OpenRouter model',
    category: 'provider',
  },
  providerStringEnv('OPENROUTER_PROVIDER_SORT', 'OpenRouter provider ranking: price, throughput, or latency'),
  providerStringEnv('OPENROUTER_PROVIDER_ONLY', 'Comma-separated OpenRouter sub-provider allowlist'),
  providerStringEnv('OPENROUTER_PROVIDER_IGNORE', 'Comma-separated OpenRouter sub-provider denylist'),
  providerStringEnv('OPENROUTER_PROVIDER_ORDER', 'Comma-separated OpenRouter sub-provider priority order'),
  {
    name: 'OPENROUTER_PROVIDER_REQUIRE_PARAMETERS',
    type: 'boolean',
    description: 'Require OpenRouter sub-providers to support every requested parameter',
    category: 'provider',
  },
  providerStringEnv('OPENROUTER_PROVIDER_DATA_COLLECTION', 'OpenRouter data collection policy: allow or deny'),
  {
    name: 'OPENROUTER_PROVIDER_ALLOW_FALLBACKS',
    type: 'boolean',
    description: 'Allow OpenRouter to fall back to other sub-providers when routed providers fail',
    category: 'provider',
  },
  providerStringEnv('CODEBUDDY_OPENROUTER_PROVIDER_SORT', 'Alias for OPENROUTER_PROVIDER_SORT'),
  providerStringEnv('CODEBUDDY_OPENROUTER_PROVIDER_ONLY', 'Alias for OPENROUTER_PROVIDER_ONLY'),
  providerStringEnv('CODEBUDDY_OPENROUTER_PROVIDER_IGNORE', 'Alias for OPENROUTER_PROVIDER_IGNORE'),
  providerStringEnv('CODEBUDDY_OPENROUTER_PROVIDER_ORDER', 'Alias for OPENROUTER_PROVIDER_ORDER'),
  {
    name: 'CODEBUDDY_OPENROUTER_PROVIDER_REQUIRE_PARAMETERS',
    type: 'boolean',
    description: 'Alias for OPENROUTER_PROVIDER_REQUIRE_PARAMETERS',
    category: 'provider',
  },
  providerStringEnv('CODEBUDDY_OPENROUTER_PROVIDER_DATA_COLLECTION', 'Alias for OPENROUTER_PROVIDER_DATA_COLLECTION'),
  {
    name: 'CODEBUDDY_OPENROUTER_PROVIDER_ALLOW_FALLBACKS',
    type: 'boolean',
    description: 'Alias for OPENROUTER_PROVIDER_ALLOW_FALLBACKS',
    category: 'provider',
  },
  providerStringEnv('CODEBUDDY_AUXILIARY_PROVIDER', 'Default auxiliary-task provider: auto, main, or a runtime provider id/alias'),
  providerStringEnv('CODEBUDDY_AUXILIARY_MODEL', 'Default auxiliary-task model override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_BASE_URL', 'Default auxiliary-task base URL override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_API_KEY', 'Default auxiliary-task API key override', { sensitive: true }),
  providerNumberEnv('CODEBUDDY_AUXILIARY_TIMEOUT_MS', 'Default auxiliary-task timeout in milliseconds', { min: 1 }),
  providerStringEnv('CODEBUDDY_AUXILIARY_EXTRA_BODY', 'Default auxiliary-task JSON request-body extras'),
  providerStringEnv('CODEBUDDY_AUXILIARY_VISION_PROVIDER', 'Vision auxiliary provider override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_VISION_MODEL', 'Vision auxiliary model override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_VISION_BASE_URL', 'Vision auxiliary base URL override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_VISION_API_KEY', 'Vision auxiliary API key override', { sensitive: true }),
  providerNumberEnv('CODEBUDDY_AUXILIARY_VISION_TIMEOUT_MS', 'Vision auxiliary timeout in milliseconds', { default: '120000', min: 1 }),
  providerStringEnv('AUXILIARY_VISION_MODEL', 'Hermes-compatible vision auxiliary model override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_BROWSER_VISION_PROVIDER', 'Browser vision auxiliary provider override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_BROWSER_VISION_MODEL', 'Browser vision auxiliary model override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_WEB_EXTRACT_PROVIDER', 'Web extraction auxiliary provider override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_WEB_EXTRACT_MODEL', 'Web extraction auxiliary model override'),
  providerNumberEnv('CODEBUDDY_AUXILIARY_WEB_EXTRACT_TIMEOUT_MS', 'Web extraction auxiliary timeout in milliseconds', { default: '360000', min: 1 }),
  providerStringEnv('CODEBUDDY_AUXILIARY_APPROVAL_PROVIDER', 'Approval-classifier auxiliary provider override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_APPROVAL_MODEL', 'Approval-classifier auxiliary model override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_APPROVAL_API_KEY', 'Approval-classifier auxiliary API key override', { sensitive: true }),
  providerNumberEnv('CODEBUDDY_AUXILIARY_APPROVAL_TIMEOUT_MS', 'Approval-classifier auxiliary timeout in milliseconds', { default: '30000', min: 1 }),
  providerStringEnv('CODEBUDDY_AUXILIARY_COMPRESSION_PROVIDER', 'Context compression auxiliary provider override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_COMPRESSION_MODEL', 'Context compression auxiliary model override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_COMPRESSION_API_KEY', 'Context compression auxiliary API key override', { sensitive: true }),
  providerStringEnv('CODEBUDDY_AUXILIARY_COMPRESSION_EXTRA_BODY', 'Context compression auxiliary JSON request-body extras'),
  providerNumberEnv('CODEBUDDY_AUXILIARY_COMPRESSION_TIMEOUT_MS', 'Context compression auxiliary timeout in milliseconds', { default: '120000', min: 1 }),
  providerStringEnv('CODEBUDDY_AUXILIARY_SKILLS_HUB_PROVIDER', 'Skills hub auxiliary provider override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_SKILLS_HUB_MODEL', 'Skills hub auxiliary model override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_MCP_PROVIDER', 'MCP dispatch auxiliary provider override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_MCP_MODEL', 'MCP dispatch auxiliary model override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_TRIAGE_SPECIFIER_PROVIDER', 'Triage specifier auxiliary provider override'),
  providerStringEnv('CODEBUDDY_AUXILIARY_TRIAGE_SPECIFIER_MODEL', 'Triage specifier auxiliary model override'),
  providerNumberEnv('CODEBUDDY_AUXILIARY_TRIAGE_SPECIFIER_TIMEOUT_MS', 'Triage specifier auxiliary timeout in milliseconds', { default: '120000', min: 1 }),
  {
    name: 'NOVITA_API_KEY',
    type: 'string',
    description: 'NovitaAI API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'NOVITA_BASE_URL',
    type: 'string',
    default: 'https://api.novita.ai/openai/v1',
    description: 'NovitaAI OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'NOVITA_MODEL',
    type: 'string',
    default: 'moonshotai/kimi-k2.5',
    description: 'Default NovitaAI model',
    category: 'provider',
  },
  {
    name: 'GLM_API_KEY',
    type: 'string',
    description: 'z.ai / GLM API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'ZAI_API_KEY',
    type: 'string',
    description: 'Alias API key for z.ai / GLM',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'GLM_BASE_URL',
    type: 'string',
    default: 'https://api.z.ai/api/paas/v4',
    description: 'z.ai / GLM OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'GLM_MODEL',
    type: 'string',
    default: 'glm-5',
    description: 'Default z.ai / GLM model',
    category: 'provider',
  },
  {
    name: 'KIMI_API_KEY',
    type: 'string',
    description: 'Kimi / Moonshot API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'KIMI_BASE_URL',
    type: 'string',
    default: 'https://api.moonshot.ai/v1',
    description: 'Kimi / Moonshot OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'KIMI_MODEL',
    type: 'string',
    default: 'kimi-k2.5',
    description: 'Default Kimi model',
    category: 'provider',
  },
  {
    name: 'KIMI_CN_API_KEY',
    type: 'string',
    description: 'Kimi China API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'KIMI_CN_BASE_URL',
    type: 'string',
    default: 'https://api.moonshot.cn/v1',
    description: 'Kimi China OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'ARCEEAI_API_KEY',
    type: 'string',
    description: 'Arcee AI API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'ARCEEAI_BASE_URL',
    type: 'string',
    default: 'https://api.arcee.ai/api/v1',
    description: 'Arcee AI OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'GMI_API_KEY',
    type: 'string',
    description: 'GMI Cloud API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'GMI_BASE_URL',
    type: 'string',
    default: 'https://api.gmi-serving.com/v1',
    description: 'GMI Cloud OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'MINIMAX_API_KEY',
    type: 'string',
    description: 'MiniMax API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'MINIMAX_BASE_URL',
    type: 'string',
    default: 'https://api.minimax.io/v1',
    description: 'MiniMax OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'MINIMAX_CN_API_KEY',
    type: 'string',
    description: 'MiniMax China API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'MINIMAX_CN_BASE_URL',
    type: 'string',
    default: 'https://api.minimaxi.com/v1',
    description: 'MiniMax China OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'DASHSCOPE_API_KEY',
    type: 'string',
    description: 'Alibaba Cloud DashScope API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'DASHSCOPE_BASE_URL',
    type: 'string',
    default: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    description: 'DashScope OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'ALIBABA_CODING_PLAN_API_KEY',
    type: 'string',
    description: 'Alibaba Coding Plan API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'KILOCODE_API_KEY',
    type: 'string',
    description: 'Kilo Code Gateway API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'KILOCODE_BASE_URL',
    type: 'string',
    default: 'https://api.kilo.ai/api/gateway',
    description: 'Kilo Code Gateway endpoint',
    category: 'provider',
  },
  {
    name: 'XIAOMI_API_KEY',
    type: 'string',
    description: 'Xiaomi MiMo API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'XIAOMI_BASE_URL',
    type: 'string',
    default: 'https://api.xiaomimimo.com/v1',
    description: 'Xiaomi MiMo OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'TOKENHUB_API_KEY',
    type: 'string',
    description: 'Tencent TokenHub API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'TOKENHUB_BASE_URL',
    type: 'string',
    default: 'https://tokenhub.tencentmaas.com/v1',
    description: 'Tencent TokenHub OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'OPENCODE_ZEN_API_KEY',
    type: 'string',
    description: 'OpenCode Zen API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'OPENCODE_GO_API_KEY',
    type: 'string',
    description: 'OpenCode Go API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'DEEPSEEK_API_KEY',
    type: 'string',
    description: 'DeepSeek API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'DEEPSEEK_BASE_URL',
    type: 'string',
    default: 'https://api.deepseek.com/v1',
    description: 'DeepSeek OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'HF_TOKEN',
    type: 'string',
    description: 'Hugging Face token for the OpenAI-compatible inference router',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'HF_BASE_URL',
    type: 'string',
    default: 'https://router.huggingface.co/v1',
    description: 'Hugging Face inference router endpoint',
    category: 'provider',
  },
  {
    name: 'NVIDIA_API_KEY',
    type: 'string',
    description: 'NVIDIA NIM API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'NVIDIA_BASE_URL',
    type: 'string',
    default: 'https://integrate.api.nvidia.com/v1',
    description: 'NVIDIA NIM OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'OLLAMA_API_KEY',
    type: 'string',
    description: 'Ollama Cloud API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'OLLAMA_CLOUD_BASE_URL',
    type: 'string',
    default: 'https://ollama.com/v1',
    description: 'Ollama Cloud OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'STEPFUN_API_KEY',
    type: 'string',
    description: 'StepFun API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'STEPFUN_BASE_URL',
    type: 'string',
    default: 'https://api.stepfun.ai/v1',
    description: 'StepFun OpenAI-compatible endpoint',
    category: 'provider',
  },
  {
    name: 'VLLM_API_KEY',
    type: 'string',
    description: 'Optional vLLM API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'VLLM_BASE_URL',
    type: 'string',
    default: 'http://localhost:8000',
    description: 'vLLM OpenAI-compatible server base URL',
    category: 'provider',
  },
  {
    name: 'VLLM_MODEL',
    type: 'string',
    default: 'model',
    description: 'Default vLLM served model id',
    category: 'provider',
  },
  {
    name: 'CODEBUDDY_BASE_URL',
    type: 'string',
    description: 'Custom OpenAI-compatible provider base URL',
    category: 'provider',
  },
  {
    name: 'CODEBUDDY_API_KEY',
    type: 'string',
    description: 'Custom OpenAI-compatible provider API key',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'CUSTOM_PROVIDER_API_KEY',
    type: 'string',
    description: 'Alias API key for a custom OpenAI-compatible provider',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'CUSTOM_PROVIDER_BASE_URL',
    type: 'string',
    description: 'Alias base URL for a custom OpenAI-compatible provider',
    category: 'provider',
  },
  {
    name: 'CUSTOM_PROVIDER_MODEL',
    type: 'string',
    description: 'Alias model id for a custom OpenAI-compatible provider',
    category: 'provider',
  },
  {
    name: 'CODEBUDDY_MODEL',
    type: 'string',
    description: 'Custom OpenAI-compatible provider model id',
    category: 'provider',
  },
  providerStringEnv('CODEBUDDY_CHATGPT_OAUTH', 'Presence marker for ChatGPT OAuth credentials'),
  providerStringEnv('LMSTUDIO_API_KEY', 'Optional LM Studio API key', { sensitive: true }),
  providerStringEnv('LM_STUDIO_API_KEY', 'Alias for LMSTUDIO_API_KEY', { sensitive: true }),
  providerStringEnv('LMSTUDIO_BASE_URL', 'Alias for LMSTUDIO_HOST'),
  providerStringEnv('LM_STUDIO_BASE_URL', 'Alias for LM_STUDIO_HOST'),
  providerStringEnv('LM_STUDIO_MODEL', 'Alias for LMSTUDIO_MODEL'),
  providerStringEnv('XAI_BASE_URL', 'Alias for GROK_BASE_URL'),
  providerStringEnv('XAI_MODEL', 'Alias for GROK_MODEL'),
  providerStringEnv('GEMINI_BASE_URL', 'Custom Gemini API endpoint'),
  providerStringEnv('GOOGLE_AI_BASE_URL', 'Alias for GEMINI_BASE_URL'),
  providerStringEnv('GOOGLE_MODEL', 'Alias for GEMINI_MODEL'),
  providerStringEnv('ANTHROPIC_BASE_URL', 'Custom Anthropic API endpoint'),
  providerStringEnv('CLAUDE_MODEL', 'Alias for ANTHROPIC_MODEL'),
  providerStringEnv('MISTRAL_BASE_URL', 'Custom Mistral OpenAI-compatible endpoint'),
  providerStringEnv('GROQ_BASE_URL', 'Custom Groq OpenAI-compatible endpoint'),
  providerStringEnv('TOGETHER_BASE_URL', 'Custom Together AI OpenAI-compatible endpoint'),
  providerStringEnv('FIREWORKS_BASE_URL', 'Custom Fireworks AI OpenAI-compatible endpoint'),
  providerStringEnv('OPENROUTER_BASE_URL', 'Custom OpenRouter endpoint'),
  providerStringEnv('ZAI_BASE_URL', 'Alias for GLM_BASE_URL'),
  providerStringEnv('ZAI_MODEL', 'Alias for GLM_MODEL'),
  providerStringEnv('MOONSHOT_API_KEY', 'Alias API key for Kimi / Moonshot', { sensitive: true }),
  providerStringEnv('MOONSHOT_BASE_URL', 'Alias for KIMI_BASE_URL'),
  providerStringEnv('MOONSHOT_MODEL', 'Alias for KIMI_MODEL'),
  providerStringEnv('KIMI_CN_MODEL', 'Default Kimi China model'),
  providerStringEnv('ARCEE_API_KEY', 'Alias API key for Arcee AI', { sensitive: true }),
  providerStringEnv('ARCEE_BASE_URL', 'Alias for ARCEEAI_BASE_URL'),
  providerStringEnv('ARCEEAI_MODEL', 'Default Arcee AI model'),
  providerStringEnv('ARCEE_MODEL', 'Alias for ARCEEAI_MODEL'),
  providerStringEnv('GMI_MODEL', 'Default GMI Cloud model'),
  providerStringEnv('MINIMAX_MODEL', 'Default MiniMax model'),
  providerStringEnv('MINIMAX_CN_MODEL', 'Default MiniMax China model'),
  providerStringEnv('ALIBABA_API_KEY', 'Alias API key for Alibaba / DashScope', { sensitive: true }),
  providerStringEnv('ALIBABA_BASE_URL', 'Alias for DASHSCOPE_BASE_URL'),
  providerStringEnv('DASHSCOPE_MODEL', 'Default DashScope model'),
  providerStringEnv('ALIBABA_MODEL', 'Alias for DASHSCOPE_MODEL'),
  providerStringEnv('ALIBABA_CODING_PLAN_BASE_URL', 'Custom Alibaba Coding Plan endpoint'),
  providerStringEnv('DASHSCOPE_CODING_BASE_URL', 'Alias for ALIBABA_CODING_PLAN_BASE_URL'),
  providerStringEnv('ALIBABA_CODING_PLAN_MODEL', 'Default Alibaba Coding Plan model'),
  providerStringEnv('DASHSCOPE_CODING_MODEL', 'Alias for ALIBABA_CODING_PLAN_MODEL'),
  providerStringEnv('KILO_API_KEY', 'Alias API key for Kilo Code Gateway', { sensitive: true }),
  providerStringEnv('KILO_BASE_URL', 'Alias for KILOCODE_BASE_URL'),
  providerStringEnv('KILOCODE_MODEL', 'Default Kilo Code Gateway model'),
  providerStringEnv('KILO_MODEL', 'Alias for KILOCODE_MODEL'),
  providerStringEnv('XIAOMI_MODEL', 'Default Xiaomi MiMo model'),
  providerStringEnv('TENCENT_TOKENHUB_API_KEY', 'Alias API key for Tencent TokenHub', { sensitive: true }),
  providerStringEnv('TENCENT_TOKENHUB_BASE_URL', 'Alias for TOKENHUB_BASE_URL'),
  providerStringEnv('TOKENHUB_MODEL', 'Default Tencent TokenHub model'),
  providerStringEnv('TENCENT_TOKENHUB_MODEL', 'Alias for TOKENHUB_MODEL'),
  providerStringEnv('OPENCODE_API_KEY', 'Alias API key for OpenCode Zen', { sensitive: true }),
  providerStringEnv('OPENCODE_ZEN_BASE_URL', 'Custom OpenCode Zen endpoint'),
  providerStringEnv('OPENCODE_BASE_URL', 'Alias for OPENCODE_ZEN_BASE_URL'),
  providerStringEnv('OPENCODE_ZEN_MODEL', 'Default OpenCode Zen model'),
  providerStringEnv('OPENCODE_MODEL', 'Alias for OPENCODE_ZEN_MODEL'),
  providerStringEnv('OPENCODE_GO_BASE_URL', 'Custom OpenCode Go endpoint'),
  providerStringEnv('OPENCODE_GO_MODEL', 'Default OpenCode Go model'),
  providerStringEnv('DEEPSEEK_MODEL', 'Default DeepSeek model'),
  providerStringEnv('HUGGINGFACE_API_KEY', 'Alias API key for Hugging Face', { sensitive: true }),
  providerStringEnv('HUGGINGFACE_BASE_URL', 'Alias for HF_BASE_URL'),
  providerStringEnv('HF_MODEL', 'Default Hugging Face router model'),
  providerStringEnv('HUGGINGFACE_MODEL', 'Alias for HF_MODEL'),
  providerStringEnv('NVIDIA_NIM_BASE_URL', 'Alias for NVIDIA_BASE_URL'),
  providerStringEnv('NVIDIA_MODEL', 'Default NVIDIA NIM model'),
  providerStringEnv('NVIDIA_NIM_MODEL', 'Alias for NVIDIA_MODEL'),
  providerStringEnv('OLLAMA_CLOUD_MODEL', 'Default Ollama Cloud model'),
  providerStringEnv('STEP_API_KEY', 'Alias API key for StepFun', { sensitive: true }),
  providerStringEnv('STEP_BASE_URL', 'Alias for STEPFUN_BASE_URL'),
  providerStringEnv('STEPFUN_MODEL', 'Default StepFun model'),
  providerStringEnv('STEP_MODEL', 'Alias for STEPFUN_MODEL'),
  providerStringEnv('AZURE_OPENAI_ENDPOINT', 'Azure OpenAI resource endpoint'),
  providerStringEnv('AZURE_OPENAI_API_KEY', 'Azure OpenAI API key', { sensitive: true }),
  providerStringEnv('AZURE_OPENAI_AD_TOKEN', 'Azure OpenAI Azure AD bearer token', { sensitive: true }),
  providerStringEnv('AZURE_OPENAI_API_VERSION', 'Azure OpenAI API version', { default: '2024-02-01' }),
  providerStringEnv('AZURE_OPENAI_DEPLOYMENT', 'Azure OpenAI deployment name'),
  providerStringEnv('AZURE_OPENAI_MODEL', 'Azure OpenAI model/deployment alias'),
  providerStringEnv('AWS_BEDROCK_REGION', 'AWS Bedrock region'),
  providerStringEnv('AWS_REGION', 'AWS region alias for Bedrock'),
  providerStringEnv('AWS_ACCESS_KEY_ID', 'AWS access key id for Bedrock', { sensitive: true }),
  providerStringEnv('AWS_SECRET_ACCESS_KEY', 'AWS secret access key for Bedrock', { sensitive: true }),
  providerStringEnv('AWS_SESSION_TOKEN', 'AWS session token for Bedrock', { sensitive: true }),
  providerStringEnv('AWS_BEDROCK_MODEL', 'AWS Bedrock model id'),
  providerStringEnv('BEDROCK_MODEL', 'Alias for AWS_BEDROCK_MODEL'),
  providerStringEnv('GITHUB_COPILOT_TOKEN', 'GitHub Copilot token', { sensitive: true }),
  providerStringEnv('COPILOT_GITHUB_TOKEN', 'Alias GitHub Copilot token', { sensitive: true }),
  providerStringEnv('GH_TOKEN', 'GitHub token fallback for Copilot', { sensitive: true }),
  providerStringEnv('COPILOT_MODEL', 'GitHub Copilot model override'),
  {
    name: 'ELEVENLABS_API_KEY',
    type: 'string',
    description: 'ElevenLabs TTS API key',
    sensitive: true,
    category: 'provider',
  },

  // ---- Search ----
  {
    name: 'BRAVE_API_KEY',
    type: 'string',
    description: 'Brave Search API key for MCP web search',
    sensitive: true,
    category: 'search',
  },
  {
    name: 'EXA_API_KEY',
    type: 'string',
    description: 'Exa neural search API key for MCP',
    sensitive: true,
    category: 'search',
  },
  {
    name: 'PERPLEXITY_API_KEY',
    type: 'string',
    description: 'Perplexity AI search key (direct or via OpenRouter)',
    sensitive: true,
    category: 'search',
  },
  {
    name: 'OPENROUTER_API_KEY',
    type: 'string',
    description: 'OpenRouter key (alternative for Perplexity)',
    sensitive: true,
    category: 'search',
  },
  {
    name: 'PERPLEXITY_MODEL',
    type: 'string',
    default: 'perplexity/sonar-pro',
    description: 'Perplexity model to use for search',
    category: 'search',
  },
  {
    name: 'SERPER_API_KEY',
    type: 'string',
    description: 'Serper API key for web/browser search',
    sensitive: true,
    category: 'search',
  },

  // ---- Server ----
  {
    name: 'PORT',
    type: 'number',
    default: '3000',
    description: 'HTTP server listen port',
    category: 'server',
    min: 1,
    max: 65535,
  },
  {
    name: 'HOST',
    type: 'string',
    default: '0.0.0.0',
    description: 'HTTP server listen address',
    category: 'server',
  },
  {
    name: 'CORS_ORIGINS',
    type: 'string',
    default: '*',
    description: 'Comma-separated list of allowed CORS origins',
    category: 'server',
  },
  {
    name: 'RATE_LIMIT_MAX',
    type: 'number',
    default: '100',
    description: 'Max requests per rate-limit window',
    category: 'server',
    min: 1,
  },
  {
    name: 'RATE_LIMIT_WINDOW',
    type: 'number',
    default: '60000',
    description: 'Rate-limit window in milliseconds',
    category: 'server',
    min: 1000,
  },
  {
    name: 'AUTH_ENABLED',
    type: 'boolean',
    default: 'true',
    description: 'Enable JWT authentication on the API server',
    category: 'server',
  },
  {
    name: 'WS_ENABLED',
    type: 'boolean',
    default: 'true',
    description: 'Enable WebSocket support on the server',
    category: 'server',
  },
  {
    name: 'LOGGING',
    type: 'boolean',
    default: 'true',
    description: 'Enable HTTP request logging',
    category: 'server',
  },
  {
    name: 'MAX_REQUEST_SIZE',
    type: 'string',
    default: '10mb',
    description: 'Maximum HTTP request body size',
    category: 'server',
  },
  {
    name: 'JWT_EXPIRATION',
    type: 'string',
    default: '24h',
    description: 'JWT token expiration duration',
    category: 'server',
  },

  // ---- Security ----
  {
    name: 'JWT_SECRET',
    type: 'string',
    description: 'Secret for API server JWT authentication',
    sensitive: true,
    category: 'security',
  },
  {
    name: 'SECURITY_MODE',
    type: 'string',
    description: 'Security tier: suggest, auto-edit, or full-auto',
    category: 'security',
    pattern: /^(suggest|auto-edit|full-auto)$/,
  },
  {
    name: 'SECURITY_HEADERS',
    type: 'boolean',
    default: 'true',
    description: 'Enable security headers on HTTP responses',
    category: 'security',
  },
  {
    name: 'DM_POLICY',
    type: 'string',
    description: 'DM pairing security policy',
    category: 'security',
  },
  {
    name: 'ARCHIVE_PASSWORD',
    type: 'string',
    description: 'Default password for encrypted archives',
    sensitive: true,
    category: 'security',
  },

  // ---- Debug ----
  {
    name: 'DEBUG',
    type: 'string',
    description: 'Enable debug logging (true or comma-separated namespaces)',
    category: 'debug',
  },
  {
    name: 'GROK_DEBUG',
    type: 'boolean',
    default: 'false',
    description: 'Enable Code Buddy debug mode',
    category: 'debug',
  },
  {
    name: 'CACHE_TRACE',
    type: 'boolean',
    default: 'false',
    description: 'Enable prompt construction debug tracing',
    category: 'debug',
  },
  {
    name: 'PERF_TIMING',
    type: 'boolean',
    default: 'false',
    description: 'Log startup performance timings',
    category: 'debug',
  },
  {
    name: 'LOG_LEVEL',
    type: 'string',
    description: 'Logging level (debug, info, warn, error)',
    category: 'debug',
    pattern: /^(debug|info|warn|error)$/,
  },
  {
    name: 'LOG_FORMAT',
    type: 'string',
    default: 'text',
    description: 'Log output format (text or json)',
    category: 'debug',
    pattern: /^(text|json)$/,
  },
  {
    name: 'LOG_FILE',
    type: 'string',
    description: 'Path to write log output to a file',
    category: 'debug',
  },
  {
    name: 'MCP_DEBUG',
    type: 'boolean',
    default: 'false',
    description: 'Enable MCP protocol debug logging',
    category: 'debug',
  },
  {
    name: 'VERBOSE',
    type: 'boolean',
    default: 'false',
    description: 'Enable verbose output',
    category: 'debug',
  },
  {
    name: 'DEBUG_LEVEL',
    type: 'string',
    description: 'Debug logging level (trace, debug, info)',
    category: 'debug',
  },
  {
    name: 'DEBUG_OUTPUT',
    type: 'string',
    description: 'Debug output destination (console, file, both)',
    category: 'debug',
  },
  {
    name: 'DEBUG_FILE',
    type: 'string',
    description: 'File path for debug log output',
    category: 'debug',
  },
  {
    name: 'DEBUG_JSON',
    type: 'boolean',
    default: 'false',
    description: 'Output debug logs as JSON',
    category: 'debug',
  },
  {
    name: 'DEBUG_TIMING',
    type: 'boolean',
    default: 'false',
    description: 'Include timing information in debug logs',
    category: 'debug',
  },
  {
    name: 'DEBUG_API',
    type: 'boolean',
    default: 'false',
    description: 'Log API request/response details',
    category: 'debug',
  },
  {
    name: 'DEBUG_TOOLS',
    type: 'boolean',
    default: 'false',
    description: 'Log tool execution details',
    category: 'debug',
  },
  {
    name: 'DEBUG_PROMPTS',
    type: 'boolean',
    default: 'false',
    description: 'Log full prompt content sent to LLM',
    category: 'debug',
  },

  // ---- Voice ----
  {
    name: 'PICOVOICE_ACCESS_KEY',
    type: 'string',
    description: 'Picovoice key for Porcupine wake word detection',
    sensitive: true,
    category: 'voice',
  },
  {
    name: 'VOSK_MODEL_PATH',
    type: 'string',
    default: '/usr/share/vosk/model',
    description: 'Path to Vosk speech recognition model',
    category: 'voice',
  },
  {
    name: 'WHISPER_CPP_PATH',
    type: 'string',
    default: 'whisper',
    description: 'Path to whisper.cpp binary',
    category: 'voice',
  },
  {
    name: 'WHISPER_MODEL_PATH',
    type: 'string',
    default: 'models/ggml-base.bin',
    description: 'Path to whisper model file',
    category: 'voice',
  },
  {
    name: 'DEEPGRAM_API_KEY',
    type: 'string',
    description: 'Deepgram speech-to-text API key',
    sensitive: true,
    category: 'voice',
  },

  // ---- Cache ----
  {
    name: 'CODEBUDDY_CACHE_DISABLED',
    type: 'boolean',
    default: 'false',
    description: 'Disable all caching',
    category: 'cache',
  },
  {
    name: 'CODEBUDDY_CACHE_DIR',
    type: 'string',
    description: 'Custom cache directory path',
    category: 'cache',
  },
  {
    name: 'CODEBUDDY_CACHE_MODE',
    type: 'string',
    description: 'Cache mode: performance or memory',
    category: 'cache',
    pattern: /^(performance|memory)$/,
  },
  {
    name: 'CODEBUDDY_AUTODETECT_LOCAL_LLAMA',
    type: 'boolean',
    default: 'false',
    description: 'Auto-detect local LLaMA/Ollama instances',
    category: 'cache',
  },

  // ---- Metrics ----
  {
    name: 'METRICS_CONSOLE',
    type: 'boolean',
    default: 'false',
    description: 'Export metrics to console',
    category: 'metrics',
  },
  {
    name: 'METRICS_FILE',
    type: 'boolean',
    default: 'false',
    description: 'Export metrics to a file',
    category: 'metrics',
  },
  {
    name: 'METRICS_PATH',
    type: 'string',
    description: 'File path for metrics export',
    category: 'metrics',
  },
  {
    name: 'METRICS_INTERVAL',
    type: 'number',
    default: '60000',
    description: 'Metrics export interval in milliseconds',
    category: 'metrics',
    min: 1000,
  },

  // ---- Display ----
  {
    name: 'NO_COLOR',
    type: 'boolean',
    default: 'false',
    description: 'Disable color output (standard NO_COLOR convention)',
    category: 'display',
  },
  {
    name: 'NO_EMOJI',
    type: 'boolean',
    default: 'false',
    description: 'Disable emoji in output',
    category: 'display',
  },
  {
    name: 'PREFERS_REDUCED_MOTION',
    type: 'boolean',
    default: 'false',
    description: 'Reduce animations in terminal UI',
    category: 'display',
  },
  {
    name: 'FORCE_HIGH_CONTRAST',
    type: 'boolean',
    default: 'false',
    description: 'Force high-contrast rendering',
    category: 'display',
  },
  {
    name: 'SCREEN_READER',
    type: 'boolean',
    default: 'false',
    description: 'Enable screen reader mode',
    category: 'display',
  },

  // ---- Git / CI ----
  {
    name: 'GITHUB_TOKEN',
    type: 'string',
    description: 'GitHub personal access token',
    sensitive: true,
    category: 'provider',
  },
  {
    name: 'GITLAB_TOKEN',
    type: 'string',
    description: 'GitLab personal access token',
    sensitive: true,
    category: 'provider',
  },

  // ---- Browser Automation ----
  {
    name: 'CHROME_REMOTE_DEBUGGING_PORT',
    type: 'number',
    description: 'Chrome DevTools Protocol port',
    category: 'debug',
    min: 1,
    max: 65535,
  },
  {
    name: 'CDP_URL',
    type: 'string',
    description: 'Chrome DevTools Protocol WebSocket URL',
    category: 'debug',
  },

  // ---- Node / Runtime (read but not owned by Code Buddy) ----
  {
    name: 'NODE_ENV',
    type: 'string',
    default: 'development',
    description: 'Node.js environment (development, production, test)',
    category: 'core',
    pattern: /^(development|production|test)$/,
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const schemaByName: Map<string, EnvVarDef> = new Map(
  ENV_SCHEMA.map(def => [def.name, def])
);

/**
 * Look up a single env var definition by name.
 */
export function getEnvDef(name: string): EnvVarDef | undefined {
  return schemaByName.get(name);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate the current `process.env` against the schema.
 *
 * - Required vars that are missing produce **errors**.
 * - Type mismatches and out-of-range values produce **warnings**.
 */
export function validateEnv(env: Record<string, string | undefined> = process.env): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const def of ENV_SCHEMA) {
    const raw = env[def.name];

    // Required check
    if (def.required && (raw === undefined || raw === '')) {
      errors.push(`${def.name} is required but not set. ${def.description}`);
      continue;
    }

    // Skip further checks if not set
    if (raw === undefined || raw === '') {
      continue;
    }

    // Type validation
    switch (def.type) {
      case 'number': {
        const num = Number(raw);
        if (isNaN(num)) {
          warnings.push(`${def.name} should be a number but got "${raw}"`);
        } else {
          if (def.min !== undefined && num < def.min) {
            warnings.push(`${def.name}=${raw} is below minimum ${def.min}`);
          }
          if (def.max !== undefined && num > def.max) {
            warnings.push(`${def.name}=${raw} is above maximum ${def.max}`);
          }
        }
        break;
      }
      case 'boolean': {
        if (!['true', 'false', '1', '0', ''].includes(raw.toLowerCase())) {
          warnings.push(`${def.name} should be a boolean (true/false) but got "${raw}"`);
        }
        break;
      }
      case 'string': {
        if (def.pattern && !def.pattern.test(raw)) {
          warnings.push(`${def.name}="${raw}" does not match expected pattern ${def.pattern}`);
        }
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Summary / CLI output
// ---------------------------------------------------------------------------

/**
 * Mask a sensitive value for display.
 * Shows first 4 chars and masks the rest, or just '****' if too short.
 */
export function maskValue(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return value.slice(0, 4) + '****' + value.slice(-4);
}

/**
 * Category display labels.
 */
const CATEGORY_LABELS: Record<EnvCategory, string> = {
  core: 'Core',
  provider: 'Provider API Keys',
  server: 'Server',
  security: 'Security',
  debug: 'Debug & Logging',
  voice: 'Voice & Speech',
  search: 'Search',
  cache: 'Cache',
  metrics: 'Metrics',
  display: 'Display & Accessibility',
};

/**
 * Generate a formatted summary of all environment variables for CLI output.
 */
export function getEnvSummary(env: Record<string, string | undefined> = process.env): string {
  const lines: string[] = [];
  const validation = validateEnv(env);

  lines.push('Code Buddy Environment Configuration');
  lines.push('='.repeat(50));

  // Group by category
  const grouped = new Map<EnvCategory, EnvVarDef[]>();
  for (const def of ENV_SCHEMA) {
    const list = grouped.get(def.category) || [];
    list.push(def);
    grouped.set(def.category, list);
  }

  // Ordered categories
  const categoryOrder: EnvCategory[] = [
    'core', 'provider', 'search', 'server', 'security',
    'debug', 'voice', 'cache', 'metrics', 'display',
  ];

  for (const cat of categoryOrder) {
    const defs = grouped.get(cat);
    if (!defs) continue;

    lines.push('');
    lines.push(`[${CATEGORY_LABELS[cat]}]`);

    for (const def of defs) {
      const raw = env[def.name];
      const isSet = raw !== undefined && raw !== '';
      let displayValue: string;

      if (!isSet) {
        displayValue = def.default !== undefined ? `(default: ${def.default})` : '(not set)';
      } else if (def.sensitive) {
        displayValue = maskValue(raw);
      } else {
        displayValue = raw;
      }

      const status = isSet ? '*' : ' ';
      const req = def.required ? ' [required]' : '';
      lines.push(`  ${status} ${def.name}=${displayValue}${req}`);
      lines.push(`    ${def.description}`);
    }
  }

  // Validation summary
  if (validation.errors.length > 0 || validation.warnings.length > 0) {
    lines.push('');
    lines.push('-'.repeat(50));

    if (validation.errors.length > 0) {
      lines.push('');
      lines.push('Errors:');
      for (const err of validation.errors) {
        lines.push(`  ! ${err}`);
      }
    }

    if (validation.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      for (const warn of validation.warnings) {
        lines.push(`  ? ${warn}`);
      }
    }
  }

  lines.push('');
  const setCount = ENV_SCHEMA.filter(d => {
    const v = env[d.name];
    return v !== undefined && v !== '';
  }).length;
  lines.push(`${setCount}/${ENV_SCHEMA.length} variables set`);
  lines.push(`Legend: * = set, [required] = must be configured`);

  return lines.join('\n');
}
