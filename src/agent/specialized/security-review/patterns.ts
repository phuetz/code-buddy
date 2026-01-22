/**
 * Security Review Patterns
 *
 * Security vulnerability detection patterns for the Security Review agent.
 */

import type { SecurityPattern } from './types.js';

// ============================================================================
// Secret Patterns
// ============================================================================

export const SECRET_PATTERNS: SecurityPattern[] = [
  {
    id: 'hardcoded-api-key',
    title: 'Hardcoded API Key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"`]([a-zA-Z0-9_-]{20,})['"`]/gi,
    severity: 'critical',
    category: 'secrets',
    description: 'API key hardcoded in source code',
    recommendation: 'Use environment variables or a secrets manager',
    cwe: 'CWE-798',
    owasp: 'A3:2017',
  },
  {
    id: 'hardcoded-password',
    title: 'Hardcoded Password',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"`]([^'"`]{6,})['"`]/gi,
    severity: 'critical',
    category: 'secrets',
    description: 'Password hardcoded in source code',
    recommendation: 'Use environment variables or a secrets manager',
    cwe: 'CWE-798',
    owasp: 'A3:2017',
  },
  {
    id: 'aws-access-key',
    title: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'critical',
    category: 'secrets',
    description: 'AWS Access Key ID found in code',
    recommendation: 'Use IAM roles or AWS Secrets Manager',
    cwe: 'CWE-798',
  },
  {
    id: 'aws-secret-key',
    title: 'AWS Secret Key',
    pattern: /(?:aws)?[_-]?(?:secret)?[_-]?(?:access)?[_-]?key\s*[:=]\s*['"`]([A-Za-z0-9/+=]{40})['"`]/gi,
    severity: 'critical',
    category: 'secrets',
    description: 'AWS Secret Access Key found in code',
    recommendation: 'Use IAM roles or AWS Secrets Manager',
    cwe: 'CWE-798',
  },
  {
    id: 'github-token',
    title: 'GitHub Token',
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    severity: 'critical',
    category: 'secrets',
    description: 'GitHub Personal Access Token found',
    recommendation: 'Use GitHub Actions secrets or environment variables',
    cwe: 'CWE-798',
  },
  {
    id: 'private-key',
    title: 'Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    severity: 'critical',
    category: 'secrets',
    description: 'Private key found in source code',
    recommendation: 'Store private keys in a secure key management system',
    cwe: 'CWE-321',
  },
  {
    id: 'jwt-secret',
    title: 'JWT Secret',
    pattern: /(?:jwt[_-]?secret|secret[_-]?key)\s*[:=]\s*['"`]([^'"`]{16,})['"`]/gi,
    severity: 'high',
    category: 'secrets',
    description: 'JWT secret hardcoded in code',
    recommendation: 'Use environment variables for JWT secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'database-connection',
    title: 'Database Connection String',
    pattern: /(?:mongodb|mysql|postgres|redis):\/\/[^:]+:[^@]+@[^\s]+/gi,
    severity: 'high',
    category: 'secrets',
    description: 'Database connection string with credentials',
    recommendation: 'Use environment variables for database credentials',
    cwe: 'CWE-798',
  },
];

// ============================================================================
// Injection Patterns
// ============================================================================

export const INJECTION_PATTERNS: SecurityPattern[] = [
  {
    id: 'sql-injection',
    title: 'Potential SQL Injection',
    pattern: /(?:query|execute|exec)\s*\(\s*[`'"].*\$\{.*\}.*[`'"]\s*\)/gi,
    severity: 'high',
    category: 'injection',
    description: 'String interpolation in SQL query',
    recommendation: 'Use parameterized queries or prepared statements',
    cwe: 'CWE-89',
    owasp: 'A1:2017',
    fileTypes: ['.ts', '.js', '.py', '.php', '.java'],
  },
  {
    id: 'sql-injection-concat',
    title: 'SQL Injection via Concatenation',
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*\+\s*(?:req\.|request\.|params\.|body\.)/gi,
    severity: 'high',
    category: 'injection',
    description: 'SQL query built with string concatenation',
    recommendation: 'Use parameterized queries',
    cwe: 'CWE-89',
    owasp: 'A1:2017',
  },
  {
    id: 'command-injection',
    title: 'Potential Command Injection',
    pattern: /(?:exec|spawn|system|popen)\s*\([^)]*\$\{.*\}[^)]*\)/gi,
    severity: 'critical',
    category: 'injection',
    description: 'User input in shell command',
    recommendation: 'Validate and sanitize input, use safe APIs',
    cwe: 'CWE-78',
    owasp: 'A1:2017',
  },
  {
    id: 'eval-injection',
    title: 'Dangerous eval() Usage',
    pattern: /eval\s*\(\s*(?:req\.|request\.|params\.|body\.|user)/gi,
    severity: 'critical',
    category: 'injection',
    description: 'User input passed to eval()',
    recommendation: 'Never use eval() with user input',
    cwe: 'CWE-94',
    owasp: 'A1:2017',
  },
  {
    id: 'xpath-injection',
    title: 'Potential XPath Injection',
    pattern: /xpath\s*\([^)]*\$\{.*\}[^)]*\)/gi,
    severity: 'high',
    category: 'injection',
    description: 'User input in XPath query',
    recommendation: 'Use parameterized XPath queries',
    cwe: 'CWE-643',
  },
  {
    id: 'ldap-injection',
    title: 'Potential LDAP Injection',
    pattern: /(?:ldap|search)\s*\([^)]*\$\{.*\}[^)]*\)/gi,
    severity: 'high',
    category: 'injection',
    description: 'User input in LDAP query',
    recommendation: 'Sanitize LDAP special characters',
    cwe: 'CWE-90',
  },
];

