/**
 * Skill Code Scanner (Enterprise-grade)
 *
 * Static analysis of skill files for dangerous patterns.
 * Scans SKILL.md files and any referenced code for security issues.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  deobfuscateForScanWindows,
  deobfuscateSafeForScanWindows,
  sliceScanWindows,
} from './text-deobfuscation.js';

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
  | 'prompt-injection'
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
  justification?: string;
}

const SCRIPT_EXTENSIONS = new Set([
  '.bash',
  '.bat',
  '.cmd',
  '.cjs',
  '.ex',
  '.exs',
  '.go',
  '.js',
  '.lua',
  '.mjs',
  '.php',
  '.pl',
  '.ps1',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.sh',
  '.ts',
  '.zsh',
]);

function isScannableSkillFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return lowerName.endsWith('.skill.md')
    || lowerName === 'skill.md'
    || SCRIPT_EXTENSIONS.has(path.extname(lowerName));
}

function isExecutableOrShebang(filePath: string): boolean {
  try {
    if ((fs.statSync(filePath).mode & 0o111) !== 0) return true;
    const fd = fs.openSync(filePath, 'r');
    try {
      const prefix = Buffer.alloc(2);
      return fs.readSync(fd, prefix, 0, prefix.length, 0) === 2 && prefix.toString() === '#!';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // Code execution & droppers
  { pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sh|bash|zsh)\b/i, severity: 'critical', description: 'Remote download piped directly to a shell', name: 'remote-download-pipe-shell', capability: 'shell' },
  { pattern: /\bbash(?:\.exe)?\s+-c\b[^\n]*\bcurl\b/i, severity: 'critical', description: 'Shell command executes a downloaded curl payload', name: 'bash-curl-command', capability: 'shell' },
  { pattern: /\bpowershell(?:\.exe)?\s+-c(?:ommand)?\b[^\n]*\biwr\b[^|\n]*\|\s*iex\b/i, severity: 'critical', description: 'PowerShell downloads and executes a remote payload', name: 'powershell-download-execute', capability: 'shell' },
  {
    pattern: /\b(?:base64\s+(?:-d|--decode|-D)|openssl\s+base64\s+-d)\b[^|\n]*\|\s*(?:sh|bash|zsh|dash)\b/i,
    severity: 'critical',
    description: 'Base64 decoding piped directly to shell',
    name: 'base64-decode-pipe-shell',
    capability: 'shell',
    justification: 'Base64 droppers decode obfuscated commands on the fly into an active shell interpreter',
  },
  {
    pattern: /\b(?:printf|echo\s+-e)\s+['"][^'"]*\\x[0-9a-fA-F]{2}[^'"]*['"]\s*\|\s*(?:sh|bash|zsh|dash)\b/i,
    severity: 'critical',
    description: 'Hex/octal encoded payload piped directly to shell',
    name: 'hex-printf-pipe-shell',
    capability: 'shell',
    justification: 'Hex escape sequences in printf/echo piped into shells reconstruct binary or shell payloads stealthily',
  },
  { pattern: /\beval\s+\$\(\s*[^)]*\)/i, severity: 'critical', description: 'Dynamic evaluation of shell command substitution', name: 'eval-command-substitution', capability: 'shell' },
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

  // Network & Exfiltration
  { pattern: /\bfetch\s*\(\s*['"`]http/, severity: 'medium', description: 'External HTTP request', name: 'fetch-http', capability: 'network' },
  { pattern: /\baxios\b/, severity: 'low', description: 'HTTP client library usage', name: 'axios', capability: 'network' },
  { pattern: /\brequire\s*\(\s*['"`]https?['"`]\s*\)/, severity: 'medium', description: 'HTTP module import', name: 'http-require', capability: 'network' },
  { pattern: /\bWebSocket\b/, severity: 'medium', description: 'WebSocket usage', name: 'websocket', capability: 'network' },
  {
    pattern: /(?:(?:curl|wget)\b[^|\n]*(?:-d|--data|--data-binary|--data-raw|-F|--upload-file|-T)\s+[@<]?(?:~|\$HOME|\/home\/[^/\s]+|\.)?\/?(?:\.ssh\/|\.aws\/|\.codebuddy\/|\.env(?!\.(?:example|sample|template|dist))\b))|(?:\bcat\s+[^|\n]*(?:\.ssh\/|\.aws\/|\.codebuddy\/|\.env(?!\.(?:example|sample|template|dist))\b)[^|\n]*\|\s*(?:curl|wget|nc|ncat|netcat|socat)\b)|(?:\b(?:nc|ncat|netcat|socat)\b[^<\n]*<\s*(?:~|\$HOME|\/home\/[^/\s]+|\.)?\/?(?:\.ssh\/|\.aws\/|\.codebuddy\/|\.env(?!\.(?:example|sample|template|dist))\b))|(?:\bscp\b[^|\n]*(?:~|\$HOME|\/home\/[^/\s]+|\.)?\/?(?:\.ssh\/id_|\.aws\/credentials|\.codebuddy\/[^\s|&;]*\.env|\.env(?!\.(?:example|sample|template|dist))\b)\s+[^\s]+:)/i,
    severity: 'critical',
    description: 'Exfiltration of credentials or sensitive environment files via network',
    name: 'credential-network-exfiltration',
    capability: 'network',
    justification: 'Transmitting private keys, environment files, or credentials via curl/nc/scp to remote destinations is exfiltration',
  },

  // Dynamic imports (JS & Python)
  { pattern: /\brequire\s*\(\s*[a-zA-Z_$[]/, severity: 'high', description: 'Dynamic require with variable', name: 'dynamic-require', capability: 'dynamic-code' },
  { pattern: /(?<!\bfrom\s+[\w.]+\s+)\bimport\s*\(\s*[a-zA-Z_$[]/, severity: 'high', description: 'Dynamic import with variable', name: 'dynamic-import', capability: 'dynamic-code' },
  {
    pattern: /\b__import__\s*\(\s*['"][a-zA-Z0-9_.]+['"]/,
    severity: 'high',
    description: 'Dynamic Python module import via __import__()',
    name: 'py-dunder-import',
    capability: 'dynamic-code',
    justification: 'Python __import__() dynamically loads arbitrary modules at runtime bypassing static import declarations',
  },
  {
    pattern: /\bimportlib\s*\.\s*import_module\s*\(/,
    severity: 'high',
    description: 'Dynamic Python module import via importlib.import_module()',
    name: 'py-importlib-import',
    capability: 'dynamic-code',
    justification: 'importlib.import_module() enables dynamic resolution and execution of arbitrary Python packages at runtime',
  },

  // Environment/secrets
  { pattern: /process\.env\[/, severity: 'low', description: 'Dynamic environment variable access', name: 'env-dynamic', capability: 'secrets' },
  { pattern: /\b(API_KEY|SECRET|PASSWORD|TOKEN)\b/i, severity: 'info', description: 'Possible secret reference', name: 'secret-ref', capability: 'secrets' },
  {
    pattern: /(?<!\bssh-keygen\b[^\n]*)(?:~|\$HOME|\/home\/[^/\s]+)\/\.ssh\/id_(?:rsa|ecdsa|ed25519|dsa)\b(?!\.pub\b)/i,
    severity: 'high',
    description: 'Access or reading of private SSH keys',
    name: 'ssh-private-key-access',
    capability: 'secrets',
    justification: 'Direct access to SSH private keys allows unauthorized server access and identity impersonation',
  },
  {
    pattern: /\b(?:cat|head|tail|grep|source)\s+(?:(?:\.\/)?\.env|~[^\s/]*\/\.env)(?!\.(?:example|sample|template|dist|test|local\.example))\b/i,
    severity: 'high',
    description: 'Access or extraction of sensitive .env environment file',
    name: 'dotenv-file-access',
    capability: 'secrets',
    justification: '.env files contain local application secrets, API keys, and connection credentials',
  },
  {
    pattern: /(?:~|\$HOME|\/home\/[^/\s]+)\/(?:\.aws\/(?:credentials|config)|\.codebuddy\/[^\s|&;]*\.env)\b/i,
    severity: 'high',
    description: 'Access to cloud provider credentials or CodeBuddy environment files',
    name: 'cloud-credential-access',
    capability: 'secrets',
    justification: 'Accessing ~/.aws/credentials or ~/.codebuddy/*.env compromises infrastructure and agent secrets',
  },

  // Prototype pollution
  { pattern: /__proto__/, severity: 'high', description: 'Prototype pollution risk', name: 'proto', capability: 'prototype-pollution' },
  { pattern: /\bconstructor\s*\[/, severity: 'high', description: 'Constructor access via bracket notation', name: 'constructor-bracket', capability: 'prototype-pollution' },

  // Shell injection
  { pattern: /`\$\{.*\}`/, severity: 'medium', description: 'Template literal with interpolation (potential injection)', name: 'template-injection', capability: 'shell' },
  { pattern: /\$\(.*\)/, severity: 'medium', description: 'Shell command substitution', name: 'shell-subst', capability: 'shell' },

  // Prompt injection / jailbreak (a skill is injected into the agent context)
  { pattern: /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:all|any|previous|prior|system|developer)\b.{0,80}\b(?:instruction|prompt|message)s?\b/i, severity: 'critical', description: 'Instruction to override higher-priority prompts', name: 'prompt-override', capability: 'prompt-injection' },
  { pattern: /\b(?:jailbreak|godmode|g0dm0d3)\b/i, severity: 'critical', description: 'Jailbreak / GODMODE skill content', name: 'jailbreak-godmode', capability: 'prompt-injection' },
  { pattern: /\b(?:disable|bypass)\b.{0,60}\b(?:all|every|any)\b.{0,40}\b(?:safety|guardrail|restriction)s?\b/i, severity: 'critical', description: 'Instruction to disable safety policies', name: 'disable-safety', capability: 'prompt-injection' },
  {
    pattern: /<!--[\s\S]*?\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:all|any|previous|prior|system|developer)\b.{0,80}\b(?:instruction|prompt|message|rule)s?[\s\S]*?-->/i,
    severity: 'critical',
    description: 'Prompt injection or instruction override hidden inside HTML comment',
    name: 'html-comment-prompt-injection',
    capability: 'prompt-injection',
    justification: 'HTML comments are invisible in rendered markdown but parsed by LLMs, creating a stealth prompt injection vector',
  },
  {
    pattern: /<!--[\s\S]*?\b(?:(?:curl|wget)\b[^|\n]*\|\s*(?:sh|bash|zsh)|rm\s+-rf|base64\s+(?:-d|--decode))\b[\s\S]*?-->/i,
    severity: 'critical',
    description: 'Dangerous shell command or dropper hidden inside HTML comment',
    name: 'html-comment-hidden-command',
    capability: 'prompt-injection',
    justification: 'Hiding shell droppers or destructive commands in HTML comments bypasses visual human review while targeting agents',
  },
];

const DYNAMIC_IMPORT_PATTERN_LEGACY = /\bimport\s*\(\s*[a-zA-Z_$[]/;

function isDeobAllEnabled(): boolean {
  return (
    process.env.CODEBUDDY_SKILL_FIREWALL_DEOB_ALL !== 'false' &&
    process.env.CODEBUDDY_SKILL_FIREWALL_DEOB_ALL !== '0'
  );
}

function getDangerousPatterns(): DangerousPattern[] {
  if (isDeobAllEnabled()) {
    return DANGEROUS_PATTERNS;
  }
  return DANGEROUS_PATTERNS.map((dp) => {
    if (dp.name === 'dynamic-import') {
      return {
        ...dp,
        pattern: DYNAMIC_IMPORT_PATTERN_LEGACY,
      };
    }
    return dp;
  });
}

/**
 * Scan a single file for dangerous patterns.
 */
