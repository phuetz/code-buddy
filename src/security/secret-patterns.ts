/**
 * Secret Patterns — single source of truth for known credential/token shapes.
 *
 * Kept as a dependency-free LEAF module (imports nothing) on purpose: both the
 * static scanner (`secrets-detector.ts`, which imports the logger) and the
 * runtime scrubber (`secret-scrubber.ts`, imported BY the logger) reuse these
 * regexes. Housing them here keeps the logger → scrubber → patterns edge
 * acyclic — no `utils/logger` in the transitive closure.
 */

export type SecretType =
  | 'aws_key' | 'aws_secret' | 'github_token' | 'gitlab_token'
  | 'slack_token' | 'stripe_key' | 'google_api_key' | 'jwt_secret'
  | 'private_key' | 'password_in_code' | 'connection_string'
  | 'anthropic_key' | 'openai_key' | 'xai_key'
  | 'generic_api_key' | 'generic_secret';

export interface SecretPattern {
  type: SecretType;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  suggestion: string;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // AWS Access Key ID
  {
    type: 'aws_key',
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: 'critical',
    description: 'AWS Access Key ID detected',
    suggestion: 'Use environment variable AWS_ACCESS_KEY_ID or AWS IAM roles instead',
  },
  // AWS Secret Access Key (near aws_secret context)
  {
    type: 'aws_secret',
    pattern: /(?:aws_secret|aws_secret_access_key|AWS_SECRET)\s*[:=]\s*['"]?([0-9a-zA-Z/+]{40})['"]?/i,
    severity: 'critical',
    description: 'AWS Secret Access Key detected',
    suggestion: 'Use environment variable AWS_SECRET_ACCESS_KEY or AWS IAM roles instead',
  },
  // GitHub Personal Access Token
  {
    type: 'github_token',
    pattern: /ghp_[a-zA-Z0-9]{36}/,
    severity: 'critical',
    description: 'GitHub Personal Access Token detected',
    suggestion: 'Use environment variable GITHUB_TOKEN or GitHub Actions secrets',
  },
  // GitHub Fine-grained PAT
  {
    type: 'github_token',
    pattern: /github_pat_[a-zA-Z0-9_]{82}/,
    severity: 'critical',
    description: 'GitHub Fine-grained Personal Access Token detected',
    suggestion: 'Use environment variable GITHUB_TOKEN or GitHub Actions secrets',
  },
  // GitLab Personal Access Token
  {
    type: 'gitlab_token',
    pattern: /glpat-[a-zA-Z0-9-]{20}/,
    severity: 'critical',
    description: 'GitLab Personal Access Token detected',
    suggestion: 'Use environment variable GITLAB_TOKEN or CI/CD variables',
  },
  // Slack Token
  {
    type: 'slack_token',
    pattern: /xox[bpors]-[a-zA-Z0-9-]+/,
    severity: 'critical',
    description: 'Slack API token detected',
    suggestion: 'Use environment variable SLACK_TOKEN or Slack app configuration',
  },
  // Stripe Secret Key
  {
    type: 'stripe_key',
    pattern: /sk_live_[a-zA-Z0-9]{24,}/,
    severity: 'critical',
    description: 'Stripe live secret key detected',
    suggestion: 'Use environment variable STRIPE_SECRET_KEY',
  },
  // Google API Key
  {
    type: 'google_api_key',
    pattern: /AIza[0-9A-Za-z\-_]{35}/,
    severity: 'high',
    description: 'Google API key detected',
    suggestion: 'Use environment variable GOOGLE_API_KEY and restrict key in Google Cloud Console',
  },
  // SECAUDIT 2026-09-05: the LLM provider keys Code Buddy uses most were absent
  // from the scanner (they lived only in the runtime scrubber). The boundary
  // look-behind keeps ordinary hyphenated words ("risk-management") from matching.
  // Anthropic API key — sk-ant-… (more specific, listed before generic sk-)
  {
    type: 'anthropic_key',
    pattern: /(?<![A-Za-z0-9-])sk-ant-[A-Za-z0-9_-]{20,}/,
    severity: 'critical',
    description: 'Anthropic API key detected',
    suggestion: 'Use environment variable ANTHROPIC_API_KEY',
  },
  // OpenAI project key — sk-proj-…
  {
    type: 'openai_key',
    pattern: /(?<![A-Za-z0-9-])sk-proj-[A-Za-z0-9_-]{20,}/,
    severity: 'critical',
    description: 'OpenAI project API key detected',
    suggestion: 'Use environment variable OPENAI_API_KEY',
  },
  // OpenAI legacy key — sk-… (generic; after the more specific sk-ant-/sk-proj-)
  {
    type: 'openai_key',
    pattern: /(?<![A-Za-z0-9-])sk-[A-Za-z0-9]{20,}/,
    severity: 'critical',
    description: 'OpenAI API key detected',
    suggestion: 'Use environment variable OPENAI_API_KEY',
  },
  // xAI (Grok) key — xai-…
  {
    type: 'xai_key',
    pattern: /(?<![A-Za-z0-9-])xai-[A-Za-z0-9_-]{20,}/,
    severity: 'critical',
    description: 'xAI (Grok) API key detected',
    suggestion: 'Use environment variable GROK_API_KEY / XAI_API_KEY',
  },
  // JWT Token
  {
    type: 'jwt_secret',
    pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
    severity: 'high',
    description: 'JSON Web Token (JWT) detected in source code',
    suggestion: 'Do not hardcode JWTs — use runtime token generation',
  },
  // Private Key
  {
    type: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: 'critical',
    description: 'Private key detected in source code',
    suggestion: 'Store private keys in secure key management (Vault, KMS) or as environment variables',
  },
  // Password in code
  {
    type: 'password_in_code',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: 'high',
    description: 'Hardcoded password detected',
    suggestion: 'Use environment variable or secrets manager instead of hardcoding passwords',
  },
  // Connection strings
  {
    type: 'connection_string',
    pattern: /(?:mysql|postgres|postgresql|mongodb|redis):\/\/[^\s'"]+/i,
    severity: 'high',
    description: 'Database connection string with potential credentials detected',
    suggestion: 'Use environment variable DATABASE_URL or a secrets manager',
  },
  // Generic API key assignment
  {
    type: 'generic_api_key',
    pattern: /(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9]{16,}['"]/i,
    severity: 'medium',
    description: 'Potential API key or secret detected',
    suggestion: 'Use environment variables instead of hardcoding API keys',
  },
];
