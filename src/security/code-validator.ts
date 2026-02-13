/**
 * Generated Code Validator
 *
 * Validates code produced by LLMs before writing to filesystem.
 * Checks for:
 * - Security vulnerabilities (SQLi, XSS, command injection)
 * - Hardcoded secrets
 * - Suspicious imports/requires
 * - Prototype pollution patterns
 * - Unsafe deserialization
 *
 * Integrates with text-editor and apply-patch before file writes.
 */

import { DANGEROUS_CODE_PATTERNS, DangerousPattern, PatternSeverity } from './dangerous-patterns.js';

export interface CodeValidationFinding {
  severity: PatternSeverity;
  name: string;
  description: string;
  line: number;
  evidence: string;
  category: string;
}

export interface CodeValidationResult {
  /** Whether the code passes validation (no critical/high findings) */
  safe: boolean;
  /** All findings */
  findings: CodeValidationFinding[];
  /** Summary counts by severity */
  counts: Record<PatternSeverity, number>;
  /** Language that was validated */
  language: string;
}

type SupportedLanguage =
  | 'typescript' | 'javascript' | 'python' | 'ruby'
  | 'go' | 'java' | 'shell' | 'sql' | 'html' | 'unknown';

/**
 * Additional language-specific patterns beyond the shared dangerous patterns.
 */
