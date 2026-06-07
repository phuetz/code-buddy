/**
 * TestRunnerBridge — Claude Cowork parity Phase 3 step 12
 *
 * Wraps the core `AutoTestManager` to drive test runs from the Cowork
 * renderer. Detects the project test framework on construction, exposes
 * `run()` / `runFiles()` / `runFailing()` methods, and streams test
 * progress events so the `TestRunnerPanel` can show live results.
 *
 * Core integration is lazy: when the core module is unavailable the
 * bridge falls back to a minimal spawn-based runner that supports
 * `npm test` / `pnpm test` / `yarn test` detection for Node projects.
 *
 * @module main/testing/test-runner-bridge
 */

import { EventEmitter } from 'events';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';

export interface TestCase {
  name: string;
  suite: string;
  file?: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration: number;
  error?: string;
  stack?: string;
}

export interface TestResult {
  success: boolean;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  framework: string;
  tests: TestCase[];
}

export type TestCatalogKind = 'quality' | 'unit' | 'integration' | 'e2e' | 'real-provider' | 'script';

export interface TestCatalogItem {
  id: string;
  label: string;
  group: string;
  description: string;
  command: string;
  args: string[];
  cwd: string;
  kind: TestCatalogKind;
  safeToRun: boolean;
  requiresEnv?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface TestRunnerState {
  framework: string | null;
  lastResult: TestResult | null;
  isRunning: boolean;
  catalog: TestCatalogItem[];
}

interface CoreAutoTestManagerLike extends EventEmitter {
  runAllTests(): Promise<TestResult>;
  runTestFiles(files: string[]): Promise<TestResult>;
  getLastResults?(): TestResult | null;
  refresh?(): void;
}

interface CoreAutoTestModule {
  getAutoTestManager: (workingDirectory?: string, config?: Record<string, unknown>) => CoreAutoTestManagerLike;
  initializeAutoTest: (workingDirectory: string, config?: Record<string, unknown>) => CoreAutoTestManagerLike;
}

let cachedCoreModule: CoreAutoTestModule | null = null;

interface CoreRunStoreLike {
  startRun(objective: string, metadata?: Record<string, unknown>): string;
  emit(runId: string, event: { type: string; data: Record<string, unknown> }): void;
  saveArtifact?(runId: string, name: string, content: string): string;
  updateMetrics?(runId: string, metrics: Record<string, number>): void;
  endRun(runId: string, status: 'completed' | 'failed' | 'cancelled'): void;
}

interface CoreRunStoreModule {
  RunStore: {
    getInstance: () => CoreRunStoreLike;
  };
}

interface TestAuditRecorder {
  runId: string;
  emit(type: string, data: Record<string, unknown>): void;
  saveArtifact(name: string, content: string): void;
  end(status: 'completed' | 'failed' | 'cancelled', metrics?: Record<string, number>): void;
}

let cachedRunStoreModule: CoreRunStoreModule | null = null;

const DEFAULT_SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;

function getScriptTimeoutMs(): number {
  const raw = process.env.CODEBUDDY_TEST_RUNNER_SCRIPT_TIMEOUT_MS;
  if (!raw) return DEFAULT_SCRIPT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 100) return DEFAULT_SCRIPT_TIMEOUT_MS;
  return parsed;
}

async function loadCoreAutoTest(): Promise<CoreAutoTestModule | null> {
  if (cachedCoreModule) return cachedCoreModule;
  const mod = await loadCoreModule<CoreAutoTestModule>('testing/auto-test.js');
  if (mod) {
    cachedCoreModule = mod;
    log('[TestRunnerBridge] Core auto-test loaded');
  }
  return mod;
}

async function loadCoreRunStore(): Promise<CoreRunStoreModule | null> {
  if (cachedRunStoreModule) return cachedRunStoreModule;
  const mod = await loadCoreModule<CoreRunStoreModule>('observability/run-store.js');
  if (mod?.RunStore?.getInstance) {
    cachedRunStoreModule = mod;
    log('[TestRunnerBridge] Core run store loaded');
  }
  return cachedRunStoreModule;
}

interface PackageJsonLike {
  name?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

function readPackageJson(cwd: string): PackageJsonLike | null {
  const pkgPath = path.join(cwd, 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    return JSON.parse(raw) as PackageJsonLike;
  } catch {
    return null;
  }
}

function detectFallbackFramework(cwd: string): { framework: string; command: string; args: string[] } | null {
  const pkg = readPackageJson(cwd);
  if (!pkg) return null;
  const deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  if ('vitest' in deps) {
    return { framework: 'Vitest', command: 'npx', args: ['vitest', 'run', '--reporter=verbose'] };
  }
  if ('jest' in deps) {
    return { framework: 'Jest', command: 'npx', args: ['jest', '--passWithNoTests'] };
  }
  if ('mocha' in deps) {
    return { framework: 'Mocha', command: 'npx', args: ['mocha'] };
  }
  if (pkg.scripts?.test) {
    return { framework: 'npm test', command: 'npm', args: ['test', '--silent'] };
  }
  return null;
}

function pathToId(input: string): string {
  return input
    .replace(/^[a-zA-Z]:/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function classifyScript(scriptName: string): { group: string; kind: TestCatalogKind; safeToRun: boolean } {
  const lower = scriptName.toLowerCase();
  if (lower.includes('watch') || lower.includes('fix')) {
    return { group: 'Manual', kind: 'script', safeToRun: false };
  }
  if (lower.includes('lint')) return { group: 'Qualite', kind: 'quality', safeToRun: true };
  if (lower.includes('typecheck') || lower.startsWith('check:')) {
    return { group: 'Types', kind: 'quality', safeToRun: true };
  }
  if (lower.includes('e2e') || lower.includes('playwright')) {
    return { group: 'E2E', kind: 'e2e', safeToRun: false };
  }
  if (lower.includes('integration')) return { group: 'Integration', kind: 'integration', safeToRun: true };
  if (lower.includes('test')) return { group: 'Tests', kind: 'unit', safeToRun: true };
  if (lower.includes('validate')) return { group: 'Validation', kind: 'quality', safeToRun: true };
  return { group: 'Scripts', kind: 'script', safeToRun: false };
}

function isQaScript(scriptName: string): boolean {
  const lower = scriptName.toLowerCase();
  if (lower.includes('watch') || lower.includes('fix')) return false;
  return /^(test|test:|lint|typecheck|validate|check:|pre-build-check|build:e2e)/i.test(scriptName);
}

function makeScriptCatalogItems(cwd: string, labelPrefix = ''): TestCatalogItem[] {
  const pkg = readPackageJson(cwd);
  if (!pkg?.scripts) return [];
  return Object.keys(pkg.scripts)
    .filter(isQaScript)
    .sort((a, b) => a.localeCompare(b))
    .map((scriptName) => {
      const classified = classifyScript(scriptName);
      const label = `${labelPrefix}${scriptName}`;
      return {
        id: `script-${pathToId(path.relative(cwd, path.join(cwd, scriptName)) || scriptName)}-${pathToId(label)}`,
        label,
        group: classified.group,
        description: `npm run ${scriptName}`,
        command: 'npm',
        args: ['run', scriptName],
        cwd,
        kind: classified.kind,
        safeToRun: classified.safeToRun,
        timeoutMs: getScriptTimeoutMs(),
      };
    });
}

function addIfFileExists(items: TestCatalogItem[], item: TestCatalogItem, filePath: string): void {
  if (fs.existsSync(filePath)) {
    items.push(item);
  }
}

function addIfFilesExist(items: TestCatalogItem[], item: TestCatalogItem, filePaths: string[]): void {
  if (filePaths.every((filePath) => fs.existsSync(filePath))) {
    items.push(item);
  }
}

function parseFallbackCounts(
  output: string,
  code: number | null
): Pick<TestResult, 'passed' | 'failed' | 'skipped' | 'total'> {
  const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const cleanOutput = output.replace(ansiEscapePattern, '');
  const testsSummaries = Array.from(
    cleanOutput.matchAll(/(?:^|\s)Tests\s+([\s\S]*?)(?=\r?\n|\s+Start at\b|\s+Duration\b|$)/gi)
  )
    .map((match) => match[1] ?? '')
    .filter((summary) => /\d+\s+(?:passed|failed|skipped|pending|todo)/i.test(summary));
  const testsSummary = testsSummaries.at(-1);
  if (testsSummary) {
    const passedSummaryMatch = testsSummary.match(/(\d+)\s+passed/i);
    const failedSummaryMatch = testsSummary.match(/(\d+)\s+failed/i);
    const skippedSummaryMatch = testsSummary.match(/(\d+)\s+(?:skipped|pending|todo)/i);
    const passed = passedSummaryMatch ? Number(passedSummaryMatch[1]) : 0;
    const failed = failedSummaryMatch ? Number(failedSummaryMatch[1]) : 0;
    const skipped = skippedSummaryMatch ? Number(skippedSummaryMatch[1]) : 0;
    if (passed + failed + skipped > 0) {
      return { passed, failed, skipped, total: passed + failed + skipped };
    }
  }
  const passedMatch = cleanOutput.match(/(\d+)\s+pass(?:ed|ing)?/i);
  const failedMatch = cleanOutput.match(/(\d+)\s+fail(?:ed|ing)?/i);
  const skippedMatch = cleanOutput.match(/(\d+)\s+skip(?:ped)?/i);
  const passed = passedMatch ? Number(passedMatch[1]) : code === 0 ? 1 : 0;
  const failed = failedMatch ? Number(failedMatch[1]) : code === 0 ? 0 : 1;
  const skipped = skippedMatch ? Number(skippedMatch[1]) : 0;
  return { passed, failed, skipped, total: passed + failed + skipped };
}

function quoteWindowsCommandPart(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./\\-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildSpawnInvocation(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args };
  const line = [command, ...args].map(quoteWindowsCommandPart).join(' ');
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', line] };
}

function buildSpawnEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.startsWith('=') || value === undefined) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    env[key] = value;
  }
  return env;
}

export class TestRunnerBridge extends EventEmitter {
  private workspaceDir: string | null = null;
  private framework: string | null = null;
  private lastResult: TestResult | null = null;
  private activeProcess: ChildProcess | null = null;
  private coreManager: CoreAutoTestManagerLike | null = null;
  private cancellationRequested = false;
  private timeoutRequested = false;

  setWorkspace(dir: string | null): void {
    if (dir === this.workspaceDir) return;
    this.workspaceDir = dir;
    this.framework = null;
    this.coreManager = null;
    if (dir) {
      void this.detectFramework();
    }
  }

  getState(): TestRunnerState {
    return {
      framework: this.framework,
      lastResult: this.lastResult,
      isRunning: this.activeProcess !== null,
      catalog: this.getCatalog(),
    };
  }

