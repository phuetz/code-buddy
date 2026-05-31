import { spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runHermesJson(args: string[]): unknown {
  const result = spawnSync(process.execPath, [tsxCli, 'src/index.ts', 'hermes', ...args, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
    windowsHide: true,
  });

  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toMatch(/^\{/);
  return JSON.parse(result.stdout) as unknown;
}

describe('Hermes CLI status real smoke', () => {
  it('runs the status command matrix through the real CLI entrypoint', () => {
    const doctor = runHermesJson(['doctor', 'safe']) as {
      diagnostics: {
        activeToolset: { toolsetId: string };
        ok: boolean;
        providerReadiness: { activeModel: { model: string }; providers: unknown[] };
        runtimeBackends: { backends: unknown[]; runnableCount: number };
        browserBackends: { backends: unknown[]; localRunnableCount: number };
      };
      requestedProfile: string;
    };
    expect(doctor.requestedProfile).toBe('safe');
    expect(doctor.diagnostics.ok).toBe(true);
    expect(doctor.diagnostics.activeToolset.toolsetId).toBe('fleet.hermes.safe');
    expect(doctor.diagnostics.providerReadiness.activeModel.model).toBeTruthy();
    expect(doctor.diagnostics.providerReadiness.providers.length).toBeGreaterThan(0);
    expect(doctor.diagnostics.runtimeBackends.backends.length).toBeGreaterThan(0);
    expect(doctor.diagnostics.runtimeBackends.runnableCount).toBeGreaterThanOrEqual(1);
    expect(doctor.diagnostics.browserBackends.backends.length).toBeGreaterThan(0);
    expect(doctor.diagnostics.browserBackends.localRunnableCount).toBeGreaterThanOrEqual(1);

    const toolsets = runHermesJson(['toolsets', 'safe']) as {
      activeProfile: string;
      activeToolset: { toolsetId: string };
      kind: string;
      summary: { totalToolsets: number };
      toolsets: Array<{ toolsetId: string }>;
    };
    expect(toolsets.kind).toBe('hermes_toolsets_catalog');
    expect(toolsets.activeProfile).toBe('safe');
    expect(toolsets.activeToolset.toolsetId).toBe('fleet.hermes.safe');
    expect(toolsets.summary.totalToolsets).toBe(5);
    expect(toolsets.toolsets.map((toolset) => toolset.toolsetId)).toContain('fleet.hermes.review');

    const tools = runHermesJson(['tools']) as {
      kind: string;
      summary: { exact: number; gaps: number; total: number };
    };
    expect(tools.kind).toBe('hermes_official_tool_parity_manifest');
    expect(tools.summary.total).toBeGreaterThanOrEqual(70);
    expect(tools.summary.exact).toBeGreaterThan(0);
    expect(tools.summary.gaps).toBe(0);

    const todo = runHermesJson(['todo']) as {
      command: string;
      kind: string;
      summary: { activeTodoCount: number; deferredCount: number; includedDeferred: boolean };
      todos: Array<{ id: string }>;
      deferred: Array<{ id: string; nextWork: string }>;
    };
    expect(todo.kind).toBe('hermes_parity_todo');
    expect(todo.command).toBe('buddy hermes todo --json');
    expect(todo.summary.includedDeferred).toBe(false);
    expect(todo.summary.activeTodoCount).toBeGreaterThan(0);
    expect(todo.summary.deferredCount).toBeGreaterThanOrEqual(1);
    expect(todo.todos.map((item) => item.id)).not.toContain('openclaw-migration');
    expect(todo.deferred).toEqual([
      expect.objectContaining({
        id: 'openclaw-migration',
        nextWork: expect.stringContaining('Do this at the end'),
      }),
    ]);

    const todoWithDeferred = runHermesJson(['todo', '--include-deferred']) as {
      kind: string;
      summary: { includedDeferred: boolean };
      todos: Array<{ id: string }>;
    };
    expect(todoWithDeferred.kind).toBe('hermes_parity_todo');
    expect(todoWithDeferred.summary.includedDeferred).toBe(true);
    expect(todoWithDeferred.todos.map((item) => item.id)).toContain('openclaw-migration');

    const portal = runHermesJson(['portal', 'status']) as {
      kind: string;
      portal: { defaultPortalUrl: string };
      toolGateway: { tools: unknown[] };
    };
    expect(portal.kind).toBe('hermes_portal_status');
    expect(portal.portal.defaultPortalUrl).toBe('https://portal.nousresearch.com');
    expect(portal.toolGateway.tools.length).toBeGreaterThan(0);

    const provider = runHermesJson(['providers', 'status']) as {
      kind: string;
      readiness: {
        activeModel: { model: string };
        activeProvider: { label: string };
        providers: unknown[];
      };
    };
    expect(provider.kind).toBe('hermes_provider_readiness_status');
    expect(provider.readiness.activeModel.model).toBeTruthy();
    expect(provider.readiness.activeProvider.label).toBeTruthy();
    expect(provider.readiness.providers.length).toBeGreaterThan(0);

    const browser = runHermesJson(['browser', 'status']) as {
      kind: string;
      readiness: { backends: Array<{ id: string }>; localRunnableCount: number };
    };
    expect(browser.kind).toBe('hermes_browser_backends_status');
    expect(browser.readiness.localRunnableCount).toBeGreaterThanOrEqual(1);
    expect(browser.readiness.backends.map((backend) => backend.id)).toContain('local-playwright');

    const browserSmoke = runHermesJson(['browser-smoke', 'local-playwright']) as {
      kind: string;
      result: {
        artifacts?: Array<{ exists: boolean; kind: string; path: string; sizeBytes: number }>;
        backendId: string;
        ok: boolean;
        output: string;
        status: string;
      };
    };
    expect(browserSmoke.kind).toBe('hermes_browser_backend_smoke');
    expect(browserSmoke.result).toMatchObject({
      backendId: 'local-playwright',
      ok: true,
      status: 'passed',
    });
    expect(browserSmoke.result.output).toContain('OK-HERMES-BROWSER');
    const traceArtifact = browserSmoke.result.artifacts?.find((artifact) => artifact.kind === 'playwright-trace');
    expect(traceArtifact).toMatchObject({ exists: true });
    expect(traceArtifact?.sizeBytes).toBeGreaterThan(0);
    expect(traceArtifact?.path).toBeTruthy();
    expect(existsSync(traceArtifact!.path)).toBe(true);
    expect(statSync(traceArtifact!.path).size).toBeGreaterThan(0);

    const protocols = runHermesJson(['protocols', 'status']) as {
      kind: string;
      ok: boolean;
      smokeCommand: string;
      summary: { availableCount: number; missingCount: number; partialCount: number };
    };
    expect(protocols.kind).toBe('hermes_protocol_gateway_readiness');
    expect(protocols.ok).toBe(true);
    expect(protocols.smokeCommand).toBe('buddy hermes protocols-smoke local --json');
    expect(protocols.summary.availableCount).toBeGreaterThanOrEqual(5);
    expect(protocols.summary.missingCount).toBe(0);
    expect(protocols.summary.partialCount).toBeGreaterThanOrEqual(1);

    const protocolsSmoke = runHermesJson(['protocols-smoke', 'local']) as {
      kind: string;
      ok: boolean;
      httpRoutes: { a2aAgentName: string; acpSessionCount: number; ok: boolean };
      mcpStdio: { echoText: string; ok: boolean; serverName: string; transport: string };
    };
    expect(protocolsSmoke.kind).toBe('hermes_protocol_gateway_smoke');
    expect(protocolsSmoke.ok).toBe(true);
    expect(protocolsSmoke.mcpStdio).toMatchObject({
      echoText: 'HERMES_PROTOCOL_MCP:OK',
      ok: true,
      serverName: 'hermes_protocol_fixture',
      transport: 'stdio',
    });
    expect(protocolsSmoke.httpRoutes).toMatchObject({
      a2aAgentName: 'Code Buddy',
      acpSessionCount: 1,
      ok: true,
    });

    const runtime = runHermesJson(['runtime', 'status']) as {
      kind: string;
      readiness: { backends: Array<{ id: string; runnable: boolean }>; runnableCount: number };
    };
    expect(runtime.kind).toBe('hermes_runtime_backends_status');
    expect(runtime.readiness.runnableCount).toBeGreaterThanOrEqual(1);
    expect(runtime.readiness.backends.map((backend) => backend.id)).toContain('local');

    const localRuntimeSmoke = runHermesJson(['runtime-smoke', 'local']) as {
      kind: string;
      result: { backendId: string; ok: boolean; output: string; status: string };
    };
    expect(localRuntimeSmoke.kind).toBe('hermes_runtime_backend_smoke');
    expect(localRuntimeSmoke.result).toMatchObject({
      backendId: 'local',
      ok: true,
      status: 'passed',
    });
    expect(localRuntimeSmoke.result.output).toContain('OK-HERMES-LOCAL');

    const wslBackend = runtime.readiness.backends.find((backend) => backend.id === 'wsl');
    if (wslBackend?.runnable) {
      const wslRuntimeSmoke = runHermesJson(['runtime-smoke', 'wsl']) as {
        kind: string;
        result: { backendId: string; ok: boolean; output: string; status: string };
      };
      expect(wslRuntimeSmoke.kind).toBe('hermes_runtime_backend_smoke');
      expect(wslRuntimeSmoke.result).toMatchObject({
        backendId: 'wsl',
        ok: true,
        status: 'passed',
      });
      expect(wslRuntimeSmoke.result.output).toContain('OK-HERMES-WSL');
    }

    const messaging = runHermesJson(['messaging', 'status']) as {
      kind: string;
      status: {
        config: { configuredCount: number };
        kind: string;
        runtime: { registeredCount: number };
      };
    };
    expect(messaging.kind).toBe('hermes_messaging_gateway_status');
    expect(messaging.status.kind).toBe('codebuddy_channel_status');
    expect(messaging.status.config.configuredCount).toBeGreaterThanOrEqual(0);
    expect(messaging.status.runtime.registeredCount).toBeGreaterThanOrEqual(0);

    const mobile = runHermesJson(['mobile', 'status', 'mobile', 'supervision']) as {
      kind: string;
      ok: boolean;
      routeMount: { basePath: string; status: string };
      summary: { draftOnlyEndpoints: number; readOnlyEndpoints: number };
      approvalQueue: { autoDispatch: boolean; remoteExecutionDisabled: boolean };
    };
    expect(mobile.kind).toBe('hermes_mobile_supervision_status');
    expect(mobile.ok).toBe(true);
    expect(mobile.routeMount).toMatchObject({
      basePath: '/api/mobile',
      status: 'implemented_not_probed',
    });
    expect(mobile.summary.readOnlyEndpoints).toBe(3);
    expect(mobile.summary.draftOnlyEndpoints).toBe(1);
    expect(mobile.approvalQueue).toMatchObject({
      autoDispatch: false,
      remoteExecutionDisabled: true,
    });

    const promptSize = runHermesJson(['prompt-size', 'safe']) as {
      kind: string;
      sections: Array<{ id: string }>;
      toolsetId: string;
      totals: { bytes: number };
    };
    expect(promptSize.kind).toBe('hermes_prompt_size_diagnostic');
    expect(promptSize.toolsetId).toBe('fleet.hermes.safe');
    expect(promptSize.totals.bytes).toBeGreaterThan(0);
    expect(promptSize.sections.map((section) => section.id)).toEqual(
      expect.arrayContaining(['systemPrompt', 'toolset', 'toolSchemas'])
    );
  }, 90_000);
});
