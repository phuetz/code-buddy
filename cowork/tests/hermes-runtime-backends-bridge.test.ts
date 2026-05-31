import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  getHermesRuntimeBackendsForReview,
  runHermesRuntimeBackendSmokeForReview,
} from '../src/main/tools/hermes-runtime-backends-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes runtime backends bridge', () => {
  it('summarizes runtime backend readiness without leaking secret values', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesAgentDiagnostics: () => ({
        runtimeBackends: {
          arch: 'x64',
          availableCount: 3,
          backends: [
            {
              command: 'node',
              configured: true,
              credentialSources: [],
              id: 'local',
              installed: true,
              label: 'Local process',
              notes: ['local'],
              officialSurface: 'local terminal backend',
              remediation: [],
              runnable: true,
              smokeCommand: 'node -e "console.log(\'OK-HERMES-LOCAL\')"',
              status: 'available',
              version: 'v24.14.0',
            },
            {
              command: 'vercel',
              configured: true,
              credentialSources: ['VERCEL_TOKEN'],
              id: 'vercel-sandbox',
              installed: true,
              label: 'Vercel Sandbox',
              notes: ['remote'],
              officialSurface: 'Vercel Sandbox remote backend',
              remediation: [],
              runnable: true,
              smokeCommand: 'vercel whoami',
              status: 'configured',
              version: 'Vercel CLI 42.0.0',
            },
          ],
          configuredRemoteCount: 1,
          generatedAt: '2026-05-30T22:00:00.000Z',
          issues: [],
          ok: true,
          platform: 'win32',
          recommendations: ['Run Docker smoke when available.'],
          runnableCount: 2,
        },
      }),
    });

    const summary = await getHermesRuntimeBackendsForReview();

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-agent-diagnostics.js');
    expect(summary).toMatchObject({
      command: 'buddy hermes doctor balanced --json',
      ok: true,
      platform: 'win32',
      arch: 'x64',
      availableCount: 3,
      configuredRemoteCount: 1,
      runnableCount: 2,
      backends: [
        expect.objectContaining({
          id: 'local',
          runnable: true,
          smokeCommand: expect.stringContaining('OK-HERMES-LOCAL'),
        }),
        expect.objectContaining({
          id: 'vercel-sandbox',
          credentialSources: ['VERCEL_TOKEN'],
          status: 'configured',
        }),
      ],
    });
    expect(JSON.stringify(summary)).not.toContain('secret-vercel-token');
  });

  it('degrades to null when the core diagnostic module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesRuntimeBackendsForReview()).resolves.toBeNull();
  });

  it('runs a backend smoke through the core live smoke module', async () => {
    const runHermesRuntimeBackendSmoke = vi.fn(() => ({
      args: ['-e', "console.log('OK-HERMES-LOCAL')"],
      backendId: 'local',
      command: 'node',
      durationMs: 42,
      exitCode: 0,
      finishedAt: '2026-05-31T10:16:00.042Z',
      label: 'Local process',
      ok: true,
      output: 'OK-HERMES-LOCAL',
      signal: null,
      startedAt: '2026-05-31T10:16:00.000Z',
      status: 'passed',
      stderr: '',
      stdout: 'OK-HERMES-LOCAL',
    }));
    mockedLoadCoreModule.mockResolvedValue({
      runHermesRuntimeBackendSmoke,
    });

    const result = await runHermesRuntimeBackendSmokeForReview(' local ');

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-runtime-backends.js');
    expect(runHermesRuntimeBackendSmoke).toHaveBeenCalledWith({ backendId: 'local' });
    expect(result).toMatchObject({
      backendId: 'local',
      ok: true,
      output: 'OK-HERMES-LOCAL',
      status: 'passed',
    });
  });
});
