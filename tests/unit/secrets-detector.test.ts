/**
 * Tests for Secrets Detector
 *
 * Validates detection of hardcoded secrets across multiple pattern types.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  scanForSecrets,
  scanFileForSecrets,
  redactSecret,
  formatFindings,
  executeScanSecrets,
  type SecretFinding,
} from '../../src/security/secrets-detector.js';

const TEST_DIR = path.join(process.cwd(), '.test-secrets-detector');

function writeTestFile(name: string, content: string): string {
  const filePath = path.join(TEST_DIR, name);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('Secrets Detector', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  // ============================================================================
  // redactSecret
  // ============================================================================

  describe('redactSecret', () => {
    it('redacts secrets showing only first 4 chars', () => {
      expect(redactSecret('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA***');
    });

    it('returns **** for short values', () => {
      expect(redactSecret('abc')).toBe('****');
    });

    it('handles exact 4-char boundary', () => {
      expect(redactSecret('abcd')).toBe('****');
    });

    it('handles 5-char values', () => {
      expect(redactSecret('abcde')).toBe('abcd***');
    });
  });

  // ============================================================================
  // Pattern Detection
  // ============================================================================

  describe('AWS Key Detection', () => {
    it('detects AWS Access Key ID', async () => {
      const file = writeTestFile('aws.ts', 'const key = "AKIAIOSFODNN7EXAMPLE1";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'aws_key')).toBe(true);
      // Ensure match is redacted
      const awsFinding = findings.find(f => f.type === 'aws_key')!;
      expect(awsFinding.match).toBe('AKIA***');
    });

    it('detects AWS Secret Access Key near context', async () => {
      const file = writeTestFile('aws-secret.ts', 'const aws_secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'aws_secret')).toBe(true);
    });
  });

  describe('GitHub Token Detection', () => {
    it('detects GitHub personal access token (ghp_)', async () => {
      const file = writeTestFile('gh.ts', 'const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'github_token')).toBe(true);
      const ghFinding = findings.find(f => f.type === 'github_token')!;
      expect(ghFinding.match).toBe('ghp_***');
    });
  });

  describe('GitLab Token Detection', () => {
    it('detects GitLab personal access token', async () => {
      const file = writeTestFile('gl.ts', 'const token = "glpat-ABCDEFGHIJKLMNOPQRST";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'gitlab_token')).toBe(true);
    });
  });

  describe('Slack Token Detection', () => {
    it('detects Slack bot token', async () => {
      const file = writeTestFile('slack.ts', 'const token = "xoxb-1234567890-abcdefghij";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'slack_token')).toBe(true);
    });
  });

  describe('Stripe Key Detection', () => {
    it('detects Stripe live secret key', async () => {
      const file = writeTestFile('stripe.ts', `const key = "${'sk_' + 'live_' + 'ABCDEFGHIJKLMNOPQRSTUVWX'}yz";`);
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'stripe_key')).toBe(true);
    });
  });

  describe('Google API Key Detection', () => {
    it('detects Google API key', async () => {
      const file = writeTestFile('google.ts', 'const key = "AIzaSyC-ABCDEFGHIJKLMNOPQRSTUVWXYZ12345";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'google_api_key')).toBe(true);
    });
  });

  describe('JWT Detection', () => {
    it('detects JWT tokens', async () => {
      const file = writeTestFile('jwt.ts', 'const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'jwt_secret')).toBe(true);
    });
  });

  describe('Private Key Detection', () => {
    it('detects RSA private key header', async () => {
      const file = writeTestFile('key.ts', 'const key = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...`;');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'private_key')).toBe(true);
    });

    it('detects generic private key header', async () => {
      const file = writeTestFile('key2.ts', 'const key = "-----BEGIN PRIVATE KEY-----";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'private_key')).toBe(true);
    });
  });

  describe('Password Detection', () => {
    it('detects hardcoded passwords', async () => {
      const file = writeTestFile('pass.ts', 'const password = "SuperSecret123!";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'password_in_code')).toBe(true);
    });

    it('detects pwd assignments', async () => {
      const file = writeTestFile('pwd.py', "pwd = 'my_super_secret_password'");
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'password_in_code')).toBe(true);
    });
  });

  describe('Connection String Detection', () => {
    it('detects PostgreSQL connection strings', async () => {
      const file = writeTestFile('db.ts', 'const url = "postgres://user:pass@localhost:5432/mydb";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'connection_string')).toBe(true);
    });

    it('detects MongoDB connection strings', async () => {
      const file = writeTestFile('mongo.ts', 'const url = "mongodb://admin:secret@cluster.myhost.com/mydb";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'connection_string')).toBe(true);
    });
  });

  describe('Generic API Key Detection', () => {
    it('detects generic api_key assignments', async () => {
      const file = writeTestFile('api.ts', 'const api_key = "abcdefghijklmnopqrstuvwx";');
      const findings = scanFileForSecrets(file);
      expect(findings.some(f => f.type === 'generic_api_key')).toBe(true);
    });
  });

  // ============================================================================
  // Scan Options
  // ============================================================================

  describe('Scan Options', () => {
    it('skips binary files', async () => {
      writeTestFile('image.png', 'AKIAIOSFODNN7EXAMPLE1');
      const findings = await scanForSecrets(TEST_DIR);
      expect(findings.filter(f => f.filePath.endsWith('.png'))).toHaveLength(0);
    });

    it('skips node_modules directory', async () => {
      const file = writeTestFile('node_modules/pkg/index.ts', 'const key = "AKIAIOSFODNN7EXAMPLE1";');
      const findings = await scanForSecrets(TEST_DIR);
      expect(findings.filter(f => f.filePath === file)).toHaveLength(0);
    });

    it('respects custom exclude option', async () => {
      writeTestFile('vendor/lib.ts', 'const key = "AKIAIOSFODNN7EXAMPLE1";');
      writeTestFile('src/main.ts', 'const key = "AKIAIOSFODNN7EXAMPLE1";');
      const findings = await scanForSecrets(TEST_DIR, { exclude: ['src'] });
      expect(findings.some(f => f.filePath.includes('src'))).toBe(false);
    });

    it('returns empty for non-existent path', async () => {
      const findings = await scanForSecrets('/nonexistent/path/12345');
      expect(findings).toHaveLength(0);
    });
  });

  // ============================================================================
  // Formatting & Tool Execution
  // ============================================================================

  describe('formatFindings', () => {
    it('returns clean message for no findings', () => {
      expect(formatFindings([])).toBe('No secrets or credentials detected.');
    });

    it('groups findings by severity', () => {
      const findings: SecretFinding[] = [
        { filePath: 'a.ts', line: 1, column: 1, type: 'aws_key', severity: 'critical', match: 'AKIA***', description: 'AWS key', suggestion: 'Use env var' },
        { filePath: 'b.ts', line: 2, column: 1, type: 'password_in_code', severity: 'high', match: 'pass***', description: 'Password', suggestion: 'Use env var' },
      ];
      const output = formatFindings(findings);
      expect(output).toContain('CRITICAL (1)');
      expect(output).toContain('HIGH (1)');
    });
  });

  describe('executeScanSecrets', () => {
    it('returns success with formatted output', async () => {
      writeTestFile('scan-target.ts', 'const key = "AKIAIOSFODNN7EXAMPLE1";');
      const result = await executeScanSecrets({ path: TEST_DIR });
      expect(result.success).toBe(true);
      expect(result.output).toContain('aws_key');
    });

    it('returns success with clean message when no secrets found', async () => {
      writeTestFile('clean.ts', 'const x = 42;');
      const result = await executeScanSecrets({ path: TEST_DIR });
      expect(result.success).toBe(true);
      expect(result.output).toContain('No secrets');
    });
  });
});