  getCatalog(): TestCatalogItem[] {
    if (!this.workspaceDir) return [];
    const workspace = this.workspaceDir;
    const items = makeScriptCatalogItems(workspace);
    addIfFileExists(
      items,
      {
        id: 'code-buddy-cowork-real-gpt55-chat-current',
        label: 'real GPT-5.5 chat',
        group: 'Conditions reelles',
        description: 'Playwright GUI chat avec provider ChatGPT OAuth gpt-5.5',
        command: 'npx',
        args: ['playwright', 'test', 'e2e/chat-real-gpt55.spec.ts', '--reporter=list', '--timeout=240000'],
        cwd: workspace,
        kind: 'real-provider',
        safeToRun: false,
        requiresEnv: 'COWORK_REAL_GPT55',
        env: { COWORK_REAL_GPT55: '1' },
        timeoutMs: 300_000,
      },
      path.join(workspace, 'e2e', 'chat-real-gpt55.spec.ts')
    );
    const coworkDir = path.join(workspace, 'cowork');
    if (fs.existsSync(path.join(coworkDir, 'package.json'))) {
      items.push(...makeScriptCatalogItems(coworkDir, 'Cowork / '));
      addIfFileExists(
        items,
        {
          id: 'code-buddy-cowork-ipc-chat-flow',
          label: 'Cowork / IPC chat flow',
          group: 'Chat',
          description: 'Playwright demarre une session chat via IPC Electron puis continue la conversation',
          command: 'npx',
          args: ['playwright', 'test', 'e2e/chat-flow.spec.ts', '--reporter=list', '--timeout=120000'],
          cwd: coworkDir,
          kind: 'e2e',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        path.join(coworkDir, 'e2e', 'chat-flow.spec.ts')
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-cowork-companion-deterministic-panel',
          label: 'Cowork / companion deterministic panel',
          group: 'Companion',
          description: 'Playwright cockpit compagnon: projet, pulse, camera, voix, missions et improvement loop',
          command: 'npx',
          args: ['playwright', 'test', 'e2e/companion-panel.spec.ts', '--reporter=list', '--timeout=240000'],
          cwd: coworkDir,
          kind: 'e2e',
          safeToRun: true,
          timeoutMs: 300_000,
        },
        path.join(coworkDir, 'e2e', 'companion-panel.spec.ts')
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-cowork-panel-usage-depth',
          label: 'Cowork / panel usage depth',
          group: 'E2E approfondi',
          description: 'Playwright utilise Fleet, Team, commandes, hooks et planifications sans services externes',
          command: 'npx',
          args: ['playwright', 'test', 'e2e/panel-usage-depth.spec.ts', '--reporter=list', '--timeout=180000'],
          cwd: coworkDir,
          kind: 'e2e',
          safeToRun: true,
          timeoutMs: 240_000,
        },
        path.join(coworkDir, 'e2e', 'panel-usage-depth.spec.ts')
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-cowork-feature-completion-depth',
          label: 'Cowork / feature completion depth',
          group: 'E2E approfondi',
          description: 'Playwright manipule clipboard, orchestrateur, Fleet, connaissances, workflows, MCP et plugins',
          command: 'npx',
          args: ['playwright', 'test', 'e2e/feature-completion-depth.spec.ts', '--reporter=list', '--timeout=220000'],
          cwd: coworkDir,
          kind: 'e2e',
          safeToRun: true,
          timeoutMs: 360_000,
        },
        path.join(coworkDir, 'e2e', 'feature-completion-depth.spec.ts')
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-functional-coverage-bundle',
          label: 'Cowork / functional coverage bundle',
          group: 'E2E approfondi',
          description: 'Playwright bundle chat, compagnon, panneaux, workflows, MCP, plugins et automatisations',
          command: 'npx',
          args: [
            'playwright',
            'test',
            'e2e/chat-flow.spec.ts',
            'e2e/companion-panel.spec.ts',
            'e2e/panel-usage-depth.spec.ts',
            'e2e/feature-completion-depth.spec.ts',
            '--reporter=list',
            '--timeout=360000',
          ],
          cwd: coworkDir,
          kind: 'e2e',
          safeToRun: true,
          timeoutMs: 540_000,
        },
        [
          path.join(coworkDir, 'e2e', 'chat-flow.spec.ts'),
          path.join(coworkDir, 'e2e', 'companion-panel.spec.ts'),
          path.join(coworkDir, 'e2e', 'panel-usage-depth.spec.ts'),
          path.join(coworkDir, 'e2e', 'feature-completion-depth.spec.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-remote-control-bundle',
          label: 'Cowork / remote control bundle',
          group: 'Remote',
          description:
            'Remote manager, user message UI, cwd/default workdir propagation, port conflict, panel links/layout et slash-command remote',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/remote-user-message-ui.test.ts',
            'tests/remote-manager-port-conflict.test.ts',
            'tests/remote-default-workdir.test.ts',
            'tests/remote-cwd-state.test.ts',
            'tests/remote-cwd-propagation.test.ts',
            'tests/remote-control-panel-links.test.ts',
            'tests/remote-control-panel-imports.test.ts',
            'tests/remote-control-panel-claude-layout.test.ts',
            'tests/slash-command-bridge-remote.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 120_000,
        },
        [
          path.join(coworkDir, 'tests', 'remote-user-message-ui.test.ts'),
          path.join(coworkDir, 'tests', 'remote-manager-port-conflict.test.ts'),
          path.join(coworkDir, 'tests', 'remote-default-workdir.test.ts'),
          path.join(coworkDir, 'tests', 'remote-cwd-state.test.ts'),
          path.join(coworkDir, 'tests', 'remote-cwd-propagation.test.ts'),
          path.join(coworkDir, 'tests', 'remote-control-panel-links.test.ts'),
          path.join(coworkDir, 'tests', 'remote-control-panel-imports.test.ts'),
          path.join(coworkDir, 'tests', 'remote-control-panel-claude-layout.test.ts'),
          path.join(coworkDir, 'tests', 'slash-command-bridge-remote.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-open-cowork-demo-parity-bundle',
          label: 'Cowork / Open Cowork demo parity bundle',
          group: 'Demo parity',
          description:
            'Proof bundle for the public Open Cowork videos: file organization, PPT/XLSX artifacts, GUI operation, Feishu/Lark remote control and media privacy guards',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/open-cowork-demo-parity.test.ts',
            'tests/skills-manager-builtin-skills.test.ts',
            'tests/file-attachment-helpers.test.ts',
            'tests/recent-workspace-files.test.ts',
            'tests/welcome-project-selector.test.ts',
            'tests/artifact-parser.test.ts',
            'tests/artifact-path.test.ts',
            'tests/artifact-steps.test.ts',
            'tests/document-workshop-flow.test.ts',
            'tests/document-workshop-progress.test.ts',
            'tests/tool-output-path.test.ts',
            'tests/tool-result-summary.test.ts',
            'tests/permission-dialog-computer-use.test.ts',
            'tests/settings-permission-rules-computer-use.test.ts',
            'tests/remote-user-message-ui.test.ts',
            'tests/remote-manager-port-conflict.test.ts',
            'tests/remote-default-workdir.test.ts',
            'tests/remote-cwd-state.test.ts',
            'tests/remote-cwd-propagation.test.ts',
            'tests/remote-control-panel-links.test.ts',
            'tests/remote-control-panel-imports.test.ts',
            'tests/remote-control-panel-claude-layout.test.ts',
            'tests/slash-command-bridge-remote.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(coworkDir, 'tests', 'open-cowork-demo-parity.test.ts'),
          path.join(coworkDir, 'tests', 'skills-manager-builtin-skills.test.ts'),
          path.join(coworkDir, 'tests', 'file-attachment-helpers.test.ts'),
          path.join(coworkDir, 'tests', 'recent-workspace-files.test.ts'),
          path.join(coworkDir, 'tests', 'welcome-project-selector.test.ts'),
          path.join(coworkDir, 'tests', 'artifact-parser.test.ts'),
          path.join(coworkDir, 'tests', 'artifact-path.test.ts'),
          path.join(coworkDir, 'tests', 'artifact-steps.test.ts'),
          path.join(coworkDir, 'tests', 'document-workshop-flow.test.ts'),
          path.join(coworkDir, 'tests', 'document-workshop-progress.test.ts'),
          path.join(coworkDir, 'tests', 'tool-output-path.test.ts'),
          path.join(coworkDir, 'tests', 'tool-result-summary.test.ts'),
          path.join(coworkDir, 'tests', 'permission-dialog-computer-use.test.ts'),
          path.join(coworkDir, 'tests', 'settings-permission-rules-computer-use.test.ts'),
          path.join(coworkDir, 'tests', 'remote-user-message-ui.test.ts'),
          path.join(coworkDir, 'tests', 'remote-manager-port-conflict.test.ts'),
          path.join(coworkDir, 'tests', 'remote-default-workdir.test.ts'),
          path.join(coworkDir, 'tests', 'remote-cwd-state.test.ts'),
          path.join(coworkDir, 'tests', 'remote-cwd-propagation.test.ts'),
          path.join(coworkDir, 'tests', 'remote-control-panel-links.test.ts'),
          path.join(coworkDir, 'tests', 'remote-control-panel-imports.test.ts'),
          path.join(coworkDir, 'tests', 'remote-control-panel-claude-layout.test.ts'),
          path.join(coworkDir, 'tests', 'slash-command-bridge-remote.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-autonomous-mission-board-bundle',
          label: 'Cowork / autonomous mission board',
          group: 'Autonomy',
          description: 'Mission core DAG scheduling, heartbeat/recovery and Mission Board renderer surface guards',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/mission-core.test.ts',
            'tests/mission-bridge.test.ts',
            'tests/mission-heartbeat-recovery.test.ts',
            'tests/mission-scheduler.test.ts',
            'tests/mission-board-panel.test.tsx',
            'tests/mission-board-surface.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 120_000,
        },
        [
          path.join(coworkDir, 'tests', 'mission-core.test.ts'),
          path.join(coworkDir, 'tests', 'mission-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'mission-heartbeat-recovery.test.ts'),
          path.join(coworkDir, 'tests', 'mission-scheduler.test.ts'),
          path.join(coworkDir, 'tests', 'mission-board-panel.test.tsx'),
          path.join(coworkDir, 'tests', 'mission-board-surface.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-desktop-snapshot-bundle',
          label: 'Cowork / desktop snapshot',
          group: 'Automation',
          description:
            'Passive desktop smart snapshot panel, preload bridge wiring and OCR/accessibility ref rendering',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/desktop-snapshot-panel.test.tsx',
            'tests/desktop-snapshot-surface.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 120_000,
        },
        [
          path.join(coworkDir, 'tests', 'desktop-snapshot-panel.test.tsx'),
          path.join(coworkDir, 'tests', 'desktop-snapshot-surface.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-sandbox-executor-bundle',
          label: 'Cowork / sandbox executor bundle',
          group: 'Sandbox',
          description:
            'Tool executor sandbox routing, workspace containment, WSL/Lima command injection guards and destructive-command blocking',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/tool-executor-sandbox.test.ts',
            'tests/sandbox-executor-containment.test.ts',
            'tests/sandbox-command-injection.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 120_000,
        },
        [
          path.join(coworkDir, 'tests', 'tool-executor-sandbox.test.ts'),
          path.join(coworkDir, 'tests', 'sandbox-executor-containment.test.ts'),
          path.join(coworkDir, 'tests', 'sandbox-command-injection.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-project-session-git-bundle',
          label: 'Cowork / project session git bundle',
          group: 'Sessions',
          description:
            'Git worktrees/compare, workspace selector, recent files, attachments, session CRUD/cache/search/resume and insights',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/git-bridge-worktree.test.ts',
            'tests/git-bridge-compare.test.ts',
            'tests/file-attachment-helpers.test.ts',
            'tests/file-attachment-context.test.ts',
            'tests/recent-workspace-files.test.ts',
            'tests/workspace-path-constraints.test.ts',
            'tests/session-manager-crud.test.ts',
            'tests/session-manager-message-cache.test.ts',
            'tests/session-manager-queue-concurrency.test.ts',
            'tests/session-manager-title-unified.test.ts',
            'tests/session-search.test.ts',
            'tests/session-resume-dialog.test.ts',
            'tests/session-insights-bridge.test.ts',
            'tests/session-insights-audit.test.ts',
            'tests/session-insights-jump.test.ts',
            'tests/welcome-project-selector.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 160_000,
        },
        [
          path.join(coworkDir, 'tests', 'git-bridge-worktree.test.ts'),
          path.join(coworkDir, 'tests', 'git-bridge-compare.test.ts'),
          path.join(coworkDir, 'tests', 'file-attachment-helpers.test.ts'),
          path.join(coworkDir, 'tests', 'file-attachment-context.test.ts'),
          path.join(coworkDir, 'tests', 'recent-workspace-files.test.ts'),
          path.join(coworkDir, 'tests', 'workspace-path-constraints.test.ts'),
          path.join(coworkDir, 'tests', 'session-manager-crud.test.ts'),
          path.join(coworkDir, 'tests', 'session-manager-message-cache.test.ts'),
          path.join(coworkDir, 'tests', 'session-manager-queue-concurrency.test.ts'),
          path.join(coworkDir, 'tests', 'session-manager-title-unified.test.ts'),
          path.join(coworkDir, 'tests', 'session-search.test.ts'),
          path.join(coworkDir, 'tests', 'session-resume-dialog.test.ts'),
          path.join(coworkDir, 'tests', 'session-insights-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'session-insights-audit.test.ts'),
          path.join(coworkDir, 'tests', 'session-insights-jump.test.ts'),
          path.join(coworkDir, 'tests', 'welcome-project-selector.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-ui-localization-layout-bundle',
          label: 'Cowork / UI localization layout bundle',
          group: 'Interface',
          description:
            'Layout app/chat/welcome, theme palette, French i18n, Fleet Command Center translations, settings, links and markdown rendering',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/app-layout-scroll-lock.test.ts',
            'tests/app-startup-lazy-load.test.ts',
            'tests/dark-theme-palette.test.ts',
            'tests/i18n-french-support.test.ts',
            'tests/welcome-view-claude-layout.test.ts',
            'tests/welcome-view-submit-guard.test.ts',
            'tests/chat-view-claude-layout.test.ts',
            'tests/chat-view-width-layout.test.ts',
            'tests/message-card-claude-layout.test.ts',
            'tests/message-card-file-attachment-layout.test.ts',
            'tests/config-modal-claude-layout.test.ts',
            'tests/focus-view-surface.test.ts',
            'tests/fleet-team-panel-browser-bridge.test.ts',
            'tests/settings-surface-tabs.test.ts',
            'tests/settings-panel-plugin-entry.test.ts',
            'tests/settings-panel-schedule-entry.test.ts',
            'tests/provider-guidance-ui.test.ts',
            'tests/prose-chat-list-style.test.ts',
            'tests/latex-delimiters.test.ts',
            'tests/markdown-local-link.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 160_000,
        },
        [
          path.join(coworkDir, 'tests', 'app-layout-scroll-lock.test.ts'),
          path.join(coworkDir, 'tests', 'app-startup-lazy-load.test.ts'),
          path.join(coworkDir, 'tests', 'dark-theme-palette.test.ts'),
          path.join(coworkDir, 'tests', 'i18n-french-support.test.ts'),
          path.join(coworkDir, 'tests', 'welcome-view-claude-layout.test.ts'),
          path.join(coworkDir, 'tests', 'welcome-view-submit-guard.test.ts'),
          path.join(coworkDir, 'tests', 'chat-view-claude-layout.test.ts'),
          path.join(coworkDir, 'tests', 'chat-view-width-layout.test.ts'),
          path.join(coworkDir, 'tests', 'message-card-claude-layout.test.ts'),
          path.join(coworkDir, 'tests', 'message-card-file-attachment-layout.test.ts'),
          path.join(coworkDir, 'tests', 'config-modal-claude-layout.test.ts'),
          path.join(coworkDir, 'tests', 'focus-view-surface.test.ts'),
          path.join(coworkDir, 'tests', 'fleet-team-panel-browser-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'settings-surface-tabs.test.ts'),
          path.join(coworkDir, 'tests', 'settings-panel-plugin-entry.test.ts'),
          path.join(coworkDir, 'tests', 'settings-panel-schedule-entry.test.ts'),
          path.join(coworkDir, 'tests', 'provider-guidance-ui.test.ts'),
          path.join(coworkDir, 'tests', 'prose-chat-list-style.test.ts'),
          path.join(coworkDir, 'tests', 'latex-delimiters.test.ts'),
          path.join(coworkDir, 'tests', 'markdown-local-link.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-artifact-document-bundle',
          label: 'Cowork / artifact document bundle',
          group: 'Interface',
          description:
            'Artifacts, document workshop, file links, generated DOCX evidence, tool outputs and message-card states',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/artifact-detector-agentic-harness.test.ts',
            'tests/artifact-icon.test.ts',
            'tests/artifact-parser.test.ts',
            'tests/artifact-path.test.ts',
            'tests/artifact-steps.test.ts',
            'tests/file-preview-agentic-harness.test.ts',
            'tests/chat-view-document-workshop.test.ts',
            'tests/document-workshop-flow.test.ts',
            'tests/document-workshop-progress.test.ts',
            'tests/file-link.test.ts',
            'tests/tool-output-path.test.ts',
            'tests/tool-result-summary.test.ts',
            'tests/message-card-link-handling.test.ts',
            'tests/message-card-citation-link-normalization.test.ts',
            'tests/message-card-ask-user-question-state.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 160_000,
        },
        [
          path.join(coworkDir, 'tests', 'artifact-detector-agentic-harness.test.ts'),
          path.join(coworkDir, 'tests', 'artifact-icon.test.ts'),
          path.join(coworkDir, 'tests', 'artifact-parser.test.ts'),
          path.join(coworkDir, 'tests', 'artifact-path.test.ts'),
          path.join(coworkDir, 'tests', 'artifact-steps.test.ts'),
          path.join(coworkDir, 'tests', 'file-preview-agentic-harness.test.ts'),
          path.join(coworkDir, 'tests', 'chat-view-document-workshop.test.ts'),
          path.join(coworkDir, 'tests', 'document-workshop-flow.test.ts'),
          path.join(coworkDir, 'tests', 'document-workshop-progress.test.ts'),
          path.join(coworkDir, 'tests', 'file-link.test.ts'),
          path.join(coworkDir, 'tests', 'tool-output-path.test.ts'),
          path.join(coworkDir, 'tests', 'tool-result-summary.test.ts'),
          path.join(coworkDir, 'tests', 'message-card-link-handling.test.ts'),
          path.join(coworkDir, 'tests', 'message-card-citation-link-normalization.test.ts'),
          path.join(coworkDir, 'tests', 'message-card-ask-user-question-state.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-scheduling-session-bundle',
          label: 'Cowork / scheduling session bundle',
          group: 'Sessions',
          description:
            'Scheduled tasks, schedule settings, runNow, Fleet metadata, slash /schedule and session title generation',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/schedule-helpers.test.ts',
            'tests/schedule-task-title.test.ts',
            'tests/scheduled-task-edge-cases.test.ts',
            'tests/scheduled-task-manager.test.ts',
            'tests/scheduled-task-session-title-entry.test.ts',
            'tests/scheduled-task-store.test.ts',
            'tests/session-manager-scheduled-title.test.ts',
            'tests/session-title-defaults.test.ts',
            'tests/session-title-flow-abort.test.ts',
            'tests/session-title-flow.test.ts',
            'tests/session-title-utils.test.ts',
            'tests/session-update-event.test.ts',
            'tests/slash-command-bridge-schedule.test.ts',
            'tests/settings-panel-schedule-entry.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 160_000,
        },
        [
          path.join(coworkDir, 'tests', 'schedule-helpers.test.ts'),
          path.join(coworkDir, 'tests', 'schedule-task-title.test.ts'),
          path.join(coworkDir, 'tests', 'scheduled-task-edge-cases.test.ts'),
          path.join(coworkDir, 'tests', 'scheduled-task-manager.test.ts'),
          path.join(coworkDir, 'tests', 'scheduled-task-session-title-entry.test.ts'),
          path.join(coworkDir, 'tests', 'scheduled-task-store.test.ts'),
          path.join(coworkDir, 'tests', 'session-manager-scheduled-title.test.ts'),
          path.join(coworkDir, 'tests', 'session-title-defaults.test.ts'),
          path.join(coworkDir, 'tests', 'session-title-flow-abort.test.ts'),
          path.join(coworkDir, 'tests', 'session-title-flow.test.ts'),
          path.join(coworkDir, 'tests', 'session-title-utils.test.ts'),
          path.join(coworkDir, 'tests', 'session-update-event.test.ts'),
          path.join(coworkDir, 'tests', 'slash-command-bridge-schedule.test.ts'),
          path.join(coworkDir, 'tests', 'settings-panel-schedule-entry.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-local-provider-config-bundle',
          label: 'Cowork / local provider config bundle',
          group: 'Configuration',
          description:
            'API config, diagnostics, ConfigStore profiles/env, Ollama, LM Studio, loopback gateways, retry and config modal gating',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/api-config-state.test.ts',
            'tests/api-config-state-config-sets.test.ts',
            'tests/api-diagnostics.test.ts',
            'tests/auth-utils.test.ts',
            'tests/config-store-config-sets.test.ts',
            'tests/config-store-env.test.ts',
            'tests/config-store-performance.test.ts',
            'tests/config-store-profiles.test.ts',
            'tests/config-test-routing.test.ts',
            'tests/settings-api-local-providers.test.ts',
            'tests/lmstudio-api.test.ts',
            'tests/lmstudio-discovery.test.ts',
            'tests/ollama-api.test.ts',
            'tests/ollama-base-url.test.ts',
            'tests/ollama-discovery.test.ts',
            'tests/loopback-url.test.ts',
            'tests/retry.test.ts',
            'tests/use-ipc-config-modal-gate.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(coworkDir, 'tests', 'api-config-state.test.ts'),
          path.join(coworkDir, 'tests', 'api-config-state-config-sets.test.ts'),
          path.join(coworkDir, 'tests', 'api-diagnostics.test.ts'),
          path.join(coworkDir, 'tests', 'auth-utils.test.ts'),
          path.join(coworkDir, 'tests', 'config-store-config-sets.test.ts'),
          path.join(coworkDir, 'tests', 'config-store-env.test.ts'),
          path.join(coworkDir, 'tests', 'config-store-performance.test.ts'),
          path.join(coworkDir, 'tests', 'config-store-profiles.test.ts'),
          path.join(coworkDir, 'tests', 'config-test-routing.test.ts'),
          path.join(coworkDir, 'tests', 'settings-api-local-providers.test.ts'),
          path.join(coworkDir, 'tests', 'lmstudio-api.test.ts'),
          path.join(coworkDir, 'tests', 'lmstudio-discovery.test.ts'),
          path.join(coworkDir, 'tests', 'ollama-api.test.ts'),
          path.join(coworkDir, 'tests', 'ollama-base-url.test.ts'),
          path.join(coworkDir, 'tests', 'ollama-discovery.test.ts'),
          path.join(coworkDir, 'tests', 'loopback-url.test.ts'),
          path.join(coworkDir, 'tests', 'retry.test.ts'),
          path.join(coworkDir, 'tests', 'use-ipc-config-modal-gate.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-activity-audit-diagnostics-bundle',
          label: 'Cowork / activity audit diagnostics bundle',
          group: 'Observabilite',
          description:
            'Activity feed, global search, audit recall, renderer diagnostics, preview service, event mapping and recent files',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/activity-feed.test.ts',
            'tests/global-search-dialog.test.ts',
            'tests/global-search-service.test.ts',
            'tests/audit-bridge.test.ts',
            'tests/audit-log-viewer.test.ts',
            'tests/diagnostics-summary.test.ts',
            'tests/renderer-diagnostics.test.ts',
            'tests/client-event-utils.test.ts',
            'tests/runner-event-mapping.test.ts',
            'tests/preview-service.test.ts',
            'tests/context-panel-recent-files.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 160_000,
        },
        [
          path.join(coworkDir, 'tests', 'activity-feed.test.ts'),
          path.join(coworkDir, 'tests', 'global-search-dialog.test.ts'),
          path.join(coworkDir, 'tests', 'global-search-service.test.ts'),
          path.join(coworkDir, 'tests', 'audit-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'audit-log-viewer.test.ts'),
          path.join(coworkDir, 'tests', 'diagnostics-summary.test.ts'),
          path.join(coworkDir, 'tests', 'renderer-diagnostics.test.ts'),
          path.join(coworkDir, 'tests', 'client-event-utils.test.ts'),
          path.join(coworkDir, 'tests', 'runner-event-mapping.test.ts'),
          path.join(coworkDir, 'tests', 'preview-service.test.ts'),
          path.join(coworkDir, 'tests', 'context-panel-recent-files.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-fleet-command-team-bundle',
          label: 'Cowork / Fleet command team bundle',
          group: 'Fleet',
          description:
            'Fleet bridge IPC, command center board, discovery, SagaRunner, internet proof metadata, scheduled outcomes and Team bridge',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/aggregator-wiring.test.ts',
            'tests/fleet-bridge.test.ts',
            'tests/fleet-command-center-board.test.ts',
            'tests/fleet-discovery.test.ts',
            'tests/fleet-internet-proof-metadata.test.ts',
            'tests/fleet-ipc.test.ts',
            'tests/fleet-outcome-panel.test.ts',
            'tests/fleet-scheduled-work-strip.test.ts',
            'tests/saga-runner.test.ts',
            'tests/team-bridge.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 160_000,
        },
        [
          path.join(coworkDir, 'tests', 'aggregator-wiring.test.ts'),
          path.join(coworkDir, 'tests', 'fleet-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'fleet-command-center-board.test.ts'),
          path.join(coworkDir, 'tests', 'fleet-discovery.test.ts'),
          path.join(coworkDir, 'tests', 'fleet-internet-proof-metadata.test.ts'),
          path.join(coworkDir, 'tests', 'fleet-ipc.test.ts'),
          path.join(coworkDir, 'tests', 'fleet-outcome-panel.test.ts'),
          path.join(coworkDir, 'tests', 'fleet-scheduled-work-strip.test.ts'),
          path.join(coworkDir, 'tests', 'saga-runner.test.ts'),
          path.join(coworkDir, 'tests', 'team-bridge.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-permission-path-rules-bundle',
          label: 'Cowork / permission path rules bundle',
          group: 'Securite',
          description:
            'Permission dialog/rules UX, computer-use quick rules, declarative fallback, path containment, UNC and command path conversion',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/declarative-rules-explain.test.ts',
            'tests/permission-dialog-computer-use.test.ts',
            'tests/permission-rule-classification.test.ts',
            'tests/permission-rule-preview.test.ts',
            'tests/permission-target-rule.test.ts',
            'tests/rules-bridge-fallback.test.ts',
            'tests/settings-permission-rules-computer-use.test.ts',
            'tests/path-containment.test.ts',
            'tests/path-guard-command-conversion.test.ts',
            'tests/path-resolver-containment.test.ts',
            'tests/tool-executor-unc-paths.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 160_000,
        },
        [
          path.join(coworkDir, 'tests', 'declarative-rules-explain.test.ts'),
          path.join(coworkDir, 'tests', 'permission-dialog-computer-use.test.ts'),
          path.join(coworkDir, 'tests', 'permission-rule-classification.test.ts'),
          path.join(coworkDir, 'tests', 'permission-rule-preview.test.ts'),
          path.join(coworkDir, 'tests', 'permission-target-rule.test.ts'),
          path.join(coworkDir, 'tests', 'rules-bridge-fallback.test.ts'),
          path.join(coworkDir, 'tests', 'settings-permission-rules-computer-use.test.ts'),
          path.join(coworkDir, 'tests', 'path-containment.test.ts'),
          path.join(coworkDir, 'tests', 'path-guard-command-conversion.test.ts'),
          path.join(coworkDir, 'tests', 'path-resolver-containment.test.ts'),
          path.join(coworkDir, 'tests', 'tool-executor-unc-paths.test.ts'),
        ]
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-cowork-real-gpt55-chat',
          label: 'Cowork / real GPT-5.5 chat',
          group: 'Conditions reelles',
          description: 'Playwright GUI chat avec provider ChatGPT OAuth gpt-5.5',
          command: 'npx',
          args: ['playwright', 'test', 'e2e/chat-real-gpt55.spec.ts', '--reporter=list', '--timeout=240000'],
          cwd: coworkDir,
          kind: 'real-provider',
          safeToRun: false,
          requiresEnv: 'COWORK_REAL_GPT55',
          env: { COWORK_REAL_GPT55: '1' },
          timeoutMs: 300_000,
        },
        path.join(coworkDir, 'e2e', 'chat-real-gpt55.spec.ts')
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-cowork-live-companion',
          label: 'Cowork / live companion core IPC',
          group: 'Conditions reelles',
          description: 'Playwright Buddy companion avec core IPC reel et surfaces locales',
          command: 'npx',
          args: ['playwright', 'test', 'e2e/companion-live.spec.ts', '--reporter=list', '--timeout=240000'],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: false,
          requiresEnv: 'COWORK_LIVE_COMPANION',
          env: { COWORK_LIVE_COMPANION: '1' },
          timeoutMs: 300_000,
        },
        path.join(coworkDir, 'e2e', 'companion-live.spec.ts')
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-cowork-workflow-bridge-integration',
          label: 'Cowork / workflow bridge integration',
          group: 'Integration',
          description: 'Vitest avec vrai Orchestrator local, approval, parallel branches, loops et variables',
          command: 'npx',
          args: ['vitest', 'run', 'tests/workflow-bridge-integration.test.ts', '--reporter=verbose'],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 120_000,
        },
        path.join(coworkDir, 'tests', 'workflow-bridge-integration.test.ts')
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-settings-hooks-mcp-workflows-bundle',
          label: 'Cowork / settings hooks MCP workflows bundle',
          group: 'Integration',
          description:
            'Settings theme/autostart, hooks dry-runs, MCP env/tool sync, bundled MCP resources and workflow compiler/orchestrator',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/bundle-mcp-script.test.ts',
            'tests/engine-mcp-sync.test.ts',
            'tests/hooks-bridge-agent-dryrun.test.ts',
            'tests/hooks-bridge-events.test.ts',
            'tests/hooks-bridge-http-dryrun.test.ts',
            'tests/hooks-bridge-prompt-dryrun.test.ts',
            'tests/mcp-manager-env-merge.test.ts',
            'tests/mcp-tool-name.test.ts',
            'tests/settings-codebuddy-autostart.test.ts',
            'tests/theme-settings-persistence.test.ts',
            'tests/workflow-bridge-compilation.test.ts',
            'tests/workflow-bridge-integration.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 160_000,
        },
        [
          path.join(coworkDir, 'tests', 'bundle-mcp-script.test.ts'),
          path.join(coworkDir, 'tests', 'engine-mcp-sync.test.ts'),
          path.join(coworkDir, 'tests', 'hooks-bridge-agent-dryrun.test.ts'),
          path.join(coworkDir, 'tests', 'hooks-bridge-events.test.ts'),
          path.join(coworkDir, 'tests', 'hooks-bridge-http-dryrun.test.ts'),
          path.join(coworkDir, 'tests', 'hooks-bridge-prompt-dryrun.test.ts'),
          path.join(coworkDir, 'tests', 'mcp-manager-env-merge.test.ts'),
          path.join(coworkDir, 'tests', 'mcp-tool-name.test.ts'),
          path.join(coworkDir, 'tests', 'settings-codebuddy-autostart.test.ts'),
          path.join(coworkDir, 'tests', 'theme-settings-persistence.test.ts'),
          path.join(coworkDir, 'tests', 'workflow-bridge-compilation.test.ts'),
          path.join(coworkDir, 'tests', 'workflow-bridge-integration.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-custom-commands-slash-bundle',
          label: 'Cowork / custom commands slash bundle',
          group: 'Commandes',
          description:
            'Custom commands persistence, slash bridge precedence, autocomplete, remote execution and schedule slash parsing',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/custom-commands-service.test.ts',
            'tests/slash-command-bridge-schedule.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 120_000,
        },
        [
          path.join(coworkDir, 'tests', 'custom-commands-service.test.ts'),
          path.join(coworkDir, 'tests', 'slash-command-bridge-schedule.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-cowork-knowledge-hermes-presence-bundle',
          label: 'Cowork / knowledge Hermes presence bundle',
          group: 'Knowledge',
          description:
            'Lesson candidates, lessons vault, user model/spec IPC, companion IPC, Hermes cockpit parity/readiness, learning usage, skill candidate review and presence model flows',
          command: 'npx',
          args: [
            'vitest',
            'run',
            'tests/channel-gateway-readiness-bridge.test.ts',
            'tests/hermes-browser-backends-bridge.test.ts',
            'tests/hermes-browser-backends-strip.test.ts',
            'tests/hermes-memory-providers-bridge.test.ts',
            'tests/hermes-memory-providers-bridge-real.test.ts',
            'tests/hermes-memory-providers-strip.test.ts',
            'tests/hermes-messaging-gateway-strip.test.tsx',
            'tests/hermes-mobile-supervision-bridge.test.ts',
            'tests/hermes-mobile-supervision-bridge-real.test.ts',
            'tests/hermes-mobile-supervision-strip.test.ts',
            'tests/hermes-feature-parity-bridge.test.ts',
            'tests/hermes-feature-parity-bridge-real.test.ts',
            'tests/hermes-feature-parity-strip.test.ts',
            'tests/hermes-learning-loop-bridge.test.ts',
            'tests/hermes-learning-loop-bridge-real.test.ts',
            'tests/hermes-learning-loop-strip.test.ts',
            'tests/hermes-plan-strip.test.ts',
            'tests/hermes-protocol-gateways-bridge.test.ts',
            'tests/hermes-protocol-gateways-bridge-real.test.ts',
            'tests/hermes-protocol-gateways-strip.test.ts',
            'tests/hermes-provider-readiness-bridge.test.ts',
            'tests/hermes-provider-readiness-bridge-real.test.ts',
            'tests/hermes-provider-readiness-strip.test.ts',
            'tests/hermes-runtime-backends-bridge.test.ts',
            'tests/hermes-runtime-backends-bridge-real.test.ts',
            'tests/hermes-runtime-backends-strip.test.ts',
            'tests/hermes-surfaces-ipc.test.ts',
            'tests/hermes-tool-catalog-bridge.test.ts',
            'tests/hermes-tool-catalog-strip.test.ts',
            'tests/hermes-toolsets-bridge.test.ts',
            'tests/hermes-toolsets-strip.test.ts',
            'tests/lessons-vault-bridge.test.ts',
            'tests/lessons-vault-graph.test.ts',
            'tests/lessons-vault-strip.test.ts',
            'tests/learning-usage-bridge.test.ts',
            'tests/learning-skill-usage-strip.test.ts',
            'tests/presence-bridge-download.test.ts',
            'tests/presence-bridge-model.test.ts',
            'tests/presence-service.test.ts',
            'tests/skill-candidate-review-bridge.test.ts',
            'tests/skill-candidate-review-queue-strip.test.ts',
            'tests/tool-profile-inspector-strip.test.ts',
            '--reporter=verbose',
          ],
          cwd: coworkDir,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(coworkDir, 'tests', 'channel-gateway-readiness-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-browser-backends-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-browser-backends-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-memory-providers-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-memory-providers-bridge-real.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-memory-providers-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-messaging-gateway-strip.test.tsx'),
          path.join(coworkDir, 'tests', 'hermes-mobile-supervision-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-mobile-supervision-bridge-real.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-mobile-supervision-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-feature-parity-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-feature-parity-bridge-real.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-feature-parity-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-learning-loop-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-learning-loop-bridge-real.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-learning-loop-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-plan-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-protocol-gateways-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-protocol-gateways-bridge-real.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-protocol-gateways-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-provider-readiness-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-provider-readiness-bridge-real.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-provider-readiness-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-runtime-backends-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-runtime-backends-bridge-real.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-runtime-backends-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-surfaces-ipc.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-tool-catalog-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-tool-catalog-strip.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-toolsets-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'hermes-toolsets-strip.test.ts'),
          path.join(coworkDir, 'tests', 'lessons-vault-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'lessons-vault-graph.test.ts'),
          path.join(coworkDir, 'tests', 'lessons-vault-strip.test.ts'),
          path.join(coworkDir, 'tests', 'learning-usage-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'learning-skill-usage-strip.test.ts'),
          path.join(coworkDir, 'tests', 'presence-bridge-download.test.ts'),
          path.join(coworkDir, 'tests', 'presence-bridge-model.test.ts'),
          path.join(coworkDir, 'tests', 'presence-service.test.ts'),
          path.join(coworkDir, 'tests', 'skill-candidate-review-bridge.test.ts'),
          path.join(coworkDir, 'tests', 'skill-candidate-review-queue-strip.test.ts'),
          path.join(coworkDir, 'tests', 'tool-profile-inspector-strip.test.ts'),
        ]
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-hermes-runtime-live-smoke',
          label: 'Hermes / runtime live smoke',
          group: 'Hermes',
          description: 'Runs real local and WSL Hermes runtime smoke coverage through the Code Buddy runtime probes',
          command: 'npm',
          args: ['test', '--', 'tests/agent/hermes-runtime-backends-smoke-real.test.ts', '--run'],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 120_000,
        },
        path.join(workspace, 'tests', 'agent', 'hermes-runtime-backends-smoke-real.test.ts')
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-hermes-cli-status-real-smoke',
          label: 'Hermes / CLI status real smoke',
          group: 'Hermes',
          description:
            'Runs real Hermes CLI status commands for doctor, toolsets, tool parity, portal readiness, and prompt size',
          command: 'npm',
          args: ['test', '--', 'tests/agent/hermes-cli-status-real.test.ts', '--run'],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        path.join(workspace, 'tests', 'agent', 'hermes-cli-status-real.test.ts')
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-hermes-built-cli-real-smoke',
          label: 'Hermes / built CLI real smoke',
          group: 'Hermes',
          description: 'Rebuilds Code Buddy, then runs the compiled dist CLI for Hermes tool parity and doctor status',
          command: 'node',
          args: ['scripts/hermes-built-cli-smoke.mjs'],
          cwd: workspace,
          kind: 'integration',
          safeToRun: false,
          timeoutMs: 240_000,
        },
        path.join(workspace, 'scripts', 'hermes-built-cli-smoke.mjs')
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-hermes-core-workspace-real-smoke',
          label: 'Hermes / core workspace real smoke',
          group: 'Hermes',
          description: 'Runs real Hermes core aliases, send_message outbox, and Kanban workspace persistence smokes',
          command: 'npm',
          args: [
            'test',
            '--',
            'tests/tools/hermes-core-aliases-real.test.ts',
            'tests/tools/send-message-real.test.ts',
            'tests/tools/kanban-real.test.ts',
            '--run',
          ],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(workspace, 'tests', 'tools', 'hermes-core-aliases-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'send-message-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'kanban-real.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-hermes-persistence-skills-real-smoke',
          label: 'Hermes / persistence skills real smoke',
          group: 'Hermes',
          description:
            'Runs real cron persistence, saved-session search, SkillsHub inspection, skills CLI, and Hermes package summary smokes',
          command: 'npm',
          args: [
            'test',
            '--',
            'tests/tools/cronjob-tool-real.test.ts',
            'tests/tools/session-search-real.test.ts',
            'tests/tools/skills-inspection-real.test.ts',
            'tests/commands/skills-command-real.test.ts',
            'tests/agent/hermes-skill-package-summary-real.test.ts',
            '--run',
          ],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(workspace, 'tests', 'tools', 'cronjob-tool-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'session-search-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'skills-inspection-real.test.ts'),
          path.join(workspace, 'tests', 'commands', 'skills-command-real.test.ts'),
          path.join(workspace, 'tests', 'agent', 'hermes-skill-package-summary-real.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-hermes-platform-connectors-real-smoke',
          label: 'Hermes / platform connectors real smoke',
          group: 'Hermes',
          description:
            'Runs real localhost HTTP smokes for Discord, Home Assistant, MoA, Spotify, Feishu, Yuanbao, and X search connectors',
          command: 'npm',
          args: [
            'test',
            '--',
            'tests/tools/discord-tool-real.test.ts',
            'tests/tools/homeassistant-tool-real.test.ts',
            'tests/tools/mixture-of-agents-real.test.ts',
            'tests/tools/spotify-tool-real.test.ts',
            'tests/tools/feishu-tool-real.test.ts',
            'tests/tools/yuanbao-tool-real.test.ts',
            'tests/tools/x-search-tool-real.test.ts',
            '--run',
          ],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(workspace, 'tests', 'tools', 'discord-tool-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'homeassistant-tool-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'mixture-of-agents-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'spotify-tool-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'feishu-tool-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'yuanbao-tool-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'x-search-tool-real.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-hermes-browser-real-smoke',
          label: 'Hermes / browser real smoke',
          group: 'Hermes',
          description:
            'Runs real Playwright browser smokes for Hermes actions, snapshots, console, dialogs, and image discovery',
          command: 'npm',
          args: [
            'test',
            '--',
            'tests/tools/browser-console-real.test.ts',
            'tests/tools/browser-dialog-real.test.ts',
            'tests/tools/browser-get-images-real.test.ts',
            'tests/tools/browser-hermes-actions-real.test.ts',
            'tests/tools/browser-snapshot-real.test.ts',
            '--run',
          ],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(workspace, 'tests', 'tools', 'browser-console-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'browser-dialog-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'browser-get-images-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'browser-hermes-actions-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'browser-snapshot-real.test.ts'),
        ]
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-hermes-learning-loop-real-smoke',
          label: 'Hermes / learning loop real smoke',
          group: 'Hermes',
          description:
            'Runs real Learning Agent retrospectives, skill candidate creation, usage scoring, and CLI retrospective proof',
          command: 'npm',
          args: [
            'test',
            '--',
            'tests/agent/learning-agent-real.test.ts',
            'tests/commands/learning-retrospective-command.test.ts',
            '--run',
          ],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(workspace, 'tests', 'agent', 'learning-agent-real.test.ts'),
          path.join(workspace, 'tests', 'commands', 'learning-retrospective-command.test.ts'),
        ]
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-hermes-execute-code-real-smoke',
          label: 'Hermes / execute_code real smoke',
          group: 'Hermes',
          description: 'Runs real Hermes execute_code subprocess, artifact persistence, timeout, and parity coverage',
          command: 'npm',
          args: ['test', '--', 'tests/tools/execute-code-real.test.ts', '--run'],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 120_000,
        },
        path.join(workspace, 'tests', 'tools', 'execute-code-real.test.ts')
      );
      addIfFilesExist(
        items,
        {
          id: 'code-buddy-hermes-media-vision-real-smoke',
          label: 'Hermes / media vision real smoke',
          group: 'Hermes',
          description:
            'Runs real local TTS, Playwright browser vision, image analysis, and media-generation provider-path smokes',
          command: 'npm',
          args: [
            'test',
            '--',
            'tests/tools/text-to-speech-real.test.ts',
            'tests/tools/vision-analyze-real.test.ts',
            'tests/tools/media-generation-real.test.ts',
            '--run',
          ],
          cwd: workspace,
          kind: 'integration',
          safeToRun: true,
          timeoutMs: 180_000,
        },
        [
          path.join(workspace, 'tests', 'tools', 'text-to-speech-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'vision-analyze-real.test.ts'),
          path.join(workspace, 'tests', 'tools', 'media-generation-real.test.ts'),
        ]
      );
      addIfFileExists(
        items,
        {
          id: 'code-buddy-cowork-permission-real-flow',
          label: 'Cowork / permission real flow',
          group: 'Permissions',
          description: 'Playwright permission dialog IPC, Allow et regle Write(docs/*) persistante',
          command: 'npx',
          args: ['playwright', 'test', 'e2e/permission-real-flow.spec.ts', '--reporter=list', '--timeout=120000'],
          cwd: coworkDir,
          kind: 'e2e',
          safeToRun: false,
          timeoutMs: 180_000,
        },
        path.join(coworkDir, 'e2e', 'permission-real-flow.spec.ts')
      );
    }
    addIfFileExists(
      items,
      {
        id: 'code-buddy-provider-command-regression',
        label: 'CLI / provider command regression',
        group: 'Tests',
        description: 'Vitest cible le routage provider ChatGPT OAuth',
        command: 'npm',
        args: ['test', '--', '--run', 'tests/unit/provider-command.test.ts'],
        cwd: workspace,
        kind: 'unit',
        safeToRun: true,
      },
      path.join(workspace, 'tests', 'unit', 'provider-command.test.ts')
    );
    addIfFileExists(
      items,
      {
        id: 'code-buddy-headless-provider-failure-exit',
        label: 'CLI / headless provider failure exit',
        group: 'Tests',
        description: 'Vitest lance le vrai CLI headless contre un provider HTTP local en erreur 500',
        command: 'npm',
        args: ['test', '--', 'tests/cli/headless-exit-code.test.ts', '--run'],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
      },
      path.join(workspace, 'tests', 'cli', 'headless-exit-code.test.ts')
    );
    addIfFileExists(
      items,
      {
        id: 'code-buddy-server-local-http-chat-routes',
        label: 'Server / local HTTP chat routes',
        group: 'Server',
        description: 'Serveur Express local deterministe: /api/chat, SSE, completions et models',
        command: 'npm',
        args: ['test', '--', 'tests/server/chat-route-real-http.test.ts', '--run'],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 120_000,
      },
      path.join(workspace, 'tests', 'server', 'chat-route-real-http.test.ts')
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-server-cron-status-real-http',
        label: 'Server / cron status real HTTP',
        group: 'Server',
        description: 'Serveur HTTP local: cron jobs persistants, trigger manuel, daemon status et heartbeat report',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/server/cron-jobs-real-http.test.ts',
          'tests/server/native-status-report-real-http.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'server', 'cron-jobs-real-http.test.ts'),
        path.join(workspace, 'tests', 'server', 'native-status-report-real-http.test.ts'),
      ]
    );
    addIfFileExists(
      items,
      {
        id: 'code-buddy-server-provider-error-status-bundle',
        label: 'Server / provider error status bundle',
        group: 'Server',
        description: 'Routes HTTP chat: provider 429/503, OpenAI-compatible errors et rate-limit serveur distinct',
        command: 'npm',
        args: ['test', '--', 'tests/server/chat-route-provider-error.test.ts', '--run'],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      path.join(workspace, 'tests', 'server', 'chat-route-provider-error.test.ts')
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-fleet-peer-tool-security-suite',
        label: 'Fleet / peer tool security suite',
        group: 'Fleet',
        description: 'peer.tool.invoke: allowlist, fleetSafe, workspace root, scopes, PolicyEngine et audit',
        command: 'npm',
        args: ['test', '--', 'tests/server/peer-tool-bridge.test.ts', 'tests/fleet/peer-tool-bridge.test.ts', '--run'],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 120_000,
      },
      [
        path.join(workspace, 'tests', 'server', 'peer-tool-bridge.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'peer-tool-bridge.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-fleet-routing-orchestration-bundle',
        label: 'Fleet / routing orchestration bundle',
        group: 'Fleet',
        description:
          'TaskRouter, saga store, consensus, privacy lint, peer chat stream, registry, listener, handler, dispatch, couts et compaction',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/fleet/task-router.test.ts',
          'tests/fleet/saga-store.test.ts',
          'tests/fleet/result-aggregator-consensus.test.ts',
          'tests/fleet/privacy-lint.test.ts',
          'tests/fleet/peer-chat-stream.test.ts',
          'tests/fleet/peer-chat-client-factory.test.ts',
          'tests/fleet/fleet-registry.test.ts',
          'tests/fleet/fleet-listener.test.ts',
          'tests/fleet/fleet-handler.test.ts',
          'tests/fleet/fleet-chat-helper.test.ts',
          'tests/fleet/dispatch-profile.test.ts',
          'tests/fleet/cost-tracker.test.ts',
          'tests/fleet/compaction-bridge.test.ts',
          'tests/fleet/capability-registry.test.ts',
          'tests/fleet/autonomous-tick-broadcaster.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'fleet', 'task-router.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'saga-store.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'result-aggregator-consensus.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'privacy-lint.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'peer-chat-stream.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'peer-chat-client-factory.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'fleet-registry.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'fleet-listener.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'fleet-handler.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'fleet-chat-helper.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'dispatch-profile.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'cost-tracker.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'compaction-bridge.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'capability-registry.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'autonomous-tick-broadcaster.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-mcp-real-transport-suite',
        label: 'MCP / real transport suite',
        group: 'MCP',
        description: 'MCP stdio reel, HTTP JSON-RPC reel et streamable HTTP fail-closed',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/mcp/mcp-stdio-real-fixture.test.ts',
          'tests/mcp/mcp-http-real-fixture.test.ts',
          'tests/mcp/mcp-streamable-http-limitation.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 120_000,
      },
      [
        path.join(workspace, 'tests', 'mcp', 'mcp-stdio-real-fixture.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-http-real-fixture.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-streamable-http-limitation.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-infra-mcp-sandbox-adapters-bundle',
        label: 'Infrastructure / MCP sandbox adapters bundle',
        group: 'Infrastructure',
        description:
          'MCP manager/discovery/transports, Electron core adapter LRU/hotswap, sandbox registry, auto-sandbox, OS policy et E2B fallback',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/desktop/codebuddy-engine-adapter-mcp.test.ts',
          'tests/desktop/codebuddy-engine-adapter-lru.test.ts',
          'tests/desktop/codebuddy-engine-adapter-hotswap.test.ts',
          'tests/unit/mcp-tool-adapter.test.ts',
          'tests/unit/mcp-discovery.test.ts',
          'tests/unit/mcp-enhancements.test.ts',
          'tests/sandbox/sandbox-registry.test.ts',
          'tests/sandbox/auto-sandbox.test.ts',
          'tests/sandbox/os-sandbox.test.ts',
          'tests/sandbox/execpolicy.test.ts',
          'tests/unit/e2b-sandbox.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'desktop', 'codebuddy-engine-adapter-mcp.test.ts'),
        path.join(workspace, 'tests', 'desktop', 'codebuddy-engine-adapter-lru.test.ts'),
        path.join(workspace, 'tests', 'desktop', 'codebuddy-engine-adapter-hotswap.test.ts'),
        path.join(workspace, 'tests', 'unit', 'mcp-tool-adapter.test.ts'),
        path.join(workspace, 'tests', 'unit', 'mcp-discovery.test.ts'),
        path.join(workspace, 'tests', 'unit', 'mcp-enhancements.test.ts'),
        path.join(workspace, 'tests', 'sandbox', 'sandbox-registry.test.ts'),
        path.join(workspace, 'tests', 'sandbox', 'auto-sandbox.test.ts'),
        path.join(workspace, 'tests', 'sandbox', 'os-sandbox.test.ts'),
        path.join(workspace, 'tests', 'sandbox', 'execpolicy.test.ts'),
        path.join(workspace, 'tests', 'unit', 'e2b-sandbox.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-fleet-mcp-local-smoke-suite',
        label: 'Fleet/MCP local smoke suite',
        group: 'Integration',
        description: 'Gateway Fleet loopback, mesh deux peers, MCP stdio/HTTP/fail-closed et serveur HTTP local',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/fleet/fleet-loopback-smoke.test.ts',
          'tests/fleet/fleet-multi-peer-mesh-smoke.test.ts',
          'tests/mcp/mcp-stdio-real-fixture.test.ts',
          'tests/mcp/mcp-http-real-fixture.test.ts',
          'tests/mcp/mcp-streamable-http-limitation.test.ts',
          'tests/server/chat-route-real-http.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
      },
      [
        path.join(workspace, 'tests', 'fleet', 'fleet-loopback-smoke.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'fleet-multi-peer-mesh-smoke.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-stdio-real-fixture.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-http-real-fixture.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-streamable-http-limitation.test.ts'),
        path.join(workspace, 'tests', 'server', 'chat-route-real-http.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-backend-deterministic-bundle',
        label: 'Backend / deterministic integration bundle',
        group: 'Integration',
        description:
          'CLI headless, serveur HTTP local, Fleet loopback/mesh, peer tools et MCP reel sans provider externe',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/cli/headless-exit-code.test.ts',
          'tests/server/chat-route-real-http.test.ts',
          'tests/fleet/fleet-loopback-smoke.test.ts',
          'tests/fleet/fleet-multi-peer-mesh-smoke.test.ts',
          'tests/server/peer-tool-bridge.test.ts',
          'tests/fleet/peer-tool-bridge.test.ts',
          'tests/mcp/mcp-stdio-real-fixture.test.ts',
          'tests/mcp/mcp-http-real-fixture.test.ts',
          'tests/mcp/mcp-streamable-http-limitation.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'cli', 'headless-exit-code.test.ts'),
        path.join(workspace, 'tests', 'server', 'chat-route-real-http.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'fleet-loopback-smoke.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'fleet-multi-peer-mesh-smoke.test.ts'),
        path.join(workspace, 'tests', 'server', 'peer-tool-bridge.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'peer-tool-bridge.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-stdio-real-fixture.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-http-real-fixture.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-streamable-http-limitation.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-permissions-security-policy-bundle',
        label: 'Permissions / security policy bundle',
        group: 'Permissions',
        description: 'Write policy, permission modes, approval modes, security modes et confirmation service',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/security/write-policy.test.ts',
          'tests/security/permission-modes.test.ts',
          'tests/commands/permissions-handlers.test.ts',
          'tests/features/stream-permissions-prompts.test.ts',
          'tests/desktop/permission-bridge-unify.test.ts',
          'tests/approval-modes.test.ts',
          'tests/unit/approval-modes.test.ts',
          'tests/security-modes.test.ts',
          'tests/unit/security-modes.test.ts',
          'tests/unit/permission-config.test.ts',
          'tests/unit/tool-permissions.test.ts',
          'tests/utils/confirmation-service.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'security', 'write-policy.test.ts'),
        path.join(workspace, 'tests', 'security', 'permission-modes.test.ts'),
        path.join(workspace, 'tests', 'commands', 'permissions-handlers.test.ts'),
        path.join(workspace, 'tests', 'features', 'stream-permissions-prompts.test.ts'),
        path.join(workspace, 'tests', 'desktop', 'permission-bridge-unify.test.ts'),
        path.join(workspace, 'tests', 'approval-modes.test.ts'),
        path.join(workspace, 'tests', 'unit', 'approval-modes.test.ts'),
        path.join(workspace, 'tests', 'security-modes.test.ts'),
        path.join(workspace, 'tests', 'unit', 'security-modes.test.ts'),
        path.join(workspace, 'tests', 'unit', 'permission-config.test.ts'),
        path.join(workspace, 'tests', 'unit', 'tool-permissions.test.ts'),
        path.join(workspace, 'tests', 'utils', 'confirmation-service.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-observability-run-tracking-bundle',
        label: 'Observability / run tracking bundle',
        group: 'Observability',
        description:
          'RunStore, trajectory export, recall packs, policy evals, mobile supervision, cron recording et run commands',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/observability/run-store.test.ts',
          'tests/observability/run-trajectory-export.test.ts',
          'tests/observability/run-recall-pack.test.ts',
          'tests/observability/policy-evals.test.ts',
          'tests/observability/golden-workflow-evals.test.ts',
          'tests/observability/mobile-supervision-snapshot.test.ts',
          'tests/commands/run-commands.test.ts',
          'tests/daemon/cron-run-recording.test.ts',
          'tests/observability.test.ts',
          'tests/unit/observability-dashboard.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'observability', 'run-store.test.ts'),
        path.join(workspace, 'tests', 'observability', 'run-trajectory-export.test.ts'),
        path.join(workspace, 'tests', 'observability', 'run-recall-pack.test.ts'),
        path.join(workspace, 'tests', 'observability', 'policy-evals.test.ts'),
        path.join(workspace, 'tests', 'observability', 'golden-workflow-evals.test.ts'),
        path.join(workspace, 'tests', 'observability', 'mobile-supervision-snapshot.test.ts'),
        path.join(workspace, 'tests', 'commands', 'run-commands.test.ts'),
        path.join(workspace, 'tests', 'daemon', 'cron-run-recording.test.ts'),
        path.join(workspace, 'tests', 'observability.test.ts'),
        path.join(workspace, 'tests', 'unit', 'observability-dashboard.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-mobile-supervision-gateway-bundle',
        label: 'Mobile / supervision gateway bundle',
        group: 'Observability',
        description:
          'Mobile supervision snapshot, pairing state, no-network acceptance plan, gateway policy/contract/listener, approval queue et routes serveur mobile',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/observability/mobile-supervision-snapshot.test.ts',
          'tests/observability/mobile-supervision-pairing-state.test.ts',
          'tests/observability/mobile-supervision-pairing-acceptance-plan.test.ts',
          'tests/observability/mobile-supervision-gateway-policy.test.ts',
          'tests/observability/mobile-supervision-gateway-listener-shell.test.ts',
          'tests/observability/mobile-supervision-gateway-contract.test.ts',
          'tests/observability/mobile-supervision-approval-queue.test.ts',
          'tests/server/mobile.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'observability', 'mobile-supervision-snapshot.test.ts'),
        path.join(workspace, 'tests', 'observability', 'mobile-supervision-pairing-state.test.ts'),
        path.join(workspace, 'tests', 'observability', 'mobile-supervision-pairing-acceptance-plan.test.ts'),
        path.join(workspace, 'tests', 'observability', 'mobile-supervision-gateway-policy.test.ts'),
        path.join(workspace, 'tests', 'observability', 'mobile-supervision-gateway-listener-shell.test.ts'),
        path.join(workspace, 'tests', 'observability', 'mobile-supervision-gateway-contract.test.ts'),
        path.join(workspace, 'tests', 'observability', 'mobile-supervision-approval-queue.test.ts'),
        path.join(workspace, 'tests', 'server', 'mobile.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-device-transport-adapters-bundle',
        label: 'Device / transport adapters bundle',
        group: 'Remote',
        description: 'Device transports SSH/ADB/local, transport helpers and Tailscale dashboard node modeling',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/unit/device-transports.test.ts',
          'tests/unit/transport.test.ts',
          'tests/features/tailscale-dashboard-nodes.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 120_000,
      },
      [
        path.join(workspace, 'tests', 'unit', 'device-transports.test.ts'),
        path.join(workspace, 'tests', 'unit', 'transport.test.ts'),
        path.join(workspace, 'tests', 'features', 'tailscale-dashboard-nodes.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-gateway-realtime-websocket-bundle',
        label: 'Gateway / realtime websocket bundle',
        group: 'Gateway',
        description:
          'WebSocket server, backpressure, lane queue, peer RPC/chat, Gateway transport, TLS pairing, heartbeats et peer sessions',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/server/websocket.test.ts',
          'tests/server/broadcast-backpressure.test.ts',
          'tests/server/lane-queue-server.test.ts',
          'tests/server/fleet-bridge.test.ts',
          'tests/server/peer-rpc.test.ts',
          'tests/server/peer-chat-bridge.test.ts',
          'tests/gateway/ws-transport.test.ts',
          'tests/gateway/ws-transport-backpressure.test.ts',
          'tests/gateway/gateway.test.ts',
          'tests/gateway/tls-pairing.test.ts',
          'tests/fleet/heartbeat-broadcaster.test.ts',
          'tests/fleet/peer-session-bridge.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'server', 'websocket.test.ts'),
        path.join(workspace, 'tests', 'server', 'broadcast-backpressure.test.ts'),
        path.join(workspace, 'tests', 'server', 'lane-queue-server.test.ts'),
        path.join(workspace, 'tests', 'server', 'fleet-bridge.test.ts'),
        path.join(workspace, 'tests', 'server', 'peer-rpc.test.ts'),
        path.join(workspace, 'tests', 'server', 'peer-chat-bridge.test.ts'),
        path.join(workspace, 'tests', 'gateway', 'ws-transport.test.ts'),
        path.join(workspace, 'tests', 'gateway', 'ws-transport-backpressure.test.ts'),
        path.join(workspace, 'tests', 'gateway', 'gateway.test.ts'),
        path.join(workspace, 'tests', 'gateway', 'tls-pairing.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'heartbeat-broadcaster.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'peer-session-bridge.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-a2a-acp-channel-bundle',
        label: 'A2A / ACP channel bundle',
        group: 'Protocols',
        description:
          'A2A agent cards/tasks, remote routing, skill routing, inbound executor, ACP sessions et channel bridge/intake',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/server/a2a-protocol.test.ts',
          'tests/server/acp-routes.test.ts',
          'tests/server/channel-a2a-bridge.test.ts',
          'tests/server/channel-intake.test.ts',
          'tests/protocols/a2a.test.ts',
          'tests/protocols/a2a-task-router.test.ts',
          'tests/protocols/a2a-skill-selection.test.ts',
          'tests/protocols/a2a-skill-routing.test.ts',
          'tests/protocols/a2a-remote-agents.test.ts',
          'tests/protocols/a2a-codebuddy-executor.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'server', 'a2a-protocol.test.ts'),
        path.join(workspace, 'tests', 'server', 'acp-routes.test.ts'),
        path.join(workspace, 'tests', 'server', 'channel-a2a-bridge.test.ts'),
        path.join(workspace, 'tests', 'server', 'channel-intake.test.ts'),
        path.join(workspace, 'tests', 'protocols', 'a2a.test.ts'),
        path.join(workspace, 'tests', 'protocols', 'a2a-task-router.test.ts'),
        path.join(workspace, 'tests', 'protocols', 'a2a-skill-selection.test.ts'),
        path.join(workspace, 'tests', 'protocols', 'a2a-skill-routing.test.ts'),
        path.join(workspace, 'tests', 'protocols', 'a2a-remote-agents.test.ts'),
        path.join(workspace, 'tests', 'protocols', 'a2a-codebuddy-executor.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-channels-messaging-adapters-bundle',
        label: 'Channels / messaging adapters bundle',
        group: 'Channels',
        description:
          'Slack, Discord, Telegram, WhatsApp, Signal, Matrix, WebChat, Teams, Google Chat, sessions, DM pairing, offline queue et security',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/channels/channels.test.ts',
          'tests/channels/channel-handlers-additional-channels.test.ts',
          'tests/channels/slack-block-builder.test.ts',
          'tests/channels/slack.test.ts',
          'tests/channels/discord.test.ts',
          'tests/channels/telegram.test.ts',
          'tests/channels/teams.test.ts',
          'tests/channels/google-chat.test.ts',
          'tests/channels/webchat.test.ts',
          'tests/channels/whatsapp.test.ts',
          'tests/channels/signal.test.ts',
          'tests/channels/matrix.test.ts',
          'tests/channels/message-serialization.test.ts',
          'tests/channels/offline-queue.test.ts',
          'tests/channels/session-isolation-integration.test.ts',
          'tests/channels/session-identity.test.ts',
          'tests/channels/group-security.test.ts',
          'tests/channels/dm-pairing.test.ts',
          'tests/channels/dm-pairing-integration.test.ts',
          'tests/channels/reconnection-manager.test.ts',
          'tests/channels/peer-routing-integration.test.ts',
          'tests/channels/identity-links-integration.test.ts',
          'tests/channels/new-channels.test.ts',
          'tests/channels/feishu-cards.test.ts',
          'tests/channels/dm-policy/engine.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'channels', 'channels.test.ts'),
        path.join(workspace, 'tests', 'channels', 'channel-handlers-additional-channels.test.ts'),
        path.join(workspace, 'tests', 'channels', 'slack-block-builder.test.ts'),
        path.join(workspace, 'tests', 'channels', 'slack.test.ts'),
        path.join(workspace, 'tests', 'channels', 'discord.test.ts'),
        path.join(workspace, 'tests', 'channels', 'telegram.test.ts'),
        path.join(workspace, 'tests', 'channels', 'teams.test.ts'),
        path.join(workspace, 'tests', 'channels', 'google-chat.test.ts'),
        path.join(workspace, 'tests', 'channels', 'webchat.test.ts'),
        path.join(workspace, 'tests', 'channels', 'whatsapp.test.ts'),
        path.join(workspace, 'tests', 'channels', 'signal.test.ts'),
        path.join(workspace, 'tests', 'channels', 'matrix.test.ts'),
        path.join(workspace, 'tests', 'channels', 'message-serialization.test.ts'),
        path.join(workspace, 'tests', 'channels', 'offline-queue.test.ts'),
        path.join(workspace, 'tests', 'channels', 'session-isolation-integration.test.ts'),
        path.join(workspace, 'tests', 'channels', 'session-identity.test.ts'),
        path.join(workspace, 'tests', 'channels', 'group-security.test.ts'),
        path.join(workspace, 'tests', 'channels', 'dm-pairing.test.ts'),
        path.join(workspace, 'tests', 'channels', 'dm-pairing-integration.test.ts'),
        path.join(workspace, 'tests', 'channels', 'reconnection-manager.test.ts'),
        path.join(workspace, 'tests', 'channels', 'peer-routing-integration.test.ts'),
        path.join(workspace, 'tests', 'channels', 'identity-links-integration.test.ts'),
        path.join(workspace, 'tests', 'channels', 'new-channels.test.ts'),
        path.join(workspace, 'tests', 'channels', 'feishu-cards.test.ts'),
        path.join(workspace, 'tests', 'channels', 'dm-policy', 'engine.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-memory-context-persistence-bundle',
        label: 'Memory / context persistence bundle',
        group: 'Memory',
        description:
          'ContextManager, compaction, transcript repair, persistent memory, user model, sessions, pruning et checkpoints',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/enhanced-memory.test.ts',
          'tests/context-manager-v2.test.ts',
          'tests/context/transcript-repair.test.ts',
          'tests/context/tool-pair-preserver.test.ts',
          'tests/context/two-phase-compaction.test.ts',
          'tests/context/context-engine.test.ts',
          'tests/context/precompaction-flush.test.ts',
          'tests/context/auto-compact-threshold.test.ts',
          'tests/context/bootstrap-loader.test.ts',
          'tests/memory/persistent-memory.test.ts',
          'tests/memory/user-model.test.ts',
          'tests/memory/memory-provider.test.ts',
          'tests/memory/decision-memory.test.ts',
          'tests/unit/memory.test.ts',
          'tests/unit/memory-commands.test.ts',
          'tests/session-export.test.ts',
          'tests/session-pruning/pruning.test.ts',
          'tests/checkpoint-manager.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'enhanced-memory.test.ts'),
        path.join(workspace, 'tests', 'context-manager-v2.test.ts'),
        path.join(workspace, 'tests', 'context', 'transcript-repair.test.ts'),
        path.join(workspace, 'tests', 'context', 'tool-pair-preserver.test.ts'),
        path.join(workspace, 'tests', 'context', 'two-phase-compaction.test.ts'),
        path.join(workspace, 'tests', 'context', 'context-engine.test.ts'),
        path.join(workspace, 'tests', 'context', 'precompaction-flush.test.ts'),
        path.join(workspace, 'tests', 'context', 'auto-compact-threshold.test.ts'),
        path.join(workspace, 'tests', 'context', 'bootstrap-loader.test.ts'),
        path.join(workspace, 'tests', 'memory', 'persistent-memory.test.ts'),
        path.join(workspace, 'tests', 'memory', 'user-model.test.ts'),
        path.join(workspace, 'tests', 'memory', 'memory-provider.test.ts'),
        path.join(workspace, 'tests', 'memory', 'decision-memory.test.ts'),
        path.join(workspace, 'tests', 'unit', 'memory.test.ts'),
        path.join(workspace, 'tests', 'unit', 'memory-commands.test.ts'),
        path.join(workspace, 'tests', 'session-export.test.ts'),
        path.join(workspace, 'tests', 'session-pruning', 'pruning.test.ts'),
        path.join(workspace, 'tests', 'checkpoint-manager.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-context-compression-pruning-bundle',
        label: 'Context / compression pruning bundle',
        group: 'Memory',
        description:
          'Web search context, compression gaps, dangling patches, guard, importance scoring, pruning TTL/trim/clear et compaction fallback',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/context/web-search.test.ts',
          'tests/context/restorable-compression-gaps.test.ts',
          'tests/context/dangling-patch.test.ts',
          'tests/context/context-manager-v2-gaps.test.ts',
          'tests/context/pruning/ttl-manager.test.ts',
          'tests/context/observation-variator.test.ts',
          'tests/context/pruning/soft-trim.test.ts',
          'tests/context/importance-scorer.test.ts',
          'tests/context/pruning/hard-clear.test.ts',
          'tests/context/guard.test.ts',
          'tests/context/compaction/progressive-fallback.test.ts',
          'tests/context/compaction/parallel-summarizer.test.ts',
          'tests/context/compaction/memory-flush.test.ts',
          'tests/context/compaction/adaptive-chunker.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'context', 'web-search.test.ts'),
        path.join(workspace, 'tests', 'context', 'restorable-compression-gaps.test.ts'),
        path.join(workspace, 'tests', 'context', 'dangling-patch.test.ts'),
        path.join(workspace, 'tests', 'context', 'context-manager-v2-gaps.test.ts'),
        path.join(workspace, 'tests', 'context', 'pruning', 'ttl-manager.test.ts'),
        path.join(workspace, 'tests', 'context', 'observation-variator.test.ts'),
        path.join(workspace, 'tests', 'context', 'pruning', 'soft-trim.test.ts'),
        path.join(workspace, 'tests', 'context', 'importance-scorer.test.ts'),
        path.join(workspace, 'tests', 'context', 'pruning', 'hard-clear.test.ts'),
        path.join(workspace, 'tests', 'context', 'guard.test.ts'),
        path.join(workspace, 'tests', 'context', 'compaction', 'progressive-fallback.test.ts'),
        path.join(workspace, 'tests', 'context', 'compaction', 'parallel-summarizer.test.ts'),
        path.join(workspace, 'tests', 'context', 'compaction', 'memory-flush.test.ts'),
        path.join(workspace, 'tests', 'context', 'compaction', 'adaptive-chunker.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-voice-speech-tts-bundle',
        label: 'Voice / speech TTS bundle',
        group: 'Voice',
        description:
          'Voice control, speech recognition, wake-word fallback, TTS providers, audio tool et voice-to-code',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/voice-control.test.ts',
          'tests/voice/speech-recognition.test.ts',
          'tests/voice/wake-word.test.ts',
          'tests/talk-mode/tts.test.ts',
          'tests/talk-mode/audioreader-tts.test.ts',
          'tests/talk-mode/providers/openai-tts.test.ts',
          'tests/talk-mode/providers/edge-tts.test.ts',
          'tests/tools/audio-tool.test.ts',
          'tests/unit/voice-to-code.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'voice-control.test.ts'),
        path.join(workspace, 'tests', 'voice', 'speech-recognition.test.ts'),
        path.join(workspace, 'tests', 'voice', 'wake-word.test.ts'),
        path.join(workspace, 'tests', 'talk-mode', 'tts.test.ts'),
        path.join(workspace, 'tests', 'talk-mode', 'audioreader-tts.test.ts'),
        path.join(workspace, 'tests', 'talk-mode', 'providers', 'openai-tts.test.ts'),
        path.join(workspace, 'tests', 'talk-mode', 'providers', 'edge-tts.test.ts'),
        path.join(workspace, 'tests', 'tools', 'audio-tool.test.ts'),
        path.join(workspace, 'tests', 'unit', 'voice-to-code.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-providers-model-config-bundle',
        label: 'Providers / model config bundle',
        group: 'Providers',
        description:
          'Model registry, pricing, defaults, config resolver, ChatGPT OAuth gpt-5.5, fallback chain et smart router',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/config/resolve-model.test.ts',
          'tests/config/model-registry.test.ts',
          'tests/config/model-pricing.test.ts',
          'tests/config/model-defaults.test.ts',
          'tests/config/migration.test.ts',
          'tests/config/env-schema.test.ts',
          'tests/config/config-resolver.test.ts',
          'tests/config/agent-defaults.test.ts',
          'tests/toml-config.test.ts',
          'tests/config-validator.test.ts',
          'tests/llm-provider.test.ts',
          'tests/providers/fallback-chain.test.ts',
          'tests/providers/smart-router.test.ts',
          'tests/providers/codex-oauth.test.ts',
          'tests/codebuddy/providers/provider-openai-compat-hooks.test.ts',
          'tests/codebuddy/providers/provider-chatgpt-responses.test.ts',
          'tests/codebuddy/providers/provider-gemini-cli.test.ts',
          'tests/unit/provider-manager.test.ts',
          'tests/unit/provider-command.test.ts',
          'tests/unit/providers.test.ts',
          'tests/unit/models.test.ts',
          'tests/unit/models-snapshot.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'config', 'resolve-model.test.ts'),
        path.join(workspace, 'tests', 'config', 'model-registry.test.ts'),
        path.join(workspace, 'tests', 'config', 'model-pricing.test.ts'),
        path.join(workspace, 'tests', 'config', 'model-defaults.test.ts'),
        path.join(workspace, 'tests', 'config', 'migration.test.ts'),
        path.join(workspace, 'tests', 'config', 'env-schema.test.ts'),
        path.join(workspace, 'tests', 'config', 'config-resolver.test.ts'),
        path.join(workspace, 'tests', 'config', 'agent-defaults.test.ts'),
        path.join(workspace, 'tests', 'toml-config.test.ts'),
        path.join(workspace, 'tests', 'config-validator.test.ts'),
        path.join(workspace, 'tests', 'llm-provider.test.ts'),
        path.join(workspace, 'tests', 'providers', 'fallback-chain.test.ts'),
        path.join(workspace, 'tests', 'providers', 'smart-router.test.ts'),
        path.join(workspace, 'tests', 'providers', 'codex-oauth.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'providers', 'provider-openai-compat-hooks.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'providers', 'provider-chatgpt-responses.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'providers', 'provider-gemini-cli.test.ts'),
        path.join(workspace, 'tests', 'unit', 'provider-manager.test.ts'),
        path.join(workspace, 'tests', 'unit', 'provider-command.test.ts'),
        path.join(workspace, 'tests', 'unit', 'providers.test.ts'),
        path.join(workspace, 'tests', 'unit', 'models.test.ts'),
        path.join(workspace, 'tests', 'unit', 'models-snapshot.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-provider-resilience-error-bundle',
        label: 'Providers / resilience error bundle',
        group: 'Providers',
        description: 'Stream retry, rate limit, provider errors, client recovery, backoff et affichage des limites',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/codebuddy/stream-retry.test.ts',
          'tests/codebuddy/client-stream-retry.test.ts',
          'tests/streaming/retry-policy.test.ts',
          'tests/unit/retry.test.ts',
          'tests/rate-limiter.test.ts',
          'tests/unit/rate-limit-display.test.ts',
          'tests/utils/errors.test.ts',
          'tests/unit/errors.test.ts',
          'tests/unit/error-handling-audit.test.ts',
          'tests/unit/client.test.ts',
          'tests/unit/codebuddy-client.test.ts',
          'tests/unit/codebuddy-client-gemini-malformed.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'codebuddy', 'stream-retry.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'client-stream-retry.test.ts'),
        path.join(workspace, 'tests', 'streaming', 'retry-policy.test.ts'),
        path.join(workspace, 'tests', 'unit', 'retry.test.ts'),
        path.join(workspace, 'tests', 'rate-limiter.test.ts'),
        path.join(workspace, 'tests', 'unit', 'rate-limit-display.test.ts'),
        path.join(workspace, 'tests', 'utils', 'errors.test.ts'),
        path.join(workspace, 'tests', 'unit', 'errors.test.ts'),
        path.join(workspace, 'tests', 'unit', 'error-handling-audit.test.ts'),
        path.join(workspace, 'tests', 'unit', 'client.test.ts'),
        path.join(workspace, 'tests', 'unit', 'codebuddy-client.test.ts'),
        path.join(workspace, 'tests', 'unit', 'codebuddy-client-gemini-malformed.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-tools-editing-search-bundle',
        label: 'Tools / editing search bundle',
        group: 'Tools',
        description:
          'Text editor, bash, process, sessions, tool selector, search, hybrid index, result sanitizer et tool filtering',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/tools/text-editor.test.ts',
          'tests/tools/ls-tool.test.ts',
          'tests/tools/process-tool.test.ts',
          'tests/tools/plan-tool.test.ts',
          'tests/tools/session-tools.test.ts',
          'tests/tools/tool-selector.test.ts',
          'tests/tools/bash-tool.test.ts',
          'tests/tools/bash-streaming.test.ts',
          'tests/unit/text-editor.test.ts',
          'tests/unit/tools.test.ts',
          'tests/unit/tools-core.test.ts',
          'tests/unit/search-tool.test.ts',
          'tests/unit/enhanced-search.test.ts',
          'tests/unit/codebuddy-client-search-compat.test.ts',
          'tests/search/hybrid-search.test.ts',
          'tests/search/usearch-index.test.ts',
          'tests/agent/tool-handler-filter.test.ts',
          'tests/agent/tool-executor.test.ts',
          'tests/agent/execution/tool-selection-lite.test.ts',
          'tests/agent/middleware/tool-filter.test.ts',
          'tests/tools/hooks/result-sanitizer.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'tools', 'text-editor.test.ts'),
        path.join(workspace, 'tests', 'tools', 'ls-tool.test.ts'),
        path.join(workspace, 'tests', 'tools', 'process-tool.test.ts'),
        path.join(workspace, 'tests', 'tools', 'plan-tool.test.ts'),
        path.join(workspace, 'tests', 'tools', 'session-tools.test.ts'),
        path.join(workspace, 'tests', 'tools', 'tool-selector.test.ts'),
        path.join(workspace, 'tests', 'tools', 'bash-tool.test.ts'),
        path.join(workspace, 'tests', 'tools', 'bash-streaming.test.ts'),
        path.join(workspace, 'tests', 'unit', 'text-editor.test.ts'),
        path.join(workspace, 'tests', 'unit', 'tools.test.ts'),
        path.join(workspace, 'tests', 'unit', 'tools-core.test.ts'),
        path.join(workspace, 'tests', 'unit', 'search-tool.test.ts'),
        path.join(workspace, 'tests', 'unit', 'enhanced-search.test.ts'),
        path.join(workspace, 'tests', 'unit', 'codebuddy-client-search-compat.test.ts'),
        path.join(workspace, 'tests', 'search', 'hybrid-search.test.ts'),
        path.join(workspace, 'tests', 'search', 'usearch-index.test.ts'),
        path.join(workspace, 'tests', 'agent', 'tool-handler-filter.test.ts'),
        path.join(workspace, 'tests', 'agent', 'tool-executor.test.ts'),
        path.join(workspace, 'tests', 'agent', 'execution', 'tool-selection-lite.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'tool-filter.test.ts'),
        path.join(workspace, 'tests', 'tools', 'hooks', 'result-sanitizer.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-agent-reasoning-execution-bundle',
        label: 'Agent / reasoning execution bundle',
        group: 'Agent',
        description:
          'CodeBuddyAgent, executor, middleware, reasoning facade, prompt builder, message processor et planning flow',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/agent/codebuddy-agent.test.ts',
          'tests/agent/agent-executor-lanes.test.ts',
          'tests/agent/execution/agent-executor.test.ts',
          'tests/agent/execution/context-pipeline-user-model.test.ts',
          'tests/agent/execution/fleet-tool-hooks.test.ts',
          'tests/agent/middleware/workflow-guard.test.ts',
          'tests/agent/middleware/verification-enforcement.test.ts',
          'tests/agent/middleware/state-bag.test.ts',
          'tests/agent/middleware/quality-gate-middleware.test.ts',
          'tests/agent/middleware/pipeline.test.ts',
          'tests/agent/middleware/learning-first.test.ts',
          'tests/agent/middleware/auto-repair-middleware.test.ts',
          'tests/agent/middleware/auto-observation.test.ts',
          'tests/reasoning.test.ts',
          'tests/reasoning/think-handlers.test.ts',
          'tests/reasoning/reasoning-middleware.test.ts',
          'tests/reasoning/reasoning-facade.test.ts',
          'tests/agent/streaming/reasoning.test.ts',
          'tests/services/prompt-builder.test.ts',
          'tests/services/prompt-builder-query-aware.test.ts',
          'tests/agent/message-processor.test.ts',
          'tests/unit/message-processor.test.ts',
          'tests/agent/planning-flow.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'agent', 'codebuddy-agent.test.ts'),
        path.join(workspace, 'tests', 'agent', 'agent-executor-lanes.test.ts'),
        path.join(workspace, 'tests', 'agent', 'execution', 'agent-executor.test.ts'),
        path.join(workspace, 'tests', 'agent', 'execution', 'context-pipeline-user-model.test.ts'),
        path.join(workspace, 'tests', 'agent', 'execution', 'fleet-tool-hooks.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'workflow-guard.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'verification-enforcement.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'state-bag.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'quality-gate-middleware.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'pipeline.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'learning-first.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'auto-repair-middleware.test.ts'),
        path.join(workspace, 'tests', 'agent', 'middleware', 'auto-observation.test.ts'),
        path.join(workspace, 'tests', 'reasoning.test.ts'),
        path.join(workspace, 'tests', 'reasoning', 'think-handlers.test.ts'),
        path.join(workspace, 'tests', 'reasoning', 'reasoning-middleware.test.ts'),
        path.join(workspace, 'tests', 'reasoning', 'reasoning-facade.test.ts'),
        path.join(workspace, 'tests', 'agent', 'streaming', 'reasoning.test.ts'),
        path.join(workspace, 'tests', 'services', 'prompt-builder.test.ts'),
        path.join(workspace, 'tests', 'services', 'prompt-builder-query-aware.test.ts'),
        path.join(workspace, 'tests', 'agent', 'message-processor.test.ts'),
        path.join(workspace, 'tests', 'unit', 'message-processor.test.ts'),
        path.join(workspace, 'tests', 'agent', 'planning-flow.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-autonomous-multi-agent-harness-bundle',
        label: 'Autonomous / multi-agent harness bundle',
        group: 'Autonomous',
        description:
          'Agentic coding runner, checkpoints, verification loop, workflow orchestrator, multi-agent persistence et parallel executor',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/agent/autonomous/agentic-coding-contract.test.ts',
          'tests/agent/autonomous/agentic-coding-runner.test.ts',
          'tests/agent/autonomous/agentic-coding-runner-security.test.ts',
          'tests/agent/autonomous/checkpoint-manager.test.ts',
          'tests/agent/autonomous/checkpoint-resume.test.ts',
          'tests/agent/autonomous/edit-proposal-producer.test.ts',
          'tests/agent/autonomous/task-decomposer.test.ts',
          'tests/agent/autonomous/verification-loop.test.ts',
          'tests/agent/autonomous/fleet-llm-routing.test.ts',
          'tests/agent/autonomous/fleet-tick-handler.test.ts',
          'tests/agent/multi-agent/worktree-isolation.test.ts',
          'tests/agent/multi-agent/workflow-persistence.test.ts',
          'tests/agent/multi-agent/workflow-orchestrator.test.ts',
          'tests/agent/multi-agent/workflow-multi-persistence.test.ts',
          'tests/agent/multi-agent/workflow-event-streamer.test.ts',
          'tests/agent/multi-agent/workflow-cost-manager.test.ts',
          'tests/agent/multi-agent/sessions-yield.test.ts',
          'tests/agent/multi-agent/session-fleet-bridge.test.ts',
          'tests/agent/multi-agent/persistence-integration.test.ts',
          'tests/agent/multi-agent/metrics-ttl.test.ts',
          'tests/agent/multi-agent/metrics-persistence.test.ts',
          'tests/agent/multi-agent/heterogeneous-providers.test.ts',
          'tests/agent/multi-agent/fleet-workflow-bridge.test.ts',
          'tests/agent/multi-agent/coordinator-integration.test.ts',
          'tests/agent/multi-agent/auto-resolve.test.ts',
          'tests/agent/multi-agent/auto-resolve-mas-integration.test.ts',
          'tests/agent/multi-agent/async-background.test.ts',
          'tests/workflows/pipeline-integration.test.ts',
          'tests/workflows/pipeline-approval.test.ts',
          'tests/workflows/agent-pipeline.test.ts',
          'tests/planner/task-graph.test.ts',
          'tests/planner/delegation-engine.test.ts',
          'tests/integration/multi-agent.test.ts',
          'tests/advanced-parallel-executor.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 300_000,
      },
      [
        path.join(workspace, 'tests', 'agent', 'autonomous', 'agentic-coding-contract.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'agentic-coding-runner.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'agentic-coding-runner-security.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'checkpoint-manager.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'checkpoint-resume.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'edit-proposal-producer.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'task-decomposer.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'verification-loop.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'fleet-llm-routing.test.ts'),
        path.join(workspace, 'tests', 'agent', 'autonomous', 'fleet-tick-handler.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'worktree-isolation.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'workflow-persistence.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'workflow-orchestrator.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'workflow-multi-persistence.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'workflow-event-streamer.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'workflow-cost-manager.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'sessions-yield.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'session-fleet-bridge.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'persistence-integration.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'metrics-ttl.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'metrics-persistence.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'heterogeneous-providers.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'fleet-workflow-bridge.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'coordinator-integration.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'auto-resolve.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'auto-resolve-mas-integration.test.ts'),
        path.join(workspace, 'tests', 'agent', 'multi-agent', 'async-background.test.ts'),
        path.join(workspace, 'tests', 'workflows', 'pipeline-integration.test.ts'),
        path.join(workspace, 'tests', 'workflows', 'pipeline-approval.test.ts'),
        path.join(workspace, 'tests', 'workflows', 'agent-pipeline.test.ts'),
        path.join(workspace, 'tests', 'planner', 'task-graph.test.ts'),
        path.join(workspace, 'tests', 'planner', 'delegation-engine.test.ts'),
        path.join(workspace, 'tests', 'integration', 'multi-agent.test.ts'),
        path.join(workspace, 'tests', 'advanced-parallel-executor.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-companion-core-behaviour-bundle',
        label: 'Companion / core behaviour bundle',
        group: 'Companion',
        description: 'Companion camera, percepts, missions, safety ledger, self-evaluation, privacy et skill curator',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/companion-camera.test.ts',
          'tests/companion-cards.test.ts',
          'tests/companion-check-in.test.ts',
          'tests/companion-competitive-radar.test.ts',
          'tests/companion-gateway.test.ts',
          'tests/companion-improvement-cycle.test.ts',
          'tests/companion-impulses.test.ts',
          'tests/companion-mission-board.test.ts',
          'tests/companion-mission-runner.test.ts',
          'tests/companion-mode.test.ts',
          'tests/companion-percepts.test.ts',
          'tests/companion-privacy.test.ts',
          'tests/companion-safety-ledger.test.ts',
          'tests/companion-self-evaluation.test.ts',
          'tests/companion-skill-curator.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'companion-camera.test.ts'),
        path.join(workspace, 'tests', 'companion-cards.test.ts'),
        path.join(workspace, 'tests', 'companion-check-in.test.ts'),
        path.join(workspace, 'tests', 'companion-competitive-radar.test.ts'),
        path.join(workspace, 'tests', 'companion-gateway.test.ts'),
        path.join(workspace, 'tests', 'companion-improvement-cycle.test.ts'),
        path.join(workspace, 'tests', 'companion-impulses.test.ts'),
        path.join(workspace, 'tests', 'companion-mission-board.test.ts'),
        path.join(workspace, 'tests', 'companion-mission-runner.test.ts'),
        path.join(workspace, 'tests', 'companion-mode.test.ts'),
        path.join(workspace, 'tests', 'companion-percepts.test.ts'),
        path.join(workspace, 'tests', 'companion-privacy.test.ts'),
        path.join(workspace, 'tests', 'companion-safety-ledger.test.ts'),
        path.join(workspace, 'tests', 'companion-self-evaluation.test.ts'),
        path.join(workspace, 'tests', 'companion-skill-curator.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-browser-desktop-automation-bundle',
        label: 'Automation / browser desktop bundle',
        group: 'Automation',
        description:
          'Browser automation, internet scout/proof, route interceptor, screenshots, desktop automation et OCR',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/browser-automation/batch-actions.test.ts',
          'tests/browser-automation/browser-manager-refs.test.ts',
          'tests/browser-automation/browser-operator-executor.test.ts',
          'tests/browser-automation/browser-operator-session.test.ts',
          'tests/browser-automation/browser-stagehand-actions.test.ts',
          'tests/browser-automation/internet-proof-plan.test.ts',
          'tests/browser-automation/internet-scout-plan.test.ts',
          'tests/browser-automation/internet-scout-runner.test.ts',
          'tests/browser-automation/profile-manager.test.ts',
          'tests/browser-automation/route-interceptor.test.ts',
          'tests/browser-automation/screenshot-annotator.test.ts',
          'tests/desktop-automation/automation.test.ts',
          'tests/desktop-automation/native-providers.test.ts',
          'tests/desktop-automation/smart-snapshot-ocr.test.ts',
          'tests/desktop-automation/smart-snapshot-refs.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'browser-automation', 'batch-actions.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'browser-manager-refs.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'browser-operator-executor.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'browser-operator-session.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'browser-stagehand-actions.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'internet-proof-plan.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'internet-scout-plan.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'internet-scout-runner.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'profile-manager.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'route-interceptor.test.ts'),
        path.join(workspace, 'tests', 'browser-automation', 'screenshot-annotator.test.ts'),
        path.join(workspace, 'tests', 'desktop-automation', 'automation.test.ts'),
        path.join(workspace, 'tests', 'desktop-automation', 'native-providers.test.ts'),
        path.join(workspace, 'tests', 'desktop-automation', 'smart-snapshot-ocr.test.ts'),
        path.join(workspace, 'tests', 'desktop-automation', 'smart-snapshot-refs.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-scheduler-hooks-notifications-bundle',
        label: 'Automation / scheduler hooks notifications bundle',
        group: 'Automation',
        description: 'Scheduler, cron prechecks, hooks lifecycle/input/tool lanes, webhooks, triggers et notifications',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/scheduler/watchdog-handlers.test.ts',
          'tests/scheduler/scheduled-delivery.test.ts',
          'tests/scheduler/pre-check-runner.test.ts',
          'tests/scheduler/cron-session.test.ts',
          'tests/scheduler/cron-precheck-persistence.test.ts',
          'tests/hooks/user-hooks.test.ts',
          'tests/hooks/moltbot-hooks.test.ts',
          'tests/hooks/lifecycle-hooks.test.ts',
          'tests/hooks/input-handler.test.ts',
          'tests/hooks/hermes-lifecycle-hooks.test.ts',
          'tests/hooks/advanced-hooks.test.ts',
          'tests/tools/hooks/tool-hooks.test.ts',
          'tests/tools/hooks/session-lanes.test.ts',
          'tests/webhooks/webhook-manager.test.ts',
          'tests/triggers/webhook-trigger.test.ts',
          'tests/unit/hook-manager.test.ts',
          'tests/unit/hook-llm-evaluation.test.ts',
          'tests/unit/scheduler.test.ts',
          'tests/unit/webhooks.test.ts',
          'tests/proactive/notification-manager.test.ts',
          'tests/agent/proactive/notification-default-sink.test.ts',
          'tests/unit/notifications.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'scheduler', 'watchdog-handlers.test.ts'),
        path.join(workspace, 'tests', 'scheduler', 'scheduled-delivery.test.ts'),
        path.join(workspace, 'tests', 'scheduler', 'pre-check-runner.test.ts'),
        path.join(workspace, 'tests', 'scheduler', 'cron-session.test.ts'),
        path.join(workspace, 'tests', 'scheduler', 'cron-precheck-persistence.test.ts'),
        path.join(workspace, 'tests', 'hooks', 'user-hooks.test.ts'),
        path.join(workspace, 'tests', 'hooks', 'moltbot-hooks.test.ts'),
        path.join(workspace, 'tests', 'hooks', 'lifecycle-hooks.test.ts'),
        path.join(workspace, 'tests', 'hooks', 'input-handler.test.ts'),
        path.join(workspace, 'tests', 'hooks', 'hermes-lifecycle-hooks.test.ts'),
        path.join(workspace, 'tests', 'hooks', 'advanced-hooks.test.ts'),
        path.join(workspace, 'tests', 'tools', 'hooks', 'tool-hooks.test.ts'),
        path.join(workspace, 'tests', 'tools', 'hooks', 'session-lanes.test.ts'),
        path.join(workspace, 'tests', 'webhooks', 'webhook-manager.test.ts'),
        path.join(workspace, 'tests', 'triggers', 'webhook-trigger.test.ts'),
        path.join(workspace, 'tests', 'unit', 'hook-manager.test.ts'),
        path.join(workspace, 'tests', 'unit', 'hook-llm-evaluation.test.ts'),
        path.join(workspace, 'tests', 'unit', 'scheduler.test.ts'),
        path.join(workspace, 'tests', 'unit', 'webhooks.test.ts'),
        path.join(workspace, 'tests', 'proactive', 'notification-manager.test.ts'),
        path.join(workspace, 'tests', 'agent', 'proactive', 'notification-default-sink.test.ts'),
        path.join(workspace, 'tests', 'unit', 'notifications.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-security-hardening-audit-bundle',
        label: 'Security / hardening audit bundle',
        group: 'Security',
        description:
          'Audit logger, bash allowlist/parser, validators, env blocklist, policy engine, secrets, path guard et skill scanner',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/security/audit-logger.test.ts',
          'tests/security/bash-allowlist/allowlist-store.test.ts',
          'tests/security/bash-allowlist/pattern-matcher.test.ts',
          'tests/security/bash-parser.test.ts',
          'tests/security/code-validator.test.ts',
          'tests/security/context-engine-trust.test.ts',
          'tests/security/dangerous-patterns.test.ts',
          'tests/security/env-blocklist.test.ts',
          'tests/security/policy-engine.test.ts',
          'tests/security/security-audit.test.ts',
          'tests/security/skill-scanner.test.ts',
          'tests/security/syntax-validator.test.ts',
          'tests/security/tool-policy/policy-resolver.test.ts',
          'tests/security/tool-policy/profiles.test.ts',
          'tests/security/trust-folders.test.ts',
          'tests/unit/secrets-detector.test.ts',
          'tests/utils/path-validator.test.ts',
          'tests/security-manager.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'security', 'audit-logger.test.ts'),
        path.join(workspace, 'tests', 'security', 'bash-allowlist', 'allowlist-store.test.ts'),
        path.join(workspace, 'tests', 'security', 'bash-allowlist', 'pattern-matcher.test.ts'),
        path.join(workspace, 'tests', 'security', 'bash-parser.test.ts'),
        path.join(workspace, 'tests', 'security', 'code-validator.test.ts'),
        path.join(workspace, 'tests', 'security', 'context-engine-trust.test.ts'),
        path.join(workspace, 'tests', 'security', 'dangerous-patterns.test.ts'),
        path.join(workspace, 'tests', 'security', 'env-blocklist.test.ts'),
        path.join(workspace, 'tests', 'security', 'policy-engine.test.ts'),
        path.join(workspace, 'tests', 'security', 'security-audit.test.ts'),
        path.join(workspace, 'tests', 'security', 'skill-scanner.test.ts'),
        path.join(workspace, 'tests', 'security', 'syntax-validator.test.ts'),
        path.join(workspace, 'tests', 'security', 'tool-policy', 'policy-resolver.test.ts'),
        path.join(workspace, 'tests', 'security', 'tool-policy', 'profiles.test.ts'),
        path.join(workspace, 'tests', 'security', 'trust-folders.test.ts'),
        path.join(workspace, 'tests', 'unit', 'secrets-detector.test.ts'),
        path.join(workspace, 'tests', 'utils', 'path-validator.test.ts'),
        path.join(workspace, 'tests', 'security-manager.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-cli-command-surface-bundle',
        label: 'CLI / command surface bundle',
        group: 'CLI',
        description:
          'CLI flags, headless exit codes, model/session commands, slash handlers, auth, fleet, tools, backup, agents et run recall',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/cli/cli-flags.test.ts',
          'tests/cli/headless-exit-code.test.ts',
          'tests/cli/model-listing.test.ts',
          'tests/cli/session-commands.test.ts',
          'tests/commands/core-handlers.test.ts',
          'tests/commands/slash-commands.test.ts',
          'tests/commands/context-handlers.test.ts',
          'tests/commands/session-handlers.test.ts',
          'tests/commands/permissions-handlers.test.ts',
          'tests/commands/security-handlers.test.ts',
          'tests/commands/tools-commands.test.ts',
          'tests/commands/backup-handlers.test.ts',
          'tests/commands/agents-handler.test.ts',
          'tests/commands/agent-handlers.test.ts',
          'tests/commands/run-commands.test.ts',
          'tests/commands/worktree-handlers.test.ts',
          'tests/commands/fleet-commands.test.ts',
          'tests/commands/handlers/auth-handlers.test.ts',
          'tests/unit/slash-commands.test.ts',
          'tests/unit/config-command.test.ts',
          'tests/unit/memory-commands.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'cli', 'cli-flags.test.ts'),
        path.join(workspace, 'tests', 'cli', 'headless-exit-code.test.ts'),
        path.join(workspace, 'tests', 'cli', 'model-listing.test.ts'),
        path.join(workspace, 'tests', 'cli', 'session-commands.test.ts'),
        path.join(workspace, 'tests', 'commands', 'core-handlers.test.ts'),
        path.join(workspace, 'tests', 'commands', 'slash-commands.test.ts'),
        path.join(workspace, 'tests', 'commands', 'context-handlers.test.ts'),
        path.join(workspace, 'tests', 'commands', 'session-handlers.test.ts'),
        path.join(workspace, 'tests', 'commands', 'permissions-handlers.test.ts'),
        path.join(workspace, 'tests', 'commands', 'security-handlers.test.ts'),
        path.join(workspace, 'tests', 'commands', 'tools-commands.test.ts'),
        path.join(workspace, 'tests', 'commands', 'backup-handlers.test.ts'),
        path.join(workspace, 'tests', 'commands', 'agents-handler.test.ts'),
        path.join(workspace, 'tests', 'commands', 'agent-handlers.test.ts'),
        path.join(workspace, 'tests', 'commands', 'run-commands.test.ts'),
        path.join(workspace, 'tests', 'commands', 'worktree-handlers.test.ts'),
        path.join(workspace, 'tests', 'commands', 'fleet-commands.test.ts'),
        path.join(workspace, 'tests', 'commands', 'handlers', 'auth-handlers.test.ts'),
        path.join(workspace, 'tests', 'unit', 'slash-commands.test.ts'),
        path.join(workspace, 'tests', 'unit', 'config-command.test.ts'),
        path.join(workspace, 'tests', 'unit', 'memory-commands.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-plugins-skills-bundle',
        label: 'Plugins / skills bundle',
        group: 'Plugins',
        description:
          'Plugin manager, SDK channel, conflict detector, cloud providers, plugin CLI, skill registry, layering, hub et eligibility',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/plugins/provider-onboarding.test.ts',
          'tests/plugins/plugin-sdk-channel.test.ts',
          'tests/plugins/plugin-manager.test.ts',
          'tests/plugins/plugin-conflict-detector.test.ts',
          'tests/plugins/gitnexus.test.ts',
          'tests/plugins/extra-providers.test.ts',
          'tests/plugins/cloud-providers.test.ts',
          'tests/features/plugins-teams-output.test.ts',
          'tests/features/plugins-commands-summarize.test.ts',
          'tests/integration/plugin-cli.test.ts',
          'tests/unit/plugins.test.ts',
          'tests/skills/unified-registry.test.ts',
          'tests/skills/starter-packs.test.ts',
          'tests/skills/skill-registry.test.ts',
          'tests/skills/skill-prompt-integration.test.ts',
          'tests/skills/skill-manager.test.ts',
          'tests/skills/skill-loader.test.ts',
          'tests/skills/skill-layering.test.ts',
          'tests/skills/legacy-adapter.test.ts',
          'tests/skills/hub.test.ts',
          'tests/skills/eligibility.test.ts',
          'tests/skills/deprecation-warnings.test.ts',
          'tests/skills/bundled-skills.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 180_000,
      },
      [
        path.join(workspace, 'tests', 'plugins', 'provider-onboarding.test.ts'),
        path.join(workspace, 'tests', 'plugins', 'plugin-sdk-channel.test.ts'),
        path.join(workspace, 'tests', 'plugins', 'plugin-manager.test.ts'),
        path.join(workspace, 'tests', 'plugins', 'plugin-conflict-detector.test.ts'),
        path.join(workspace, 'tests', 'plugins', 'gitnexus.test.ts'),
        path.join(workspace, 'tests', 'plugins', 'extra-providers.test.ts'),
        path.join(workspace, 'tests', 'plugins', 'cloud-providers.test.ts'),
        path.join(workspace, 'tests', 'features', 'plugins-teams-output.test.ts'),
        path.join(workspace, 'tests', 'features', 'plugins-commands-summarize.test.ts'),
        path.join(workspace, 'tests', 'integration', 'plugin-cli.test.ts'),
        path.join(workspace, 'tests', 'unit', 'plugins.test.ts'),
        path.join(workspace, 'tests', 'skills', 'unified-registry.test.ts'),
        path.join(workspace, 'tests', 'skills', 'starter-packs.test.ts'),
        path.join(workspace, 'tests', 'skills', 'skill-registry.test.ts'),
        path.join(workspace, 'tests', 'skills', 'skill-prompt-integration.test.ts'),
        path.join(workspace, 'tests', 'skills', 'skill-manager.test.ts'),
        path.join(workspace, 'tests', 'skills', 'skill-loader.test.ts'),
        path.join(workspace, 'tests', 'skills', 'skill-layering.test.ts'),
        path.join(workspace, 'tests', 'skills', 'legacy-adapter.test.ts'),
        path.join(workspace, 'tests', 'skills', 'hub.test.ts'),
        path.join(workspace, 'tests', 'skills', 'eligibility.test.ts'),
        path.join(workspace, 'tests', 'skills', 'deprecation-warnings.test.ts'),
        path.join(workspace, 'tests', 'skills', 'bundled-skills.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-terminal-ui-observer-bundle',
        label: 'UI / terminal observer bundle',
        group: 'UI',
        description:
          'Ink chat interface, accessibility, themes, status line, shortcuts, metrics dashboard, clipboard, GUI tool et screen observer',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/ui/accessibility.test.ts',
          'tests/ui/chat-interface.test.tsx',
          'tests/ui/diff-renderer-logic.test.ts',
          'tests/ui/keyboard-shortcuts.test.ts',
          'tests/ui/metrics-dashboard.test.ts',
          'tests/ui/status-line.test.ts',
          'tests/ui/tabbed-question.test.ts',
          'tests/ui/themes.test.ts',
          'tests/ui/tool-stream-output.test.ts',
          'tests/unit/ui-components.test.ts',
          'tests/unit/clipboard.test.ts',
          'tests/unit/clipboard-manager.test.ts',
          'tests/unit/browser-commands.test.ts',
          'tests/tools/gui-tool.test.ts',
          'tests/observer/event-trigger.test.ts',
          'tests/observer/screen-observer.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'ui', 'accessibility.test.ts'),
        path.join(workspace, 'tests', 'ui', 'chat-interface.test.tsx'),
        path.join(workspace, 'tests', 'ui', 'diff-renderer-logic.test.ts'),
        path.join(workspace, 'tests', 'ui', 'keyboard-shortcuts.test.ts'),
        path.join(workspace, 'tests', 'ui', 'metrics-dashboard.test.ts'),
        path.join(workspace, 'tests', 'ui', 'status-line.test.ts'),
        path.join(workspace, 'tests', 'ui', 'tabbed-question.test.ts'),
        path.join(workspace, 'tests', 'ui', 'themes.test.ts'),
        path.join(workspace, 'tests', 'ui', 'tool-stream-output.test.ts'),
        path.join(workspace, 'tests', 'unit', 'ui-components.test.ts'),
        path.join(workspace, 'tests', 'unit', 'clipboard.test.ts'),
        path.join(workspace, 'tests', 'unit', 'clipboard-manager.test.ts'),
        path.join(workspace, 'tests', 'unit', 'browser-commands.test.ts'),
        path.join(workspace, 'tests', 'tools', 'gui-tool.test.ts'),
        path.join(workspace, 'tests', 'observer', 'event-trigger.test.ts'),
        path.join(workspace, 'tests', 'observer', 'screen-observer.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-config-auth-provider-bundle',
        label: 'Config / auth provider bundle',
        group: 'Config',
        description:
          'Auth profile manager, ChatGPT OAuth doctor, provider routing hooks, model registry/pricing/defaults, TOML/JSONC config et config mutators',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/auth/profile-manager.test.ts',
          'tests/auth/oauth/manager.test.ts',
          'tests/auth/oauth/model-profiles.test.ts',
          'tests/doctor/chatgpt-oauth-check.test.ts',
          'tests/providers/codex-oauth.test.ts',
          'tests/providers/codex-oauth-e2e.test.ts',
          'tests/codebuddy/providers/provider-openai-compat-hooks.test.ts',
          'tests/codebuddy/providers/provider-chatgpt-responses.test.ts',
          'tests/codebuddy/providers/provider-gemini-cli.test.ts',
          'tests/codebuddy/client-stream-retry.test.ts',
          'tests/codebuddy/client-gemini-vision.test.ts',
          'tests/config/resolve-model.test.ts',
          'tests/config/model-registry.test.ts',
          'tests/config/model-pricing.test.ts',
          'tests/config/model-defaults.test.ts',
          'tests/config/migration.test.ts',
          'tests/config/env-schema.test.ts',
          'tests/config/config-resolver.test.ts',
          'tests/config/agent-defaults.test.ts',
          'tests/config-validator.test.ts',
          'tests/toml-config.test.ts',
          'tests/unit/config.test.ts',
          'tests/unit/config-loader.test.ts',
          'tests/unit/config-migrator.test.ts',
          'tests/unit/config-mutator.test.ts',
          'tests/unit/jsonc-config.test.ts',
          'tests/unit/provider-command.test.ts',
          'tests/unit/provider-manager.test.ts',
          'tests/unit/providers.test.ts',
          'tests/unit/models.test.ts',
          'tests/unit/models-snapshot.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'auth', 'profile-manager.test.ts'),
        path.join(workspace, 'tests', 'auth', 'oauth', 'manager.test.ts'),
        path.join(workspace, 'tests', 'auth', 'oauth', 'model-profiles.test.ts'),
        path.join(workspace, 'tests', 'doctor', 'chatgpt-oauth-check.test.ts'),
        path.join(workspace, 'tests', 'providers', 'codex-oauth.test.ts'),
        path.join(workspace, 'tests', 'providers', 'codex-oauth-e2e.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'providers', 'provider-openai-compat-hooks.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'providers', 'provider-chatgpt-responses.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'providers', 'provider-gemini-cli.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'client-stream-retry.test.ts'),
        path.join(workspace, 'tests', 'codebuddy', 'client-gemini-vision.test.ts'),
        path.join(workspace, 'tests', 'config', 'resolve-model.test.ts'),
        path.join(workspace, 'tests', 'config', 'model-registry.test.ts'),
        path.join(workspace, 'tests', 'config', 'model-pricing.test.ts'),
        path.join(workspace, 'tests', 'config', 'model-defaults.test.ts'),
        path.join(workspace, 'tests', 'config', 'migration.test.ts'),
        path.join(workspace, 'tests', 'config', 'env-schema.test.ts'),
        path.join(workspace, 'tests', 'config', 'config-resolver.test.ts'),
        path.join(workspace, 'tests', 'config', 'agent-defaults.test.ts'),
        path.join(workspace, 'tests', 'config-validator.test.ts'),
        path.join(workspace, 'tests', 'toml-config.test.ts'),
        path.join(workspace, 'tests', 'unit', 'config.test.ts'),
        path.join(workspace, 'tests', 'unit', 'config-loader.test.ts'),
        path.join(workspace, 'tests', 'unit', 'config-migrator.test.ts'),
        path.join(workspace, 'tests', 'unit', 'config-mutator.test.ts'),
        path.join(workspace, 'tests', 'unit', 'jsonc-config.test.ts'),
        path.join(workspace, 'tests', 'unit', 'provider-command.test.ts'),
        path.join(workspace, 'tests', 'unit', 'provider-manager.test.ts'),
        path.join(workspace, 'tests', 'unit', 'providers.test.ts'),
        path.join(workspace, 'tests', 'unit', 'models.test.ts'),
        path.join(workspace, 'tests', 'unit', 'models-snapshot.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-data-session-sync-cache-bundle',
        label: 'Data / session sync cache bundle',
        group: 'Data',
        description:
          'Database layer, sessions, branches, sync, peer session store, cron persistence, KV/cache, response cache, prompt cache et distributed cache',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/database.test.ts',
          'tests/kv-cache-config.test.ts',
          'tests/persistence/session-lock.test.ts',
          'tests/persistence/conversation-branches.test.ts',
          'tests/sync/cloud-sync.test.ts',
          'tests/unit/sync.test.ts',
          'tests/unit/sync-persistence.test.ts',
          'tests/unit/sync-bindings.test.ts',
          'tests/unit/session-timeline.test.ts',
          'tests/unit/session-store.test.ts',
          'tests/unit/session-replay.test.ts',
          'tests/unit/session-export.test.ts',
          'tests/unit/session-export-formats.test.ts',
          'tests/unit/session-enhancements-update-channel.test.ts',
          'tests/unit/session-cleanup.test.ts',
          'tests/unit/database-layer.test.ts',
          'tests/unit/cloud-storage-factory.test.ts',
          'tests/unit/response-cache.test.ts',
          'tests/unit/prompt-cache.test.ts',
          'tests/unit/cache.test.ts',
          'tests/unit/distributed-cache.test.ts',
          'tests/utils/cache.test.ts',
          'tests/utils/lru-cache.test.ts',
          'tests/optimization/prompt-cache.test.ts',
          'tests/fleet/peer-session-store.test.ts',
          'tests/scheduler/cron-session.test.ts',
          'tests/scheduler/cron-precheck-persistence.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'database.test.ts'),
        path.join(workspace, 'tests', 'kv-cache-config.test.ts'),
        path.join(workspace, 'tests', 'persistence', 'session-lock.test.ts'),
        path.join(workspace, 'tests', 'persistence', 'conversation-branches.test.ts'),
        path.join(workspace, 'tests', 'sync', 'cloud-sync.test.ts'),
        path.join(workspace, 'tests', 'unit', 'sync.test.ts'),
        path.join(workspace, 'tests', 'unit', 'sync-persistence.test.ts'),
        path.join(workspace, 'tests', 'unit', 'sync-bindings.test.ts'),
        path.join(workspace, 'tests', 'unit', 'session-timeline.test.ts'),
        path.join(workspace, 'tests', 'unit', 'session-store.test.ts'),
        path.join(workspace, 'tests', 'unit', 'session-replay.test.ts'),
        path.join(workspace, 'tests', 'unit', 'session-export.test.ts'),
        path.join(workspace, 'tests', 'unit', 'session-export-formats.test.ts'),
        path.join(workspace, 'tests', 'unit', 'session-enhancements-update-channel.test.ts'),
        path.join(workspace, 'tests', 'unit', 'session-cleanup.test.ts'),
        path.join(workspace, 'tests', 'unit', 'database-layer.test.ts'),
        path.join(workspace, 'tests', 'unit', 'cloud-storage-factory.test.ts'),
        path.join(workspace, 'tests', 'unit', 'response-cache.test.ts'),
        path.join(workspace, 'tests', 'unit', 'prompt-cache.test.ts'),
        path.join(workspace, 'tests', 'unit', 'cache.test.ts'),
        path.join(workspace, 'tests', 'unit', 'distributed-cache.test.ts'),
        path.join(workspace, 'tests', 'utils', 'cache.test.ts'),
        path.join(workspace, 'tests', 'utils', 'lru-cache.test.ts'),
        path.join(workspace, 'tests', 'optimization', 'prompt-cache.test.ts'),
        path.join(workspace, 'tests', 'fleet', 'peer-session-store.test.ts'),
        path.join(workspace, 'tests', 'scheduler', 'cron-session.test.ts'),
        path.join(workspace, 'tests', 'scheduler', 'cron-precheck-persistence.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-maintenance-doctor-backup-settings-bundle',
        label: 'Maintenance / doctor backup settings bundle',
        group: 'Maintenance',
        description:
          'Doctor, ChatGPT OAuth diagnostics, onboarding, backup commands, update notifier, settings et migrations',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/doctor/doctor.test.ts',
          'tests/doctor/chatgpt-oauth-check.test.ts',
          'tests/unit/doctor-fix.test.ts',
          'tests/wizard/onboarding.test.ts',
          'tests/commands/backup-handlers.test.ts',
          'tests/utils/update-notifier.test.ts',
          'tests/update-notifier.test.ts',
          'tests/utils/settings-manager.test.ts',
          'tests/unit/settings-manager-baseurl.test.ts',
          'tests/unit/update-tag.test.ts',
          'tests/unit/migration-manager.test.ts',
          'tests/config/migration.test.ts',
          'tests/features/hooks-policies-memory-settings.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 220_000,
      },
      [
        path.join(workspace, 'tests', 'doctor', 'doctor.test.ts'),
        path.join(workspace, 'tests', 'doctor', 'chatgpt-oauth-check.test.ts'),
        path.join(workspace, 'tests', 'unit', 'doctor-fix.test.ts'),
        path.join(workspace, 'tests', 'wizard', 'onboarding.test.ts'),
        path.join(workspace, 'tests', 'commands', 'backup-handlers.test.ts'),
        path.join(workspace, 'tests', 'utils', 'update-notifier.test.ts'),
        path.join(workspace, 'tests', 'update-notifier.test.ts'),
        path.join(workspace, 'tests', 'utils', 'settings-manager.test.ts'),
        path.join(workspace, 'tests', 'unit', 'settings-manager-baseurl.test.ts'),
        path.join(workspace, 'tests', 'unit', 'update-tag.test.ts'),
        path.join(workspace, 'tests', 'unit', 'migration-manager.test.ts'),
        path.join(workspace, 'tests', 'config', 'migration.test.ts'),
        path.join(workspace, 'tests', 'features', 'hooks-policies-memory-settings.test.ts'),
      ]
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-server-api-mcp-platform-bundle',
        label: 'Server / API MCP platform bundle',
        group: 'Server',
        description:
          'API server, auth, middleware, mobile/native routes, workflow builder, canvas, HTTP/REST, IDE server, LSP et MCP/JSON-RPC',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/server/api-server.test.ts',
          'tests/server/auth.test.ts',
          'tests/server/middleware.test.ts',
          'tests/server/mobile.test.ts',
          'tests/server/native-engine-routes.test.ts',
          'tests/server/server-startup.test.ts',
          'tests/server/workflow-builder.test.ts',
          'tests/canvas/canvas-server.test.ts',
          'tests/unit/http-server.test.ts',
          'tests/unit/rest-server.test.ts',
          'tests/unit/ide-extensions-server.test.ts',
          'tests/lsp-server.test.ts',
          'tests/mcp/mcp-server.test.ts',
          'tests/mcp/mcp-agent-server.test.ts',
          'tests/mcp/client.test.ts',
          'tests/unit/mcp-client.test.ts',
          'tests/unit/mcp-server.test.ts',
          'tests/unit/mcp-oauth.test.ts',
          'tests/integrations/mcp-server.test.ts',
          'tests/integrations/json-rpc-server.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: true,
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'server', 'api-server.test.ts'),
        path.join(workspace, 'tests', 'server', 'auth.test.ts'),
        path.join(workspace, 'tests', 'server', 'middleware.test.ts'),
        path.join(workspace, 'tests', 'server', 'mobile.test.ts'),
        path.join(workspace, 'tests', 'server', 'native-engine-routes.test.ts'),
        path.join(workspace, 'tests', 'server', 'server-startup.test.ts'),
        path.join(workspace, 'tests', 'server', 'workflow-builder.test.ts'),
        path.join(workspace, 'tests', 'canvas', 'canvas-server.test.ts'),
        path.join(workspace, 'tests', 'unit', 'http-server.test.ts'),
        path.join(workspace, 'tests', 'unit', 'rest-server.test.ts'),
        path.join(workspace, 'tests', 'unit', 'ide-extensions-server.test.ts'),
        path.join(workspace, 'tests', 'lsp-server.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-server.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'mcp-agent-server.test.ts'),
        path.join(workspace, 'tests', 'mcp', 'client.test.ts'),
        path.join(workspace, 'tests', 'unit', 'mcp-client.test.ts'),
        path.join(workspace, 'tests', 'unit', 'mcp-server.test.ts'),
        path.join(workspace, 'tests', 'unit', 'mcp-oauth.test.ts'),
        path.join(workspace, 'tests', 'integrations', 'mcp-server.test.ts'),
        path.join(workspace, 'tests', 'integrations', 'json-rpc-server.test.ts'),
      ]
    );
    addIfFileExists(
      items,
      {
        id: 'code-buddy-docker-sandbox-real-smoke',
        label: 'Docker / real sandbox smoke',
        group: 'Docker',
        description: 'Lance un vrai conteneur Docker node:22-slim sans reseau et verifie sa suppression',
        command: 'npm',
        args: ['test', '--', 'tests/sandbox/docker-sandbox-real-smoke.test.ts', '--run'],
        cwd: workspace,
        kind: 'integration',
        safeToRun: false,
        requiresEnv: 'CODEBUDDY_REAL_DOCKER_SANDBOX',
        env: { CODEBUDDY_REAL_DOCKER_SANDBOX: '1' },
        timeoutMs: 180_000,
      },
      path.join(workspace, 'tests', 'sandbox', 'docker-sandbox-real-smoke.test.ts')
    );
    addIfFilesExist(
      items,
      {
        id: 'code-buddy-docker-sandbox-full-bundle',
        label: 'Docker / sandbox full bundle',
        group: 'Docker',
        description: 'DockerSandbox reel plus tests sandbox, policy Docker et job runner sans reseau',
        command: 'npm',
        args: [
          'test',
          '--',
          'tests/sandbox/docker-sandbox-real-smoke.test.ts',
          'tests/sandbox/docker-sandbox.test.ts',
          'tests/unit/sandbox-docker.test.ts',
          'tests/agent/research-script-job-runner.test.ts',
          '--run',
        ],
        cwd: workspace,
        kind: 'integration',
        safeToRun: false,
        requiresEnv: 'CODEBUDDY_REAL_DOCKER_SANDBOX',
        env: { CODEBUDDY_REAL_DOCKER_SANDBOX: '1' },
        timeoutMs: 240_000,
      },
      [
        path.join(workspace, 'tests', 'sandbox', 'docker-sandbox-real-smoke.test.ts'),
        path.join(workspace, 'tests', 'sandbox', 'docker-sandbox.test.ts'),
        path.join(workspace, 'tests', 'unit', 'sandbox-docker.test.ts'),
        path.join(workspace, 'tests', 'agent', 'research-script-job-runner.test.ts'),
      ]
    );
    addIfFileExists(
      items,
      {
        id: 'code-buddy-computer-use-real-desktop-suite',
        label: 'Computer Use / real desktop suite',
        group: 'Conditions reelles',
        description: 'Pilote vraiment WinForms, dialogues, Notepad et Excel COM via Computer Use',
        command: 'npx',
        args: ['tsx', 'scratch/computer-use-real-suite.ts'],
        cwd: workspace,
        kind: 'integration',
        safeToRun: false,
        requiresEnv: 'CODEBUDDY_REAL_COMPUTER_USE',
        env: { CODEBUDDY_REAL_COMPUTER_USE: '1' },
        timeoutMs: 360_000,
      },
      path.join(workspace, 'scratch', 'computer-use-real-suite.ts')
    );
    addIfFileExists(
      items,
      {
        id: 'code-buddy-server-real-gpt55-chat',
        label: 'Server / real GPT-5.5 chat API',
        group: 'Conditions reelles',
        description: 'Serveur Express local + ChatGPT OAuth gpt-5.5 sur /api/chat, SSE et completions',
        command: 'npm',
        args: ['test', '--', 'tests/server/chat-route-real-gpt55.test.ts', '--run'],
        cwd: workspace,
        kind: 'real-provider',
        safeToRun: false,
        requiresEnv: 'CODEBUDDY_REAL_GPT55_SERVER',
        env: { CODEBUDDY_REAL_GPT55_SERVER: '1' },
        timeoutMs: 300_000,
      },
      path.join(workspace, 'tests', 'server', 'chat-route-real-gpt55.test.ts')
    );
    return items;
  }

  async detectFramework(): Promise<string | null> {
    if (!this.workspaceDir) return null;
    try {
      const core = await loadCoreAutoTest();
      if (core) {
        const manager = core.initializeAutoTest(this.workspaceDir);
        this.coreManager = manager;
        manager.on('framework:detected', (name: string) => {
          this.framework = name;
          this.emit('test.framework', { framework: name });
        });
        // Core calls detectFramework synchronously in constructor, so framework may already be set
        const state = (manager as unknown as { detectedFramework?: { name: string } }).detectedFramework;
        if (state?.name) {
          this.framework = state.name;
          this.emit('test.framework', { framework: state.name });
          return state.name;
        }
      }
    } catch (err) {
      logWarn('[TestRunnerBridge] core load failed:', err);
    }

    // Fallback: inspect package.json directly
    const fb = detectFallbackFramework(this.workspaceDir);
    if (fb) {
      this.framework = fb.framework;
      this.emit('test.framework', { framework: fb.framework });
      return fb.framework;
    }
    return null;
  }

  private async runWithCore(files: string[]): Promise<TestResult | null> {
    if (!this.coreManager) return null;
    try {
      this.emit('test.start', { files });
      const result =
        files.length === 0 ? await this.coreManager.runAllTests() : await this.coreManager.runTestFiles(files);
      this.lastResult = result;
      this.emit('test.complete', result);
      return result;
    } catch (err) {
      logWarn('[TestRunnerBridge] core run failed:', err);
      return null;
    }
  }

  private async runCommand(item: {
    command: string;
    args: string[];
    cwd: string;
    framework: string;
    files?: string[];
    label?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<TestResult> {
    const invocation = buildSpawnInvocation(item.command, item.args);
    const audit = await this.startAuditRun(item, invocation);
    return new Promise((resolve) => {
      this.framework = item.framework;
      this.cancellationRequested = false;
      this.timeoutRequested = false;
      const startTime = Date.now();
      this.emit('test.start', {
        files: item.files ?? [],
        framework: item.framework,
        label: item.label,
      });

      let stdout = '';
      let stderr = '';
      audit?.emit('step_start', {
        label: item.label ?? item.framework,
        command: item.command,
        args: item.args,
        cwd: item.cwd,
      });
      audit?.emit('tool_call', {
        toolName: 'test-runner.catalog',
        command: [item.command, ...item.args].join(' '),
      });
      const child = spawn(invocation.command, invocation.args, {
        cwd: item.cwd,
        env: buildSpawnEnv(item.env),
      });
      this.activeProcess = child;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      if (item.timeoutMs && item.timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (this.activeProcess !== child) return;
          this.timeoutRequested = true;
          const text = `\n[TestRunnerBridge] Timed out after ${item.timeoutMs}ms\n`;
          stderr += text;
          audit?.emit('error', { message: text.trim(), timeoutMs: item.timeoutMs });
          this.emit('test.output', { stream: 'stderr', text });
          this.terminateActiveProcess();
        }, item.timeoutMs);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        audit?.emit('step_end', { stream: 'stdout', text });
        this.emit('test.output', { stream: 'stdout', text });
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        audit?.emit('step_end', { stream: 'stderr', text });
        this.emit('test.output', { stream: 'stderr', text });
      });
      child.on('error', (err) => {
        if (timeout) clearTimeout(timeout);
        this.activeProcess = null;
        const result: TestResult = {
          success: false,
          passed: 0,
          failed: 1,
          skipped: 0,
          total: 1,
          duration: Date.now() - startTime,
          framework: item.framework,
          tests: [
            {
              name: item.label ?? 'Test runner error',
              suite: '',
              status: 'failed',
              duration: 0,
              error: err.message,
            },
          ],
        };
        this.lastResult = result;
        audit?.emit('error', { message: err.message });
        audit?.end('failed', { durationMs: result.duration, toolCallCount: 1 });
        this.emit('test.complete', result);
        resolve(result);
      });
      child.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        this.activeProcess = null;
        const duration = Date.now() - startTime;
        const output = stdout + stderr;
        if (this.cancellationRequested) {
          this.cancellationRequested = false;
          const result: TestResult = {
            success: false,
            passed: 0,
            failed: 0,
            skipped: 1,
            total: 1,
            duration,
            framework: item.framework,
            tests: [
              {
                name: item.label ?? 'Cancelled test runner check',
                suite: item.framework,
                status: 'skipped',
                duration,
                error: 'Cancelled by user',
              },
            ],
          };
          this.lastResult = result;
          audit?.emit('tool_result', {
            toolName: 'test-runner.catalog',
            success: false,
            cancelled: true,
            exitCode: code,
          });
          audit?.saveArtifact('test-output.txt', output);
          audit?.end('cancelled', {
            durationMs: duration,
            toolCallCount: 1,
          });
          this.emit('test.complete', result);
          resolve(result);
          return;
        }
        if (this.timeoutRequested) {
          this.timeoutRequested = false;
          const result: TestResult = {
            success: false,
            passed: 0,
            failed: 1,
            skipped: 0,
            total: 1,
            duration,
            framework: item.framework,
            tests: [
              {
                name: item.label ?? 'Timed out test runner check',
                suite: item.framework,
                status: 'failed',
                duration,
                error: `Timed out after ${item.timeoutMs}ms`,
              },
            ],
          };
          this.lastResult = result;
          audit?.emit('tool_result', {
            toolName: 'test-runner.catalog',
            success: false,
            timeout: true,
            exitCode: code,
          });
          audit?.saveArtifact('test-output.txt', output);
          audit?.end('failed', {
            durationMs: duration,
            toolCallCount: 1,
          });
          this.emit('test.complete', result);
          resolve(result);
          return;
        }
        const { passed, failed, skipped, total } = parseFallbackCounts(output, code);
        const result: TestResult = {
          success: code === 0,
          passed,
          failed,
          skipped,
          total,
          duration,
          framework: item.framework,
          tests: item.label
            ? [
                {
                  name: item.label,
                  suite: item.framework,
                  status: code === 0 ? 'passed' : 'failed',
                  duration,
                  error: code === 0 ? undefined : stderr.trim() || stdout.trim() || `Exited with code ${code}`,
                },
              ]
            : [],
        };
        this.lastResult = result;
        audit?.emit('tool_result', {
          toolName: 'test-runner.catalog',
          success: code === 0,
          exitCode: code,
        });
        audit?.saveArtifact('test-output.txt', output);
        audit?.end(code === 0 ? 'completed' : 'failed', {
          durationMs: duration,
          toolCallCount: 1,
        });
        this.emit('test.complete', result);
        resolve(result);
      });
    });
  }

  private async startAuditRun(
    item: {
      command: string;
      args: string[];
      cwd: string;
      framework: string;
      label?: string;
    },
    invocation: { command: string; args: string[] }
  ): Promise<TestAuditRecorder | null> {
    try {
      const mod = await loadCoreRunStore();
      const store = mod?.RunStore?.getInstance();
      if (!store) return null;
      const label = item.label ?? item.framework;
      const runId = store.startRun(`Test runner: ${label}`, {
        channel: 'cowork',
        source: 'test-runner',
        platform: process.platform,
        origin: 'cowork-test-runner-panel',
        tags: ['qa', 'test-runner', item.framework.toLowerCase()],
      });
      store.emit(runId, {
        type: 'decision',
        data: {
          kind: 'test_runner_catalog_item',
          label,
          command: item.command,
          args: item.args,
          cwd: item.cwd,
          spawnedCommand: invocation.command,
          spawnedArgs: invocation.args,
        },
      });
      return {
        runId,
        emit: (type, data) => store.emit(runId, { type, data }),
        saveArtifact: (name, content) => {
          store.saveArtifact?.(runId, name, content);
        },
        end: (status, metrics) => {
          if (metrics) store.updateMetrics?.(runId, metrics);
          store.endRun(runId, status);
        },
      };
    } catch (err) {
      logWarn('[TestRunnerBridge] audit recording failed:', err);
      return null;
    }
  }

  private runWithFallback(files: string[]): Promise<TestResult> {
    if (!this.workspaceDir) {
      return Promise.resolve({
        success: false,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        framework: 'none',
        tests: [],
      });
    }
    const fb = detectFallbackFramework(this.workspaceDir);
    if (!fb) {
      return Promise.resolve({
        success: false,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        framework: 'none',
        tests: [],
      });
    }
    const args = files.length > 0 ? [...fb.args, ...files] : fb.args;
    return this.runCommand({
      command: fb.command,
      args,
      cwd: this.workspaceDir,
      framework: fb.framework,
      files,
    });
  }

  async run(files: string[] = []): Promise<TestResult> {
    if (this.activeProcess) {
      return (
        this.lastResult ?? {
          success: false,
          passed: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          duration: 0,
          framework: 'none',
          tests: [],
        }
      );
    }
    if (!this.coreManager) {
      await this.detectFramework();
    }
    const coreResult = await this.runWithCore(files);
    if (coreResult) return coreResult;
    return this.runWithFallback(files);
  }

  async runFailing(): Promise<TestResult> {
    const last = this.lastResult;
    if (!last || last.tests.length === 0) {
      return this.run();
    }
    const failingFiles = Array.from(
      new Set(last.tests.filter((t) => t.status === 'failed' && t.file).map((t) => t.file as string))
    );
    return this.run(failingFiles);
  }

  async runCatalogItem(id: string): Promise<TestResult> {
    if (this.activeProcess) {
      return (
        this.lastResult ?? {
          success: false,
          passed: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          duration: 0,
          framework: 'none',
          tests: [],
        }
      );
    }
    const item = this.getCatalog().find((entry) => entry.id === id);
    if (!item) {
      return {
        success: false,
        passed: 0,
        failed: 1,
        skipped: 0,
        total: 1,
        duration: 0,
        framework: 'catalog',
        tests: [
          {
            name: id,
            suite: 'catalog',
            status: 'failed',
            duration: 0,
            error: 'Unknown test catalog item',
          },
        ],
      };
    }
    return this.runCommand({
      command: item.command,
      args: item.args,
      cwd: item.cwd,
      framework: item.group,
      label: item.label,
      env: item.env,
      timeoutMs: item.timeoutMs,
    });
  }

  private terminateActiveProcess(): void {
    if (!this.activeProcess) return;
    try {
      const pid = this.activeProcess.pid;
      if (process.platform === 'win32' && pid) {
        const killed = spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
          stdio: 'ignore',
          timeout: 5000,
        });
        if (killed.status !== 0) {
          this.activeProcess.kill('SIGTERM');
        }
      } else {
        this.activeProcess.kill('SIGTERM');
      }
    } catch {
      /* ignore */
    }
  }

  cancel(): void {
    if (this.activeProcess) {
      this.cancellationRequested = true;
      this.terminateActiveProcess();
      this.activeProcess = null;
      this.emit('test.cancelled', null);
    }
  }
}

let singleton: TestRunnerBridge | null = null;

export function getTestRunnerBridge(): TestRunnerBridge {
  if (!singleton) {
    singleton = new TestRunnerBridge();
  }
  return singleton;
}
