/**
 * Skill Code Scanner (OpenClaw-inspired)
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

interface DangerousPattern {
  pattern: RegExp;
  severity: FindingSeverity;
  description: string;
  name: string;
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // Code execution
  { pattern: /\beval\s*\(/, severity: 'critical', description: 'Dynamic code execution via eval()', name: 'eval' },
  { pattern: /\bnew\s+Function\s*\(/, severity: 'critical', description: 'Dynamic function creation', name: 'new-function' },
  { pattern: /\bchild_process\b/, severity: 'high', description: 'Child process module usage', name: 'child_process' },
  { pattern: /\bexecSync\s*\(/, severity: 'high', description: 'Synchronous command execution', name: 'execSync' },
  { pattern: /\bexecFile\s*\(/, severity: 'high', description: 'File execution', name: 'execFile' },
  { pattern: /\bspawn\s*\(/, severity: 'medium', description: 'Process spawning', name: 'spawn' },
  { pattern: /\bexec\s*\(/, severity: 'high', description: 'Command execution', name: 'exec' },

  // File system dangers
  { pattern: /\brm\s+-rf\b/, severity: 'critical', description: 'Recursive force delete', name: 'rm-rf' },
  { pattern: /\bunlinkSync\s*\(/, severity: 'medium', description: 'Synchronous file deletion', name: 'unlinkSync' },
  { pattern: /\bwriteFileSync\s*\(/, severity: 'low', description: 'Synchronous file write', name: 'writeFileSync' },
  { pattern: /\brmdirSync\s*\(/, severity: 'medium', description: 'Directory removal', name: 'rmdirSync' },

  // Network
  { pattern: /\bfetch\s*\(\s*['"`]http/, severity: 'medium', description: 'External HTTP request', name: 'fetch-http' },
  { pattern: /\baxios\b/, severity: 'low', description: 'HTTP client library usage', name: 'axios' },
  { pattern: /\brequire\s*\(\s*['"`]https?['"`]\s*\)/, severity: 'medium', description: 'HTTP module import', name: 'http-require' },
  { pattern: /\bWebSocket\b/, severity: 'medium', description: 'WebSocket usage', name: 'websocket' },

  // Dynamic imports
  { pattern: /\brequire\s*\(\s*[a-zA-Z_$\[]/, severity: 'high', description: 'Dynamic require with variable', name: 'dynamic-require' },
  { pattern: /\bimport\s*\(\s*[a-zA-Z_$\[]/, severity: 'high', description: 'Dynamic import with variable', name: 'dynamic-import' },

  // Environment/secrets
  { pattern: /process\.env\[/, severity: 'low', description: 'Dynamic environment variable access', name: 'env-dynamic' },
  { pattern: /\b(API_KEY|SECRET|PASSWORD|TOKEN)\b/i, severity: 'info', description: 'Possible secret reference', name: 'secret-ref' },

  // Prototype pollution
  { pattern: /__proto__/, severity: 'high', description: 'Prototype pollution risk', name: 'proto' },
  { pattern: /\bconstructor\s*\[/, severity: 'high', description: 'Constructor access via bracket notation', name: 'constructor-bracket' },

  // Shell injection
  { pattern: /`\$\{.*\}`/, severity: 'medium', description: 'Template literal with interpolation (potential injection)', name: 'template-injection' },
  { pattern: /\$\(.*\)/, severity: 'medium', description: 'Shell command substitution', name: 'shell-subst' },
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
