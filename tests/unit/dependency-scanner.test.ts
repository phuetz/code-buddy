/**
 * Dependency Vulnerability Scanner Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
    },
    existsSync: vi.fn(),
  };
});

import {
  detectPackageManagers,
  scanDependencies,
  executeScanVulnerabilities,
  formatVulnerabilityReport,
  type VulnerabilityReport,
} from '../../src/security/dependency-vuln-scanner.js';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

describe('detectPackageManagers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('should detect npm from package.json', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('package.json')
    );
    const managers = detectPackageManagers('/project');
    expect(managers).toContain('npm');
  });

  it('should detect pip from requirements.txt', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('requirements.txt')
    );
    const managers = detectPackageManagers('/project');
    expect(managers).toContain('pip');
  });

  it('should detect cargo from Cargo.toml', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('Cargo.toml')
    );
    const managers = detectPackageManagers('/project');
    expect(managers).toContain('cargo');
  });

  it('should detect go from go.mod', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('go.mod')
    );
    const managers = detectPackageManagers('/project');
    expect(managers).toContain('go');
  });

  it('should detect gem from Gemfile', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('Gemfile')
    );
    const managers = detectPackageManagers('/project');
    expect(managers).toContain('gem');
  });

  it('should detect multiple managers', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('package.json') || p.endsWith('Cargo.toml')
    );
    const managers = detectPackageManagers('/project');
    expect(managers).toContain('npm');
    expect(managers).toContain('cargo');
    expect(managers).toHaveLength(2);
  });

  it('should return empty array when no managers detected', () => {
    const managers = detectPackageManagers('/empty');
    expect(managers).toHaveLength(0);
  });
});

describe('scanDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('should return empty array when no package managers found', async () => {
    const reports = await scanDependencies('/empty');
    expect(reports).toHaveLength(0);
  });

  it('should parse npm audit v7 format', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('package.json')
    );

    const npmAuditOutput = JSON.stringify({
      vulnerabilities: {
        'lodash': {
          name: 'lodash',
          severity: 'high',
          range: '< 4.17.21',
          title: 'Prototype Pollution',
          via: [{ title: 'Prototype Pollution in lodash', url: 'https://nvd.nist.gov/CVE-2021-23337' }],
          fixAvailable: { version: '4.17.21' },
        },
      },
    });

    (execSync as ReturnType<typeof vi.fn>).mockReturnValue(npmAuditOutput);

    const reports = await scanDependencies('/project');
    expect(reports).toHaveLength(1);
    expect(reports[0].packageManager).toBe('npm');
    expect(reports[0].vulnerabilities).toHaveLength(1);
    expect(reports[0].vulnerabilities[0].package).toBe('lodash');
    expect(reports[0].vulnerabilities[0].severity).toBe('high');
    expect(reports[0].summary.high).toBe(1);
  });

  it('should handle npm audit failure gracefully', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('package.json')
    );

    // npm audit exits non-zero when vulns found
    const error = new Error('npm audit exit 1');
    (error as Record<string, unknown>).stdout = JSON.stringify({
      vulnerabilities: {
        'express': { severity: 'critical', range: '< 4.18', title: 'Open Redirect', via: [] },
      },
    });
    (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw error; });

    const reports = await scanDependencies('/project');
    expect(reports).toHaveLength(1);
    expect(reports[0].vulnerabilities).toHaveLength(1);
    expect(reports[0].vulnerabilities[0].severity).toBe('critical');
  });

  it('should record an audit error when audit command output is unavailable', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('package.json')
    );
    (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('not found'); });

    const reports = await scanDependencies('/project');
    expect(reports).toHaveLength(1);
    expect(reports[0].vulnerabilities).toHaveLength(0);
    expect(reports[0].summary.total).toBe(0);
    expect(reports[0].auditError).toContain('npm audit --json failed');
    expect(reports[0].auditError).toContain('not found');
  });
});

describe('executeScanVulnerabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('should return message when no package managers detected', async () => {
    const result = await executeScanVulnerabilities({});
    expect(result.success).toBe(true);
    expect(result.output).toContain('No supported package managers');
  });

  it('should filter by specific package manager', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('package.json') || p.endsWith('Cargo.toml')
    );
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue('{}');

    const result = await executeScanVulnerabilities({ package_manager: 'npm' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('NPM');
    expect(result.output).not.toContain('CARGO');
  });

  it('should report undetected package manager', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('package.json')
    );
    (execSync as ReturnType<typeof vi.fn>).mockReturnValue('{}');

    const result = await executeScanVulnerabilities({ package_manager: 'cargo' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('not detected');
  });

  it('should fail when a detected package manager cannot be audited', async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
      p.endsWith('package.json')
    );
    (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('npm audit missing'); });

    const result = await executeScanVulnerabilities({ package_manager: 'npm' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Vulnerability scan incomplete');
    expect(result.error).toContain('npm audit missing');
    expect(result.output).toContain('Audit failed');
  });
});

describe('formatVulnerabilityReport', () => {
  it('should format empty reports', () => {
    const output = formatVulnerabilityReport([]);
    expect(output).toContain('No package managers');
  });

  it('should format reports with vulnerabilities', () => {
    const reports: VulnerabilityReport[] = [{
      packageManager: 'npm',
      vulnerabilities: [
        { package: 'foo', version: '1.0', severity: 'high', title: 'Bad', description: 'Very bad' },
        { package: 'bar', version: '2.0', severity: 'low', title: 'Minor', description: 'Not so bad' },
      ],
      summary: { critical: 0, high: 1, medium: 0, low: 1, total: 2 },
    }];

    const output = formatVulnerabilityReport(reports);
    expect(output).toContain('npm');
    expect(output).toContain('2 vulnerabilities');
    expect(output).toContain('High: 1');
  });

  it('should include audit errors in formatted reports', () => {
    const reports: VulnerabilityReport[] = [{
      packageManager: 'npm',
      vulnerabilities: [],
      auditError: 'npm audit unavailable',
      summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    }];

    const output = formatVulnerabilityReport(reports);

    expect(output).toContain('Audit failed: npm audit unavailable');
  });

  it('should show total across multiple package managers', () => {
    const reports: VulnerabilityReport[] = [
      {
        packageManager: 'npm',
        vulnerabilities: [],
        summary: { critical: 0, high: 0, medium: 1, low: 0, total: 1 },
      },
      {
        packageManager: 'pip',
        vulnerabilities: [],
        summary: { critical: 1, high: 0, medium: 0, low: 0, total: 1 },
      },
    ];

    const output = formatVulnerabilityReport(reports);
    expect(output).toContain('2 vulnerabilities');
    expect(output).toContain('2 package manager(s)');
  });
});
