import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async () => null),
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
}));

import { TestRunnerBridge } from '../src/main/testing/test-runner-bridge';
import { loadCoreModule } from '../src/main/utils/core-loader';

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

const roots: string[] = [];

type PrivateTestRunnerBridge = TestRunnerBridge & {
  runCommand(item: {
    command: string;
    args: string[];
    cwd: string;
    framework: string;
    label?: string;
    timeoutMs?: number;
  }): Promise<{
    success: boolean;
    failed: number;
    tests: Array<{ name: string; status: string; error?: string }>;
  }>;
};

function hasProcessWithMarker(marker: string): boolean {
  if (process.platform !== 'win32') return false;
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | Select-Object -First 1 -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf8', timeout: 10_000 }
  );
  return result.status === 0 && result.stdout.trim().length > 0;
}

function listRealTestFiles(root: string, relativeDir = 'tests'): string[] {
  const absoluteDir = path.join(root, relativeDir);
  const files: string[] = [];
  for (const entry of readdirSync(absoluteDir)) {
    const relativePath = path.join(relativeDir, entry);
    const absolutePath = path.join(root, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...listRealTestFiles(root, relativePath));
      continue;
    }
    if (entry.includes('real') && entry.endsWith('.test.ts')) {
      files.push(relativePath.split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function catalogTestFileArgs(catalog: Array<{ args: string[] }>): Set<string> {
  return new Set(
    catalog
      .flatMap((item) => item.args)
      .filter((arg) => arg.startsWith('tests/') && arg.endsWith('.test.ts'))
      .map((arg) => arg.replace(/\\/g, '/'))
  );
}

function makeWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cowork-test-runner-'));
  roots.push(root);
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          typecheck: 'node -e "process.exit(0)"',
          'typecheck:watch': 'tsc --watch',
          lint: 'node -e "process.exit(0)"',
          'lint:fix': 'eslint --fix',
          test: 'node -e "console.log(\'1 passed\')"',
          'test:fail': 'node -e "console.error(\'QA_FAIL_MARKER\'); process.exit(7)"',
          dev: 'node server.js',
        },
        devDependencies: {
          vitest: '1.0.0',
        },
      },
      null,
      2
    )
  );

  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'scripts', 'hermes-built-cli-smoke.mjs'), '');

  const coworkDir = path.join(root, 'cowork');
  mkdirSync(path.join(coworkDir, 'e2e'), { recursive: true });
  writeFileSync(
    path.join(coworkDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          typecheck: 'node -e "process.exit(0)"',
          'test:e2e': 'playwright test',
        },
      },
      null,
      2
    )
  );
  writeFileSync(path.join(coworkDir, 'e2e', 'chat-real-gpt55.spec.ts'), '');
  writeFileSync(path.join(coworkDir, 'e2e', 'chat-flow.spec.ts'), '');
  writeFileSync(path.join(coworkDir, 'e2e', 'companion-panel.spec.ts'), '');
  writeFileSync(path.join(coworkDir, 'e2e', 'panel-usage-depth.spec.ts'), '');
  writeFileSync(path.join(coworkDir, 'e2e', 'feature-completion-depth.spec.ts'), '');
  writeFileSync(path.join(coworkDir, 'e2e', 'companion-live.spec.ts'), '');
  writeFileSync(path.join(coworkDir, 'e2e', 'permission-real-flow.spec.ts'), '');
  mkdirSync(path.join(coworkDir, 'tests'), { recursive: true });
  writeFileSync(path.join(coworkDir, 'tests', 'workflow-bridge-integration.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'skills-manager-builtin-skills.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'bundle-mcp-script.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'engine-mcp-sync.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hooks-bridge-agent-dryrun.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hooks-bridge-events.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hooks-bridge-http-dryrun.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hooks-bridge-prompt-dryrun.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'mcp-manager-env-merge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'mcp-tool-name.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'settings-codebuddy-autostart.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'theme-settings-persistence.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'workflow-bridge-compilation.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'custom-commands-service.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'slash-command-bridge-schedule.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'channel-gateway-readiness-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-browser-backends-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-browser-backends-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-memory-providers-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-memory-providers-bridge-real.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-memory-providers-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-messaging-gateway-strip.test.tsx'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-mobile-supervision-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-mobile-supervision-bridge-real.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-mobile-supervision-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-plan-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-feature-parity-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-feature-parity-bridge-real.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-feature-parity-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-learning-loop-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-learning-loop-bridge-real.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-learning-loop-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-protocol-gateways-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-protocol-gateways-bridge-real.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-protocol-gateways-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-provider-readiness-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-provider-readiness-bridge-real.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-provider-readiness-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-runtime-backends-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-runtime-backends-bridge-real.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-runtime-backends-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-surfaces-ipc.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-tool-catalog-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-tool-catalog-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-toolsets-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'hermes-toolsets-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'lessons-vault-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'lessons-vault-graph.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'lessons-vault-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'learning-usage-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'learning-skill-usage-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'presence-bridge-download.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'presence-bridge-model.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'presence-service.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'skill-candidate-review-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'skill-candidate-review-queue-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'tool-profile-inspector-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'voice-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'voice-conversation-session.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'voice-playback-interrupt.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'remote-user-message-ui.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'remote-manager-port-conflict.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'remote-default-workdir.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'remote-cwd-state.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'remote-cwd-propagation.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'remote-control-panel-links.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'remote-control-panel-imports.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'remote-control-panel-claude-layout.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'slash-command-bridge-remote.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'open-cowork-demo-parity.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'mission-core.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'mission-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'mission-heartbeat-recovery.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'mission-scheduler.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'mission-board-panel.test.tsx'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'mission-board-surface.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'desktop-snapshot-panel.test.tsx'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'desktop-snapshot-surface.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'tool-executor-sandbox.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'sandbox-executor-containment.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'sandbox-command-injection.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'git-bridge-worktree.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'git-bridge-compare.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'file-attachment-helpers.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'file-attachment-context.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'recent-workspace-files.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'workspace-path-constraints.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-manager-crud.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-manager-message-cache.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-manager-queue-concurrency.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-manager-title-unified.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-search.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-resume-dialog.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-insights-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-insights-audit.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-insights-jump.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'welcome-project-selector.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'app-layout-scroll-lock.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'app-startup-lazy-load.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'dark-theme-palette.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'i18n-french-support.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'welcome-view-claude-layout.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'welcome-view-submit-guard.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'chat-view-claude-layout.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'chat-view-width-layout.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'message-card-claude-layout.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'message-card-file-attachment-layout.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'config-modal-claude-layout.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'focus-view-surface.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'fleet-team-panel-browser-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'settings-surface-tabs.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'settings-panel-plugin-entry.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'settings-panel-schedule-entry.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'provider-guidance-ui.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'prose-chat-list-style.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'latex-delimiters.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'markdown-local-link.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'artifact-detector-agentic-harness.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'artifact-icon.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'artifact-parser.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'artifact-path.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'artifact-steps.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'file-preview-agentic-harness.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'chat-view-document-workshop.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'document-workshop-flow.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'document-workshop-progress.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'file-link.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'tool-output-path.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'tool-result-summary.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'message-card-link-handling.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'message-card-citation-link-normalization.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'message-card-ask-user-question-state.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'permission-dialog-computer-use.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'settings-permission-rules-computer-use.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'schedule-helpers.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'schedule-task-title.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'scheduled-task-edge-cases.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'scheduled-task-manager.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'scheduled-task-session-title-entry.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'scheduled-task-store.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-manager-scheduled-title.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-title-defaults.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-title-flow-abort.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-title-flow.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-title-utils.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'session-update-event.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'slash-command-bridge-schedule.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'api-config-state.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'api-config-state-config-sets.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'api-diagnostics.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'auth-utils.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'config-store-config-sets.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'config-store-env.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'config-store-performance.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'config-store-profiles.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'config-test-routing.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'settings-api-local-providers.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'lmstudio-api.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'lmstudio-discovery.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'ollama-api.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'ollama-base-url.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'ollama-discovery.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'loopback-url.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'retry.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'use-ipc-config-modal-gate.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'activity-feed.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'global-search-dialog.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'global-search-service.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'audit-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'audit-log-viewer.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'diagnostics-summary.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'renderer-diagnostics.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'client-event-utils.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'runner-event-mapping.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'preview-service.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'context-panel-recent-files.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'aggregator-wiring.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'fleet-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'fleet-command-center-board.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'fleet-discovery.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'fleet-internet-proof-metadata.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'fleet-ipc.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'fleet-outcome-panel.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'fleet-scheduled-work-strip.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'saga-runner.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'team-bridge.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'declarative-rules-explain.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'permission-dialog-computer-use.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'permission-rule-classification.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'permission-rule-preview.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'permission-target-rule.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'rules-bridge-fallback.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'settings-permission-rules-computer-use.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'path-containment.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'path-guard-command-conversion.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'path-resolver-containment.test.ts'), '');
  writeFileSync(path.join(coworkDir, 'tests', 'tool-executor-unc-paths.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'server'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'server', 'chat-route-real-gpt55.test.ts'), '');
  mkdirSync(path.join(root, 'scratch'), { recursive: true });
  writeFileSync(path.join(root, 'scratch', 'computer-use-real-suite.ts'), '');
  mkdirSync(path.join(root, 'tests', 'cli'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'cli', 'cli-flags.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'cli', 'headless-exit-code.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'cli', 'model-listing.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'cli', 'session-commands.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'fleet'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'fleet', 'fleet-loopback-smoke.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'fleet-multi-peer-mesh-smoke.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'peer-tool-bridge.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'task-router.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'saga-store.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'result-aggregator-consensus.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'privacy-lint.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'peer-chat-stream.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'peer-chat-client-factory.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'fleet-registry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'fleet-listener.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'fleet-handler.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'fleet-chat-helper.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'dispatch-profile.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'cost-tracker.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'compaction-bridge.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'capability-registry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'autonomous-tick-broadcaster.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'mcp'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'mcp', 'mcp-stdio-real-fixture.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'mcp', 'mcp-http-real-fixture.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'mcp', 'mcp-streamable-http-limitation.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'chat-route-real-http.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'cron-jobs-real-http.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'native-status-report-real-http.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'chat-route-provider-error.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'peer-tool-bridge.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'security'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'security', 'write-policy.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'permission-modes.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'commands'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'commands', 'permissions-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'core-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'slash-commands.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'context-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'session-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'security-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'tools-commands.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'backup-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'agents-handler.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'agent-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'worktree-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'fleet-commands.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'learning-retrospective-command.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'skills-command-real.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'commands', 'handlers'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'commands', 'handlers', 'auth-handlers.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'features'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'features', 'stream-permissions-prompts.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'features', 'plugins-teams-output.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'features', 'plugins-commands-summarize.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'features', 'tailscale-dashboard-nodes.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'desktop'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'desktop', 'permission-bridge-unify.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'desktop', 'codebuddy-engine-adapter-mcp.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'desktop', 'codebuddy-engine-adapter-lru.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'desktop', 'codebuddy-engine-adapter-hotswap.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'approval-modes.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'unit'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'unit', 'mcp-tool-adapter.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'mcp-discovery.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'mcp-enhancements.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'e2b-sandbox.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'device-transports.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'transport.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'slash-commands.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'config-command.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'plugins.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'ui-components.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'clipboard.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'clipboard-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'browser-commands.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'config.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'config-loader.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'config-migrator.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'config-mutator.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'jsonc-config.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'provider-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'providers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'models.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'models-snapshot.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'approval-modes.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security-modes.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'security-modes.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'permission-config.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'tool-permissions.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'utils'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'utils', 'confirmation-service.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'observability'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'observability', 'run-store.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'run-trajectory-export.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'run-recall-pack.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'policy-evals.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'golden-workflow-evals.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'mobile-supervision-snapshot.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'mobile-supervision-pairing-state.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'mobile-supervision-pairing-acceptance-plan.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'mobile-supervision-gateway-policy.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'mobile-supervision-gateway-listener-shell.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'mobile-supervision-gateway-contract.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability', 'mobile-supervision-approval-queue.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'commands', 'run-commands.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'daemon'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'daemon', 'cron-run-recording.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observability.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'observability-dashboard.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'sandbox'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'sandbox', 'sandbox-registry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'sandbox', 'auto-sandbox.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'sandbox', 'os-sandbox.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'sandbox', 'execpolicy.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'websocket.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'broadcast-backpressure.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'lane-queue-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'fleet-bridge.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'peer-rpc.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'peer-chat-bridge.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'api-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'auth.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'middleware.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'mobile.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'native-engine-routes.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'server-startup.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'workflow-builder.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'canvas'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'canvas', 'canvas-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'http-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'rest-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'ide-extensions-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'lsp-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'mcp', 'mcp-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'mcp', 'mcp-agent-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'mcp', 'client.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'mcp-client.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'mcp-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'mcp-oauth.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'integrations'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'integrations', 'mcp-server.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'integrations', 'json-rpc-server.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'gateway'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'gateway', 'ws-transport.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'gateway', 'ws-transport-backpressure.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'gateway', 'gateway.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'gateway', 'tls-pairing.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'heartbeat-broadcaster.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'peer-session-bridge.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'a2a-protocol.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'acp-routes.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'channel-a2a-bridge.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'server', 'channel-intake.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'protocols'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'protocols', 'a2a.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'protocols', 'a2a-task-router.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'protocols', 'a2a-skill-selection.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'protocols', 'a2a-skill-routing.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'protocols', 'a2a-remote-agents.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'protocols', 'a2a-codebuddy-executor.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'channels'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'channels', 'channels.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'channel-handlers-additional-channels.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'slack-block-builder.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'slack.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'discord.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'telegram.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'teams.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'google-chat.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'webchat.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'whatsapp.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'signal.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'matrix.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'message-serialization.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'offline-queue.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'session-isolation-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'session-identity.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'group-security.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'dm-pairing.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'dm-pairing-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'reconnection-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'peer-routing-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'identity-links-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'new-channels.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'channels', 'feishu-cards.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'channels', 'dm-policy'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'channels', 'dm-policy', 'engine.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'enhanced-memory.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context-manager-v2.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'context'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'context', 'transcript-repair.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'tool-pair-preserver.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'two-phase-compaction.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'context-engine.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'precompaction-flush.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'auto-compact-threshold.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'bootstrap-loader.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'web-search.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'restorable-compression-gaps.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'dangling-patch.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'context-manager-v2-gaps.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'observation-variator.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'importance-scorer.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'guard.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'context', 'pruning'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'context', 'pruning', 'ttl-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'pruning', 'soft-trim.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'pruning', 'hard-clear.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'context', 'compaction'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'context', 'compaction', 'progressive-fallback.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'compaction', 'parallel-summarizer.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'compaction', 'memory-flush.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'context', 'compaction', 'adaptive-chunker.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'voice-control.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'voice'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'voice', 'speech-recognition.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'voice', 'wake-word.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'talk-mode'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'talk-mode', 'tts.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'talk-mode', 'audioreader-tts.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'talk-mode', 'providers'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'talk-mode', 'providers', 'openai-tts.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'talk-mode', 'providers', 'edge-tts.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'voice-to-code.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'tools', 'audio-tool.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'memory'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'memory', 'persistent-memory.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'memory', 'user-model.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'memory', 'memory-provider.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'memory', 'decision-memory.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'memory.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'memory-commands.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'session-export.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'session-pruning'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'session-pruning', 'pruning.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'checkpoint-manager.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'config'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'config', 'resolve-model.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'config', 'model-registry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'config', 'model-pricing.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'config', 'model-defaults.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'config', 'migration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'config', 'env-schema.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'config', 'config-resolver.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'config', 'agent-defaults.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'toml-config.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'config-validator.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'llm-provider.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'providers'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'providers', 'fallback-chain.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'providers', 'smart-router.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'providers', 'codex-oauth.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'codebuddy', 'providers'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'providers', 'provider-openai-compat-hooks.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'providers', 'provider-chatgpt-responses.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'providers', 'provider-gemini-cli.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'provider-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'provider-command.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'providers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'models.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'models-snapshot.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'auth', 'oauth'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'auth', 'profile-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'auth', 'oauth', 'manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'auth', 'oauth', 'model-profiles.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'doctor'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'doctor', 'doctor.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'doctor', 'chatgpt-oauth-check.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'doctor-fix.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'wizard'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'wizard', 'onboarding.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'utils', 'update-notifier.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'update-notifier.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'utils', 'settings-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'settings-manager-baseurl.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'update-tag.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'migration-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'features', 'hooks-policies-memory-settings.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'providers'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'providers', 'codex-oauth.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'providers', 'codex-oauth-e2e.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'codebuddy'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'client-stream-retry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'stream-retry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'client-gemini-vision.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'streaming'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'streaming', 'retry-policy.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'retry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'rate-limiter.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'rate-limit-display.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'utils', 'errors.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'errors.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'error-handling-audit.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'client.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'codebuddy-client.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'codebuddy-client-gemini-malformed.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'codebuddy', 'providers'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'providers', 'provider-openai-compat-hooks.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'providers', 'provider-chatgpt-responses.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'codebuddy', 'providers', 'provider-gemini-cli.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'tools', 'gui-tool.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'text-editor.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'ls-tool.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'process-tool.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'plan-tool.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'session-tools.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'tool-selector.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'bash-tool.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'bash-streaming.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'hermes-core-aliases-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'send-message-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'kanban-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'cronjob-tool-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'session-search-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'skills-inspection-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'browser-console-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'browser-dialog-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'browser-get-images-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'browser-hermes-actions-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'browser-snapshot-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'discord-tool-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'homeassistant-tool-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'mixture-of-agents-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'spotify-tool-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'feishu-tool-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'yuanbao-tool-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'x-search-tool-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'execute-code-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'text-to-speech-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'vision-analyze-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'media-generation-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'text-editor.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'tools.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'tools-core.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'search-tool.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'enhanced-search.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'codebuddy-client-search-compat.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'search'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'search', 'hybrid-search.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'search', 'usearch-index.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'agent'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'agent', 'hermes-runtime-backends-smoke-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'hermes-cli-status-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'hermes-skill-package-summary-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'learning-agent-real.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'tool-handler-filter.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'tool-executor.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'agent', 'execution'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'agent', 'execution', 'tool-selection-lite.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'agent', 'middleware'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'tool-filter.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'tools', 'hooks'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'tools', 'hooks', 'result-sanitizer.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'codebuddy-agent.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'agent-executor-lanes.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'execution', 'agent-executor.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'execution', 'context-pipeline-user-model.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'execution', 'fleet-tool-hooks.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'workflow-guard.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'verification-enforcement.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'state-bag.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'quality-gate-middleware.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'pipeline.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'learning-first.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'auto-repair-middleware.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'middleware', 'auto-observation.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'reasoning.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'reasoning'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'reasoning', 'think-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'reasoning', 'reasoning-middleware.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'reasoning', 'reasoning-facade.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'agent', 'streaming'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'agent', 'streaming', 'reasoning.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'services'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'services', 'prompt-builder.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'services', 'prompt-builder-query-aware.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'message-processor.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'message-processor.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'planning-flow.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'agent', 'autonomous'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'agentic-coding-contract.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'agentic-coding-runner.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'agentic-coding-runner-security.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'checkpoint-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'checkpoint-resume.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'edit-proposal-producer.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'task-decomposer.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'verification-loop.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'fleet-llm-routing.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'autonomous', 'fleet-tick-handler.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'agent', 'multi-agent'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'worktree-isolation.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'workflow-persistence.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'workflow-orchestrator.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'workflow-multi-persistence.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'workflow-event-streamer.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'workflow-cost-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'sessions-yield.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'session-fleet-bridge.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'persistence-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'metrics-ttl.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'metrics-persistence.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'heterogeneous-providers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'fleet-workflow-bridge.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'coordinator-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'auto-resolve.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'auto-resolve-mas-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'agent', 'multi-agent', 'async-background.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'workflows'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'workflows', 'pipeline-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'workflows', 'pipeline-approval.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'workflows', 'agent-pipeline.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'planner'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'planner', 'task-graph.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'planner', 'delegation-engine.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'integration'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'integration', 'plugin-cli.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'integration', 'multi-agent.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'advanced-parallel-executor.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'plugins'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'plugins', 'provider-onboarding.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'plugins', 'plugin-sdk-channel.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'plugins', 'plugin-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'plugins', 'plugin-conflict-detector.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'plugins', 'gitnexus.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'plugins', 'extra-providers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'plugins', 'cloud-providers.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'skills'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'skills', 'unified-registry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'starter-packs.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'skill-registry.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'skill-prompt-integration.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'skill-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'skill-loader.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'skill-layering.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'legacy-adapter.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'hub.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'eligibility.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'deprecation-warnings.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'skills', 'bundled-skills.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-camera.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-cards.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-check-in.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-competitive-radar.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-gateway.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-improvement-cycle.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-impulses.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-mission-board.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-mission-runner.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-mode.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-percepts.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-privacy.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-safety-ledger.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-self-evaluation.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'companion-skill-curator.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'browser-automation'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'batch-actions.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'browser-manager-refs.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'browser-operator-executor.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'browser-operator-session.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'browser-stagehand-actions.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'internet-proof-plan.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'internet-scout-plan.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'internet-scout-runner.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'profile-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'route-interceptor.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'browser-automation', 'screenshot-annotator.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'desktop-automation'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'desktop-automation', 'automation.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'desktop-automation', 'native-providers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'desktop-automation', 'smart-snapshot-ocr.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'desktop-automation', 'smart-snapshot-refs.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'audit-logger.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'security', 'bash-allowlist'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'security', 'bash-allowlist', 'allowlist-store.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'bash-allowlist', 'pattern-matcher.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'bash-parser.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'code-validator.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'context-engine-trust.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'dangerous-patterns.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'env-blocklist.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'policy-engine.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'security-audit.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'skill-scanner.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'syntax-validator.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'security', 'tool-policy'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'security', 'tool-policy', 'policy-resolver.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'tool-policy', 'profiles.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security', 'trust-folders.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'secrets-detector.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'utils', 'path-validator.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'security-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'database.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'kv-cache-config.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'persistence'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'persistence', 'session-lock.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'persistence', 'conversation-branches.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'sync'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'sync', 'cloud-sync.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'optimization'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'optimization', 'prompt-cache.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'scheduler'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'scheduler', 'watchdog-handlers.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'scheduler', 'scheduled-delivery.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'scheduler', 'pre-check-runner.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'scheduler', 'cron-session.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'scheduler', 'cron-precheck-persistence.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'hooks'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'hooks', 'user-hooks.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'hooks', 'moltbot-hooks.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'hooks', 'lifecycle-hooks.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'hooks', 'input-handler.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'hooks', 'hermes-lifecycle-hooks.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'hooks', 'advanced-hooks.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'tools', 'hooks'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'tools', 'hooks', 'tool-hooks.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'tools', 'hooks', 'session-lanes.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'webhooks'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'webhooks', 'webhook-manager.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'triggers'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'triggers', 'webhook-trigger.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'hook-manager.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'hook-llm-evaluation.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'scheduler.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'webhooks.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'proactive'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'proactive', 'notification-manager.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'agent', 'proactive'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'agent', 'proactive', 'notification-default-sink.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'notifications.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'fleet', 'peer-session-store.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'sync.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'sync-persistence.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'sync-bindings.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'session-timeline.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'session-store.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'session-replay.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'session-export.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'session-export-formats.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'session-enhancements-update-channel.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'session-cleanup.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'database-layer.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'cloud-storage-factory.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'response-cache.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'prompt-cache.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'cache.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'distributed-cache.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'utils', 'cache.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'utils', 'lru-cache.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'ui'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'ui', 'accessibility.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'ui', 'chat-interface.test.tsx'), '');
  writeFileSync(path.join(root, 'tests', 'ui', 'diff-renderer-logic.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'ui', 'keyboard-shortcuts.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'ui', 'metrics-dashboard.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'ui', 'status-line.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'ui', 'tabbed-question.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'ui', 'themes.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'ui', 'tool-stream-output.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'observer'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'observer', 'event-trigger.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'observer', 'screen-observer.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'sandbox'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'sandbox', 'docker-sandbox-real-smoke.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'sandbox', 'docker-sandbox.test.ts'), '');
  writeFileSync(path.join(root, 'tests', 'unit', 'sandbox-docker.test.ts'), '');
  mkdirSync(path.join(root, 'tests', 'agent'), { recursive: true });
  writeFileSync(path.join(root, 'tests', 'agent', 'research-script-job-runner.test.ts'), '');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

beforeEach(() => {
  mockedLoadCoreModule.mockResolvedValue(null);
});

describe('TestRunnerBridge catalog', () => {
  it('lists workspace, Cowork, and real-provider QA checks', () => {
    const bridge = new TestRunnerBridge();
    const workspace = makeWorkspace();
    bridge.setWorkspace(workspace);

    const catalog = bridge.getCatalog();
    const labels = catalog.map((item) => item.label);

    expect(labels).toContain('typecheck');
    expect(labels).toContain('lint');
    expect(labels).toContain('test');
    expect(labels).toContain('test:fail');
    expect(labels).toContain('Cowork / typecheck');
    expect(labels).toContain('Cowork / test:e2e');
    expect(labels).toContain('Cowork / IPC chat flow');
    expect(labels).toContain('Cowork / companion deterministic panel');
    expect(labels).toContain('Cowork / panel usage depth');
    expect(labels).toContain('Cowork / feature completion depth');
    expect(labels).toContain('Cowork / functional coverage bundle');
    expect(labels).toContain('Cowork / remote control bundle');
    expect(labels).toContain('Cowork / Open Cowork demo parity bundle');
    expect(labels).toContain('Cowork / sandbox executor bundle');
    expect(labels).toContain('Cowork / project session git bundle');
    expect(labels).toContain('Cowork / UI localization layout bundle');
    expect(labels).toContain('Cowork / artifact document bundle');
    expect(labels).toContain('Cowork / scheduling session bundle');
    expect(labels).toContain('Cowork / local provider config bundle');
    expect(labels).toContain('Cowork / activity audit diagnostics bundle');
    expect(labels).toContain('Cowork / Fleet command team bundle');
    expect(labels).toContain('Cowork / permission path rules bundle');
    expect(labels).toContain('Cowork / real GPT-5.5 chat');
    expect(labels).toContain('Cowork / live companion core IPC');
    expect(labels).toContain('Cowork / workflow bridge integration');
    expect(labels).toContain('Cowork / settings hooks MCP workflows bundle');
    expect(labels).toContain('Cowork / custom commands slash bundle');
    expect(labels).toContain('Cowork / knowledge Hermes presence bundle');
    expect(labels).toContain('Hermes / runtime live smoke');
    expect(labels).toContain('Hermes / CLI status real smoke');
    expect(labels).toContain('Hermes / built CLI real smoke');
    expect(labels).toContain('Hermes / core workspace real smoke');
    expect(labels).toContain('Hermes / persistence skills real smoke');
    expect(labels).toContain('Hermes / platform connectors real smoke');
    expect(labels).toContain('Hermes / browser real smoke');
    expect(labels).toContain('Hermes / learning loop real smoke');
    expect(labels).toContain('Hermes / execute_code real smoke');
    expect(labels).toContain('Hermes / media vision real smoke');
    expect(labels).toContain('Cowork / permission real flow');
    expect(labels).toContain('Server / real GPT-5.5 chat API');
    expect(labels).toContain('CLI / headless provider failure exit');
    expect(labels).toContain('Server / local HTTP chat routes');
    expect(labels).toContain('Server / cron status real HTTP');
    expect(labels).toContain('Server / provider error status bundle');
    expect(labels).toContain('Fleet / peer tool security suite');
    expect(labels).toContain('Fleet / routing orchestration bundle');
    expect(labels).toContain('MCP / real transport suite');
    expect(labels).toContain('Infrastructure / MCP sandbox adapters bundle');
    expect(labels).toContain('Fleet/MCP local smoke suite');
    expect(labels).toContain('Backend / deterministic integration bundle');
    expect(labels).toContain('Permissions / security policy bundle');
    expect(labels).toContain('Observability / run tracking bundle');
    expect(labels).toContain('Mobile / supervision gateway bundle');
    expect(labels).toContain('Device / transport adapters bundle');
    expect(labels).toContain('Gateway / realtime websocket bundle');
    expect(labels).toContain('A2A / ACP channel bundle');
    expect(labels).toContain('Channels / messaging adapters bundle');
    expect(labels).toContain('Memory / context persistence bundle');
    expect(labels).toContain('Context / compression pruning bundle');
    expect(labels).toContain('Voice / speech TTS bundle');
    expect(labels).toContain('Providers / model config bundle');
    expect(labels).toContain('Providers / resilience error bundle');
    expect(labels).toContain('Tools / editing search bundle');
    expect(labels).toContain('Agent / reasoning execution bundle');
    expect(labels).toContain('Autonomous / multi-agent harness bundle');
    expect(labels).toContain('Companion / core behaviour bundle');
    expect(labels).toContain('Automation / browser desktop bundle');
    expect(labels).toContain('Automation / scheduler hooks notifications bundle');
    expect(labels).toContain('Security / hardening audit bundle');
    expect(labels).toContain('CLI / command surface bundle');
    expect(labels).toContain('Plugins / skills bundle');
    expect(labels).toContain('UI / terminal observer bundle');
    expect(labels).toContain('Config / auth provider bundle');
    expect(labels).toContain('Data / session sync cache bundle');
    expect(labels).toContain('Maintenance / doctor backup settings bundle');
    expect(labels).toContain('Server / API MCP platform bundle');
    expect(labels).toContain('Docker / real sandbox smoke');
    expect(labels).toContain('Docker / sandbox full bundle');
    expect(labels).toContain('Computer Use / real desktop suite');
    expect(labels).not.toContain('typecheck:watch');
    expect(labels).not.toContain('lint:fix');
    expect(labels).not.toContain('dev');
    expect(catalog.find((item) => item.label === 'Cowork / real GPT-5.5 chat')).toMatchObject({
      kind: 'real-provider',
      safeToRun: false,
      requiresEnv: 'COWORK_REAL_GPT55',
    });
    expect(catalog.find((item) => item.label === 'Cowork / IPC chat flow')).toMatchObject({
      kind: 'e2e',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / companion deterministic panel')).toMatchObject({
      kind: 'e2e',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / panel usage depth')).toMatchObject({
      kind: 'e2e',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / feature completion depth')).toMatchObject({
      kind: 'e2e',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / functional coverage bundle')).toMatchObject({
      kind: 'e2e',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / remote control bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / Open Cowork demo parity bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Cowork / Open Cowork demo parity bundle')?.args).toEqual(
      expect.arrayContaining([
        'tests/open-cowork-demo-parity.test.ts',
        'tests/skills-manager-builtin-skills.test.ts',
        'tests/document-workshop-flow.test.ts',
        'tests/permission-dialog-computer-use.test.ts',
        'tests/remote-control-panel-claude-layout.test.ts',
      ])
    );
    expect(catalog.find((item) => item.label === 'Cowork / autonomous mission board')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 120_000,
    });
    expect(catalog.find((item) => item.label === 'Cowork / autonomous mission board')?.args).toEqual(
      expect.arrayContaining([
        'tests/mission-core.test.ts',
        'tests/mission-bridge.test.ts',
        'tests/mission-heartbeat-recovery.test.ts',
        'tests/mission-scheduler.test.ts',
        'tests/mission-board-panel.test.tsx',
        'tests/mission-board-surface.test.ts',
      ])
    );
    expect(catalog.find((item) => item.label === 'Cowork / desktop snapshot')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 120_000,
    });
    expect(catalog.find((item) => item.label === 'Cowork / desktop snapshot')?.args).toEqual(
      expect.arrayContaining(['tests/desktop-snapshot-panel.test.tsx', 'tests/desktop-snapshot-surface.test.ts'])
    );
    expect(catalog.find((item) => item.label === 'Cowork / sandbox executor bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / project session git bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / UI localization layout bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / artifact document bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / scheduling session bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / local provider config bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / activity audit diagnostics bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / Fleet command team bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / permission path rules bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / live companion core IPC')).toMatchObject({
      kind: 'integration',
      safeToRun: false,
      requiresEnv: 'COWORK_LIVE_COMPANION',
      env: { COWORK_LIVE_COMPANION: '1' },
    });
    expect(catalog.find((item) => item.label === 'Cowork / workflow bridge integration')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / settings hooks MCP workflows bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / custom commands slash bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / knowledge Hermes presence bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Cowork / knowledge Hermes presence bundle')?.args).toEqual(
      expect.arrayContaining([
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
        'tests/hermes-protocol-gateways-bridge.test.ts',
        'tests/hermes-protocol-gateways-bridge-real.test.ts',
        'tests/hermes-protocol-gateways-strip.test.ts',
        'tests/hermes-provider-readiness-bridge.test.ts',
        'tests/hermes-provider-readiness-bridge-real.test.ts',
        'tests/hermes-provider-readiness-strip.test.ts',
        'tests/hermes-runtime-backends-bridge.test.ts',
        'tests/hermes-runtime-backends-bridge-real.test.ts',
        'tests/hermes-runtime-backends-strip.test.ts',
        'tests/hermes-tool-catalog-bridge.test.ts',
        'tests/hermes-tool-catalog-strip.test.ts',
        'tests/hermes-toolsets-bridge.test.ts',
        'tests/hermes-toolsets-strip.test.ts',
      ])
    );
    expect(catalog.find((item) => item.label === 'Hermes / runtime live smoke')).toMatchObject({
      command: 'npm',
      args: ['test', '--', 'tests/agent/hermes-runtime-backends-smoke-real.test.ts', '--run'],
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 120_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / CLI status real smoke')).toMatchObject({
      command: 'npm',
      args: ['test', '--', 'tests/agent/hermes-cli-status-real.test.ts', '--run'],
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / built CLI real smoke')).toMatchObject({
      command: 'node',
      args: ['scripts/hermes-built-cli-smoke.mjs'],
      kind: 'integration',
      safeToRun: false,
      timeoutMs: 240_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / core workspace real smoke')).toMatchObject({
      command: 'npm',
      args: [
        'test',
        '--',
        'tests/tools/hermes-core-aliases-real.test.ts',
        'tests/tools/send-message-real.test.ts',
        'tests/tools/kanban-real.test.ts',
        '--run',
      ],
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / persistence skills real smoke')).toMatchObject({
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
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / platform connectors real smoke')).toMatchObject({
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
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / browser real smoke')).toMatchObject({
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
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / learning loop real smoke')).toMatchObject({
      command: 'npm',
      args: [
        'test',
        '--',
        'tests/agent/learning-agent-real.test.ts',
        'tests/commands/learning-retrospective-command.test.ts',
        '--run',
      ],
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / execute_code real smoke')).toMatchObject({
      command: 'npm',
      args: ['test', '--', 'tests/tools/execute-code-real.test.ts', '--run'],
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 120_000,
    });
    expect(catalog.find((item) => item.label === 'Hermes / media vision real smoke')).toMatchObject({
      command: 'npm',
      args: [
        'test',
        '--',
        'tests/tools/text-to-speech-real.test.ts',
        'tests/tools/vision-analyze-real.test.ts',
        'tests/tools/media-generation-real.test.ts',
        '--run',
      ],
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Cowork / permission real flow')).toMatchObject({
      kind: 'e2e',
      safeToRun: false,
    });
    expect(catalog.find((item) => item.label === 'Server / real GPT-5.5 chat API')).toMatchObject({
      kind: 'real-provider',
      safeToRun: false,
      requiresEnv: 'CODEBUDDY_REAL_GPT55_SERVER',
      env: { CODEBUDDY_REAL_GPT55_SERVER: '1' },
    });
    expect(catalog.find((item) => item.label === 'CLI / headless provider failure exit')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Server / local HTTP chat routes')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Server / cron status real HTTP')).toMatchObject({
      command: 'npm',
      args: [
        'test',
        '--',
        'tests/server/cron-jobs-real-http.test.ts',
        'tests/server/native-status-report-real-http.test.ts',
        '--run',
      ],
      kind: 'integration',
      safeToRun: true,
      timeoutMs: 180_000,
    });
    expect(catalog.find((item) => item.label === 'Server / provider error status bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Fleet / peer tool security suite')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Fleet / routing orchestration bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'MCP / real transport suite')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Fleet/MCP local smoke suite')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Backend / deterministic integration bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Permissions / security policy bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Observability / run tracking bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Mobile / supervision gateway bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Device / transport adapters bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Gateway / realtime websocket bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'A2A / ACP channel bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Channels / messaging adapters bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Memory / context persistence bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Context / compression pruning bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Voice / speech TTS bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Providers / model config bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Providers / resilience error bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Tools / editing search bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Agent / reasoning execution bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Autonomous / multi-agent harness bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Companion / core behaviour bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Automation / browser desktop bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Automation / scheduler hooks notifications bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Security / hardening audit bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'CLI / command surface bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Plugins / skills bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'UI / terminal observer bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Config / auth provider bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Data / session sync cache bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Maintenance / doctor backup settings bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Server / API MCP platform bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Infrastructure / MCP sandbox adapters bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: true,
    });
    expect(catalog.find((item) => item.label === 'Docker / real sandbox smoke')).toMatchObject({
      kind: 'integration',
      safeToRun: false,
      requiresEnv: 'CODEBUDDY_REAL_DOCKER_SANDBOX',
      env: { CODEBUDDY_REAL_DOCKER_SANDBOX: '1' },
    });
    expect(catalog.find((item) => item.label === 'Docker / sandbox full bundle')).toMatchObject({
      kind: 'integration',
      safeToRun: false,
      requiresEnv: 'CODEBUDDY_REAL_DOCKER_SANDBOX',
      env: { CODEBUDDY_REAL_DOCKER_SANDBOX: '1' },
    });
    expect(catalog.find((item) => item.label === 'Computer Use / real desktop suite')).toMatchObject({
      command: 'npx',
      args: ['tsx', 'scratch/computer-use-real-suite.ts'],
      kind: 'integration',
      safeToRun: false,
      requiresEnv: 'CODEBUDDY_REAL_COMPUTER_USE',
      env: { CODEBUDDY_REAL_COMPUTER_USE: '1' },
    });

    const uncatalogedRealTests = listRealTestFiles(workspace).filter(
      (testPath) => !catalogTestFileArgs(catalog).has(testPath)
    );
    expect(uncatalogedRealTests).toEqual([]);
  });

  it('runs a catalog item and reports its status', async () => {
    const bridge = new TestRunnerBridge();
    bridge.setWorkspace(makeWorkspace());
    const item = bridge.getCatalog().find((entry) => entry.label === 'test');

    expect(item).toBeTruthy();
    const result = await bridge.runCatalogItem(item!.id);

    expect(result.success).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.tests[0]).toMatchObject({
      name: 'test',
      status: 'passed',
    });
  });

  it('reports stderr for a failing catalog item', async () => {
    const bridge = new TestRunnerBridge();
    bridge.setWorkspace(makeWorkspace());
    const item = bridge.getCatalog().find((entry) => entry.label === 'test:fail');

    expect(item).toBeTruthy();
    const result = await bridge.runCatalogItem(item!.id);

    expect(result.success).toBe(false);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.tests[0]).toMatchObject({
      name: 'test:fail',
      status: 'failed',
      error: expect.stringContaining('QA_FAIL_MARKER'),
    });
  });

  it('times out a hanging catalog command and tears down the process tree', async () => {
    const bridge = new TestRunnerBridge();
    const workspace = makeWorkspace();
    const marker = `QA_TIMEOUT_MARKER_${Date.now()}`;
    const scriptPath = path.join(workspace, 'timeout-proof.js');
    writeFileSync(scriptPath, `console.log('${marker}');\nsetInterval(() => {}, 1000);\n`);

    const result = await (bridge as PrivateTestRunnerBridge).runCommand({
      command: 'node',
      args: [scriptPath],
      cwd: workspace,
      framework: 'Timeout',
      label: 'timeout proof',
      timeoutMs: 300,
    });

    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.tests[0]).toMatchObject({
      name: 'timeout proof',
      status: 'failed',
      error: 'Timed out after 300ms',
    });
    expect(hasProcessWithMarker(marker)).toBe(false);
  });

  it('prefers Vitest test summary counts over file summary counts', async () => {
    const bridge = new TestRunnerBridge();
    const workspace = makeWorkspace();
    const scriptPath = path.join(workspace, 'vitest-summary-proof.js');
    writeFileSync(
      scriptPath,
      "console.log('\\u001b[2m Test Files \\u001b[22m \\u001b[1m\\u001b[32m1 passed\\u001b[39m\\u001b[22m \\u001b[2m      Tests \\u001b[22m \\u001b[1m\\u001b[32m8 passed\\u001b[39m\\u001b[22m \\u001b[2m   Start at \\u001b[22m 03:32:49');\n"
    );
    const result = await (bridge as PrivateTestRunnerBridge).runCommand({
      command: 'node',
      args: [scriptPath],
      cwd: workspace,
      framework: 'Vitest',
      label: 'vitest summary proof',
      timeoutMs: 1000,
    });

    expect(result.success).toBe(true);
    expect(result.passed).toBe(8);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(8);
  });

  it('uses the last Vitest Tests summary when earlier output contains Tests text', async () => {
    const bridge = new TestRunnerBridge();
    const workspace = makeWorkspace();
    const scriptPath = path.join(workspace, 'vitest-noisy-summary-proof.js');
    writeFileSync(
      scriptPath,
      [
        "console.log('Tests diagnostics heading without counts');",
        "console.log('\\u001b[2m Test Files \\u001b[22m \\u001b[1m\\u001b[32m21 passed\\u001b[39m\\u001b[22m\\u001b[90m (21)\\u001b[39m \\u001b[2m      Tests \\u001b[22m \\u001b[1m\\u001b[32m701 passed\\u001b[39m\\u001b[22m\\u001b[2m | \\u001b[22m\\u001b[33m39 skipped\\u001b[39m\\u001b[90m (740)\\u001b[39m \\u001b[2m   Start at \\u001b[22m 06:43:49');",
      ].join('\n')
    );
    const result = await (bridge as PrivateTestRunnerBridge).runCommand({
      command: 'node',
      args: [scriptPath],
      cwd: workspace,
      framework: 'Vitest',
      label: 'vitest noisy summary proof',
      timeoutMs: 1000,
    });

    expect(result.success).toBe(true);
    expect(result.passed).toBe(701);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(39);
    expect(result.total).toBe(740);
  });

  it('records catalog runs in the core observability store when available', async () => {
    const store = {
      startRun: vi.fn(() => 'run_catalog_fail'),
      emit: vi.fn(),
      saveArtifact: vi.fn(),
      updateMetrics: vi.fn(),
      endRun: vi.fn(),
    };
    mockedLoadCoreModule.mockImplementation(async (relativePath: string) => {
      if (relativePath === 'observability/run-store.js') {
        return {
          RunStore: {
            getInstance: () => store,
          },
        };
      }
      return null;
    });

    const bridge = new TestRunnerBridge();
    bridge.setWorkspace(makeWorkspace());
    const item = bridge.getCatalog().find((entry) => entry.label === 'test:fail');

    expect(item).toBeTruthy();
    const result = await bridge.runCatalogItem(item!.id);

    expect(result.success).toBe(false);
    expect(store.startRun).toHaveBeenCalledWith(
      'Test runner: test:fail',
      expect.objectContaining({
        channel: 'cowork',
        source: 'test-runner',
        origin: 'cowork-test-runner-panel',
      })
    );
    expect(store.emit).toHaveBeenCalledWith(
      'run_catalog_fail',
      expect.objectContaining({
        type: 'tool_result',
        data: expect.objectContaining({
          exitCode: 7,
          success: false,
        }),
      })
    );
    expect(store.saveArtifact).toHaveBeenCalledWith(
      'run_catalog_fail',
      'test-output.txt',
      expect.stringContaining('QA_FAIL_MARKER')
    );
    expect(store.updateMetrics).toHaveBeenCalledWith('run_catalog_fail', expect.objectContaining({ toolCallCount: 1 }));
    expect(store.endRun).toHaveBeenCalledWith('run_catalog_fail', 'failed');
  });
});
