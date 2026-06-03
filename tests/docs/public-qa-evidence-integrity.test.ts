import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const reportPath = 'docs/qa/code-buddy-studio/feature-qa-report.json';
const mainDossierPath = 'docs/qa/code-buddy-studio/feature-qa.md';
const qaHubPath = 'docs/qa/code-buddy-studio/README.md';
const overnightDatasetPath = 'docs/qa/code-buddy-studio/overnight-test-datasets.json';
const overnightCampaignPath = 'docs/qa/code-buddy-studio/overnight-qa-campaign.md';
const screenshotPrefix = 'docs/qa/code-buddy-studio/screenshots/';
const userGuidePaths = [
  'docs/cowork-user-guide.md',
  'docs/cowork-guide-fr.md',
];
const qaHubRunnerProofs: Array<[reportKey: string, hubLabel: string, screenshotRef: string]> = [
  ['testRunnerCliCommandSurfaceBundle', 'CLI command surface', './screenshots/79-test-runner-cli-command-surface-bundle.png'],
  ['testRunnerPluginsSkillsBundle', 'Plugins and skills', './screenshots/80-test-runner-plugins-skills-bundle.png'],
  ['testRunnerTerminalUiObserverBundle', 'Terminal UI and observer', './screenshots/81-test-runner-terminal-ui-observer-bundle.png'],
  ['testRunnerConfigAuthProviderBundle', 'Config, auth, providers', './screenshots/82-test-runner-config-auth-provider-bundle.png'],
  ['testRunnerDataSessionSyncCacheBundle', 'Data, sessions, sync, cache', './screenshots/83-test-runner-data-session-sync-cache-bundle.png'],
  ['testRunnerServerApiMcpPlatformBundle', 'Server, API, MCP platform', './screenshots/84-test-runner-server-api-mcp-platform-bundle.png'],
  ['testRunnerFleetRoutingOrchestrationBundle', 'Fleet routing orchestration', './screenshots/85-test-runner-fleet-routing-orchestration-bundle.png'],
  ['testRunnerContextCompressionPruningBundle', 'Context compression pruning', './screenshots/86-test-runner-context-compression-pruning-bundle.png'],
  ['testRunnerVoiceSpeechTtsBundle', 'Voice, speech, TTS', './screenshots/87-test-runner-voice-speech-tts-bundle.png'],
  ['testRunnerProviderResilienceErrorBundle', 'Provider resilience errors', './screenshots/91-test-runner-provider-resilience-error-bundle.png'],
  ['testRunnerServerProviderErrorStatusBundle', 'Server provider error status', './screenshots/92-test-runner-server-provider-error-status-bundle.png'],
  ['testRunnerInfraMcpSandboxAdaptersBundle', 'Infrastructure MCP sandbox adapters', './screenshots/93-test-runner-infra-mcp-sandbox-adapters-bundle.png'],
  ['testRunnerSchedulerHooksNotificationsBundle', 'Automation scheduler hooks notifications', './screenshots/88-test-runner-scheduler-hooks-notifications-bundle.png'],
  ['testRunnerMaintenanceDoctorBackupSettingsBundle', 'Maintenance doctor backup settings', './screenshots/89-test-runner-maintenance-doctor-backup-settings-bundle.png'],
  ['testRunnerCoworkRemoteControlBundle', 'Remote control', './screenshots/94-test-runner-remote-control-bundle.png'],
  ['testRunnerDeviceTransportAdaptersBundle', 'Device transport adapters', './screenshots/95-test-runner-device-transport-adapters-bundle.png'],
  ['testRunnerCoworkSandboxExecutorBundle', 'Cowork sandbox executor', './screenshots/96-test-runner-cowork-sandbox-executor-bundle.png'],
  ['testRunnerCoworkProjectSessionGitBundle', 'Project, session, and git', './screenshots/97-test-runner-project-session-git-bundle.png'],
  ['testRunnerCoworkUiLocalizationLayoutBundle', 'Cowork UI localization layout', './screenshots/98-test-runner-ui-localization-layout-bundle.png'],
  ['testRunnerCoworkActivityAuditDiagnosticsBundle', 'Activity, audit, diagnostics', './screenshots/102-test-runner-activity-audit-diagnostics-bundle.png'],
  ['testRunnerCoworkFleetCommandTeamBundle', 'Fleet command and team', './screenshots/103-test-runner-fleet-command-team-bundle.png'],
  ['testRunnerCoworkPermissionPathRulesBundle', 'Permission path rules', './screenshots/104-test-runner-permission-path-rules-bundle.png'],
  ['testRunnerCoworkSettingsHooksMcpWorkflowsBundle', 'Settings, hooks, MCP, workflows', './screenshots/105-test-runner-settings-hooks-mcp-workflows-bundle.png'],
  ['testRunnerCoworkCustomCommandsSlashBundle', 'Custom commands and slash', './screenshots/106-test-runner-custom-commands-slash-bundle.png'],
];
const userGuideRunnerProofs: Array<[reportKey: string, runnerRow: string]> = [
  ['testRunnerPluginsSkillsBundle', 'Plugins / skills bundle'],
  ['testRunnerTerminalUiObserverBundle', 'UI / terminal observer bundle'],
  ['testRunnerDataSessionSyncCacheBundle', 'Data / session sync cache bundle'],
  ['testRunnerVoiceSpeechTtsBundle', 'Voice / speech TTS bundle'],
  ['testRunnerSchedulerHooksNotificationsBundle', 'Automation / scheduler hooks notifications bundle'],
  ['testRunnerMaintenanceDoctorBackupSettingsBundle', 'Maintenance / doctor backup settings bundle'],
];
const userGuideNarrativeProofs: Array<[reportKey: string, screenshotRef: string]> = [
  ['testRunnerCoworkLocalProviderConfigBundle', './qa/code-buddy-studio/screenshots/101-test-runner-local-provider-config-bundle.png'],
  ['testRunnerCoworkIpcChat', './qa/code-buddy-studio/screenshots/59-test-runner-cowork-ipc-chat.png'],
  ['testRunnerWorkflowBridgeIntegration', './qa/code-buddy-studio/screenshots/54-test-runner-workflow-integration.png'],
  ['testRunnerComputerUseRealSuite', './qa/code-buddy-studio/screenshots/108-test-runner-computer-use-real-suite.png'],
];

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

