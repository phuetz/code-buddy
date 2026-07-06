/**
 * Dependency Vulnerability Scanner
 *
 * Auto-detects package managers and runs their audit commands to produce
 * a structured vulnerability report. Supports npm, pip, cargo, and go.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export type PackageManager = 'npm' | 'pip' | 'cargo' | 'go' | 'gem' | 'composer';
export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Vulnerability {
  package: string;
  version: string;
  severity: VulnSeverity;
  title: string;
  cve?: string;
  fixVersion?: string;
  description: string;
}

export interface VulnerabilityReport {
  packageManager: PackageManager;
  vulnerabilities: Vulnerability[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
}

// ============================================================================
// Package Manager Detection
// ============================================================================

/**
 * Detect which package managers are in use based on lockfiles / manifests.
 */
export function detectPackageManagers(projectRoot: string): PackageManager[] {
  const detected: PackageManager[] = [];
  const exists = (f: string) => fs.existsSync(path.join(projectRoot, f));

  if (exists('package.json') || exists('package-lock.json') || exists('yarn.lock') || exists('pnpm-lock.yaml')) {
    detected.push('npm');
  }
  if (exists('requirements.txt') || exists('Pipfile') || exists('pyproject.toml') || exists('setup.py')) {
    detected.push('pip');
  }
  if (exists('Cargo.toml') || exists('Cargo.lock')) {
    detected.push('cargo');
  }
  if (exists('go.mod') || exists('go.sum')) {
    detected.push('go');
  }
  if (exists('Gemfile') || exists('Gemfile.lock')) {
    detected.push('gem');
  }
  if (exists('composer.json') || exists('composer.lock')) {
    detected.push('composer');
  }

  return detected;
}

// ============================================================================
// Audit Runners
// ============================================================================

function runCommand(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    // npm audit exits non-zero when vulnerabilities are found — capture stdout
    if (err && typeof err === 'object' && 'stdout' in err) {
      return (err as { stdout: string }).stdout || null;
    }
    return null;
  }
}

function normalizeSeverity(raw: string): VulnSeverity {
  const lower = raw.toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'moderate' || lower === 'medium') return 'medium';
  return 'low';
}

function makeSummary(vulns: Vulnerability[]): VulnerabilityReport['summary'] {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, total: vulns.length };
  for (const v of vulns) {
    summary[v.severity]++;
  }
  return summary;
}

// ============================================================================
// npm
// ============================================================================

function auditNpm(projectRoot: string): VulnerabilityReport {
  const vulns: Vulnerability[] = [];
  const output = runCommand('npm audit --json', projectRoot);

  if (output) {
    try {
      const data = JSON.parse(output);

      // npm audit v7+ format
      if (data.vulnerabilities && typeof data.vulnerabilities === 'object') {
        for (const [pkgName, info] of Object.entries(data.vulnerabilities)) {
          const v = info as Record<string, unknown>;
          vulns.push({
            package: pkgName,
            version: (v.range as string) || '',
            severity: normalizeSeverity((v.severity as string) || 'low'),
            title: (v.title as string) || (v.name as string) || pkgName,
            cve: Array.isArray(v.via) ? extractCve(v.via) : undefined,
            fixVersion: (v.fixAvailable as Record<string, unknown>)?.version as string || undefined,
            description: buildNpmDescription(v),
          });
        }
      }

      // npm audit v6 format (advisories)
      if (data.advisories && typeof data.advisories === 'object') {
        for (const advisory of Object.values(data.advisories)) {
          const a = advisory as Record<string, unknown>;
          vulns.push({
            package: (a.module_name as string) || '',
            version: (a.vulnerable_versions as string) || '',
            severity: normalizeSeverity((a.severity as string) || 'low'),
            title: (a.title as string) || '',
            cve: Array.isArray(a.cves) ? (a.cves as string[])[0] : undefined,
            fixVersion: (a.patched_versions as string) || undefined,
            description: (a.overview as string) || '',
          });
        }
      }
    } catch (_e) {
      logger.debug('npm audit JSON parse failed');
    }
  }

  return { packageManager: 'npm', vulnerabilities: vulns, summary: makeSummary(vulns) };
}

