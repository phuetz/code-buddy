/**
 * Skill Code Scanner (Enterprise-grade)
 *
 * Static analysis of skill files for dangerous patterns.
 * Scans SKILL.md files and any referenced code for security issues.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ScanFinding {
  severity: FindingSeverity;
  pattern: string;
  description: string;
  file: string;
  line: number;
  evidence: string;
}

export interface ScanResult {
  file: string;
  findings: ScanFinding[];
  scannedAt: number;
}

export type SkillFirewallCapability =
  | 'dynamic-code'
  | 'filesystem'
  | 'network'
  | 'prototype-pollution'
  | 'secrets'
  | 'shell';
export type SkillFirewallVerdict = 'allow' | 'review' | 'quarantine';

export interface SkillFirewallReport {
  schemaVersion: 1;
  capabilities: SkillFirewallCapability[];
  findingCounts: Record<FindingSeverity, number>;
  findings: ScanFinding[];
  generatedAt: string;
  quarantineRequired: boolean;
  score: number;
  summary: string;
  target: string;
  verdict: SkillFirewallVerdict;
}

interface DangerousPattern {
  capability: SkillFirewallCapability;
  pattern: RegExp;
  severity: FindingSeverity;
  description: string;
  name: string;
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // Code execution
  { pattern: /\beval\s*\(/, severity: 'critical', description: 'Dynamic code execution via eval()', name: 'eval', capability: 'dynamic-code' },
  { pattern: /\bnew\s+Function\s*\(/, severity: 'critical', description: 'Dynamic function creation', name: 'new-function', capability: 'dynamic-code' },
  { pattern: /\bchild_process\b/, severity: 'high', description: 'Child process module usage', name: 'child_process', capability: 'shell' },
  { pattern: /\bexecSync\s*\(/, severity: 'high', description: 'Synchronous command execution', name: 'execSync', capability: 'shell' },
  { pattern: /\bexecFile\s*\(/, severity: 'high', description: 'File execution', name: 'execFile', capability: 'shell' },
  { pattern: /\bspawn\s*\(/, severity: 'medium', description: 'Process spawning', name: 'spawn', capability: 'shell' },
  { pattern: /\bexec\s*\(/, severity: 'high', description: 'Command execution', name: 'exec', capability: 'shell' },

  // File system dangers
  { pattern: /\brm\s+-rf\b/, severity: 'critical', description: 'Recursive force delete', name: 'rm-rf', capability: 'filesystem' },
  { pattern: /\bunlinkSync\s*\(/, severity: 'medium', description: 'Synchronous file deletion', name: 'unlinkSync', capability: 'filesystem' },
  { pattern: /\bwriteFileSync\s*\(/, severity: 'low', description: 'Synchronous file write', name: 'writeFileSync', capability: 'filesystem' },
  { pattern: /\brmdirSync\s*\(/, severity: 'medium', description: 'Directory removal', name: 'rmdirSync', capability: 'filesystem' },

  // Network
  { pattern: /\bfetch\s*\(\s*['"`]http/, severity: 'medium', description: 'External HTTP request', name: 'fetch-http', capability: 'network' },
  { pattern: /\baxios\b/, severity: 'low', description: 'HTTP client library usage', name: 'axios', capability: 'network' },
  { pattern: /\brequire\s*\(\s*['"`]https?['"`]\s*\)/, severity: 'medium', description: 'HTTP module import', name: 'http-require', capability: 'network' },
  { pattern: /\bWebSocket\b/, severity: 'medium', description: 'WebSocket usage', name: 'websocket', capability: 'network' },

  // Dynamic imports
  { pattern: /\brequire\s*\(\s*[a-zA-Z_$[]/, severity: 'high', description: 'Dynamic require with variable', name: 'dynamic-require', capability: 'dynamic-code' },
  { pattern: /\bimport\s*\(\s*[a-zA-Z_$[]/, severity: 'high', description: 'Dynamic import with variable', name: 'dynamic-import', capability: 'dynamic-code' },

  // Environment/secrets
  { pattern: /process\.env\[/, severity: 'low', description: 'Dynamic environment variable access', name: 'env-dynamic', capability: 'secrets' },
  { pattern: /\b(API_KEY|SECRET|PASSWORD|TOKEN)\b/i, severity: 'info', description: 'Possible secret reference', name: 'secret-ref', capability: 'secrets' },

  // Prototype pollution
  { pattern: /__proto__/, severity: 'high', description: 'Prototype pollution risk', name: 'proto', capability: 'prototype-pollution' },
  { pattern: /\bconstructor\s*\[/, severity: 'high', description: 'Constructor access via bracket notation', name: 'constructor-bracket', capability: 'prototype-pollution' },

  // Shell injection
  { pattern: /`\$\{.*\}`/, severity: 'medium', description: 'Template literal with interpolation (potential injection)', name: 'template-injection', capability: 'shell' },
  { pattern: /\$\(.*\)/, severity: 'medium', description: 'Shell command substitution', name: 'shell-subst', capability: 'shell' },
];

/**
 * Scan a single file for dangerous patterns.
 */
