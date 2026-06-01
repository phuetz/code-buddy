import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runHermesBrowserBackendSmokeForReview } from '../src/main/tools/hermes-browser-backends-bridge';
import { runHermesLocalSmokeSuiteForReview } from '../src/main/tools/hermes-local-smoke-bridge';
import { runHermesProtocolGatewaysSmokeForReview } from '../src/main/tools/hermes-protocol-gateways-bridge';
import { runHermesRuntimeBackendSmokeForReview } from '../src/main/tools/hermes-runtime-backends-bridge';

vi.mock('../src/main/tools/hermes-runtime-backends-bridge', () => ({
  runHermesRuntimeBackendSmokeForReview: vi.fn(),
}));

vi.mock('../src/main/tools/hermes-browser-backends-bridge', () => ({
  runHermesBrowserBackendSmokeForReview: vi.fn(),
}));

vi.mock('../src/main/tools/hermes-protocol-gateways-bridge', () => ({
  runHermesProtocolGatewaysSmokeForReview: vi.fn(),
}));

const mockedRuntimeSmoke = vi.mocked(runHermesRuntimeBackendSmokeForReview);
const mockedBrowserSmoke = vi.mocked(runHermesBrowserBackendSmokeForReview);
const mockedProtocolSmoke = vi.mocked(runHermesProtocolGatewaysSmokeForReview);

beforeEach(() => {
  mockedRuntimeSmoke.mockReset();
  mockedBrowserSmoke.mockReset();
  mockedProtocolSmoke.mockReset();
});

describe('Hermes local smoke bridge', () => {
  it('runs the safe local Hermes smoke suite through the existing bridges', async () => {
    mockedRuntimeSmoke.mockResolvedValue({
      args: ['-e', "console.log('OK-HERMES-LOCAL')"],
      backendId: 'local',
      command: 'C:\\Program Files\\nodejs\\node.exe',
      durationMs: 22,
      exitCode: 0,
      finishedAt: '2026-06-01T05:20:00.022Z',
      label: 'Local process',
      ok: true,
      output: 'OK-HERMES-LOCAL',
      signal: null,
      startedAt: '2026-06-01T05:20:00.000Z',
      status: 'passed',
      stderr: '',
      stdout: 'OK-HERMES-LOCAL',
    });
    mockedBrowserSmoke.mockResolvedValue({
      artifacts: [{
        exists: true,
        kind: 'playwright-trace',
        label: 'Local Playwright trace',
        path: 'C:\\Temp\\codebuddy-hermes-browser\\local-playwright-trace.zip',
        sizeBytes: 1234,
      }],
      backendId: 'local-playwright',
      command: 'C:\\Program Files\\nodejs\\node.exe',
      durationMs: 31,
      finishedAt: '2026-06-01T05:20:00.031Z',
      label: 'Local Playwright',
      ok: true,
      output: 'title=OK-HERMES-BROWSER; trace=C:\\Temp\\codebuddy-hermes-browser\\local-playwright-trace.zip',
      startedAt: '2026-06-01T05:20:00.000Z',
      status: 'passed',
      stderr: '',
      stdout: 'title=OK-HERMES-BROWSER; trace=C:\\Temp\\codebuddy-hermes-browser\\local-playwright-trace.zip',
    });
    mockedProtocolSmoke.mockResolvedValue({
      durationMs: 45,
      generatedAt: '2026-06-01T05:20:00.045Z',
      httpRoutes: {
        a2aAgentName: 'Code Buddy',
        acpSessionCount: 1,
        baseUrl: 'http://127.0.0.1:54123',
        ok: true,
        routes: [
          { ok: true, path: '/api/a2a/.well-known/agent.json', status: 200 },
          { ok: true, path: '/api/a2a/agents', status: 200 },
          { ok: true, path: '/api/acp/sessions', status: 201 },
        ],
      },
      kind: 'hermes_protocol_gateway_smoke',
      mcpStdio: {
        echoText: 'HERMES_PROTOCOL_MCP:OK',
        ok: true,
        serverName: 'hermes_protocol_fixture',
        toolCount: 1,
        transport: 'stdio',
      },
      ok: true,
      schemaVersion: 1,
    });

    const result = await runHermesLocalSmokeSuiteForReview();

    expect(mockedRuntimeSmoke).toHaveBeenCalledWith('auto');
    expect(mockedBrowserSmoke).toHaveBeenCalledWith('auto');
    expect(mockedProtocolSmoke).toHaveBeenCalledWith();
    expect(result).toMatchObject({
      commands: {
        browser: 'buddy hermes browser-smoke auto --json',
        protocols: 'buddy hermes protocols-smoke local --json',
        runtime: 'buddy hermes runtime-smoke auto --json',
        suite: 'buddy hermes smoke --json',
      },
      kind: 'hermes_local_smoke_suite',
      ok: true,
      schemaVersion: 1,
      summary: {
        passed: 3,
        total: 3,
      },
    });
    expect(result.results.runtime.command).toBe('node.exe');
    expect(result.results.browser.command).toBe('node.exe');
    expect(result.results.browser.output).toContain('trace=[redacted-local-path]');
    expect(result.results.browser.artifacts?.[0]?.path).toBe('local-playwright-trace.zip');
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z]:\\\\/);
    expect(JSON.stringify(result)).not.toContain('C:\\Temp');
  });

  it('marks the suite failed when one local smoke fails', async () => {
    mockedRuntimeSmoke.mockResolvedValue({
      args: [],
      backendId: 'local',
      command: 'node',
      durationMs: 22,
      exitCode: 0,
      finishedAt: '2026-06-01T05:20:00.022Z',
      label: 'Local process',
      ok: true,
      output: 'OK-HERMES-LOCAL',
      signal: null,
      startedAt: '2026-06-01T05:20:00.000Z',
      status: 'passed',
      stderr: '',
      stdout: 'OK-HERMES-LOCAL',
    });
    mockedBrowserSmoke.mockResolvedValue({
      backendId: 'local-playwright',
      command: 'node',
      durationMs: 31,
      finishedAt: '2026-06-01T05:20:00.031Z',
      label: 'Local Playwright',
      ok: false,
      output: '',
      startedAt: '2026-06-01T05:20:00.000Z',
      status: 'failed',
      stderr: 'browser failed',
      stdout: '',
    });
    mockedProtocolSmoke.mockResolvedValue({
      durationMs: 45,
      generatedAt: '2026-06-01T05:20:00.045Z',
      httpRoutes: { ok: true, routes: [] },
      kind: 'hermes_protocol_gateway_smoke',
      mcpStdio: {
        ok: true,
        serverName: 'hermes_protocol_fixture',
        toolCount: 1,
        transport: 'stdio',
      },
      ok: true,
      schemaVersion: 1,
    });

    const result = await runHermesLocalSmokeSuiteForReview();

    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({
      passed: 2,
      total: 3,
    });
  });
});