const LANGUAGE_PATTERNS: Record<string, DangerousPattern[]> = {
  python: [
    { pattern: /\bos\.system\s*\(/, severity: 'high', description: 'os.system() call', name: 'os-system', category: 'code_execution', appliesTo: ['code'] },
    { pattern: /\bsubprocess\.(?:call|run|Popen)\s*\(.*shell\s*=\s*True/i, severity: 'high', description: 'subprocess with shell=True', name: 'subprocess-shell', category: 'code_execution', appliesTo: ['code'] },
    { pattern: /\b__import__\s*\(/, severity: 'high', description: 'Dynamic __import__', name: 'python-dynamic-import', category: 'dynamic_import', appliesTo: ['code'] },
    { pattern: /\bMarshal\.loads?\b/, severity: 'high', description: 'Ruby-style Marshal deserialization', name: 'marshal-load', category: 'code_execution', appliesTo: ['code'] },
  ],
  sql: [
    { pattern: /\bDROP\s+(?:TABLE|DATABASE|INDEX|VIEW)\b/i, severity: 'high', description: 'DROP statement', name: 'sql-drop', category: 'filesystem_destruction', appliesTo: ['code'] },
    { pattern: /\bTRUNCATE\s+TABLE\b/i, severity: 'high', description: 'TRUNCATE TABLE', name: 'sql-truncate', category: 'filesystem_destruction', appliesTo: ['code'] },
    { pattern: /\bGRANT\s+ALL\b/i, severity: 'medium', description: 'GRANT ALL privileges', name: 'sql-grant-all', category: 'privilege_escalation', appliesTo: ['code'] },
  ],
  shell: [
    { pattern: /\bchmod\s+[0-7]{3,4}\b/, severity: 'medium', description: 'chmod with octal permissions', name: 'shell-chmod', category: 'privilege_escalation', appliesTo: ['code'] },
    { pattern: /\bcurl\s+.*-k\b/, severity: 'medium', description: 'curl with insecure flag', name: 'curl-insecure', category: 'network_exfiltration', appliesTo: ['code'] },
  ],
  html: [
    { pattern: /<script\b[^>]*>[\s\S]*?<\/script>/i, severity: 'medium', description: 'Inline script tag', name: 'inline-script', category: 'command_injection', appliesTo: ['code'] },
    { pattern: /\bon\w+\s*=\s*['"]/i, severity: 'medium', description: 'Inline event handler', name: 'inline-handler', category: 'command_injection', appliesTo: ['code'] },
    { pattern: /javascript:/i, severity: 'high', description: 'javascript: protocol', name: 'js-protocol', category: 'command_injection', appliesTo: ['code'] },
  ],
};

/**
 * Suspicious npm package names that might indicate typosquatting or malicious intent.
 */
const SUSPICIOUS_PACKAGES: RegExp[] = [
  /\brequire\s*\(\s*['"](?:color-string|event-stream|flatmap-stream|ua-parser-js-malicious|malicious-[a-z]+)\b/i,
  /\bfrom\s+['"](?:crossenv|cross-env\.js|babelcli|babel-cli\.js|d3\.js|fabric-js|ffmepg|gruntcli|http-proxy\.js|jquery\.js|mariadb|mongose|mssql\.js|mssql-node|mysqljs|node-hierarchypsi|node-mailer|node-tesseract|nodefabric|nodemailer\.js|noderequest|nodesass|nodefetch|sqliter)\b/i,
];

/**
 * Detect the language from file extension or content heuristics.
 */
export function detectLanguage(filePath?: string, code?: string): SupportedLanguage {
  if (filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const map: Record<string, SupportedLanguage> = {
      ts: 'typescript', tsx: 'typescript', mts: 'typescript',
      js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
      py: 'python', rb: 'ruby', go: 'go', java: 'java',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      sql: 'sql', html: 'html', htm: 'html',
    };
    if (ext && map[ext]) return map[ext];
  }

  // Content heuristics
  if (code) {
    if (/^#!\/.*\b(ba)?sh\b/.test(code)) return 'shell';
    if (/^#!\/.*python/.test(code)) return 'python';
    if (/\bimport\s+\w+\s+from\s+['"]/.test(code)) return 'typescript';
    if (/\bdef\s+\w+\s*\(.*\):\s*$/m.test(code)) return 'python';
    if (/\bpackage\s+\w+\b/.test(code) && /\bfunc\s+\w+\b/.test(code)) return 'go';
    if (/\bSELECT\b.*\bFROM\b/i.test(code)) return 'sql';
    if (/<html\b|<!DOCTYPE/i.test(code)) return 'html';
  }

  return 'unknown';
}

/**
 * Validate generated code for security issues.
 *
 * @param code - The code content to validate
 * @param language - Language hint (auto-detected if not provided)
 * @param filePath - Optional file path for better language detection
 * @returns Validation result with findings
 */
export function validateGeneratedCode(
  code: string,
  language?: string,
  filePath?: string,
): CodeValidationResult {
  const detectedLang = (language as SupportedLanguage) || detectLanguage(filePath, code);
  const findings: CodeValidationFinding[] = [];
  const lines = code.split('\n');

  // Collect applicable patterns
  const patterns: DangerousPattern[] = [
    ...DANGEROUS_CODE_PATTERNS.filter(p => p.appliesTo.includes('code')),
    ...(LANGUAGE_PATTERNS[detectedLang] || []),
  ];

  // Scan each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comment lines
    if (isCommentLine(line, detectedLang)) continue;

    for (const pattern of patterns) {
      if (pattern.pattern.test(line)) {
        findings.push({
          severity: pattern.severity,
          name: pattern.name,
          description: pattern.description,
          line: lineNum,
          evidence: line.trim().slice(0, 150),
          category: pattern.category,
        });
      }
    }

    // Check for suspicious package imports
    for (const pkgPattern of SUSPICIOUS_PACKAGES) {
      if (pkgPattern.test(line)) {
        findings.push({
          severity: 'critical',
          name: 'suspicious-package',
          description: 'Import of known suspicious/malicious package',
          line: lineNum,
          evidence: line.trim().slice(0, 150),
          category: 'dynamic_import',
        });
      }
    }
  }

  // Count by severity
  const counts: Record<PatternSeverity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  for (const f of findings) {
    counts[f.severity]++;
  }

  // Safe = no critical or high findings
  const safe = counts.critical === 0 && counts.high === 0;

  return { safe, findings, counts, language: detectedLang };
}

/**
 * Check if a line is a comment (language-specific).
 */
function isCommentLine(line: string, language: SupportedLanguage): boolean {
  const trimmed = line.trim();
  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'java':
    case 'go':
      return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
    case 'python':
    case 'ruby':
    case 'shell':
      return trimmed.startsWith('#');
    case 'sql':
      return trimmed.startsWith('--') || trimmed.startsWith('/*');
    case 'html':
      return trimmed.startsWith('<!--');
    default:
      return trimmed.startsWith('//') || trimmed.startsWith('#');
  }
}

/**
 * Format validation result as human-readable report.
 */
export function formatValidationReport(result: CodeValidationResult): string {
  if (result.findings.length === 0) {
    return 'Code validation: No security issues found.';
  }

  const lines: string[] = [];
  const status = result.safe ? 'PASS (warnings only)' : 'FAIL';
  lines.push(`Code Validation: ${status} — ${result.findings.length} findings (${result.language})`);
  lines.push(`  Critical: ${result.counts.critical} | High: ${result.counts.high} | Medium: ${result.counts.medium} | Low: ${result.counts.low}`);
  lines.push('');

  for (const f of result.findings) {
    const sev = f.severity.toUpperCase().padEnd(8);
    lines.push(`  [${sev}] L${f.line}: ${f.description}`);
    lines.push(`           ${f.evidence}`);
  }

  return lines.join('\n');
}