// ============================================================================
// XSS Patterns
// ============================================================================

export const XSS_PATTERNS: SecurityPattern[] = [
  {
    id: 'xss-innerhtml',
    title: 'Potential XSS via innerHTML',
    pattern: /\.innerHTML\s*=\s*(?:req\.|request\.|params\.|body\.|user)/gi,
    severity: 'high',
    category: 'xss',
    description: 'User input assigned to innerHTML',
    recommendation: 'Use textContent or sanitize HTML',
    cwe: 'CWE-79',
    owasp: 'A7:2017',
    fileTypes: ['.ts', '.tsx', '.js', '.jsx', '.html'],
  },
  {
    id: 'xss-document-write',
    title: 'Potential XSS via document.write',
    pattern: /document\.write\s*\([^)]*(?:req\.|request\.|params\.|body\.|user)/gi,
    severity: 'high',
    category: 'xss',
    description: 'User input in document.write()',
    recommendation: 'Avoid document.write(), use DOM methods',
    cwe: 'CWE-79',
    owasp: 'A7:2017',
  },
  {
    id: 'xss-dangerously-set',
    title: 'React dangerouslySetInnerHTML',
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:\s*(?:req\.|request\.|params\.|body\.|user|props\.)/gi,
    severity: 'high',
    category: 'xss',
    description: 'User input in dangerouslySetInnerHTML',
    recommendation: 'Sanitize HTML with DOMPurify before use',
    cwe: 'CWE-79',
    owasp: 'A7:2017',
    fileTypes: ['.tsx', '.jsx'],
  },
  {
    id: 'xss-href-javascript',
    title: 'JavaScript Protocol in href',
    pattern: /href\s*=\s*[`'"]javascript:/gi,
    severity: 'medium',
    category: 'xss',
    description: 'JavaScript protocol in href attribute',
    recommendation: 'Validate URL protocols',
    cwe: 'CWE-79',
  },
];

// ============================================================================
// Authentication Patterns
// ============================================================================

export const AUTH_PATTERNS: SecurityPattern[] = [
  {
    id: 'weak-password-hash',
    title: 'Weak Password Hashing',
    pattern: /(?:md5|sha1)\s*\(\s*(?:password|passwd|pwd)/gi,
    severity: 'high',
    category: 'authentication',
    description: 'Using weak hash algorithm for passwords',
    recommendation: 'Use bcrypt, scrypt, or Argon2 for password hashing',
    cwe: 'CWE-328',
    owasp: 'A3:2017',
  },
  {
    id: 'hardcoded-jwt-secret',
    title: 'Hardcoded JWT Secret',
    pattern: /jwt\.sign\s*\([^)]+,\s*['"`][^'"`]{8,}['"`]/gi,
    severity: 'high',
    category: 'authentication',
    description: 'JWT signed with hardcoded secret',
    recommendation: 'Use environment variable for JWT secret',
    cwe: 'CWE-798',
  },
  {
    id: 'session-no-httponly',
    title: 'Session Cookie Without HttpOnly',
    pattern: /(?:session|cookie).*httpOnly\s*:\s*false/gi,
    severity: 'medium',
    category: 'authentication',
    description: 'Session cookie without HttpOnly flag',
    recommendation: 'Set HttpOnly: true for session cookies',
    cwe: 'CWE-1004',
  },
  {
    id: 'session-no-secure',
    title: 'Session Cookie Without Secure Flag',
    pattern: /(?:session|cookie).*secure\s*:\s*false/gi,
    severity: 'medium',
    category: 'authentication',
    description: 'Session cookie without Secure flag',
    recommendation: 'Set Secure: true for session cookies in production',
    cwe: 'CWE-614',
  },
];

// ============================================================================
// Network Patterns
// ============================================================================

export const NETWORK_PATTERNS: SecurityPattern[] = [
  {
    id: 'http-insecure',
    title: 'Insecure HTTP Connection',
    pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/gi,
    severity: 'medium',
    category: 'network',
    description: 'Using HTTP instead of HTTPS',
    recommendation: 'Use HTTPS for all connections',
    cwe: 'CWE-319',
  },
  {
    id: 'ssl-verify-disabled',
    title: 'SSL Verification Disabled',
    pattern: /(?:rejectUnauthorized|verify_ssl|ssl_verify)\s*[:=]\s*false/gi,
    severity: 'high',
    category: 'network',
    description: 'SSL certificate verification disabled',
    recommendation: 'Enable SSL verification in production',
    cwe: 'CWE-295',
  },
  {
    id: 'cors-allow-all',
    title: 'CORS Allow All Origins',
    pattern: /(?:Access-Control-Allow-Origin|cors)\s*[:=]?\s*['"]\*['"]/gi,
    severity: 'medium',
    category: 'network',
    description: 'CORS allows all origins',
    recommendation: 'Restrict CORS to trusted origins',
    cwe: 'CWE-942',
  },
];

// ============================================================================
// Combined Patterns
// ============================================================================

export const ALL_PATTERNS: SecurityPattern[] = [
  ...SECRET_PATTERNS,
  ...INJECTION_PATTERNS,
  ...XSS_PATTERNS,
  ...AUTH_PATTERNS,
  ...NETWORK_PATTERNS,
];
