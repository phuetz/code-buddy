/**
 * Data Redaction Engine
 *
 * Automatically detects and masks sensitive data in outputs:
 * - API keys and tokens
 * - Passwords and secrets
 * - Private keys and certificates
 * - Environment variables with sensitive values
 * - Credit card numbers, SSNs, etc.
 *
 * Inspired by VibeKit's auto-redaction feature.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface RedactionPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  category: RedactionCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export type RedactionCategory =
  | 'api_key'
  | 'token'
  | 'password'
  | 'private_key'
  | 'certificate'
  | 'env_var'
  | 'pii'
  | 'financial'
  | 'connection_string'
  | 'custom';

export interface RedactionResult {
  original: string;
  redacted: string;
  redactions: RedactionMatch[];
  stats: RedactionStats;
}

export interface RedactionMatch {
  pattern: string;
  category: RedactionCategory;
  severity: string;
  position: { start: number; end: number };
  preview: string; // First/last chars for debugging
}

export interface RedactionStats {
  totalRedactions: number;
  byCategory: Record<RedactionCategory, number>;
  bySeverity: Record<string, number>;
}

export interface RedactionConfig {
  enabled: boolean;
  patterns: RedactionPattern[];
  customPatterns: RedactionPattern[];
  whitelist: string[];
  entropyThreshold: number;
  minSecretLength: number;
  maxSecretLength: number;
  logRedactions: boolean;
  preserveFormat: boolean;
}

// ============================================================================
// Default Patterns
// ============================================================================

const DEFAULT_PATTERNS: RedactionPattern[] = [
  // API Keys - Generic
  {
    name: 'Generic API Key',
    pattern: /(?:api[_-]?key|apikey|api_secret|apisecret)[\s]*[=:]["']?\s*([a-zA-Z0-9_\-]{20,})/gi,
    replacement: '[REDACTED:API_KEY]',
    category: 'api_key',
    severity: 'critical',
  },

  // OpenAI
  {
    name: 'OpenAI API Key',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: '[REDACTED:OPENAI_KEY]',
    category: 'api_key',
    severity: 'critical',
  },

  // Anthropic
  {
    name: 'Anthropic API Key',
    pattern: /sk-ant-[a-zA-Z0-9\-]{20,}/g,
    replacement: '[REDACTED:ANTHROPIC_KEY]',
    category: 'api_key',
    severity: 'critical',
  },

  // xAI/Grok
  {
    name: 'xAI API Key',
    pattern: /xai-[a-zA-Z0-9]{20,}/g,
    replacement: '[REDACTED:XAI_KEY]',
    category: 'api_key',
    severity: 'critical',
  },

  // Google
  {
    name: 'Google API Key',
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
    replacement: '[REDACTED:GOOGLE_KEY]',
    category: 'api_key',
    severity: 'critical',
  },

  // AWS
  {
    name: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED:AWS_ACCESS_KEY]',
    category: 'api_key',
    severity: 'critical',
  },
  {
    name: 'AWS Secret Key',
    pattern: /(?:aws_secret_access_key|aws_secret)[\s]*[=:]["']?\s*([a-zA-Z0-9+/]{40})/gi,
    replacement: '[REDACTED:AWS_SECRET]',
    category: 'api_key',
    severity: 'critical',
  },

  // GitHub
  {
    name: 'GitHub Token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    replacement: '[REDACTED:GITHUB_TOKEN]',
    category: 'token',
    severity: 'critical',
  },
  {
    name: 'GitHub Personal Access Token (Classic)',
    pattern: /ghp_[A-Za-z0-9]{36}/g,
    replacement: '[REDACTED:GITHUB_PAT]',
    category: 'token',
    severity: 'critical',
  },

  // Stripe
  {
    name: 'Stripe API Key',
    pattern: /sk_live_[a-zA-Z0-9]{24,}/g,
    replacement: '[REDACTED:STRIPE_KEY]',
    category: 'api_key',
    severity: 'critical',
  },
  {
    name: 'Stripe Test Key',
    pattern: /sk_test_[a-zA-Z0-9]{24,}/g,
    replacement: '[REDACTED:STRIPE_TEST_KEY]',
    category: 'api_key',
    severity: 'high',
  },

  // Slack
  {
    name: 'Slack Token',
    pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
    replacement: '[REDACTED:SLACK_TOKEN]',
    category: 'token',
    severity: 'critical',
  },

  // Discord
  {
    name: 'Discord Token',
    pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/g,
    replacement: '[REDACTED:DISCORD_TOKEN]',
    category: 'token',
    severity: 'critical',
  },

  // JWT Tokens
  {
    name: 'JWT Token',
    pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*/g,
    replacement: '[REDACTED:JWT]',
    category: 'token',
    severity: 'high',
  },

  // Private Keys
  {
    name: 'RSA Private Key',
    pattern: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g,
    replacement: '[REDACTED:RSA_PRIVATE_KEY]',
    category: 'private_key',
    severity: 'critical',
  },
  {
    name: 'EC Private Key',
    pattern: /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g,
    replacement: '[REDACTED:EC_PRIVATE_KEY]',
    category: 'private_key',
    severity: 'critical',
  },
  {
    name: 'Generic Private Key',
    pattern: /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:ENCRYPTED )?PRIVATE KEY-----/g,
    replacement: '[REDACTED:PRIVATE_KEY]',
    category: 'private_key',
    severity: 'critical',
  },
  {
    name: 'SSH Private Key',
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
    replacement: '[REDACTED:SSH_PRIVATE_KEY]',
    category: 'private_key',
    severity: 'critical',
  },

  // Database Connection Strings
  {
    name: 'PostgreSQL Connection String',
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^\s]+/gi,
    replacement: '[REDACTED:POSTGRES_URL]',
    category: 'connection_string',
    severity: 'critical',
  },
  {
    name: 'MySQL Connection String',
    pattern: /mysql:\/\/[^:]+:[^@]+@[^\s]+/gi,
    replacement: '[REDACTED:MYSQL_URL]',
    category: 'connection_string',
    severity: 'critical',
  },
  {
    name: 'MongoDB Connection String',
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^\s]+/gi,
    replacement: '[REDACTED:MONGODB_URL]',
    category: 'connection_string',
    severity: 'critical',
  },
  {
    name: 'Redis Connection String',
    pattern: /redis:\/\/[^:]*:[^@]+@[^\s]+/gi,
    replacement: '[REDACTED:REDIS_URL]',
    category: 'connection_string',
    severity: 'critical',
  },

  // Environment Variable Patterns
  {
    name: 'Secret Env Var',
    pattern: /(?:SECRET|PASSWORD|PASSWD|PWD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|AUTH)[\s]*[=:][\s]*["']?([^\s"']{8,})["']?/gi,
    replacement: '[REDACTED:ENV_SECRET]',
    category: 'env_var',
    severity: 'high',
  },

  // Passwords in URLs
  {
    name: 'Password in URL',
    pattern: /:\/\/[^:]+:([^@]{8,})@/g,
    replacement: '://[user]:[REDACTED:PASSWORD]@',
    category: 'password',
    severity: 'critical',
  },

  // Basic Auth Headers
  {
    name: 'Basic Auth Header',
    pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/gi,
    replacement: 'Basic [REDACTED:AUTH]',
    category: 'token',
    severity: 'high',
  },
  {
    name: 'Bearer Token',
    pattern: /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi,
    replacement: 'Bearer [REDACTED:TOKEN]',
    category: 'token',
    severity: 'high',
  },

  // PII - Credit Cards
  {
    name: 'Credit Card Number',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    replacement: '[REDACTED:CREDIT_CARD]',
    category: 'financial',
    severity: 'critical',
  },

  // PII - SSN
  {
    name: 'Social Security Number',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[REDACTED:SSN]',
    category: 'pii',
    severity: 'critical',
  },

  // NPM Tokens
  {
    name: 'NPM Token',
    pattern: /npm_[A-Za-z0-9]{36}/g,
    replacement: '[REDACTED:NPM_TOKEN]',
    category: 'token',
    severity: 'critical',
  },

  // Heroku
  {
    name: 'Heroku API Key',
    pattern: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
    replacement: '[REDACTED:UUID_KEY]',
    category: 'api_key',
    severity: 'medium',
  },

  // SendGrid
  {
    name: 'SendGrid API Key',
    pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g,
    replacement: '[REDACTED:SENDGRID_KEY]',
    category: 'api_key',
    severity: 'critical',
  },

  // Twilio
  {
    name: 'Twilio API Key',
    pattern: /SK[a-fA-F0-9]{32}/g,
    replacement: '[REDACTED:TWILIO_KEY]',
    category: 'api_key',
    severity: 'critical',
  },
];

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RedactionConfig = {
  enabled: true,
  patterns: DEFAULT_PATTERNS,
  customPatterns: [],
  whitelist: [],
  entropyThreshold: 4.5, // Shannon entropy threshold for high-entropy strings
  minSecretLength: 16,
  maxSecretLength: 500,
  logRedactions: false,
  preserveFormat: true,
};