function extractCve(via: unknown[]): string | undefined {
  for (const entry of via) {
    if (typeof entry === 'object' && entry !== null) {
      const url = (entry as Record<string, unknown>).url as string;
      if (url && url.includes('CVE-')) {
        const match = url.match(/CVE-\d{4}-\d+/);
        if (match) return match[0];
      }
    }
  }
  return undefined;
}

function buildNpmDescription(v: Record<string, unknown>): string {
  if (Array.isArray(v.via)) {
    const descs = v.via
      .filter((x: unknown) => typeof x === 'object' && x !== null)
      .map((x: unknown) => (x as Record<string, unknown>).title || '')
      .filter(Boolean);
    if (descs.length > 0) return descs.join('; ');
  }
  return (v.title as string) || (v.name as string) || '';
}

// ============================================================================
// pip
// ============================================================================

function auditPip(projectRoot: string): VulnerabilityReport {
  const vulns: Vulnerability[] = [];
  const output = runCommand('pip audit --format json', projectRoot) ||
    runCommand('python -m pip_audit --format json', projectRoot);

  if (output) {
    try {
      const data = JSON.parse(output);
      const deps = Array.isArray(data) ? data : (data.dependencies || []);

      for (const dep of deps) {
        if (!dep.vulns || dep.vulns.length === 0) continue;
        for (const vuln of dep.vulns) {
          vulns.push({
            package: dep.name || '',
            version: dep.version || '',
            severity: normalizeSeverity(vuln.severity || 'medium'),
            title: vuln.id || vuln.aliases?.[0] || '',
            cve: vuln.aliases?.find((a: string) => a.startsWith('CVE-')) || vuln.id || undefined,
            fixVersion: vuln.fix_versions?.[0] || dep.fix_versions?.[0] || undefined,
            description: vuln.description || vuln.id || '',
          });
        }
      }
    } catch (_e) {
      logger.debug('pip audit JSON parse failed');
    }
  }

  return { packageManager: 'pip', vulnerabilities: vulns, summary: makeSummary(vulns) };
}

// ============================================================================
// cargo
// ============================================================================

function auditCargo(projectRoot: string): VulnerabilityReport {
  const vulns: Vulnerability[] = [];
  const output = runCommand('cargo audit --json', projectRoot);

  if (output) {
    try {
      const data = JSON.parse(output);
      const advisories = data.vulnerabilities?.list || [];

      for (const entry of advisories) {
        const advisory = entry.advisory || {};
        const pkg = entry.package || {};
        vulns.push({
          package: pkg.name || '',
          version: pkg.version || '',
          severity: normalizeSeverity(advisory.cvss?.severity || 'medium'),
          title: advisory.title || advisory.id || '',
          cve: advisory.aliases?.find((a: string) => a.startsWith('CVE-')) || advisory.id || undefined,
          fixVersion: entry.versions?.patched?.[0] || undefined,
          description: advisory.description || advisory.title || '',
        });
      }
    } catch (_e) {
      logger.debug('cargo audit JSON parse failed');
    }
  }

  return { packageManager: 'cargo', vulnerabilities: vulns, summary: makeSummary(vulns) };
}

// ============================================================================
// go
// ============================================================================

