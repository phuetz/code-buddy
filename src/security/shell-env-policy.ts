/**
 * Shell Environment Policy — Codex-inspired subprocess env control
 *
 * Controls which environment variables are passed to every subprocess
 * the agent spawns. Prevents accidental leakage of API keys and
 * credentials to untrusted subprocess environments.
 *
 * Config (via [shell_env] in .codebuddy/config.toml):
 *
 *   [shell_env]
 *   inherit = "all"          # all | core | none
 *   exclude = ["*SECRET*", "*TOKEN*", "*KEY*", "*PASSWORD*"]
 *   include_only = []        # if set, only these vars pass (overrides exclude)
 *   # set = { NODE_ENV = "production" }  # always-injected overrides
 *
 * Defaults strip variables matching common credential patterns while
 * preserving PATH, HOME, USER, SHELL, TERM, LANG, etc.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/** Baseline inheritance mode */
export type EnvInheritMode = 'all' | 'core' | 'none';

export interface ShellEnvPolicyConfig {
  /** How many env vars to start with */
  inherit?: EnvInheritMode;
  /** Glob-style patterns to strip from inherited env */
  exclude?: string[];
  /** If non-empty, ONLY these vars are passed (overrides exclude) */
  include_only?: string[];
  /** Key/value pairs always injected into every subprocess env */
  set?: Record<string, string>;
}

// ============================================================================
// Core variable sets
// ============================================================================

/** Always-safe variables for 'core' mode */
const CORE_VARS = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TERM_PROGRAM',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
  'PWD', 'OLDPWD', 'SHLVL', 'COLORTERM', 'CLICOLOR',
  // Node.js / npm
  'NODE_ENV', 'NODE_PATH', 'NPM_CONFIG_PREFIX',
  // Common CI vars (non-sensitive)
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI',
]);

/** Default exclusion glob patterns (credential-like names) */
const DEFAULT_EXCLUDE_PATTERNS = [
  '*_KEY', '*_SECRET', '*_TOKEN', '*_PASSWORD', '*_PASSWD',
  '*_CREDENTIAL', '*_CREDENTIALS', '*_CERT', '*_PRIVATE*',
  'AWS_*', 'OPENAI_*', 'ANTHROPIC_*', 'GOOGLE_*API*',
  'GROK_API*', 'MORPH_API*', 'EXA_API*', 'BRAVE_API*',
  'PERPLEXITY_API*', 'OPENROUTER_API*', 'PICOVOICE_*',
  'DATABASE_URL', 'MONGO_*', 'REDIS_*', 'POSTGRES_*', 'MYSQL_*',
  'JWT_SECRET', 'SESSION_SECRET', 'COOKIE_SECRET',
  'SLACK_*TOKEN*', 'TELEGRAM_*TOKEN*', 'DISCORD_*TOKEN*',
  'STRIPE_*', 'TWILIO_*', 'SENDGRID_*',
];

// ============================================================================
// Glob-style pattern matching (lightweight, no deps)
// ============================================================================

function globMatch(pattern: string, str: string): boolean {
  // Convert glob to regex: * → [^_]* within a word segment, handle leading/trailing *
  const regexStr = pattern
    .toUpperCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${regexStr}$`).test(str.toUpperCase());
  } catch {
    return false;
  }
}

function matchesAny(patterns: string[], key: string): boolean {
  return patterns.some(p => globMatch(p, key));
}

// ============================================================================
// ShellEnvPolicy
// ============================================================================

export class ShellEnvPolicy {
  private config: Required<ShellEnvPolicyConfig>;

  constructor(config: ShellEnvPolicyConfig = {}) {
    this.config = {
      inherit: config.inherit ?? 'all',
      exclude: config.exclude ?? DEFAULT_EXCLUDE_PATTERNS,
      include_only: config.include_only ?? [],
      set: config.set ?? {},
    };
  }

  /**
   * Build a filtered environment object for subprocess spawning.
   * Returns a new object — never mutates process.env.
   */
  buildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    let env: NodeJS.ProcessEnv = {};

    // Step 1: baseline from inherit mode
    if (this.config.inherit === 'all') {
      env = { ...source };
    } else if (this.config.inherit === 'core') {
      for (const key of Object.keys(source)) {
        if (CORE_VARS.has(key)) {
          env[key] = source[key];
        }
      }
    }
    // 'none' starts with empty {}

    // Step 2: apply include_only whitelist (takes priority over exclude)
    if (this.config.include_only.length > 0) {
      const whitelisted: NodeJS.ProcessEnv = {};
      for (const key of Object.keys(env)) {
        if (matchesAny(this.config.include_only, key)) {
          whitelisted[key] = env[key];
        }
      }
      env = whitelisted;
    } else {
      // Step 3: apply exclude patterns
      for (const key of Object.keys(env)) {
        if (matchesAny(this.config.exclude, key)) {
          delete env[key];
          logger.debug(`ShellEnvPolicy: stripped env var ${key}`);
        }
      }
    }

    // Step 4: inject forced overrides
    for (const [key, value] of Object.entries(this.config.set)) {
      env[key] = value;
    }

    return env;
  }

  /**
   * Check if a specific env var would be passed through.
   */
  wouldPass(key: string): boolean {
    const built = this.buildEnv({ [key]: 'test' });
    return key in built;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _policy: ShellEnvPolicy | null = null;

export function getShellEnvPolicy(config?: ShellEnvPolicyConfig): ShellEnvPolicy {
  if (!_policy) {
    _policy = new ShellEnvPolicy(config);
  }
  return _policy;
}

export function resetShellEnvPolicy(): void {
  _policy = null;
}