function collectJsonScreenshotRefs(
  value: unknown,
  pathParts: string[] = [],
): Array<{ jsonPath: string; value: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectJsonScreenshotRefs(item, [...pathParts, String(index)]));
  }
  if (!value || typeof value !== 'object') return [];

  const refs: Array<{ jsonPath: string; value: unknown }> = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (/screenshot/i.test(key)) {
      refs.push({ jsonPath: childPath.join('.'), value: child });
    }
    refs.push(...collectJsonScreenshotRefs(child, childPath));
  }
  return refs;
}

function collectJsonPublicationEvidenceRefs(
  value: unknown,
  pathParts: string[] = [],
): Array<{ jsonPath: string; value: string }> {
  const evidenceKeyPattern = /^(expected(Marker|Markers|MarkerAbsent|Text|Result|Output|Status|Safety)|dockerRuntimeMarker)$/i;
  const collectStringLeaves = (leaf: unknown, jsonPath: string): Array<{ jsonPath: string; value: string }> => {
    if (typeof leaf === 'string') return [{ jsonPath, value: leaf }];
    if (Array.isArray(leaf)) {
      return leaf.flatMap((item, index) => collectStringLeaves(item, `${jsonPath}.${index}`));
    }
    if (leaf && typeof leaf === 'object') {
      return Object.entries(leaf).flatMap(([key, child]) => collectStringLeaves(child, `${jsonPath}.${key}`));
    }
    return [];
  };

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectJsonPublicationEvidenceRefs(item, [...pathParts, String(index)]));
  }
  if (!value || typeof value !== 'object') return [];

  const refs: Array<{ jsonPath: string; value: string }> = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (evidenceKeyPattern.test(key)) {
      refs.push(...collectStringLeaves(child, childPath.join('.')));
    }
    refs.push(...collectJsonPublicationEvidenceRefs(child, childPath));
  }
  return refs;
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

