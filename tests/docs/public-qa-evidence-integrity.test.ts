import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const reportPath = 'docs/qa/code-buddy-studio/feature-qa-report.json';
const mainDossierPath = 'docs/qa/code-buddy-studio/feature-qa.md';
const qaHubPath = 'docs/qa/code-buddy-studio/README.md';
const screenshotPrefix = 'docs/qa/code-buddy-studio/screenshots/';

type QaReportResult = {
  slug?: unknown;
  label?: unknown;
  action?: unknown;
  ok?: unknown;
  verification?: {
    ok?: unknown;
    proof?: unknown;
  };
  error?: unknown;
  screenshot?: unknown;
};

type QaReport = {
  generatedAt?: unknown;
  baseUrl?: unknown;
  total?: unknown;
  passed?: unknown;
  failed?: unknown;
  verificationSummary?: Record<string, unknown>;
  functionalCoverage?: {
    total?: unknown;
    real?: unknown;
    used?: unknown;
    partial?: unknown;
  };
  results?: unknown;
};

async function readQaReport(): Promise<QaReport> {
  const content = await fs.readFile(path.join(repoRoot, reportPath), 'utf8');
  return JSON.parse(content) as QaReport;
}

async function exactCasePathExists(absolutePath: string): Promise<boolean> {
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false;
  if (!relativePath || relativePath === '.') return true;

  const parts = relativePath.split(path.sep).filter(Boolean);
  let current = repoRoot;
  for (const part of parts) {
    const entries = await fs.readdir(current);
    const matchedName = entries.find((entry) => entry === part);
    if (!matchedName) return false;
    current = path.join(current, matchedName);
  }
  return true;
}

function asResults(report: QaReport): QaReportResult[] {
  expect(Array.isArray(report.results), `${reportPath} results must be an array`).toBe(true);
  return report.results as QaReportResult[];
}

function asNumber(value: unknown, label: string): number {
  expect(typeof value, `${label} must be a number`).toBe('number');
  return value as number;
}

function asString(value: unknown, label: string): string {
  expect(typeof value, `${label} must be a string`).toBe('string');
  return value as string;
}

function toMainDossierScreenshotRef(screenshot: string): string {
  return screenshot.replace('docs/qa/code-buddy-studio/', './');
}

function reportedRunnerProofCount(report: QaReport, reportKey: string): number {
  const summary = asString(
    report.verificationSummary?.[reportKey],
    `verificationSummary.${reportKey}`,
  );
  const match = summary.match(/\b(?:reported|reports) (\d+) ok \/ 0 ko/);

  expect(match, `verificationSummary.${reportKey} must include reported runner count`).not.toBeNull();
  return Number(match?.[1]);
}

function expectQaHubRunnerProof(qaHub: string, report: QaReport, reportKey: string, hubLabel: string): void {
  const count = reportedRunnerProofCount(report, reportKey);

  expect(qaHub).toContain(`| ${hubLabel} |`);
  expect(qaHub).toContain(`| \`${count} ok / 0 ko\` |`);
}