export function scanFile(filePath: string): ScanResult {
  const findings: ScanFinding[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const patterns = getDangerousPatterns();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const lineNum = i + 1;

      // Skip markdown comments and frontmatter delimiters
      if (line.trim().startsWith('<!--') || line.trim() === '---') continue;

      for (const dp of patterns) {
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

    // Prompt-injection patterns also run over the FULL document. The line loop
    // skips `<!-- … -->` (to avoid flagging example `eval()` in comments) and
    // cannot see a jailbreak split across lines — that's how a no-shell
    // override slipped through on 2026-09-03. Dotall matching here catches
    // both without re-enabling those comment false positives for eval/shell.
    findings.push(...collectPromptInjectionFindings(content, filePath, findings));
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
export function scanDirectory(dirPath: string, withinScripts = false): ScanResult[] {
  const results: ScanResult[] = [];

  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath, withinScripts || entry.name.toLowerCase() === 'scripts'));
    } else if (
      withinScripts
      || isScannableSkillFile(entry.name)
      || isExecutableOrShebang(fullPath)
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

/**
 * Full-document de-obfuscation pass across pattern capabilities.
 * Safe de-obfuscation (zero-width, homoglyphs, césures) is applied to all capabilities.
 * Aggressive de-obfuscation (Base64, percent-decoding) is restricted to prompt-injection.
 */
function collectDeobfuscatedFindings(
  content: string,
  filePath: string,
  existing: ScanFinding[],
): ScanFinding[] {
  const extra: ScanFinding[] = [];
  const seen = new Set(existing.map((finding) => finding.pattern));

  const deobAll = isDeobAllEnabled();
  const patterns = getDangerousPatterns();

  const rawWindows = sliceScanWindows(content);
  let safeWindows: string[] | null = null;
  let aggressiveWindows: string[] | null = null;

  for (const dp of patterns) {
    const isInjection = dp.capability === 'prompt-injection';
    if (!isInjection && !deobAll) continue;
    if (seen.has(dp.name)) continue;

    const flags = isInjection && !dp.pattern.flags.includes('s')
      ? `${dp.pattern.flags}s`
      : dp.pattern.flags;
    const re = new RegExp(dp.pattern.source, flags.replace('g', ''));

    // Prompt-injection patterns also match against raw content across lines/comments
    if (isInjection) {
      let rawMatched = false;
      for (const win of rawWindows) {
        const match = re.exec(win);
        if (match && match.index !== undefined) {
          seen.add(dp.name);
          extra.push({
            severity: dp.severity,
            pattern: dp.name,
            description: dp.description,
            file: filePath,
            line: 1,
            evidence: match[0].replace(/\s+/g, ' ').trim().slice(0, 120),
          });
          rawMatched = true;
          break;
        }
      }
      if (rawMatched) continue;
    }

    const targetWindows = isInjection
      ? (aggressiveWindows ??= deobfuscateForScanWindows(content))
      : (safeWindows ??= deobfuscateSafeForScanWindows(content));

    for (const win of targetWindows) {
      const normMatch = re.exec(win);
      if (!normMatch || normMatch.index === undefined) continue;
      seen.add(dp.name);
      extra.push({
        severity: dp.severity,
        pattern: dp.name,
        description: `${dp.description} (obfuscated)`,
        file: filePath,
        line: 1,
        evidence: normMatch[0].replace(/\s+/g, ' ').trim().slice(0, 120),
      });
      break;
    }
  }
  return extra;
}

const collectPromptInjectionFindings = collectDeobfuscatedFindings;

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