function auditGo(projectRoot: string): VulnerabilityReport {
  const vulns: Vulnerability[] = [];
  const output = runCommand('govulncheck -json ./...', projectRoot);

  if (output) {
    try {
      // govulncheck outputs newline-delimited JSON
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.osv) {
            const osv = entry.osv;
            vulns.push({
              package: osv.affected?.[0]?.package?.name || '',
              version: osv.affected?.[0]?.ranges?.[0]?.events?.[0]?.introduced || '',
              severity: normalizeSeverity(
                osv.database_specific?.severity || osv.severity?.[0]?.score > 7 ? 'high' : 'medium'
              ),
              title: osv.summary || osv.id || '',
              cve: osv.aliases?.find((a: string) => a.startsWith('CVE-')) || osv.id || undefined,
              fixVersion: osv.affected?.[0]?.ranges?.[0]?.events?.[1]?.fixed || undefined,
              description: osv.details || osv.summary || '',
            });
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    } catch (_e) {
      logger.debug('govulncheck JSON parse failed');
    }
  }

  return { packageManager: 'go', vulnerabilities: vulns, summary: makeSummary(vulns) };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Scan project dependencies for known vulnerabilities.
 *
 * Auto-detects package managers and runs their respective audit commands.
 * Returns one VulnerabilityReport per detected package manager.
 */
export async function scanDependencies(projectRoot: string): Promise<VulnerabilityReport[]> {
  const resolved = path.resolve(projectRoot);
  const managers = detectPackageManagers(resolved);

  if (managers.length === 0) {
    logger.info('No supported package managers detected');
    return [];
  }

  const reports: VulnerabilityReport[] = [];

  for (const pm of managers) {
    logger.info(`Scanning ${pm} dependencies...`);
    try {
      switch (pm) {
        case 'npm':
          reports.push(auditNpm(resolved));
          break;
        case 'pip':
          reports.push(auditPip(resolved));
          break;
        case 'cargo':
          reports.push(auditCargo(resolved));
          break;
        case 'go':
          reports.push(auditGo(resolved));
          break;
        default:
          logger.debug(`Audit not yet implemented for ${pm}`);
          reports.push({
            packageManager: pm,
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
          });
      }
    } catch (err) {
      logger.error(`Failed to audit ${pm}: ${err instanceof Error ? err.message : String(err)}`);
      reports.push({
        packageManager: pm,
        vulnerabilities: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      });
    }
  }

  return reports;
}

// ============================================================================
// Tool Entry Point
// ============================================================================

/**
 * Execute the scan_vulnerabilities tool.
 */
export async function executeScanVulnerabilities(args: {
  path?: string;
  package_manager?: PackageManager;
}): Promise<ToolResult> {
  try {
    const projectRoot = args.path || process.cwd();
    const reports = await scanDependencies(projectRoot);

    if (reports.length === 0) {
      return {
        success: true,
        output: 'No supported package managers detected in this project.',
      };
    }

    // Optionally filter to a specific package manager
    const filtered = args.package_manager
      ? reports.filter(r => r.packageManager === args.package_manager)
      : reports;

    if (filtered.length === 0) {
      return {
        success: true,
        output: `Package manager "${args.package_manager}" not detected in this project.`,
      };
    }

    const sections: string[] = [];

    for (const report of filtered) {
      const { packageManager: pm, vulnerabilities: vulns, summary } = report;
      const header = `## ${pm.toUpperCase()} (${summary.total} vulnerabilities)`;
      const summaryLine = `  Critical: ${summary.critical} | High: ${summary.high} | Medium: ${summary.medium} | Low: ${summary.low}`;

      if (vulns.length === 0) {
        sections.push(`${header}\n${summaryLine}\n  No known vulnerabilities found.`);
        continue;
      }

      const details = vulns
        .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
        .slice(0, 50) // Cap output
        .map(v =>
          `  [${v.severity.toUpperCase()}] ${v.package}@${v.version}` +
          (v.cve ? ` (${v.cve})` : '') +
          `\n    ${v.title}` +
          (v.fixVersion ? `\n    Fix: upgrade to ${v.fixVersion}` : '')
        )
        .join('\n');

      sections.push(`${header}\n${summaryLine}\n\n${details}`);
    }

    return {
      success: true,
      output: sections.join('\n\n'),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`scan_vulnerabilities error: ${msg}`);
    return { success: false, error: `Vulnerability scan failed: ${msg}` };
  }
}

function severityOrder(s: VulnSeverity): number {
  switch (s) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
  }
}

/**
 * Format reports as a human-readable summary string.
 */
export function formatVulnerabilityReport(reports: VulnerabilityReport[]): string {
  if (reports.length === 0) return 'No package managers detected.';

  const lines: string[] = ['Dependency Vulnerability Scan Results', '='.repeat(40)];

  let totalVulns = 0;
  for (const r of reports) {
    totalVulns += r.summary.total;
    lines.push(`\n${r.packageManager}: ${r.summary.total} vulnerabilities`);
    lines.push(`  Critical: ${r.summary.critical} | High: ${r.summary.high} | Medium: ${r.summary.medium} | Low: ${r.summary.low}`);
  }

  lines.unshift(`Total: ${totalVulns} vulnerabilities across ${reports.length} package manager(s)`);
  return lines.join('\n');
}
