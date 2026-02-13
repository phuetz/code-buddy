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
    default: 'grok-3-fast-latest',
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
    name: 'GROK_HOME',
    type: 'string',
    description: 'Custom home directory for Code Buddy config/data',
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