describe('public QA evidence report integrity', () => {
  it('keeps report totals, pass counts, and functional coverage aligned', async () => {
    const report = await readQaReport();
    const results = asResults(report);
    const failed = Array.isArray(report.failed) ? report.failed : [];
    const total = asNumber(report.total, 'report.total');
    const passed = asNumber(report.passed, 'report.passed');
    const coverageTotal = asNumber(report.functionalCoverage?.total, 'functionalCoverage.total');
    const coverageReal = asNumber(report.functionalCoverage?.real, 'functionalCoverage.real');
    const coverageUsed = asNumber(report.functionalCoverage?.used, 'functionalCoverage.used');
    const coveragePartial = asNumber(report.functionalCoverage?.partial, 'functionalCoverage.partial');
    const okCount = results.filter((result) => result.ok === true).length;

    expect(new Date(asString(report.generatedAt, 'generatedAt')).toString()).not.toBe('Invalid Date');
    expect(asString(report.baseUrl, 'baseUrl')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(total).toBe(results.length);
    expect(passed).toBe(okCount);
    expect(failed).toEqual([]);
    expect(coverageTotal).toBe(total);
    expect(coverageReal + coverageUsed + coveragePartial).toBe(total);
  });

  it('keeps the public QA hub snapshot aligned with the machine-readable report', async () => {
    const report = await readQaReport();
    const qaHub = await fs.readFile(path.join(repoRoot, qaHubPath), 'utf8');
    const total = asNumber(report.total, 'report.total');
    const passed = asNumber(report.passed, 'report.passed');
    const coverageReal = asNumber(report.functionalCoverage?.real, 'functionalCoverage.real');
    const coverageUsed = asNumber(report.functionalCoverage?.used, 'functionalCoverage.used');
    const coveragePartial = asNumber(report.functionalCoverage?.partial, 'functionalCoverage.partial');

    expect(qaHub).toContain(`${passed} / ${total} passed`);
    expect(qaHub).toContain(`${coverageReal} real, ${coverageUsed} used, ${coveragePartial} partial`);
    expect(qaHub).toContain('./feature-qa-report.json');
    expect(qaHub).toContain('npm run test:docs-public');
    expectQaHubRunnerProof(
      qaHub,
      report,
      'testRunnerCliCommandSurfaceBundle',
      'CLI command surface',
    );
    expectQaHubRunnerProof(
      qaHub,
      report,
      'testRunnerPluginsSkillsBundle',
      'Plugins and skills',
    );
    expectQaHubRunnerProof(
      qaHub,
      report,
      'testRunnerDataSessionSyncCacheBundle',
      'Data, sessions, sync, cache',
    );
    expectQaHubRunnerProof(
      qaHub,
      report,
      'testRunnerServerApiMcpPlatformBundle',
      'Server, API, MCP platform',
    );
    expectQaHubRunnerProof(
      qaHub,
      report,
      'testRunnerCoworkUiLocalizationLayoutBundle',
      'Cowork UI localization layout',
    );
  });

  it('keeps every result uniquely identified and positively verified', async () => {
    const report = await readQaReport();
    const results = asResults(report);
    const slugs = new Set<string>();
    const findings: string[] = [];

    for (const result of results) {
      const slug = typeof result.slug === 'string' ? result.slug : '';
      const label = typeof result.label === 'string' ? result.label : '';
      if (!/^\d{2}-[a-z0-9-]+$/.test(slug)) findings.push(`invalid slug: ${String(result.slug)}`);
      if (!label.trim()) findings.push(`${slug || '<missing>'}: missing label`);
      if (slugs.has(slug)) findings.push(`${slug}: duplicate slug`);
      if (result.ok !== true) findings.push(`${slug}: result ok is not true`);
      if (result.verification?.ok !== true) findings.push(`${slug}: verification ok is not true`);
      if (typeof result.verification?.proof !== 'string' || !result.verification.proof.trim()) {
        findings.push(`${slug}: missing verification proof`);
      }
      if (result.error !== null) findings.push(`${slug}: expected null error`);
      slugs.add(slug);
    }

    expect(findings).toEqual([]);
  });

  it('keeps the public Chat UI row backed by the real IPC runner proof', async () => {
    const report = await readQaReport();
    const results = asResults(report);
    const chatResult = results.find((result) => result.label === 'Chat UI');

    expect(chatResult, 'Chat UI result must exist').toBeDefined();
    expect(chatResult?.slug).toBe('28-chat-ui-ipc');
    expect(chatResult?.action).toBe('launch Cowork / IPC chat flow from Tests & executions');
    expect(chatResult?.verification?.proof).toContain('Cowork / IPC chat flow');
    expect(chatResult?.verification?.proof).toContain('OK-CHAT-IPC continue');
    expect(chatResult?.verification?.proof).not.toContain('Mock response to');
    expect(chatResult?.screenshot).toBe(
      'docs/qa/code-buddy-studio/screenshots/59-test-runner-cowork-ipc-chat.png',
    );
  });

  it('keeps every machine-readable screenshot path relative, present, and exact-case', async () => {
    const report = await readQaReport();
    const results = asResults(report);
    const findings: string[] = [];

    for (const result of results) {
      const slug = typeof result.slug === 'string' ? result.slug : '<missing>';
      const screenshot = typeof result.screenshot === 'string' ? result.screenshot : '';
      if (!screenshot.startsWith(screenshotPrefix) || !screenshot.endsWith('.png')) {
        findings.push(`${slug}: unsafe screenshot path ${String(result.screenshot)}`);
        continue;
      }
      const absoluteTarget = path.resolve(repoRoot, screenshot);
      if (!absoluteTarget.startsWith(repoRoot) || !(await exactCasePathExists(absoluteTarget))) {
        findings.push(`${slug}: missing screenshot ${screenshot}`);
      }
    }

    expect(findings).toEqual([]);
  });

  it('keeps every machine-readable screenshot visible in the main QA dossier', async () => {
    const report = await readQaReport();
    const results = asResults(report);
    const mainDossier = await fs.readFile(path.join(repoRoot, mainDossierPath), 'utf8');
    const findings: string[] = [];
    const screenshots = new Set(
      results
        .map((result) => (typeof result.screenshot === 'string' ? result.screenshot : ''))
        .filter((screenshot) => screenshot !== ''),
    );

    for (const screenshot of screenshots) {
      const markdownRef = toMainDossierScreenshotRef(screenshot);
      if (!mainDossier.includes(markdownRef)) {
        findings.push(`${mainDossierPath}: missing ${markdownRef}`);
      }
    }

    expect(findings).toEqual([]);
  });
});