function qaHubRunnerProofCount(qaHub: string, hubLabel: string): number {
  const row = qaHub.split(/\r?\n/).find((line) => line.startsWith(`| ${hubLabel} |`));
  expect(row, `${qaHubPath} must include ${hubLabel} runner proof row`).toBeDefined();

  const cells = row?.split('|').map((cell) => cell.trim()) ?? [];
  const proofCell = cells.at(-2);
  const match = proofCell?.match(/^`(\d+) ok \/ 0 ko`$/);

  expect(match, `${qaHubPath} ${hubLabel} row must include a runner proof count`).toBeDefined();
  return Number(match?.[1]);
}

function guideRunnerProofCount(guide: string, docPath: string, runnerRow: string): number {
  const row = guide.split(/\r?\n/).find((line) => line.includes(`| \`${runnerRow}\` |`));
  expect(row, `${docPath} must include ${runnerRow} proof row`).toBeDefined();

  const cells = row?.split('|').map((cell) => cell.trim()) ?? [];
  const proofCell = cells.at(-2);
  const match = proofCell?.match(/^`(\d+) ok \/ 0 ko`, \[capture\]\(\.\/qa\/code-buddy-studio\/screenshots\/[^)]+\.png\)$/);

  expect(match, `${docPath} ${runnerRow} row must include a screenshot-backed runner count`).toBeDefined();
  return Number(match?.[1]);
}

function guideNarrativeProofCount(guide: string, docPath: string, screenshotRef: string): number {
  const screenshotIndex = guide.indexOf(screenshotRef);
  expect(screenshotIndex, `${docPath} must include ${screenshotRef}`).toBeGreaterThanOrEqual(0);

  const nearbyText = guide.slice(Math.max(0, screenshotIndex - 1000), screenshotIndex);
  const matches = [...nearbyText.matchAll(/\b(\d+) ok \/ 0 ko\b/g)];
  expect(matches.length, `${docPath} must include a runner proof count before ${screenshotRef}`).toBeGreaterThan(0);

  return Number(matches.at(-1)?.[1]);
}

function collectGuidePngRefs(markdown: string): string[] {
  const refs = new Set<string>();
  for (const match of markdown.matchAll(/!\[[^\]]*]\(([^)]+\.png)\)/g)) {
    if (match[1]) refs.add(match[1].trim());
  }
  for (const match of markdown.matchAll(/\[[^\]]*]\(([^)]+\.png)\)/g)) {
    if (match[1]) refs.add(match[1].trim());
  }
  for (const match of markdown.matchAll(/<img\s+[^>]*src=["']([^"']+\.png)["'][^>]*>/gi)) {
    if (match[1]) refs.add(match[1].trim());
  }
  return [...refs].sort();
}

function collectFencedCommandBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```(?:bash|sh|powershell)?\r?\n([\s\S]*?)```/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((block) => block !== '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectQaHubRunnerProof(qaHub: string, report: QaReport, reportKey: string, hubLabel: string): void {
  expect(qaHubRunnerProofCount(qaHub, hubLabel)).toBe(reportedRunnerProofCount(report, reportKey));
}