// ============================================================================
// Data Redaction Engine
// ============================================================================

export class DataRedactionEngine extends EventEmitter {
  private config: RedactionConfig;
  private redactionLog: RedactionMatch[] = [];

  constructor(config: Partial<RedactionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Redact sensitive data from text
   */
  redact(text: string): RedactionResult {
    if (!this.config.enabled || !text) {
      return {
        original: text,
        redacted: text,
        redactions: [],
        stats: this.createEmptyStats(),
      };
    }

    const redactions: RedactionMatch[] = [];
    let redactedText = text;
    const allPatterns = [...this.config.patterns, ...this.config.customPatterns];

    // Apply each pattern
    for (const pattern of allPatterns) {
      const matches = text.matchAll(new RegExp(pattern.pattern.source, pattern.pattern.flags));

      for (const match of matches) {
        if (match.index === undefined) continue;

        const matchedText = match[0];

        // Check whitelist
        if (this.isWhitelisted(matchedText)) continue;

        // Create redaction match
        const redactionMatch: RedactionMatch = {
          pattern: pattern.name,
          category: pattern.category,
          severity: pattern.severity,
          position: { start: match.index, end: match.index + matchedText.length },
          preview: this.createPreview(matchedText),
        };

        redactions.push(redactionMatch);

        // Apply redaction
        redactedText = redactedText.replace(matchedText, pattern.replacement);
      }
    }

    // Check for high-entropy strings (potential secrets not caught by patterns)
    redactedText = this.redactHighEntropyStrings(redactedText, redactions);

    // Log if enabled
    if (this.config.logRedactions && redactions.length > 0) {
      this.redactionLog.push(...redactions);
      this.emit('redaction', { count: redactions.length, redactions });
    }

    const stats = this.calculateStats(redactions);

    return {
      original: text,
      redacted: redactedText,
      redactions,
      stats,
    };
  }

  /**
   * Redact an object recursively
   */
  redactObject<T extends object>(obj: T): T {
    if (!this.config.enabled) return obj;

    const redactValue = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return this.redact(value).redacted;
      }
      if (Array.isArray(value)) {
        return value.map(redactValue);
      }
      if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value)) {
          // Redact keys that look like secrets
          if (this.isSecretKey(key)) {
            result[key] = '[REDACTED]';
          } else {
            result[key] = redactValue(val);
          }
        }
        return result;
      }
      return value;
    };

    return redactValue(obj) as T;
  }

  /**
   * Check if a string is in the whitelist
   */
  private isWhitelisted(text: string): boolean {
    return this.config.whitelist.some(w =>
      text.toLowerCase().includes(w.toLowerCase())
    );
  }

  /**
   * Check if a key name suggests it contains secrets
   */
  private isSecretKey(key: string): boolean {
    const secretKeyPatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /api[_-]?key/i,
      /private[_-]?key/i,
      /auth/i,
      /credential/i,
    ];
    return secretKeyPatterns.some(p => p.test(key));
  }

  /**
   * Create a preview of matched text (first/last chars)
   */
  private createPreview(text: string): string {
    if (text.length <= 8) return '***';
    return `${text.slice(0, 3)}...${text.slice(-3)}`;
  }

  /**
   * Calculate Shannon entropy of a string
   */
  private calculateEntropy(str: string): number {
    const len = str.length;
    if (len === 0) return 0;

    const freq: Record<string, number> = {};
    for (const char of str) {
      freq[char] = (freq[char] || 0) + 1;
    }

    let entropy = 0;
    for (const count of Object.values(freq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Redact high-entropy strings that might be secrets
   */
  private redactHighEntropyStrings(text: string, redactions: RedactionMatch[]): string {
    // Find potential secrets (alphanumeric strings of certain length)
    const potentialSecrets = text.match(/[a-zA-Z0-9_\-]{16,64}/g) || [];

    let result = text;
    for (const potential of potentialSecrets) {
      // Skip if already redacted
      if (potential.includes('[REDACTED')) continue;

      // Check entropy
      const entropy = this.calculateEntropy(potential);
      if (entropy >= this.config.entropyThreshold) {
        // High entropy string - likely a secret
        const replacement = '[REDACTED:HIGH_ENTROPY]';
        result = result.replace(potential, replacement);

        redactions.push({
          pattern: 'High Entropy String',
          category: 'custom',
          severity: 'medium',
          position: { start: text.indexOf(potential), end: text.indexOf(potential) + potential.length },
          preview: this.createPreview(potential),
        });
      }
    }

    return result;
  }

  /**
   * Calculate redaction statistics
   */
  private calculateStats(redactions: RedactionMatch[]): RedactionStats {
    const byCategory: Record<RedactionCategory, number> = {
      api_key: 0,
      token: 0,
      password: 0,
      private_key: 0,
      certificate: 0,
      env_var: 0,
      pii: 0,
      financial: 0,
      connection_string: 0,
      custom: 0,
    };

    const bySeverity: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const r of redactions) {
      byCategory[r.category]++;
      bySeverity[r.severity]++;
    }

    return {
      totalRedactions: redactions.length,
      byCategory,
      bySeverity,
    };
  }

  /**
   * Create empty stats object
   */
  private createEmptyStats(): RedactionStats {
    return {
      totalRedactions: 0,
      byCategory: {
        api_key: 0,
        token: 0,
        password: 0,
        private_key: 0,
        certificate: 0,
        env_var: 0,
        pii: 0,
        financial: 0,
        connection_string: 0,
        custom: 0,
      },
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
    };
  }

  /**
   * Add a custom redaction pattern
   */
  addPattern(pattern: RedactionPattern): void {
    this.config.customPatterns.push(pattern);
  }

  /**
   * Add to whitelist
   */
  addToWhitelist(value: string): void {
    if (!this.config.whitelist.includes(value)) {
      this.config.whitelist.push(value);
    }
  }

  /**
   * Get redaction log
   */
  getRedactionLog(): RedactionMatch[] {
    return [...this.redactionLog];
  }

  /**
   * Clear redaction log
   */
  clearLog(): void {
    this.redactionLog = [];
  }

  /**
   * Enable/disable redaction
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get configuration
   */
  getConfig(): RedactionConfig {
    return { ...this.config };
  }

  /**
   * Generate a hash for a secret (for logging without exposing)
   */
  hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8);
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.redactionLog = [];
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let redactionEngineInstance: DataRedactionEngine | null = null;

export function getDataRedactionEngine(config?: Partial<RedactionConfig>): DataRedactionEngine {
  if (!redactionEngineInstance) {
    redactionEngineInstance = new DataRedactionEngine(config);
  }
  return redactionEngineInstance;
}

export function resetDataRedactionEngine(): void {
  if (redactionEngineInstance) {
    redactionEngineInstance.dispose();
  }
  redactionEngineInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick redact function for simple use cases
 */
export function redactSecrets(text: string): string {
  return getDataRedactionEngine().redact(text).redacted;
}

/**
 * Check if text contains potential secrets
 */
export function containsSecrets(text: string): boolean {
  const result = getDataRedactionEngine().redact(text);
  return result.redactions.length > 0;
}