export function scanFile(filePath: string): ScanResult {
  const findings: ScanFinding[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const lineNum = i + 1;

      // Skip markdown comments and frontmatter delimiters
      if (line.trim().startsWith('<!--') || line.trim() === '---') continue;

      for (const dp of DANGEROUS_PATTERNS) {
        if (dp.pattern.test(line)) {
          findings.push({
            severity: dp.severity,
            pattern: dp.name,
            description: dp.description,
            file: filePath,
            line: lineNum,
            evidence: line.trim().slice(0, 120),
          });
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to scan file: ${filePath}`, { error });
  }

  return {
    file: filePath,
    findings,
    scannedAt: Date.now(),
  };
}

/**
 * Scan a directory of skill files recursively.
 */
export function scanDirectory(dirPath: string): ScanResult[] {
  const results: ScanResult[] = [];

  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath));
    } else if (
      entry.name.endsWith('.skill.md') ||
      entry.name === 'SKILL.md' ||
      entry.name.endsWith('.ts') ||
      entry.name.endsWith('.js')
    ) {
      const result = scanFile(fullPath);
      if (result.findings.length > 0) {
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * Scan all skill locations (bundled, managed, workspace).
 */
export function scanAllSkills(projectRoot: string = process.cwd()): ScanResult[] {
  const skillDirs = [
    path.join(projectRoot, '.codebuddy', 'skills', 'bundled'),
    path.join(projectRoot, '.codebuddy', 'skills', 'managed'),
    path.join(projectRoot, '.codebuddy', 'skills', 'workspace'),
  ];

  const results: ScanResult[] = [];
  for (const dir of skillDirs) {
    results.push(...scanDirectory(dir));
  }

  return results;
}

/**
 * Build an operator-facing firewall report for one skill file or directory.
 *
 * The legacy scanner reports raw pattern hits. This layer turns them into
 * a trust score, capability flags, and an install verdict suitable for
 * marketplace/candidate quarantine flows.
 */
export function scanSkillFirewall(targetPath: string): SkillFirewallReport {
  const normalizedTarget = path.resolve(targetPath);
  const results = fs.existsSync(normalizedTarget) && fs.statSync(normalizedTarget).isDirectory()
    ? scanDirectory(normalizedTarget)
    : [scanFile(normalizedTarget)];
  return buildSkillFirewallReport(normalizedTarget, results);
}

export function buildSkillFirewallReport(
  targetPath: string,
  results: ScanResult[],
): SkillFirewallReport {
  const findings = results.flatMap((result) => result.findings);
  const findingCounts = countFindings(findings);
  const capabilities = inferCapabilities(findings);
  const score = computeFirewallScore(findingCounts);
  const verdict = determineFirewallVerdict(findingCounts, capabilities, score);

  return {
    schemaVersion: 1,
    capabilities,
    findingCounts,
    findings,
    generatedAt: new Date().toISOString(),
    quarantineRequired: verdict === 'quarantine',
    score,
    summary: summarizeFirewall(verdict, score, findingCounts, capabilities),
    target: targetPath,
    verdict,
  };
}

/**
 * Format scan results as a human-readable report.
 */
export function formatScanReport(results: ScanResult[]): string {
  if (results.length === 0) {
    return 'Skill scan: No security issues found.';
  }

  const allFindings = results.flatMap(r => r.findings);
  const bySeverity = {
    critical: allFindings.filter(f => f.severity === 'critical'),
    high: allFindings.filter(f => f.severity === 'high'),
    medium: allFindings.filter(f => f.severity === 'medium'),
    low: allFindings.filter(f => f.severity === 'low'),
    info: allFindings.filter(f => f.severity === 'info'),
  };

  const lines: string[] = [];
  lines.push(`Skill Security Scan: ${allFindings.length} findings in ${results.length} files`);
  lines.push(`  Critical: ${bySeverity.critical.length} | High: ${bySeverity.high.length} | Medium: ${bySeverity.medium.length} | Low: ${bySeverity.low.length} | Info: ${bySeverity.info.length}`);
  lines.push('');

  for (const result of results) {
    lines.push(`${path.basename(result.file)}:`);
    for (const finding of result.findings) {
      const sev = finding.severity.toUpperCase().padEnd(8);
      lines.push(`  [${sev}] L${finding.line}: ${finding.description}`);
      lines.push(`           ${finding.evidence}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function countFindings(findings: ScanFinding[]): Record<FindingSeverity, number> {
  return {
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
}

function inferCapabilities(findings: ScanFinding[]): SkillFirewallCapability[] {
  const capabilities = new Set<SkillFirewallCapability>();
  for (const finding of findings) {
    const pattern = DANGEROUS_PATTERNS.find((item) => item.name === finding.pattern);
    if (pattern) capabilities.add(pattern.capability);
  }
  return [...capabilities].sort();
}

function computeFirewallScore(counts: Record<FindingSeverity, number>): number {
  const penalty =
    counts.critical * 45 +
    counts.high * 24 +
    counts.medium * 10 +
    counts.low * 4 +
    counts.info;
  return Math.max(0, 100 - penalty);
}

function determineFirewallVerdict(
  counts: Record<FindingSeverity, number>,
  capabilities: SkillFirewallCapability[],
  score: number,
): SkillFirewallVerdict {
  if (counts.critical > 0 || score < 55) return 'quarantine';
  if (
    counts.high > 0 &&
    (capabilities.includes('dynamic-code') || capabilities.includes('shell') || capabilities.includes('prototype-pollution'))
  ) {
    return 'quarantine';
  }
  if (counts.high > 0 || counts.medium > 0 || score < 85) return 'review';
  return 'allow';
}

function summarizeFirewall(
  verdict: SkillFirewallVerdict,
  score: number,
  counts: Record<FindingSeverity, number>,
  capabilities: SkillFirewallCapability[],
): string {
  if (verdict === 'allow') {
    return `Skill Firewall allow: score ${score}/100; no blocking capability detected.`;
  }
  const findingSummary = [
    counts.critical ? `${counts.critical} critical` : '',
    counts.high ? `${counts.high} high` : '',
    counts.medium ? `${counts.medium} medium` : '',
  ].filter(Boolean).join(', ');
  const capabilitySummary = capabilities.length ? `; capabilities: ${capabilities.join(', ')}` : '';
  if (verdict === 'quarantine') {
    return `Skill Firewall quarantine: score ${score}/100; ${findingSummary || 'blocking pattern detected'}${capabilitySummary}.`;
  }
  return `Skill Firewall review: score ${score}/100; ${findingSummary || 'non-blocking patterns detected'}${capabilitySummary}.`;
}