function expectQaHubRunnerCapture(qaHub: string, hubLabel: string, screenshotRef: string): void {
  const representativeCapturesIndex = qaHub.indexOf('## Representative Captures');
  expect(representativeCapturesIndex, `${qaHubPath} must include Representative Captures`).toBeGreaterThanOrEqual(0);

  const representativeCaptures = qaHub.slice(representativeCapturesIndex);
  const imagePattern = new RegExp(`!\\[[^\\]]+]\\(${escapeRegExp(screenshotRef)}\\)`);
  expect(
    imagePattern.test(representativeCaptures),
    `${qaHubPath} must include a representative capture for ${hubLabel}: ${screenshotRef}`,
  ).toBe(true);
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

    const qaHubDir = path.dirname(path.join(repoRoot, qaHubPath));
    for (const [reportKey, hubLabel, screenshotRef] of qaHubRunnerProofs) {
      expectQaHubRunnerProof(qaHub, report, reportKey, hubLabel);
      expectQaHubRunnerCapture(qaHub, hubLabel, screenshotRef);

      const absoluteTarget = path.resolve(qaHubDir, screenshotRef);
      expect(absoluteTarget.startsWith(repoRoot), `${screenshotRef} must stay inside the repository`).toBe(true);
      expect(await exactCasePathExists(absoluteTarget), `${screenshotRef} must exist with exact casing`).toBe(true);
    }
  });

  it('keeps user guide safe bundle proofs aligned with the machine-readable report', async () => {
    const report = await readQaReport();

    for (const docPath of userGuidePaths) {
      const guide = await fs.readFile(path.join(repoRoot, docPath), 'utf8');
      for (const [reportKey, runnerRow] of userGuideRunnerProofs) {
        expect(guideRunnerProofCount(guide, docPath, runnerRow)).toBe(
          reportedRunnerProofCount(report, reportKey),
        );
      }
    }
  });

  it('keeps user guide narrative proofs aligned with the machine-readable report', async () => {
    const report = await readQaReport();

    for (const docPath of userGuidePaths) {
      const guide = await fs.readFile(path.join(repoRoot, docPath), 'utf8');
      for (const [reportKey, screenshotRef] of userGuideNarrativeProofs) {
        expect(guideNarrativeProofCount(guide, docPath, screenshotRef)).toBe(
          reportedRunnerProofCount(report, reportKey),
        );
      }
    }
  });

  it('keeps English and French user guides aligned on visual and command evidence', async () => {
    const [englishGuide, frenchGuide] = await Promise.all(
      userGuidePaths.map((docPath) => fs.readFile(path.join(repoRoot, docPath), 'utf8')),
    );

    expect(collectGuidePngRefs(frenchGuide)).toEqual(collectGuidePngRefs(englishGuide));
    expect(collectFencedCommandBlocks(frenchGuide)).toEqual(collectFencedCommandBlocks(englishGuide));
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

  it('keeps every overnight dataset screenshot present and visible in the overnight campaign', async () => {
    const dataset = JSON.parse(await fs.readFile(path.join(repoRoot, overnightDatasetPath), 'utf8')) as unknown;
    const campaign = await fs.readFile(path.join(repoRoot, overnightCampaignPath), 'utf8');
    const refs = collectJsonScreenshotRefs(dataset);
    const findings: string[] = [];

    expect(refs.length).toBeGreaterThan(0);

    for (const ref of refs) {
      if (typeof ref.value !== 'string') {
        findings.push(`${ref.jsonPath}: expected screenshot path string`);
        continue;
      }
      if (!ref.value.startsWith(screenshotPrefix) || !ref.value.endsWith('.png')) {
        findings.push(`${ref.jsonPath}: unsafe screenshot path ${ref.value}`);
        continue;
      }

      const absoluteTarget = path.resolve(repoRoot, ref.value);
      if (!absoluteTarget.startsWith(repoRoot) || !(await exactCasePathExists(absoluteTarget))) {
        findings.push(`${ref.jsonPath}: missing screenshot ${ref.value}`);
      }

      const campaignRef = toMainDossierScreenshotRef(ref.value);
      if (!campaign.includes(campaignRef)) {
        findings.push(`${overnightCampaignPath}: missing ${campaignRef} for ${ref.jsonPath}`);
      }
    }

    expect(findings).toEqual([]);
  });

  it('keeps every overnight dataset expected evidence marker visible in the overnight campaign', async () => {
    const dataset = JSON.parse(await fs.readFile(path.join(repoRoot, overnightDatasetPath), 'utf8')) as unknown;
    const campaign = await fs.readFile(path.join(repoRoot, overnightCampaignPath), 'utf8');
    const refs = collectJsonPublicationEvidenceRefs(dataset);
    const missing = refs
      .filter((ref) => !campaign.includes(ref.value))
      .map((ref) => `${ref.jsonPath}: ${ref.value}`);

    expect(refs.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
