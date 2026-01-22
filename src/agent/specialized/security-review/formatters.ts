/**
 * Security Review Formatters
 *
 * Report formatting functions for the Security Review agent.
 */

import type { SecurityScanResult, SecurityFinding } from './types.js';
import { ALL_PATTERNS } from './patterns.js';

// ============================================================================
// Text Formatter
// ============================================================================

export function formatAsText(result: SecurityScanResult): string {
  const lines: string[] = [
    '='.repeat(60),
    'SECURITY SCAN REPORT',
    '='.repeat(60),
    '',
    `Scan Duration: ${result.data?.scanDuration || 0}ms`,
    `Files Scanned: ${result.data?.filesScanned || 0}`,
    '',
    'SUMMARY',
    '-'.repeat(30),
    `Critical: ${result.summary?.critical || 0}`,
    `High: ${result.summary?.high || 0}`,
    `Medium: ${result.summary?.medium || 0}`,
    `Low: ${result.summary?.low || 0}`,
    `Info: ${result.summary?.info || 0}`,
    `Total: ${result.summary?.total || 0}`,
    '',
  ];

  if (result.findings && result.findings.length > 0) {
    lines.push('FINDINGS', '-'.repeat(30));
    for (const finding of result.findings) {
      lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
      if (finding.file) {
        lines.push(`  File: ${finding.file}:${finding.line || ''}`);
      }
      lines.push(`  ${finding.description}`);
      if (finding.recommendation) {
        lines.push(`  Fix: ${finding.recommendation}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Markdown Formatter
// ============================================================================

export function formatAsMarkdown(result: SecurityScanResult): string {
  const lines: string[] = [
    '# Security Scan Report',
    '',
    '## Summary',
    '',
    '| Severity | Count |',
    '|----------|-------|',
    `| Critical | ${result.summary?.critical || 0} |`,
    `| High | ${result.summary?.high || 0} |`,
    `| Medium | ${result.summary?.medium || 0} |`,
    `| Low | ${result.summary?.low || 0} |`,
    `| Info | ${result.summary?.info || 0} |`,
    '',
    `**Total Findings:** ${result.summary?.total || 0}`,
    '',
  ];

  if (result.findings && result.findings.length > 0) {
    lines.push('## Findings', '');
    for (const finding of result.findings) {
      lines.push(`### ${finding.title}`);
      lines.push('');
      lines.push(`**Severity:** ${finding.severity}`);
      if (finding.file) {
        lines.push(`**Location:** \`${finding.file}:${finding.line || ''}\``);
      }
      lines.push('');
      lines.push(finding.description);
      if (finding.recommendation) {
        lines.push('');
        lines.push(`**Recommendation:** ${finding.recommendation}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================================
// SARIF Formatter
// ============================================================================

export function formatAsSarif(result: SecurityScanResult): string {
  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Grok Security Review',
          version: '1.0.0',
          informationUri: 'https://github.com/code-buddy',
          rules: ALL_PATTERNS.map(p => ({
            id: p.id,
            name: p.title,
            shortDescription: { text: p.description },
            help: { text: p.recommendation },
            defaultConfiguration: {
              level: p.severity === 'critical' || p.severity === 'high' ? 'error' : 'warning',
            },
          })),
        },
      },
      results: (result.findings || []).map(f => ({
        ruleId: f.id.split('-').slice(0, -2).join('-'),
        level: f.severity === 'critical' || f.severity === 'high' ? 'error' : 'warning',
        message: { text: f.description },
        locations: f.file ? [{
          physicalLocation: {
            artifactLocation: { uri: f.file },
            region: { startLine: f.line || 1 },
          },
        }] : [],
      })),
    }],
  };

  return JSON.stringify(sarif, null, 2);
}

// ============================================================================
// Recommendations Generator
// ============================================================================

export function generateRecommendations(findings: SecurityFinding[]): string[] {
  const recs: string[] = [];
  const categories = new Set(findings.map(f => f.category));

  if (categories.has('secrets')) {
    recs.push('Use a secrets manager (AWS Secrets Manager, HashiCorp Vault) for credentials');
    recs.push('Implement pre-commit hooks to prevent secrets from being committed');
  }

  if (categories.has('injection')) {
    recs.push('Use parameterized queries for all database operations');
    recs.push('Implement input validation and sanitization');
  }

  if (categories.has('xss')) {
    recs.push('Use a Content Security Policy (CSP) header');
    recs.push('Sanitize HTML with DOMPurify before rendering');
  }

  if (categories.has('authentication')) {
    recs.push('Use bcrypt or Argon2 for password hashing');
    recs.push('Implement proper session management with secure cookies');
  }

  if (categories.has('network')) {
    recs.push('Use HTTPS for all connections');
    recs.push('Implement proper CORS configuration');
  }

  return recs;
}
