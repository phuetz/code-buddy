import { spawnSync } from 'child_process';
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

    const portal = runHermesJson(['portal', 'status']) as {
      kind: string;
      portal: { defaultPortalUrl: string };
      toolGateway: { tools: unknown[] };
    };
    expect(portal.kind).toBe('hermes_portal_status');
    expect(portal.portal.defaultPortalUrl).toBe('https://portal.nousresearch.com');
    expect(portal.toolGateway.tools.length).toBeGreaterThan(0);

    const browser = runHermesJson(['browser', 'status']) as {
      kind: string;
      readiness: { backends: Array<{ id: string }>; localRunnableCount: number };
    };
    expect(browser.kind).toBe('hermes_browser_backends_status');
    expect(browser.readiness.localRunnableCount).toBeGreaterThanOrEqual(1);
    expect(browser.readiness.backends.map((backend) => backend.id)).toContain('local-playwright');

    const runtime = runHermesJson(['runtime', 'status']) as {
      kind: string;
      readiness: { backends: Array<{ id: string }>; runnableCount: number };
    };
    expect(runtime.kind).toBe('hermes_runtime_backends_status');
    expect(runtime.readiness.runnableCount).toBeGreaterThanOrEqual(1);
    expect(runtime.readiness.backends.map((backend) => backend.id)).toContain('local');

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
  });
});
